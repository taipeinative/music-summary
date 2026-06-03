from __future__ import annotations

import argparse
from collections.abc import Callable
import csv
from datetime import datetime
import itertools
import json
from pathlib import Path
from typing import Any
import re

from music_db.normalize import WHITELIST, parse_artists, normalize_artist, normalize_title
from music_db.query import get_artist_by_apple_id, get_artist_by_name
from music_db.schema import *
from music_db.typing import DBArtistTag, DBAuthority, DBGenreInfo, DBGenreTag, DBLocale, DBMediaTag, DBMethod, DBRole, DBStatus, DBVocal
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

def insert_song_data(connection: psycopg.Connection, record: dict[str, Any], entry_id: int) -> None:
    song_id = insert_verified_song(connection, record, entry_id)
    insert_song_artists(connection, record, song_id)

def insert_song_artists(connection: psycopg.Connection, record: dict[str, Any], song_id: int):
    artist_apple_ids: list[str] = record.get('artist', [])
    artist_display_names: list[str] = record.get('artist_label', [])
    artist_raw_text: str = record.get('artist_primary 2512', '')
    song_title: str = record.get('name 2512', '')
    display_order = 1

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

def insert_verified_song(connection: psycopg.Connection, record: dict[str, Any], entry_id: int) -> int:
    duration: int = record.get('duration', 0)
    genre_tag: DBGenreTag = record.get('genre_tag', DBGenreTag.NONE)
    genre_info: DBGenreInfo = record.get('genre_info', DBGenreInfo.NONE)
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

    return song_id

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
                    insert_song_data(conn, song, entry_id_map[legacy_id])

    except Exception as ex:
        parser.error(str(ex))
        return 2
    
    return 0

if __name__ == '__main__':
    main()
