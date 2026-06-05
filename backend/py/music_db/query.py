from collections import Counter

from music_db.normalize import normalize_artist, normalize_title
from music_db.typing import DBAuthority, DBLocale
import psycopg

def _resolve_album_conflict(connection: psycopg.Connection, album_ids: list[int], target_artist_count: int = 0) -> int | None:
    if not album_ids:
        return None

    unique_ids = list(set(album_ids))
    if len(unique_ids) == 1:
        return unique_ids[0]

    album_scores = {aid: 0 for aid in unique_ids}

    with connection.cursor() as cur:
        for aid in unique_ids:
            cur.execute("""
                SELECT locale, fallback FROM album_titles WHERE album_id = %s
            """, (aid,))
            titles = cur.fetchall()
            for locale, fallback in titles:
                if locale == DBLocale.ZH_HANT.value:
                    album_scores[aid] += 2
                if not fallback:
                    album_scores[aid] += 1

            if target_artist_count > 0:
                cur.execute("""
                    SELECT COUNT(*) FROM album_artists WHERE album_id = %s
                """, (aid,))
                actual_artist_count = cur.fetchone()[0] # type: ignore
                difference = abs(actual_artist_count - target_artist_count)
                if difference == 0:
                    album_scores[aid] += 5
                elif (difference == 1) and (actual_artist_count >= 3):
                    album_scores[aid] += 3

    max_score = max(album_scores.values())
    highest_scored_albums = [aid for aid, score in album_scores.items() if score == max_score]

    # Return the album with highest score
    if len(highest_scored_albums) == 1:
        return highest_scored_albums[0]
    
    return None

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

def get_album_by_data(connection: psycopg.Connection, album_name: str, artist_names: list[str] | None = None) -> int | None:
    if artist_names is None:
        artist_names = []
    
    no_artists = len(artist_names) == 0
    compilation = (len(artist_names) == 1) and (artist_names[0] == 'Various Artists')

    with connection.cursor() as cur:
        if no_artists:
            # 1. Exact title search
            cur.execute("SELECT album_id FROM album_titles WHERE title = %s", (album_name, ))
            rows = cur.fetchall()
            if rows:
                resolved = _resolve_album_conflict(connection, [r[0] for r in rows])
                if resolved:
                    return resolved
            
            # 2. Case-insensitive search
            cur.execute("SELECT album_id FROM album_titles WHERE normalized_title = %s", 
                        (normalize_title(album_name, album = True), ))
            rows = cur.fetchall()
            if rows:
                resolved = _resolve_album_conflict(connection, [r[0] for r in rows])
                if resolved:
                    return resolved
        
        elif compilation:
            # 1. Exact title search in compilations
            cur.execute("""--sql
                SELECT a.album_id FROM albums a
                INNER JOIN (
                    SELECT at.album_id FROM album_titles at WHERE at.title = %s
                ) at
                    ON a.album_id = at.album_id
                WHERE a.album_type = 3
            """, (album_name, ))
            rows = cur.fetchall()
            if rows:
                resolved = _resolve_album_conflict(connection, [r[0] for r in rows])
                if resolved:
                    return resolved
            
            # 2. Case-insensitive search in compilations
            cur.execute("""--sql
                SELECT a.album_id FROM albums a
                INNER JOIN (
                    SELECT at.album_id FROM album_titles at WHERE at.normalized_title = %s
                ) at
                    ON a.album_id = at.album_id
                WHERE a.album_type = 3
            """, (normalize_title(album_name, album = True), ))
            rows = cur.fetchall()
            if rows:
                resolved = _resolve_album_conflict(connection, [r[0] for r in rows])
                if resolved:
                    return resolved

        else:
            # 1. Exact title search with artists
            album_ids: list[int] = []
            for artist_name in artist_names:
                cur.execute("""--sql
                    SELECT alt.album_id FROM album_titles alt
                    INNER JOIN album_artists aar ON alt.album_id = aar.album_id
                    INNER JOIN (
                        SELECT artist_id FROM artist_titles WHERE title = %s
                        UNION
                        SELECT artist_id FROM artist_alias WHERE alias = %s
                    ) art ON aar.artist_id = art.artist_id
                    WHERE alt.title = %s;
                """, (artist_name, artist_name, album_name))
                album_ids.extend([r[0] for r in cur.fetchall()])

            if album_ids:
                counts = Counter(album_ids)
                max_count = counts.most_common(1)[0][1]
                candidates = [aid for aid, count in counts.items() if count == max_count]
                resolved = _resolve_album_conflict(connection, candidates, target_artist_count = len(artist_names))
                if resolved:
                    return resolved

            # 2. Case-insensitive search with artists
            album_ids.clear()
            for artist_name in artist_names:
                normalized = normalize_artist(artist_name)
                cur.execute("""--sql
                    SELECT alt.album_id FROM album_titles alt
                    INNER JOIN album_artists aar ON alt.album_id = aar.album_id
                    INNER JOIN (
                        SELECT artist_id FROM artist_titles WHERE normalized_title = %s
                        UNION
                        SELECT artist_id FROM artist_alias WHERE normalized_alias = %s
                    ) art ON aar.artist_id = art.artist_id
                    WHERE alt.normalized_title = %s;
                """, (normalized, normalized, normalize_title(album_name, album = True)))
                album_ids.extend([r[0] for r in cur.fetchall()])

            if album_ids:
                counts = Counter(album_ids)
                max_count = counts.most_common(1)[0][1]
                candidates = [aid for aid, count in counts.items() if count == max_count]
                resolved = _resolve_album_conflict(connection, candidates, target_artist_count = len(artist_names))
                if resolved:
                    return resolved

        return None

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
