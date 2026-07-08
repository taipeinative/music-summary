from collections import Counter
from typing import Any

from music_db.normalize import normalize_artist, normalize_core_title, normalize_title, parse_artists
from music_db.typing import DBAuthority, DBLocale, DBStatus
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

def get_artist_ids_by_authorities(connection: psycopg.Connection, authority: DBAuthority, authority_codes: list[str]) -> dict[str, int]:
    if not authority_codes:
        return {}

    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT authority_code, artist_id
            FROM artist_authorities
            WHERE authority = %s
              AND authority_code = ANY(%s)
        """, (authority.value, authority_codes))
        return {str(row[0]): int(row[1]) for row in cur.fetchall()}

def get_artist_ids_by_normalized_names(connection: psycopg.Connection, normalized_names: list[str]) -> set[int]:
    if not normalized_names:
        return set()

    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT artist_id
            FROM artist_titles
            WHERE normalized_title = ANY(%s)
            UNION
            SELECT artist_id
            FROM artist_alias
            WHERE normalized_alias = ANY(%s)
        """, (normalized_names, normalized_names))
        return {int(row[0]) for row in cur.fetchall()}

def get_canonical_song_data(connection: psycopg.Connection, song_ids: list[int]) -> dict[int, dict[str, Any]]:
    unique_song_ids = sorted({int(song_id) for song_id in song_ids})
    if not unique_song_ids:
        return {}

    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT song_id, duration
            FROM songs
            WHERE song_id = ANY(%s)
        """, (unique_song_ids, ))
        songs = {int(row[0]): {'duration': int(row[1]), 'titles': [], 'artist_ids': [], 'artist_names': []} for row in cur.fetchall()}

        cur.execute("""--sql
            SELECT song_id, title, normalized_title, locale, fallback
            FROM song_titles
            WHERE song_id = ANY(%s)
            ORDER BY song_id, fallback DESC, locale
        """, (unique_song_ids, ))
        for row in cur.fetchall():
            song_id = int(row[0])
            if song_id in songs:
                songs[song_id]['titles'].append({
                    'title': row[1],
                    'normalized_title': row[2],
                    'locale': int(row[3]),
                    'fallback': bool(row[4]),
                })

        cur.execute("""--sql
            SELECT
                sa.song_id,
                sa.artist_id,
                COALESCE(sa.display_title, preferred.title, fallback.title, '') AS artist_name
            FROM song_artists sa
            LEFT JOIN LATERAL (
                SELECT title
                FROM artist_titles
                WHERE artist_id = sa.artist_id
                  AND locale = 32768
                LIMIT 1
            ) preferred ON TRUE
            LEFT JOIN LATERAL (
                SELECT title
                FROM artist_titles
                WHERE artist_id = sa.artist_id
                  AND fallback = true
                LIMIT 1
            ) fallback ON TRUE
            WHERE sa.song_id = ANY(%s)
            ORDER BY sa.song_id, sa.display_order
        """, (unique_song_ids, ))
        for row in cur.fetchall():
            song_id = int(row[0])
            if song_id in songs:
                songs[song_id]['artist_ids'].append(int(row[1]))
                songs[song_id]['artist_names'].append(row[2] or '')

    return songs

def get_confirmed_entry_mapping(connection: psycopg.Connection, entry_id: int) -> int | None:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT song_id
            FROM entry_mapping
            WHERE entry_id = %s
              AND status = %s
        """, (entry_id, DBStatus.CONFIRMED.value))
        row = cur.fetchone()
        return int(row[0]) if row else None

def get_entry_mapping(connection: psycopg.Connection, entry_id: int, song_id: int) -> dict[str, Any] | None:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT entry_id, song_id, confidence, match_method, status, created_at
            FROM entry_mapping
            WHERE entry_id = %s
              AND song_id = %s
        """, (entry_id, song_id))
        row = cur.fetchone()

    if row is None:
        return None

    return {
        'entry_id': int(row[0]),
        'song_id': int(row[1]),
        'confidence': float(row[2]),
        'match_method': int(row[3]),
        'status': int(row[4]),
        'created_at': row[5].isoformat() if hasattr(row[5], 'isoformat') else row[5],
    }

def get_song_ids_by_authority(connection: psycopg.Connection, authority: DBAuthority, authority_code: str) -> list[int]:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT song_id
            FROM song_authorities
            WHERE authority = %s
              AND authority_code = %s
        """, (authority.value, authority_code))
        return [int(row[0]) for row in cur.fetchall()]

def get_song_ids_by_duration_window(connection: psycopg.Connection, duration_ms: int, window_ms: int) -> list[int]:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT song_id
            FROM songs
            WHERE ABS(duration - %s) <= %s
        """, (duration_ms, window_ms))
        return [int(row[0]) for row in cur.fetchall()]

def get_song_ids_by_title_and_duration(
    connection: psycopg.Connection,
    normalized_title: str,
    duration_ms: int,
    tolerance_ms: int,
) -> list[int]:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT DISTINCT s.song_id
            FROM songs s
            JOIN song_titles st
              ON st.song_id = s.song_id
            WHERE st.normalized_title = %s
              AND ABS(s.duration - %s) <= %s
        """, (normalized_title, duration_ms, tolerance_ms))
        return [int(row[0]) for row in cur.fetchall()]

def get_source_by_file(connection: psycopg.Connection, source_file: str) -> int | None:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT source_id
            FROM sources
            WHERE source_file = %s
        """, (source_file, ))
        row = cur.fetchone()
        return int(row[0]) if row else None

def get_source_type(connection: psycopg.Connection, source_id: int) -> int:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT source_type
            FROM sources
            WHERE source_id = %s
        """, (source_id, ))
        row = cur.fetchone()

    if row is None:
        raise ValueError(f'Unknown source_id: {source_id}.')
    return int(row[0])

def get_source_entries(connection: psycopg.Connection, source_id: int) -> list[dict[str, Any]]:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT
                e.entry_id,
                e.source_id,
                e.source_item_id,
                e.normalized_album,
                e.normalized_artist,
                e.normalized_title,
                e.raw_album,
                e.raw_artist,
                e.raw_duration,
                e.raw_json,
                e.raw_title,
                src.source_type
            FROM entries e
            JOIN sources src
              ON src.source_id = e.source_id
            WHERE e.source_id = %s
            ORDER BY e.source_item_id
        """, (source_id, ))
        return [
            {
                'entry_id': int(row[0]),
                'source_id': int(row[1]),
                'source_item_id': int(row[2]),
                'normalized_album': row[3],
                'normalized_artist': row[4],
                'normalized_title': row[5],
                'raw_album': row[6],
                'raw_artist': row[7],
                'raw_duration': int(row[8]),
                'raw_json': row[9],
                'raw_title': row[10],
                'source_type': int(row[11]),
            }
            for row in cur.fetchall()
        ]

def get_unreviewed_legacy_entry_ids(
    connection: psycopg.Connection,
    raw_duration: int,
    normalized_core_title: str,
    normalized_artist_parts: set[str],
    tolerance_ms: int,
) -> list[int]:
    with connection.cursor() as cur:
        cur.execute("""--sql
            SELECT
                e.entry_id,
                e.raw_title,
                e.raw_artist,
                e.raw_duration
            FROM entries e
            JOIN sources src
              ON src.source_id = e.source_id
            LEFT JOIN entry_mapping confirmed
              ON confirmed.entry_id = e.entry_id
             AND confirmed.status = %s
            WHERE src.source_type = %s
              AND confirmed.entry_id IS NULL
              AND ABS(e.raw_duration - %s) <= %s
        """, (DBStatus.CONFIRMED.value, DBAuthority.ITUNES.value, raw_duration, tolerance_ms))
        rows = cur.fetchall()

    matches: list[int] = []
    for row in rows:
        legacy_entry_id = int(row[0])
        raw_title = row[1] or ''
        raw_artist = row[2] or ''
        if normalize_core_title(raw_title) != normalized_core_title:
            continue

        legacy_artists = {
            name
            for name in parse_artists(raw_artist, normalize = True)
            if name
        }
        if normalized_artist_parts.intersection(legacy_artists):
            matches.append(legacy_entry_id)

    return sorted(matches)
