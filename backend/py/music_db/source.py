from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import plistlib

HERE = Path().absolute()

def _create_dataframe():
    import pandas as pd
    return pd.DataFrame()

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
