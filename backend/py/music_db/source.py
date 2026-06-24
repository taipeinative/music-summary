from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
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
