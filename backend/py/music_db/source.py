from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
import json
from pathlib import Path
import plistlib
import re
from typing import Any, TypeVar

from music_db.normalize import normalize_artist, normalize_title
from music_db.raw import determine_raw_names
from music_db.schema import *
from music_db.typing import *
import psycopg
from psycopg.types.json import Json, Jsonb

GENERIC = TypeVar('GENERIC')
GENERIC_ENUM = TypeVar('GENERIC_ENUM', bound = Enum)
HERE = Path().absolute()
ROOT = next((p.parent for p in (HERE, *HERE.parents) if p.name == 'backend'), HERE)

def _create_dataframe():
    import pandas as pd
    return pd.DataFrame()

class DBJSONSource:
    '''
    Read the JSON format exported from Library Manager and write it to DB tables.
    '''

    @staticmethod
    def _as_datetime(obj: object, field: str, nullable: bool = False) -> datetime | None:
        if obj is None and nullable:
            return None
        if isinstance(obj, datetime):
            return obj
        if not isinstance(obj, str):
            raise TypeError(f'{field} must be a datetime string.')

        value = obj.strip()
        for format in ('%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
            try:
                return datetime.strptime(value, format)
            except ValueError:
                continue

        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            raise ValueError(f'{field} is not a valid datetime string.')

    @staticmethod
    def _as_date(obj: object, field: str, nullable: bool = False) -> date | None:
        value = DBJSONSource._as_datetime(obj, field, nullable = nullable)
        if value is None:
            return None
        return value.date()

    @staticmethod
    def _as_enum(obj: object, expected: type[GENERIC_ENUM], field: str) -> GENERIC_ENUM:
        if isinstance(obj, expected):
            return obj
        if isinstance(obj, str):
            name = obj.strip().upper().replace('-', '_').replace(' ', '_')
            try:
                return expected[name]
            except KeyError:
                raise ValueError(f'{field} has invalid enum name {obj!r}.')
        if isinstance(obj, int):
            try:
                return expected(obj)
            except ValueError:
                raise ValueError(f'{field} has invalid enum value {obj}.')
        raise TypeError(f'{field} must be an enum name or value.')

    @staticmethod
    def _as_flag(obj: object, expected: type[GENERIC], field: str) -> GENERIC:
        if isinstance(obj, expected):
            return obj
        if isinstance(obj, int):
            return expected(obj)
        if isinstance(obj, str):
            text = obj.strip()
            if text == '':
                return expected(0)
            if text.isdecimal():
                return expected(int(text))
            result = expected(0)
            for name in [part.strip().upper().replace('-', '_').replace(' ', '_') for part in text.split(',')]:
                if not name or name == 'NONE':
                    continue
                try:
                    result |= expected[name]
                except KeyError:
                    raise ValueError(f'{field} has invalid flag name {name!r}.')
            return result
        if isinstance(obj, list):
            result = expected(0)
            for index, item in enumerate(obj):
                result |= DBJSONSource._as_flag(item, expected, f'{field}[{index}]')
            return result
        raise TypeError(f'{field} must be a flag name, list, or value.')

    @staticmethod
    def _as_id(obj: object, field: str) -> int:
        if isinstance(obj, bool):
            raise TypeError(f'{field} must be an integer.')
        if isinstance(obj, int):
            value = obj
        elif isinstance(obj, str) and obj.strip().isdecimal():
            value = int(obj.strip())
        else:
            raise TypeError(f'{field} must be an integer.')
        if value <= 0:
            raise ValueError(f'{field} must be positive.')
        return value

    @staticmethod
    def _as_locale(obj: object, field: str) -> DBLocale:
        if isinstance(obj, DBLocale):
            return obj
        if isinstance(obj, int):
            return DBLocale(obj)
        if not isinstance(obj, str):
            raise TypeError(f'{field} must be a locale.')

        value = obj.strip()
        enum_name = value.upper().replace('-', '_')
        if enum_name in DBLocale.__members__:
            return DBLocale[enum_name]
        return DBLocale.get_locale(value.lower())

    @staticmethod
    def _as_string(obj: object, field: str, nullable: bool = False) -> str | None:
        if obj is None and nullable:
            return None
        if not isinstance(obj, str):
            raise TypeError(f'{field} must be a string.')
        value = obj.strip()
        if not value and not nullable:
            raise ValueError(f'{field} cannot be empty.')
        return value or None

    @staticmethod
    def _as_list(obj: object, field: str) -> list:
        if not isinstance(obj, list):
            raise TypeError(f'{field} must be a list.')
        return obj

    @staticmethod
    def _as_title_map(obj: object, field: str) -> list[dict[str, object]]:
        if not isinstance(obj, dict):
            raise TypeError(f'{field} must be an object.')

        rows: list[dict[str, object]] = []
        for locale_key, value in obj.items():
            if isinstance(value, dict):
                text = DBJSONSource._as_string(value.get('text'), f'{field}.{locale_key}.text')
                fallback = bool(value.get('primary', False))
            else:
                text = DBJSONSource._as_string(value, f'{field}.{locale_key}')
                fallback = False
            rows.append({
                'locale': DBJSONSource._as_locale(locale_key, f'{field}.{locale_key}'),
                'title': text,
                'fallback': fallback
            })

        if not rows:
            raise ValueError(f'{field} must contain at least one title.')
        if sum(1 for row in rows if row['fallback']) != 1:
            raise ValueError(f'{field} must contain exactly one fallback title.')
        return rows

    @staticmethod
    def _as_authorities(obj: object, field: str) -> list[dict[str, object]]:
        rows = []
        for index, item in enumerate(DBJSONSource._as_list(obj or [], field)):
            if not isinstance(item, dict):
                raise TypeError(f'{field}[{index}] must be an object.')
            rows.append({
                'authority': DBJSONSource._as_enum(item.get('type'), DBAuthority, f'{field}[{index}].type'),
                'code': DBJSONSource._as_string(item.get('code'), f'{field}[{index}].code')
            })
        return sorted(rows, key = lambda row: (row['authority'].value, row['code']))

    @staticmethod
    def _json_ready(obj: object) -> object:
        if isinstance(obj, Enum):
            return obj.name
        if isinstance(obj, date | datetime):
            return obj.isoformat()
        if isinstance(obj, dict):
            return {key: DBJSONSource._json_ready(value) for key, value in obj.items()}
        if isinstance(obj, list):
            return [DBJSONSource._json_ready(value) for value in obj]
        return obj

    @staticmethod
    def _log(cur: psycopg.Cursor, table_name: str, row_pk: dict[str, object], operation: str, old_data: object, new_data: object, reason: str) -> None:
        cur.execute("""--sql
            INSERT INTO change_log (table_name, row_pk, operation, old_data, new_data, changed_by, reason)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            table_name,
            Jsonb(DBJSONSource._json_ready(row_pk)),
            operation,
            Jsonb(DBJSONSource._json_ready(old_data)) if old_data is not None else None,
            Jsonb(DBJSONSource._json_ready(new_data)) if new_data is not None else None,
            'DBJSONSource',
            reason
        ))

    @staticmethod
    def _sync_sequence(cur: psycopg.Cursor, table_name: str, column_name: str) -> None:
        if (table_name, column_name) not in {('artists', 'artist_id'), ('albums', 'album_id'), ('songs', 'song_id')}:
            raise ValueError('Unexpected sequence target.')
        cur.execute(f"""--sql
            SELECT setval(
                pg_get_serial_sequence('{table_name}', '{column_name}'),
                COALESCE((SELECT MAX({column_name}) FROM {table_name}), 1),
                true
            )
        """)

    @staticmethod
    def _fetch_exists(cur: psycopg.Cursor, table_name: str, column_name: str, value: int) -> bool:
        if (table_name, column_name) not in {('artists', 'artist_id'), ('albums', 'album_id'), ('songs', 'song_id')}:
            raise ValueError('Unexpected lookup target.')
        cur.execute(f'SELECT 1 FROM {table_name} WHERE {column_name} = %s', (value, ))
        return cur.fetchone() is not None

    @staticmethod
    def _replace_rows(cur: psycopg.Cursor, table_name: str, owner_column: str, owner_id: int, rows: list[dict[str, object]], insert_sql: str, insert_params, reason: str) -> None:
        if (table_name, owner_column) not in {
            ('artist_titles', 'artist_id'), ('artist_alias', 'artist_id'), ('artist_authorities', 'artist_id'),
            ('artist_relations', 'artist_id'), ('album_titles', 'album_id'), ('album_artists', 'album_id'),
            ('album_authorities', 'album_id'), ('album_track_counts', 'album_id'), ('song_titles', 'song_id'),
            ('song_locales', 'song_id'), ('song_artists', 'song_id'), ('song_authorities', 'song_id'), ('album_tracks', 'song_id')
        }:
            raise ValueError('Unexpected replace target.')

        cur.execute(f'SELECT to_jsonb(t) FROM {table_name} t WHERE {owner_column} = %s', (owner_id, ))
        for old_row, in cur.fetchall():
            DBJSONSource._log(cur, table_name, {owner_column: owner_id}, 'DELETE', old_row, None, reason)

        cur.execute(f'DELETE FROM {table_name} WHERE {owner_column} = %s', (owner_id, ))
        for row in rows:
            cur.execute(insert_sql, insert_params(row))
            DBJSONSource._log(cur, table_name, {owner_column: owner_id}, 'INSERT', None, row, reason)

    @staticmethod
    def _upsert_artist(cur: psycopg.Cursor, artist: dict[str, object], reason: str) -> None:
        artist_id = artist['id']
        new_data = {
            'artist_id': artist_id,
            'artist_tag': artist['artistTag'].value,
            'artwork': artist['artwork']
        }
        cur.execute('SELECT artist_id, artist_tag, artwork FROM artists WHERE artist_id = %s', (artist_id, ))
        old_row = cur.fetchone()
        if old_row is None:
            cur.execute("""--sql
                INSERT INTO artists (artist_id, artist_tag, artwork)
                VALUES (%s, %s, %s)
            """, (artist_id, artist['artistTag'].value, artist['artwork']))
            DBJSONSource._log(cur, 'artists', {'artist_id': artist_id}, 'INSERT', None, new_data, reason)
        else:
            old_data = {'artist_id': old_row[0], 'artist_tag': old_row[1], 'artwork': old_row[2]}
            if old_data != new_data:
                cur.execute("""--sql
                    UPDATE artists
                    SET artist_tag = %s, artwork = %s, updated_at = now()
                    WHERE artist_id = %s
                """, (artist['artistTag'].value, artist['artwork'], artist_id))
                DBJSONSource._log(cur, 'artists', {'artist_id': artist_id}, 'UPDATE', old_data, new_data, reason)

        DBJSONSource._replace_rows(
            cur, 'artist_titles', 'artist_id', artist_id, artist['title'],
            """--sql
                INSERT INTO artist_titles (artist_id, fallback, locale, normalized_title, title)
                VALUES (%s, %s, %s, %s, %s)
            """,
            lambda row: (artist_id, row['fallback'], row['locale'].value, normalize_artist(row['title']), row['title']),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'artist_alias', 'artist_id', artist_id, artist['alias'],
            """--sql
                INSERT INTO artist_alias (artist_id, alias, normalized_alias)
                VALUES (%s, %s, %s)
            """,
            lambda row: (artist_id, row['alias'], normalize_artist(row['alias'])),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'artist_authorities', 'artist_id', artist_id, artist['authority'],
            """--sql
                INSERT INTO artist_authorities (artist_id, authority, authority_code)
                VALUES (%s, %s, %s)
            """,
            lambda row: (artist_id, row['authority'].value, row['code']),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'artist_relations', 'artist_id', artist_id, artist['relations'],
            """--sql
                INSERT INTO artist_relations (artist_id, ref_artist_id, relation_to_ref)
                VALUES (%s, %s, %s)
            """,
            lambda row: (artist_id, row['ref'], row['role'].value),
            reason
        )

    @staticmethod
    def _upsert_album(cur: psycopg.Cursor, album: dict[str, object], reason: str) -> None:
        album_id = album['id']
        new_data = {
            'album_id': album_id,
            'album_type': album['albumType'].value,
            'artwork': album['artwork'],
            'disc_count': album['discCount'],
            'release_date': album['releaseDate']
        }
        cur.execute('SELECT album_id, album_type, artwork, disc_count, release_date FROM albums WHERE album_id = %s', (album_id, ))
        old_row = cur.fetchone()
        if old_row is None:
            cur.execute("""--sql
                INSERT INTO albums (album_id, album_type, artwork, disc_count, release_date)
                VALUES (%s, %s, %s, %s, %s)
            """, (album_id, album['albumType'].value, album['artwork'], album['discCount'], album['releaseDate']))
            DBJSONSource._log(cur, 'albums', {'album_id': album_id}, 'INSERT', None, new_data, reason)
        else:
            old_data = {'album_id': old_row[0], 'album_type': old_row[1], 'artwork': old_row[2], 'disc_count': old_row[3], 'release_date': old_row[4]}
            if old_data != new_data:
                cur.execute("""--sql
                    UPDATE albums
                    SET album_type = %s, artwork = %s, disc_count = %s, release_date = %s, updated_at = now()
                    WHERE album_id = %s
                """, (album['albumType'].value, album['artwork'], album['discCount'], album['releaseDate'], album_id))
                DBJSONSource._log(cur, 'albums', {'album_id': album_id}, 'UPDATE', old_data, new_data, reason)

        DBJSONSource._replace_rows(
            cur, 'album_titles', 'album_id', album_id, album['title'],
            """--sql
                INSERT INTO album_titles (album_id, fallback, locale, normalized_title, title)
                VALUES (%s, %s, %s, %s, %s)
            """,
            lambda row: (album_id, row['fallback'], row['locale'].value, normalize_title(row['title']), row['title']),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'album_artists', 'album_id', album_id, album['artists'],
            """--sql
                INSERT INTO album_artists (album_id, artist_id, display_order)
                VALUES (%s, %s, %s)
            """,
            lambda row: (album_id, row['artist_id'], row['display_order']),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'album_track_counts', 'album_id', album_id, album['trackCounts'],
            """--sql
                INSERT INTO album_track_counts (album_id, disc_number, track_count)
                VALUES (%s, %s, %s)
            """,
            lambda row: (album_id, row['disc'], row['trackCount']),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'album_authorities', 'album_id', album_id, album['authority'],
            """--sql
                INSERT INTO album_authorities (album_id, authority, authority_code)
                VALUES (%s, %s, %s)
            """,
            lambda row: (album_id, row['authority'].value, row['code']),
            reason
        )

    @staticmethod
    def _upsert_song(cur: psycopg.Cursor, song: dict[str, object], reason: str) -> int:
        song_id = song.get('id')
        new_data = {
            'audio': song['audio'],
            'duration': song['duration'],
            'genre_tag': song['genreTag'].value,
            'genre_info': song['genreInfo'].value,
            'media_tag': song['mediaTag'].value,
            'release_date': song['releaseDate'],
            'vocal': song['vocal'].value
        }

        old_row = None
        if song_id is not None:
            cur.execute('SELECT song_id, audio, duration, genre_tag, genre_info, media_tag, release_date, vocal FROM songs WHERE song_id = %s', (song_id, ))
            old_row = cur.fetchone()

        if old_row is None:
            if song_id is None:
                cur.execute("""--sql
                    INSERT INTO songs (audio, duration, genre_tag, genre_info, media_tag, release_date, vocal)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING song_id
                """, (song['audio'], song['duration'], song['genreTag'].value, song['genreInfo'].value, song['mediaTag'].value, song['releaseDate'], song['vocal'].value))
                song_id = cur.fetchone()[0]
            else:
                cur.execute("""--sql
                    INSERT INTO songs (song_id, audio, duration, genre_tag, genre_info, media_tag, release_date, vocal)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (song_id, song['audio'], song['duration'], song['genreTag'].value, song['genreInfo'].value, song['mediaTag'].value, song['releaseDate'], song['vocal'].value))
            DBJSONSource._log(cur, 'songs', {'song_id': song_id}, 'INSERT', None, {'song_id': song_id, **new_data}, reason)
        else:
            old_data = {
                'song_id': old_row[0], 'audio': old_row[1], 'duration': old_row[2], 'genre_tag': old_row[3],
                'genre_info': old_row[4], 'media_tag': old_row[5], 'release_date': old_row[6], 'vocal': old_row[7]
            }
            if old_data != {'song_id': song_id, **new_data}:
                cur.execute("""--sql
                    UPDATE songs
                    SET audio = %s, duration = %s, genre_tag = %s, genre_info = %s, media_tag = %s, release_date = %s, vocal = %s, updated_at = now()
                    WHERE song_id = %s
                """, (song['audio'], song['duration'], song['genreTag'].value, song['genreInfo'].value, song['mediaTag'].value, song['releaseDate'], song['vocal'].value, song_id))
                DBJSONSource._log(cur, 'songs', {'song_id': song_id}, 'UPDATE', old_data, {'song_id': song_id, **new_data}, reason)

        DBJSONSource._replace_rows(
            cur, 'song_titles', 'song_id', song_id, song['title'],
            """--sql
                INSERT INTO song_titles (song_id, fallback, locale, normalized_title, title)
                VALUES (%s, %s, %s, %s, %s)
            """,
            lambda row: (song_id, row['fallback'], row['locale'].value, normalize_title(row['title']), row['title']),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'song_artists', 'song_id', song_id, song['artists'],
            """--sql
                INSERT INTO song_artists (song_id, artist_id, display_order, display_title, role)
                VALUES (%s, %s, %s, %s, %s)
            """,
            lambda row: (song_id, row['artist_id'], row['display_order'], row['displayTitle'], row['role'].value),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'song_locales', 'song_id', song_id, song['locale'],
            """--sql
                INSERT INTO song_locales (song_id, is_primary, locale)
                VALUES (%s, %s, %s)
            """,
            lambda row: (song_id, row['primary'], row['locale'].value),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'song_authorities', 'song_id', song_id, song['authority'],
            """--sql
                INSERT INTO song_authorities (song_id, authority, authority_code)
                VALUES (%s, %s, %s)
            """,
            lambda row: (song_id, row['authority'].value, row['code']),
            reason
        )
        DBJSONSource._replace_rows(
            cur, 'album_tracks', 'song_id', song_id, song['albums'],
            """--sql
                INSERT INTO album_tracks (album_id, song_id, disc_number, track_number)
                VALUES (%s, %s, %s, %s)
            """,
            lambda row: (row['album_id'], song_id, row['disc'], row['track']),
            reason
        )
        return song_id

    @staticmethod
    def validate(path: str | Path | dict[str, Any]) -> dict[str, Any]:
        if isinstance(path, dict):
            raw = path
            source_path: Path | None = None
        else:
            source_path = Path(path)
            with source_path.open('r', encoding = 'utf-8') as f:
                raw = json.load(f)

        if not isinstance(raw, dict):
            raise TypeError('The DB JSON source must be an object.')
        if raw.get('source') != 'CLIPBOARD':
            raise ValueError('DBJSONSource only accepts source = CLIPBOARD.')

        artists = []
        for index, item in enumerate(DBJSONSource._as_list(raw.get('artists'), 'artists')):
            if not isinstance(item, dict):
                raise TypeError(f'artists[{index}] must be an object.')
            artist_id = DBJSONSource._as_id(item.get('id'), f'artists[{index}].id')
            artists.append({
                'id': artist_id,
                'title': DBJSONSource._as_title_map(item.get('title'), f'artists[{index}].title'),
                'alias': [{'alias': DBJSONSource._as_string(alias, f'artists[{index}].alias')} for alias in DBJSONSource._as_list(item.get('alias', []), f'artists[{index}].alias')],
                'artistTag': DBJSONSource._as_flag(item.get('artistTag', 'NONE'), DBArtistTag, f'artists[{index}].artistTag'),
                'artwork': DBJSONSource._as_string(item.get('artwork'), f'artists[{index}].artwork', nullable = True),
                'authority': DBJSONSource._as_authorities(item.get('authority', []), f'artists[{index}].authority'),
                'relations': [{
                    'ref': DBJSONSource._as_id(relation.get('ref'), f'artists[{index}].relations[{relation_index}].ref'),
                    'role': DBJSONSource._as_enum(relation.get('role'), DBRelation, f'artists[{index}].relations[{relation_index}].role')
                } for relation_index, relation in enumerate(DBJSONSource._as_list(item.get('relations', []), f'artists[{index}].relations')) if isinstance(relation, dict)]
            })

        albums = []
        for index, item in enumerate(DBJSONSource._as_list(raw.get('albums'), 'albums')):
            if not isinstance(item, dict):
                raise TypeError(f'albums[{index}] must be an object.')
            albums.append({
                'id': DBJSONSource._as_id(item.get('id'), f'albums[{index}].id'),
                'title': DBJSONSource._as_title_map(item.get('title'), f'albums[{index}].title'),
                'artists': [{'artist_id': DBJSONSource._as_id(artist_id, f'albums[{index}].artists'), 'display_order': display_order} for display_order, artist_id in enumerate(DBJSONSource._as_list(item.get('artists'), f'albums[{index}].artists'))],
                'albumType': DBJSONSource._as_enum(item.get('albumType', 'ALBUM'), DBAlbum, f'albums[{index}].albumType'),
                'releaseDate': DBJSONSource._as_date(item.get('releaseDate'), f'albums[{index}].releaseDate', nullable = True),
                'artwork': DBJSONSource._as_string(item.get('artwork'), f'albums[{index}].artwork', nullable = True),
                'discCount': item.get('discCount'),
                'trackCounts': [{
                    'disc': DBJSONSource._as_id(track_count.get('disc'), f'albums[{index}].trackCounts[{track_index}].disc'),
                    'trackCount': DBJSONSource._as_id(track_count.get('trackCount'), f'albums[{index}].trackCounts[{track_index}].trackCount')
                } for track_index, track_count in enumerate(DBJSONSource._as_list(item.get('trackCounts', []), f'albums[{index}].trackCounts')) if isinstance(track_count, dict)],
                'authority': DBJSONSource._as_authorities(item.get('authority', []), f'albums[{index}].authority')
            })
            if albums[-1]['discCount'] is not None:
                albums[-1]['discCount'] = DBJSONSource._as_id(albums[-1]['discCount'], f'albums[{index}].discCount')

        songs = []
        for index, item in enumerate(DBJSONSource._as_list(raw.get('songs'), 'songs')):
            if not isinstance(item, dict):
                raise TypeError(f'songs[{index}] must be an object.')
            locales = [{
                'locale': DBJSONSource._as_locale(locale.get('locale'), f'songs[{index}].locale[{locale_index}].locale'),
                'primary': bool(locale.get('primary', False))
            } for locale_index, locale in enumerate(DBJSONSource._as_list(item.get('locale', []), f'songs[{index}].locale')) if isinstance(locale, dict)]
            if not locales:
                raise ValueError(f'songs[{index}].locale must contain at least one locale.')
            if sum(1 for locale in locales if locale['primary']) != 1:
                raise ValueError(f'songs[{index}].locale must contain exactly one primary locale.')

            songs.append({
                'id': DBJSONSource._as_id(item.get('id'), f'songs[{index}].id') if item.get('id') is not None else None,
                'title': DBJSONSource._as_title_map(item.get('title'), f'songs[{index}].title'),
                'artists': [{
                    'artist_id': DBJSONSource._as_id(artist.get('id'), f'songs[{index}].artists[{artist_index}].id'),
                    'display_order': artist_index,
                    'displayTitle': DBJSONSource._as_string(artist.get('displayTitle'), f'songs[{index}].artists[{artist_index}].displayTitle', nullable = True),
                    'role': DBJSONSource._as_enum(artist.get('role', 'MAIN'), DBRole, f'songs[{index}].artists[{artist_index}].role')
                } for artist_index, artist in enumerate(DBJSONSource._as_list(item.get('artists'), f'songs[{index}].artists')) if isinstance(artist, dict)],
                'albums': [{
                    'album_id': DBJSONSource._as_id(album.get('id'), f'songs[{index}].albums[{album_index}].id'),
                    'disc': DBJSONSource._as_id(album.get('disc'), f'songs[{index}].albums[{album_index}].disc'),
                    'track': DBJSONSource._as_id(album.get('track'), f'songs[{index}].albums[{album_index}].track')
                } for album_index, album in enumerate(DBJSONSource._as_list(item.get('albums', []), f'songs[{index}].albums')) if isinstance(album, dict)],
                'audio': DBJSONSource._as_string(item.get('audio'), f'songs[{index}].audio', nullable = True),
                'vocal': DBJSONSource._as_enum(item.get('vocal', 'UNKNOWN'), DBVocal, f'songs[{index}].vocal'),
                'locale': locales,
                'genreTag': DBJSONSource._as_flag(item.get('genreTag', 'NONE'), DBGenreTag, f'songs[{index}].genreTag'),
                'genreInfo': DBJSONSource._as_enum(item.get('genreInfo', 'NONE'), DBGenreInfo, f'songs[{index}].genreInfo'),
                'mediaTag': DBJSONSource._as_flag(item.get('mediaTag', 'NONE'), DBMediaTag, f'songs[{index}].mediaTag'),
                'duration': DBJSONSource._as_id(item.get('duration'), f'songs[{index}].duration'),
                'releaseDate': DBJSONSource._as_date(item.get('releaseDate'), f'songs[{index}].releaseDate', nullable = True),
                'authority': DBJSONSource._as_authorities(item.get('authority', []), f'songs[{index}].authority')
            })

        return {
            '_validated': True,
            'source': 'CLIPBOARD',
            'time': DBJSONSource._as_datetime(raw.get('time'), 'time'),
            'path': source_path,
            'artists': artists,
            'albums': albums,
            'songs': songs
        }

    @staticmethod
    def load(connection: psycopg.Connection, json_source: dict[str, Any]) -> None:
        if not json_source.get('_validated'):
            json_source = DBJSONSource.validate(json_source)

        for table in (
            ARTISTS_TABLE, ARTIST_TITLES_TABLE, ARTIST_ALIAS_TABLE, ARTIST_AUTHORITIES_TABLE, ARTIST_RELATIONS_TABLE,
            ALBUMS_TABLE, ALBUM_TITLES_TABLE, ALBUM_ARTISTS_TABLE, ALBUM_AUTHORITIES_TABLE, ALBUM_TRACK_COUNTS_TABLE,
            SONGS_TABLE, SONG_TITLES_TABLE, SONG_ARTISTS_TABLE, SONG_LOCALES_TABLE, SONG_AUTHORITIES_TABLE, ALBUM_TRACKS_TABLE,
            CHANGE_LOG_TABLE
        ):
            create(connection, table)

        reason = 'DBJSONSource CLIPBOARD import'
        artist_ids = {artist['id'] for artist in json_source['artists']}
        album_ids = {album['id'] for album in json_source['albums']}

        with connection.transaction():
            with connection.cursor() as cur:
                for artist in json_source['artists']:
                    for relation in artist['relations']:
                        if relation['ref'] not in artist_ids and not DBJSONSource._fetch_exists(cur, 'artists', 'artist_id', relation['ref']):
                            raise ValueError(f'Artist {artist["id"]} references missing artist {relation["ref"]}.')
                    DBJSONSource._upsert_artist(cur, artist, reason)

                for album in json_source['albums']:
                    for artist in album['artists']:
                        if artist['artist_id'] not in artist_ids and not DBJSONSource._fetch_exists(cur, 'artists', 'artist_id', artist['artist_id']):
                            raise ValueError(f'Album {album["id"]} references missing artist {artist["artist_id"]}.')
                    DBJSONSource._upsert_album(cur, album, reason)

                for song in json_source['songs']:
                    for artist in song['artists']:
                        if artist['artist_id'] not in artist_ids and not DBJSONSource._fetch_exists(cur, 'artists', 'artist_id', artist['artist_id']):
                            raise ValueError(f'Song references missing artist {artist["artist_id"]}.')
                    for album in song['albums']:
                        if album['album_id'] not in album_ids and not DBJSONSource._fetch_exists(cur, 'albums', 'album_id', album['album_id']):
                            raise ValueError(f'Song references missing album {album["album_id"]}.')
                    DBJSONSource._upsert_song(cur, song, reason)

                DBJSONSource._sync_sequence(cur, 'artists', 'artist_id')
                DBJSONSource._sync_sequence(cur, 'albums', 'album_id')
                DBJSONSource._sync_sequence(cur, 'songs', 'song_id')

class JSONSource:
    '''
    Read the JSON file created by `web.py`.
    '''

    @staticmethod
    def load(connection: psycopg.Connection, json_source: dict[str, datetime | DBAuthority | list[dict[str, Any]] | list[str] | Path]) -> None:
        def _issue_spec(reason: IssueReason, source_section: str, json_path: str, details: dict[str, Any]) -> dict[str, Any]:
            return {
                'reason': reason,
                'source_section': source_section,
                'json_path': json_path,
                'details': details
            }

        def _localized_display_name(names: object) -> str | None:
            if isinstance(names, str):
                return names

            if not isinstance(names, dict):
                return None

            various_names = {'Various Artists', 'Multi-interprètes', 'ヴァリアス・アーティスト', '다수의 아티스트', '群星'}
            for name in names.values():
                if isinstance(name, str) and name in various_names:
                    return name

            for locale in ('en', 'zt', 'zs', 'ja', 'ko', 'fr'):
                name = names.get(locale)
                if isinstance(name, str) and name:
                    return name

            for name in names.values():
                if isinstance(name, str) and name:
                    return name

            return None

        def _extract_entry(index: int, song: dict[str, Any], artists: dict[str, tuple[int, dict[str, Any]]], albums: dict[str, tuple[int, dict[str, Any]]], various_artists: list[str]) -> tuple[dict[str, list[dict]], list[dict[str, Any]]]:
            issues: list[dict[str, Any]] = []
            valid_artists: list[dict] = []
            valid_artist_ids: set[str] = set()

            def _append_artist(artist: dict[str, Any]) -> None:
                artist_id = artist['id']
                if artist_id in valid_artist_ids:
                    return
                valid_artists.append(artist)
                valid_artist_ids.add(artist_id)

            mentioned_album = song['albumID']
            album = albums.get(mentioned_album)
            if not album:
                issues.append(
                    _issue_spec(
                        IssueReason.REFERENCED_ALBUM_MISSING,
                        'songs',
                        f'$.songs[{index}].albumID',
                        {
                            'referenced_album_id': mentioned_album,
                            'reference_field': 'albumID',
                            'referencing_collection': 'songs',
                            'referencing_item_id': song['id'],
                            'reference_context': 'song_album'
                        }
                    )
                )

            else:
                album_artists = album[1]['artistID']
                for i, mentioned_artist in enumerate(album_artists):
                    artist = artists.get(mentioned_artist)
                    if not artist:
                        issues.append(
                            _issue_spec(
                                IssueReason.REFERENCED_ARTIST_MISSING,
                                'albums',
                                f'$.albums[{album[0]}].artistID[{i}]',
                                {
                                    'referenced_artist_id': mentioned_artist,
                                    'reference_field': 'artistID',
                                    'referencing_collection': 'albums',
                                    'referencing_item_id': album[1]['id'],
                                    'reference_context': 'album_artist',
                                    'compilation': album[1]['compilation'],
                                    'display_name': _localized_display_name(album[1]['artistDisplayNames']),
                                    'page_url': None,
                                    'suspected_various_artists': mentioned_artist in various_artists
                                }
                            )
                        )

                    else:
                        _append_artist(artist[1])

            for i, mentioned_artist in enumerate(song['artistID']):
                artist = artists.get(mentioned_artist)
                if not artist:
                    issues.append(
                        _issue_spec(
                            IssueReason.REFERENCED_ARTIST_MISSING,
                            'songs',
                            f'$.songs[{index}].artistID[{i}]',
                            {
                                'referenced_artist_id': mentioned_artist,
                                'reference_field': 'artistID',
                                'referencing_collection': 'songs',
                                'referencing_item_id': song['id'],
                                'reference_context': 'song_artist',
                                'compilation': False,
                                'display_name': None,
                                'page_url': None,
                                'suspected_various_artists': mentioned_artist in various_artists
                            }
                        )
                    )

                else:
                    _append_artist(artist[1])

            return (
                {
                    'artists': valid_artists,
                    'albums': [album[1]] if album else [],
                    'songs': [song]
                },
                issues
            )

        # Create tables
        create(connection, SOURCES_TABLE)
        create(connection, ENTRIES_TABLE)
        create(connection, SONGS_TABLE)
        create(connection, ENTRY_ISSUES_TABLE)

        with connection.transaction():
            with connection.cursor() as cur:

                # Register source
                export_date = json_source['time']
                import_date = datetime.now()
                source_file = str(json_source['path'])
                source_type = json_source['source'].value   # type: ignore

                cur.execute("""--sql
                    SELECT source_id
                    FROM sources
                    WHERE source_file = %s
                """, (source_file, ))
                if cur.fetchone() is not None:
                    return

                cur.execute("""--sql
                    INSERT INTO sources (export_date, import_date, source_file, source_type)
                    VALUES (%s, %s, %s, %s)
                    RETURNING source_id
                """, (export_date, import_date, source_file, source_type))
                source_id = cur.fetchone()[0]   # type: ignore

                # Append entries
                artists = {artist['id']: (i, artist) for i, artist in enumerate(json_source['artists'])}    # type: ignore
                albums = {album['id']: (i, album) for i, album in enumerate(json_source['albums'])}         # type: ignore

                for i, song in enumerate(json_source['songs']): # type: ignore
                    extracted, issue_specs = _extract_entry(i, song, artists, albums, json_source['variousArtistIDs'])   # type: ignore
                    raw_album, raw_artist, raw_title = determine_raw_names(extracted)

                    cur.execute("""--sql
                        INSERT INTO entries (source_id, source_item_id, normalized_album, normalized_artist, normalized_title, raw_album, raw_artist, raw_duration, raw_json, raw_title)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING entry_id
                    """, (source_id, i + 1, normalize_title(raw_album), normalize_artist(raw_artist), normalize_title(raw_title), raw_album, raw_artist, song['duration'], Json(extracted), raw_title))
                    entry_id = cur.fetchone()[0]   # type: ignore

                    for issue_spec in issue_specs:
                        issue = Issue(entry_id = entry_id, **issue_spec)
                        row = issue.to_json()
                        cur.execute("""--sql
                            INSERT INTO entry_issues(entry_id, song_id, match_method, reason, details)
                            VALUES (%s, %s, %s, %s, %s)
                        """, (row['entry_id'], row['song_id'], row['match_method'], row['reason'], Jsonb(row['details'])))

    @staticmethod
    def validate(path: str | Path) -> dict[str, datetime | DBAuthority | list[dict[str, Any]] | list[str] | Path]:
        def _as_datetime(datetime_string, msg: str) -> datetime:
            if not isinstance(datetime_string, str):
                raise TypeError(f'{datetime_string} is not a string.')

            formats = ('%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d')

            for format in formats:
                try:
                    return datetime.strptime(datetime_string, format)
                except ValueError:
                    continue

            raise ValueError(msg.replace('<string>', datetime_string))

        def _as_enum(obj: object, expected: type[GENERIC_ENUM]) -> GENERIC_ENUM:
            if not (isinstance(expected, type) and issubclass(expected, Enum)):
                raise TypeError('The expected class is not an Enum.')

            if isinstance(obj, expected):
                return obj

            if isinstance(obj, str):
                try:
                    return expected[obj]
                except KeyError:
                    raise ValueError(f"Invalid enum name '{obj}' for {expected.__name__}")

            if isinstance(obj, int):
                try:
                    return expected(obj)
                except ValueError:
                    raise ValueError(f"Invalid enum value {obj} for {expected.__name__}")

            raise TypeError(f'Unsupported type {type(obj).__name__} for enum conversion')

        def _as_list(obj, msg: str) -> list:
            if not isinstance(obj, list):
                raise ValueError(msg)
            return obj

        def _check_album(obj, index: int) -> None:
            mask_name = f'the index {index} of the albums array'
            if not isinstance(obj, dict):
                raise TypeError(f'The object at {mask_name} is invalid')

            _check_key_and_type(obj, 'id', str, mask_name, nullable = False)
            _check_localization(obj.get('title'), f'from {mask_name}')
            _check_key_and_type(obj, 'artistID', list, mask_name, nullable = False)
            _check_string_list(obj['artistID'], f'the key \'artistID\' in {mask_name}')
            _check_localization(obj.get('artistDisplayNames'), f'from {mask_name}')
            _check_key_and_type(obj, 'artwork', str, mask_name)
            _check_key_and_type(obj, 'compilation', bool, mask_name, nullable = False)
            _check_key_and_type(obj, 'discCount', int, mask_name, nullable = False)
            _check_key_and_type(obj, 'preRelease', bool, mask_name, nullable = False)
            _check_key_and_type(obj, 'releaseDate', str, mask_name)
            if obj['releaseDate'] is not None:
                _as_datetime(obj['releaseDate'], f'Can\'t convert value <string> from the key \'releaseDate\' in {mask_name}')
            _check_key_and_type(obj, 'single', bool, mask_name, nullable = False)
            _check_key_and_type(obj, 'trackCount', dict, mask_name, nullable = False)
            _check_key_and_type(obj, 'upc', str, mask_name)

        def _check_artist(obj, index: int) -> None:
            mask_name = f'the index {index} of the artists array'
            if not isinstance(obj, dict):
                raise TypeError(f'The object at {mask_name} is invalid')

            _check_key_and_type(obj, 'id', str, mask_name, nullable = False)
            _check_localization(obj.get('title'), f'from {mask_name}')
            _check_key_and_type(obj, 'artwork', str, mask_name)

        def _check_key_and_type(obj, key: str, expected: type[GENERIC], mask: str, nullable: bool = True):
            if not isinstance(obj, dict):
                raise TypeError(f'{mask.capitalize()} is invalid')

            if key not in obj.keys():
                raise ValueError(f'Can\'t find key \'{key}\' in {mask}')

            val = obj[key]
            if val is None and not nullable:
                raise ValueError(f'Can\'t convert NoneType to {expected.__name__} for key \'{key}\' in {mask}')

            if val is None and nullable:
                return

            if not isinstance(val, expected):
                raise TypeError(f'Unexpected type for key \'{key}\' in {mask}')

        def _check_localization(obj, mask_name: str | None = None) -> None:
            mask_name = f'{obj}' if mask_name is None else mask_name
            mask_msg = f'the localization object {mask_name}'
            if not isinstance(obj, dict):
                raise TypeError(f'The localization object {mask_name} is invalid')

            _check_key_and_type(obj, 'en', str, mask_msg)
            _check_key_and_type(obj, 'fr', str, mask_msg)
            _check_key_and_type(obj, 'ja', str, mask_msg)
            _check_key_and_type(obj, 'ko', str, mask_msg)
            _check_key_and_type(obj, 'zs', str, mask_msg)
            _check_key_and_type(obj, 'zt', str, mask_msg)

        def _check_song(obj, index: int) -> None:
            mask_name = f'the index {index} of the songs array'
            if not isinstance(obj, dict):
                raise TypeError(f'The object at {mask_name} is invalid')

            _check_key_and_type(obj, 'id', str, mask_name, nullable = False)
            _check_localization(obj.get('title'), f'from {mask_name}')
            _check_key_and_type(obj, 'audio', str, mask_name)
            _check_key_and_type(obj, 'albumID', str, mask_name, nullable = False)
            _check_key_and_type(obj, 'artistID', list, mask_name, nullable = False)
            _check_string_list(obj['artistID'], f'the key \'artistID\' in {mask_name}')
            _check_key_and_type(obj, 'discNumber', int, mask_name, nullable = False)
            _check_key_and_type(obj, 'duration', int, mask_name, nullable = False)
            _check_key_and_type(obj, 'isrc', str, mask_name)
            _check_key_and_type(obj, 'locale', str, mask_name)
            _check_key_and_type(obj, 'playCount', int, mask_name, nullable = False)
            _check_key_and_type(obj, 'releaseDate', str, mask_name)
            if obj['releaseDate'] is not None:
                _as_datetime(obj['releaseDate'], f'Can\'t resolve value <string> from the key \'releaseDate\' in {mask_name}')
            _check_key_and_type(obj, 'trackNumber', int, mask_name, nullable = False)

        def _check_string_list(obj: list, mask_name: str) -> None:
            for i, item in enumerate(obj):
                if not isinstance(item, str):
                    raise TypeError(f'The index {i} of {mask_name} must be a string.')

        def _get_special_names(names: dict[str, str]) -> list[str]:
            results = []
            for name in names.values():
                if name is None:
                    continue
                if re.search(r'&|,', name):
                    results.append(name)
            return results

        def _is_various_artist(displayNames: dict) -> bool:
            for displayName in displayNames.values():
                if displayName in ['Various Artists', 'Multi-interprètes', 'ヴァリアス・アーティスト', '다수의 아티스트', '群星']:
                    return True
            return False

        path = Path(path)
        if not path.is_absolute():
            path = HERE / path

        with open(path, 'r', encoding = 'utf-8') as f:
            content = json.load(f)

        # Start validation

        if not isinstance(content, dict):
            raise ValueError('The JSON is invalid.')

        source_type = _as_enum(content.get('source'), DBAuthority)
        source_time = _as_datetime(content.get('time'), '<string> is an invalid date.')
        artists = _as_list(content.get('artists'), 'Artist array not found')
        albums = _as_list(content.get('albums'), 'Album array not found')
        songs = _as_list(content.get('songs'), 'Song array not found')

        various_artists = set()
        special_artist_names = set()

        for i, artist in enumerate(artists):
            _check_artist(artist, i)
            [special_artist_names.add(name) for name in _get_special_names(artist['title'])]

        for i, album in enumerate(albums):
            _check_album(album, i)
            for artist_id in album['artistID']:
                if _is_various_artist(album['artistDisplayNames']):
                    various_artists.add(artist_id)

        for i, song in enumerate(songs):
            _check_song(song, i)

        apple_music = source_type == DBAuthority.APPLE_MUSIC

        return {
            'source': source_type,
            'path': path.resolve().relative_to(ROOT),
            'time': source_time,
            'artists': artists,
            'albums': albums,
            'songs': songs,
            'specialArtistNames': sorted(special_artist_names),
            'variousArtistIDs': sorted(various_artists, key = lambda x: int(x) if apple_music else x)
        }

class Legacy:
    '''
    Legacy class for backward compatibility.
    '''

    @dataclass
    class XMLSource:
        '''
        Read from iTunes library XML file. Kept for backward compatibility.
        '''

        time: datetime = field(default_factory = lambda : datetime.now())
        songs: 'pd.DataFrame' = field(default_factory = _create_dataframe)  # type: ignore
        playlists: list = field(default_factory = lambda: [])

        def __repr__(self) -> str:
            return f'XMLSource({self.time.strftime("%Y-%m-%d")}, {len(self.songs)} song(s))'

        @staticmethod
        def load(url: str | Path, include_playlists: list[str] = []) -> 'Legacy.XMLSource':
            import pandas as pd
            input_url = Path(url)
            if not input_url.is_absolute():
                input_url = HERE / input_url

            with open(url, 'rb') as f:
                library_dict = plistlib.load(f)

            if not isinstance(library_dict, dict):
                return Legacy.XMLSource()

            date = library_dict.get('Date')
            playlists_list = library_dict.get('Playlists')
            tracks_dict = library_dict.get('Tracks')
            if (not isinstance(date, datetime) or
                not isinstance(playlists_list, list) or
                not isinstance(tracks_dict, dict)):
                return Legacy.XMLSource()

            playlists = []
            songs = []
            track_id_map = {}

            for i, (_, track_info) in enumerate(tracks_dict.items()):
                if not isinstance(track_info, dict):
                    continue

                id_data = int(track_info['Track ID'])
                songs.append({
                    'id': id_data,
                    'name': track_info['Name'],
                    'added_date': track_info.get('Date Added'),
                    'album': track_info.get('Album'),
                    'album_artist': track_info.get('Album Artist'),
                    'artist': track_info.get('Artist'),
                    'disc_count': track_info.get('Disc Count'),
                    'disc_number': track_info.get('Disc Number'),
                    'duration': int(track_info['Total Time']),
                    'genre': track_info.get('Genre'),
                    'modified_date': track_info.get('Date Modified'),
                    'play_count': int(track_info.get('Play Count', 0)),
                    'release_date': track_info.get('Release Date', datetime.strptime(f'{track_info.get("Year", "0001")}-01-01', '%Y-%m-%d')),
                    'track_count': track_info.get('Track Count'),
                    'track_number': track_info.get('Track Number')
                })

                track_id_map[id_data] = i

            include_songs = set()
            for playlist_dict in playlists_list:
                if not isinstance(playlist_dict, dict):
                    continue

                playlist_name = playlist_dict['Name']
                is_master = playlist_dict.get('Master')
                if not (playlist_name == 'Library') and not (playlist_name in include_playlists) and not is_master:
                    continue

                playlist_tracks = [item['Track ID'] for item in playlist_dict['Playlist Items']]
                include_songs.update(playlist_tracks)

                playlists.append({
                    'id': playlist_dict['Playlist ID'],
                    'name': playlist_name,
                    'tracks': playlist_tracks
                })

            songs = [songs[track_id_map[i]] for i in include_songs]
            return Legacy.XMLSource(time = date, songs = pd.DataFrame(songs), playlists = playlists)

        def is_in_playlist(self, playlist_name: str):
            import pandas as pd
            playlist_candidates = [p for p in self.playlists if p['name'] == playlist_name]
            if not playlist_candidates:
                return pd.Series(False, index = self.songs.index)

            playlist = playlist_candidates[0]
            return self.songs['id'].apply(lambda x: x in playlist['tracks'])
