from __future__ import annotations

LOCALIZATION_ORDER = ('en', 'zt', 'zs', 'ja', 'ko', 'fr')

def determine_raw_names(raw_json: dict) -> tuple[str, str, str]:
    '''
    Determine raw_album, raw_artist, and raw_title for an entry.
    '''
    if not isinstance(raw_json, dict):
        raise ValueError('raw_json must be a dict.')

    songs = _get_collection(raw_json, 'songs')
    albums = _get_collection(raw_json, 'albums')
    artists = _get_collection(raw_json, 'artists')
    if len(songs) != 1:
        raise ValueError('raw_json must contain exactly one song.')

    song = songs[0]
    if not isinstance(song, dict):
        raise ValueError('raw_json.songs must contain dict items.')

    album_by_id = _index_by_id(albums, 'albums')
    artist_by_id = _index_by_id(artists, 'artists')

    raw_title = _select_song_title(song)
    raw_album = _select_album_title(song, album_by_id)
    raw_artist = _select_artist_names(song, artist_by_id)

    return raw_album, raw_artist, raw_title


def _get_collection(raw_json: dict, key: str) -> list:
    value = raw_json.get(key)
    if not isinstance(value, list):
        raise ValueError(f'raw_json.{key} must be a list.')
    return value


def _index_by_id(items: list, collection_name: str) -> dict[str, dict]:
    result = {}
    for item in items:
        if not isinstance(item, dict):
            raise ValueError(f'raw_json.{collection_name} must contain dict items.')
        item_id = item.get('id')
        if item_id is not None:
            result[str(item_id)] = item
    return result


def _select_song_title(song: dict) -> str:
    title = song.get('title')
    locale = song.get('locale')
    if isinstance(title, dict):
        selected = _select_localized_text(title, preferred_locale = locale, prefer_english = False)
        if selected:
            return selected
    if isinstance(title, str):
        return title
    return ''


def _select_album_title(song: dict, album_by_id: dict[str, dict]) -> str:
    album_id = song.get('albumID')
    album = album_by_id.get(str(album_id))
    if not isinstance(album, dict):
        return ''

    title = album.get('title')
    if isinstance(title, dict):
        selected = _select_localized_text(title, prefer_english = True)
        if selected:
            return selected
    if isinstance(title, str):
        return title
    return ''


def _select_artist_names(song: dict, artist_by_id: dict[str, dict]) -> str:
    artist_ids = song.get('artistID')
    if not isinstance(artist_ids, list):
        return ''

    names = []
    for artist_id in artist_ids:
        artist = artist_by_id.get(str(artist_id))
        if not isinstance(artist, dict):
            continue

        title = artist.get('title')
        if isinstance(title, dict):
            name = _select_localized_text(title, prefer_english = True)
        elif isinstance(title, str):
            name = title
        else:
            name = ''

        if name:
            names.append(name)

    return ', '.join(names)


def _select_localized_text(
    values: dict,
    preferred_locale: str | None = None,
    prefer_english: bool = True,
) -> str:
    if preferred_locale:
        selected = _get_localized_value(values, preferred_locale)
        if selected:
            return selected

    if prefer_english:
        selected = _get_localized_value(values, 'en')
        if selected:
            return selected

    unique_values = {
        value
        for value in values.values()
        if isinstance(value, str) and value
    }
    if len(unique_values) == 1:
        return next(iter(unique_values))

    for locale in LOCALIZATION_ORDER:
        selected = _get_localized_value(values, locale)
        if selected:
            return selected

    for value in values.values():
        if isinstance(value, str) and value:
            return value

    return ''


def _get_localized_value(values: dict, locale: str) -> str:
    key = _normalize_locale_key(locale)
    value = values.get(key)
    return value if isinstance(value, str) else ''


def _normalize_locale_key(locale: str) -> str:
    locale = locale.lower()
    if locale.startswith('en'):
        return 'en'
    if locale.startswith('fr'):
        return 'fr'
    if locale.startswith('ja'):
        return 'ja'
    if locale.startswith('ko'):
        return 'ko'
    if locale in {'zt', 'zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'}:
        return 'zt'
    if locale in {'zh', 'zs', 'zh-hans', 'zh-cn', 'zh-my', 'zh-sg'}:
        return 'zs'
    return locale
