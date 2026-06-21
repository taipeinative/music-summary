from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import json
from pathlib import Path
import time
from typing import TypeVar

from bs4 import BeautifulSoup
from bs4.element import Tag
import requests

# Models

@dataclass
class Identity:
    '''
    The common descripters for albums, artists, and songs.
    '''
    id: str
    name: Localization

    def __repr__(self) -> str:
        return f'ID({self.id}, name: {self.name})'
    
@dataclass
class Localization:
    '''
    The localized names.
    '''
    en: str | None = None
    fr: str | None = None
    ja: str | None = None
    ko: str | None = None
    zs: str | None = None
    zt: str | None = None

    @staticmethod
    def create(locale: str, text: str | None) -> Localization:
        localization = Localization()
        localization[locale] = text
        return localization
    
    def defined_locales(self) -> set[str]:
        defined = set()
        if self.en is not None:
            defined.add('en')
        if self.fr is not None:
            defined.add('fr')
        if self.ja is not None:
            defined.add('ja')
        if self.ko is not None:
            defined.add('ko')
        if self.zs is not None:
            defined.add('zs')
        if self.zt is not None:
            defined.add('zt')
        return defined

    @staticmethod
    def literal(locale: str) -> str:
        if locale == 'en':
            return 'ᴇɴ'
        if locale == 'fr':
            return 'ꜰʀ'
        if locale == 'ja':
            return 'ᴊᴀ'
        if locale == 'ko':
            return 'ᴋᴏ'
        if locale == 'zs':
            return 'ᴢʜ-ʜᴀɴꜱ'
        if locale == 'zt':
            return 'ᴢʜ-ʜᴀɴᴛ'
        raise ValueError

    def __getitem__(self, key):
        if not isinstance(key, str):
            raise IndexError()
        
        key = key.lower()
        if key.startswith('en'):
            return self.en
        elif key.startswith('fr'):
            return self.fr
        elif key.startswith('ja'):
            return self.ja
        elif key.startswith('ko'):
            return self.ko
        elif (key == 'zh') or (key == 'zs') or key.startswith('zh-hans') or (key in {'zh-cn', 'zh-my', 'zh-sg'}):
            return self.zs
        elif (key == 'zt') or key.startswith('zh-hant') or (key in {'zh-hk', 'zh-mo', 'zh-tw'}):
            return self.zt
        else:
            raise IndexError()

    def __setitem__(self, key, value):
        if not isinstance(key, str):
            raise IndexError()
        
        key = key.lower()
        if key.startswith('en'):
            self.en = value
        elif key.startswith('fr'):
            self.fr = value
        elif key.startswith('ja'):
            self.ja = value
        elif key.startswith('ko'):
            self.ko = value
        elif (key == 'zh') or (key == 'zs') or key.startswith('zh-hans') or (key in {'zh-cn', 'zh-my', 'zh-sg'}):
            self.zs = value
        elif (key == 'zt') or key.startswith('zh-hant') or (key in {'zh-hk', 'zh-mo', 'zh-tw'}):
            self.zt = value
        else:
            raise IndexError()
    
    def __repr__(self) -> str:
        return '; '.join([f'{self[defined]} <{Localization.literal(defined)}>' for defined in self.defined_locales()])

@dataclass
class Album(Identity):
    '''
    The album info.
    '''
    artists: list[str] = field(default_factory = lambda: [])
    artwork: str | None = None
    compilation: bool = False
    date: datetime | None = None
    disc_count: int = 0
    prerelease: bool = False
    single: bool = False
    tracks: list[str] = field(default_factory = lambda: [])
    track_count: dict[int, int] = field(default_factory = lambda: {})
    upc: str | None = None

    def __repr__(self) -> str:
        return f'Album({self.id}, name: {self.name}, artist: {self.artists})'

@dataclass
class Artist(Identity):
    '''
    The artist info.
    '''
    artwork: str | None = None

    def __repr__(self) -> str:
        return f'Artist({self.id}, name: {self.name})'

@dataclass
class Song(Identity):
    '''
    The track info.
    '''
    album: str | None = None
    artists: list[str] = field(default_factory = lambda: [])
    audio: str | None = None
    date: datetime | None = None
    disc_number: int = 0
    duration: int = 0
    isrc: str | None = None
    locale: str | None = None
    play_count: int = 0
    track_number: int = 0

    def __repr__(self) -> str:
        return f'Song({self.id}, name: {self.name}, artist: {self.artists})'

# Encoder

class Encoder(json.JSONEncoder):
    def default(self, o):
        def _get_artwork_url(input: str | None) -> str | None:
            return '/'.join(input.split('/')[:-1]) if isinstance(input, str) else None

        if isinstance(o, Album):
            return {
                'id': o.id,
                'title': o.name,
                'artistID': o.artists,
                'artwork': _get_artwork_url(o.artwork),
                'compilation': o.compilation,
                'discCount': o.disc_count,
                'preRelease': o.prerelease,
                'releaseDate': o.date,
                'single': o.single,
                'trackCount': o.track_count,
                'upc': o.upc
            }

        if isinstance(o, Artist):
            return {
                'id': o.id,
                'title': o.name,
                'artwork': _get_artwork_url(o.artwork)
            }

        if isinstance(o, Song):
            return {
                'id': o.id,
                'title': o.name,
                'audio': o.audio,
                'albumID': o.album,
                'artistID': o.artists,
                'discNumber': o.disc_number,
                'duration': o.duration,
                'isrc': o.isrc,
                'locale': o.locale,
                'playCount': o.play_count,
                'releaseDate': o.date,
                'trackNumber': o.track_number
            }
        
        if isinstance(o, Identity):
            return {
                'id': o.id,
                'title': o.name
            }
        
        if isinstance(o, Localization):
            return {
                'en': o.en,
                'fr': o.fr,
                'ja': o.ja,
                'ko': o.ko,
                'zs': o.zs,
                'zt': o.zt
            }
        
        if isinstance(o, datetime):
            return o.strftime('%Y-%m-%d')
        
        return super().default(o)

def _to_local_path(url: str | Path) -> Path:
    fp = Path(url)
    if not fp.is_absolute():
        fp = HERE / fp
    return fp

def dump(obj, url: str | Path, *args, **kwargs):
    '''
    Dumps custom-typed JSON.
    '''
    kwargs.setdefault('cls', Encoder)
    fp = _to_local_path(url)
    fp.parent.mkdir(parents=True, exist_ok=True)

    with open(fp, 'w+', encoding='utf-8') as f:
        return json.dump(obj, f, *args, **kwargs)

GENERIC = TypeVar('GENERIC')
HERE = Path().absolute()
PUBLIC_SESSION = requests.Session()
QUERY_TEST_URL = r'https://amp-api.music.apple.com/v1/test'
QUERY_URL = r'https://amp-api.music.apple.com/v1/catalog/{}/playlists/{}/tracks?format[resources]=map&l={}&include[albums]=artists,tracks&include[songs]=albums,artists&fields[artists]=artwork,name,url&limit=300&offset={}'

def _combine_localization(left: GENERIC, right: GENERIC) -> GENERIC:
    if not isinstance(left, Identity) or not isinstance(right, Identity):
        raise TypeError()
    
    not_presented_locales = right.name.defined_locales() - left.name.defined_locales()
    for locale in not_presented_locales:
        left.name[locale] = right.name[locale]

    return left

def _join_latest(collection: dict[str, GENERIC], key: str, obj: GENERIC) -> None:
    original = collection.get(key)
    if isinstance(original, Identity):
        collection[key] = _combine_localization(original, obj)
    else:
        collection[key] = obj

def _get_item(parent: list, index: int, expected: type[GENERIC]) -> GENERIC:
    assert len(parent) > index
    item = parent[index]
    assert isinstance(item, expected)
    return item

def _get_property(parent: dict, name: str, expected: type[GENERIC], assertion_exception: bool = True) -> GENERIC:
    item = parent.get(name)
    if assertion_exception:
        assert isinstance(item, expected)
    elif not isinstance(item, expected):
        raise TypeError()
    return item

def dump_data(url: str | Path, albums: dict[str, Album], artists: dict[str, Artist], songs: dict[str, Song]) -> None:
    def _sort_collection(objs: dict[str, GENERIC]) -> list[GENERIC]:
        return [obj[1] for obj in sorted(objs.items(), key = lambda x: int(x[0]))]

    input_url = Path(url)
    if not input_url.is_absolute():
        input_url = HERE / input_url
    
    data = {
        'source': 'APPLE_MUSIC',
        'time': datetime.now().strftime('%Y-%m-%dT%H:%M:%S%z'),
        'artists': _sort_collection(artists),
        'albums': _sort_collection(albums),
        'songs': _sort_collection(songs)
    }

    dump(data, input_url, ensure_ascii = False, indent = 2)

def extract_data(obj, locale: str, albums: dict[str, Album], artists: dict[str, Artist], songs: dict[str, Song]) -> bool:        
    def _as_bool(obj: bool | None) -> bool:
        return obj if isinstance(obj, bool) else False
    
    def _as_datetime(obj: str | None) -> datetime:
        return datetime.strptime(date_str := obj if isinstance(obj, str) else '0001-01-01', '%Y-%m-%d' if len(date_str) == 10 else ('%Y-%m' if len(date_str) == 7 else '%Y'))
    
    def _as_int(obj: int | None) -> int:
        return obj if isinstance(obj, int) else 0

    def _get_attribute(parent: dict, kind: str, expected: type[GENERIC]) -> GENERIC | None:
        attributes = _get_property(parent, 'attributes', dict)

        try:
            if kind == 'artwork':
                artwork_data = _get_property(attributes, kind, dict, assertion_exception = False)
                return _get_property(artwork_data, 'url', expected, assertion_exception = False)
            
            if kind == 'previews':
                preview_data = _get_item(_get_property(attributes, kind, list, assertion_exception = False), 0, dict)
                return _get_property(preview_data, 'url', expected, assertion_exception = False)
        
            return _get_property(attributes, kind, expected, assertion_exception = False)
        
        except TypeError:
            return
    
    def _get_relationship(parent: dict, kind: str) -> list[str]:
        relationships = _get_property(parent, 'relationships', dict)
        kind_map = _get_property(relationships, kind, dict)

        try:
            kind_data = _get_property(kind_map, 'data', list, assertion_exception = False)

        except TypeError:
            return []
        
        item_ids: list[str] = []

        for item in kind_data:
            if isinstance(item, dict):
                item_id = item.get('id')
                if isinstance(item_id, str):
                    item_ids.append(item_id)

        return item_ids

    def _parse_album(obj: dict, locale: str) -> Album:
        album_id = _get_property(obj, 'id', str)
        album_artists = _get_relationship(obj, 'artists')
        album_tracks = _get_relationship(obj, 'tracks')
        album_artwork = _get_attribute(obj, 'artwork', str)
        album_compilation = _get_attribute(obj, 'isCompilation', bool)
        album_date = _get_attribute(obj, 'releaseDate', str)
        album_name = _get_attribute(obj, 'name', str)
        album_prerelease = _get_attribute(obj, 'isPrerelease', bool)
        album_single = _get_attribute(obj, 'isSingle', bool)
        album_upc = _get_attribute(obj, 'upc', str)

        return Album(
            id = album_id,
            name = Localization.create(locale, album_name),
            artists = album_artists,
            artwork = album_artwork,
            compilation = _as_bool(album_compilation),
            date = _as_datetime(album_date),
            prerelease = _as_bool(album_prerelease),
            single = _as_bool(album_single),
            tracks = album_tracks,
            upc = album_upc
        )

    def _parse_artist(obj: dict, locale: str) -> Artist:
        artist_id = _get_property(obj, 'id', str)
        artist_artwork = _get_attribute(obj, 'artwork', str)
        artist_name = _get_attribute(obj, 'name', str)

        return Artist(
            id = artist_id,
            name = Localization.create(locale, artist_name),
            artwork = artist_artwork
        )

    def _parse_song(obj: dict, locale: str) -> Song:
        song_id = _get_property(obj, 'id', str)
        song_album = _get_item(_get_relationship(obj, 'albums'), 0, str)
        song_artists = _get_relationship(obj, 'artists')
        song_audio = _get_attribute(obj, 'previews', str)
        song_date = _get_attribute(obj, 'releaseDate', str)
        song_disc = _get_attribute(obj, 'discNumber', int)
        song_duration = _get_attribute(obj, 'durationInMillis', int)
        song_isrc = _get_attribute(obj, 'isrc', str)
        song_locale = _get_attribute(obj, 'audioLocale', str)
        song_name = _get_attribute(obj, 'name', str)
        song_track = _get_attribute(obj, 'trackNumber', int)

        return Song(
            id = song_id,
            name = Localization.create(locale, song_name),
            album = song_album,
            artists = song_artists,
            audio = song_audio,
            date = _as_datetime(song_date),
            disc_number = _as_int(song_disc),
            duration = _as_int(song_duration),
            isrc = song_isrc,
            locale = song_locale,
            track_number = _as_int(song_track)
        )

    try:
        assert isinstance(obj, dict)
    
        # Basic integrity
        data_list = _get_property(obj, 'data', list)
        mentioned_tracks: set[str] = {id_val for item in data_list if isinstance(item, dict) and isinstance(id_val := item.get('id'), str)}
        
        # Resource validation
        resource_map = _get_property(obj, 'resources', dict)
        album_map = _get_property(resource_map, 'albums', dict)
        artist_map = _get_property(resource_map, 'artists', dict)
        song_map = _get_property(resource_map, 'songs', dict)

        # Collect data
        album_pool: dict[str, Album] = {}
        for album_id, album_data in album_map.items():
            if isinstance(album_id, str):
                album_pool[album_id] = _parse_album(album_data, locale)

        artist_pool: dict[str, Artist] = {}
        for artist_id, artist_data in artist_map.items():
            if isinstance(artist_id, str):
                artist_pool[artist_id] = _parse_artist(artist_data, locale)

        song_pool: dict[str, Song] = {}
        for song_id, song_data in song_map.items():
            if isinstance(song_id, str):
                song_pool[song_id] = _parse_song(song_data, locale)
    
        # Filter data
        mentioned_albums: set[str] = set()
        mentioned_artists: set[str] = set()
        
        for song_id in mentioned_tracks:
            if not isinstance(song_id, str):
                continue

            song_obj = song_pool.get(song_id)
            if not isinstance(song_obj, Song):
                continue

            _join_latest(songs, song_id, song_obj)
            if isinstance(song_obj.album, str):
                mentioned_albums.add(song_obj.album)
            
            for song_artist in song_obj.artists:
                if isinstance(song_artist, str):
                    mentioned_artists.add(song_artist)
        
        for album_id in mentioned_albums:
            if not isinstance(album_id, str):
                continue

            album_obj = album_pool.get(album_id)
            if not isinstance(album_obj, Album):
                continue

            track_count: dict[int, int] = {}
            for track_id in album_obj.tracks:
                if not isinstance(track_id, str):
                    continue

                track_obj = song_pool.get(track_id)
                if not isinstance(track_obj, Song):
                    continue
                
                disc_number = track_obj.disc_number
                if disc_number != 0:
                    track_count[disc_number] = track_count.get(disc_number, 0) + 1

            album_obj.disc_count = len(track_count)
            album_obj.track_count = track_count

            _join_latest(albums, album_id, album_obj)
            if not album_obj.compilation:
                for album_artist in album_obj.artists:
                    if isinstance(album_artist, str):
                        mentioned_artists.add(album_artist)

        for artist_id in mentioned_artists:
            if not isinstance(artist_id, str):
                continue

            artist_obj = artist_pool.get(artist_id)
            if not isinstance(artist_obj, Artist):
                continue

            _join_latest(artists, artist_id, artist_obj)

    except AssertionError:
        return False

    # Check whether there are unloaded contents
    return isinstance(obj.get('next'), str)

def gather_data(profiles: list[tuple[str, str]], dev_token: str, playlist_id: str, verbose: bool = True) -> tuple[dict[str, Album], dict[str, Artist], dict[str, Song]]:
    try:
        test_res = request_data(QUERY_TEST_URL, dev_token)
        if test_res.status_code != 200:
            raise requests.exceptions.HTTPError(f'The API returned invalid status code:\n{test_res.content}')
    
    except Exception as ex:
        print('>   An exception occured:')
        print(f'>   {ex}')
        return {}, {}, {}
    
    albums = {}
    artists = {}
    songs = {}
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
                    has_next = extract_data(json.loads(res.content), profile[1], albums, artists, songs)
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
                    return albums, artists, songs
    
    return albums, artists, songs

def request_data(url: str, dev_token: str) -> requests.Response:
    res = PUBLIC_SESSION.get(url, headers={
        'Authorization': f'Bearer {dev_token}',
        'Origin': 'https://music.apple.com',
        'Referer': 'https://music.apple.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0'
    }, timeout = 30)
    res.raise_for_status()
    return res

class Alternate:
    '''
    The alternate mode that manually perform web-crawling on Apple Music site.
    '''

    ITUNES_REQUEST_ID_COUNT = 150
    ITUNES_REQUEST_INTERVAL = 2
    API_REQUEST_ATTEMPTS = 3
    ITUNES_ALBUM_URL = r'https://itunes.apple.com/lookup?media=music&entity=album&country={}&id={}'
    ITUNES_ARTIST_URL = r'https://itunes.apple.com/lookup?media=music&entity=musicArtist&country={}&id={}'
    ITUNES_TRACK_URL = r'https://itunes.apple.com/lookup?media=music&entity=musicTrack&country={}&id={}'
    PLAYLIST_URL = r'https://music.apple.com/{}/playlist/{}?l={}'

    @staticmethod
    def extract_data(obj, locale: str, albums: dict[str, Album], artists: dict[str, Artist], songs: dict[str, Song]) -> bool:
        def _get_attribute(parent: dict, kind: str, expected: type[GENERIC]) -> GENERIC | None:
            target = parent.get(kind)
            if not isinstance(target, expected):
                return None
            return target
        
        def _get_id(link_data: dict, one_step: bool = False) -> str:
            id_data = link_data
            if not one_step:
                id_data = link_data['segue']['destination']
            return str(id_data['contentDescriptor']['identifiers']['storeAdamID'])

        def _parse_track(obj: dict, locale: str) -> tuple[Album | None, list[Artist], Song | None]:
            song_name = _get_attribute(obj, 'title', str)
            song_duration = _get_attribute(obj, 'duration', int)
            song_id = _get_id(obj, one_step = True)
            song_obj: Song | None = None

            artist_objs: list[Artist] = []
            artist_links = obj.get('subtitleLinks')
            if isinstance(artist_links, list):
                for artist_link in artist_links:
                    if not isinstance(artist_link, dict):
                        continue

                    artist_id = _get_id(artist_link)
                    artist_name = artist_link.get('title')
                    if (artist_id is not None) and (artist_name is not None):
                        artist_obj = Artist(
                            id = artist_id,
                            name = Localization.create(locale, artist_name)
                        )
                        artist_objs.append(artist_obj)

            album_artwork: str | None = None
            album_id: str | None = None
            album_name: str | None = None
            album_links = obj.get('tertiaryLinks')
            if isinstance(album_links, list):
                album_link = _get_item(album_links, 0, dict)
                album_id = _get_id(album_link)
                album_name = _get_attribute(album_link, 'title', str)
                album_artwork = _get_property(_get_property(_get_property(obj, 'artwork', dict), 'dictionary', dict), 'url', str)

            album_obj: Album | None = None
            if (album_id is not None) and (album_name is not None):
                album_obj = Album(
                    id = album_id,
                    name = Localization.create(locale, album_name),
                    artwork = album_artwork
                )

            if ((song_id is not None) and
                (song_name is not None) and
                (song_duration is not None) and
                (album_obj is not None) and
                (len(artist_objs) > 0)):
                song_obj = Song(
                    id = song_id,
                    name = Localization.create(locale, song_name),
                    album = album_id,
                    artists = [artist.id for artist in artist_objs],
                    duration = song_duration
                )
            
            return album_obj, artist_objs, song_obj

        try:
            assert isinstance(obj, list)
            data = _get_property(_get_item(_get_property(_get_item(obj, 0, dict), 'data', list), 0, dict), 'data', dict)
            sections = _get_property(data, 'sections', list)

            tracks: list = []
            for section in sections:
                if not isinstance(section, dict):
                    continue

                section_id = section.get('id')
                if not isinstance(section_id, str) or not section_id.startswith('track-list - '):
                    continue

                section_items = section.get('items')
                if not isinstance(section_items, list):
                    continue

                tracks = section_items
                break

            assert len(tracks) > 0
            for track in tracks:
                if not isinstance(track, dict):
                    continue

                track_composite_id = track.get('id')
                if not isinstance(track_composite_id, str) or not track_composite_id.startswith('track-lockup - '):
                    continue

                album_obj, artist_list, song_obj = _parse_track(track, locale)
                if not (isinstance(album_obj, Album) and isinstance(song_obj, Song) and len(artist_list) > 0):
                    continue

                _join_latest(albums, album_obj.id, album_obj)
                _join_latest(songs, song_obj.id, song_obj)
                [_join_latest(artists, artist_obj.id, artist_obj) for artist_obj in artist_list]

        except AssertionError:
            return False

        return False

    @staticmethod
    def gather_data(profiles: list[tuple[str, str]], playlist_id: str, verbose: bool = True) -> tuple[dict[str, Album], dict[str, Artist], dict[str, Song]]:
        def _chunk_ids(ids: list[str]) -> list[str]:
            size = Alternate.ITUNES_REQUEST_ID_COUNT
            return [','.join(ids[start:start + size]) for start in range(0, len(ids), size)]

        def _request_with_retry(url: str, retry_interval: int) -> requests.Response:
            attempt = 1
            while True:
                try:
                    return Alternate.request_data(url)
                except requests.exceptions.RequestException:
                    if attempt >= Alternate.API_REQUEST_ATTEMPTS:
                        raise
                    print('>   Retrying...')
                    time.sleep(retry_interval)
                    attempt += 1

        albums: dict[str, Album] = {}
        artists: dict[str, Artist] = {}
        songs: dict[str, Song] = {}
        for profile in profiles:
            if verbose:
                print(f'>   Collecting profile: (region: {profile[0]}, locale: {profile[1]})')

            try:
                res = _request_with_retry(Alternate.PLAYLIST_URL.format(profile[0], playlist_id, profile[1]), 1)
                _ = Alternate.extract_data(Alternate.parse_data(res), profile[1], albums, artists, songs)

            except requests.exceptions.RequestException:
                print(f'>   Failed count reached {Alternate.API_REQUEST_ATTEMPTS} times. Exiting...')
                print(f'>   Last error run info - Region: {profile[0]}, Locale: {profile[1]}, Playlist: {playlist_id}')
                return albums, artists, songs
        
        song_query_ids = _chunk_ids([str(song.id) for song in songs.values()])

        album_disc_counts: dict[str, int] = {}
        album_track_counts: dict[str, dict[int, int]] = {}
        for profile in profiles:
            if verbose:
                print(f'>   Attaching song data to profile: (region: {profile[0]}, locale: {profile[1]})')
            
            for i, query_ids in enumerate(song_query_ids):
                try:
                    res = _request_with_retry(Alternate.ITUNES_TRACK_URL.format(profile[0], query_ids), Alternate.ITUNES_REQUEST_INTERVAL)
                    query = json.loads(res.content)
                    if not isinstance(query, dict):
                        continue

                    results = _get_property(query, 'results', list)
                    for result in results:
                        if not isinstance(result, dict):
                            continue

                        song_id = result.get('trackId')
                        if not isinstance(song_id, int):
                            continue

                        target_song = songs.get(str(song_id))
                        if not isinstance(target_song, Song):
                            continue

                        disc_number = int(result.get('discNumber', 0))
                        track_number = int(result.get('trackNumber', 0))

                        target_song.audio = result.get('previewUrl')
                        target_song.date = datetime.strptime(date_string, '%Y-%m-%dT%H:%M:%SZ') if isinstance(date_string := result.get('releaseDate'), str) else None
                        target_song.disc_number = disc_number
                        target_song.track_number = track_number

                        album_id = str(target_song.album)
                        disc_count = int(result.get('discCount', 0))
                        album_disc_counts[album_id] = disc_count

                        track_count = int(result.get('trackCount', 0))
                        album_track_count = album_track_counts.get(album_id, {})
                        album_track_count[disc_number] = track_count
                        album_track_counts[album_id] = album_track_count

                    if i != len(song_query_ids) - 1:
                        time.sleep(Alternate.ITUNES_REQUEST_INTERVAL)

                except requests.exceptions.RequestException:
                    print(f'>   Failed count reached {Alternate.API_REQUEST_ATTEMPTS} times. Exiting...')
                    print(f'>   Last error run info - Region: {profile[0]}, Locale: {profile[1]}, Playlist: {playlist_id}')
                    return albums, artists, songs
        
        album_query_ids = _chunk_ids([str(album.id) for album in albums.values()])
        album_artist_ids: set[str] = set()

        for profile in profiles:
            if verbose:
                print(f'>   Attaching album data to profile: (region: {profile[0]}, locale: {profile[1]})')
            
            for i, query_ids in enumerate(album_query_ids):
                try:
                    res = _request_with_retry(Alternate.ITUNES_ALBUM_URL.format(profile[0], query_ids), Alternate.ITUNES_REQUEST_INTERVAL)
                    query = json.loads(res.content)
                    if not isinstance(query, dict):
                        continue

                    results = _get_property(query, 'results', list)
                    for result in results:
                        if not isinstance(result, dict):
                            continue

                        album_id = result.get('collectionId')
                        if not isinstance(album_id, int):
                            continue

                        target_album = albums.get(str(album_id))
                        if not isinstance(target_album, Album):
                            continue

                        artist = str(artist_id) if isinstance(artist_id := result.get('artistId'), int) else None
                        target_album.artists = [artist] if isinstance(artist, str) else []
                        target_album.date = datetime.strptime(date_string, '%Y-%m-%dT%H:%M:%SZ') if isinstance(date_string := result.get('releaseDate'), str) else None
                        target_album.disc_count = album_disc_counts.get(str(album_id), 0)
                        target_album.track_count = album_track_counts.get(str(album_id), {})

                        if isinstance(artist, str):
                            album_artist_ids.add(artist)

                    if i != len(album_query_ids) - 1:
                        time.sleep(Alternate.ITUNES_REQUEST_INTERVAL)

                except requests.exceptions.RequestException:
                    print(f'>   Failed count reached {Alternate.API_REQUEST_ATTEMPTS} times. Exiting...')
                    print(f'>   Last error run info - Region: {profile[0]}, Locale: {profile[1]}, Playlist: {playlist_id}')
                    return albums, artists, songs

        artist_query_ids = _chunk_ids(sorted(album_artist_ids))
        for profile in profiles:
            if verbose:
                print(f'>   Attaching artist data to profile: (region: {profile[0]}, locale: {profile[1]})')

            for i, query_ids in enumerate(artist_query_ids):
                try:
                    res = _request_with_retry(Alternate.ITUNES_ARTIST_URL.format(profile[0], query_ids), Alternate.ITUNES_REQUEST_INTERVAL)
                    query = json.loads(res.content)
                    if not isinstance(query, dict):
                        continue

                    results = _get_property(query, 'results', list)
                    for result in results:
                        if not isinstance(result, dict):
                            continue

                        artist_id = result.get('artistId')
                        artist_name = result.get('artistName')
                        if not isinstance(artist_id, int) or not isinstance(artist_name, str):
                            continue

                        artist = str(artist_id)
                        _join_latest(artists, artist, Artist(id = artist, name = Localization.create(profile[1], artist_name)))

                    if i != len(artist_query_ids) - 1:
                        time.sleep(Alternate.ITUNES_REQUEST_INTERVAL)

                except requests.exceptions.RequestException:
                    print(f'>   Failed count reached {Alternate.API_REQUEST_ATTEMPTS} times. Exiting...')
                    print(f'>   Last error run info - Region: {profile[0]}, Locale: {profile[1]}, Playlist: {playlist_id}')
                    return albums, artists, songs

        return albums, artists, songs

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
