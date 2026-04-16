from __future__ import annotations

from datetime import datetime
import json
import math
from pathlib import Path
import time

from bs4 import BeautifulSoup
from bs4.element import Tag
import requests

from AppleMusic.base import Identity, Localization, Song, dump

HERE = Path().absolute()
PUBLIC_SESSION = requests.Session()
QUERY_TEST_URL = r'https://amp-api.music.apple.com/v1/test'
QUERY_URL = r'https://amp-api.music.apple.com/v1/catalog/{}/playlists/{}/tracks?l={}&fields[artists]=artwork,name,url&include[songs]=artists&limit=300&offset={}'

class Alternate:
    '''
    The alternate mode that manually perform web-crawling on Apple Music site.
    '''

    ITUNES_REQUEST_ID_COUNT = 150
    ITUNES_REQUEST_INTERVAL = 2
    ITUNES_URL = r'https://itunes.apple.com/lookup?media=music&entity=musicTrack&country={}&id={}'
    PLAYLIST_URL = r'https://music.apple.com/{}/playlist/{}?l={}'

    @staticmethod
    def extract_data(obj, locale: str, songs: list[Song], pool: dict[int, int]) -> bool:
        def _get_id(link_data, one_step: bool = False) -> int:
            id_data = link_data
            if not one_step:
                id_data = link_data['segue']['destination']
            return int(id_data['contentDescriptor']['identifiers']['storeAdamID'])

        def _map_descripters(links) -> list[Identity]:
            if not isinstance(links, list):
                return []
            return [
                Identity(id = _get_id(link), name = Localization.create(locale, str(link['title'])))
                for link in links
            ]

        if not isinstance(obj, list):
            return False
        
        for tag in obj:
            if not isinstance(tag, dict):
                continue

            data_list = tag.get('data')
            if not (isinstance(data_list, list) and len(data_list) == 1 and isinstance(data_list[0], dict)):
                continue

            data_collection = data_list[0].get('data')
            if not isinstance(data_collection, dict):
                continue

            sections = data_collection.get('sections')
            if not isinstance(sections, list):
                continue

            for section in sections:
                if not isinstance(section, dict):
                    continue
                section_id = section.get('id')
                items = section.get('items')

                if (not isinstance(section_id, str)) or (not section_id.startswith('track-list')) or (not isinstance(items, list)):
                    continue

                for song in items:
                    if not isinstance(song, dict):
                        continue
                    if not str(song.get('id', '')).startswith('track-lockup'):
                        continue

                    title = str(song['title'])
                    id_data = _get_id(song, one_step = True)
                    artwork = '/'.join(str(song['artwork']['dictionary']['url']).split('/')[:-1])
                    albums = _map_descripters(song.get('tertiaryLinks', []))
                    album = None if len(albums) == 0 else albums[0]
                    if album is not None:
                        album.artwork = artwork
                    artist = _map_descripters(song.get('subtitleLinks', []))
                    duration = int(song['duration'])

                    song = Song(
                        id = id_data,
                        name = Localization.create(locale, title),
                        artwork = artwork,
                        album = album,
                        artist = artist,
                        duration = duration
                    )

                    song_index = pool.get(song.id)
                    if isinstance(song_index, int):
                        songs[song_index].merge_locale(song)

                    else:
                        pool[song.id] = len(songs)
                        songs.append(song)

        return False

    @staticmethod
    def gather_data(profiles: list[tuple[str, str]], playlist_id: str, verbose: bool = True) -> list[Song]:
        songs = []
        song_index_map = {}
        fail_counter = 0
        for profile in profiles:
            if verbose:
                print(f'>   Collecting profile: (region: {profile[0]}, locale: {profile[1]})')
            
            while fail_counter < 3:
                try:
                    res = Alternate.request_data(Alternate.PLAYLIST_URL.format(profile[0], playlist_id, profile[1]))
                    _ = Alternate.extract_data(Alternate.parse_data(res), profile[1], songs, song_index_map)
                    break

                except requests.exceptions.HTTPError as ex:
                    fail_counter += 1
                    if fail_counter < 3:
                        print('>   Retrying...')
                        time.sleep(1)
                    else:
                        print('>   Failed count reached 3 times. Exiting...')
                        print(f'>   Last error run info - Region: {profile[0]}, Locale: {profile[1]}, Playlist: {playlist_id}')
                        return songs
        
        length = len(songs)
        loop_count = math.ceil(length / Alternate.ITUNES_REQUEST_ID_COUNT)
        query_ids = [
            ','.join(
                [
                    str(song.id)
                    for song in songs[i * Alternate.ITUNES_REQUEST_ID_COUNT : min(length, (i + 1) * Alternate.ITUNES_REQUEST_ID_COUNT)]
                ]
            )
            for i in range(loop_count)
        ]

        fail_counter = 0
        for profile in profiles:
            if verbose:
                print(f'>   Attaching data to profile: (region: {profile[0]}, locale: {profile[1]})')

            for i in range(loop_count):
                try:
                    res = PUBLIC_SESSION.get(Alternate.ITUNES_URL.format(profile[0], query_ids[i]), timeout = 30)
                    res.raise_for_status()

                    search_result = json.loads(res.content)
                    if not isinstance(search_result, dict):
                        continue

                    result_items = search_result.get('results')
                    if not isinstance(result_items, list):
                        continue

                    for result_item in result_items:
                        if not isinstance(result_item, dict):
                            continue

                        id_data = result_item.get('trackId')
                        index = song_index_map.get(id_data)

                        if index is None:
                            continue

                        date = str(result_item.get('releaseDate'))
                        songs[index].audio = str(result_item.get('previewUrl'))
                        songs[index].date = None if date is None else datetime.strptime(date, '%Y-%m-%dT%H:%M:%SZ')
                        songs[index].disc = int(str(result_item.get('discNumber')))
                        songs[index].track = int(str(result_item.get('trackNumber')))
            
                    if i != loop_count - 1:
                        time.sleep(Alternate.ITUNES_REQUEST_INTERVAL)

                except requests.exceptions.HTTPError:
                    fail_counter += 1
                    if fail_counter < 3:
                        print('>   Retrying...')
                        time.sleep(Alternate.ITUNES_REQUEST_INTERVAL)
                    else:
                        print('>   Failed count reached 3 times. Exiting...')
                        print(f'>   Last error run info - Region: {profile[0]}, Locale: {profile[1]}, Playlist: {playlist_id}')
                        return songs

        return songs

    @staticmethod
    def parse_data(res: requests.Response) -> list:
        results = []
        bs = BeautifulSoup(res.content, 'html.parser')  # type: ignore
        data_tags = bs.select('script[id=serialized-server-data]')
        for data_tag in data_tags:
            if isinstance(data_tag, Tag):
                results.append(json.loads(data_tag.decode_contents()))
        return results

    @staticmethod
    def request_data(url: str) -> requests.Response:
        res = PUBLIC_SESSION.get(url)
        res.raise_for_status()
        return res

def dump_data(url: str | Path, songs: list[Song]):
    input_url = Path(url)
    if not input_url.is_absolute():
        input_url = HERE / input_url
    
    data = {
        'time': datetime.now().strftime('%Y-%m-%dT%H:%M:%S%z'),
        'data': songs,
    }

    dump(data, input_url, ensure_ascii = False, indent = 2)

def extract_data(obj, locale: str, songs: list[Song], pool: dict[int, int]) -> bool:
    def _artwork_url(collection: dict) -> str | None:
        artwork_property = collection.get('artwork')
        if not isinstance(artwork_property, dict):
            return None
        return '/'.join(artwork_property.get('url', '').split('/')[:-1])

    def _base_info(item: dict):
        return item.get('id'), item.get('type'), item.get('attributes'), item.get('relationships')
    
    def _verify_base_info(info_id, info_type, target_type: str) -> tuple[int, bool]:
        info_id = 0 if info_id is None else int(str(info_id))
        flag = (not isinstance(info_type, str)) or (info_type != target_type) or (not isinstance(info_id, int))
        return info_id, flag

    if not isinstance(obj, dict):
        return False
    
    data_list = obj.get('data')
    if not isinstance(data_list, list):
        return False
    
    for entry in data_list:
        if not isinstance(entry, dict):
            continue

        entry_id, entry_type, entry_attrs, entry_relations = _base_info(entry)
        entry_id, entry_flag = _verify_base_info(entry_id, entry_type, 'songs')
        if entry_flag:
            continue

        entry_props = {}
        if isinstance(entry_attrs, dict):
            entry_props['album.name'] = entry_attrs.get('albumName')
            entry_props['artwork'] = _artwork_url(entry_attrs)
            entry_props['locale'] = entry_attrs.get('audioLocale')
            entry_props['disc'] = entry_attrs.get('discNumber', 0)
            entry_props['duration'] = entry_attrs.get('durationInMillis', 0)
            entry_props['isrc'] = entry_attrs.get('isrc')
            entry_props['name'] = entry_attrs.get('name', '')
            entry_props['audio'] = entry_attrs.get('previews', [{}])[0].get('url')
            entry_props['date'] = datetime.strptime(entry_attrs.get('releaseDate', '0001-01-01'), '%Y-%m-%d')
            entry_props['track'] = entry_attrs.get('trackNumber', 0)
            entry_props['album.id'] = entry_attrs.get('url', '').split('?i=')[0].split('/')[-1]
        
        if isinstance(entry_relations, dict):
            artist_list = entry_relations.get('artists', {}).get('data')
            if isinstance(artist_list, list):

                entry_artists = []
                for artist in artist_list:
                    if not isinstance(artist, dict):
                        continue

                    artist_id, artist_type, artist_attrs, _ = _base_info(artist)
                    artist_id, artist_flag = _verify_base_info(artist_id, artist_type, 'artists')
                    if artist_flag:
                        continue

                    if isinstance(artist_attrs, dict):
                        artist_identity = Identity(
                            id = artist_id,
                            name = Localization.create(locale, artist_attrs.get('name', '')),
                            artwork = _artwork_url(artist_attrs)
                        )
                        entry_artists.append(artist_identity)

                entry_props['artist'] = entry_artists

        album = Identity(
            id = int(entry_props.get('album.id', 0)),
            name = Localization.create(locale, entry_props.get('album.name')),
            artwork = entry_props.get('artwork')
        )

        song = Song(
            id = entry_id,
            name = Localization.create(locale, entry_props.get('name')),
            album = album,
            artist = entry_props.get('artist', []),
            artwork = entry_props.get('artwork'),
            audio = entry_props.get('audio'),
            date = None if entry_props.get('date', datetime(1, 1, 1)).date() == datetime(1, 1, 1).date() else entry_props['date'],
            disc = entry_props.get('disc', 0),
            duration = entry_props.get('duration', 0),
            isrc = entry_props.get('isrc'),
            locale = entry_props.get('locale'),
            track = entry_props.get('track', 0)
        )

        song_index = pool.get(song.id)
        if isinstance(song_index, int):
            songs[song_index].merge_locale(song)

        else:
            pool[song.id] = len(songs)
            songs.append(song)

    return True if obj.get('next', False) else False

def gather_data(profiles: list[tuple[str, str]], dev_token: str, playlist_id: str, verbose: bool = True) -> list[Song]:
    try:
        test_res = request_data(QUERY_TEST_URL, dev_token)
        if test_res.status_code != 200:
            raise requests.exceptions.HTTPError(f'The API returned invalid status code:\n{test_res.content}')

    except Exception as ex:
        print('>   An exception occured:')
        print(f'>   {ex}')
        return []

    songs = []
    song_index_map = {}
    fail_counter = 0
    for profile in profiles:
        if verbose:
            print(f'>   Collecting profile: (region: {profile[0]}, locale: {profile[1]})')
        
        offset = 0
        while fail_counter < 3:
            has_next = True

            try:
                while has_next:
                    res = request_data(QUERY_URL.format(profile[0], playlist_id, profile[1], offset), dev_token)
                    has_next = extract_data(json.loads(res.content), profile[1], songs, song_index_map)
                    offset += 300
                break

            except requests.exceptions.HTTPError as ex:
                fail_counter += 1
                if fail_counter < 3:
                    print('>   Retrying...')
                    time.sleep(1)
                else:
                    print('>   Failed count reached 3 times. Exiting...')
                    print(f'>   Last error run info - Region: {profile[0]}, Locale: {profile[1]}, Playlist: {playlist_id}, Offset: {offset}')
                    return songs

    return songs

def request_data(url: str, dev_token: str) -> requests.Response:
    res = PUBLIC_SESSION.get(url, headers={
        'Authorization': f'Bearer {dev_token}',
        'Origin': 'https://music.apple.com',
        'Referer': 'https://music.apple.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0'
    }, timeout = 30)
    res.raise_for_status()
    return res
