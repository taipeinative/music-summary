from __future__ import annotations

import argparse
import json
from pathlib import Path

from music_db.normalize import normalize_artist
from music_db.query import get_artist_by_apple_id
from music_db.schema import *
from music_db.typing import DBArtistTag, DBAuthority, DBLocale, DBRelation
import psycopg

HERE = Path(__file__).resolve().parent

def create_artist(connection: psycopg.Connection, data: dict) -> int:
    artist_tag = DBArtistTag.NONE
    if data.get('ai', False):
        artist_tag |= DBArtistTag.AI
    if data.get('synth', False):
        artist_tag |= DBArtistTag.SYNTH

    with connection.cursor() as cur:
        cur.execute("""--sql
            INSERT INTO artists (artist_tag, artwork)
            VALUES (%s, %s)
            RETURNING artist_id
        """, (artist_tag.value, data.get('thumb')))
        artist_id = cur.fetchone()[0]   # type: ignore

        cur.execute("""--sql
            INSERT INTO artist_authorities (artist_id, authority, authority_code)
            VALUES (%s, %s, %s)
        """, (artist_id, DBAuthority.APPLE_MUSIC.value, data.get('id')))

    return int(artist_id)

def get_or_create_artist(connection: psycopg.Connection, data: dict) -> int | None:
    apple_id = data.get('id')
    if isinstance(apple_id, str):
        existing = get_artist_by_apple_id(connection, apple_id)
        if existing:
            return existing

        return create_artist(connection, data)
    return None

def insert_artist_alias(connection: psycopg.Connection, artist_id: int, data: dict) -> None:
    aliases = data.get('alias')
    if not isinstance(aliases, list):
        aliases = []
    
    with connection.cursor() as cur:
        for alias in aliases:
            cur.execute("""--sql
                INSERT INTO artist_alias (artist_id, alias, normalized_alias)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (artist_id, alias, normalize_artist(alias)))

def insert_artist_relations(connection: psycopg.Connection, artist_id: int, data: dict, id_map: dict[str, int]) -> None:
    relations = data.get('roles')
    if not isinstance(relations, list):
        return

    with connection.cursor() as cur:
        for rel in relations:
            target_id = id_map.get(rel['artistId'])
            if target_id is None:
                continue

            if rel['role'] == 'Member of':
                cur.execute("""--sql
                    INSERT INTO artist_relations (artist_id, ref_artist_id, relation_to_ref)
                    VALUES (%s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (artist_id, target_id, DBRelation.MEMBER_OF.value))

def insert_artist_titles(connection: psycopg.Connection, artist_id: int, data: dict) -> None:
    fallback_locale = data.get('locale', 'en')
    en = data.get('us')
    zh_hant = data.get('tw')
    original = data.get('or')

    titles = []
    en_native = fallback_locale == 'en'
    zh_native = fallback_locale == 'zh-Hant'
    titles.append((en_native, DBLocale.EN.value, en))
    titles.append((zh_native, DBLocale.ZH_HANT.value, zh_hant))
    if (not en_native) and (not zh_native):
        titles.append((True, DBLocale.get_locale(fallback_locale).value, original))
    
    with connection.cursor() as cur:
        for fallback, locale, title in titles:
            if not title:
                continue

            cur.execute("""--sql
                INSERT INTO artist_titles (artist_id, fallback, locale, normalized_title, title)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (artist_id, fallback, locale, normalize_artist(title), title))

def main():
    parser = argparse.ArgumentParser(description = 'Migrate artists.json file to the new database.')
    parser.add_argument('--host', required = True, help = 'Host server address.')
    parser.add_argument('--dbname', required = True, help = 'The database name.')
    parser.add_argument('--user', required = True, help = 'The user name.')
    parser.add_argument('--password', required = True, help = 'The password of the user.')

    args = parser.parse_args()

    try:
        raw: dict
        artists_json = HERE / Path(r'..\..\data\.legacy\artists.json')
        with open(artists_json, 'r', encoding='utf-8') as f:
            raw = json.load(f)

        artists: list[dict] = []
        for k, v in raw.items():
            v['id'] = k
            v['thumb'] = None if v['thumb'] is None else f'https://is1-ssl.mzstatic.com/image/thumb/{v["thumb"]}'
            artists.append(v)

        with psycopg.connect(
            host = args.host,
            dbname = args.dbname,
            user = args.user,
            password = args.password
        ) as conn:
            create(conn, ARTISTS_TABLE) 
            create(conn, ARTIST_ALIAS_TABLE)
            create(conn, ARTIST_AUTHORITIES_TABLE)
            create(conn, ARTIST_RELATIONS_TABLE)
            create(conn, ARTIST_TITLES_TABLE)

            apple_to_db_map = {}
            for artist in artists:
                artist_id = get_or_create_artist(conn, artist)
                if artist_id is None:
                    continue

                insert_artist_alias(conn, artist_id, artist)
                insert_artist_titles(conn, artist_id, artist)
                artist['music_id'] = artist_id

                apple_id = artist.get('id')
                if isinstance(apple_id, str):
                    apple_to_db_map[apple_id] = artist_id

            for artist in artists:
                insert_artist_relations(conn, artist['music_id'], artist, apple_to_db_map)
            
            create(conn, ARTIST_OVERVIEW)

    except Exception as ex:
        parser.error(str(ex))
        return 2
    
    return 0

if __name__ == '__main__':
    main()