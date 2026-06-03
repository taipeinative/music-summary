from music_db.normalize import normalize_artist
from music_db.typing import DBAuthority
import psycopg

def does_table_exist(connection: psycopg.Connection, table: str, schema: str = 'public') -> bool:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT EXISTS (
              SELECT 1
              FROM pg_tables
              WHERE schemaname = %s
              AND tablename = %s      
            );
        """, (schema, table))
        row = cur.fetchone()
        return (row[0] if isinstance(row[0], bool) else False) if row is not None else False

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

def get_artist_by_name(connection: psycopg.Connection, artist_name: str) -> int | None:
    with connection.cursor() as cur:
        # 1. Exact title search:
        cur.execute("""--sql
            SELECT artist_id FROM artist_titles WHERE title = %s
            UNION
            SELECT artist_id FROM artist_alias WHERE alias = %s
        """, (artist_name, artist_name))

        rows = cur.fetchall()
        if len(rows) > 0:
            if len(rows) > 1:
                print(f'Warning: \"{artist_name}\" has multiple exact matches with these artists - {", ".join([str(row[0]) for row in rows if rows[0]])}')
            return rows[0][0] if rows[0] else None

        # 2. Case-insensitive search:
        cur.execute("""--sql
            SELECT artist_id FROM artist_titles WHERE normalized_title = %s
            UNION
            SELECT artist_id FROM artist_alias WHERE normalized_alias = %s
        """, (normalize_artist(artist_name), artist_name))

        rows = cur.fetchall()
        if len(rows) > 0:
            if len(rows) > 1:
                print(f'Warning: \"{artist_name}\" has multiple similar matches with these artists - {", ".join([str(row[0]) for row in rows if rows[0]])}')
            return rows[0][0] if rows[0] else None
        
        return None
