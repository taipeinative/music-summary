from __future__ import annotations

import argparse
from collections.abc import Callable
import csv
from datetime import datetime
import json
from pathlib import Path
from typing import Any

from music_db.typing import DBAuthority, DBGenreInfo, DBGenreTag, DBLocale, DBMediaTag, DBMethod, DBStatus, DBVocal
import psycopg

HERE = Path(__file__).resolve().parent

ALBUMS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS albums
    (
        album_id serial NOT NULL,
        album_type smallint NOT NULL,
        artwork text,
        disc_count smallint,
        release_date date,
        PRIMARY KEY (album_id)
    );
"""

ALBUM_AUTHORITIES_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS album_authorities
    (
        album_id integer NOT NULL,
        authority smallint NOT NULL,
        authority_code text NOT NULL,
        UNIQUE (authority, authority_code),
        FOREIGN KEY (album_id) REFERENCES albums(album_id)
    );
"""

ALBUM_TITLES_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS album_titles
    (
        album_id integer NOT NULL,
        fallback boolean NOT NULL DEFAULT false,
        locale integer NOT NULL DEFAULT 1,
        title text NOT NULL,
        UNIQUE (album_id, locale),
        FOREIGN KEY (album_id) REFERENCES albums(album_id)
    );
"""

ALBUM_TRACKS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS album_tracks
    (
        album_id integer NOT NULL,
        song_id integer NOT NULL
        disc_number smallint NOT NULL,
        track_number integer NOT NULL,
        UNIQUE (album_id, disc_number, track_number),
        FOREIGN KEY (album_id) REFERENCES albums(album_id),
        FOREIGN KEY (song_id) REFERENCES songs(song_id)
    );
"""

ALBUM_TRACK_COUNTS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS album_track_counts
    (
        album_id integer NOT NULL,
        disc_number smallint NOT NULL
        track_count integer NOT NULL,
        UNIQUE (album_id, disc_number),
        FOREIGN KEY (album_id) REFERENCES albums(album_id)
    );
"""

ENTRIES_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS entries
    (
        entry_id serial NOT NULL,
        source_id integer NOT NULL,
        source_item_id integer NOT NULL,
        raw_album text NOT NULL,
        raw_artist text NOT NULL,
        raw_duration integer NOT NULL,
        raw_json json NOT NULL,
        raw_title text NOT NULL,
        PRIMARY KEY (entry_id),
        UNIQUE (source_id, siurce_item_id),
        FOREIGN KEY (source_id) REFERENCES sources(source_id)
    );
"""

ENTRY_MAPPING_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS entry_mapping
    (
        entry_id integer NOT NULL,
        song_id integer NOT NULL,
        confidence real NOT NULL,
        match_method smallint NOT NULL,
        status smallint NOT NULL,
        UNIQUE (entry_id, song_id),
        FOREIGN KEY (entry_id) REFERENCES entries(entry_id)
        FOREIGN KEY (song_id) REFERENCES songs(song_id)
    );
"""

SONGS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS songs
    (
        song_id serial NOT NULL,
        audio text,
        duration integer NOT NULL,
        genre_tag bigint NOT NULL,
        genre_info smallint NOT NULL,
        media_tag integer NOT NULL,
        release_date date,
        vocal smallint NOT NULL,
        PRIMARY KEY (song_id)
    );
"""

SONG_ARTISTS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS song_artists
    (
        song_id integer NOT NULL,
        artist_id integer NOT NULL,
        display_order smallint NOT NULL,
        display_title text,
        role smallint NOT NULL,
        FOREIGN KEY (artist_id) REFERENCES artists(artist_id)
        FOREIGN KEY (song_id) REFERENCES songs(song_id)
    );
"""

SONG_AUTHORITIES_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS song_authorities
    (
        song_id integer NOT NULL,
        authority smallint NOT NULL,
        authority_code text NOT NULL,
        UNIQUE (authority, authority_code),
        FOREIGN KEY (song_id) REFERENCES songs(song_id)
    );
"""

SONG_LOCALES = """--sql
    CREATE TABLE IF NOT EXISTS song_locales
    (
        song_id integer NOT NULL,
        is_primary boolean NOT NULL,
        locale integer,
        FOREIGN KEY (song_id) REFERENCES songs(song_id)
    );
"""

SONG_PLAY_COUNTS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS song_play_counts
    (
        song_id integer NOT NULL,
        source_id integer NOT NULL,
        play_count integer NOT NULL,
        snapshot_date date NOT NULL,
        UNIQUE (song_id, source_id, snapshot_date),
        FOREIGN KEY (song_id) REFERENCES songs(song_id),
        FOREIGN KEY (source_id) REFERENCES sources(source_id)
    );
"""

SONG_TITLES_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS song_titles
    (
        song_id integer NOT NULL,
        fallback boolean NOT NULL DEFAULT false,
        locale integer NOT NULL DEFAULT 1,
        title text NOT NULL,
        UNIQUE (song_id, locale),
        FOREIGN KEY (song_id) REFERENCES songs(song_id)
    );
"""

SOURCES_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS sources
    (
        source_id serial NOT NULL,
        export_date date,
        import_date date NOT NULL,
        source_file text NOT NULL,
        source_type smallint NOT NULL,
        PRIMARY KEY (source_id)
    );
"""

class LegacySongs:
    BOOL_COLUMNS = ['verified', 'library']
    DATE_COLUMNS = ['release_date', 'added_date', 'modified_date']
    INTEGER_COLUMNS = ['legacy_id', 'id 2504', 'id 2512', 'play_count 2504', 'play_count 2512', 'play_count_deducted', 'play_count_2025', 'disc_number', 'disc_count', 'track_number', 'track_count', 'duration']
    STRING_COLUMNS = ['name 2504', 'name 2512', 'artist', 'artist_label', 'artist_primary 2504', 'artist_primary 2512', 'album 2504', 'album 2512', 'vocal', 'locale', 'genre', 'genre_alt', 'genre_tag', 'apple_music', 'isrc', 'album_artwork']
    WHITELIST = ['接個吻,開一槍', '接个吻,开一枪', 'Angels & Airwaves', 'Jack & Jack', 'Jonathan & Friends', 'Matisse & Sadko', 'Vargas & Lagola']

    @staticmethod
    def _apply(source: dict, keys: list[str], func: Callable[..., Any], nullable: bool = False) -> None:
        for key in keys:
            if isinstance(source.get(key), str) or nullable:
                try:
                    if source[key] == '':
                        source[key] = None
                    else:
                        source[key] = func(source[key])
                except:
                    raise ValueError(f'Can\'t apply func to `{source[key]}` in column `{key}`.')
            else:
                raise ValueError(f'Can\'t find the column `{key}`.')

    @staticmethod
    def _format(row: dict[str, str]) -> dict[str, Any]:
        def to_iso_date(input: str) -> datetime | None:
            if input == '':
                return None
            try:
                parsed = datetime.strptime(input, '%Y-%m-%d %H:%M:%S')
                return parsed
            except:
                raise ValueError()

        def to_nullable_string(input: str) -> str | None:
            if input == '':
                return None
            return input

        result: dict[str, Any] = row.copy()
        LegacySongs._apply(result, LegacySongs.BOOL_COLUMNS, bool)
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
            
        def to_comma_separated_list(input: str | None) -> list[str]:
            if input is None:
                return []
            
            protected = {}
            for i in range(len(whitelist)):
                candidate = whitelist[i]
                if candidate in input:
                    key = f'--PROTECTED-KEYWORD-{i}--'
                    protected[key] = candidate
                    input = input.replace(candidate, key)
            
            parts = input.split(',')
            result = []
            for part in parts:
                part = part.strip()
                if part in protected:
                    result.append(protected[part])
                elif part:
                    result.append(part)
            return result

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
        
        LegacySongs._apply(row, ['album_artwork'], to_apple_music_artwork_url, nullable = True)
        LegacySongs._apply(row, ['artist', 'artist_label', 'genre_tag', 'apple_music', 'isrc'], to_comma_separated_list, nullable = True)

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
                result = LegacySongs._post_format(result, whitelist if whitelist is not None else LegacySongs.WHITELIST)
                results.append(result)
        
        return results