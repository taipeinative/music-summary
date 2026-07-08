import json
import re
from enum import Enum, Flag
from typing import Any, Mapping

GENRE_MAP = {
    'Classical': 'CLASSICAL',
    'Country': 'COUNTRY',
    'Dance': 'DANCE',
    'Hip Hop/Rap': 'HIPHOP',
    'Instrumental': 'INSTRUMENTAL',
    'Pop': 'POP',
    'R&B/Soul': 'RNB',
    'Rock': 'ROCK'
}

MEDIA_MAP = {
    'Soundtrack.Anime': 'ANIME',
    'Soundtrack.Drama': 'DRAMA',
    'Soundtrack.VideoGame': 'GAME',
    'Soundtrack.VideoGame.Arcaea': 'ARCAEA',
    'Soundtrack.VideoGame.CitiesSkylines': 'CITIES',
    'Soundtrack.VideoGame.Cytus': 'CYTUS',
    'Soundtrack.VideoGame.DancingLine': 'DANCELINE',
    'Soundtrack.VideoGame.Deemo': 'DEEMO',
    'Soundtrack.VideoGame.FNF': 'FNF',
    'Soundtrack.VideoGame.Lanota': 'LANOTA',
    'Soundtrack.VideoGame.Phigros': 'PHIGROS',
    'Soundtrack.VideoGame.Rotaeno': 'ROTAENO',
    'Soundtrack.VideoGame.Voez': 'VOEZ',
}

SUB_GENRE_MAP = {
    'Bass.ColorBass': 'BASS_COLOR',
    'Bass.FutureBass': 'BASS_FUTURE',
    'Bass.KawaiiBass': 'BASS_KAWAII',
    'Bass.MelodicBass': 'BASS_MELODIC',
    'Downtempo': 'DOWNTEMPO',
    'DrumNBass': 'DRUMNBASS',
    'Dubstep.Brostep': 'DUBSTEP_BROSTEP',
    'Dubstep.Chillstep': 'DUBSTEP_CHILLSTEP',
    'Dubstep.MelodicDubstep': 'DUBSTEP_MELODIC',
    'Dubstep.Riddim': 'DUBSTEP_RIDDIM',
    'Funk': 'FUNK',
    'GlitchHop': 'GLITCHHOP',
    'Hard.Artcore': 'HARD_ARTCORE',
    'Hard.FutureCore': 'HARD_FUTURECORE',
    'Hard.HappyCore': 'HARD_HAPPYCORE',
    'Hard.Hardcore': 'HARD_HARDCORE',
    'Hard.HardStyle': 'HARD_HARDSTYLE',
    'Hard.JCore': 'HARD_JCORE',
    'House.AmbientHouse': 'HOUSE_AMBIENT',
    'House.Complextro': 'HOUSE_COMPLEXTRO',
    'House.ElectroHouse': 'HOUSE_ELECTRO',
    'House.FutureHouse': 'HOUSE_FUTURE',
    'House.ProgressiveHouse': 'HOUSE_PROGRESSIVE',
    'House.SlapHouse': 'HOUSE_SLAP',
    'House.TropicalHouse': 'HOUSE_TROPICAL',
    'Jazz': 'JAZZ',
    'Lo-fi': 'LOFI',
    'Alternative': 'ROCK_ALTERNATIVE',
    'Metal': 'ROCK_METAL',
    'Soft': 'ROCK_SOFT',
    'Synthwave': 'SYNTHWAVE',
    'Trance': 'TRANCE',
    'Trap': 'TRAP',
}

# Enums

class DBAlbum(Enum):
    '''
    The album types.
    '''
    SINGLE = 0
    EP = 1
    ALBUM = 2
    COMPILATION = 3

    @staticmethod
    def get_album(name: str) -> 'DBAlbum':
        if re.search(r'(?i)\s*-\s*ep$', name) is not None:
            return DBAlbum.EP
        if re.search(r'(?i)\s*-\s*single$', name) is not None:
            return DBAlbum.SINGLE
        return DBAlbum.ALBUM

class DBArtistTag(Flag):
    '''
    The additional info on artists.
    '''
    NONE = 0
    AI = 1
    SYNTH = 2
    VTUBER = 4

class DBAuthority(Enum):
    '''
    The authority that manages music or publishes works.
    '''
    ISRC = 0
    APPLE_MUSIC = 1
    ITUNES = 2
    SPOTIFY = 3
    SOUNDCLOUD = 4
    YOUTUBE = 5
    DISCOGS = 6
    RATEYOURMUSIC = 7

class DBGenreInfo(Enum):
    '''
    The additional info on genres.
    '''
    NONE = 0
    DANCE = 1
    POP = 2
    RAP = 3
    ROCK = 4

    @staticmethod
    def get_genre_info(name: str) -> 'DBGenreInfo':
        if name == 'Dance.Influenced':
            return DBGenreInfo.DANCE
        if name == 'Pop.Influenced':
            return DBGenreInfo.POP
        if name == 'Rap.Influenced':
            return DBGenreInfo.RAP
        if name == 'Rock.Influenced':
            return DBGenreInfo.ROCK
        return DBGenreInfo.NONE

class DBGenreTag(Flag):
    '''
    The music genres.
    '''
    NONE = 0
    CLASSICAL = 1 << 0
    COUNTRY = 1 << 1
    DANCE = 1 << 2
    HIPHOP = 1 << 3
    INSTRUMENTAL = 1 << 4
    POP = 1 << 5
    RNB = 1 << 6
    ROCK = 1 << 7
    BASS_COLOR = 1 << 8
    BASS_FUTURE = 1 << 9
    BASS_KAWAII = 1 << 10
    BASS_MELODIC = 1 << 11
    DOWNTEMPO = 1 << 12
    DRUMNBASS = 1 << 13
    DUBSTEP_BROSTEP = 1 << 14
    DUBSTEP_CHILLSTEP = 1 << 15
    DUBSTEP_MELODIC = 1 << 16
    DUBSTEP_RIDDIM = 1 << 17
    FUNK = 1 << 18
    GLITCHHOP = 1 << 19
    HARD_ARTCORE = 1 << 20
    HARD_FUTURECORE = 1 << 21
    HARD_HAPPYCORE = 1 << 22
    HARD_HARDCORE = 1 << 23
    HARD_HARDSTYLE = 1 << 24
    HARD_JCORE = 1 << 25
    HOUSE_AMBIENT = 1 << 26
    HOUSE_COMPLEXTRO = 1 << 27
    HOUSE_ELECTRO = 1 << 28
    HOUSE_FUTURE = 1 << 29
    HOUSE_PROGRESSIVE = 1 << 30
    HOUSE_SLAP = 1 << 31
    HOUSE_TROPICAL = 1 << 32
    JAZZ = 1 << 33
    LOFI = 1 << 34
    ROCK_ALTERNATIVE = 1 << 35
    ROCK_METAL = 1 << 36
    ROCK_SOFT = 1 << 37
    SYNTHWAVE = 1 << 38
    TRANCE = 1 << 39
    TRAP = 1 << 40

    @staticmethod
    def get_genre(name: str) -> 'DBGenreTag':
        return DBGenreTag[GENRE_MAP.get(name, GENRE_MAP.get(name.capitalize(), 'NONE'))]
    
    @staticmethod
    def get_sub_genre(name: str) -> 'DBGenreTag':
        return DBGenreTag[SUB_GENRE_MAP.get(name, 'NONE')]

class DBLocale(Flag):
    '''
    The ISO 639 language codes.
    '''
    ZXX = 0
    UND = 1
    EN = 2
    ES = 4
    FR = 8
    HAK = 16
    HI = 32
    JA = 64
    KO = 128
    MAP = 256
    NAN = 512
    TH = 1024
    VI = 2048
    YUE = 4096
    ZH = 8192
    ZH_HANS = 16384
    ZH_HANT = 32768

    @staticmethod
    def get_locale(name: str) -> 'DBLocale':
        if (name == 'en') or name.startswith('en-') or (name.capitalize() == 'English'):
            return DBLocale.EN
        if (name == 'es') or name.startswith('es-') or (name.capitalize() == 'Spanish'):
            return DBLocale.ES
        if (name == 'fr') or name.startswith('fr-') or (name.capitalize() == 'French'):
            return DBLocale.FR
        if (name == 'hi') or name.startswith('hi-') or (name.capitalize() == 'Hindi'):
            return DBLocale.HI
        if (name == 'ja') or name.startswith('ja-') or (name.capitalize() == 'Japanese'):
            return DBLocale.JA
        if (name == 'ko') or name.startswith('ko-') or (name.capitalize() == 'Korean'):
            return DBLocale.KO
        if (name == 'th') or name.startswith('th-') or (name.capitalize() == 'Thai'):
            return DBLocale.TH
        if (name == 'vi') or name.startswith('vi-') or (name.capitalize() == 'Vietnamese'):
            return DBLocale.VI
        if (name == 'zh') or (name.capitalize() == 'Mandarin'):
            return DBLocale.ZH
        if (name == 'zxx') or (name == '-') or (name.capitalize() == 'Acoustic'):
            return DBLocale.ZXX
        if (name == 'hak') or (name.capitalize() == 'Hakka'):
            return DBLocale.HAK
        if (name == 'map'):
            return DBLocale.MAP
        if (name == 'nan') or (name.capitalize() == 'Taiwanese'):
            return DBLocale.NAN
        if (name == 'yue') or (name.capitalize() == 'Cantonese'):
            return DBLocale.YUE
        if (name == 'zh-Hans'):
            return DBLocale.ZH_HANS
        if (name == 'zh-Hant'):
            return DBLocale.ZH_HANT
        return DBLocale.UND

class DBMediaTag(Flag):
    '''
    The additional info of the song.
    '''
    NONE = 0
    ANIME = 1
    DRAMA = 2
    GAME = 4
    ARCAEA = 8
    CITIES = 16
    CYTUS = 32
    DANCELINE = 64
    DEEMO = 128
    FNF = 256
    LANOTA = 512
    PHIGROS = 1024
    ROTAENO = 2048
    VOEZ = 4096

    @staticmethod
    def get_media_tag(name: str) -> 'DBMediaTag':
        if not name.startswith('S'):
            return DBMediaTag.NONE
        return DBMediaTag[MEDIA_MAP.get(name, 'NONE')]

class DBMethod(Enum):
    '''
    The method to establish the mapping pair.
    '''
    APPLE = 0
    EXACT = 1
    FUZZY = 2
    MANUAL = 3

class DBRelation(Enum):
    '''
    The relationship between artists.
    '''
    NONE = 0
    MEMBER_OF = 1

class DBRole(Enum):
    '''
    The role of the artist in the song.
    '''
    MAIN = 0
    FEAT = 1
    REMIX = 2

class DBStatus(Enum):
    '''
    The status of the entry mapping pair.
    '''
    PENDING = 0
    CONFIRMED = 1
    REJECTED = 2

class DBVocal(Enum):
    '''
    The vocalist of the song.
    '''
    ACOUSTIC = 0
    FEMALE = 1
    MALE = 2
    DUET = 3
    UNKNOWN = 4

    @staticmethod
    def get_vocal(name: str) -> 'DBVocal':
        if name == 'A':
            return DBVocal.ACOUSTIC
        if name == 'V.F':
            return DBVocal.FEMALE
        if name == 'V.M':
            return DBVocal.MALE
        if name == 'V.X':
            return DBVocal.DUET
        return DBVocal.UNKNOWN

class IssueReason(str, Enum):
    '''
    The reason code for an entry issue.
    '''
    AUTHORITY_CONFLICT = 'AUTHORITY_CONFLICT'
    ARTIST_CONFLICT = 'ARTIST_CONFLICT'
    DURATION_MISMATCH = 'DURATION_MISMATCH'
    TITLE_CONFLICT = 'TITLE_CONFLICT'
    MULTIPLE_CANDIDATES = 'MULTIPLE_CANDIDATES'
    NO_CANDIDATE = 'NO_CANDIDATE'
    UNSUPPORTED_LOCALE = 'UNSUPPORTED_LOCALE'
    MISSING_FALLBACK_TITLE = 'MISSING_FALLBACK_TITLE'
    REFERENCED_ALBUM_MISSING = 'REFERENCED_ALBUM_MISSING'
    REFERENCED_ARTIST_MISSING = 'REFERENCED_ARTIST_MISSING'

class IssueSeverity(str, Enum):
    '''
    The severity of an entry issue.
    '''
    ERROR = 'error'
    WARNING = 'warning'
    INFO = 'info'

ISSUE_REQUIRED_DETAILS = {
    IssueReason.AUTHORITY_CONFLICT: (
        'authority_type',
        'authority_code',
        'incoming_song_id',
        'candidate_song_ids',
        'conflict_fields',
    ),
    IssueReason.ARTIST_CONFLICT: (
        'incoming_artist_ids',
        'candidate_artist_ids',
        'missing_artist_ids',
        'extra_artist_ids',
        'authority_matched',
    ),
    IssueReason.DURATION_MISMATCH: (
        'incoming_duration_ms',
        'candidate_duration_ms',
        'difference_ms',
        'tolerance_ms',
    ),
    IssueReason.TITLE_CONFLICT: (
        'locale',
        'incoming_title',
        'candidate_title',
        'normalized_incoming_title',
        'normalized_candidate_title',
    ),
    IssueReason.MULTIPLE_CANDIDATES: (
        'candidate_song_ids',
        'candidate_scores',
        'candidate_methods',
    ),
    IssueReason.NO_CANDIDATE: (
        'searched_authorities',
        'normalized_title',
        'artist_ids',
        'duration_ms',
    ),
    IssueReason.UNSUPPORTED_LOCALE: (
        'original_locale',
        'mapped_locale',
        'source_field',
    ),
    IssueReason.MISSING_FALLBACK_TITLE: (
        'audio_locale',
        'available_title_locales',
        'title_values',
        'fallback_failure',
    ),
    IssueReason.REFERENCED_ALBUM_MISSING: (
        'referenced_album_id',
        'reference_field',
        'referencing_collection',
        'referencing_item_id',
        'reference_context',
    ),
    IssueReason.REFERENCED_ARTIST_MISSING: (
        'referenced_artist_id',
        'reference_field',
        'referencing_collection',
        'referencing_item_id',
        'reference_context',
        'compilation',
        'display_name',
        'page_url',
        'suspected_various_artists',
    ),
}

ISSUE_DEFAULT_SEVERITY = {
    IssueReason.AUTHORITY_CONFLICT: IssueSeverity.ERROR,
    IssueReason.ARTIST_CONFLICT: IssueSeverity.WARNING,
    IssueReason.DURATION_MISMATCH: IssueSeverity.WARNING,
    IssueReason.TITLE_CONFLICT: IssueSeverity.WARNING,
    IssueReason.MULTIPLE_CANDIDATES: IssueSeverity.WARNING,
    IssueReason.NO_CANDIDATE: IssueSeverity.WARNING,
    IssueReason.UNSUPPORTED_LOCALE: IssueSeverity.WARNING,
    IssueReason.MISSING_FALLBACK_TITLE: IssueSeverity.WARNING,
    IssueReason.REFERENCED_ALBUM_MISSING: IssueSeverity.WARNING,
    IssueReason.REFERENCED_ARTIST_MISSING: IssueSeverity.WARNING,
}

class Issue:
    '''
    A temporary entry_issues row before it is inserted into the database.
    '''
    def __init__(
        self,
        entry_id: int,
        reason: IssueReason | str,
        details: Mapping[str, Any] | None = None,
        song_id: int | None = None,
        match_method: DBMethod | int | None = None,
        severity: IssueSeverity | str | None = None,
        source_section: str | None = None,
        json_path: str | None = None,
    ):
        self.entry_id = self._validate_positive_id('entry_id', entry_id)
        self.song_id = None if song_id is None else self._validate_positive_id('song_id', song_id)
        self.reason = self._coerce_reason(reason)
        self.match_method = self._coerce_method(match_method)

        issue_details = dict(details or {})
        if 'issue' in issue_details and issue_details['issue'] != self.reason.value:
            raise ValueError('details.issue must match reason.')

        if severity is None and 'severity' in issue_details:
            severity = issue_details['severity']
        if severity is None:
            severity = ISSUE_DEFAULT_SEVERITY[self.reason]
        self.severity = self._coerce_severity(severity)

        if source_section is None and 'source_section' in issue_details:
            source_section = issue_details['source_section']
        if json_path is None and 'json_path' in issue_details:
            json_path = issue_details['json_path']
        self.source_section = self._validate_optional_string('source_section', source_section)
        self.json_path = self._validate_optional_string('json_path', json_path)

        issue_details['issue'] = self.reason.value
        issue_details['severity'] = self.severity.value
        issue_details['source_section'] = self.source_section
        issue_details['json_path'] = self.json_path

        missing_keys = [
            key
            for key in ISSUE_REQUIRED_DETAILS[self.reason]
            if key not in issue_details
        ]
        if missing_keys:
            raise ValueError(f'Missing issue details for {self.reason.value}: {", ".join(missing_keys)}.')

        try:
            json.dumps(issue_details)
        except TypeError as error:
            raise ValueError('details must be JSON-serializable.') from error

        self.details = issue_details

    @staticmethod
    def _merge_details(details: dict[str, Any], extra_details: Mapping[str, Any] | None) -> dict[str, Any]:
        if extra_details is None:
            return details
        details.update(extra_details)
        return details

    @staticmethod
    def create_artist_conflict(
        entry_id: int,
        incoming_artist_ids: list[int] | list[str],
        candidate_artist_ids: list[int] | list[str],
        missing_artist_ids: list[int] | list[str],
        extra_artist_ids: list[int] | list[str],
        authority_matched: bool,
        *,
        song_id: int | None = None,
        match_method: DBMethod | int | None = None,
        extra_details: Mapping[str, Any] | None = None,
    ) -> 'Issue':
        return Issue(
            entry_id = entry_id,
            song_id = song_id,
            match_method = match_method,
            reason = IssueReason.ARTIST_CONFLICT,
            source_section = 'songs',
            json_path = '$.songs[0].artistID',
            details = Issue._merge_details(
                {
                    'incoming_artist_ids': incoming_artist_ids,
                    'candidate_artist_ids': candidate_artist_ids,
                    'missing_artist_ids': missing_artist_ids,
                    'extra_artist_ids': extra_artist_ids,
                    'authority_matched': authority_matched,
                },
                extra_details,
            ),
        )

    @staticmethod
    def create_authority_conflict(
        entry_id: int,
        authority_type: str,
        authority_code: str | None,
        incoming_song_id: str | None,
        candidate_song_ids: list[int],
        *,
        song_id: int | None = None,
        match_method: DBMethod | int | None = None,
        json_path: str = '$.songs[0]',
        extra_details: Mapping[str, Any] | None = None,
    ) -> 'Issue':
        return Issue(
            entry_id = entry_id,
            song_id = song_id,
            match_method = match_method,
            reason = IssueReason.AUTHORITY_CONFLICT,
            source_section = 'songs',
            json_path = json_path,
            details = Issue._merge_details(
                {
                    'authority_type': authority_type,
                    'authority_code': authority_code,
                    'incoming_song_id': incoming_song_id,
                    'candidate_song_ids': candidate_song_ids,
                    'conflict_fields': ['song_authorities'],
                },
                extra_details,
            ),
        )

    @staticmethod
    def create_duration_mismatch(
        entry_id: int,
        incoming_duration_ms: int,
        candidate_duration_ms: int,
        tolerance_ms: int,
        *,
        song_id: int | None = None,
        match_method: DBMethod | int | None = None,
        extra_details: Mapping[str, Any] | None = None,
    ) -> 'Issue':
        return Issue(
            entry_id = entry_id,
            song_id = song_id,
            match_method = match_method,
            reason = IssueReason.DURATION_MISMATCH,
            source_section = 'songs',
            json_path = '$.songs[0].duration',
            details = Issue._merge_details(
                {
                    'incoming_duration_ms': incoming_duration_ms,
                    'candidate_duration_ms': candidate_duration_ms,
                    'difference_ms': abs(incoming_duration_ms - candidate_duration_ms),
                    'tolerance_ms': tolerance_ms,
                },
                extra_details,
            ),
        )

    @staticmethod
    def create_multiple_candidates(
        entry_id: int,
        candidate_song_ids: list[int],
        candidate_scores: dict[str, float],
        candidate_methods: dict[str, str],
    ) -> 'Issue':
        return Issue(
            entry_id = entry_id,
            reason = IssueReason.MULTIPLE_CANDIDATES,
            source_section = 'songs',
            json_path = '$.songs[0]',
            details = {
                'candidate_song_ids': candidate_song_ids,
                'candidate_scores': candidate_scores,
                'candidate_methods': candidate_methods,
            },
        )

    @staticmethod
    def create_no_candidate(
        entry_id: int,
        searched_authorities: list[dict[str, str | None]],
        normalized_title: str,
        artist_ids: list[str],
        duration_ms: int,
        *,
        extra_details: Mapping[str, Any] | None = None,
    ) -> 'Issue':
        return Issue(
            entry_id = entry_id,
            reason = IssueReason.NO_CANDIDATE,
            source_section = 'songs',
            json_path = '$.songs[0]',
            details = Issue._merge_details(
                {
                    'searched_authorities': searched_authorities,
                    'normalized_title': normalized_title,
                    'artist_ids': artist_ids,
                    'duration_ms': duration_ms,
                },
                extra_details,
            ),
        )

    @staticmethod
    def create_title_conflict(
        entry_id: int,
        incoming_title: str,
        candidate_title: str | None,
        normalized_incoming_title: str,
        normalized_candidate_title: str,
        *,
        song_id: int | None = None,
        match_method: DBMethod | int | None = None,
        locale: str | None = None,
        extra_details: Mapping[str, Any] | None = None,
    ) -> 'Issue':
        return Issue(
            entry_id = entry_id,
            song_id = song_id,
            match_method = match_method,
            reason = IssueReason.TITLE_CONFLICT,
            source_section = 'songs',
            json_path = '$.songs[0].title',
            details = Issue._merge_details(
                {
                    'locale': locale,
                    'incoming_title': incoming_title,
                    'candidate_title': candidate_title,
                    'normalized_incoming_title': normalized_incoming_title,
                    'normalized_candidate_title': normalized_candidate_title,
                },
                extra_details,
            ),
        )

    @staticmethod
    def _validate_positive_id(name: str, value: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f'{name} must be a positive integer.')
        return value

    @staticmethod
    def _validate_optional_string(name: str, value: str | None) -> str | None:
        if value is not None and not isinstance(value, str):
            raise ValueError(f'{name} must be a string or None.')
        return value

    @staticmethod
    def _coerce_reason(value: IssueReason | str) -> IssueReason:
        if isinstance(value, IssueReason):
            return value
        if isinstance(value, str):
            try:
                return IssueReason(value)
            except ValueError as error:
                raise ValueError(f'Unknown issue reason: {value}.') from error
        raise ValueError('reason must be an IssueReason or string.')

    @staticmethod
    def _coerce_severity(value: IssueSeverity | str) -> IssueSeverity:
        if isinstance(value, IssueSeverity):
            return value
        if isinstance(value, str):
            try:
                return IssueSeverity(value)
            except ValueError as error:
                raise ValueError(f'Unknown issue severity: {value}.') from error
        raise ValueError('severity must be an IssueSeverity or string.')

    @staticmethod
    def _coerce_method(value: DBMethod | int | None) -> DBMethod | None:
        if value is None:
            return None
        if isinstance(value, DBMethod):
            return value
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError('match_method must be a DBMethod, integer, or None.')
        try:
            return DBMethod(value)
        except ValueError as error:
            raise ValueError(f'Unknown match_method value: {value}.') from error

    def to_details_json(self) -> dict[str, Any]:
        '''
        Return the JSON value for entry_issues.details.
        '''
        return dict(self.details)

    def to_json(self) -> dict[str, Any]:
        '''
        Return a JSON-serializable row for entry_issues.
        '''
        return {
            'entry_id': self.entry_id,
            'song_id': self.song_id,
            'match_method': None if self.match_method is None else self.match_method.value,
            'reason': self.reason.value,
            'details': self.to_details_json(),
        }
