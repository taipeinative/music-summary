from enum import Enum, Flag, auto

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
    BASS_BUBBLEGUM = 1 << 8
    BASS_COLOR = 1 << 9
    BASS_FUTURE = 1 << 10
    BASS_KAWAII = 1 << 11
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
    HOUSE_COLOR = 1 << 26
    HOUSE_COMPLEXTRO = 1 << 27
    HOUSE_ELECTRO = 1 << 28
    HOUSE_FUTURE = 1 << 29
    HOUSE_MELODIC = 1 << 30
    HOUSE_PROGRESSIVE = 1 << 31
    HOUSE_SLAP = 1 << 32
    HOUSE_TROPICAL = 1 << 33
    JAZZ = 1 << 34
    ROCK_METAL = 1 << 35
    ROCK_ALTERNATIVE = 1 << 36
    TRANCE = 1 << 37
    TRAP = 1 << 38

    @staticmethod
    def get_genre(name: str) -> 'DBGenreTag':
        if name.capitalize() == 'Classical':
            return DBGenreTag.CLASSICAL
        if name.capitalize() == 'Country':
            return DBGenreTag.COUNTRY
        if name.capitalize() == 'Dance':
            return DBGenreTag.DANCE
        if name == 'Hip Hop/Rap':
            return DBGenreTag.HIPHOP
        if name.capitalize() == 'Instrumental':
            return DBGenreTag.INSTRUMENTAL
        if name.capitalize() == 'Pop':
            return DBGenreTag.POP
        if name == 'R&B/Soul':
            return DBGenreTag.RNB
        if name.capitalize() == 'Rock':
            return DBGenreTag.ROCK
        return DBGenreTag.NONE
    
    @staticmethod
    def get_sub_genre(name: str) -> 'DBGenreTag':
        # TODO: Fill all sub genres
        return DBGenreTag.NONE

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
        if name == 'Soundtrack.Anime':
            return DBMediaTag.ANIME
        if name == 'Soundtrack.Drama':
            return DBMediaTag.DRAMA
        if name == 'Soundtrack.VideoGame':
            return DBMediaTag.GAME
        if name == 'Soundtrack.VideoGame.Arcaea':
            return DBMediaTag.ARCAEA
        if name == 'Soundtrack.VideoGame.CitiesSkylines':
            return DBMediaTag.CITIES
        if name == 'Soundtrack.VideoGame.Cytus':
            return DBMediaTag.CYTUS
        if name == 'Soundtrack.VideoGame.DancingLine':
            return DBMediaTag.DANCELINE
        if name == 'Soundtrack.VideoGame.Deemo':
            return DBMediaTag.DEEMO
        if name == 'Soundtrack.VideoGame.FNF':
            return DBMediaTag.FNF
        if name == 'Soundtrack.VideoGame.Lanota':
            return DBMediaTag.LANOTA
        if name == 'Soundtrack.VideoGame.Phigros':
            return DBMediaTag.PHIGROS
        if name == 'Soundtrack.VideoGame.Rotaeno':
            return DBMediaTag.ROTAENO
        if name == 'Soundtrack.VideoGame.Voez':
            return DBMediaTag.VOEZ
        return DBMediaTag.NONE

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