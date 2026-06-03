import psycopg
from typing import LiteralString

ALBUMS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS albums
    (
        album_id serial NOT NULL,
        album_type smallint NOT NULL,
        artwork text,
        disc_count smallint,
        release_date date,
        created_at timestamp WITH TIME ZONE NOT NULL default now(),
        updated_at timestamp WITH TIME ZONE NOT NULL default now(),
        PRIMARY KEY (album_id)
    );
"""

ALBUM_ARTISTS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS album_artists
    (
        album_id integer NOT NULL,
        artist_id integer NOT NULL,
        display_order smallint NOT NULL,
        UNIQUE (album_id, display_order),
        FOREIGN KEY (album_id) REFERENCES albums(album_id),
        FOREIGN KEY (artist_id) REFERENCES artists(artist_id)
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
        normalized_title text NOT NULL,
        title text NOT NULL,
        UNIQUE (album_id, locale),
        FOREIGN KEY (album_id) REFERENCES albums(album_id)
    );
"""

ALBUM_TRACKS_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS album_tracks
    (
        album_id integer NOT NULL,
        song_id integer NOT NULL,
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
        disc_number smallint NOT NULL,
        track_count integer NOT NULL,
        UNIQUE (album_id, disc_number),
        FOREIGN KEY (album_id) REFERENCES albums(album_id)
    );
"""

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
        normalized_alias text NOT NULL,
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
        normalized_title text NOT NULL,
        title text NOT NULL,
        UNIQUE (artist_id, locale),
        FOREIGN KEY (artist_id) REFERENCES artists(artist_id)
    );
"""

ENTRIES_TABLE = """--sql
    CREATE TABLE IF NOT EXISTS entries
    (
        entry_id serial NOT NULL,
        source_id integer NOT NULL,
        source_item_id integer NOT NULL,
        normalized_album text NOT NULL,
        normalized_artist text NOT NULL,
        normalized_title text NOT NULL,
        raw_album text NOT NULL,
        raw_artist text NOT NULL,
        raw_duration integer NOT NULL,
        raw_json json NOT NULL,
        raw_title text NOT NULL,
        PRIMARY KEY (entry_id),
        UNIQUE (source_id, source_item_id),
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
        created_at timestamp WITH TIME ZONE NOT NULL default now(),
        UNIQUE (entry_id, song_id),
        FOREIGN KEY (entry_id) REFERENCES entries(entry_id),
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
        created_at timestamp WITH TIME ZONE NOT NULL default now(),
        updated_at timestamp WITH TIME ZONE NOT NULL default now(),
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
        UNIQUE (song_id, display_order),
        FOREIGN KEY (artist_id) REFERENCES artists(artist_id),
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

SONG_LOCALES_TABLE = """--sql
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
        normalized_title text NOT NULL,
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

ARTIST_OVERVIEW = """--sql
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
"""

def create(connection: psycopg.Connection, sql: LiteralString) -> None:
    with connection.cursor() as cur:
        cur.execute(sql)