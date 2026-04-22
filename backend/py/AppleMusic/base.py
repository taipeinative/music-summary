from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import json
from pathlib import Path

# Models

@dataclass
class Identity:
    '''
    The common descripters for albums, artists, and songs.
    '''
    id: int
    name: Localization
    artwork: str | None = None

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
class Song(Identity):
    '''
    The track info.
    '''
    album: Identity | None = None
    artist: list[Identity] = field(default_factory = lambda: [])
    audio: str | None = None
    count: int = 0
    date: datetime | None = None
    disc: int = 0
    duration: int = 0
    isrc: str | None = None
    locale: str | None = None
    track: int = 0

    def merge_locale(self, other: Song) -> None:
        not_presented_locales = other.name.defined_locales() - self.name.defined_locales()
        if len(not_presented_locales) == 0:
            return
        
        other_ids = {artist.id: i for i, artist in enumerate(other.artist)}

        for locale in not_presented_locales:
            self.name[locale] = other.name[locale]
            if isinstance(self.album, Identity) and isinstance(other.album, Identity):
                self.album.name[locale] = other.album.name[locale]

            for artist in self.artist:
                if artist.id in other_ids.keys():
                    artist.name[locale] = other.artist[other_ids[artist.id]].name[locale]

        other_only_artists = [new_artists for new_artists in other_ids.keys() if new_artists not in [artist.id for artist in self.artist]]
        for other_only_artist in other_only_artists:
            self.artist.append(other.artist[other_only_artist])

    def __repr__(self) -> str:
        return f'Song({self.id}, name: {self.name}, artist: {self.artist})'

# Encoder & Decoder

class Encoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Song):
            return {
                'id': o.id,
                'nm': o.name,
                'ad': o.audio,
                'al': o.album,
                'at': o.artist,
                'aw': o.artwork,
                'dc': o.disc,
                'du': o.duration,
                'dt': o.date,
                'is': o.isrc,
                'lc': o.locale,
                'pc': o.count,
                'tr': o.track
            }
        
        if isinstance(o, Identity):
            return {
                'id': o.id,
                'nm': o.name,
                'aw': o.artwork
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

def _to_localization(value: Localization | dict | str | None) -> Localization:
    if isinstance(value, Localization):
        return value
    if isinstance(value, dict):
        return Localization(
            en=value.get('en'),
            fr=value.get('fr'),
            ja=value.get('ja'),
            ko=value.get('ko'),
            zs=value.get('zs'),
            zt=value.get('zt')
        )
    if isinstance(value, str):
        return Localization(en=value)
    return Localization()

def _to_identity(value: Identity | dict | None) -> Identity | None:
    if value is None:
        return None
    if isinstance(value, Identity):
        return value
    return Identity(
        id=int(value['id']),
        name=_to_localization(value.get('nm', value.get('name'))),
        artwork=value.get('aw', value.get('artwork'))
    )

def _to_song(value: Song | dict) -> Song:
    if isinstance(value, Song):
        return value

    raw_date = value.get('dt', value.get('date'))
    parsed_date = None
    if isinstance(raw_date, str) and raw_date:
        parsed_date = datetime.fromisoformat(raw_date)

    artist_list: list[Identity] = []
    artist_value = value.get('at', value.get('artist', []))
    for artist in artist_value:
        item = _to_identity(artist)
        if item is not None:
            artist_list.append(item)

    return Song(
        id=int(value['id']),
        artwork=value.get('aw', value.get('artwork', '')),
        name=_to_localization(value.get('nm', value.get('name'))),
        album=_to_identity(value.get('al', value.get('album'))),
        artist=artist_list,
        audio=value.get('ad', value.get('audio')),
        count=int(value.get('pc', value.get('count', 0))),
        date=parsed_date,
        disc=int(value.get('dc', value.get('disc', 0))),
        duration=int(value.get('du', value.get('duration', 0))),
        isrc=value.get('is', value.get('isrc')),
        locale=value.get('lc', value.get('locale')),
        track=int(value.get('tr', value.get('track', 0)))
    )

class Decoder(json.JSONDecoder):
    def __init__(self, *args, **kwargs):
        super().__init__(object_hook=self._decode_object, *args, **kwargs)

    def _decode_object(self, obj):
        if {'en', 'fr', 'ja', 'ko', 'zs', 'zt'} & obj.keys():
            return _to_localization(obj)

        if {'ad', 'al', 'at', 'dc', 'du', 'is', 'lc', 'pc', 'tr'} & obj.keys():
            return _to_song(obj)

        if 'id' in obj and 'nm' in obj:
            return _to_identity(obj)

        return obj

# Loader / Dumper

def _to_local_path(url: str | Path) -> Path:
    fp = Path(url)
    if not fp.is_absolute():
        fp = Path().absolute() / fp
    return fp

def load(url: str | Path, *args, **kwargs):
    '''
    Loads custom-typed JSON.
    '''
    kwargs.setdefault('cls', Decoder)
    fp = _to_local_path(url)
    if not fp.exists() or not fp.is_file():
        raise ValueError(f'Invalid URL or path: file does not exist: {url}')

    with open(fp, 'r', encoding='utf-8') as f:
        return json.load(f, *args, **kwargs)

def dump(obj, url: str | Path, *args, **kwargs):
    '''
    Dumps custom-typed JSON.
    '''
    kwargs.setdefault('cls', Encoder)
    fp = _to_local_path(url)
    fp.parent.mkdir(parents=True, exist_ok=True)

    with open(fp, 'w+', encoding='utf-8') as f:
        return json.dump(obj, f, *args, **kwargs)
