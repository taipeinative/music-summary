from enum import Enum, Flag

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