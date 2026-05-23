from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import LiteralString

from music_db.typing import DBArtistTag, DBAuthority, DBLocale, DBRelation
import psycopg

HERE = Path(__file__).resolve().parent

ARTISTS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS artists
    (
        artist_id serial NOT NULL,
        artist_tag smallint NOT NULL,
        artwork text,
        created_at timestamp WITH TIME ZONE NOT NULL default now(),
        updated_at timestamp WITH TIME ZONE NOT NULL default now(),
        PRIMARY KEY (artist_id)
    );
"""

ARTIST_ALIAS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS artist_alias
    (
        artist_id integer NOT NULL,
        alias text NOT NULL,
        UNIQUE (artist_id, alias),
        FOREIGN KEY (artist_id) REFERENCES artists(artist_id)
    );
"""

ARTIST_AUTHORITIES_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS artist_authorities
    (
        artist_id integer NOT NULL,
        authority smallint NOT NULL,
        authority_code text NOT NULL,
        UNIQUE (authority, authority_code),
        FOREIGN KEY (artist_id) REFERENCES artists(artist_id)
    );
"""

ARTIST_RELATIONS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS artist_relations
    (
        artist_id integer NOT NULL,
        ref_artist_id integer NOT NULL,
        relation_to_ref smallint NOT NULL,
        UNIQUE (artist_id, ref_artist_id, relation_to_ref),
        FOREIGN KEY (artist_id) REFERENCES artists(artist_id)
    );
"""

ARTIST_TITLES_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS artist_titles
    (
        artist_id integer NOT NULL,
        fallback boolean NOT NULL DEFAULT false,
        locale integer NOT NULL DEFAULT 1,
        title text NOT NULL,
        UNIQUE (artist_id, locale),
        FOREIGN KEY (artist_id) REFERENCES artists(artist_id)
    );
"""

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

def create_table(connection: psycopg.Connection, table_sql: LiteralString) -> None:
    with connection.cursor() as cur:
        cur.execute(table_sql)

def create_view(connection: psycopg.Connection) -> None:
    with connection.cursor() as cur:
        cur.execute("""--sql
            CREATE OR REPLACE VIEW artist_overview AS
            SELECT
                a.artist_id,

                -- fallback title
                t.locale,
                t.title,

                -- zh-Hant title if exists, otherwise fallback title
                COALESCE(t_zh.title, t.title) AS title_zh_hant,

                -- aliases as text[]
                COALESCE(al.aliases, ARRAY[]::text[]) AS alias,

                a.artist_tag,

                -- Apple Music ID
                am.authority_code AS apple_music_id,

                a.updated_at,
                a.artwork

            FROM artists a

            -- fallback title
            LEFT JOIN artist_titles t
                ON a.artist_id = t.artist_id
            AND t.fallback = true

            -- zh-Hant title
            LEFT JOIN artist_titles t_zh
                ON a.artist_id = t_zh.artist_id
            AND t_zh.locale = 32768

            -- aggregate aliases
            LEFT JOIN (
                SELECT
                    artist_id,
                    array_agg(alias ORDER BY alias) AS aliases
                FROM artist_alias
                GROUP BY artist_id
            ) al
                ON a.artist_id = al.artist_id

            -- Apple Music authority
            LEFT JOIN artist_authorities am
                ON a.artist_id = am.artist_id
            AND am.authority = 1;
        """)

def get_artist_by_apple_id(connection: psycopg.Connection, apple_id: str) -> int | None:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT artist_id
            FROM artist_authorities
            WHERE authority = %s
              AND authority_code = %s
        """, (DBAuthority.APPLE_MUSIC.value, apple_id))
        row = cur.fetchone()
        return row[0] if row else None

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
                INSERT INTO artist_alias (artist_id, alias)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING
            """, (artist_id, alias))

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
                INSERT INTO artist_titles (artist_id, fallback, locale, title)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (artist_id, fallback, locale, title))

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
            create_table(conn, ARTISTS_TABLE) 
            create_table(conn, ARTIST_ALIAS_TABLE)
            create_table(conn, ARTIST_AUTHORITIES_TABLE)
            create_table(conn, ARTIST_RELATIONS_TABLE)
            create_table(conn, ARTIST_TITLES_TABLE)

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
            
            create_view(conn)

    except Exception as ex:
        parser.error(str(ex))
        return 2
    
    return 0

if __name__ == '__main__':
    main()