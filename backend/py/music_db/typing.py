from enum import Enum, Flag, auto

# Enums

class DBArtistTag(Flag):
    '''
    The additional info on artists.
    '''
    NONE = 0
    AI = auto()
    SYNTH = auto()
    VTUBER = auto()

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

class DBGenreInfo(Enum):
    '''
    The additional info on genres.
    '''
    NONE = 0
    DANCE = 1
    POP = 2
    RAP = 3
    ROCK = 4

class DBGenreTag(Flag):
    '''
    The music genres.
    '''
    NONE = 0
    CLASSICAL = auto()
    COUNTRY = auto()
    DANCE = auto()
    HIPHOP = auto()
    INSTRUMENTAL = auto()
    POP = auto()
    RNB = auto()
    ROCK = auto()
    BASS_BUBBLEGUM = auto()
    BASS_COLOR = auto()
    BASS_FUTURE = auto()
    BASS_KAWAII = auto()
    DOWNTEMPO = auto()
    DRUMNBASS = auto()
    DUBSTEP_BROSTEP = auto()
    DUBSTEP_CHILLSTEP = auto()
    DUBSTEP_MELODIC = auto()
    DUBSTEP_RIDDIM = auto()
    FUNK = auto()
    GLITCHHOP = auto()
    HARD_ARTCORE = auto()
    HARD_FUTURECORE = auto()
    HARD_HAPPYCORE = auto()
    HARD_HARDCORE = auto()
    HARD_HARDSTYLE = auto()
    HARD_JCORE = auto()
    HOUSE_COLOR = auto()
    HOUSE_COMPLEXTRO = auto()
    HOUSE_ELECTRO = auto()
    HOUSE_FUTURE = auto()
    HOUSE_MELODIC = auto()
    HOUSE_PROGRESSIVE = auto()
    HOUSE_SLAP = auto()
    HOUSE_TROPICAL = auto()
    JAZZ = auto()
    ROCK_METAL = auto()
    ROCK_ALTERNATIVE = auto()
    TRANCE = auto()
    TRAP = auto()

class DBLocale(Flag):
    '''
    The ISO 639 language codes.
    '''
    ZXX = 0
    UND = auto()
    EN = auto()
    ES = auto()
    FR = auto()
    HAK = auto()
    HI = auto()
    JA = auto()
    KO = auto()
    MAP = auto()
    NAN = auto()
    TH = auto()
    VI = auto()
    YUE = auto()
    ZH = auto()
    ZH_HANS = auto()
    ZH_HANT = auto()

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
        if (name == 'zxx') or (name.capitalize() == 'Acoustic'):
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
    ANIME = auto()
    DRAMA = auto()
    GAME = auto()
    ARCAEA = auto()
    CITIES = auto()
    CYTUS = auto()
    DANCELINE = auto()
    DEEMO = auto()
    FNF = auto()
    LANOTA = auto()
    PHIGROS = auto()
    ROTAENO = auto()
    VOEZ = auto()

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