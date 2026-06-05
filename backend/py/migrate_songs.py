from __future__ import annotations

import argparse
from collections import Counter
from collections.abc import Callable
import csv
from datetime import datetime
import itertools
import json
from pathlib import Path
from typing import Any
import re

from music_db.normalize import WHITELIST, parse_artists, normalize_artist, normalize_title
from music_db.query import get_album_by_data, get_artist_by_apple_id, get_artist_by_name
from music_db.schema import *
from music_db.typing import *
import psycopg

HERE = Path(__file__).resolve().parent

class LegacySongs:
    BOOL_COLUMNS = ['verified', 'library']
    DATE_COLUMNS = ['release_date', 'added_date', 'modified_date']
    INTEGER_COLUMNS = ['legacy_id', 'id 2504', 'id 2512', 'play_count 2504', 'play_count 2512', 'play_count_deducted', 'play_count_2025', 'disc_number', 'disc_count', 'track_number', 'track_count', 'duration']
    STRING_COLUMNS = ['name 2504', 'name 2512', 'artist', 'artist_label', 'artist_primary 2504', 'artist_primary 2512', 'album 2504', 'album 2512', 'vocal', 'locale', 'genre', 'genre_alt', 'genre_tag', 'apple_music', 'isrc', 'album_artwork']

    @staticmethod
    def _apply(source: dict, keys: list[str], func: Callable[..., Any], nullable: bool = False) -> None:
        for key in keys:
            if isinstance(source.get(key), str) or nullable:
                try:
                    if source[key] == '':
                        source[key] = None
                    else:
                        source[key] = func(source[key])
                except ValueError:
                    raise ValueError(f'Can\'t apply func to `{source[key]}` in column `{key}`.')
            else:
                raise ValueError(f'Can\'t find the column `{key}`.')

    @staticmethod
    def _format(row: dict[str, str]) -> dict[str, Any]:
        def to_bool(input: str) -> bool:
            if input.lower() == 'true':
                return True
            return False

        def to_iso_date(input: str) -> datetime | None:
            if input == '':
                return None
            try:
                parsed = datetime.strptime(input, '%Y-%m-%d %H:%M:%S')
                return parsed
            except ValueError:
                raise ValueError()

        def to_nullable_string(input: str) -> str | None:
            if input == '':
                return None
            return input

        result: dict[str, Any] = row.copy()
        LegacySongs._apply(result, LegacySongs.BOOL_COLUMNS, to_bool)
        LegacySongs._apply(result, LegacySongs.DATE_COLUMNS, to_iso_date)
        LegacySongs._apply(result, LegacySongs.INTEGER_COLUMNS, int)
        LegacySongs._apply(result, LegacySongs.STRING_COLUMNS, to_nullable_string)
        return result

    @staticmethod
    def _post_format(row: dict[str, Any], whitelist: list[str]) -> dict[str, Any]:
        def extract_dbgenreinfo(input: list[str]) -> DBGenreInfo:
            genre_info = DBGenreInfo.NONE
            tags = [DBGenreInfo.get_genre_info(x) for x in input]
            for tag in tags:
                if tag != genre_info:
                    return tag
            return genre_info
        
        def extract_dbgenretag(input: list[str]) -> DBGenreTag:
            genre_tag = DBGenreTag.NONE
            tags = [DBGenreTag.get_sub_genre(x) for x in input]
            for tag in tags:
                genre_tag |= tag
            return genre_tag

        def extract_dbmediatag(input: list[str]) -> DBMediaTag:
            media_tag = DBMediaTag.NONE
            tags = [DBMediaTag.get_media_tag(x) for x in input]
            for tag in tags:
                media_tag |= tag
            return media_tag

        def to_apple_music_artwork_url(input: str | None) -> str | None:
            if input is None:
                return None
            
            if input.startswith('Music') and (input.endswith('.jpg') or input.endswith('.png')):
                return f'https://is1-ssl.mzstatic.com/image/thumb/{input}'
            else:
                raise ValueError()

        def to_dbgenretag(input: str | None) -> DBGenreTag:
            if isinstance(input, str):
                return DBGenreTag.get_genre(input)
            else:
                return DBGenreTag.NONE

        def to_dblocale(input: str | None) -> DBLocale:
            if isinstance(input, str):
                return DBLocale.get_locale(input)
            else:
                return DBLocale.UND
            
        def to_dbvocal(input: str | None) -> DBVocal:
            if isinstance(input, str):
                return DBVocal.get_vocal(input)
            else:
                return DBVocal.UNKNOWN
        
        def to_json(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            raise TypeError()
        
        for column in ['artist', 'artist_label', 'album_artist', 'genre_tag', 'apple_music', 'isrc']:
            row[column] = parse_artists(row[column], whitelist)
        LegacySongs._apply(row, ['album_artwork'], to_apple_music_artwork_url, nullable = True)

        result = row.copy()
        result['genre'] = to_dbgenretag(row['genre'])
        result['genre_info'] = extract_dbgenreinfo(row['genre_tag'])
        result['genre_tag'] = extract_dbgenretag(row['genre_tag'])
        result['locale'] = to_dblocale(row['locale'])
        result['media_tag'] = extract_dbmediatag(row['genre_tag'])
        result['vocal'] = to_dbvocal(row['vocal'])
        result['raw_json'] = json.dumps(row, ensure_ascii = False, default = to_json)
        return result

    @staticmethod
    def read(path: str | Path, whitelist: list[str] | None = None) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        with open(path, encoding = 'utf-8') as f:
            rows = csv.DictReader(f)
            for row in rows:
                result = LegacySongs._format(row)
                result = LegacySongs._post_format(result, whitelist if whitelist is not None else WHITELIST)
                results.append(result)
        
        return results

def create_album(connection: psycopg.Connection, album_name: str, album_artists: list[int], native_locale: DBLocale,
                 artwork_url: str | None = None,
                 disc_count: int | None = None,
                 track_counts: dict[int, int] | None = None,
                 release_date: datetime | None = None) -> int:
    if not album_artists:
        print('create_album: no artists provided.')
        return 0

    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT artist_id FROM artists WHERE artist_id = ANY(%s)
        """, (album_artists, ))
        verified_artists = [row[0] for row in cur.fetchall()]
        verified_artists = [aid for aid in album_artists if aid in verified_artists]

        compilation = (len(album_artists) == 1) and album_artists[0] == 0
        if compilation:
            album_type = DBAlbum.COMPILATION

        else:
            if not verified_artists:
                print(f'create_album: no known artists matches in DB.')
                return 0
            
            album_type = DBAlbum.get_album(normalize_title(album_name))

        cur.execute("""--sql
            INSERT INTO albums (album_type, artwork, disc_count, release_date)
            VALUES (%s, %s, %s, %s)
            RETURNING album_id
        """, (album_type.value, artwork_url, disc_count, release_date))
        album_id = int(cur.fetchone()[0]) # type: ignore

        cur.execute("""--sql
            INSERT INTO album_titles (album_id, fallback, locale, normalized_title, title)
            VALUES (%s, %s, %s, %s, %s)
        """, (album_id, native_locale == DBLocale.ZH_HANT, DBLocale.ZH_HANT.value, normalize_title(album_name, album = True), album_name))

        if not compilation:
            display_order = 1
            for artist in verified_artists:
                cur.execute("""--sql
                    INSERT INTO album_artists (album_id, artist_id, display_order)
                    VALUES (%s, %s, %s)
                """, (album_id, artist, display_order))
                display_order += 1
        
        if isinstance(track_counts, dict):
            for disc_number, track_count in track_counts.items():
                if not isinstance(disc_number, int) or not isinstance(track_count, int):
                    continue
                if (disc_number > 0) and (disc_count is None or (disc_count is not None and (disc_number <= disc_count))) and (track_count > 0):
                    cur.execute("""--sql
                        INSERT INTO album_track_counts (album_id, disc_number, track_count)
                        VALUES (%s, %s, %s)
                    """, (album_id, disc_number, track_count))
        
        return album_id

def create_artist(connection: psycopg.Connection, artist_name: str, apple_id: str | None) -> int:
    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO artists (artist_tag)
            VALUES (%s)
            RETURNING artist_id
        """, (DBArtistTag.NONE.value,))
        artist_id = cur.fetchone()[0]   # type: ignore

        cur.execute("""--sql
            INSERT INTO artist_titles (artist_id, fallback, locale, normalized_title, title)
            VALUES (%s, %s, %s, %s, %s)
        """, (artist_id, True, DBLocale.UND.value, normalize_artist(artist_name), artist_name))

        if apple_id and (apple_id != '0'):
            cur.execute("""--sql
                INSERT INTO artist_authorities (artist_id, authority, authority_code)
                VALUES (%s, %s, %s)
            """, (artist_id, DBAuthority.APPLE_MUSIC.value, apple_id))
    
    return int(artist_id)

def infer_artist_role(artist_name: str, song_title: str, credit_text: str) -> DBRole:
    sanitized = re.escape(artist_name)

    # Matches: "(ABC remix)" "[ABC remix]"
    remix_pattern = re.compile(r'[\(\[][^\)\]]*?' + sanitized + r'[^\)\]]*?remix[^\)\]]*?[\)\]]', re.IGNORECASE)
    if remix_pattern.search(song_title):
        return DBRole.REMIX
    
    # Matches: "(ABC)" "[ABC]" "(feat. ABC)"
    parentheis_pattern = re.compile(r'[\(\[][^\)\]]*?' + sanitized + r'[^\)\]]*?[\)\]]', re.IGNORECASE)
    if parentheis_pattern.search(song_title):
        return DBRole.FEAT
    
    # Matches: "ft. ABC" "feat ABC" "with ABC"
    feat_pattern = re.compile(r'(?:feat\.?|ft\.?|featuring|with).* ' + sanitized + r'(?=\)|\]|,| |$)', re.IGNORECASE)
    if feat_pattern.search(song_title):
        return DBRole.FEAT
    
    if artist_name.lower() not in credit_text.lower():
        return DBRole.FEAT
    
    return DBRole.MAIN

def infer_title_primary_locale(connection: psycopg.Connection, record: dict[str, Any], song_artists: list[int]) -> DBLocale:
    chinese_scripts: bool = False
    vocal: DBVocal = record.get('vocal', DBVocal.UNKNOWN)

    if vocal not in [DBVocal.ACOUSTIC, DBVocal.UNKNOWN]:
        locale: DBLocale = record.get('locale', DBLocale.UND)
        chinese_scripts = (locale == DBLocale.HAK) or (locale == DBLocale.NAN) or (locale == DBLocale.YUE) or (locale == DBLocale.ZH)

        if (locale not in [DBLocale.ZXX, DBLocale.UND]) and not chinese_scripts:
            return locale

    artist_locales = []
    for song_artist in song_artists:
        with connection.cursor() as cur:
            cur.execute("""--sql
                SELECT locale FROM artist_titles
                WHERE artist_id = %s
                AND fallback = true
            """, (song_artist, ))
            locale_int = cur.fetchone()[0]  # type: ignore
            locale_enum = DBLocale._value2member_map_[locale_int]
            artist_locales.append(locale_enum)

    if chinese_scripts:
        locales = [artist_locale for artist_locale in artist_locales if artist_locale in [DBLocale.ZH_HANS, DBLocale.ZH_HANT]]
        if len(locales) == 0:
            return artist_locales[0]

        locales = Counter(locales).most_common()
        locales = [locale[0] for locale in locales if locale[1] == locales[0][1]]

        if len(locales) == 1:
            return locales[0]
        else:
            return DBLocale.ZH_HANT

    else:
        locales = Counter(artist_locales).most_common()
        locales = [locale[0] for locale in locales if locale[1] == locales[0][1]]

        if len(locales) == 1:
            return locales[0]
        
        if len(locales) > 1:
            return artist_locales[0]

    return DBLocale.EN

def insert_entry(connection: psycopg.Connection, record: dict[str, Any], source_id: int) -> int:
    legacy_id: int = record.get('legacy_id', 0)
    raw_album: str = record.get('album 2512', '')
    raw_duration: int = record.get('duration', 0)
    raw_json: str = record.get('raw_json', '{}')
    raw_title: str = record.get('name 2512', '')

    raw_artists = record.get('artist_label', [])
    if len(raw_artists) == 0:
        raw_artists = parse_artists(record.get('artist_primary 2512', ''))
    raw_artist = ', '.join(raw_artists)
    
    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO entries (source_id, source_item_id, normalized_album, normalized_artist, normalized_title, raw_album, raw_artist, raw_duration, raw_json, raw_title)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING entry_id
        """, (source_id, legacy_id, normalize_title(raw_album), normalize_artist(raw_artist), normalize_title(raw_title), raw_album, raw_artist, raw_duration, raw_json, raw_title))
        entry_id = cur.fetchone()[0]    # type: ignore
    
    return int(entry_id)

def insert_song_album(connection: psycopg.Connection, record: dict[str, Any], song_id: int, native_locale: DBLocale) -> None:
    album_artists: list[str] = record.get('album_artist', [])
    album_title: str = record.get('album 2512', '')
    disc_count: int = record.get('disc_count', 1)
    disc_number: int = record.get('disc_number', 1)
    song_title: str = record.get('name 2512', '')
    track_count: int = record.get('track_count', 0)
    track_number: int = record.get('track_number', 1)
    album_id = get_album_by_data(connection, album_title, album_artists)

    compilation = (len(album_artists) == 1) and (album_artists[0] == 'Various Artists')

    if not album_id:
        if compilation:
            artist_ids = [0]
        else:
            artist_ids = [get_artist_by_name(connection, artist) for artist in album_artists]
            artist_ids = [aid for aid in artist_ids if aid is not None]
        
        album_artwork: str = record.get('album_artwork', '')
        album_id = create_album(connection, album_title, artist_ids, native_locale, album_artwork, disc_count, {disc_number: track_count})
    
    if album_id == 0:
        print(f'The album `{album_title}` for the song `{song_title}` is not created.\nListed artists: {", ".join(album_artists)}')
        return

    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT EXISTS (
                SELECT * FROM album_track_counts
                WHERE album_id = %s AND disc_number = %s
            )
        """, (album_id, disc_number))
        disc_stat_exist = cur.fetchone()[0]  # type: ignore

        if not disc_stat_exist and isinstance(track_count, int) and track_count > 0:
            cur.execute("""--sql
                INSERT INTO album_track_counts (album_id, disc_number, track_count)
                VALUES (%s, %s, %s)
            """, (album_id, disc_number, track_count))

        cur.execute("""--sql
            INSERT INTO album_tracks (album_id, song_id, disc_number, track_number)
            VALUES (%s, %s, %s, %s)
        """, (album_id, song_id, disc_number, track_number))

def insert_song_artists(connection: psycopg.Connection, record: dict[str, Any], song_id: int) -> list[int]:
    artist_apple_ids: list[str] = record.get('artist', [])
    artist_display_names: list[str] = record.get('artist_label', [])
    artist_raw_text: str = record.get('artist_primary 2512', '')
    song_title: str = record.get('name 2512', '')
    display_order = 1

    artist_ids = []
    combined_artists = list(itertools.zip_longest(artist_display_names, artist_apple_ids, fillvalue = ''))
    for artist_name, artist_apple_id in combined_artists:
        if not artist_name:
            continue

        artist_id = None

        # 1. Find ID by Apple Music artist ID:
        if artist_apple_id and artist_apple_id != '0':
            artist_id = get_artist_by_apple_id(connection, artist_apple_id)

        # 2. Find ID by artist title:
        if artist_id is None:
            artist_id = get_artist_by_name(connection, artist_name)

        # 3. Create new artist if still no match:
        if artist_id is None:
            artist_id = create_artist(connection, artist_name, artist_apple_id if (artist_apple_id and (artist_apple_id != '0')) else None)

        # 4. Determine display_title:
        display_title = None if is_artist_name_known(connection, artist_id, artist_name) else artist_name

        # 5. Infer artist role:
        role = infer_artist_role(artist_name, song_title, artist_raw_text)

        with connection.cursor() as cur:
            cur.execute("""--sql
                INSERT INTO song_artists (song_id, artist_id, display_order, display_title, role)
                VALUES (%s, %s, %s, %s, %s)
            """, (song_id, artist_id, display_order, display_title, role.value))
        
        display_order += 1
        artist_ids.append(artist_id)
    
    return artist_ids

def insert_song_data(connection: psycopg.Connection, record: dict[str, Any], source_id: int, entry_id: int) -> None:
    song_id = insert_verified_song(connection, record, entry_id)
    artist_ids = insert_song_artists(connection, record, song_id)

    locale: DBLocale = infer_title_primary_locale(connection, record, artist_ids)
    play_count_2504: int = record.get('play_count 2504', 0)
    play_count_2512: int = record.get('play_count 2512', 0)
    title: str = record.get('name 2512', '')

    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO song_play_counts (song_id, source_id, play_count, snapshot_date)
            VALUES (%s, %s, %s, %s)
        """, (song_id, source_id, play_count_2504, datetime.fromisoformat('2025-04-15T13:33:04Z')))

        cur.execute("""--sql
            INSERT INTO song_play_counts (song_id, source_id, play_count, snapshot_date)
            VALUES (%s, %s, %s, %s)
        """, (song_id, source_id, play_count_2512, datetime.fromisoformat('2025-12-26T09:01:12Z')))

        cur.execute("""--sql
            INSERT INTO song_titles (song_id, fallback, locale, normalized_title, title)
            VALUES (%s, %s, %s, %s, %s)
        """, (song_id, locale == DBLocale.ZH_HANT, DBLocale.ZH_HANT.value, normalize_title(title), title))
    
    insert_song_album(connection, record, song_id, locale)

def insert_verified_song(connection: psycopg.Connection, record: dict[str, Any], entry_id: int) -> int:
    apple_music_ids: list[str] = record.get('apple_music', [])
    duration: int = record.get('duration', 0)
    genre_tag: DBGenreTag = record.get('genre_tag', DBGenreTag.NONE)
    genre_info: DBGenreInfo = record.get('genre_info', DBGenreInfo.NONE)
    isrcs: list[str] = record.get('isrc', [])
    locale: DBLocale = record.get('locale', DBLocale.UND)
    media_tag: DBMediaTag = record.get('media_tag', DBMediaTag.NONE)
    release_date: datetime | None = record.get('release_date')
    vocal: DBVocal = record.get('vocal', DBVocal.UNKNOWN)

    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO songs (duration, genre_tag, genre_info, media_tag, release_date, vocal)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING song_id
        """, (duration, genre_tag.value, genre_info.value, media_tag.value, release_date, vocal.value))
        song_id = cur.fetchone()[0]     # type: ignore

        cur.execute("""--sql
            INSERT INTO entry_mapping (entry_id, song_id, confidence, match_method, status)
            VALUES (%s, %s, %s, %s, %s)
        """, (entry_id, song_id, 1., DBMethod.MANUAL.value, DBStatus.CONFIRMED.value))

        for apple_music_id in apple_music_ids:
            if apple_music_id != '0':
                cur.execute("""--sql
                    INSERT INTO song_authorities (song_id, authority, authority_code)
                    VALUES (%s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (song_id, DBAuthority.APPLE_MUSIC.value, apple_music_id))
        
        for isrc in isrcs:
            cur.execute("""--sql
                INSERT INTO song_authorities (song_id, authority, authority_code)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (song_id, DBAuthority.ISRC.value, isrc))

        cur.execute("""--sql
            INSERT INTO song_locales (song_id, is_primary, locale)
            VALUES (%s, %s, %s)
        """, (song_id, True, locale.value))

    return int(song_id)

def is_artist_name_known(connection: psycopg.Connection, artist_id: int, artist_name: str) -> bool:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT 1 FROM artist_titles WHERE artist_id = %s AND title = %s
            UNION
            SELECT 1 FROM artist_alias WHERE artist_id = %s AND alias = %s
        """, (artist_id, artist_name, artist_id, artist_name))
        return cur.fetchone() is not None

def register_source(connection: psycopg.Connection) -> int:
    export_date = datetime.strptime('2025-12-28 00:00:00', '%Y-%m-%d %H:%M:%S')
    import_date = datetime.now()
    source_file = r'data/.legacy/library.csv'
    source_type = DBAuthority.ITUNES.value

    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO sources (export_date, import_date, source_file, source_type)
            VALUES (%s, %s, %s, %s)
            RETURNING source_id
        """, (export_date, import_date, source_file, source_type))
        source_id = cur.fetchone()[0]   # type: ignore

    return int(source_id)

def main():
    parser = argparse.ArgumentParser(description = 'Migrate library.csv file to the new database.')
    parser.add_argument('--host', required = True, help = 'Host server address.')
    parser.add_argument('--dbname', required = True, help = 'The database name.')
    parser.add_argument('--user', required = True, help = 'The user name.')
    parser.add_argument('--password', required = True, help = 'The password of the user.')

    args = parser.parse_args()

    try:
        songs = LegacySongs.read(HERE / Path(r'..\..\data\.legacy\library.csv'))

        with psycopg.connect(
            host = args.host,
            dbname = args.dbname,
            user = args.user,
            password = args.password
        ) as conn:
            
            # 1. Register source metadata
            create(conn, SOURCES_TABLE)
            source_id = register_source(conn)

            # 2. Load entries
            entry_id_map = {}
            create(conn, ENTRIES_TABLE)
            for song in songs:
                legacy_id: int = song.get('legacy_id', 0)
                entry_id = insert_entry(conn, song, source_id)
                entry_id_map[legacy_id] = entry_id

            # 3. Fill verified entries
            create(conn, ARTISTS_TABLE) 
            create(conn, ARTIST_ALIAS_TABLE)
            create(conn, ARTIST_AUTHORITIES_TABLE)
            create(conn, ARTIST_RELATIONS_TABLE)
            create(conn, ARTIST_TITLES_TABLE)
            create(conn, SONGS_TABLE)
            create(conn, SONG_ARTISTS_TABLE)
            create(conn, SONG_AUTHORITIES_TABLE)
            create(conn, SONG_LOCALES_TABLE)
            create(conn, SONG_PLAY_COUNTS_TABLE)
            create(conn, SONG_TITLES_TABLE)
            create(conn, ALBUMS_TABLE)
            create(conn, ALBUM_ARTISTS_TABLE)
            create(conn, ALBUM_AUTHORITIES_TABLE)
            create(conn, ALBUM_TITLES_TABLE)
            create(conn, ALBUM_TRACK_COUNTS_TABLE)
            create(conn, ALBUM_TRACKS_TABLE)
            create(conn, ENTRY_MAPPING_TABLE)
            for song in songs:
                verified = song.get('verified')
                if verified:
                    legacy_id = song.get('legacy_id', 0)
                    insert_song_data(conn, song, source_id, entry_id_map[legacy_id])
            
            create(conn, ALBUM_OVERVIEW)
            create(conn, SONG_OVERVIEW)

    except Exception as ex:
        parser.error(str(ex))
        return 2
    
    return 0

if __name__ == '__main__':
    main()
