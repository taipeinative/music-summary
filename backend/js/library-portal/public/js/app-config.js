const state = {
  currentView: { type: 'mapping', key: 'pending', label: 'Pending Entry Mapping' },
  summary: null,
  rows: [],
  selectedKey: null,
  selectedGroups: new Set(),
  selectedIssues: new Set(),
  selectedMappings: new Set(),
  groupSelectionAnchorIndex: null,
  issueSelectionAnchorIndex: null,
  selectionAnchorIndex: null,
  group: {
    page: 1,
    pageSize: 500,
    total: 0,
    pageCount: 1,
    createSongOnConfirm: false,
    filters: {
      search: '',
      includeConfirmed: false,
      rules: [],
      sort: []
    }
  },
  mapping: {
    page: 1,
    pages: {},
    pageSize: 500,
    total: 0,
    pageCount: 1,
    filters: {
      status: 'ANY',
      method: 'ANY',
      search: ''
    },
    filtersByKey: {}
  },
  table: {
    key: 'album',
    page: 1,
    pages: {},
    pageSize: 100,
    total: 0,
    pageCount: 1,
    columns: [],
    columnWidths: {},
    filters: {
      search: '',
      sourceType: 'ANY',
      mappingStatus: 'ANY'
    },
    filtersByKey: {}
  },
  requests: {
    mapping: 0,
    issue: 0,
    group: 0,
    table: 0,
    changelog: 0
  },
  listCache: {
    mapping: {},
    group: {},
    table: {},
    changelog: {}
  },
  changelog: {
    page: 1,
    pageSize: 100,
    total: 0,
    pageCount: 1,
    filterOptions: {
      operations: [],
      tables: []
    },
    filters: {
      operation: 'ANY',
      table: 'ANY'
    },
    columnWidths: {
      table: 150,
      operation: 120,
      pk: 240,
      initiator: 150,
      reason: 280,
      date: 190
    }
  }
};

const changelogColumns = [
  { key: 'table', label: 'table' },
  { key: 'operation', label: 'operation' },
  { key: 'pk', label: 'PK' },
  { key: 'initiator', label: 'initiator' },
  { key: 'reason', label: 'reason' },
  { key: 'date', label: 'date' }
];

const fallbackTitleLocaleError = 'Fallback title locale cannot be determined automatically.';
const audioPauseIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 4h3v12h-3V4Zm6 0h3v12h-3V4Z"/></svg>';
const audioPlayIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.2 15.5 10 6 15.8V4.2Z"/></svg>';
const lastViewStorageKey = 'library-manager:last-view';

const tableViews = [
  { key: 'album', label: 'album' },
  { key: 'artist', label: 'artist' },
  { key: 'song', label: 'song' },
  { key: 'entry', label: 'entry' },
  { key: 'source', label: 'source' }
];

const enumLabels = {
  album_type: {
    0: 'Single',
    1: 'EP',
    2: 'Album',
    3: 'Compilation'
  },
  artist_tag: {
    0: 'None',
    1: 'AI',
    2: 'Synth',
    4: 'VTuber'
  },
  genre_info: {
    0: 'None',
    1: 'Dance-influenced',
    2: 'Pop-influenced',
    3: 'Rap-influenced',
    4: 'Rock-influenced'
  },
  locale: {
    0: 'zxx',
    1: 'und',
    2: 'en',
    4: 'es',
    8: 'fr',
    16: 'hak',
    32: 'hi',
    64: 'ja',
    128: 'ko',
    256: 'map',
    512: 'nan',
    1024: 'th',
    2048: 'vi',
    4096: 'yue',
    8192: 'zh',
    16384: 'zh-Hans',
    32768: 'zh-Hant'
  },
  source_type: {
    0: 'ISRC',
    1: 'Apple Music',
    2: 'iTunes',
    3: 'Spotify',
    4: 'SoundCloud',
    5: 'YouTube',
    6: 'Discogs',
    7: 'Rate Your Music'
  },
  role: {
    0: 'Main',
    1: 'Featured',
    2: 'Remix'
  },
  relation: {
    0: 'None',
    1: 'Member Of'
  },
  vocal: {
    0: 'Acoustic',
    1: 'Female',
    2: 'Male',
    3: 'Duet',
    4: 'Unknown'
  }
};

const flagLabels = {
  artist_tag: {
    1: 'AI',
    2: 'Synth',
    4: 'VTuber'
  },
  genre_tag: {
    1: 'Classical',
    2: 'Country',
    4: 'Dance',
    8: 'Hip-hop',
    16: 'Instrumental',
    32: 'Pop',
    64: 'R&B',
    128: 'Rock',
    256: 'Color Bass',
    512: 'Future Bass',
    1024: 'Kawaii Future Bass',
    2048: 'Melodic Bass',
    4096: 'Downtempo',
    8192: 'Drum and Bass',
    16384: 'Brostep',
    32768: 'Chillstep',
    65536: 'Melodic Dubstep',
    131072: 'Riddim',
    262144: 'Funk',
    524288: 'Glitch Hop',
    1048576: 'Artcore',
    2097152: 'Futurecore',
    4194304: 'Happycore',
    8388608: 'Hardcore',
    16777216: 'Hardstyle',
    33554432: 'J-core',
    67108864: 'Ambient House',
    134217728: 'Complextro',
    268435456: 'Electro House',
    536870912: 'Future House',
    1073741824: 'Progressive House',
    2147483648: 'Slap House',
    4294967296: 'Tropical House',
    8589934592: 'Jazz',
    17179869184: 'Lo-fi',
    34359738368: 'Alternative Rock',
    68719476736: 'Metal',
    137438953472: 'Soft Rock',
    274877906944: 'Synthwave',
    549755813888: 'Trance',
    1099511627776: 'Trap'
  },
  media_tag: {
    1: 'Anime',
    2: 'Drama',
    4: 'Game',
    8: 'Arcaea',
    16: 'Cities: Skylines',
    32: 'Cytus',
    64: 'Dancing Line',
    128: 'Deemo',
    256: 'Friday Night Funkin',
    512: 'Lanota',
    1024: 'Phigros',
    2048: 'Rotaeno',
    4096: 'Voez'
  }
};

const dbEnumNames = {
  album_type: {
    0: 'SINGLE',
    1: 'EP',
    2: 'ALBUM',
    3: 'COMPILATION'
  },
  artist_tag: {
    1: 'AI',
    2: 'SYNTH',
    4: 'VTUBER'
  },
  genre_info: {
    0: 'NONE',
    1: 'DANCE',
    2: 'POP',
    3: 'RAP',
    4: 'ROCK'
  },
  genre_tag: {
    1: 'CLASSICAL',
    2: 'COUNTRY',
    4: 'DANCE',
    8: 'HIPHOP',
    16: 'INSTRUMENTAL',
    32: 'POP',
    64: 'RNB',
    128: 'ROCK',
    256: 'BASS_COLOR',
    512: 'BASS_FUTURE',
    1024: 'BASS_KAWAII',
    2048: 'BASS_MELODIC',
    4096: 'DOWNTEMPO',
    8192: 'DRUMNBASS',
    16384: 'DUBSTEP_BROSTEP',
    32768: 'DUBSTEP_CHILLSTEP',
    65536: 'DUBSTEP_MELODIC',
    131072: 'DUBSTEP_RIDDIM',
    262144: 'FUNK',
    524288: 'GLITCHHOP',
    1048576: 'HARD_ARTCORE',
    2097152: 'HARD_FUTURECORE',
    4194304: 'HARD_HAPPYCORE',
    8388608: 'HARD_HARDCORE',
    16777216: 'HARD_HARDSTYLE',
    33554432: 'HARD_JCORE',
    67108864: 'HOUSE_AMBIENT',
    134217728: 'HOUSE_COMPLEXTRO',
    268435456: 'HOUSE_ELECTRO',
    536870912: 'HOUSE_FUTURE',
    1073741824: 'HOUSE_PROGRESSIVE',
    2147483648: 'HOUSE_SLAP',
    4294967296: 'HOUSE_TROPICAL',
    8589934592: 'JAZZ',
    17179869184: 'LOFI',
    34359738368: 'ROCK_ALTERNATIVE',
    68719476736: 'ROCK_METAL',
    137438953472: 'ROCK_SOFT',
    274877906944: 'SYNTHWAVE',
    549755813888: 'TRANCE',
    1099511627776: 'TRAP'
  },
  media_tag: {
    1: 'ANIME',
    2: 'DRAMA',
    4: 'GAME',
    8: 'ARCAEA',
    16: 'CITIES',
    32: 'CYTUS',
    64: 'DANCELINE',
    128: 'DEEMO',
    256: 'FNF',
    512: 'LANOTA',
    1024: 'PHIGROS',
    2048: 'ROTAENO',
    4096: 'VOEZ'
  },
  relation: {
    0: 'NONE',
    1: 'MEMBER_OF'
  },
  role: {
    0: 'MAIN',
    1: 'FEAT',
    2: 'REMIX'
  },
  source_type: {
    0: 'ISRC',
    1: 'APPLE_MUSIC',
    2: 'ITUNES',
    3: 'SPOTIFY',
    4: 'SOUNDCLOUD',
    5: 'YOUTUBE',
    6: 'DISCOGS',
    7: 'RATEYOURMUSIC'
  },
  vocal: {
    0: 'ACOUSTIC',
    1: 'FEMALE',
    2: 'MALE',
    3: 'DUET',
    4: 'UNKNOWN'
  }
};

const mappingViews = [
  { key: 'existing', label: 'Existing' },
  { key: 'incoming', label: 'Incoming' },
  { key: 'pending', label: 'Pending' }
];

const issueLabels = {
  AUTHORITY_CONFLICT: 'Authority Conflict',
  ARTIST_CONFLICT: 'Artist Conflict',
  DURATION_MISMATCH: 'Duration Mismatch',
  TITLE_CONFLICT: 'Title Conflict',
  MULTIPLE_CANDIDATES: 'Multiple Candidates',
  NO_CANDIDATE: 'No Candidate',
  MISSING_FALLBACK_TITLE: 'Missing Fallback Title',
  REFERENCED_ALBUM_MISSING: 'Referenced Album Missing',
  REFERENCED_ARTIST_MISSING: 'Referenced Artist Missing'
};
