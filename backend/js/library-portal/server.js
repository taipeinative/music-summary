const path = require('node:path');
const cors = require('cors');
const express = require('express');
const { EnvFileStore } = require('./src/env-file-store');
const { LibraryDatabase } = require('./src/library-database');

const { auditContext, requireAudit } = require('./src/audit');
const { pythonTransaction } = require('./src/python-client');
const { registerPortal, titleOrder } = require('./src/portal-api');
const app = express();
const port = Number(process.env.PORT || 3001);
const envPath = process.env.LIBRARY_PORTAL_ENV || path.join(__dirname, '.env.local');
const configStore = new EnvFileStore(envPath);
const database = new LibraryDatabase({ configStore });

const DB_METHODS = {
  0: 'APPLE',
  1: 'EXACT',
  2: 'FUZZY',
  3: 'MANUAL'
};

const DB_STATUSES = {
  0: 'PENDING',
  1: 'CONFIRMED',
  2: 'REJECTED'
};

const DB_ALBUM_LABELS = {
  0: 'Single',
  1: 'EP',
  2: 'Album',
  3: 'Compilation'
};

const DB_ALBUM_VALUES = Object.fromEntries(
  Object.entries(DB_ALBUM_LABELS).map(([value, label]) => [label.toLowerCase(), Number(value)])
);

const DB_AUTHORITY_LABELS = {
  0: 'ISRC',
  1: 'Apple Music',
  2: 'iTunes',
  3: 'Spotify',
  4: 'SoundCloud',
  5: 'YouTube',
  6: 'Discogs',
  7: 'Rate Your Music'
};

const DB_AUTHORITY_VALUES = Object.fromEntries(
  Object.entries(DB_AUTHORITY_LABELS).map(([value, label]) => [label.toLowerCase(), Number(value)])
);
DB_AUTHORITY_VALUES.isrc = 0;
DB_AUTHORITY_VALUES.apple = 1;
DB_AUTHORITY_VALUES.apple_music = 1;
DB_AUTHORITY_VALUES['apple music'] = 1;
DB_AUTHORITY_VALUES.itunes = 2;
DB_AUTHORITY_VALUES.spotify = 3;
DB_AUTHORITY_VALUES.soundcloud = 4;
DB_AUTHORITY_VALUES.youtube = 5;
DB_AUTHORITY_VALUES.discogs = 6;
DB_AUTHORITY_VALUES.rateyourmusic = 7;
DB_AUTHORITY_VALUES['rate your music'] = 7;

const DB_RELATION_LABELS = {
  0: 'None',
  1: 'Member Of'
};

const DB_RELATION_VALUES = Object.fromEntries(
  Object.entries(DB_RELATION_LABELS).map(([value, label]) => [label.toLowerCase(), Number(value)])
);
DB_RELATION_VALUES.none = 0;
DB_RELATION_VALUES.member_of = 1;

function parseDiscogsAuthorityCode(code) {
  const value = String(code || '');
  const match = value.match(/^([mr])(\d+)$/i);
  if (match) {
    return {
      prefix: match[1].toLowerCase(),
      number: Number(match[2]),
      raw: value
    };
  }

  if (/^\d+$/.test(value)) {
    return {
      prefix: 'm',
      number: Number(value),
      raw: value
    };
  }

  return {
    prefix: 'z',
    number: Number.MAX_SAFE_INTEGER,
    raw: value
  };
}

function compareDiscogsAuthorityCode(left, right) {
  const prefixOrder = { m: 0, r: 1, z: 2 };
  const leftCode = parseDiscogsAuthorityCode(left?.code);
  const rightCode = parseDiscogsAuthorityCode(right?.code);
  const prefixDiff = (prefixOrder[leftCode.prefix] ?? 9) - (prefixOrder[rightCode.prefix] ?? 9);
  if (prefixDiff) {
    return prefixDiff;
  }
  if (leftCode.number !== rightCode.number) {
    return leftCode.number - rightCode.number;
  }
  return leftCode.raw.localeCompare(rightCode.raw);
}

function compareAuthorityRows(left, right) {
  const authorityDiff = left.authority - right.authority;
  if (authorityDiff) {
    return authorityDiff;
  }
  if (left.authority === 6) {
    return compareDiscogsAuthorityCode(left, right);
  }
  return String(left.code || '').localeCompare(String(right.code || ''));
}

const DB_LOCALES = {
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
  16384: 'zh-hans',
  32768: 'zh-hant'
};

const DB_LOCALE_VALUES = {
  zxx: 0,
  und: 1,
  en: 2,
  es: 4,
  fr: 8,
  hak: 16,
  hi: 32,
  ja: 64,
  ko: 128,
  map: 256,
  nan: 512,
  th: 1024,
  vi: 2048,
  yue: 4096,
  zh: 8192,
  zs: 16384,
  zt: 32768,
  'zh-hans': 16384,
  'zh-hant': 32768
};

function titleDisplayOrderSql(localeColumn = 'locale', fallbackColumn = 'fallback') {
  return titleOrder(localeColumn, fallbackColumn);
}

const TABLE_CONFIGS = {
  album: {
    relation: 'album_overview',
    orderBy: 'album_id',
    pk: 'album_id',
    columns: ['album_id', 'title', 'artists', 'album_type', 'disc_count', 'track_counts', 'updated_at']
  },
  artist: {
    relation: 'artist_overview',
    orderBy: 'artist_id',
    pk: 'artist_id',
    columns: ['artist_id', 'title', 'alias', 'artist_tag', 'updated_at']
  },
  song: {
    relation: 'song_overview',
    orderBy: 'song_id',
    pk: 'song_id',
    columns: ['song_id', 'title', 'artists', 'vocal', 'locale', 'genre_tag', 'genre_info', 'media_tag', 'duration', 'release_date', 'updated_at']
  },
  entry: {
    relation: `(
      SELECT
        e.entry_id,
        e.source_id,
        e.source_item_id,
        src.source_type,
        src.source_file,
        e.raw_title AS title,
        e.raw_artist AS artist,
        e.raw_album AS album,
        mapping.status,
        mapping.song_id,
        entry_groups.entry_group_id
      FROM entries e
      JOIN sources src
        ON src.source_id = e.source_id
      LEFT JOIN LATERAL (
        SELECT
          CASE em.status
            WHEN 0 THEN 'PENDING'
            WHEN 1 THEN 'CONFIRMED'
            WHEN 2 THEN 'REJECTED'
            ELSE 'UNKNOWN'
          END AS status,
          em.song_id
        FROM entry_mapping em
        WHERE em.entry_id = e.entry_id
        ORDER BY
          CASE em.status
            WHEN 1 THEN 0
            WHEN 0 THEN 1
            WHEN 2 THEN 2
            ELSE 3
          END,
          em.confidence DESC NULLS LAST,
          em.created_at DESC,
          em.song_id
        LIMIT 1
      ) mapping ON TRUE
      LEFT JOIN LATERAL (
        SELECT min(ege.group_id)::int AS entry_group_id
        FROM entry_group_entries ege
        WHERE ege.entry_id = e.entry_id
      ) entry_groups ON TRUE
    ) entry_overview`,
    orderBy: 'entry_id',
    pk: 'entry_id',
    columns: ['entry_id', 'source_id', 'source_item_id', 'title', 'artist', 'album', 'status', 'song_id', 'entry_group_id']
  },
  source: {
    relation: 'sources',
    orderBy: 'source_id',
    pk: 'source_id',
    columns: ['source_id', 'export_date', 'import_date', 'source_file', 'source_type']
  }
};

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function readSavedConfig() {
  return configStore.readDatabaseConfig();
}

async function saveConfig(config) {
  await configStore.saveDatabaseConfig(config);
}

async function readUiSettings() {
  return configStore.readUiSettings();
}

async function saveUiSettings(settings) {
  await configStore.saveUiSettings(settings);
}

async function closePool() {
  await database.close();
}

async function connectWithConfig(config) {
  await database.connect(config);
}

async function ensurePool() {
  await database.ensure();
}

async function queryDatabase(sql, params = []) {
  return database.query(sql, params);
}

async function tableExists(tableName) {
  return database.tableExists(tableName);
}

async function runTransaction(callback) {
  return database.transaction(callback);
}

function parsePythonError(error) {
  const stderr = String(error.stderr || '').trim();
  if (!stderr) {
    return error.message || 'Python command failed.';
  }

  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) || stderr;
}

async function confirmEntryMappingsWithMetadata(mappings, { changedBy, reason }) {
  await ensurePool();
  if (!database.activeConfig) {
    const error = new Error('No database configuration has been saved.');
    error.status = 401;
    throw error;
  }

  const uniqueMappings = [];
  const seen = new Set();
  for (const mapping of mappings) {
    const key = `${mapping.entryId}:${mapping.songId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueMappings.push({
      entryId: mapping.entryId,
      songId: mapping.songId
    });
  }

  await pythonTransaction(database.activeConfig, auditContext.getStore(), (client) => client.confirm(uniqueMappings));

  const changedRows = [];
  const statuses = [];
  for (const mapping of uniqueMappings) {
    const rows = await queryDatabase(`
      SELECT entry_id, song_id, confidence, match_method, status, created_at
      FROM entry_mapping
      WHERE entry_id = $1
        AND song_id = $2
    `, [mapping.entryId, mapping.songId]);
    if (rows.length) {
      const row = mappingChangeData(rows[0]);
      changedRows.push(row);
      statuses.push({
        entryId: mapping.entryId,
        songId: mapping.songId,
        status: DB_STATUSES[row.status]
      });
    }
  }

  return {
    status: 'CONFIRMED',
    updatedCount: uniqueMappings.length,
    statuses,
    changedRows,
    metadataMerged: true
  };
}

function toInt(value) {
  return value === null || value === undefined ? null : Number(value);
}

function normalizeTitleRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => ({
    locale: DB_LOCALES[row.locale] || String(row.locale),
    title: row.title || '',
    fallback: Boolean(row.fallback)
  }));
}

function normalizeTitleGroups(groups, idKey) {
  if (!Array.isArray(groups)) {
    return [];
  }

  return groups.map((group) => ({
    id: toInt(group[idKey]),
    titles: normalizeTitleRows(group.titles)
  }));
}

function normalizeLocaleCode(value) {
  if (value === null || value === undefined || value === '') {
    return 'und';
  }

  if (DB_LOCALES[value]) {
    return DB_LOCALES[value];
  }

  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && DB_LOCALES[numericValue]) {
    return DB_LOCALES[numericValue];
  }

  const normalizedValue = String(value).trim().replace(/_/g, '-').toLowerCase();
  if (normalizedValue === 'zs') {
    return 'zh-hans';
  }
  if (normalizedValue === 'zt') {
    return 'zh-hant';
  }

  return normalizedValue || 'und';
}

function pickValue(object, keys) {
  if (!object || typeof object !== 'object') {
    return null;
  }

  for (const key of keys) {
    if (object[key] !== null && object[key] !== undefined && object[key] !== '') {
      return object[key];
    }
  }

  return null;
}

function addRawTitle(rows, seen, locale, title, fallback = false) {
  if (title === null || title === undefined || title === '') {
    return;
  }

  if (typeof title === 'object') {
    collectRawTitleRowsFromCollection(title, rows, seen);
    return;
  }

  const normalizedLocale = normalizeLocaleCode(locale);
  const normalizedTitle = String(title);
  const key = `${normalizedLocale}\u0000${normalizedTitle}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  rows.push({
    locale: normalizedLocale,
    title: normalizedTitle,
    fallback: Boolean(fallback)
  });
}

function addRawTitleValue(rows, seen, locale, value, fallback = false) {
  if (value === null || value === undefined || value === '') {
    return;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    addRawTitle(rows, seen, locale, value, fallback);
    return;
  }

  if (typeof value === 'object') {
    collectRawTitleRowsFromCollection(value, rows, seen);
  }
}

function collectRawTitleRowsFromLocalizedValue(value, locale, rows, seen) {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    addRawTitle(rows, seen, locale, value);
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const title = pickValue(value, ['title', 'name', 'displayName', 'value']);
  const valueLocale = pickValue(value, ['locale', 'language', 'languageTag', 'lang']) || locale;
  addRawTitleValue(rows, seen, valueLocale, title, value.fallback);
}

function collectRawTitleRowsFromCollection(collection, rows, seen) {
  if (!collection) {
    return;
  }

  if (Array.isArray(collection)) {
    for (const item of collection) {
      collectRawTitleRowsFromLocalizedValue(item, null, rows, seen);
    }
    return;
  }

  if (typeof collection === 'object') {
    for (const [locale, value] of Object.entries(collection)) {
      collectRawTitleRowsFromLocalizedValue(value, locale, rows, seen);
    }
  }
}

function extractRawTitleRows(item) {
  if (!item || typeof item !== 'object') {
    return [];
  }

  const rows = [];
  const seen = new Set();
  const defaultLocale = pickValue(item, ['locale', 'language', 'languageTag', 'lang']);

  addRawTitleValue(
    rows,
    seen,
    defaultLocale,
    pickValue(item, ['title', 'name', 'displayName']),
    item.fallback
  );

  for (const key of ['titles', 'names', 'localizedTitles', 'localizedNames', 'localizations', 'translations']) {
    collectRawTitleRowsFromCollection(item[key], rows, seen);
  }

  if (item.attributes && typeof item.attributes === 'object') {
    const attributesLocale = pickValue(item.attributes, ['locale', 'language', 'languageTag', 'lang']) || defaultLocale;
    addRawTitleValue(
      rows,
      seen,
      attributesLocale,
      pickValue(item.attributes, ['title', 'name', 'displayName']),
      item.attributes.fallback
    );

    for (const key of ['titles', 'names', 'localizedTitles', 'localizedNames', 'localizations', 'translations']) {
      collectRawTitleRowsFromCollection(item.attributes[key], rows, seen);
    }
  }

  return rows;
}

function extractRawId(item, idKeys) {
  const value = pickValue(item, idKeys);
  return value === null || value === undefined ? null : value;
}

function extractRawTitleGroups(rawJson, collectionName, idKeys) {
  const items = rawJson && Array.isArray(rawJson[collectionName]) ? rawJson[collectionName] : [];

  return items.map((item) => ({
    id: extractRawId(item, idKeys),
    titles: extractRawTitleRows(item)
  }));
}

function extractEntryAppleMusicIds(rawJson) {
  if (!rawJson || !Array.isArray(rawJson.songs) || !rawJson.songs.length) {
    return [];
  }

  const id = extractRawId(rawJson.songs[0], ['id']);
  return id === null || id === undefined || id === '' ? [] : [String(id)];
}

function extractEntryTitleRows(rawJson) {
  if (!rawJson || !Array.isArray(rawJson.songs) || !rawJson.songs.length) {
    return [];
  }

  return extractRawTitleRows(rawJson.songs[0]);
}

function normalizeTextForDb(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const LATIN_FOLD_CHAR_GROUPS = {
  a: 'àáâãäåāăąǎǟǡǻȁȃạảấầẩẫậắằẳẵặ',
  c: 'çćĉċč',
  d: 'ďđḍ',
  e: 'èéêëēĕėęěȅȇẹẻẽếềểễệ',
  g: 'ĝğġģ',
  h: 'ĥħḥ',
  i: 'ìíîïĩīĭįıǐȉȋịỉ',
  j: 'ĵ',
  k: 'ķ',
  l: 'ĺļľŀł',
  n: 'ñńņňŉŋ',
  o: 'òóôõöøōŏőǒǿȍȏọỏốồổỗộơớờởỡợ',
  r: 'ŕŗř',
  s: 'śŝşšșṣ',
  t: 'ţťŧțṭ',
  u: 'ùúûüũūŭůűųǔȕȗụủưứừửữự',
  w: 'ŵẁẃẅ',
  y: 'ýÿŷỳỵỷỹ',
  z: 'źżž'
};
const LATIN_FOLD_MULTI_CHAR_GROUPS = {
  ae: 'æǽ',
  oe: 'œ',
  ss: 'ßẞ',
  th: 'þ',
  d: 'ð'
};
const LATIN_FOLD_REMOVE_CHARS = '\u0300\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309\u030a\u030b\u030c\u030f\u0311\u031b\u0323\u0326\u0327\u0328';
const LATIN_FOLD_TRANSLATE_FROM = Object.values(LATIN_FOLD_CHAR_GROUPS)
  .map((chars) => `${chars}${chars.toUpperCase()}`)
  .join('') + LATIN_FOLD_REMOVE_CHARS;
const LATIN_FOLD_TRANSLATE_TO = Object.entries(LATIN_FOLD_CHAR_GROUPS)
  .map(([letter, chars]) => letter.repeat(Array.from(`${chars}${chars.toUpperCase()}`).length))
  .join('');
const LATIN_FOLD_TEXT_REPLACEMENTS = Object.entries(LATIN_FOLD_MULTI_CHAR_GROUPS)
  .flatMap(([replacement, chars]) => Array.from(chars).map((char) => [char, replacement]));

function foldLatinText(value) {
  let text = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  for (const [char, replacement] of LATIN_FOLD_TEXT_REPLACEMENTS) {
    text = text.replaceAll(char.toLowerCase(), replacement);
  }

  return text;
}

function sqlStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function foldLatinSql(expression) {
  let folded = `translate(lower(COALESCE(${expression}::text, '')), ${sqlStringLiteral(LATIN_FOLD_TRANSLATE_FROM)}, ${sqlStringLiteral(LATIN_FOLD_TRANSLATE_TO)})`;
  for (const [replacement, chars] of Object.entries(LATIN_FOLD_MULTI_CHAR_GROUPS)) {
    for (const char of Array.from(chars)) {
      for (const variant of new Set([char, char.toLowerCase(), char.toUpperCase()])) {
        folded = `replace(${folded}, ${sqlStringLiteral(variant)}, ${sqlStringLiteral(replacement)})`;
      }
    }
  }
  return folded;
}

function pushLatinSearchParam(params, search) {
  params.push(`%${foldLatinText(search)}%`);
  return `$${params.length}`;
}

function latinSearchCondition(expression, searchParam) {
  return `${foldLatinSql(expression)} LIKE ${searchParam}`;
}

function normalizeTitleForDb(value) {
  return normalizeTextForDb(value)
    .replace(/[\(\[\{](?:ft\.?|feat\.?|featuring|with).*[\)\]\}](?:\s*|$)/gi, '')
    .replace(/[\(\[\{].*(?:re)?mix.*[\)\]\}](?:\s*|$)/gi, '');
}

function normalizeSourceLocaleKey(value) {
  const locale = String(value ?? '').trim().replace(/_/g, '-').toLowerCase();
  if (!locale) {
    return 'und';
  }
  if (locale.startsWith('en')) {
    return 'en';
  }
  if (locale.startsWith('fr')) {
    return 'fr';
  }
  if (locale.startsWith('ja')) {
    return 'ja';
  }
  if (locale.startsWith('ko')) {
    return 'ko';
  }
  if (['zt', 'zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'].includes(locale)) {
    return 'zt';
  }
  if (['zs', 'zh-hans', 'zh-cn', 'zh-my', 'zh-sg'].includes(locale)) {
    return 'zs';
  }
  if (locale === 'zh') {
    return 'zh';
  }
  if (locale === 'zxx') {
    return 'zxx';
  }
  return locale;
}

function getLocaleValue(value, fallback = DB_LOCALE_VALUES.und) {
  if (Number.isInteger(Number(value)) && DB_LOCALES[Number(value)] !== undefined) {
    return Number(value);
  }

  const key = normalizeSourceLocaleKey(value);
  return DB_LOCALE_VALUES[key] ?? fallback;
}

function getTitleDisplayRank(row) {
  const locale = getLocaleValue(row?.localeValue ?? row?.locale ?? row?.localeLabel, null);
  if (locale === DB_LOCALE_VALUES.en) {
    return 0;
  }
  if (locale === DB_LOCALE_VALUES['zh-hant']) {
    return 1;
  }
  if (row?.fallback) {
    return 2;
  }
  return 3;
}

function pickDisplayTitle(titles, fallback = '') {
  return [...(Array.isArray(titles) ? titles : [])]
    .filter((title) => String(title?.title || '').trim())
    .sort((left, right) => (
      getTitleDisplayRank(left) - getTitleDisplayRank(right)
      || (getLocaleValue(left?.localeValue ?? left?.locale ?? left?.localeLabel, Number.MAX_SAFE_INTEGER)
        - getLocaleValue(right?.localeValue ?? right?.locale ?? right?.localeLabel, Number.MAX_SAFE_INTEGER))
      || String(left.title).localeCompare(String(right.title))
    ))[0]?.title || fallback;
}

function getAuthorityValue(value) {
  if (Number.isInteger(Number(value)) && DB_AUTHORITY_LABELS[Number(value)] !== undefined) {
    return Number(value);
  }

  const key = String(value ?? '').trim().replace(/[-\s]+/g, ' ').toLowerCase();
  return DB_AUTHORITY_VALUES[key] ?? DB_AUTHORITY_VALUES[key.replace(/\s+/g, '_')] ?? null;
}

function getRelationValue(value) {
  if (Number.isInteger(Number(value)) && DB_RELATION_LABELS[Number(value)] !== undefined) {
    return Number(value);
  }

  const key = String(value ?? '').trim().replace(/[-\s]+/g, ' ').toLowerCase();
  return DB_RELATION_VALUES[key] ?? DB_RELATION_VALUES[key.replace(/\s+/g, '_')] ?? null;
}

function getFirstSong(rawJson) {
  return rawJson && Array.isArray(rawJson.songs) && rawJson.songs.length && typeof rawJson.songs[0] === 'object'
    ? rawJson.songs[0]
    : {};
}

function getFirstAlbum(rawJson, albumId) {
  const albums = rawJson && Array.isArray(rawJson.albums) ? rawJson.albums : [];
  return albums.find((album) => String(album?.id) === String(albumId)) || null;
}

function getTitleMap(item) {
  const title = item?.title;
  if (!title) {
    return {};
  }
  if (typeof title === 'string') {
    return { und: title };
  }
  if (typeof title !== 'object') {
    return {};
  }

  const result = {};
  for (const [locale, value] of Object.entries(title)) {
    if (typeof value === 'string' && value.trim()) {
      result[normalizeSourceLocaleKey(locale)] = value.trim();
    }
  }
  return result;
}

function chooseFallbackTitleLocale(titleRows, audioLocaleValue) {
  const matching = titleRows.find((row) => row.locale === audioLocaleValue);
  if (matching) {
    return matching.locale;
  }

  const uniqueTitles = new Set(titleRows.map((row) => row.title));
  const english = titleRows.find((row) => row.locale === DB_LOCALE_VALUES.en);
  if (uniqueTitles.size === 1 && english) {
    return english.locale;
  }

  return null;
}

function pickRepresentativeDuration(entries) {
  const durations = entries
    .map((entry) => Number(entry.raw_duration))
    .filter((duration) => Number.isFinite(duration));
  if (!durations.length) {
    return 0;
  }

  const counts = new Map();
  for (const duration of durations) {
    counts.set(duration, (counts.get(duration) || 0) + 1);
  }
  const best = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0];
  if (best && best[1] > 1) {
    return best[0];
  }

  return [...durations].sort((left, right) => left - right)[Math.floor((durations.length - 1) / 2)];
}

function pickEarliestDate(values) {
  const dates = values
    .filter(Boolean)
    .map((value) => String(value).slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  return dates[0] || null;
}

function formatDbLocaleValue(value) {
  return DB_LOCALES[value] || `UNKNOWN(${value})`;
}

function getPreviewTitleValue(item) {
  const titleMap = getTitleMap(item);
  return titleMap['zh-hant']
    || titleMap.zt
    || titleMap.en
    || Object.values(titleMap)[0]
    || null;
}

function getPreviewTitleRowsFromItem(item) {
  return Object.entries(getTitleMap(item))
    .map(([localeKey, title]) => ({
      locale: formatDbLocaleValue(getLocaleValue(localeKey, DB_LOCALE_VALUES.und)),
      title,
      fallback: false
    }))
    .sort((left, right) => left.locale.localeCompare(right.locale));
}

function getPreviewAuthorityRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => ({
    authority: getAuthorityValue(row.authority ?? row.authorityValue ?? row.authority_value),
    authorityLabel: DB_AUTHORITY_LABELS[getAuthorityValue(row.authority ?? row.authorityValue ?? row.authority_value)] || String(row.authority),
    code: row.authority_code || row.code || ''
  })).filter((row) => row.authority !== null && row.code);
}

function normalizePlanTitleRows(rows, errors, label) {
  const titles = Array.isArray(rows) ? rows : [];
  const normalized = [];
  const seen = new Set();

  for (const row of titles) {
    const locale = getLocaleValue(row?.localeValue ?? row?.locale ?? row?.localeLabel, null);
    const title = String(row?.title ?? '').trim();
    if (locale === null || !title) {
      continue;
    }
    if (seen.has(locale)) {
      errors.push(`${label} has duplicated title locale: ${formatDbLocaleValue(locale)}.`);
      continue;
    }
    seen.add(locale);
    normalized.push({
      locale,
      localeLabel: formatDbLocaleValue(locale),
      title,
      normalizedTitle: normalizeTitleForDb(title),
      fallback: Boolean(row?.fallback)
    });
  }

  const fallbackRows = normalized.filter((row) => row.fallback);
  if (normalized.length && fallbackRows.length !== 1) {
    errors.push(`${label} must have exactly one fallback title.`);
  }

  return normalized.sort((left, right) => left.locale - right.locale);
}

function normalizePlanAuthorityRows(rows) {
  const authorities = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const authority = getAuthorityValue(row?.authorityValue ?? row?.authority ?? row?.authorityLabel);
    const code = String(row?.code ?? row?.authority_code ?? '').trim();
    if (authority === null || !code) {
      continue;
    }
    pushUniqueByKey(authorities, {
      authority,
      authorityLabel: DB_AUTHORITY_LABELS[authority] || String(authority),
      code
    }, (item) => `${item.authority}:${item.code}`);
  }

  return authorities.sort(compareAuthorityRows);
}

function getSortedAuthorityRows(authorities) {
  return [...(Array.isArray(authorities) ? authorities : [])]
    .sort(compareAuthorityRows);
}

function normalizePlanLocaleRows(rows, fallbackLocale, errors) {
  const sourceRows = Array.isArray(rows) && rows.length
    ? rows
    : [{ locale: fallbackLocale, isPrimary: true }];
  const locales = [];
  const seen = new Set();

  for (const row of sourceRows) {
    const locale = getLocaleValue(row?.localeValue ?? row?.locale ?? row?.localeLabel, null);
    if (locale === null) {
      continue;
    }
    if (seen.has(locale)) {
      errors.push(`Song locales contains duplicated locale: ${formatDbLocaleValue(locale)}.`);
      continue;
    }
    seen.add(locale);
    locales.push({
      locale,
      localeLabel: formatDbLocaleValue(locale),
      isPrimary: Boolean(row?.isPrimary)
    });
  }

  if (!locales.length) {
    locales.push({
      locale: fallbackLocale,
      localeLabel: formatDbLocaleValue(fallbackLocale),
      isPrimary: true
    });
  }

  if (!locales.some((row) => row.isPrimary)) {
    locales[0].isPrimary = true;
  }

  const primary = locales.find((row) => row.isPrimary);
  for (const row of locales) {
    row.isPrimary = row.locale === primary.locale;
  }

  return locales.sort((left, right) => (right.isPrimary ? 1 : 0) - (left.isPrimary ? 1 : 0) || left.locale - right.locale);
}

function normalizePlanArtistRows(rows, errors, label = 'Song artists', { allowSongArtistReference = false } = {}) {
  const artists = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const artistId = Number(row?.artistId ?? row?.artist_id);
    const rawSongArtistIndex = row?.songArtistIndex ?? row?.song_artist_index;
    const songArtistIndex = rawSongArtistIndex === null || rawSongArtistIndex === undefined || rawSongArtistIndex === ''
      ? null
      : Number(rawSongArtistIndex);
    const referencesSongArtist = allowSongArtistReference && Number.isInteger(songArtistIndex) && songArtistIndex >= 0;
    const title = String(row?.title ?? '').trim();
    if (!Number.isInteger(artistId) || artistId <= 0) {
      if (!row?.createMissing && !referencesSongArtist) {
        errors.push(`${label} contains a missing or invalid artist ID.`);
        continue;
      }
    }
    pushUniqueByKey(artists, {
      artistId: Number.isInteger(artistId) && artistId > 0 ? artistId : null,
      songArtistIndex: referencesSongArtist ? songArtistIndex : null,
      createMissing: referencesSongArtist ? false : Boolean(row?.createMissing),
      displayTitle: row?.displayTitle && String(row.displayTitle).trim() ? String(row.displayTitle).trim() : null,
      role: Number.isInteger(Number(row?.role)) ? Number(row.role) : 0,
      artistTag: Number(row?.artistTag ?? row?.artist_tag ?? 0),
      metadataLoaded: Boolean(row?.metadataLoaded ?? row?.metadata_loaded),
      title: title || (Number.isInteger(artistId) && artistId > 0 ? `Artist ${artistId}` : 'New Artist'),
      titles: normalizePlanTitleRows(row?.titles, errors, Number.isInteger(artistId) && artistId > 0 ? `Artist ${artistId}` : 'New Artist'),
      aliases: Array.isArray(row?.aliases) ? row.aliases.map((alias) => String(alias).trim()).filter(Boolean) : [],
      artwork: row?.artwork ? String(row.artwork).trim() : null,
      authorities: normalizePlanAuthorityRows(row?.authorities)
    }, (item) => {
      if (item.artistId) {
        return String(item.artistId);
      }
      if (item.songArtistIndex !== null && item.songArtistIndex !== undefined) {
        return `song-artist:${item.songArtistIndex}`;
      }
      return `new:${item.title}:${item.titles.map((titleRow) => titleRow.title).join('|')}`;
    });
  }

  return artists;
}

function normalizePlanAlbumRows(rows, errors) {
  const albums = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const albumId = Number(row?.albumId ?? row?.album_id);
    if (!Number.isInteger(albumId) || albumId <= 0) {
      if (!row?.createMissing) {
        errors.push('Albums contains a missing or invalid album ID.');
        continue;
      }
    }

    const discNumber = Number(row?.discNumber ?? row?.disc_number ?? 1);
    const discCount = Number(row?.discCount ?? row?.disc_count);
    const trackNumber = Number(row?.trackNumber ?? row?.track_number);
    const trackCount = Number(row?.trackCount ?? row?.track_count);
    const releaseDate = row?.releaseDate ? String(row.releaseDate).slice(0, 10) : null;
    const albumType = row?.albumType ?? null;
    const artists = getAlbumTypeValue(albumType) === 3
      ? []
      : normalizePlanArtistRows(row?.artists, errors, `Album ${albumId} artists`, { allowSongArtistReference: true });

    albums.push({
      albumId: Number.isInteger(albumId) && albumId > 0 ? albumId : null,
      createMissing: Boolean(row?.createMissing),
      authorityCode: String(row?.authorityCode ?? ''),
      title: String(row?.title ?? '').trim() || (Number.isInteger(albumId) && albumId > 0 ? `Album ${albumId}` : 'New Album'),
      titles: normalizePlanTitleRows(row?.titles, errors, Number.isInteger(albumId) && albumId > 0 ? `Album ${albumId}` : 'New Album'),
      albumType,
      artwork: row?.artwork ?? null,
      releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate || '') ? releaseDate : null,
      discNumber: Number.isInteger(discNumber) && discNumber > 0 ? discNumber : 1,
      discCount: Number.isInteger(discCount) && discCount > 0 ? discCount : null,
      trackNumber: Number.isInteger(trackNumber) && trackNumber > 0 ? trackNumber : null,
      trackCount: Number.isInteger(trackCount) && trackCount > 0 ? trackCount : null,
      artists,
      authorities: normalizePlanAuthorityRows(row?.authorities)
    });
  }

  return albums;
}

function normalizeSongPlan(input, fallbackPreview = null) {
  const errors = [];
  const source = input && typeof input === 'object' ? input : {};
  const song = source.song && typeof source.song === 'object' ? source.song : source;
  const targetSongId = Number(source.targetSongId ?? song.targetSongId ?? song.existingSongId ?? source.existingSongId);
  const locale = getLocaleValue(song.localeValue ?? song.locale ?? song.localeLabel, DB_LOCALE_VALUES.und);
  const duration = Number(song.duration);
  const vocal = Number(song.vocal);
  const genreTag = Number(song.genreTag);
  const genreInfo = Number(song.genreInfo);
  const mediaTag = Number(song.mediaTag);
  const releaseDate = song.releaseDate ? String(song.releaseDate).slice(0, 10) : null;
  const locales = normalizePlanLocaleRows(song.locales, locale, errors);

  const plan = {
    ...fallbackPreview,
    targetSongId: Number.isInteger(targetSongId) && targetSongId > 0 ? targetSongId : null,
    existingSongId: Number.isInteger(targetSongId) && targetSongId > 0 ? targetSongId : toInt(fallbackPreview?.existingSongId),
    song: {
      audio: song.audio ? String(song.audio).trim() : null,
      duration: Number.isInteger(duration) && duration > 0 ? duration : 0,
      genreTag: Number.isFinite(genreTag) ? genreTag : 0,
      genreInfo: Number.isInteger(genreInfo) ? genreInfo : 0,
      mediaTag: Number.isInteger(mediaTag) ? mediaTag : 0,
      releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate || '') ? releaseDate : null,
      vocal: Number.isInteger(vocal) ? vocal : 4,
      locale: locales.find((row) => row.isPrimary)?.locale ?? locale,
      localeLabel: formatDbLocaleValue(locales.find((row) => row.isPrimary)?.locale ?? locale),
      locales,
      titles: normalizePlanTitleRows(song.titles, errors, 'Song'),
      artists: normalizePlanArtistRows(song.artists, errors),
      albums: normalizePlanAlbumRows(song.albums, errors),
      authorities: normalizePlanAuthorityRows(song.authorities)
    },
    errors: [],
    warnings: Array.isArray(fallbackPreview?.warnings) ? fallbackPreview.warnings : [],
    entries: Array.isArray(fallbackPreview?.entries) ? fallbackPreview.entries : []
  };

  if (!plan.song.titles.length) {
    errors.push('Song must have at least one title.');
  }
  if (!plan.song.artists.length) {
    errors.push('Song must have at least one artist.');
  }
  if (plan.song.duration <= 0) {
    errors.push('Song duration must be positive.');
  }

  plan.errors = errors;
  return plan;
}

function normalizeArtistEditPlan(input, artistId) {
  const errors = [];
  const source = input && typeof input === 'object' ? input : {};
  const artistTag = Number(source.artistTag ?? source.artist_tag);
  const plan = {
    artistId,
    artistTag: Number.isInteger(artistTag) ? artistTag : 0,
    artwork: source.artwork ? String(source.artwork).trim() : null,
    titles: normalizePlanTitleRows(source.titles, errors, `Artist ${artistId}`),
    aliases: Array.isArray(source.aliases) ? source.aliases.map((alias) => String(alias).trim()).filter(Boolean) : [],
    authorities: normalizePlanAuthorityRows(source.authorities),
    relations: normalizePlanArtistRelationRows(source.relations ?? source.editableRelations, artistId, errors),
    errors
  };
  if (!plan.titles.length) {
    errors.push('Artist must have at least one title.');
  }
  return plan;
}

function normalizePlanArtistRelationRows(rows, artistId, errors) {
  const relations = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const refArtistId = normalizePositiveInteger(row?.refArtistId ?? row?.ref_artist_id ?? row?.artistId ?? row?.artist_id);
    const relationToRef = getRelationValue(row?.relationToRef ?? row?.relation_to_ref ?? row?.relation);

    if (!refArtistId) {
      errors.push('Artist relations contains a missing or invalid artist ID.');
      continue;
    }
    if (refArtistId === artistId) {
      errors.push('Artist relations cannot reference the artist itself.');
      continue;
    }
    if (relationToRef === null) {
      errors.push(`Artist relations contains an unknown relation: ${row?.relationToRef ?? row?.relation_to_ref ?? row?.relation}`);
      continue;
    }

    pushUniqueByKey(relations, {
      refArtistId,
      relationToRef,
      title: String(row?.title ?? '').trim() || `Artist ${refArtistId}`
    }, (item) => `${item.refArtistId}:${item.relationToRef}`);
  }

  return relations.sort((left, right) => left.relationToRef - right.relationToRef || left.refArtistId - right.refArtistId);
}

function normalizeExistingArtistRows(rows, errors, label) {
  const artists = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const artistId = normalizePositiveInteger(row?.artistId ?? row?.artist_id);
    if (!artistId) {
      errors.push(`${label} contains a missing or invalid artist ID.`);
      continue;
    }
    if (seen.has(artistId)) {
      continue;
    }
    seen.add(artistId);
    artists.push({
      artistId,
      displayTitle: row?.displayTitle && String(row.displayTitle).trim() ? String(row.displayTitle).trim() : null,
      role: Number.isInteger(Number(row?.role)) ? Number(row.role) : 0
    });
  }
  return artists;
}

function normalizeAlbumEditPlan(input, albumId) {
  const errors = [];
  const source = input && typeof input === 'object' ? input : {};
  const discCount = normalizePositiveInteger(source.discCount ?? source.disc_count);
  const trackCounts = [];
  const tracks = [];

  for (const row of Array.isArray(source.trackCounts) ? source.trackCounts : []) {
    const discNumber = normalizePositiveInteger(row?.discNumber ?? row?.disc_number);
    const trackCount = normalizePositiveInteger(row?.trackCount ?? row?.track_count);
    if (!discNumber || !trackCount) {
      errors.push(`Album ${albumId} track counts contains a missing or invalid value.`);
      continue;
    }
    trackCounts.push({ discNumber, trackCount });
  }

  for (const row of Array.isArray(source.tracks) ? source.tracks : []) {
    const songId = normalizePositiveInteger(row?.songId ?? row?.song_id);
    const discNumber = normalizePositiveInteger(row?.discNumber ?? row?.disc_number, 1);
    const trackNumber = normalizePositiveInteger(row?.trackNumber ?? row?.track_number);
    if (!songId || !trackNumber) {
      errors.push(`Album ${albumId} songs contains a missing or invalid song ID or track number.`);
      continue;
    }
    tracks.push({ songId, discNumber, trackNumber });
  }

  const plan = {
    albumId,
    albumType: getAlbumTypeValue(source.albumType ?? source.album_type),
    artwork: source.artwork ? String(source.artwork).trim() : null,
    discCount,
    releaseDate: compactDate(source.releaseDate ?? source.release_date),
    titles: normalizePlanTitleRows(source.titles, errors, `Album ${albumId}`),
    artists: normalizeExistingArtistRows(source.artists, errors, `Album ${albumId} artists`),
    trackCounts,
    tracks,
    authorities: normalizePlanAuthorityRows(source.authorities),
    errors
  };
  if (!plan.titles.length) {
    errors.push('Album must have at least one title.');
  }
  return plan;
}

function normalizeSongEditPlan(input, songId) {
  const errors = [];
  const source = input && typeof input === 'object' ? input : {};
  const locale = getLocaleValue(source.localeValue ?? source.locale ?? source.localeLabel, DB_LOCALE_VALUES.und);
  const locales = normalizePlanLocaleRows(source.locales, locale, errors);
  const duration = Number(source.duration);
  const vocal = Number(source.vocal);
  const genreTag = Number(source.genreTag);
  const genreInfo = Number(source.genreInfo);
  const mediaTag = Number(source.mediaTag);
  const albums = [];
  const seenAlbums = new Set();

  for (const row of Array.isArray(source.albums) ? source.albums : []) {
    const albumId = normalizePositiveInteger(row?.albumId ?? row?.album_id);
    const discNumber = normalizePositiveInteger(row?.discNumber ?? row?.disc_number, 1);
    const trackNumber = normalizePositiveInteger(row?.trackNumber ?? row?.track_number);
    if (!albumId) {
      errors.push('Song albums contains a missing or invalid album ID.');
      continue;
    }
    const key = `${albumId}:${discNumber}:${trackNumber ?? ''}`;
    if (seenAlbums.has(key)) {
      continue;
    }
    seenAlbums.add(key);
    albums.push({
      albumId,
      discNumber,
      trackNumber,
      trackCount: normalizePositiveInteger(row?.trackCount ?? row?.track_count)
    });
  }

  const plan = {
    songId,
    song: {
      audio: source.audio ? String(source.audio).trim() : null,
      duration: Number.isInteger(duration) && duration > 0 ? duration : 0,
      genreTag: Number.isFinite(genreTag) ? genreTag : 0,
      genreInfo: Number.isInteger(genreInfo) ? genreInfo : 0,
      mediaTag: Number.isInteger(mediaTag) ? mediaTag : 0,
      releaseDate: compactDate(source.releaseDate ?? source.release_date),
      vocal: Number.isInteger(vocal) ? vocal : 4,
      locale: locales.find((row) => row.isPrimary)?.locale ?? locale,
      localeLabel: formatDbLocaleValue(locales.find((row) => row.isPrimary)?.locale ?? locale),
      locales,
      titles: normalizePlanTitleRows(source.titles, errors, `Song ${songId}`),
      artists: normalizeExistingArtistRows(source.artists, errors, `Song ${songId} artists`),
      albums,
      authorities: normalizePlanAuthorityRows(source.authorities)
    },
    errors
  };
  if (!plan.song.titles.length) {
    errors.push('Song must have at least one title.');
  }
  if (!plan.song.artists.length) {
    errors.push('Song must have at least one artist.');
  }
  if (plan.song.duration <= 0) {
    errors.push('Song duration must be positive.');
  }
  return plan;
}

function throwEditErrors(plan) {
  if (plan.errors?.length) {
    const error = new Error(plan.errors.join(' '));
    error.status = 409;
    throw error;
  }
}

function getAlbumTypeValue(value) {
  if (Number.isInteger(Number(value)) && DB_ALBUM_LABELS[Number(value)] !== undefined) {
    return Number(value);
  }

  const key = String(value ?? '').trim().toLowerCase();
  return DB_ALBUM_VALUES[key] ?? 2;
}

function getRawIdValue(item, keys) {
  const value = extractRawId(item, keys);
  return value === null || value === undefined || value === '' ? null : String(value);
}

function getTrackCount(album, discNumber) {
  const trackCount = album?.trackCount;
  if (!trackCount || typeof trackCount !== 'object') {
    return null;
  }

  const value = trackCount[String(discNumber)] ?? trackCount[discNumber];
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function pushUniqueByKey(target, item, getKey) {
  const key = getKey(item);
  if (!key || target.some((existing) => getKey(existing) === key)) {
    return;
  }
  target.push(item);
}

function collectRawItemsByAuthorityCode(entries, collectionName, keys) {
  const result = new Map();

  for (const entry of entries) {
    const items = entry.raw_json && Array.isArray(entry.raw_json[collectionName])
      ? entry.raw_json[collectionName]
      : [];
    for (const item of items) {
      const code = getRawIdValue(item, keys);
      if (code && !result.has(code)) {
        result.set(code, item);
      }
    }
  }

  return result;
}

function buildSongTitlePlan(entries, warnings, errors) {
  const titleByLocale = new Map();
  const conflicts = [];
  let audioLocaleValue = DB_LOCALE_VALUES.und;

  for (const entry of entries) {
    const song = getFirstSong(entry.raw_json);
    const audio = song.audio;
    if (audio && audioLocaleValue === DB_LOCALE_VALUES.und) {
      audioLocaleValue = getLocaleValue(audio, DB_LOCALE_VALUES.und);
    }

    const titleMap = getTitleMap(song);
    for (const [localeKey, title] of Object.entries(titleMap)) {
      const locale = getLocaleValue(localeKey, DB_LOCALE_VALUES.und);
      const existing = titleByLocale.get(locale);
      if (existing && existing !== title) {
        conflicts.push({
          locale: formatDbLocaleValue(locale),
          existing,
          incoming: title,
          entry_id: toInt(entry.entry_id)
        });
        continue;
      }
      titleByLocale.set(locale, title);
    }
  }

  const titleRows = [...titleByLocale.entries()]
    .map(([locale, title]) => ({
      locale,
      localeLabel: formatDbLocaleValue(locale),
      title,
      normalizedTitle: normalizeTitleForDb(title),
      fallback: false
    }))
    .sort((left, right) => left.locale - right.locale);

  if (!titleRows.length) {
    errors.push('No song title was found in grouped entries.');
    return titleRows;
  }

  if (conflicts.length) {
    warnings.push({
      type: 'TITLE_CONFLICT',
      message: 'Some entries have conflicting titles for the same locale. The first value will be used.',
      conflicts
    });
  }

  const fallbackLocale = chooseFallbackTitleLocale(titleRows, audioLocaleValue);
  if (fallbackLocale === null) {
    errors.push('Fallback title locale cannot be determined automatically.');
    return titleRows;
  }

  const fallbackRow = titleRows.find((row) => row.locale === fallbackLocale);
  if (fallbackRow) {
    fallbackRow.fallback = true;
  }

  return titleRows;
}

function buildEntryGroupSongPlan(groupRow, entryRows, artistRows, albumRows) {
  const warnings = [];
  const errors = [];
  const entries = entryRows.map((entry) => ({
    ...entry,
    raw_json: entry.raw_json || {}
  }));
  const songs = entries.map((entry) => getFirstSong(entry.raw_json));
  const primarySong = songs[0] || {};
  const titleRows = buildSongTitlePlan(entries, warnings, errors);
  const rawArtistsByCode = collectRawItemsByAuthorityCode(entries, 'artists', ['id', 'artistId', 'artistID']);
  const rawAlbumsByCode = collectRawItemsByAuthorityCode(entries, 'albums', ['id', 'albumId', 'albumID']);
  const releaseDate = pickEarliestDate(songs.map((song) => song.releaseDate || song.release_date));
  const duration = pickRepresentativeDuration(entries);
  const audio = songs.map((song) => song.audio).find(Boolean) || null;
  const locale = getLocaleValue(audio, DB_LOCALE_VALUES.und);
  const artistCodes = [];
  const albumCodes = [];
  const authorities = [];
  const albums = [];

  for (const entry of entries) {
    const rawJson = entry.raw_json;
    const song = getFirstSong(rawJson);
    const songId = getRawIdValue(song, ['id']);
    const isrc = getRawIdValue(song, ['isrc']);
    const albumId = getRawIdValue(song, ['albumID', 'albumId', 'album_id']);
    const album = getFirstAlbum(rawJson, albumId);
    const discNumber = Number(song.discNumber || song.disc_number || 1);
    const trackNumber = Number(song.trackNumber || song.track_number || 0);
    const albumReleaseDate = pickEarliestDate([
      album?.releaseDate,
      album?.release_date,
      song.releaseDate,
      song.release_date
    ]);

    if (songId) {
      pushUniqueByKey(authorities, { authority: 1, authorityLabel: DB_AUTHORITY_LABELS[1], code: songId }, (item) => `${item.authority}:${item.code}`);
    }
    if (isrc) {
      pushUniqueByKey(authorities, { authority: 0, authorityLabel: DB_AUTHORITY_LABELS[0], code: isrc }, (item) => `${item.authority}:${item.code}`);
    }

    for (const key of ['artistID', 'artistId', 'artist_id']) {
      const value = song[key];
      if (Array.isArray(value)) {
        value.forEach((id) => {
          if (id !== null && id !== undefined && id !== '') {
            pushUniqueByKey(artistCodes, String(id), (item) => item);
          }
        });
      } else if (value !== null && value !== undefined && value !== '') {
        pushUniqueByKey(artistCodes, String(value), (item) => item);
      }
    }

    if (albumId) {
      pushUniqueByKey(albumCodes, albumId, (item) => item);
      const albumRow = albumRows.get(albumId);
      pushUniqueByKey(albums, {
        authorityCode: albumId,
        albumId: albumRow?.album_id ? toInt(albumRow.album_id) : null,
        title: albumRow?.title || getPreviewTitleValue(album) || entry.raw_album || `Album ${albumId}`,
        titles: albumRow?.titles ? normalizeTitleRows(albumRow.titles) : getPreviewTitleRowsFromItem(album || rawAlbumsByCode.get(albumId)),
        albumType: albumRow?.album_type === null || albumRow?.album_type === undefined ? null : (DB_ALBUM_LABELS[albumRow.album_type] || String(albumRow.album_type)),
        artwork: albumRow?.artwork || album?.artwork || null,
        releaseDate: albumRow?.release_date || albumReleaseDate || null,
        discCount: albumRow?.disc_count ? toInt(albumRow.disc_count) : null,
        artists: (albumRow?.artists || []).map((artist) => ({
          artistId: toInt(artist.artist_id),
          artistTag: Number(artist.artist_tag || 0),
          metadataLoaded: true,
          title: artist.title || `Artist ${artist.artist_id}`,
          titles: normalizeTitleRows(artist.titles),
          aliases: artist.aliases || [],
          artwork: artist.artwork || null,
          authorities: getPreviewAuthorityRows(artist.authorities)
        })),
        authorities: getPreviewAuthorityRows(albumRow?.authorities || [
          { authority: 1, authority_code: albumId }
        ]),
        discNumber: Number.isInteger(discNumber) && discNumber > 0 ? discNumber : 1,
        trackNumber: Number.isInteger(trackNumber) && trackNumber > 0 ? trackNumber : null,
        trackCount: getTrackCount(album, discNumber)
      }, (item) => `${item.authorityCode}:${item.discNumber}:${item.trackNumber ?? ''}`);
    }
  }

  const artists = artistCodes.map((code) => {
    const row = artistRows.get(code);
    const rawArtist = rawArtistsByCode.get(code);
    return {
      authorityCode: code,
      artistId: row?.artist_id ? toInt(row.artist_id) : null,
      artistTag: Number(row?.artist_tag || 0),
      metadataLoaded: Boolean(row?.artist_id),
      role: 0,
      title: row?.title || getPreviewTitleValue(rawArtist) || code,
      titles: row?.titles ? normalizeTitleRows(row.titles) : getPreviewTitleRowsFromItem(rawArtist),
      aliases: row?.aliases || [],
      artwork: row?.artwork || rawArtist?.artwork || null,
      authorities: getPreviewAuthorityRows(row?.authorities || [
        { authority: 1, authority_code: code }
      ])
    };
  });

  const missingArtists = artists.filter((artist) => !artist.artistId);
  const missingAlbums = albums.filter((album) => !album.albumId);
  if (missingArtists.length) {
    errors.push(`Referenced artist authority was not found: ${missingArtists.map((artist) => artist.authorityCode).join(', ')}`);
  }
  if (missingAlbums.length) {
    errors.push(`Referenced album authority was not found: ${missingAlbums.map((album) => album.authorityCode).join(', ')}`);
  }

  if (!artists.length) {
    errors.push('No artist authority was found in grouped entries.');
  }
  if (duration <= 0) {
    errors.push('A positive song duration is required.');
  }

  return {
    groupId: toInt(groupRow.group_id),
    existingSongId: toInt(groupRow.canonical_song_id),
    entries: entries.map((entry) => ({
      entryId: toInt(entry.entry_id),
      sourceId: toInt(entry.source_id),
      sourceItemId: toInt(entry.source_item_id),
      rawTitle: entry.raw_title,
      rawArtist: entry.raw_artist,
      rawAlbum: entry.raw_album,
      rawDuration: toInt(entry.raw_duration)
    })),
    song: {
      audio,
      duration,
      genreTag: 0,
      genreInfo: 0,
      mediaTag: 0,
      releaseDate,
      vocal: 4,
      locale,
      localeLabel: formatDbLocaleValue(locale),
      locales: [{
        locale,
        localeLabel: formatDbLocaleValue(locale),
        isPrimary: true
      }],
      titles: titleRows,
      artists,
      albums,
      authorities: authorities.sort(compareAuthorityRows)
    },
    warnings,
    errors
  };
}

function normalizeMappingRow(row) {
  const rawJson = row.entry_raw_json || {};

  return {
    entryId: toInt(row.entry_id),
    songId: toInt(row.song_id),
    confidence: row.confidence === null ? null : Number(row.confidence),
    matchMethod: DB_METHODS[row.match_method] || `UNKNOWN(${row.match_method})`,
    status: DB_STATUSES[row.status] || `UNKNOWN(${row.status})`,
    createdAt: row.created_at,
    sourceId: toInt(row.source_id),
    sourceItemId: toInt(row.source_item_id),
    sourceFile: row.source_file,
    sourceType: toInt(row.source_type),
    entryTitle: row.raw_title,
    entryArtist: row.raw_artist,
    entryAlbum: row.raw_album,
    entryArtwork: row.entry_artwork,
    entryDuration: toInt(row.raw_duration),
    entryAppleMusicIds: extractEntryAppleMusicIds(rawJson),
    entryTitles: extractEntryTitleRows(rawJson),
    entryArtistTitleGroups: extractRawTitleGroups(rawJson, 'artists', ['id', 'artistId', 'artistID']),
    entryAlbumTitleGroups: extractRawTitleGroups(rawJson, 'albums', ['id', 'albumId', 'albumID']),
    songTitle: row.song_title,
    songTitles: normalizeTitleRows(row.song_title_variants),
    songArtists: row.song_artists || [],
    artistTitleGroups: normalizeTitleGroups(row.artist_title_groups, 'artist_id'),
    songAlbum: row.song_album,
    albumTitleGroups: normalizeTitleGroups(row.album_title_groups, 'album_id'),
    albumArtwork: row.album_artwork,
    songDuration: toInt(row.song_duration),
    appleMusicIds: row.apple_music_ids || []
  };
}

function normalizeIssueRow(row) {
  const rawJson = row.entry_raw_json || {};

  return {
    issueId: toInt(row.issue_id),
    entryId: toInt(row.entry_id),
    songId: toInt(row.song_id),
    matchMethod: row.match_method === null ? null : (DB_METHODS[row.match_method] || `UNKNOWN(${row.match_method})`),
    reason: row.reason,
    details: row.details || {},
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    sourceId: toInt(row.source_id),
    sourceItemId: toInt(row.source_item_id),
    sourceFile: row.source_file,
    entryTitle: row.raw_title,
    entryArtist: row.raw_artist,
    entryAlbum: row.raw_album,
    entryArtwork: row.entry_artwork,
    entryDuration: toInt(row.raw_duration),
    entryAppleMusicIds: extractEntryAppleMusicIds(rawJson),
    entryTitles: extractEntryTitleRows(rawJson),
    entryArtistTitleGroups: extractRawTitleGroups(rawJson, 'artists', ['id', 'artistId', 'artistID']),
    entryAlbumTitleGroups: extractRawTitleGroups(rawJson, 'albums', ['id', 'albumId', 'albumID']),
    songTitle: row.song_title,
    songTitles: normalizeTitleRows(row.song_title_variants),
    songArtists: row.song_artists || [],
    artistTitleGroups: normalizeTitleGroups(row.artist_title_groups, 'artist_id'),
    songAlbum: row.song_album,
    albumTitleGroups: normalizeTitleGroups(row.album_title_groups, 'album_id'),
    albumArtwork: row.album_artwork,
    songDuration: toInt(row.song_duration),
    appleMusicIds: row.apple_music_ids || []
  };
}

function normalizeEntryGroupRow(row) {
  return {
    groupId: toInt(row.group_id),
    status: DB_STATUSES[row.status] || `UNKNOWN(${row.status})`,
    canonicalSongId: toInt(row.canonical_song_id),
    matchMethod: row.match_method === null ? null : (DB_METHODS[row.match_method] || `UNKNOWN(${row.match_method})`),
    confidence: row.confidence === null ? null : Number(row.confidence),
    details: row.details || {},
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    entries: (row.entries || []).map((entry) => ({
      entryId: toInt(entry.entry_id),
      sourceId: toInt(entry.source_id),
      sourceItemId: toInt(entry.source_item_id),
      sourceType: toInt(entry.source_type),
      sourceFile: entry.source_file,
      rawTitle: entry.raw_title,
      rawArtist: entry.raw_artist,
      rawAlbum: entry.raw_album,
      rawDuration: toInt(entry.raw_duration),
      artwork: entry.entry_artwork
    })),
    issues: (row.issues || []).map((issue) => ({
      issueId: toInt(issue.issue_id),
      entryId: toInt(issue.entry_id),
      songId: toInt(issue.song_id),
      matchMethod: issue.match_method === null ? null : (DB_METHODS[issue.match_method] || `UNKNOWN(${issue.match_method})`),
      reason: issue.reason,
      details: issue.details || {},
      createdAt: issue.created_at,
      resolvedAt: issue.resolved_at
    })),
    songTitle: row.song_title,
    songTitles: normalizeTitleRows(row.song_title_variants),
    songArtists: row.song_artists || [],
    artistTitleGroups: normalizeTitleGroups(row.artist_title_groups, 'artist_id'),
    songAlbum: row.song_album,
    albumTitleGroups: normalizeTitleGroups(row.album_title_groups, 'album_id'),
    albumArtwork: row.album_artwork,
    songDuration: toInt(row.song_duration),
    appleMusicIds: row.apple_music_ids || []
  };
}

function parseIntegerQuery(value, fallback, { min = 1, max = 10000 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function getEnumValueByName(map, name) {
  if (!name || name === 'ANY') {
    return null;
  }

  const normalized = String(name).toUpperCase();
  for (const [value, label] of Object.entries(map)) {
    if (label === normalized) {
      return Number(value);
    }
  }

  return null;
}

function getRequiredEnumValueByName(map, name, label) {
  const value = getEnumValueByName(map, name);
  if (value === null) {
    const error = new Error(`Unknown ${label}: ${name}`);
    error.status = 400;
    throw error;
  }
  return value;
}

function handleError(res, error) {
  const status = error.status || 500;
  res.status(status).json({
    message: error.message || 'Unexpected server error.',
    detail: status >= 500 ? String(error.stack || error) : undefined
  });
}

function buildTableSearchWhere(table, config, search, params) {
  if (!search) {
    return '';
  }

  const searchParam = pushLatinSearchParam(params, search);
  const conditions = config.columns.map((column) => latinSearchCondition(`"${column}"`, searchParam));

  if (table === 'artist') {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM artist_titles at_search
        WHERE at_search.artist_id = ${config.relation}."${config.pk}"
          AND (
            ${latinSearchCondition('at_search.title', searchParam)}
            OR ${latinSearchCondition('at_search.normalized_title', searchParam)}
          )
      )
    `);
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM artist_alias aa_search
        WHERE aa_search.artist_id = ${config.relation}."${config.pk}"
          AND (
            ${latinSearchCondition('aa_search.alias', searchParam)}
            OR ${latinSearchCondition('aa_search.normalized_alias', searchParam)}
          )
      )
    `);
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM song_artists sa_search
        WHERE sa_search.artist_id = ${config.relation}."${config.pk}"
          AND ${latinSearchCondition('sa_search.display_title', searchParam)}
      )
    `);
  }

  return `(${conditions.join(' OR ')})`;
}

function buildEntryTableFilterWhere(query, params) {
  const where = [];
  const sourceType = Number(query.sourceType);
  const mappingStatus = String(query.mappingStatus || 'ANY').toUpperCase();

  if (Number.isInteger(sourceType) && DB_AUTHORITY_LABELS[sourceType] !== undefined) {
    params.push(sourceType);
    where.push(`"source_type" = $${params.length}`);
  }

  if (mappingStatus === 'MAPPED') {
    where.push('"song_id" IS NOT NULL');
  } else if (mappingStatus === 'UNMAPPED') {
    where.push('"song_id" IS NULL');
  } else if (Object.values(DB_STATUSES).includes(mappingStatus)) {
    params.push(mappingStatus);
    where.push(`"status" = $${params.length}`);
  }

  return where;
}

function buildTableFilterWhere(table, query, params) {
  if (table === 'entry') {
    return buildEntryTableFilterWhere(query, params);
  }
  return [];
}

function buildSongProjection() {
  return `
    st.title AS song_title,
    st.title_variants AS song_title_variants,
    ar.artist_names AS song_artists,
    ar.artist_title_groups AS artist_title_groups,
    alb.album_title AS song_album,
    alb.album_title_groups AS album_title_groups,
    alb.artwork AS album_artwork,
    s.duration AS song_duration,
    auth.apple_music_ids
  `;
}

function buildSongJoins(songIdExpression) {
  return `
    LEFT JOIN songs s
      ON s.song_id = ${songIdExpression}
    LEFT JOIN LATERAL (
      SELECT
        (array_agg(
          title
          ORDER BY ${titleDisplayOrderSql()}
        ))[1] AS title,
        jsonb_agg(
          jsonb_build_object(
            'locale', locale,
            'title', title,
            'fallback', fallback
          )
          ORDER BY ${titleDisplayOrderSql()}
        ) AS title_variants
      FROM song_titles
      WHERE song_id = ${songIdExpression}
    ) st ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        array_agg(COALESCE(sa.display_title, pref.title, '') ORDER BY sa.display_order) AS artist_names,
        jsonb_agg(
          jsonb_build_object(
            'artist_id', sa.artist_id,
            'titles', COALESCE(artist_titles.titles, '[]'::jsonb)
          )
          ORDER BY sa.display_order
        ) AS artist_title_groups
      FROM song_artists sa
      LEFT JOIN LATERAL (
        SELECT title
        FROM artist_titles
        WHERE artist_id = sa.artist_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) pref ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'locale', locale,
            'title', title,
            'fallback', fallback
          )
          ORDER BY ${titleDisplayOrderSql()}
        ) AS titles
        FROM artist_titles
        WHERE artist_id = sa.artist_id
      ) artist_titles ON TRUE
      WHERE sa.song_id = ${songIdExpression}
    ) ar ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(authority_code ORDER BY authority_code) AS apple_music_ids
      FROM song_authorities
      WHERE song_id = ${songIdExpression}
        AND authority = 1
    ) auth ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        al.album_id,
        album_title.title AS album_title,
        album_titles.titles AS album_title_groups,
        al.artwork
      FROM album_tracks atr
      JOIN albums al
        ON al.album_id = atr.album_id
      LEFT JOIN LATERAL (
        SELECT title
        FROM album_titles
        WHERE album_id = atr.album_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) album_title ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_build_array(
          jsonb_build_object(
            'album_id', atr.album_id,
            'titles', COALESCE(jsonb_agg(
              jsonb_build_object(
                'locale', locale,
                'title', title,
                'fallback', fallback
              )
              ORDER BY ${titleDisplayOrderSql()}
            ), '[]'::jsonb)
          )
        ) AS titles
        FROM album_titles
        WHERE album_id = atr.album_id
      ) album_titles ON TRUE
      WHERE atr.song_id = ${songIdExpression}
      ORDER BY
        CASE
          WHEN al.album_type = 3 THEN 2
          WHEN al.album_type = 2 THEN 2
          WHEN al.album_type = 1 THEN 1
          ELSE 0
        END,
        al.release_date NULLS LAST,
        atr.album_id
      LIMIT 1
    ) alb ON TRUE
  `;
}

function mappingChangeData(row) {
  if (!row) {
    return null;
  }

  return {
    entry_id: toInt(row.entry_id),
    song_id: toInt(row.song_id),
    confidence: row.confidence === null ? null : Number(row.confidence),
    match_method: toInt(row.match_method),
    status: toInt(row.status),
    created_at: row.created_at
  };
}

function entryGroupChangeData(row) {
  if (!row) {
    return null;
  }

  return {
    group_id: toInt(row.group_id),
    status: toInt(row.status),
    canonical_song_id: toInt(row.canonical_song_id),
    match_method: toInt(row.match_method),
    confidence: row.confidence === null ? null : Number(row.confidence),
    details: row.details || {},
    created_at: row.created_at,
    resolved_at: row.resolved_at
  };
}


async function loadEntryGroupForSongPlan(client, groupId, { lock = false } = {}) {
  const groupRows = await client.query(`
    SELECT group_id, status, canonical_song_id, match_method, confidence, details, created_at, resolved_at
    FROM entry_group
    WHERE group_id = $1
    ${lock ? 'FOR UPDATE' : ''}
  `, [groupId]);

  if (!groupRows.rows.length) {
    const error = new Error(`Entry group was not found: ${groupId}`);
    error.status = 404;
    throw error;
  }

  const entryRows = await client.query(`
    SELECT
      e.entry_id,
      e.source_id,
      e.source_item_id,
      e.raw_title,
      e.raw_artist,
      e.raw_album,
      e.raw_duration,
      e.raw_json
    FROM entry_group_entries ege
    JOIN entries e
      ON e.entry_id = ege.entry_id
    WHERE ege.group_id = $1
    ORDER BY e.entry_id
  `, [groupId]);

  return {
    groupRow: groupRows.rows[0],
    entryRows: entryRows.rows
  };
}

async function loadArtistAuthorityRows(client, authorityCodes) {
  if (!authorityCodes.length) {
    return new Map();
  }

  const rows = await client.query(`
    SELECT
      aa.authority_code,
      aa.artist_id,
      a.artist_tag,
      a.artwork,
      COALESCE(primary_title.title, aa.authority_code) AS title,
      COALESCE(titles.titles, '[]'::jsonb) AS titles,
      COALESCE(aliases.aliases, '[]'::jsonb) AS aliases,
      COALESCE(authorities.authorities, '[]'::jsonb) AS authorities
    FROM artist_authorities aa
    JOIN artists a
      ON a.artist_id = aa.artist_id
    LEFT JOIN LATERAL (
      SELECT title
      FROM artist_titles
      WHERE artist_id = aa.artist_id
      ORDER BY ${titleDisplayOrderSql()}
      LIMIT 1
    ) primary_title ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('locale', locale, 'title', title, 'fallback', fallback)
        ORDER BY ${titleDisplayOrderSql()}
      ) AS titles
      FROM artist_titles
      WHERE artist_id = aa.artist_id
    ) titles ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(alias ORDER BY alias) AS aliases
      FROM artist_alias
      WHERE artist_id = aa.artist_id
    ) aliases ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('authority', authority, 'authority_code', authority_code)
        ORDER BY authority, authority_code
      ) AS authorities
      FROM artist_authorities
      WHERE artist_id = aa.artist_id
    ) authorities ON TRUE
    WHERE aa.authority = 1
      AND aa.authority_code = ANY($1::text[])
  `, [authorityCodes]);

  return new Map(rows.rows.map((row) => [String(row.authority_code), row]));
}

async function loadAlbumAuthorityRows(client, authorityCodes) {
  if (!authorityCodes.length) {
    return new Map();
  }

  const rows = await client.query(`
    SELECT
      aa.authority_code,
      aa.album_id,
      al.album_type,
      al.artwork,
      al.disc_count,
      al.release_date,
      COALESCE(primary_title.title, aa.authority_code) AS title,
      COALESCE(titles.titles, '[]'::jsonb) AS titles,
      COALESCE(artists.artists, '[]'::jsonb) AS artists,
      COALESCE(authorities.authorities, '[]'::jsonb) AS authorities
    FROM album_authorities aa
    JOIN albums al
      ON al.album_id = aa.album_id
    LEFT JOIN LATERAL (
      SELECT title
      FROM album_titles
      WHERE album_id = aa.album_id
      ORDER BY ${titleDisplayOrderSql()}
      LIMIT 1
    ) primary_title ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('locale', locale, 'title', title, 'fallback', fallback)
        ORDER BY ${titleDisplayOrderSql()}
      ) AS titles
      FROM album_titles
      WHERE album_id = aa.album_id
    ) titles ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'artist_id', album_artist.artist_id,
          'artist_tag', artist.artist_tag,
          'title', COALESCE(primary_artist_title.title, ''),
          'artwork', artist.artwork,
          'titles', COALESCE(artist_titles.titles, '[]'::jsonb),
          'aliases', COALESCE(artist_aliases.aliases, '[]'::jsonb),
          'authorities', COALESCE(artist_authorities.authorities, '[]'::jsonb)
        )
        ORDER BY album_artist.display_order
      ) AS artists
      FROM album_artists album_artist
      JOIN artists artist
        ON artist.artist_id = album_artist.artist_id
      LEFT JOIN LATERAL (
        SELECT title
        FROM artist_titles
        WHERE artist_id = album_artist.artist_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) primary_artist_title ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object('locale', locale, 'title', title, 'fallback', fallback)
          ORDER BY ${titleDisplayOrderSql()}
        ) AS titles
        FROM artist_titles
        WHERE artist_id = album_artist.artist_id
      ) artist_titles ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(alias ORDER BY alias) AS aliases
        FROM artist_alias
        WHERE artist_id = album_artist.artist_id
      ) artist_aliases ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object('authority', authority, 'authority_code', authority_code)
          ORDER BY authority, authority_code
        ) AS authorities
        FROM artist_authorities
        WHERE artist_id = album_artist.artist_id
      ) artist_authorities ON TRUE
      WHERE album_artist.album_id = aa.album_id
    ) artists ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('authority', authority, 'authority_code', authority_code)
        ORDER BY authority, authority_code
      ) AS authorities
      FROM album_authorities
      WHERE album_id = aa.album_id
    ) authorities ON TRUE
    WHERE aa.authority = 1
      AND aa.authority_code = ANY($1::text[])
  `, [authorityCodes]);

  return new Map(rows.rows.map((row) => [String(row.authority_code), row]));
}

function collectReferencedAuthorityCodes(entryRows) {
  const artistCodes = [];
  const albumCodes = [];

  for (const entry of entryRows) {
    const rawJson = entry.raw_json || {};
    const song = getFirstSong(rawJson);
    const albumId = getRawIdValue(song, ['albumID', 'albumId', 'album_id']);
    if (albumId) {
      pushUniqueByKey(albumCodes, albumId, (item) => item);
    }

    for (const key of ['artistID', 'artistId', 'artist_id']) {
      const value = song[key];
      if (Array.isArray(value)) {
        value.forEach((id) => {
          if (id !== null && id !== undefined && id !== '') {
            pushUniqueByKey(artistCodes, String(id), (item) => item);
          }
        });
      } else if (value !== null && value !== undefined && value !== '') {
        pushUniqueByKey(artistCodes, String(value), (item) => item);
      }
    }
  }

  return { artistCodes, albumCodes };
}

async function buildEntryGroupSongPreview(client, groupId, options = {}) {
  const { groupRow, entryRows } = await loadEntryGroupForSongPlan(client, groupId, options);
  const { artistCodes, albumCodes } = collectReferencedAuthorityCodes(entryRows);
  const artistRows = await loadArtistAuthorityRows(client, artistCodes);
  const albumRows = await loadAlbumAuthorityRows(client, albumCodes);
  const preview = buildEntryGroupSongPlan(groupRow, entryRows, artistRows, albumRows);

  if (!preview.existingSongId && preview.song.authorities.length) {
    const params = [];
    const clauses = preview.song.authorities.map((authority) => {
      params.push(authority.authority, authority.code);
      return `(authority = $${params.length - 1} AND authority_code = $${params.length})`;
    });
    const rows = await client.query(`
      SELECT song_id, authority, authority_code
      FROM song_authorities
      WHERE ${clauses.join(' OR ')}
      ORDER BY authority, authority_code, song_id
    `, params);
    if (rows.rows.length) {
      preview.errors.push(`Song authority already exists: ${rows.rows.map((row) => `${DB_AUTHORITY_LABELS[row.authority] || row.authority} ${row.authority_code} -> song ${row.song_id}`).join(', ')}`);
    }
  }

  return preview;
}

function throwPreviewErrors(preview) {
  if (!preview.errors.length) {
    return;
  }

  const error = new Error(preview.errors.join(' '));
  error.status = 409;
  throw error;
}


async function upsertConfirmedMappingForEntry(client, { entryId, songId, changedBy, reason }) {
  const changedRows = [];
  const otherRows = await client.query(`
    SELECT entry_id, song_id, confidence, match_method, status, created_at
    FROM entry_mapping
    WHERE entry_id = $1
      AND song_id <> $2
      AND status <> 2
    FOR UPDATE
  `, [entryId, songId]);

  for (const row of otherRows.rows) {
    const oldData = mappingChangeData(row);
    const updatedRows = await client.query(`
      UPDATE entry_mapping
      SET status = 2
      WHERE entry_id = $1
        AND song_id = $2
      RETURNING entry_id, song_id, confidence, match_method, status, created_at
    `, [row.entry_id, row.song_id]);
    const newData = mappingChangeData(updatedRows.rows[0]);
    
    changedRows.push(newData);
  }

  const targetRows = await client.query(`
    SELECT entry_id, song_id, confidence, match_method, status, created_at
    FROM entry_mapping
    WHERE entry_id = $1
      AND song_id = $2
    FOR UPDATE
  `, [entryId, songId]);

  if (!targetRows.rows.length) {
    const insertedRows = await client.query(`
      INSERT INTO entry_mapping(entry_id, song_id, confidence, match_method, status)
      VALUES ($1, $2, 1, 3, 1)
      RETURNING entry_id, song_id, confidence, match_method, status, created_at
    `, [entryId, songId]);
    const newData = mappingChangeData(insertedRows.rows[0]);
    
    changedRows.push(newData);
    return changedRows;
  }

  const oldTarget = mappingChangeData(targetRows.rows[0]);
  if (oldTarget.status !== 1 || oldTarget.confidence !== 1 || oldTarget.match_method !== 3) {
    const updatedRows = await client.query(`
      UPDATE entry_mapping
      SET confidence = 1,
          match_method = 3,
          status = 1
      WHERE entry_id = $1
        AND song_id = $2
      RETURNING entry_id, song_id, confidence, match_method, status, created_at
    `, [entryId, songId]);
    const newData = mappingChangeData(updatedRows.rows[0]);
    
    changedRows.push(newData);
  }

  return changedRows;
}

async function updateSongMainRow(client, songId, plan, { changedBy, reason }) {
  const oldRows = await client.query(`
    SELECT song_id, audio, duration, genre_tag, genre_info, media_tag, release_date, vocal, created_at, updated_at
    FROM songs
    WHERE song_id = $1
    FOR UPDATE
  `, [songId]);

  if (!oldRows.rows.length) {
    const error = new Error(`Song was not found: ${songId}`);
    error.status = 404;
    throw error;
  }

  const updatedRows = await client.query(`
    UPDATE songs
    SET audio = $2,
        duration = $3,
        genre_tag = $4,
        genre_info = $5,
        media_tag = $6,
        release_date = $7,
        vocal = $8,
        updated_at = now()
    WHERE song_id = $1
      AND (audio, duration, genre_tag, genre_info, media_tag, release_date, vocal) IS DISTINCT FROM ($2::text, $3::integer, $4::bigint, $5::bigint, $6::bigint, $7::date, $8::smallint)
    RETURNING song_id, audio, duration, genre_tag, genre_info, media_tag, release_date, vocal, created_at, updated_at
  `, [
    songId,
    plan.song.audio,
    plan.song.duration,
    plan.song.genreTag,
    plan.song.genreInfo,
    plan.song.mediaTag,
    plan.song.releaseDate,
    plan.song.vocal
  ]);

  
}

async function upsertSongLocales(client, songId, locales, { changedBy, reason }) {
  const normalized = Array.isArray(locales) && locales.length
    ? locales
    : [{ locale: DB_LOCALE_VALUES.und, isPrimary: true }];
  const localeValues = normalized.map((row) => row.locale);

  const oldRows = await client.query(`
    SELECT song_id, is_primary, locale
    FROM song_locales
    WHERE song_id = $1
    FOR UPDATE
  `, [songId]);

  const rowsToDelete = oldRows.rows.filter((row) => !localeValues.includes(toInt(row.locale)));
  for (const oldRow of rowsToDelete) {
    await client.query(`
      DELETE FROM song_locales
      WHERE song_id = $1
        AND locale = $2
    `, [songId, oldRow.locale]);
    
  }

  const nextPrimaryLocale = normalized.find((row) => row.isPrimary)?.locale ?? normalized[0].locale;
  for (const oldPrimary of oldRows.rows.filter((row) => row.is_primary && toInt(row.locale) !== nextPrimaryLocale && localeValues.includes(toInt(row.locale)))) {
    const rows = await client.query(`
      UPDATE song_locales
      SET is_primary = false
      WHERE song_id = $1
        AND locale = $2
      RETURNING song_id, is_primary, locale
    `, [songId, oldPrimary.locale]);
    
    oldPrimary.is_primary = false;
  }

  for (const localeRow of normalized) {
    const oldRow = oldRows.rows.find((row) => toInt(row.locale) === localeRow.locale);
    if (!oldRow) {
      const rows = await client.query(`
        INSERT INTO song_locales(song_id, is_primary, locale)
        VALUES ($1, $2, $3)
        RETURNING song_id, is_primary, locale
      `, [songId, localeRow.isPrimary, localeRow.locale]);
      
      continue;
    }

    if (oldRow.is_primary === localeRow.isPrimary) {
      continue;
    }

    const rows = await client.query(`
      UPDATE song_locales
      SET is_primary = $3
      WHERE song_id = $1
        AND locale = $2
      RETURNING song_id, is_primary, locale
    `, [songId, localeRow.locale, localeRow.isPrimary]);
    
  }
}

async function upsertSongTitles(client, songId, titles, { changedBy, reason }) {
  const fallbackLocale = titles.find((title) => title.fallback)?.locale ?? null;
  if (fallbackLocale !== null) {
    const oldFallbackRows = await client.query(`
      SELECT song_id, fallback, locale, normalized_title, title
      FROM song_titles
      WHERE song_id = $1
        AND fallback = true
        AND locale <> $2
      FOR UPDATE
    `, [songId, fallbackLocale]);

    for (const oldFallback of oldFallbackRows.rows) {
      const rows = await client.query(`
        UPDATE song_titles
        SET fallback = false
        WHERE song_id = $1
          AND locale = $2
        RETURNING song_id, fallback, locale, normalized_title, title
      `, [songId, oldFallback.locale]);
      
    }
  }

  for (const title of titles) {
    const oldRows = await client.query(`
      SELECT song_id, fallback, locale, normalized_title, title
      FROM song_titles
      WHERE song_id = $1
        AND locale = $2
      FOR UPDATE
    `, [songId, title.locale]);

    if (!oldRows.rows.length) {
      const rows = await client.query(`
        INSERT INTO song_titles(song_id, fallback, locale, normalized_title, title)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING song_id, fallback, locale, normalized_title, title
      `, [songId, title.fallback, title.locale, title.normalizedTitle, title.title]);
      
      continue;
    }

    const old = oldRows.rows[0];
    if (old.fallback === title.fallback && old.normalized_title === title.normalizedTitle && old.title === title.title) {
      continue;
    }

    const rows = await client.query(`
      UPDATE song_titles
      SET fallback = $3,
          normalized_title = $4,
          title = $5
      WHERE song_id = $1
        AND locale = $2
      RETURNING song_id, fallback, locale, normalized_title, title
    `, [songId, title.locale, title.fallback, title.normalizedTitle, title.title]);
    
  }
}

function compactDate(value) {
  const date = value ? String(value).slice(0, 10) : null;
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null;
}

function normalizePositiveInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function assertIdsExist(client, tableName, idColumn, ids, label) {
  const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!uniqueIds.length) {
    return;
  }

  const rows = await client.query(`
    SELECT ${idColumn} AS id
    FROM ${tableName}
    WHERE ${idColumn} = ANY($1::int[])
  `, [uniqueIds]);
  const found = new Set(rows.rows.map((row) => toInt(row.id)));
  const missing = uniqueIds.filter((id) => !found.has(id));
  if (missing.length) {
    const error = new Error(`${label} reference was not found: ${missing.join(', ')}`);
    error.status = 409;
    throw error;
  }
}

async function syncTitleRows(client, { tableName, idColumn, id, titles, changedBy, reason }) {
  const oldRows = await client.query(`
    SELECT ${idColumn}, fallback, locale, normalized_title, title
    FROM ${tableName}
    WHERE ${idColumn} = $1
    FOR UPDATE
  `, [id]);
  const nextLocales = titles.map((title) => title.locale);

  for (const oldRow of oldRows.rows.filter((row) => !nextLocales.includes(toInt(row.locale)))) {
    await client.query(`
      DELETE FROM ${tableName}
      WHERE ${idColumn} = $1
        AND locale = $2
    `, [id, oldRow.locale]);
    
  }

  const fallbackLocale = titles.find((title) => title.fallback)?.locale ?? null;
  for (const oldFallback of oldRows.rows.filter((row) => row.fallback && toInt(row.locale) !== fallbackLocale && nextLocales.includes(toInt(row.locale)))) {
    const rows = await client.query(`
      UPDATE ${tableName}
      SET fallback = false
      WHERE ${idColumn} = $1
        AND locale = $2
      RETURNING ${idColumn}, fallback, locale, normalized_title, title
    `, [id, oldFallback.locale]);
    
    oldFallback.fallback = false;
  }

  for (const title of titles) {
    const oldRow = oldRows.rows.find((row) => toInt(row.locale) === title.locale);
    if (!oldRow) {
      const rows = await client.query(`
        INSERT INTO ${tableName}(${idColumn}, fallback, locale, normalized_title, title)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING ${idColumn}, fallback, locale, normalized_title, title
      `, [id, title.fallback, title.locale, title.normalizedTitle, title.title]);
      
      continue;
    }

    if (oldRow.fallback === title.fallback && oldRow.normalized_title === title.normalizedTitle && oldRow.title === title.title) {
      continue;
    }

    const rows = await client.query(`
      UPDATE ${tableName}
      SET fallback = $3,
          normalized_title = $4,
          title = $5
      WHERE ${idColumn} = $1
        AND locale = $2
      RETURNING ${idColumn}, fallback, locale, normalized_title, title
    `, [id, title.locale, title.fallback, title.normalizedTitle, title.title]);
    
  }
}

async function syncAuthorityRows(client, { tableName, idColumn, id, authorities, changedBy, reason }) {
  const oldRows = await client.query(`
    SELECT ${idColumn}, authority, authority_code
    FROM ${tableName}
    WHERE ${idColumn} = $1
    FOR UPDATE
  `, [id]);
  const nextKeys = new Set(authorities.map((authority) => `${authority.authority}:${authority.code}`));

  for (const oldRow of oldRows.rows.filter((row) => !nextKeys.has(`${row.authority}:${row.authority_code}`))) {
    await client.query(`
      DELETE FROM ${tableName}
      WHERE ${idColumn} = $1
        AND authority = $2
        AND authority_code = $3
    `, [id, oldRow.authority, oldRow.authority_code]);
    
  }

  for (const authority of getSortedAuthorityRows(authorities)) {
    if (oldRows.rows.some((row) => toInt(row.authority) === authority.authority && row.authority_code === authority.code)) {
      continue;
    }

    const rows = await client.query(`
      INSERT INTO ${tableName}(${idColumn}, authority, authority_code)
      VALUES ($1, $2, $3)
      ON CONFLICT (authority, authority_code) DO NOTHING
      RETURNING ${idColumn}, authority, authority_code
    `, [id, authority.authority, authority.code]);
    if (!rows.rows.length) {
      const error = new Error(`${authority.authorityLabel} authority already belongs to another row: ${authority.code}`);
      error.status = 409;
      throw error;
    }
    
  }
}

async function syncArtistAliases(client, artistId, aliases, { changedBy, reason }) {
  const oldRows = await client.query(`
    SELECT artist_id, alias, normalized_alias
    FROM artist_alias
    WHERE artist_id = $1
    FOR UPDATE
  `, [artistId]);
  const nextAliases = [...new Set((Array.isArray(aliases) ? aliases : []).map((alias) => String(alias).trim()).filter(Boolean))].sort();

  for (const oldRow of oldRows.rows.filter((row) => !nextAliases.includes(row.alias))) {
    await client.query(`
      DELETE FROM artist_alias
      WHERE artist_id = $1
        AND alias = $2
    `, [artistId, oldRow.alias]);
    
  }

  for (const alias of nextAliases) {
    if (oldRows.rows.some((row) => row.alias === alias)) {
      continue;
    }
    const rows = await client.query(`
      INSERT INTO artist_alias(artist_id, alias, normalized_alias)
      VALUES ($1, $2, $3)
      RETURNING artist_id, alias, normalized_alias
    `, [artistId, alias, normalizeTextForDb(alias)]);
    
  }
}

async function syncArtistRelations(client, artistId, relations, { changedBy, reason }) {
  const oldRows = await client.query(`
    SELECT artist_id, ref_artist_id, relation_to_ref
    FROM artist_relations
    WHERE artist_id = $1
    FOR UPDATE
  `, [artistId]);
  const nextRows = Array.isArray(relations) ? relations : [];
  const nextKeys = new Set(nextRows.map((row) => `${row.refArtistId}:${row.relationToRef}`));

  for (const oldRow of oldRows.rows.filter((row) => !nextKeys.has(`${row.ref_artist_id}:${row.relation_to_ref}`))) {
    await client.query(`
      DELETE FROM artist_relations
      WHERE artist_id = $1
        AND ref_artist_id = $2
        AND relation_to_ref = $3
    `, [artistId, oldRow.ref_artist_id, oldRow.relation_to_ref]);
    
  }

  for (const relation of nextRows) {
    if (oldRows.rows.some((row) => toInt(row.ref_artist_id) === relation.refArtistId && toInt(row.relation_to_ref) === relation.relationToRef)) {
      continue;
    }
    const rows = await client.query(`
      INSERT INTO artist_relations(artist_id, ref_artist_id, relation_to_ref)
      VALUES ($1, $2, $3)
      RETURNING artist_id, ref_artist_id, relation_to_ref
    `, [artistId, relation.refArtistId, relation.relationToRef]);
    
  }
}

async function syncOrderedArtistRows(client, { tableName, idColumn, id, artists, includeDisplayTitle = false, changedBy, reason }) {
  const oldRows = await client.query(`
    SELECT ${idColumn}, artist_id, display_order${includeDisplayTitle ? ', display_title, role' : ''}
    FROM ${tableName}
    WHERE ${idColumn} = $1
    FOR UPDATE
  `, [id]);

  await client.query(`DELETE FROM ${tableName} WHERE ${idColumn} = $1`, [id]);
  for (const oldRow of oldRows.rows) {
    
  }

  let displayOrder = 1;
  for (const artist of artists) {
    const previousArtistRow = oldRows.rows.find((row) => toInt(row.artist_id) === artist.artistId);
    const role = includeDisplayTitle && Number.isInteger(artist.role)
      ? artist.role
      : includeDisplayTitle
        ? toInt(previousArtistRow?.role) ?? 0
        : 0;
    const rows = includeDisplayTitle
      ? await client.query(`
        INSERT INTO ${tableName}(${idColumn}, artist_id, display_order, display_title, role)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING ${idColumn}, artist_id, display_order, display_title, role
      `, [id, artist.artistId, displayOrder, artist.displayTitle, role])
      : await client.query(`
        INSERT INTO ${tableName}(${idColumn}, artist_id, display_order)
        VALUES ($1, $2, $3)
        RETURNING ${idColumn}, artist_id, display_order
      `, [id, artist.artistId, displayOrder]);
    
    displayOrder += 1;
  }
}

async function syncAlbumTrackCounts(client, albumId, trackCounts, { changedBy, reason }) {
  const normalized = [];
  const seen = new Set();
  for (const row of Array.isArray(trackCounts) ? trackCounts : []) {
    const discNumber = normalizePositiveInteger(row?.discNumber ?? row?.disc_number);
    const trackCount = normalizePositiveInteger(row?.trackCount ?? row?.track_count);
    if (!discNumber || !trackCount || seen.has(discNumber)) {
      continue;
    }
    seen.add(discNumber);
    normalized.push({ discNumber, trackCount });
  }
  const nextDiscs = normalized.map((row) => row.discNumber);
  const oldRows = await client.query(`
    SELECT album_id, disc_number, track_count
    FROM album_track_counts
    WHERE album_id = $1
    FOR UPDATE
  `, [albumId]);

  for (const oldRow of oldRows.rows.filter((row) => !nextDiscs.includes(toInt(row.disc_number)))) {
    await client.query(`
      DELETE FROM album_track_counts
      WHERE album_id = $1
        AND disc_number = $2
    `, [albumId, oldRow.disc_number]);
    
  }

  for (const row of normalized) {
    const oldRow = oldRows.rows.find((old) => toInt(old.disc_number) === row.discNumber);
    if (!oldRow) {
      const rows = await client.query(`
        INSERT INTO album_track_counts(album_id, disc_number, track_count)
        VALUES ($1, $2, $3)
        RETURNING album_id, disc_number, track_count
      `, [albumId, row.discNumber, row.trackCount]);
      
      continue;
    }
    if (toInt(oldRow.track_count) === row.trackCount) {
      continue;
    }
    const rows = await client.query(`
      UPDATE album_track_counts
      SET track_count = $3
      WHERE album_id = $1
        AND disc_number = $2
      RETURNING album_id, disc_number, track_count
    `, [albumId, row.discNumber, row.trackCount]);
    
  }
}

async function upsertAlbumTrackCount(client, albumId, discNumber, trackCount, { changedBy, reason }) {
  const oldRows = await client.query(`
    SELECT album_id, disc_number, track_count
    FROM album_track_counts
    WHERE album_id = $1
      AND disc_number = $2
    FOR UPDATE
  `, [albumId, discNumber]);

  if (!oldRows.rows.length) {
    const rows = await client.query(`
      INSERT INTO album_track_counts(album_id, disc_number, track_count)
      VALUES ($1, $2, $3)
      RETURNING album_id, disc_number, track_count
    `, [albumId, discNumber, trackCount]);
    
    return;
  }

  const oldRow = oldRows.rows[0];
  if (toInt(oldRow.track_count) === trackCount) {
    return;
  }
  const rows = await client.query(`
    UPDATE album_track_counts
    SET track_count = $3
    WHERE album_id = $1
      AND disc_number = $2
    RETURNING album_id, disc_number, track_count
  `, [albumId, discNumber, trackCount]);
  
}

async function syncAlbumTracks(client, albumId, tracks, { changedBy, reason }) {
  const normalized = [];
  const seen = new Set();
  for (const row of Array.isArray(tracks) ? tracks : []) {
    const songId = normalizePositiveInteger(row?.songId ?? row?.song_id);
    const discNumber = normalizePositiveInteger(row?.discNumber ?? row?.disc_number, 1);
    const trackNumber = normalizePositiveInteger(row?.trackNumber ?? row?.track_number);
    const key = `${discNumber}:${trackNumber}`;
    if (!songId || !trackNumber || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ songId, discNumber, trackNumber });
  }
  const nextKeys = new Set(normalized.map((row) => `${row.discNumber}:${row.trackNumber}`));
  const oldRows = await client.query(`
    SELECT album_id, song_id, disc_number, track_number
    FROM album_tracks
    WHERE album_id = $1
    FOR UPDATE
  `, [albumId]);

  for (const oldRow of oldRows.rows.filter((row) => !nextKeys.has(`${row.disc_number}:${row.track_number}`))) {
    await client.query(`
      DELETE FROM album_tracks
      WHERE album_id = $1
        AND disc_number = $2
        AND track_number = $3
    `, [albumId, oldRow.disc_number, oldRow.track_number]);
    
  }

  for (const row of normalized) {
    const oldRow = oldRows.rows.find((old) => toInt(old.disc_number) === row.discNumber && toInt(old.track_number) === row.trackNumber);
    if (!oldRow) {
      const rows = await client.query(`
        INSERT INTO album_tracks(album_id, song_id, disc_number, track_number)
        VALUES ($1, $2, $3, $4)
        RETURNING album_id, song_id, disc_number, track_number
      `, [albumId, row.songId, row.discNumber, row.trackNumber]);
      
      continue;
    }
    if (toInt(oldRow.song_id) === row.songId) {
      continue;
    }
    const rows = await client.query(`
      UPDATE album_tracks
      SET song_id = $4
      WHERE album_id = $1
        AND disc_number = $2
        AND track_number = $3
      RETURNING album_id, song_id, disc_number, track_number
    `, [albumId, row.discNumber, row.trackNumber, row.songId]);
    
  }
}

async function syncSongAlbumRows(client, songId, albums, { changedBy, reason }) {
  const normalized = [];
  const seen = new Set();
  for (const album of Array.isArray(albums) ? albums : []) {
    if (!album.albumId || !album.trackNumber) {
      continue;
    }
    const key = `${album.albumId}:${album.discNumber}:${album.trackNumber}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(album);
  }
  const nextKeys = new Set(normalized.map((album) => `${album.albumId}:${album.discNumber}:${album.trackNumber}`));

  const oldRows = await client.query(`
    SELECT album_id, song_id, disc_number, track_number
    FROM album_tracks
    WHERE song_id = $1
    FOR UPDATE
  `, [songId]);

  for (const oldRow of oldRows.rows.filter((row) => !nextKeys.has(`${row.album_id}:${row.disc_number}:${row.track_number}`))) {
    await client.query(`
      DELETE FROM album_tracks
      WHERE album_id = $1
        AND disc_number = $2
        AND track_number = $3
    `, [oldRow.album_id, oldRow.disc_number, oldRow.track_number]);
    
  }

  for (const album of normalized) {
    if (oldRows.rows.some((row) => toInt(row.album_id) === album.albumId && toInt(row.disc_number) === album.discNumber && toInt(row.track_number) === album.trackNumber)) {
      continue;
    }
    const rows = await client.query(`
      INSERT INTO album_tracks(album_id, song_id, disc_number, track_number)
      VALUES ($1, $2, $3, $4)
      RETURNING album_id, song_id, disc_number, track_number
    `, [album.albumId, songId, album.discNumber, album.trackNumber]);
    
  }

  for (const album of normalized.filter((row) => row.trackCount)) {
    await upsertAlbumTrackCount(client, album.albumId, album.discNumber, album.trackCount, { changedBy, reason });
  }
}

async function insertSongAuthorities(client, songId, authorities, { changedBy, reason }) {
  for (const authority of getSortedAuthorityRows(authorities)) {
    const rows = await client.query(`
      INSERT INTO song_authorities(song_id, authority, authority_code)
      VALUES ($1, $2, $3)
      ON CONFLICT (authority, authority_code) DO NOTHING
      RETURNING song_id, authority, authority_code
    `, [songId, authority.authority, authority.code]);
    if (rows.rows.length) {
      
    }
  }
}

async function insertSongArtists(client, songId, artists, { changedBy, reason }) {
  const maxOrderRows = await client.query(`
    SELECT COALESCE(max(display_order), 0)::int AS max_order
    FROM song_artists
    WHERE song_id = $1
  `, [songId]);
  let displayOrder = Number(maxOrderRows.rows[0]?.max_order || 0) + 1;

  for (const artist of artists) {
    const exists = await client.query(`
      SELECT 1
      FROM song_artists
      WHERE song_id = $1
        AND artist_id = $2
      LIMIT 1
    `, [songId, artist.artistId]);
    if (exists.rows.length) {
      continue;
    }

    const rows = await client.query(`
      INSERT INTO song_artists(song_id, artist_id, display_order, display_title, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING song_id, artist_id, display_order, display_title, role
    `, [songId, artist.artistId, displayOrder, artist.displayTitle, Number.isInteger(artist.role) ? artist.role : 0]);
    
    displayOrder += 1;
  }
}

async function insertSongAlbums(client, songId, albums, { changedBy, reason }) {
  for (const album of albums) {
    if (album.trackCount !== null && album.trackCount !== undefined) {
      const countRows = await client.query(`
        INSERT INTO album_track_counts(album_id, disc_number, track_count)
        VALUES ($1, $2, $3)
        ON CONFLICT (album_id, disc_number) DO NOTHING
        RETURNING album_id, disc_number, track_count
      `, [album.albumId, album.discNumber, album.trackCount]);
      if (countRows.rows.length) {
        
      }
    }

    if (album.trackNumber !== null && album.trackNumber !== undefined) {
      const trackRows = await client.query(`
        INSERT INTO album_tracks(album_id, song_id, disc_number, track_number)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (album_id, disc_number, track_number) DO NOTHING
        RETURNING album_id, song_id, disc_number, track_number
      `, [album.albumId, songId, album.discNumber, album.trackNumber]);
      if (trackRows.rows.length) {
        
      }
    }
  }
}

async function findArtistIdByPlanAuthorities(client, authorities) {
  const rows = getSortedAuthorityRows(authorities);
  if (!rows.length) {
    return null;
  }

  const params = [];
  const clauses = rows.map((authority) => {
    params.push(authority.authority, authority.code);
    return `(authority = $${params.length - 1} AND authority_code = $${params.length})`;
  });
  const result = await client.query(`
    SELECT DISTINCT artist_id
    FROM artist_authorities
    WHERE ${clauses.join(' OR ')}
    ORDER BY artist_id
  `, params);
  const artistIds = result.rows.map((row) => toInt(row.artist_id)).filter(Boolean);
  if (artistIds.length > 1) {
    const error = new Error(`New artist authorities point to multiple existing artists: ${artistIds.join(', ')}`);
    error.status = 409;
    throw error;
  }

  return artistIds[0] || null;
}

async function insertArtistFromPlan(client, artist, { changedBy, reason }) {
  if (!artist.createMissing || artist.artistId) {
    return artist.artistId;
  }
  if (!artist.titles.length) {
    const error = new Error('A new artist must have at least one title.');
    error.status = 409;
    throw error;
  }

  const existingArtistId = await findArtistIdByPlanAuthorities(client, artist.authorities);
  if (existingArtistId) {
    artist.artistId = existingArtistId;
    artist.createMissing = false;
    return existingArtistId;
  }

  const artistRows = await client.query(`
    INSERT INTO artists(artist_tag, artwork)
    VALUES ($1, $2)
    RETURNING artist_id, artist_tag, artwork, created_at, updated_at
  `, [Number.isInteger(artist.artistTag) ? artist.artistTag : 0, artist.artwork || null]);
  const artistId = toInt(artistRows.rows[0].artist_id);
  

  for (const title of artist.titles) {
    const rows = await client.query(`
      INSERT INTO artist_titles(artist_id, fallback, locale, normalized_title, title)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING artist_id, fallback, locale, normalized_title, title
    `, [artistId, title.fallback, title.locale, title.normalizedTitle, title.title]);
    
  }

  for (const alias of artist.aliases) {
    const rows = await client.query(`
      INSERT INTO artist_alias(artist_id, alias, normalized_alias)
      VALUES ($1, $2, $3)
      ON CONFLICT (artist_id, alias) DO NOTHING
      RETURNING artist_id, alias, normalized_alias
    `, [artistId, alias, normalizeTextForDb(alias)]);
    if (rows.rows.length) {
      
    }
  }

  for (const authority of getSortedAuthorityRows(artist.authorities)) {
    const rows = await client.query(`
      INSERT INTO artist_authorities(artist_id, authority, authority_code)
      VALUES ($1, $2, $3)
      ON CONFLICT (authority, authority_code) DO NOTHING
      RETURNING artist_id, authority, authority_code
    `, [artistId, authority.authority, authority.code]);
    if (rows.rows.length) {
      
    }
  }

  artist.artistId = artistId;
  return artistId;
}

function collectExistingArtistMetadataPlans(plan) {
  const artistPlans = new Map();
  const addArtist = (artist) => {
    if (!artist?.artistId || (artist.songArtistIndex !== null && artist.songArtistIndex !== undefined) || !artist.metadataLoaded) {
      return;
    }
    const existing = artistPlans.get(artist.artistId);
    if (!existing || artist.titles.length > existing.titles.length) {
      artistPlans.set(artist.artistId, artist);
    }
  };

  for (const artist of Array.isArray(plan.song?.artists) ? plan.song.artists : []) {
    addArtist(artist);
  }
  for (const album of Array.isArray(plan.song?.albums) ? plan.song.albums : []) {
    for (const artist of Array.isArray(album.artists) ? album.artists : []) {
      addArtist(artist);
    }
  }

  return [...artistPlans.values()];
}

async function syncExistingArtistMetadataFromPlan(client, artist, { changedBy, reason }) {
  if (!artist?.artistId || !artist.metadataLoaded) {
    return;
  }

  const oldRows = await client.query(`
    SELECT artist_id, artist_tag, artwork, created_at, updated_at
    FROM artists
    WHERE artist_id = $1
    FOR UPDATE
  `, [artist.artistId]);
  if (!oldRows.rows.length) {
    const error = new Error(`Artist was not found: ${artist.artistId}`);
    error.status = 404;
    throw error;
  }

  const oldRow = oldRows.rows[0];
  const nextArtistTag = Number.isInteger(Number(artist.artistTag)) ? Number(artist.artistTag) : 0;
  const nextArtwork = artist.artwork || null;
  if (toInt(oldRow.artist_tag) !== nextArtistTag || (oldRow.artwork || null) !== nextArtwork) {
    const updatedRows = await client.query(`
      UPDATE artists
      SET artist_tag = $2,
          artwork = $3,
          updated_at = now()
      WHERE artist_id = $1
      RETURNING artist_id, artist_tag, artwork, created_at, updated_at
    `, [artist.artistId, nextArtistTag, nextArtwork]);
    
  }

  await syncTitleRows(client, {
    tableName: 'artist_titles',
    idColumn: 'artist_id',
    id: artist.artistId,
    titles: artist.titles,
    changedBy,
    reason
  });
  await syncArtistAliases(client, artist.artistId, artist.aliases || [], { changedBy, reason });
  await syncAuthorityRows(client, {
    tableName: 'artist_authorities',
    idColumn: 'artist_id',
    id: artist.artistId,
    authorities: artist.authorities || [],
    changedBy,
    reason
  });
}

async function insertAlbumFromPlan(client, album, { changedBy, reason }) {
  if (!album.createMissing || album.albumId) {
    return album.albumId;
  }
  if (!album.titles.length) {
    const error = new Error('A new album must have at least one title.');
    error.status = 409;
    throw error;
  }

  const albumRows = await client.query(`
    INSERT INTO albums(album_type, artwork, disc_count, release_date)
    VALUES ($1, $2, $3, $4)
    RETURNING album_id, album_type, artwork, disc_count, release_date, created_at, updated_at
  `, [getAlbumTypeValue(album.albumType), album.artwork || null, album.discCount, album.releaseDate || null]);
  const albumId = toInt(albumRows.rows[0].album_id);
  

  for (const title of album.titles) {
    const rows = await client.query(`
      INSERT INTO album_titles(album_id, fallback, locale, normalized_title, title)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING album_id, fallback, locale, normalized_title, title
    `, [albumId, title.fallback, title.locale, title.normalizedTitle, title.title]);
    
  }

  for (const authority of getSortedAuthorityRows(album.authorities)) {
    const rows = await client.query(`
      INSERT INTO album_authorities(album_id, authority, authority_code)
      VALUES ($1, $2, $3)
      ON CONFLICT (authority, authority_code) DO NOTHING
      RETURNING album_id, authority, authority_code
    `, [albumId, authority.authority, authority.code]);
    if (rows.rows.length) {
      
    }
  }

  let displayOrder = 1;
  for (const artist of album.artists) {
    const rows = await client.query(`
      INSERT INTO album_artists(album_id, artist_id, display_order)
      VALUES ($1, $2, $3)
      ON CONFLICT (album_id, display_order) DO NOTHING
      RETURNING album_id, artist_id, display_order
    `, [albumId, artist.artistId, displayOrder]);
    if (rows.rows.length) {
      
    }
    displayOrder += 1;
  }

  album.albumId = albumId;
  return albumId;
}

async function ensurePlanReferences(client, plan, { changedBy, reason }) {
  for (const artist of plan.song.artists) {
    await insertArtistFromPlan(client, artist, { changedBy, reason });
  }

  for (const album of plan.song.albums) {
    for (const artist of album.artists) {
      if (Number.isInteger(artist.songArtistIndex) && artist.songArtistIndex >= 0) {
        const songArtist = plan.song.artists[artist.songArtistIndex];
        if (!songArtist?.artistId) {
          const error = new Error(`Referenced song artist was not created: Song Artist ${artist.songArtistIndex + 1}.`);
          error.status = 409;
          throw error;
        }
        artist.artistId = songArtist.artistId;
        artist.createMissing = false;
        continue;
      }
      await insertArtistFromPlan(client, artist, { changedBy, reason });
    }
    await insertAlbumFromPlan(client, album, { changedBy, reason });
  }

  for (const artist of collectExistingArtistMetadataPlans(plan)) {
    await syncExistingArtistMetadataFromPlan(client, artist, { changedBy, reason });
  }
}

async function createOrMergeSongFromPlan(client, plan, { changedBy, reason }) {
  let songId = plan.targetSongId;
  await ensurePlanReferences(client, plan, { changedBy, reason });

  if (songId) {
    await updateSongMainRow(client, songId, plan, { changedBy, reason });
  } else {
    const songRows = await client.query(`
      INSERT INTO songs(audio, duration, genre_tag, genre_info, media_tag, release_date, vocal)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING song_id, audio, duration, genre_tag, genre_info, media_tag, release_date, vocal, created_at, updated_at
    `, [
      plan.song.audio,
      plan.song.duration,
      plan.song.genreTag,
      plan.song.genreInfo,
      plan.song.mediaTag,
      plan.song.releaseDate,
      plan.song.vocal
    ]);
    songId = toInt(songRows.rows[0].song_id);
    
  }

  await upsertSongLocales(client, songId, plan.song.locales, { changedBy, reason });
  await upsertSongTitles(client, songId, plan.song.titles, { changedBy, reason });
  await insertSongAuthorities(client, songId, plan.song.authorities, { changedBy, reason });
  await insertSongArtists(client, songId, plan.song.artists, { changedBy, reason });
  await insertSongAlbums(client, songId, plan.song.albums, { changedBy, reason });

  return songId;
}

async function createSongFromEntryGroup(client, groupId, { changedBy, reason, plan: planOverride = null }) {
  const preview = await buildEntryGroupSongPreview(client, groupId, { lock: true });
  const plan = planOverride ? normalizeSongPlan(planOverride, preview) : preview;
  if (plan.song.authorities.length) {
    const params = [];
    const clauses = plan.song.authorities.map((authority) => {
      params.push(authority.authority, authority.code);
      return `(authority = $${params.length - 1} AND authority_code = $${params.length})`;
    });
    if (plan.targetSongId) {
      params.push(plan.targetSongId);
    }
    const rows = await client.query(`
      SELECT song_id, authority, authority_code
      FROM song_authorities
      WHERE (${clauses.join(' OR ')})
      ${plan.targetSongId ? `AND song_id <> $${params.length}` : ''}
      ORDER BY authority, authority_code, song_id
    `, params);
    if (rows.rows.length) {
      plan.errors.push(`Song authority already exists: ${rows.rows.map((row) => `${DB_AUTHORITY_LABELS[row.authority] || row.authority} ${row.authority_code} -> song ${row.song_id}`).join(', ')}`);
    }
  }
  throwPreviewErrors(plan);

  if (!planOverride && preview.existingSongId) {
    return {
      songId: preview.existingSongId,
      preview,
      changedRows: []
    };
  }

  const changedRows = [];
  const songId = await createOrMergeSongFromPlan(client, plan, { changedBy, reason });

  for (const entry of plan.entries) {
    const mappingChanges = await upsertConfirmedMappingForEntry(client, {
      entryId: entry.entryId,
      songId,
      changedBy,
      reason
    });
    changedRows.push(...mappingChanges);
  }

  return {
    songId,
    preview: {
      ...plan,
      existingSongId: songId
    },
    changedRows
  };
}

async function updateArtistDetail(client, artistId, input, { changedBy, reason }) {
  const plan = normalizeArtistEditPlan(input, artistId);
  throwEditErrors(plan);
  await assertIdsExist(client, 'artists', 'artist_id', plan.relations.map((relation) => relation.refArtistId), 'Artist relation artist');

  const oldRows = await client.query(`
    SELECT artist_id, artist_tag, artwork, created_at, updated_at
    FROM artists
    WHERE artist_id = $1
    FOR UPDATE
  `, [artistId]);
  if (!oldRows.rows.length) {
    const error = new Error(`Artist was not found: ${artistId}`);
    error.status = 404;
    throw error;
  }

  const updatedRows = await client.query(`
    UPDATE artists
    SET artist_tag = $2,
        artwork = $3,
        updated_at = now()
    WHERE artist_id = $1
      AND (artist_tag, artwork) IS DISTINCT FROM ($2::bigint, $3::text)
    RETURNING artist_id, artist_tag, artwork, created_at, updated_at
  `, [artistId, plan.artistTag, plan.artwork]);
  

  await syncTitleRows(client, {
    tableName: 'artist_titles',
    idColumn: 'artist_id',
    id: artistId,
    titles: plan.titles,
    changedBy,
    reason
  });
  await syncArtistAliases(client, artistId, plan.aliases, { changedBy, reason });
  await syncArtistRelations(client, artistId, plan.relations, { changedBy, reason });
  await syncAuthorityRows(client, {
    tableName: 'artist_authorities',
    idColumn: 'artist_id',
    id: artistId,
    authorities: plan.authorities,
    changedBy,
    reason
  });

  return { type: 'artist', id: artistId };
}

async function createArtistDetail(client, input, { changedBy, reason }) {
  const plan = normalizeArtistEditPlan(input, null);
  throwEditErrors(plan);
  await assertIdsExist(client, 'artists', 'artist_id', plan.relations.map((relation) => relation.refArtistId), 'Artist relation artist');

  const insertedRows = await client.query(`
    INSERT INTO artists(artist_tag, artwork)
    VALUES ($1, $2)
    RETURNING artist_id, artist_tag, artwork, created_at, updated_at
  `, [plan.artistTag, plan.artwork]);
  const artistId = toInt(insertedRows.rows[0].artist_id);
  

  await syncTitleRows(client, {
    tableName: 'artist_titles',
    idColumn: 'artist_id',
    id: artistId,
    titles: plan.titles,
    changedBy,
    reason
  });
  await syncArtistAliases(client, artistId, plan.aliases, { changedBy, reason });
  await syncArtistRelations(client, artistId, plan.relations, { changedBy, reason });
  await syncAuthorityRows(client, {
    tableName: 'artist_authorities',
    idColumn: 'artist_id',
    id: artistId,
    authorities: plan.authorities,
    changedBy,
    reason
  });

  return { type: 'artist', id: artistId };
}

async function getArtistFallbackTitleForMerge(client, artistId) {
  const rows = await client.query(`
    SELECT title
    FROM artist_titles
    WHERE artist_id = $1
    ORDER BY ${titleDisplayOrderSql()}
    LIMIT 1
  `, [artistId]);
  return rows.rows[0]?.title || `Artist ${artistId}`;
}

async function mergeArtistAuthorities(client, sourceArtistId, targetArtistId, { changedBy, reason }) {
  const sourceRows = await client.query(`
    SELECT artist_id, authority, authority_code
    FROM artist_authorities
    WHERE artist_id = $1
    ORDER BY authority, authority_code
    FOR UPDATE
  `, [sourceArtistId]);
  const targetRows = await client.query(`
    SELECT artist_id, authority, authority_code
    FROM artist_authorities
    WHERE artist_id = $1
    FOR UPDATE
  `, [targetArtistId]);
  const targetKeys = new Set(targetRows.rows.map((row) => `${row.authority}:${row.authority_code}`));
  let moved = 0;
  let skipped = 0;

  for (const oldRow of sourceRows.rows) {
    const key = `${oldRow.authority}:${oldRow.authority_code}`;
    if (targetKeys.has(key)) {
      await client.query(`
        DELETE FROM artist_authorities
        WHERE artist_id = $1
          AND authority = $2
          AND authority_code = $3
      `, [sourceArtistId, oldRow.authority, oldRow.authority_code]);
      
      skipped += 1;
      continue;
    }

    const rows = await client.query(`
      UPDATE artist_authorities
      SET artist_id = $2
      WHERE artist_id = $1
        AND authority = $3
        AND authority_code = $4
      RETURNING artist_id, authority, authority_code
    `, [sourceArtistId, targetArtistId, oldRow.authority, oldRow.authority_code]);
    
    targetKeys.add(key);
    moved += 1;
  }

  return { moved, skipped };
}

async function mergeArtistNamesToTargetAliases(client, sourceArtistId, targetArtistId, { changedBy, reason }) {
  const sourceTitleRows = await client.query(`
    SELECT artist_id, fallback, locale, normalized_title, title
    FROM artist_titles
    WHERE artist_id = $1
    ORDER BY ${titleDisplayOrderSql()}, title
    FOR UPDATE
  `, [sourceArtistId]);
  const sourceAliasRows = await client.query(`
    SELECT artist_id, alias, normalized_alias
    FROM artist_alias
    WHERE artist_id = $1
    ORDER BY alias
    FOR UPDATE
  `, [sourceArtistId]);
  const targetTitleRows = await client.query(`
    SELECT normalized_title
    FROM artist_titles
    WHERE artist_id = $1
  `, [targetArtistId]);
  const targetAliasRows = await client.query(`
    SELECT artist_id, alias, normalized_alias
    FROM artist_alias
    WHERE artist_id = $1
    FOR UPDATE
  `, [targetArtistId]);
  const seenNormalized = new Set([
    ...targetTitleRows.rows.map((row) => row.normalized_title),
    ...targetAliasRows.rows.map((row) => row.normalized_alias)
  ].filter(Boolean));
  let inserted = 0;
  let skipped = 0;
  let titlesInserted = 0;
  let aliasesInserted = 0;
  let titlesSkipped = 0;
  let aliasesSkipped = 0;

  const sourceNames = [
    ...sourceTitleRows.rows.map((row) => ({ value: row.title, source: 'title' })),
    ...sourceAliasRows.rows.map((row) => ({ value: row.alias, source: 'alias' }))
  ];

  for (const sourceName of sourceNames) {
    const alias = String(sourceName.value || '').trim();
    const normalizedAlias = normalizeTextForDb(alias);
    if (!alias || seenNormalized.has(normalizedAlias)) {
      skipped += 1;
      if (sourceName.source === 'title') {
        titlesSkipped += 1;
      } else {
        aliasesSkipped += 1;
      }
      continue;
    }

    const rows = await client.query(`
      INSERT INTO artist_alias(artist_id, alias, normalized_alias)
      VALUES ($1, $2, $3)
      ON CONFLICT (artist_id, alias) DO NOTHING
      RETURNING artist_id, alias, normalized_alias
    `, [targetArtistId, alias, normalizedAlias]);
    if (rows.rows.length) {
      
      inserted += 1;
      if (sourceName.source === 'title') {
        titlesInserted += 1;
      } else {
        aliasesInserted += 1;
      }
    } else {
      skipped += 1;
      if (sourceName.source === 'title') {
        titlesSkipped += 1;
      } else {
        aliasesSkipped += 1;
      }
    }
    seenNormalized.add(normalizedAlias);
  }

  return {
    inserted,
    skipped,
    titlesInserted,
    titlesSkipped,
    aliasesInserted,
    aliasesSkipped
  };
}

async function reassignMergeRows(client, {
  tableName,
  selectSql,
  selectParams,
  updateSql,
  getUpdateParams,
  getRowPk,
  changedBy,
  reason
}) {
  const oldRows = await client.query(selectSql, selectParams);
  let updated = 0;

  for (const oldRow of oldRows.rows) {
    const rows = await client.query(updateSql, getUpdateParams(oldRow));
    
    updated += 1;
  }

  return updated;
}

async function mergeArtistRelations(client, sourceArtistId, targetArtistId, { changedBy, reason }) {
  const outgoingRows = await client.query(`
    SELECT artist_id, ref_artist_id, relation_to_ref
    FROM artist_relations
    WHERE artist_id = $1
    ORDER BY ref_artist_id, relation_to_ref
    FOR UPDATE
  `, [sourceArtistId]);
  const incomingRows = await client.query(`
    SELECT artist_id, ref_artist_id, relation_to_ref
    FROM artist_relations
    WHERE ref_artist_id = $1
      AND artist_id <> $1
    ORDER BY artist_id, relation_to_ref
    FOR UPDATE
  `, [sourceArtistId]);
  let updated = 0;
  let deleted = 0;

  async function deleteRelation(oldRow) {
    await client.query(`
      DELETE FROM artist_relations
      WHERE artist_id = $1
        AND ref_artist_id = $2
        AND relation_to_ref = $3
    `, [oldRow.artist_id, oldRow.ref_artist_id, oldRow.relation_to_ref]);
    
    deleted += 1;
  }

  for (const oldRow of outgoingRows.rows) {
    if (toInt(oldRow.ref_artist_id) === targetArtistId || toInt(oldRow.ref_artist_id) === sourceArtistId) {
      await deleteRelation(oldRow);
      continue;
    }
    const exists = await client.query(`
      SELECT 1
      FROM artist_relations
      WHERE artist_id = $1
        AND ref_artist_id = $2
        AND relation_to_ref = $3
      LIMIT 1
    `, [targetArtistId, oldRow.ref_artist_id, oldRow.relation_to_ref]);
    if (exists.rows.length) {
      await deleteRelation(oldRow);
      continue;
    }
    const rows = await client.query(`
      UPDATE artist_relations
      SET artist_id = $2
      WHERE artist_id = $1
        AND ref_artist_id = $3
        AND relation_to_ref = $4
      RETURNING artist_id, ref_artist_id, relation_to_ref
    `, [sourceArtistId, targetArtistId, oldRow.ref_artist_id, oldRow.relation_to_ref]);
    
    updated += 1;
  }

  for (const oldRow of incomingRows.rows) {
    if (toInt(oldRow.artist_id) === targetArtistId) {
      await deleteRelation(oldRow);
      continue;
    }
    const exists = await client.query(`
      SELECT 1
      FROM artist_relations
      WHERE artist_id = $1
        AND ref_artist_id = $2
        AND relation_to_ref = $3
      LIMIT 1
    `, [oldRow.artist_id, targetArtistId, oldRow.relation_to_ref]);
    if (exists.rows.length) {
      await deleteRelation(oldRow);
      continue;
    }
    const rows = await client.query(`
      UPDATE artist_relations
      SET ref_artist_id = $2
      WHERE artist_id = $1
        AND ref_artist_id = $3
        AND relation_to_ref = $4
      RETURNING artist_id, ref_artist_id, relation_to_ref
    `, [oldRow.artist_id, targetArtistId, sourceArtistId, oldRow.relation_to_ref]);
    
    updated += 1;
  }

  return { updated, deleted };
}

async function deleteSourceArtistRows(client, artistId, { changedBy, reason }) {
  const tables = [
    {
      tableName: 'artist_alias',
      selectSql: 'SELECT artist_id, alias, normalized_alias FROM artist_alias WHERE artist_id = $1 ORDER BY alias FOR UPDATE',
      deleteSql: 'DELETE FROM artist_alias WHERE artist_id = $1 AND alias = $2',
      getDeleteParams: (row) => [artistId, row.alias],
      getRowPk: (row) => ({ artist_id: artistId, alias: row.alias })
    },
    {
      tableName: 'artist_titles',
      selectSql: `SELECT artist_id, fallback, locale, normalized_title, title FROM artist_titles WHERE artist_id = $1 ORDER BY ${titleDisplayOrderSql()} FOR UPDATE`,
      deleteSql: 'DELETE FROM artist_titles WHERE artist_id = $1 AND locale = $2',
      getDeleteParams: (row) => [artistId, row.locale],
      getRowPk: (row) => ({ artist_id: artistId, locale: toInt(row.locale) })
    }
  ];
  const counts = {};

  for (const table of tables) {
    const oldRows = await client.query(table.selectSql, [artistId]);
    counts[table.tableName] = oldRows.rows.length;
    for (const oldRow of oldRows.rows) {
      await client.query(table.deleteSql, table.getDeleteParams(oldRow));
      
    }
  }

  return counts;
}

async function getArtistMergePreview(client, sourceArtistId, targetArtistId) {
  if (!Number.isInteger(sourceArtistId) || !Number.isInteger(targetArtistId) || sourceArtistId <= 0 || targetArtistId <= 0) {
    const error = new Error('Source and target artist IDs must be positive integers.');
    error.status = 400;
    throw error;
  }
  if (sourceArtistId === targetArtistId) {
    const error = new Error('Cannot merge an artist into itself.');
    error.status = 400;
    throw error;
  }

  const artistRows = await client.query(`
    SELECT
      a.artist_id,
      COALESCE(preferred_title.title, CONCAT('Artist ', a.artist_id)) AS title
    FROM artists a
    LEFT JOIN LATERAL (
      SELECT title
      FROM artist_titles
      WHERE artist_id = a.artist_id
      ORDER BY ${titleDisplayOrderSql()}
      LIMIT 1
    ) preferred_title ON TRUE
    WHERE a.artist_id = ANY($1::int[])
    ORDER BY a.artist_id
  `, [[sourceArtistId, targetArtistId]]);
  const sourceArtist = artistRows.rows.find((row) => toInt(row.artist_id) === sourceArtistId);
  const targetArtist = artistRows.rows.find((row) => toInt(row.artist_id) === targetArtistId);
  if (!sourceArtist) {
    const error = new Error(`Source artist was not found: ${sourceArtistId}`);
    error.status = 404;
    throw error;
  }
  if (!targetArtist) {
    const error = new Error(`Target artist was not found: ${targetArtistId}`);
    error.status = 404;
    throw error;
  }

  const sourceFallbackTitle = await getArtistFallbackTitleForMerge(client, sourceArtistId);
  const sourceAuthorityRows = await client.query(`
    SELECT artist_id, authority, authority_code
    FROM artist_authorities
    WHERE artist_id = $1
    ORDER BY authority, authority_code
  `, [sourceArtistId]);
  const targetAuthorityRows = await client.query(`
    SELECT artist_id, authority, authority_code
    FROM artist_authorities
    WHERE artist_id = $1
  `, [targetArtistId]);
  const sourceTitleRows = await client.query(`
    SELECT artist_id, fallback, locale, normalized_title, title
    FROM artist_titles
    WHERE artist_id = $1
    ORDER BY ${titleDisplayOrderSql()}, title
  `, [sourceArtistId]);
  const sourceAliasRows = await client.query(`
    SELECT artist_id, alias, normalized_alias
    FROM artist_alias
    WHERE artist_id = $1
    ORDER BY alias
  `, [sourceArtistId]);
  const targetTitleRows = await client.query(`
    SELECT normalized_title
    FROM artist_titles
    WHERE artist_id = $1
  `, [targetArtistId]);
  const targetAliasRows = await client.query(`
    SELECT artist_id, alias, normalized_alias
    FROM artist_alias
    WHERE artist_id = $1
  `, [targetArtistId]);

  const targetAuthorityKeys = new Set(targetAuthorityRows.rows.map((row) => `${row.authority}:${row.authority_code}`));
  const authorityRows = sourceAuthorityRows.rows.map((row) => ({
    authorityValue: toInt(row.authority),
    authority: DB_AUTHORITY_LABELS[row.authority] || String(row.authority),
    code: row.authority_code,
    action: targetAuthorityKeys.has(`${row.authority}:${row.authority_code}`) ? 'skip-duplicate' : 'move'
  }));

  const seenNormalizedAliases = new Set([
    ...targetTitleRows.rows.map((row) => row.normalized_title),
    ...targetAliasRows.rows.map((row) => row.normalized_alias)
  ].filter(Boolean));
  const aliasRows = [
    ...sourceTitleRows.rows.map((row) => ({ value: row.title, source: 'title' })),
    ...sourceAliasRows.rows.map((row) => ({ value: row.alias, source: 'alias' }))
  ].map((row) => {
    const alias = String(row.value || '').trim();
    const normalizedAlias = normalizeTextForDb(alias);
    const duplicate = !alias || seenNormalizedAliases.has(normalizedAlias);
    if (!duplicate) {
      seenNormalizedAliases.add(normalizedAlias);
    }
    return {
      alias,
      source: row.source,
      action: duplicate ? 'skip-duplicate' : 'add'
    };
  });

  const outgoingRelations = await client.query(`
    SELECT artist_id, ref_artist_id, relation_to_ref
    FROM artist_relations
    WHERE artist_id = $1
    ORDER BY ref_artist_id, relation_to_ref
  `, [sourceArtistId]);
  const incomingRelations = await client.query(`
    SELECT artist_id, ref_artist_id, relation_to_ref
    FROM artist_relations
    WHERE ref_artist_id = $1
      AND artist_id <> $1
    ORDER BY artist_id, relation_to_ref
  `, [sourceArtistId]);
  const albumArtistRows = await client.query(`
    SELECT
      aa.album_id,
      aa.artist_id,
      aa.display_order,
      COALESCE(album_title.title, CONCAT('Album ', aa.album_id)) AS title
    FROM album_artists aa
    LEFT JOIN LATERAL (
      SELECT title
      FROM album_titles
      WHERE album_id = aa.album_id
      ORDER BY ${titleDisplayOrderSql()}
      LIMIT 1
    ) album_title ON TRUE
    WHERE aa.artist_id = $1
    ORDER BY aa.album_id, aa.display_order
  `, [sourceArtistId]);
  const songArtistRows = await client.query(`
    SELECT
      sa.song_id,
      sa.artist_id,
      sa.display_order,
      sa.display_title,
      sa.role,
      COALESCE(song_title.title, CONCAT('Song ', sa.song_id)) AS title
    FROM song_artists sa
    LEFT JOIN LATERAL (
      SELECT title
      FROM song_titles
      WHERE song_id = sa.song_id
      ORDER BY ${titleDisplayOrderSql()}
      LIMIT 1
    ) song_title ON TRUE
    WHERE sa.artist_id = $1
    ORDER BY sa.song_id, sa.display_order
  `, [sourceArtistId]);

  let relationUpdates = 0;
  let relationDeletes = 0;
  for (const row of outgoingRelations.rows) {
    if (toInt(row.ref_artist_id) === targetArtistId || toInt(row.ref_artist_id) === sourceArtistId) {
      relationDeletes += 1;
      continue;
    }
    const exists = await client.query(`
      SELECT 1
      FROM artist_relations
      WHERE artist_id = $1
        AND ref_artist_id = $2
        AND relation_to_ref = $3
      LIMIT 1
    `, [targetArtistId, row.ref_artist_id, row.relation_to_ref]);
    if (exists.rows.length) {
      relationDeletes += 1;
    } else {
      relationUpdates += 1;
    }
  }
  for (const row of incomingRelations.rows) {
    if (toInt(row.artist_id) === targetArtistId) {
      relationDeletes += 1;
      continue;
    }
    const exists = await client.query(`
      SELECT 1
      FROM artist_relations
      WHERE artist_id = $1
        AND ref_artist_id = $2
        AND relation_to_ref = $3
      LIMIT 1
    `, [row.artist_id, targetArtistId, row.relation_to_ref]);
    if (exists.rows.length) {
      relationDeletes += 1;
    } else {
      relationUpdates += 1;
    }
  }

  return {
    dryRun: true,
    sourceArtist: {
      id: sourceArtistId,
      title: sourceArtist.title
    },
    targetArtist: {
      id: targetArtistId,
      title: targetArtist.title
    },
    sourceFallbackTitle,
    authorities: {
      moved: authorityRows.filter((row) => row.action === 'move').length,
      skipped: authorityRows.filter((row) => row.action === 'skip-duplicate').length,
      rows: authorityRows
    },
    aliases: {
      inserted: aliasRows.filter((row) => row.action === 'add').length,
      skipped: aliasRows.filter((row) => row.action === 'skip-duplicate').length,
      titlesInserted: aliasRows.filter((row) => row.source === 'title' && row.action === 'add').length,
      aliasesInserted: aliasRows.filter((row) => row.source === 'alias' && row.action === 'add').length,
      rows: aliasRows
    },
    relations: {
      updated: relationUpdates,
      deleted: relationDeletes,
      outgoing: outgoingRelations.rows.length,
      incoming: incomingRelations.rows.length
    },
    references: {
      albumArtistRowsUpdated: albumArtistRows.rows.length,
      songArtistRowsUpdated: songArtistRows.rows.length,
      songDisplayTitle: sourceFallbackTitle,
      albums: albumArtistRows.rows.map((row) => ({
        albumId: toInt(row.album_id),
        title: row.title,
        displayOrder: toInt(row.display_order)
      })),
      songs: songArtistRows.rows.map((row) => ({
        songId: toInt(row.song_id),
        title: row.title,
        displayOrder: toInt(row.display_order),
        oldDisplayTitle: row.display_title,
        newDisplayTitle: sourceFallbackTitle,
        role: toInt(row.role)
      }))
    },
    deletedSourceRows: {
      artist_alias: sourceAliasRows.rows.length,
      artist_titles: sourceTitleRows.rows.length,
      artists: 1
    },
    deletedTables: [
      { tableName: 'artist_alias', rowCount: sourceAliasRows.rows.length },
      { tableName: 'artist_titles', rowCount: sourceTitleRows.rows.length },
      { tableName: 'artists', rowCount: 1 }
    ]
  };
}

async function mergeArtistIntoArtist(client, sourceArtistId, targetArtistId, { changedBy, reason }) {
  if (!Number.isInteger(sourceArtistId) || !Number.isInteger(targetArtistId) || sourceArtistId <= 0 || targetArtistId <= 0) {
    const error = new Error('Source and target artist IDs must be positive integers.');
    error.status = 400;
    throw error;
  }
  if (sourceArtistId === targetArtistId) {
    const error = new Error('Cannot merge an artist into itself.');
    error.status = 400;
    throw error;
  }

  const artistRows = await client.query(`
    SELECT artist_id, artist_tag, artwork, created_at, updated_at
    FROM artists
    WHERE artist_id = ANY($1::int[])
    ORDER BY artist_id
    FOR UPDATE
  `, [[sourceArtistId, targetArtistId]]);
  const sourceArtist = artistRows.rows.find((row) => toInt(row.artist_id) === sourceArtistId);
  const targetArtist = artistRows.rows.find((row) => toInt(row.artist_id) === targetArtistId);
  if (!sourceArtist) {
    const error = new Error(`Source artist was not found: ${sourceArtistId}`);
    error.status = 404;
    throw error;
  }
  if (!targetArtist) {
    const error = new Error(`Target artist was not found: ${targetArtistId}`);
    error.status = 404;
    throw error;
  }

  const sourceFallbackTitle = await getArtistFallbackTitleForMerge(client, sourceArtistId);
  const authorityCounts = await mergeArtistAuthorities(client, sourceArtistId, targetArtistId, { changedBy, reason });
  const aliasCounts = await mergeArtistNamesToTargetAliases(client, sourceArtistId, targetArtistId, { changedBy, reason });
  const relationCounts = await mergeArtistRelations(client, sourceArtistId, targetArtistId, { changedBy, reason });
  const albumArtistCount = await reassignMergeRows(client, {
    tableName: 'album_artists',
    selectSql: `
      SELECT album_id, artist_id, display_order
      FROM album_artists
      WHERE artist_id = $1
      ORDER BY album_id, display_order
      FOR UPDATE
    `,
    selectParams: [sourceArtistId],
    updateSql: `
      UPDATE album_artists
      SET artist_id = $2
      WHERE album_id = $1
        AND display_order = $3
      RETURNING album_id, artist_id, display_order
    `,
    getUpdateParams: (row) => [row.album_id, targetArtistId, row.display_order],
    getRowPk: (row) => ({ album_id: toInt(row.album_id), display_order: toInt(row.display_order) }),
    changedBy,
    reason
  });
  const songArtistCount = await reassignMergeRows(client, {
    tableName: 'song_artists',
    selectSql: `
      SELECT song_id, artist_id, display_order, display_title, role
      FROM song_artists
      WHERE artist_id = $1
      ORDER BY song_id, display_order
      FOR UPDATE
    `,
    selectParams: [sourceArtistId],
    updateSql: `
      UPDATE song_artists
      SET artist_id = $2,
          display_title = $4
      WHERE song_id = $1
        AND display_order = $3
      RETURNING song_id, artist_id, display_order, display_title, role
    `,
    getUpdateParams: (row) => [row.song_id, targetArtistId, row.display_order, sourceFallbackTitle],
    getRowPk: (row) => ({ song_id: toInt(row.song_id), display_order: toInt(row.display_order) }),
    changedBy,
    reason
  });
  const deletedChildCounts = await deleteSourceArtistRows(client, sourceArtistId, { changedBy, reason });

  const updatedTargetRows = await client.query(`
    UPDATE artists
    SET updated_at = now()
    WHERE artist_id = $1
    RETURNING artist_id, artist_tag, artwork, created_at, updated_at
  `, [targetArtistId]);
  

  const deletedArtistRows = await client.query(`
    DELETE FROM artists
    WHERE artist_id = $1
    RETURNING artist_id, artist_tag, artwork, created_at, updated_at
  `, [sourceArtistId]);
  

  return {
    sourceArtistId,
    targetArtistId,
    sourceFallbackTitle,
    authorities: authorityCounts,
    aliases: aliasCounts,
    relations: relationCounts,
    albumArtistRowsUpdated: albumArtistCount,
    songArtistRowsUpdated: songArtistCount,
    deletedSourceRows: deletedChildCounts
  };
}

async function updateAlbumDetail(client, albumId, input, { changedBy, reason }) {
  const plan = normalizeAlbumEditPlan(input, albumId);
  throwEditErrors(plan);
  await assertIdsExist(client, 'artists', 'artist_id', plan.artists.map((artist) => artist.artistId), 'Artist');
  await assertIdsExist(client, 'songs', 'song_id', (Array.isArray(plan.tracks) ? plan.tracks : []).map((track) => track.songId ?? track.song_id), 'Song');

  const oldRows = await client.query(`
    SELECT album_id, album_type, artwork, disc_count, release_date, created_at, updated_at
    FROM albums
    WHERE album_id = $1
    FOR UPDATE
  `, [albumId]);
  if (!oldRows.rows.length) {
    const error = new Error(`Album was not found: ${albumId}`);
    error.status = 404;
    throw error;
  }

  const updatedRows = await client.query(`
    UPDATE albums
    SET album_type = $2,
        artwork = $3,
        disc_count = $4,
        release_date = $5,
        updated_at = now()
    WHERE album_id = $1
      AND (album_type, artwork, disc_count, release_date) IS DISTINCT FROM ($2::smallint, $3::text, $4::integer, $5::date)
    RETURNING album_id, album_type, artwork, disc_count, release_date, created_at, updated_at
  `, [albumId, plan.albumType, plan.artwork, plan.discCount, plan.releaseDate]);
  

  await syncTitleRows(client, {
    tableName: 'album_titles',
    idColumn: 'album_id',
    id: albumId,
    titles: plan.titles,
    changedBy,
    reason
  });
  await syncOrderedArtistRows(client, {
    tableName: 'album_artists',
    idColumn: 'album_id',
    id: albumId,
    artists: plan.artists,
    changedBy,
    reason
  });
  await syncAlbumTrackCounts(client, albumId, plan.trackCounts, { changedBy, reason });
  await syncAlbumTracks(client, albumId, plan.tracks, { changedBy, reason });
  await syncAuthorityRows(client, {
    tableName: 'album_authorities',
    idColumn: 'album_id',
    id: albumId,
    authorities: plan.authorities,
    changedBy,
    reason
  });

  return { type: 'album', id: albumId };
}

async function updateSongDetail(client, songId, input, { changedBy, reason }) {
  const plan = normalizeSongEditPlan(input, songId);
  throwEditErrors(plan);
  await assertIdsExist(client, 'artists', 'artist_id', plan.song.artists.map((artist) => artist.artistId), 'Artist');
  await assertIdsExist(client, 'albums', 'album_id', plan.song.albums.map((album) => album.albumId), 'Album');

  await updateSongMainRow(client, songId, plan, { changedBy, reason });
  await upsertSongLocales(client, songId, plan.song.locales, { changedBy, reason });
  await syncTitleRows(client, {
    tableName: 'song_titles',
    idColumn: 'song_id',
    id: songId,
    titles: plan.song.titles,
    changedBy,
    reason
  });
  await syncOrderedArtistRows(client, {
    tableName: 'song_artists',
    idColumn: 'song_id',
    id: songId,
    artists: plan.song.artists,
    includeDisplayTitle: true,
    changedBy,
    reason
  });
  await syncSongAlbumRows(client, songId, plan.song.albums, { changedBy, reason });
  await syncAuthorityRows(client, {
    tableName: 'song_authorities',
    idColumn: 'song_id',
    id: songId,
    authorities: plan.song.authorities,
    changedBy,
    reason
  });

  return { type: 'song', id: songId };
}

function normalizeEntryEditPlan(input, entryId) {
  const errors = [];
  const rawGroupMode = String(input?.entryGroupMode || '').trim();
  const entryGroupMode = ['none', 'existing', 'new'].includes(rawGroupMode)
    ? rawGroupMode
    : input?.createEntryGroup
      ? 'new'
      : normalizePositiveInteger(input?.entryGroupId)
        ? 'existing'
        : 'none';
  const entryGroupId = normalizePositiveInteger(input?.entryGroupId);
  const songId = normalizePositiveInteger(input?.songId);
  const statusValue = songId
    ? getEnumValueByName(DB_STATUSES, input?.status || 'PENDING')
    : null;

  if (entryGroupMode === 'existing' && !entryGroupId) {
    errors.push('Entry group ID is required when assigning an existing group.');
  }
  if (songId && statusValue === null) {
    errors.push(`Unknown mapping status: ${input?.status}`);
  }

  return {
    id: entryId,
    entryGroupMode,
    entryGroupId,
    songId,
    status: statusValue,
    errors
  };
}

async function assertEntryGroupExists(client, groupId) {
  if (!groupId) {
    return;
  }
  const rows = await client.query(`
    SELECT 1
    FROM entry_group
    WHERE group_id = $1
    LIMIT 1
  `, [groupId]);
  if (!rows.rows.length) {
    const error = new Error(`Entry group was not found: ${groupId}`);
    error.status = 409;
    throw error;
  }
}

function entryGroupMembershipChangeData(row) {
  if (!row) {
    return null;
  }
  return {
    group_id: toInt(row.group_id),
    entry_id: toInt(row.entry_id),
    created_at: row.created_at
  };
}

function entryGroupIssueChangeData(row) {
  if (!row) {
    return null;
  }
  return {
    group_id: toInt(row.group_id),
    issue_id: toInt(row.issue_id)
  };
}

function getEntryIsrc(row) {
  const song = getFirstSong(row.raw_json || {});
  return getRawIdValue(song, ['isrc', 'ISRC']);
}

function buildEntryGroupDetails(entryRows, previousDetails = {}) {
  const entryIds = [...new Set(entryRows.map((row) => toInt(row.entry_id)).filter(Boolean))]
    .sort((a, b) => a - b);
  const isrcs = [...new Set(entryRows.map(getEntryIsrc).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const normalizedCoreTitles = [...new Set(entryRows
    .map((row) => normalizeTitleForDb(row.raw_title))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const durations = entryRows
    .map((row) => toInt(row.raw_duration))
    .filter((duration) => duration !== null);
  const minDurationMs = durations.length ? Math.min(...durations) : null;
  const maxDurationMs = durations.length ? Math.max(...durations) : null;
  const methods = [];

  if (isrcs.length) {
    methods.push('ISRC');
  }
  if (entryIds.length > 1) {
    methods.push('EXACT_METADATA');
  }

  const details = {
    entry_ids: entryIds,
    unreviewed_entry_ids: [],
    isrcs,
    normalized_core_titles: normalizedCoreTitles,
    min_duration_ms: minDurationMs,
    max_duration_ms: maxDurationMs
  };

  if (minDurationMs !== null && maxDurationMs !== null) {
    details.duration_difference_ms = maxDurationMs - minDurationMs;
  }
  if (methods.length) {
    details.methods = methods;
  }
  if (previousDetails?.source) {
    details.source = previousDetails.source;
  }
  if (previousDetails?.action) {
    details.action = previousDetails.action;
  }

  return details;
}

async function refreshEntryGroupDetails(client, groupId, { changedBy, reason }) {
  const groupRows = await client.query(`
    SELECT group_id, status, canonical_song_id, match_method, confidence, details, created_at, resolved_at
    FROM entry_group
    WHERE group_id = $1
    FOR UPDATE
  `, [groupId]);

  if (!groupRows.rows.length) {
    return;
  }

  const oldData = entryGroupChangeData(groupRows.rows[0]);
  const entryRows = await client.query(`
    SELECT e.entry_id, e.raw_title, e.raw_duration, e.raw_json
    FROM entry_group_entries ege
    JOIN entries e
      ON e.entry_id = ege.entry_id
    WHERE ege.group_id = $1
    ORDER BY e.entry_id
  `, [groupId]);
  const nextDetails = buildEntryGroupDetails(entryRows.rows, oldData.details);

  if (JSON.stringify(oldData.details || {}) === JSON.stringify(nextDetails)) {
    return;
  }

  const updatedRows = await client.query(`
    UPDATE entry_group
    SET details = $2::jsonb
    WHERE group_id = $1
    RETURNING group_id, status, canonical_song_id, match_method, confidence, details, created_at, resolved_at
  `, [groupId, JSON.stringify(nextDetails)]);
  const newData = entryGroupChangeData(updatedRows.rows[0]);
  
}

async function syncEntryGroupIssues(client, groupId, { changedBy, reason }) {
  const oldRows = await client.query(`
    SELECT group_id, issue_id
    FROM entry_group_issues
    WHERE group_id = $1
    FOR UPDATE
  `, [groupId]);
  const nextRows = await client.query(`
    SELECT DISTINCT ei.issue_id
    FROM entry_group_entries ege
    JOIN entry_issues ei
      ON ei.entry_id = ege.entry_id
    WHERE ege.group_id = $1
    ORDER BY ei.issue_id
  `, [groupId]);
  const oldIssueIds = new Set(oldRows.rows.map((row) => toInt(row.issue_id)).filter(Boolean));
  const nextIssueIds = new Set(nextRows.rows.map((row) => toInt(row.issue_id)).filter(Boolean));

  for (const oldRow of oldRows.rows.filter((row) => !nextIssueIds.has(toInt(row.issue_id)))) {
    await client.query(`
      DELETE FROM entry_group_issues
      WHERE group_id = $1
        AND issue_id = $2
    `, [oldRow.group_id, oldRow.issue_id]);
    
  }

  for (const issueId of [...nextIssueIds].filter((id) => !oldIssueIds.has(id))) {
    const insertedRows = await client.query(`
      INSERT INTO entry_group_issues(group_id, issue_id)
      VALUES ($1, $2)
      RETURNING group_id, issue_id
    `, [groupId, issueId]);
    
  }
}

async function refreshEntryGroupDerivedData(client, groupId, { changedBy, reason }) {
  if (!groupId) {
    return;
  }
  await refreshEntryGroupDetails(client, groupId, { changedBy, reason });
  await syncEntryGroupIssues(client, groupId, { changedBy, reason });
}

async function createManualEntryGroup(client, entryId, { changedBy, reason }) {
  const details = {
    source: 'library-manager',
    action: 'manual-entry-group',
    entry_id: entryId
  };
  const rows = await client.query(`
    INSERT INTO entry_group(status, match_method, confidence, details)
    VALUES (0, 3, 1, $1::jsonb)
    RETURNING group_id, status, canonical_song_id, match_method, confidence, details, created_at, resolved_at
  `, [JSON.stringify(details)]);
  const newData = entryGroupChangeData(rows.rows[0]);
  
  return newData.group_id;
}

async function syncEntryGroupMembership(client, entryId, plan, { changedBy, reason }) {
  let targetGroupId = null;
  if (plan.entryGroupMode === 'new') {
    targetGroupId = await createManualEntryGroup(client, entryId, { changedBy, reason });
  } else if (plan.entryGroupMode === 'existing') {
    targetGroupId = toInt(plan.entryGroupId);
    await assertEntryGroupExists(client, targetGroupId);
  }

  const oldRows = await client.query(`
    SELECT group_id, entry_id, created_at
    FROM entry_group_entries
    WHERE entry_id = $1
    FOR UPDATE
  `, [entryId]);
  const affectedGroupIds = new Set(oldRows.rows.map((row) => toInt(row.group_id)).filter(Boolean));
  if (targetGroupId) {
    affectedGroupIds.add(toInt(targetGroupId));
  }

  for (const oldRow of oldRows.rows.filter((row) => toInt(row.group_id) !== targetGroupId)) {
    await client.query(`
      DELETE FROM entry_group_entries
      WHERE group_id = $1
        AND entry_id = $2
    `, [oldRow.group_id, entryId]);
    
  }

  if (targetGroupId && !oldRows.rows.some((row) => toInt(row.group_id) === targetGroupId)) {
    const insertedRows = await client.query(`
      INSERT INTO entry_group_entries(group_id, entry_id)
      VALUES ($1, $2)
      RETURNING group_id, entry_id, created_at
    `, [targetGroupId, entryId]);
    
  }

  for (const groupId of affectedGroupIds) {
    await refreshEntryGroupDerivedData(client, groupId, { changedBy, reason });
  }

  return targetGroupId;
}

async function syncEntryMapping(client, entryId, plan, { changedBy, reason }) {
  const oldRows = await client.query(`
    SELECT entry_id, song_id, confidence, match_method, status, created_at
    FROM entry_mapping
    WHERE entry_id = $1
    FOR UPDATE
  `, [entryId]);

  for (const oldRow of oldRows.rows.filter((row) => toInt(row.song_id) !== plan.songId)) {
    await client.query(`
      DELETE FROM entry_mapping
      WHERE entry_id = $1
        AND song_id = $2
    `, [entryId, oldRow.song_id]);
    
  }

  if (!plan.songId) {
    return;
  }

  await assertIdsExist(client, 'songs', 'song_id', [plan.songId], 'Song');
  const oldTarget = oldRows.rows.find((row) => toInt(row.song_id) === plan.songId);
  if (!oldTarget) {
    const insertedRows = await client.query(`
      INSERT INTO entry_mapping(entry_id, song_id, confidence, match_method, status)
      VALUES ($1, $2, 1, 3, $3)
      RETURNING entry_id, song_id, confidence, match_method, status, created_at
    `, [entryId, plan.songId, plan.status]);
    
    return;
  }

  const oldData = mappingChangeData(oldTarget);
  if (oldData.confidence === 1 && oldData.match_method === 3 && oldData.status === plan.status) {
    return;
  }
  const updatedRows = await client.query(`
    UPDATE entry_mapping
    SET confidence = 1,
        match_method = 3,
        status = $3
    WHERE entry_id = $1
      AND song_id = $2
    RETURNING entry_id, song_id, confidence, match_method, status, created_at
  `, [entryId, plan.songId, plan.status]);
  
}

async function updateEntryDetail(client, entryId, input, { changedBy, reason }) {
  const plan = normalizeEntryEditPlan(input, entryId);
  throwEditErrors(plan);

  const entryRows = await client.query(`
    SELECT entry_id
    FROM entries
    WHERE entry_id = $1
    FOR UPDATE
  `, [entryId]);
  if (!entryRows.rows.length) {
    const error = new Error(`Entry was not found: ${entryId}`);
    error.status = 404;
    throw error;
  }

  await syncEntryGroupMembership(client, entryId, plan, { changedBy, reason });
  await syncEntryMapping(client, entryId, plan, { changedBy, reason });
  if (plan.songId && plan.status === 1) await client.confirm([{ entryId, songId: plan.songId }]);

  return { type: 'entry', id: entryId };
}

async function updateTableDetail(client, table, id, input, { changedBy, reason }) {
  if (table === 'album') {
    return updateAlbumDetail(client, id, input, { changedBy, reason });
  }
  if (table === 'artist') {
    return updateArtistDetail(client, id, input, { changedBy, reason });
  }
  if (table === 'song') {
    return updateSongDetail(client, id, input, { changedBy, reason });
  }
  if (table === 'entry') {
    return updateEntryDetail(client, id, input, { changedBy, reason });
  }
  const error = new Error('Unsupported table.');
  error.status = 404;
  throw error;
}

function normalizeChangeLogRow(row) {
  return {
    changeId: toInt(row.change_id),
    tableName: row.table_name,
    rowPk: row.row_pk || {},
    operation: row.operation,
    oldData: row.old_data,
    newData: row.new_data,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    reason: row.reason
  };
}

function normalizeAuthorityRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => ({
    authorityValue: toInt(row.authority),
    authority: DB_AUTHORITY_LABELS[row.authority] || String(row.authority),
    code: row.authority_code || ''
  }));
}

function normalizeArtistRelationRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => {
    const relationToRef = toInt(row.relation_to_ref ?? row.relationToRef);
    const artistId = toInt(row.artist_id ?? row.artistId ?? row.ref_artist_id ?? row.refArtistId);
    const refArtistId = toInt(row.ref_artist_id ?? row.refArtistId ?? artistId);
    return {
      artistId,
      refArtistId,
      title: row.title || `Artist ${artistId}`,
      relationToRef,
      relation: DB_RELATION_LABELS[relationToRef] || String(relationToRef),
      direction: row.direction || 'outgoing'
    };
  }).filter((row) => row.artistId && row.refArtistId && row.relationToRef !== null);
}

async function getAlbumDetail(albumId) {
  const rows = await queryDatabase(`
    SELECT
      a.album_id,
      a.album_type,
      a.artwork,
      a.disc_count,
      a.release_date,
      a.updated_at,
      COALESCE(titles.titles, '[]'::jsonb) AS titles,
      COALESCE(artists.artists, '[]'::jsonb) AS artists,
      COALESCE(track_counts.track_counts, '[]'::jsonb) AS track_counts,
      COALESCE(tracks.tracks, '[]'::jsonb) AS tracks,
      COALESCE(authorities.authorities, '[]'::jsonb) AS authorities
    FROM albums a
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('locale', locale, 'title', title, 'fallback', fallback)
        ORDER BY ${titleDisplayOrderSql()}
      ) AS titles
      FROM album_titles
      WHERE album_id = a.album_id
    ) titles ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'artist_id', aa.artist_id,
          'artist_tag', artist.artist_tag,
          'display_order', aa.display_order,
          'title', COALESCE(pref.title, ''),
          'artwork', artist.artwork
        )
        ORDER BY aa.display_order
      ) AS artists
      FROM album_artists aa
      JOIN artists artist
        ON artist.artist_id = aa.artist_id
      LEFT JOIN LATERAL (
        SELECT title
        FROM artist_titles
        WHERE artist_id = aa.artist_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) pref ON TRUE
      WHERE aa.album_id = a.album_id
    ) artists ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('disc_number', disc_number, 'track_count', track_count)
        ORDER BY disc_number
      ) AS track_counts
      FROM album_track_counts
      WHERE album_id = a.album_id
    ) track_counts ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'song_id', atr.song_id,
          'title', COALESCE(song_title.title, ''),
          'disc_number', atr.disc_number,
          'track_number', atr.track_number,
          'duration', s.duration
        )
        ORDER BY atr.disc_number, atr.track_number, atr.song_id
      ) AS tracks
      FROM album_tracks atr
      JOIN songs s
        ON s.song_id = atr.song_id
      LEFT JOIN LATERAL (
      SELECT title
      FROM song_titles
      WHERE song_id = atr.song_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) song_title ON TRUE
      WHERE atr.album_id = a.album_id
    ) tracks ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('authority', authority, 'authority_code', authority_code)
        ORDER BY authority, authority_code
      ) AS authorities
      FROM album_authorities
      WHERE album_id = a.album_id
    ) authorities ON TRUE
    WHERE a.album_id = $1
  `, [albumId]);

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    type: 'album',
    id: toInt(row.album_id),
    artwork: row.artwork,
    albumType: DB_ALBUM_LABELS[row.album_type] || String(row.album_type),
    discCount: toInt(row.disc_count),
    releaseDate: row.release_date,
    updatedAt: row.updated_at,
    titles: normalizeTitleRows(row.titles),
    artists: row.artists || [],
    trackCounts: row.track_counts || [],
    tracks: row.tracks || [],
    authorities: normalizeAuthorityRows(row.authorities)
  };
}

async function getArtistDetail(artistId) {
  const rows = await queryDatabase(`
    SELECT
      a.artist_id,
      a.artist_tag,
      a.artwork,
      a.updated_at,
      COALESCE(titles.titles, '[]'::jsonb) AS titles,
      COALESCE(aliases.aliases, '[]'::jsonb) AS aliases,
      COALESCE(albums.albums, '[]'::jsonb) AS albums,
      COALESCE(songs.songs, '[]'::jsonb) AS songs,
      COALESCE(relations.relations, '[]'::jsonb) AS relations,
      COALESCE(editable_relations.relations, '[]'::jsonb) AS editable_relations,
      COALESCE(authorities.authorities, '[]'::jsonb) AS authorities
    FROM artists a
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('locale', locale, 'title', title, 'fallback', fallback)
        ORDER BY ${titleDisplayOrderSql()}
      ) AS titles
      FROM artist_titles
      WHERE artist_id = a.artist_id
    ) titles ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(alias ORDER BY alias) AS aliases
      FROM artist_alias
      WHERE artist_id = a.artist_id
    ) aliases ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'album_id', al.album_id,
          'title', COALESCE(album_title.title, ''),
          'album_type', al.album_type,
          'release_date', al.release_date
        )
        ORDER BY al.release_date NULLS LAST, al.album_id
      ) AS albums
      FROM album_artists aa
      JOIN albums al
        ON al.album_id = aa.album_id
      LEFT JOIN LATERAL (
      SELECT title
      FROM album_titles
      WHERE album_id = al.album_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) album_title ON TRUE
      WHERE aa.artist_id = a.artist_id
    ) albums ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'song_id', s.song_id,
          'title', COALESCE(song_title.title, ''),
          'role', sa.role,
          'duration', s.duration,
          'release_date', s.release_date
        )
        ORDER BY s.release_date NULLS LAST, s.song_id
      ) AS songs
      FROM song_artists sa
      JOIN songs s
        ON s.song_id = sa.song_id
      LEFT JOIN LATERAL (
      SELECT title
      FROM song_titles
      WHERE song_id = s.song_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) song_title ON TRUE
      WHERE sa.artist_id = a.artist_id
    ) songs ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'artist_id', related.artist_id,
          'ref_artist_id', related.ref_artist_id,
          'title', related.title,
          'relation_to_ref', related.relation_to_ref,
          'direction', related.direction
        )
        ORDER BY related.direction DESC, related.relation_to_ref, related.title, related.artist_id
      ) AS relations
      FROM (
        SELECT
          ref_artist.artist_id,
          ref_artist.artist_id AS ref_artist_id,
          COALESCE(ref_artist_title.title, '') AS title,
          ar.relation_to_ref,
          'outgoing' AS direction
        FROM artist_relations ar
        JOIN artists ref_artist
          ON ref_artist.artist_id = ar.ref_artist_id
        LEFT JOIN LATERAL (
          SELECT title
          FROM artist_titles
          WHERE artist_id = ref_artist.artist_id
          ORDER BY ${titleDisplayOrderSql()}
          LIMIT 1
        ) ref_artist_title ON TRUE
        WHERE ar.artist_id = a.artist_id
        UNION ALL
        SELECT
          source_artist.artist_id,
          source_artist.artist_id AS ref_artist_id,
          COALESCE(source_artist_title.title, '') AS title,
          ar.relation_to_ref,
          'incoming' AS direction
        FROM artist_relations ar
        JOIN artists source_artist
          ON source_artist.artist_id = ar.artist_id
        LEFT JOIN LATERAL (
          SELECT title
          FROM artist_titles
          WHERE artist_id = source_artist.artist_id
          ORDER BY ${titleDisplayOrderSql()}
          LIMIT 1
        ) source_artist_title ON TRUE
        WHERE ar.ref_artist_id = a.artist_id
      ) related
    ) relations ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'artist_id', ref_artist.artist_id,
          'ref_artist_id', ref_artist.artist_id,
          'title', COALESCE(ref_artist_title.title, ''),
          'relation_to_ref', ar.relation_to_ref
        )
        ORDER BY ar.relation_to_ref, COALESCE(ref_artist_title.title, ''), ref_artist.artist_id
      ) AS relations
      FROM artist_relations ar
      JOIN artists ref_artist
        ON ref_artist.artist_id = ar.ref_artist_id
      LEFT JOIN LATERAL (
        SELECT title
        FROM artist_titles
        WHERE artist_id = ref_artist.artist_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) ref_artist_title ON TRUE
      WHERE ar.artist_id = a.artist_id
    ) editable_relations ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('authority', authority, 'authority_code', authority_code)
        ORDER BY authority, authority_code
      ) AS authorities
      FROM artist_authorities
      WHERE artist_id = a.artist_id
    ) authorities ON TRUE
    WHERE a.artist_id = $1
  `, [artistId]);

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    type: 'artist',
    id: toInt(row.artist_id),
    artistTag: toInt(row.artist_tag),
    artwork: row.artwork,
    updatedAt: row.updated_at,
    titles: normalizeTitleRows(row.titles),
    aliases: row.aliases || [],
    albums: row.albums || [],
    songs: row.songs || [],
    relations: normalizeArtistRelationRows(row.relations),
    editableRelations: normalizeArtistRelationRows(row.editable_relations),
    authorities: normalizeAuthorityRows(row.authorities)
  };
}

async function getSongDetail(songId) {
  const rows = await queryDatabase(`
    SELECT
      s.song_id,
      s.audio,
      s.duration,
      s.genre_tag,
      s.genre_info,
      s.media_tag,
      s.release_date,
      s.vocal,
      s.updated_at,
      locale.locale,
      COALESCE(locales.locales, '[]'::jsonb) AS locales,
      COALESCE(titles.titles, '[]'::jsonb) AS titles,
      COALESCE(artists.artists, '[]'::jsonb) AS artists,
      COALESCE(authorities.authorities, '[]'::jsonb) AS authorities,
      COALESCE(albums.albums, '[]'::jsonb) AS albums,
      COALESCE(entry_mappings.entry_mappings, '[]'::jsonb) AS entry_mappings
    FROM songs s
    LEFT JOIN LATERAL (
      SELECT locale
      FROM song_locales
      WHERE song_id = s.song_id
        AND is_primary = true
      LIMIT 1
    ) locale ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('locale', locale, 'is_primary', is_primary)
        ORDER BY is_primary DESC, locale
      ) AS locales
      FROM song_locales
      WHERE song_id = s.song_id
    ) locales ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('locale', locale, 'title', title, 'fallback', fallback)
        ORDER BY ${titleDisplayOrderSql()}
      ) AS titles
      FROM song_titles
      WHERE song_id = s.song_id
    ) titles ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'artist_id', sa.artist_id,
          'artist_tag', artist.artist_tag,
          'display_order', sa.display_order,
          'display_title', sa.display_title,
          'role', sa.role,
          'title', COALESCE(sa.display_title, pref.title, ''),
          'artwork', artist.artwork
        )
        ORDER BY sa.display_order
      ) AS artists
      FROM song_artists sa
      JOIN artists artist
        ON artist.artist_id = sa.artist_id
      LEFT JOIN LATERAL (
        SELECT title
        FROM artist_titles
        WHERE artist_id = sa.artist_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) pref ON TRUE
      WHERE sa.song_id = s.song_id
    ) artists ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object('authority', authority, 'authority_code', authority_code)
        ORDER BY authority, authority_code
      ) AS authorities
      FROM song_authorities
      WHERE song_id = s.song_id
    ) authorities ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'album_id', al.album_id,
          'title', COALESCE(title.title, ''),
          'disc_number', atr.disc_number,
          'track_number', atr.track_number,
          'track_count', atc.track_count,
          'disc_count', al.disc_count,
          'album_type', al.album_type,
          'release_date', al.release_date
        )
        ORDER BY
          CASE
            WHEN al.album_type = 3 THEN 2
            WHEN al.album_type = 2 THEN 2
            WHEN al.album_type = 1 THEN 1
            ELSE 0
          END,
          al.release_date NULLS LAST,
          al.album_id,
          atr.disc_number,
          atr.track_number
      ) AS albums
      FROM album_tracks atr
      JOIN albums al
        ON al.album_id = atr.album_id
      LEFT JOIN album_track_counts atc
        ON atc.album_id = atr.album_id
       AND atc.disc_number = atr.disc_number
      LEFT JOIN LATERAL (
        SELECT title
        FROM album_titles
        WHERE album_id = atr.album_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) title ON TRUE
      WHERE atr.song_id = s.song_id
    ) albums ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'entry_id', em.entry_id,
          'song_id', em.song_id,
          'confidence', em.confidence,
          'match_method', em.match_method,
          'status', em.status,
          'created_at', em.created_at,
          'raw_title', e.raw_title,
          'raw_artist', e.raw_artist,
          'raw_album', e.raw_album,
          'source_id', e.source_id,
          'source_item_id', e.source_item_id
        )
        ORDER BY em.status, em.created_at DESC, em.entry_id
      ) AS entry_mappings
      FROM entry_mapping em
      JOIN entries e
        ON e.entry_id = em.entry_id
      WHERE em.song_id = s.song_id
    ) entry_mappings ON TRUE
    WHERE s.song_id = $1
  `, [songId]);

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  const songArtists = row.artists || [];
  const songAlbums = row.albums || [];
  const albumDetails = new Map();
  for (const albumId of [...new Set(songAlbums.map((album) => toInt(album.album_id)).filter(Boolean))]) {
    const detail = await getAlbumDetail(albumId);
    if (detail) {
      albumDetails.set(albumId, detail);
    }
  }

  const artistIds = new Set(songArtists.map((artist) => toInt(artist.artist_id)).filter(Boolean));
  for (const album of albumDetails.values()) {
    for (const artist of album.artists || []) {
      const artistId = toInt(artist.artist_id);
      if (artistId) {
        artistIds.add(artistId);
      }
    }
  }

  const artistDetails = new Map();
  for (const artistId of artistIds) {
    const detail = await getArtistDetail(artistId);
    if (detail) {
      artistDetails.set(artistId, detail);
    }
  }

  const enrichArtist = (artist) => {
    const artistId = toInt(artist.artist_id ?? artist.id);
    const detail = artistDetails.get(artistId);
    return {
      ...artist,
      artist_id: artistId,
      artistTag: detail?.artistTag ?? toInt(artist.artist_tag) ?? 0,
      artwork: detail?.artwork ?? artist.artwork ?? null,
      title: artist.title || pickDisplayTitle(detail?.titles, `Artist ${artistId}`),
      titles: detail?.titles || [],
      aliases: detail?.aliases || [],
      authorities: detail?.authorities || [],
      relations: detail?.editableRelations || []
    };
  };

  const enrichedSongArtists = songArtists.map(enrichArtist);
  const relatedArtistRows = new Map(enrichedSongArtists.map((artist) => [artist.artist_id, artist]));
  for (const album of albumDetails.values()) {
    for (const artist of album.artists || []) {
      const artistId = toInt(artist.artist_id);
      if (artistId && !relatedArtistRows.has(artistId)) {
        relatedArtistRows.set(artistId, enrichArtist(artist));
      }
    }
  }

  const enrichedAlbums = songAlbums.map((album) => {
    const albumId = toInt(album.album_id);
    const detail = albumDetails.get(albumId);
    return {
      ...album,
      artwork: detail?.artwork ?? album.artwork ?? null,
      titles: detail?.titles || [],
      artists: detail?.artists || [],
      albumType: detail?.albumType ?? (DB_ALBUM_LABELS[album.album_type] || String(album.album_type)),
      trackCounts: detail?.trackCounts || [],
      authorities: detail?.authorities || []
    };
  });

  return {
    type: 'song',
    id: toInt(row.song_id),
    audio: row.audio,
    duration: toInt(row.duration),
    genreTag: row.genre_tag,
    genreInfo: row.genre_info,
    mediaTag: row.media_tag,
    releaseDate: row.release_date,
    vocal: row.vocal,
    locale: row.locale,
    locales: (row.locales || []).map((locale) => ({
      locale: DB_LOCALES[locale.locale] || String(locale.locale),
      localeValue: toInt(locale.locale),
      localeLabel: formatDbLocaleValue(toInt(locale.locale)),
      isPrimary: Boolean(locale.is_primary)
    })),
    updatedAt: row.updated_at,
    titles: normalizeTitleRows(row.titles),
    artists: enrichedSongArtists,
    relatedArtists: [...relatedArtistRows.values()],
    authorities: normalizeAuthorityRows(row.authorities),
    albums: enrichedAlbums,
    entryMappings: (row.entry_mappings || []).map((mapping) => ({
      entryId: toInt(mapping.entry_id),
      songId: toInt(mapping.song_id),
      confidence: mapping.confidence === null ? null : Number(mapping.confidence),
      matchMethod: DB_METHODS[mapping.match_method] || String(mapping.match_method),
      status: DB_STATUSES[mapping.status] || String(mapping.status),
      createdAt: mapping.created_at,
      rawTitle: mapping.raw_title,
      rawArtist: mapping.raw_artist,
      rawAlbum: mapping.raw_album,
      sourceId: toInt(mapping.source_id),
      sourceItemId: toInt(mapping.source_item_id)
    }))
  };
}

async function getEntryDetail(entryId) {
  const rows = await queryDatabase(`
    SELECT
      entry_row.*,
      e.raw_json,
      mapping_title.title AS song_title,
      eg.canonical_song_id AS entry_group_song_id,
      group_title.title AS entry_group_song_title,
      COALESCE(issues.issues, '[]'::jsonb) AS issues
    FROM (
      SELECT *
      FROM ${TABLE_CONFIGS.entry.relation}
    ) entry_row
    JOIN entries e
      ON e.entry_id = entry_row.entry_id
    LEFT JOIN entry_group eg
      ON eg.group_id = entry_row.entry_group_id
    LEFT JOIN LATERAL (
      SELECT title
      FROM song_titles
      WHERE song_id = entry_row.song_id
      ORDER BY ${titleDisplayOrderSql()}
      LIMIT 1
    ) mapping_title ON TRUE
    LEFT JOIN LATERAL (
      SELECT title
      FROM song_titles
      WHERE song_id = eg.canonical_song_id
      ORDER BY ${titleDisplayOrderSql()}
      LIMIT 1
    ) group_title ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'issue_id', ei.issue_id,
          'entry_id', ei.entry_id,
          'song_id', ei.song_id,
          'match_method', ei.match_method,
          'reason', ei.reason,
          'details', ei.details,
          'created_at', ei.created_at,
          'resolved_at', ei.resolved_at
        )
        ORDER BY ei.resolved_at NULLS FIRST, ei.created_at DESC, ei.issue_id DESC
      ) AS issues
      FROM entry_issues ei
      WHERE ei.entry_id = entry_row.entry_id
    ) issues ON TRUE
    WHERE entry_row.entry_id = $1
  `, [entryId]);

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    type: 'entry',
    id: toInt(row.entry_id),
    sourceId: toInt(row.source_id),
    sourceItemId: toInt(row.source_item_id),
    sourcePath: row.source_file,
    sourceType: toInt(row.source_type),
    rawJson: row.raw_json || {},
    title: row.title,
    artist: row.artist,
    album: row.album,
    status: row.status,
    songId: toInt(row.song_id),
    songTitle: row.song_title,
    entryGroupId: toInt(row.entry_group_id),
    entryGroupSongId: toInt(row.entry_group_song_id),
    entryGroupSongTitle: row.entry_group_song_title,
    issues: (row.issues || []).map((issue) => ({
      issueId: toInt(issue.issue_id),
      entryId: toInt(issue.entry_id),
      songId: toInt(issue.song_id),
      matchMethod: issue.match_method === null ? null : (DB_METHODS[issue.match_method] || `UNKNOWN(${issue.match_method})`),
      reason: issue.reason,
      details: issue.details || {},
      createdAt: issue.created_at,
      resolvedAt: issue.resolved_at
    }))
  };
}

async function getTableDetail(table, id) {
  if (table === 'album') {
    return getAlbumDetail(id);
  }
  if (table === 'artist') {
    return getArtistDetail(id);
  }
  if (table === 'song') {
    return getSongDetail(id);
  }
  if (table === 'entry') {
    return getEntryDetail(id);
  }
  return null;
}

function normalizePreviewDetailForSearch(type, detail) {
  if (!detail) {
    return null;
  }

  if (type === 'song') {
    return {
      targetSongId: detail.id,
      song: {
        targetSongId: detail.id,
        audio: detail.audio,
        duration: detail.duration,
        genreTag: Number(detail.genreTag || 0),
        genreInfo: Number(detail.genreInfo || 0),
        mediaTag: Number(detail.mediaTag || 0),
        releaseDate: detail.releaseDate,
        vocal: Number(detail.vocal ?? 4),
        locale: getLocaleValue(detail.locale, DB_LOCALE_VALUES.und),
        localeLabel: formatDbLocaleValue(getLocaleValue(detail.locale, DB_LOCALE_VALUES.und)),
        locales: Array.isArray(detail.locales) && detail.locales.length
          ? detail.locales.map((locale) => ({
            locale: locale.localeValue,
            localeLabel: locale.localeLabel,
            isPrimary: locale.isPrimary
          }))
          : [{
            locale: getLocaleValue(detail.locale, DB_LOCALE_VALUES.und),
            localeLabel: formatDbLocaleValue(getLocaleValue(detail.locale, DB_LOCALE_VALUES.und)),
            isPrimary: true
          }],
        titles: normalizePlanTitleRows(detail.titles, [], 'Song'),
        artists: (detail.artists || []).map((artist) => ({
          artistId: toInt(artist.artist_id),
          artistTag: Number(artist.artist_tag || 0),
          role: Number(artist.role || 0),
          title: artist.title || `Artist ${artist.artist_id}`,
          titles: [],
          aliases: [],
          artwork: artist.artwork || null,
          authorities: []
        })),
        albums: (detail.albums || []).map((album) => ({
          albumId: toInt(album.album_id),
          title: album.title || `Album ${album.album_id}`,
          titles: [],
          albumType: DB_ALBUM_LABELS[album.album_type] || String(album.album_type || ''),
          artwork: null,
          releaseDate: album.release_date,
          discNumber: toInt(album.disc_number) || 1,
          discCount: toInt(album.disc_count),
          trackNumber: toInt(album.track_number),
          trackCount: toInt(album.track_count),
          artists: [],
          authorities: []
        })),
        authorities: detail.authorities.map((authority) => ({
          authority: authority.authorityValue,
          authorityLabel: authority.authority,
          code: authority.code
        }))
      }
    };
  }

  if (type === 'artist') {
    return {
      artistId: detail.id,
      artistTag: Number(detail.artistTag || 0),
      metadataLoaded: true,
      role: 0,
      title: pickDisplayTitle(detail.titles, `Artist ${detail.id}`),
      titles: normalizePlanTitleRows(detail.titles, [], `Artist ${detail.id}`),
      aliases: detail.aliases || [],
      artwork: detail.artwork,
      authorities: detail.authorities.map((authority) => ({
        authority: authority.authorityValue,
        authorityLabel: authority.authority,
        code: authority.code
      }))
    };
  }

  if (type === 'album') {
    return {
      albumId: detail.id,
      title: pickDisplayTitle(detail.titles, `Album ${detail.id}`),
      titles: normalizePlanTitleRows(detail.titles, [], `Album ${detail.id}`),
      albumType: detail.albumType,
      artwork: detail.artwork,
      releaseDate: detail.releaseDate,
      discNumber: 1,
      discCount: detail.discCount,
      trackNumber: null,
      trackCount: null,
      artists: (detail.artists || []).map((artist) => ({
        artistId: toInt(artist.artist_id),
        artistTag: Number(artist.artist_tag || 0),
        title: artist.title || `Artist ${artist.artist_id}`,
        titles: [],
        aliases: [],
        artwork: artist.artwork || null,
        authorities: []
      })),
      authorities: detail.authorities.map((authority) => ({
        authority: authority.authorityValue,
        authorityLabel: authority.authority,
        code: authority.code
      }))
    };
  }

  return detail;
}

function getPreviewSearchYear(value) {
  return compactDate(value)?.slice(0, 4) || null;
}

function getFirstPreviewYear(...values) {
  for (const value of values) {
    const year = getPreviewSearchYear(value);
    if (year) {
      return year;
    }
  }
  return null;
}

function joinPreviewArtistNames(artists) {
  if (!Array.isArray(artists)) {
    return '';
  }
  return artists
    .map((artist) => typeof artist === 'string' ? artist : (artist.title || artist.display_title || artist.displayTitle || ''))
    .filter(Boolean)
    .join(', ');
}

function buildPreviewSearchMeta(type, detail) {
  if (!detail) {
    return null;
  }

  if (type === 'song') {
    return {
      artist: joinPreviewArtistNames(detail.artists),
      year: getFirstPreviewYear(
        detail.releaseDate,
        ...(detail.albums || []).map((album) => album.releaseDate || album.release_date)
      )
    };
  }

  if (type === 'album') {
    return {
      artist: joinPreviewArtistNames(detail.artists),
      year: getPreviewSearchYear(detail.releaseDate)
    };
  }

  return null;
}

async function searchPreviewEntities(type, q) {
  const term = String(q || '').trim();
  if (!term) {
    return [];
  }

  const like = `%${foldLatinText(term)}%`;
  let rows = [];
  if (type === 'song') {
    rows = await queryDatabase(`
      SELECT DISTINCT s.song_id AS id, st.title AS label
      FROM songs s
      JOIN song_titles st
        ON st.song_id = s.song_id
      LEFT JOIN song_authorities sa
        ON sa.song_id = s.song_id
      WHERE ${latinSearchCondition('st.title', '$1')}
         OR ${latinSearchCondition('st.normalized_title', '$1')}
         OR ${latinSearchCondition('sa.authority_code', '$1')}
      ORDER BY st.title, s.song_id
      LIMIT 20
    `, [like]);
  } else if (type === 'artist') {
    rows = await queryDatabase(`
      SELECT DISTINCT a.artist_id AS id, at.title AS label
      FROM artists a
      JOIN artist_titles at
        ON at.artist_id = a.artist_id
      LEFT JOIN artist_alias aa
        ON aa.artist_id = a.artist_id
      LEFT JOIN artist_authorities auth
        ON auth.artist_id = a.artist_id
      WHERE ${latinSearchCondition('at.title', '$1')}
         OR ${latinSearchCondition('at.normalized_title', '$1')}
         OR ${latinSearchCondition('aa.alias', '$1')}
         OR ${latinSearchCondition('auth.authority_code', '$1')}
      ORDER BY at.title, a.artist_id
      LIMIT 20
    `, [like]);
  } else if (type === 'album') {
    rows = await queryDatabase(`
      SELECT DISTINCT a.album_id AS id, at.title AS label
      FROM albums a
      JOIN album_titles at
        ON at.album_id = a.album_id
      LEFT JOIN album_authorities auth
        ON auth.album_id = a.album_id
      WHERE ${latinSearchCondition('at.title', '$1')}
         OR ${latinSearchCondition('at.normalized_title', '$1')}
         OR ${latinSearchCondition('auth.authority_code', '$1')}
      ORDER BY at.title, a.album_id
      LIMIT 20
    `, [like]);
  } else if (type === 'entry-group') {
    rows = await queryDatabase(`
      SELECT
        eg.group_id AS id,
        COALESCE(group_title.title, first_entry.raw_title, CONCAT('Entry Group ', eg.group_id)) AS label,
        eg.canonical_song_id AS song_id,
        group_title.title AS song_title,
        canonical_song.release_date AS song_release_date,
        canonical_artists.artist_names AS song_artist_names,
        first_entry.raw_artist,
        first_entry.raw_release_date
      FROM entry_group eg
      LEFT JOIN songs canonical_song
        ON canonical_song.song_id = eg.canonical_song_id
      LEFT JOIN LATERAL (
        SELECT title
        FROM song_titles
        WHERE song_id = eg.canonical_song_id
        ORDER BY ${titleDisplayOrderSql()}
        LIMIT 1
      ) group_title ON TRUE
      LEFT JOIN LATERAL (
        SELECT array_agg(COALESCE(sa.display_title, pref.title, '') ORDER BY sa.display_order) AS artist_names
        FROM song_artists sa
        JOIN artists artist
          ON artist.artist_id = sa.artist_id
        LEFT JOIN LATERAL (
          SELECT title
          FROM artist_titles
          WHERE artist_id = sa.artist_id
          ORDER BY ${titleDisplayOrderSql()}
          LIMIT 1
        ) pref ON TRUE
        WHERE sa.song_id = eg.canonical_song_id
      ) canonical_artists ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          e.raw_title,
          e.raw_artist,
          e.raw_album,
          COALESCE(
            e.raw_json #>> '{songs,0,releaseDate}',
            e.raw_json #>> '{songs,0,release_date}',
            e.raw_json ->> 'releaseDate',
            e.raw_json ->> 'release_date'
          ) AS raw_release_date
        FROM entry_group_entries ege
        JOIN entries e
          ON e.entry_id = ege.entry_id
        WHERE ege.group_id = eg.group_id
        ORDER BY e.entry_id
        LIMIT 1
      ) first_entry ON TRUE
      WHERE ${latinSearchCondition('eg.group_id', '$1')}
         OR ${latinSearchCondition('group_title.title', '$1')}
         OR ${latinSearchCondition('first_entry.raw_title', '$1')}
         OR ${latinSearchCondition('first_entry.raw_artist', '$1')}
         OR ${latinSearchCondition('first_entry.raw_album', '$1')}
      ORDER BY eg.group_id
      LIMIT 20
    `, [like]);
  } else {
    const error = new Error(`Unknown search type: ${type}`);
    error.status = 400;
    throw error;
  }

  if (type === 'entry-group') {
    return rows.map((row) => ({
      id: toInt(row.id),
      label: row.label || `Entry Group ${row.id}`,
      meta: {
        artist: joinPreviewArtistNames(row.song_artist_names) || row.raw_artist || '',
        year: getPreviewSearchYear(row.song_release_date || row.raw_release_date)
      },
      detail: {
        groupId: toInt(row.id),
        songId: toInt(row.song_id),
        songTitle: row.song_title
      }
    }));
  }

  const results = [];
  for (const row of rows) {
    const detail = await getTableDetail(type, Number(row.id));
    results.push({
      id: toInt(row.id),
      label: row.label || `${type} ${row.id}`,
      meta: buildPreviewSearchMeta(type, detail),
      detail: normalizePreviewDetailForSearch(type, detail)
    });
  }

  return results;
}

async function updateMappingStatus(client, { entryId, songId, nextStatus, changedBy, reason }) {
  const targetRows = await client.query(`
    SELECT entry_id, song_id, confidence, match_method, status, created_at
    FROM entry_mapping
    WHERE entry_id = $1
      AND song_id = $2
    FOR UPDATE
  `, [entryId, songId]);

  if (!targetRows.rows.length) {
    const error = new Error(`Entry mapping was not found: ${entryId}/${songId}`);
    error.status = 404;
    throw error;
  }

  const changedRows = [];

  if (nextStatus === 1) {
    const otherRows = await client.query(`
      SELECT entry_id, song_id, confidence, match_method, status, created_at
      FROM entry_mapping
      WHERE entry_id = $1
        AND song_id <> $2
        AND status <> 2
      FOR UPDATE
    `, [entryId, songId]);

    for (const row of otherRows.rows) {
      const oldData = mappingChangeData(row);
      const updatedRows = await client.query(`
        UPDATE entry_mapping
        SET status = 2
        WHERE entry_id = $1
          AND song_id = $2
        RETURNING entry_id, song_id, confidence, match_method, status, created_at
      `, [row.entry_id, row.song_id]);
      const newData = mappingChangeData(updatedRows.rows[0]);
      
      changedRows.push(newData);
    }
  }

  const oldTarget = mappingChangeData(targetRows.rows[0]);
  let newTarget = oldTarget;
  if (oldTarget.status !== nextStatus) {
    const updatedRows = await client.query(`
      UPDATE entry_mapping
      SET status = $3
      WHERE entry_id = $1
        AND song_id = $2
      RETURNING entry_id, song_id, confidence, match_method, status, created_at
    `, [entryId, songId, nextStatus]);
    newTarget = mappingChangeData(updatedRows.rows[0]);
    
    changedRows.push(newTarget);
  }

  return {
    status: DB_STATUSES[newTarget.status],
    changedRows
  };
}

async function updateEntryGroupStatus(client, { groupId, nextStatus, changedBy, reason, createSong = false, songPlan = null }) {
  const targetRows = await client.query(`
    SELECT group_id, status, canonical_song_id, match_method, confidence, details, created_at, resolved_at
    FROM entry_group
    WHERE group_id = $1
    FOR UPDATE
  `, [groupId]);

  if (!targetRows.rows.length) {
    const error = new Error(`Entry group was not found: ${groupId}`);
    error.status = 404;
    throw error;
  }

  const oldTarget = entryGroupChangeData(targetRows.rows[0]);
  let newTarget = oldTarget;
  const changedRows = [];
  let resolvedIssueCount = 0;
  let createdSong = null;

  if (createSong) {
    if (nextStatus !== 1) {
      const error = new Error('Song creation requires the entry group status to be CONFIRMED.');
      error.status = 409;
      throw error;
    }
    if (oldTarget.canonical_song_id) {
      const error = new Error(`Entry group ${groupId} already has canonical song ${oldTarget.canonical_song_id}.`);
      error.status = 409;
      throw error;
    }

    createdSong = await createSongFromEntryGroup(client, groupId, { changedBy, reason, plan: songPlan });
    changedRows.push(...createdSong.changedRows);
  }

  if (oldTarget.status !== nextStatus || (createdSong && createdSong.songId !== oldTarget.canonical_song_id)) {
    const updatedRows = await client.query(`
      UPDATE entry_group
      SET status = $2::smallint,
          canonical_song_id = COALESCE($3::integer, canonical_song_id),
          resolved_at = CASE
            WHEN $4::boolean THEN NULL
            WHEN resolved_at IS NULL THEN now()
            ELSE resolved_at
          END
      WHERE group_id = $1
      RETURNING group_id, status, canonical_song_id, match_method, confidence, details, created_at, resolved_at
    `, [groupId, nextStatus, createdSong?.songId || null, nextStatus === 0]);
    newTarget = entryGroupChangeData(updatedRows.rows[0]);
    
    changedRows.push(newTarget);
  }

  if (nextStatus === 1) {
    const issueRows = await client.query(`
      UPDATE entry_issues ei
      SET resolved_at = COALESCE(ei.resolved_at, now())
      FROM entry_group_issues egi
      WHERE egi.issue_id = ei.issue_id
        AND egi.group_id = $1
      RETURNING ei.issue_id
    `, [groupId]);
    resolvedIssueCount = issueRows.rows.length;
  }

  return {
    status: DB_STATUSES[newTarget.status],
    changedRows,
    resolvedIssueCount,
    createdSongId: createdSong?.songId || null,
    songPreview: createdSong?.preview || null
  };
}

function registerApiRoutes() {
app.get('/api/session', async (_req, res) => {
  try {
    const savedConfig = await readSavedConfig();
    if (!savedConfig) {
      return res.json({ authenticated: false, configured: false });
    }

    await ensurePool();
    res.json({
      authenticated: true,
      configured: true,
      connection: database.publicConfig
    });
  } catch (error) {
    res.json({
      authenticated: false,
      configured: true,
      message: error.message
    });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const body = req.body || {};
    const config = {
      host: String(body.host || '').trim(),
      database: String(body.database || '').trim(),
      user: String(body.user || '').trim(),
      password: String(body.password || ''),
      port: Number(body.port || 5432)
    };

    if (!config.host || !config.database || !config.user || !config.password || !Number.isInteger(config.port)) {
      return res.status(400).json({ message: 'Please provide host, database, user, password, and a valid port.' });
    }

    await connectWithConfig(config);
    await saveConfig(config);

    res.json({
      authenticated: true,
      connection: database.publicConfig
    });
  } catch (error) {
    await closePool();
    handleError(res, error);
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    await closePool();
    if (req.body && req.body.forget) {
      await configStore.delete();
    }
    res.json({ authenticated: false });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    res.json(await readUiSettings());
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/settings', async (req, res) => {
  try {
    await saveUiSettings(req.body || {});
    res.json(await readUiSettings());
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/summary', async (_req, res) => {
  try {
    const hasEntryGroup = await tableExists('entry_group');
    const rows = await queryDatabase(`
      SELECT
        (SELECT count(*)::int FROM entry_mapping WHERE status = 1) AS existing_mappings,
        (
          SELECT count(*)::int
          FROM entry_mapping em
          JOIN entries e ON e.entry_id = em.entry_id
          JOIN sources src ON src.source_id = e.source_id
          WHERE src.source_type = 1
        ) AS incoming_mappings,
        (SELECT count(*)::int FROM entry_mapping WHERE status = 0) AS pending_mappings,
        (SELECT count(*)::int FROM entry_issues WHERE resolved_at IS NULL) AS open_issues,
        (SELECT count(*)::int FROM entry_issues WHERE resolved_at IS NOT NULL) AS resolved_issues,
        (SELECT count(*)::int FROM change_log) AS change_logs,
        (SELECT count(*)::int FROM album_overview) AS album_rows,
        (SELECT count(*)::int FROM artist_overview) AS artist_rows,
        (SELECT count(*)::int FROM song_overview) AS song_rows,
        (SELECT count(*)::int FROM entries) AS entry_rows,
        (SELECT count(*)::int FROM sources) AS source_rows
    `);

    const groupRows = hasEntryGroup
      ? await queryDatabase(`
        SELECT
          count(*)::int AS entry_groups,
          count(*) FILTER (WHERE status = 0)::int AS pending_entry_groups,
          count(*) FILTER (WHERE status = 1)::int AS confirmed_entry_groups,
          count(*) FILTER (WHERE status = 2)::int AS rejected_entry_groups
        FROM entry_group
      `)
      : [{
        entry_groups: 0,
        pending_entry_groups: 0,
        confirmed_entry_groups: 0,
        rejected_entry_groups: 0
      }];

    const reasonRows = await queryDatabase(`
      SELECT reason, count(*)::int AS count
      FROM entry_issues
      WHERE resolved_at IS NULL
      GROUP BY reason
      ORDER BY reason
    `);

    res.json({
      mappings: {
        existing: rows[0].existing_mappings,
        incoming: rows[0].incoming_mappings,
        pending: rows[0].pending_mappings
      },
      issues: {
        open: rows[0].open_issues,
        resolved: rows[0].resolved_issues,
        reasons: reasonRows
      },
      changelog: {
        total: rows[0].change_logs
      },
      groups: {
        total: groupRows[0].entry_groups,
        pending: groupRows[0].pending_entry_groups,
        confirmed: groupRows[0].confirmed_entry_groups,
        rejected: groupRows[0].rejected_entry_groups
      },
      tables: {
        album: rows[0].album_rows,
        artist: rows[0].artist_rows,
        song: rows[0].song_rows,
        entry: rows[0].entry_rows,
        source: rows[0].source_rows
      }
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/mappings/:category', async (req, res) => {
  try {
    const category = req.params.category;
    const pageSize = parseIntegerQuery(req.query.pageSize, 500, { min: 1, max: 1000 });
    const page = parseIntegerQuery(req.query.page, 1, { min: 1, max: 1000000 });
    const offset = (page - 1) * pageSize;
    const status = getEnumValueByName(DB_STATUSES, req.query.status);
    const method = getEnumValueByName(DB_METHODS, req.query.method);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (!['existing', 'incoming', 'pending'].includes(category)) {
      return res.status(404).json({ message: 'Unknown mapping category.' });
    }

    const params = [];
    const where = [];

    if (category === 'incoming') {
      where.push('src.source_type = 1');
    } else if (category === 'existing' && status === null) {
      where.push('em.status = 1');
    } else if (category === 'pending' && status === null) {
      where.push('em.status = 0');
    }

    if (status !== null) {
      params.push(status);
      where.push(`em.status = $${params.length}`);
    }

    if (method !== null) {
      params.push(method);
      where.push(`em.match_method = $${params.length}`);
    }

    if (search) {
      const searchParam = pushLatinSearchParam(params, search);
      where.push(`(
        ${latinSearchCondition('e.raw_title', searchParam)}
        OR ${latinSearchCondition('e.raw_artist', searchParam)}
        OR ${latinSearchCondition('e.raw_album', searchParam)}
        OR ${latinSearchCondition('src.source_file', searchParam)}
        OR ${latinSearchCondition('st.title', searchParam)}
        OR ${latinSearchCondition('alb.album_title', searchParam)}
        OR ${latinSearchCondition("array_to_string(COALESCE(ar.artist_names, ARRAY[]::text[]), ' ')", searchParam)}
        OR ${latinSearchCondition("array_to_string(COALESCE(auth.apple_music_ids, ARRAY[]::text[]), ' ')", searchParam)}
        OR ${latinSearchCondition('em.entry_id', searchParam)}
        OR ${latinSearchCondition('em.song_id', searchParam)}
      )`);
    }

    const fromSql = `
      FROM entry_mapping em
      JOIN entries e
        ON e.entry_id = em.entry_id
      JOIN sources src
        ON src.source_id = e.source_id
      ${buildSongJoins('em.song_id')}
      WHERE ${where.join(' AND ')}
    `;

    const totalRows = await queryDatabase(`
      SELECT count(*)::int AS total
      ${fromSql}
    `, params);

    const rows = await queryDatabase(`
      SELECT
        em.entry_id,
        em.song_id,
        em.confidence,
        em.match_method,
        em.status,
        em.created_at,
        e.source_id,
        e.source_item_id,
        e.raw_title,
        e.raw_artist,
        e.raw_album,
        e.raw_json AS entry_raw_json,
        COALESCE(
          e.raw_json ->> 'album_artwork',
          e.raw_json #>> '{albums,0,artwork}'
        ) AS entry_artwork,
        e.raw_duration,
        src.source_file,
        src.source_type,
        ${buildSongProjection()}
      ${fromSql}
      ORDER BY em.created_at DESC, em.entry_id, em.song_id
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `, [...params, pageSize, offset]);

    const total = totalRows[0]?.total || 0;

    res.json({
      category,
      page,
      pageSize,
      total,
      pageCount: Math.max(Math.ceil(total / pageSize), 1),
      rows: rows.map(normalizeMappingRow)
    });
  } catch (error) {
    handleError(res, error);
  }
});

const GROUP_RULE_FIELDS = {
  id: 'eg.group_id',
  title: 'e.raw_title',
  artist: 'e.raw_artist',
  album: 'e.raw_album',
  releaseDate: `substring(COALESCE(
    e.raw_json #>> '{songs,0,releaseDate}',
    e.raw_json #>> '{songs,0,release_date}',
    e.raw_json #>> '{albums,0,releaseDate}',
    e.raw_json #>> '{albums,0,release_date}',
    e.raw_json ->> 'releaseDate',
    e.raw_json ->> 'release_date'
  ), 1, 10)`
};
const GROUP_COMPARISON_OPERATORS = { gt: '>', gte: '>=', eq: '=', lte: '<=', lt: '<' };

function groupRuleError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function parseGroupRules(value, type) {
  if (value === undefined) {
    return [];
  }
  let rules;
  try {
    rules = JSON.parse(value);
  } catch (_error) {
    throw groupRuleError(`Invalid ${type} rules.`);
  }
  if (!Array.isArray(rules) || rules.length > 20) {
    throw groupRuleError(`${type} rules must be a list of at most 20 items.`);
  }
  for (const rule of rules) {
    if (!rule || !Object.hasOwn(GROUP_RULE_FIELDS, rule.field)) {
      throw groupRuleError(`Invalid ${type} field.`);
    }
    if (type === 'sort') {
      if (!['asc', 'desc'].includes(rule.direction)) {
        throw groupRuleError('Invalid sort direction.');
      }
      continue;
    }
    const isNumeric = rule.field === 'id' || rule.field === 'releaseDate';
    const operators = isNumeric ? Object.keys(GROUP_COMPARISON_OPERATORS) : ['is', 'isNot', 'contains', 'notContains', 'matches'];
    if (!operators.includes(rule.operator) || typeof rule.value !== 'string' || !rule.value || rule.value.length > 120) {
      throw groupRuleError('Invalid filter condition or value.');
    }
    if (rule.field === 'id' && (!/^[1-9]\d{0,9}$/.test(rule.value) || Number(rule.value) > 2147483647)) {
      throw groupRuleError('Entry group ID must be a positive integer.');
    }
    if (rule.field === 'releaseDate') {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(rule.value) ? new Date(`${rule.value}T00:00:00Z`) : null;
      if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== rule.value) {
        throw groupRuleError('Release date must be a valid date.');
      }
    }
    if (rule.operator === 'matches') {
      const pattern = rule.value;
      if (pattern.length > 80 || !/^[\p{L}\p{N}\s.,:_\/^$*+?\[\]-]+$/u.test(pattern) || /[*+?]{2}/.test(pattern) || (pattern.match(/[*+?]/g) || []).length > 2) {
        throw groupRuleError('Regex may contain letters, digits, spaces, anchors, character classes and simple quantifiers only (80 characters max).');
      }
      try {
        new RegExp(pattern);
      } catch (_error) {
        throw groupRuleError('Invalid regular expression.');
      }
    }
  }
  return rules;
}

function buildGroupFilterSql(rules, params) {
  return rules.map((rule) => {
    const isId = rule.field === 'id';
    const isDate = rule.field === 'releaseDate';
    const expression = isId ? GROUP_RULE_FIELDS.id : isDate ? GROUP_RULE_FIELDS.releaseDate : foldLatinSql(GROUP_RULE_FIELDS[rule.field]);
    const value = isId ? Number(rule.value) : isDate ? rule.value : foldLatinText(rule.value);
    params.push(value);
    const placeholder = `$${params.length}`;
    let comparison;
    const negated = rule.operator === 'isNot' || rule.operator === 'notContains';
    if (isId || isDate) {
      comparison = `${expression} ${GROUP_COMPARISON_OPERATORS[rule.operator]} ${placeholder}`;
    } else if (rule.operator === 'matches') {
      comparison = `${expression} ~ ${placeholder}`;
    } else if (rule.operator === 'contains' || rule.operator === 'notContains') {
      comparison = `strpos(${expression}, ${placeholder}) > 0`;
    } else {
      comparison = `${expression} = ${placeholder}`;
    }
    return isId ? comparison : `${negated ? 'NOT EXISTS' : 'EXISTS'} (
      SELECT 1 FROM entry_group_entries filter_ege
      JOIN entries e ON e.entry_id = filter_ege.entry_id
      WHERE filter_ege.group_id = eg.group_id AND ${comparison}
    )`;
  });
}

function buildGroupSortSql(sort) {
  if (!sort.length) {
    return { join: '', order: 'eg.group_id' };
  }
  const entrySort = sort.filter((rule) => rule.field !== 'id');
  const entryExpression = (rule) => rule.field === 'releaseDate'
    ? GROUP_RULE_FIELDS.releaseDate
    : `NULLIF(${foldLatinSql(GROUP_RULE_FIELDS[rule.field])}, '')`;
  const entryOrder = entrySort.map((rule) => `${entryExpression(rule)} ${rule.direction.toUpperCase()} NULLS LAST`);
  const join = entrySort.length ? `LEFT JOIN LATERAL (
    SELECT ${entrySort.map((rule, index) => `${entryExpression(rule)} AS sort_${index}`).join(', ')}
    FROM entry_group_entries sort_ege
    JOIN entries e ON e.entry_id = sort_ege.entry_id
    WHERE sort_ege.group_id = eg.group_id
    ORDER BY ${entryOrder.join(', ')}, e.entry_id
    LIMIT 1
  ) sort_entry ON TRUE` : '';
  let entryIndex = 0;
  const order = sort.map((rule) => rule.field === 'id'
    ? `eg.group_id ${rule.direction.toUpperCase()}`
    : `sort_entry.sort_${entryIndex++} ${rule.direction.toUpperCase()} NULLS LAST`).join(', ');
  return { join, order: `${order}, eg.group_id` };
}

app.get('/api/groups', async (req, res) => {
  try {
    const pageSize = parseIntegerQuery(req.query.pageSize, 500, { min: 1, max: 1000 });
    const page = parseIntegerQuery(req.query.page, 1, { min: 1, max: 1000000 });
    const offset = (page - 1) * pageSize;
    const hasEntryGroup = await tableExists('entry_group');
    const includeConfirmed = req.query.includeConfirmed === 'true';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const rules = parseGroupRules(req.query.rules, 'filter');
    const sort = parseGroupRules(req.query.sort, 'sort');

    if (!hasEntryGroup) {
      return res.json({
        page,
        pageSize,
        total: 0,
        pageCount: 1,
        rows: []
      });
    }

    const params = [];
    const where = [];
    if (!includeConfirmed) {
      where.push('eg.status <> 1');
    }
    where.push(...buildGroupFilterSql(rules, params));
    if (search) {
      const searchParam = pushLatinSearchParam(params, search);
      where.push(`(
        ${latinSearchCondition('eg.group_id', searchParam)}
        OR ${latinSearchCondition('eg.details', searchParam)}
        OR ${latinSearchCondition('entries.entries', searchParam)}
        OR ${latinSearchCondition('issues.issues', searchParam)}
        OR ${latinSearchCondition('st.title', searchParam)}
        OR ${latinSearchCondition('alb.album_title', searchParam)}
        OR ${latinSearchCondition("array_to_string(COALESCE(ar.artist_names, ARRAY[]::text[]), ' ')", searchParam)}
      )`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const groupSort = buildGroupSortSql(sort);
    const fromSql = `
      FROM entry_group eg
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'entry_id', e.entry_id,
            'source_id', e.source_id,
            'source_item_id', e.source_item_id,
            'source_type', src.source_type,
            'source_file', src.source_file,
            'raw_title', e.raw_title,
            'raw_artist', e.raw_artist,
            'raw_album', e.raw_album,
            'raw_duration', e.raw_duration,
            'entry_artwork', COALESCE(
              e.raw_json ->> 'album_artwork',
              e.raw_json #>> '{albums,0,artwork}'
            )
          )
          ORDER BY e.entry_id
        ) AS entries
        FROM entry_group_entries ege
        JOIN entries e
          ON e.entry_id = ege.entry_id
        JOIN sources src
          ON src.source_id = e.source_id
        WHERE ege.group_id = eg.group_id
      ) entries ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'issue_id', ei.issue_id,
            'entry_id', ei.entry_id,
            'song_id', ei.song_id,
            'match_method', ei.match_method,
            'reason', ei.reason,
            'details', ei.details,
            'created_at', ei.created_at,
            'resolved_at', ei.resolved_at
          )
          ORDER BY ei.resolved_at NULLS FIRST, ei.issue_id
        ) AS issues
        FROM entry_group_issues egi
        JOIN entry_issues ei
          ON ei.issue_id = egi.issue_id
        WHERE egi.group_id = eg.group_id
      ) issues ON TRUE
      ${buildSongJoins('eg.canonical_song_id')}
    `;

    const totalRows = await queryDatabase(`
      SELECT count(*)::int AS total
      ${fromSql}
      ${whereSql}
    `, params);
    const rows = await queryDatabase(`
      SELECT
        eg.group_id,
        eg.status,
        eg.canonical_song_id,
        eg.match_method,
        eg.confidence,
        eg.details,
        eg.created_at,
        eg.resolved_at,
        COALESCE(entries.entries, '[]'::jsonb) AS entries,
        COALESCE(issues.issues, '[]'::jsonb) AS issues,
        ${buildSongProjection()}
      ${fromSql}
      ${groupSort.join}
      ${whereSql}
      ORDER BY ${groupSort.order}
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `, [...params, pageSize, offset]);

    const total = totalRows[0]?.total || 0;
    res.json({
      page,
      pageSize,
      total,
      pageCount: Math.max(Math.ceil(total / pageSize), 1),
      rows: rows.map(normalizeEntryGroupRow)
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/groups/:groupId/entries/search', async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!Number.isSafeInteger(groupId) || groupId < 1) {
      return res.status(400).json({ message: 'Group ID must be a positive integer.' });
    }
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const page = parseIntegerQuery(req.query.page, 1, { min: 1, max: 1000000 });
    const pageSize = 25;
    if (!search) {
      return res.json({ page, pageSize, total: 0, pageCount: 1, rows: [] });
    }
    const params = [];
    const searchParam = pushLatinSearchParam(params, search);
    const whereSql = `WHERE ${latinSearchCondition('e.entry_id', searchParam)}
      OR ${latinSearchCondition('e.raw_title', searchParam)}
      OR ${latinSearchCondition('e.raw_artist', searchParam)}
      OR ${latinSearchCondition('e.raw_album', searchParam)}`;
    const totalRows = await queryDatabase(`SELECT count(*)::int AS total FROM entries e ${whereSql}`, params);
    const rows = await queryDatabase(`
      SELECT e.entry_id, e.raw_title, e.raw_artist, e.raw_album,
        COALESCE(e.raw_json ->> 'album_artwork', e.raw_json #>> '{albums,0,artwork}') AS artwork
      FROM entries e
      ${whereSql}
      ORDER BY e.entry_id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, pageSize, (page - 1) * pageSize]);
    const total = totalRows[0]?.total || 0;
    res.json({
      page,
      pageSize,
      total,
      pageCount: Math.max(Math.ceil(total / pageSize), 1),
      rows: rows.map((row) => ({
        entryId: toInt(row.entry_id),
        rawTitle: row.raw_title,
        rawArtist: row.raw_artist,
        rawAlbum: row.raw_album,
        artwork: row.artwork
      }))
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.put('/api/groups/:groupId/entries', async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const entryIds = req.body?.entryIds;
    const originalEntryIds = req.body?.originalEntryIds;
    const validIds = (ids) => Array.isArray(ids) && ids.length <= 5000
      && ids.every((id) => Number.isSafeInteger(id) && id > 0)
      && new Set(ids).size === ids.length;
    if (!Number.isSafeInteger(groupId) || groupId < 1 || !validIds(entryIds) || !validIds(originalEntryIds)) {
      return res.status(400).json({ message: 'Invalid group or entry IDs.' });
    }
    const changedBy = auditContext.getStore()?.changedBy || database.activeConfig?.user || null;
    const reason = 'library-manager entry group membership update';
    const result = await runTransaction(async (client) => {
      const groupRows = await client.query('SELECT group_id FROM entry_group WHERE group_id = $1 FOR UPDATE', [groupId]);
      if (!groupRows.rows.length) {
        throw groupRuleError('Entry group was not found.');
      }
      const memberRows = await client.query('SELECT group_id, entry_id, created_at FROM entry_group_entries WHERE group_id = $1 ORDER BY entry_id FOR UPDATE', [groupId]);
      const currentIds = memberRows.rows.map((row) => toInt(row.entry_id));
      if (JSON.stringify(currentIds) !== JSON.stringify([...originalEntryIds].sort((a, b) => a - b))) {
        const error = new Error('Group entries changed since this window opened. Close and reopen it to review the latest list.');
        error.status = 409;
        throw error;
      }
      if (entryIds.length) {
        const foundRows = await client.query('SELECT entry_id FROM entries WHERE entry_id = ANY($1::int[])', [entryIds]);
        if (foundRows.rows.length !== entryIds.length) {
          throw groupRuleError('One or more entries were not found.');
        }
      }
      const nextIds = new Set(entryIds);
      const currentSet = new Set(currentIds);
      for (const oldRow of memberRows.rows.filter((row) => !nextIds.has(toInt(row.entry_id)))) {
        await client.query('DELETE FROM entry_group_entries WHERE group_id = $1 AND entry_id = $2', [groupId, oldRow.entry_id]);
        
      }
      for (const entryId of entryIds.filter((id) => !currentSet.has(id))) {
        const insertedRows = await client.query(`
          INSERT INTO entry_group_entries(group_id, entry_id)
          VALUES ($1, $2)
          RETURNING group_id, entry_id, created_at
        `, [groupId, entryId]);
        
      }
      if (currentIds.some((id) => !nextIds.has(id)) || entryIds.some((id) => !currentSet.has(id))) {
        await refreshEntryGroupDerivedData(client, groupId, { changedBy, reason });
      }
      return { groupId, entryIds: [...entryIds].sort((a, b) => a - b) };
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/groups/:groupId/song-preview', async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!Number.isInteger(groupId)) {
      return res.status(400).json({ message: 'Group ID must be an integer.' });
    }

    const preview = await runTransaction((client) => buildEntryGroupSongPreview(client, groupId));
    res.json(preview);
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/search/:type', async (req, res) => {
  try {
    const type = req.params.type;
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const rows = await searchPreviewEntities(type, q);
    res.json({ type, q, rows });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/changelog', async (req, res) => {
  try {
    const pageSize = parseIntegerQuery(req.query.pageSize, 100, { min: 1, max: 500 });
    const page = parseIntegerQuery(req.query.page, 1, { min: 1, max: 1000000 });
    const offset = (page - 1) * pageSize;
    const tableFilter = typeof req.query.table === 'string' ? req.query.table.trim() : '';
    const operationFilter = typeof req.query.operation === 'string' ? req.query.operation.trim() : '';
    const params = [];
    const where = [];

    if (tableFilter && tableFilter !== 'ANY') {
      params.push(tableFilter);
      where.push(`table_name = $${params.length}`);
    }
    if (operationFilter && operationFilter !== 'ANY') {
      params.push(operationFilter);
      where.push(`operation = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const tableOptionRows = await queryDatabase(`
      SELECT DISTINCT table_name
      FROM change_log
      ORDER BY table_name
    `);
    const operationOptionRows = await queryDatabase(`
      SELECT DISTINCT operation
      FROM change_log
      ORDER BY operation
    `);

    const totalRows = await queryDatabase(`
      SELECT count(*)::int AS total
      FROM change_log
      ${whereSql}
    `, params);
    const rows = await queryDatabase(`
      SELECT change_id, table_name, row_pk, operation, old_data, new_data, changed_at, changed_by, reason
      FROM change_log
      ${whereSql}
      ORDER BY changed_at DESC, change_id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `, [...params, pageSize, offset]);

    const total = totalRows[0]?.total || 0;
    res.json({
      page,
      pageSize,
      total,
      pageCount: Math.max(Math.ceil(total / pageSize), 1),
      operationOptions: operationOptionRows.map((row) => row.operation).filter(Boolean),
      tableOptions: tableOptionRows.map((row) => row.table_name).filter(Boolean),
      rows: rows.map(normalizeChangeLogRow)
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/tables/:table', async (req, res) => {
  try {
    const table = req.params.table;
    const config = TABLE_CONFIGS[table];
    if (!config) {
      return res.status(404).json({ message: 'Unknown table.' });
    }

    const pageSize = parseIntegerQuery(req.query.pageSize, 100, { min: 1, max: 500 });
    const page = parseIntegerQuery(req.query.page, 1, { min: 1, max: 1000000 });
    const offset = (page - 1) * pageSize;
    const selectColumns = config.columns.map((column) => `"${column}"`).join(', ');
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const params = [];
    const where = [];

    where.push(...buildTableFilterWhere(table, req.query, params));

    const searchWhere = buildTableSearchWhere(table, config, search, params);
    if (searchWhere) {
      where.push(searchWhere);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRows = await queryDatabase(`
      SELECT count(*)::int AS total
      FROM ${config.relation}
      ${whereSql}
    `, params);
    const rows = await queryDatabase(`
      SELECT ${selectColumns}
      FROM ${config.relation}
      ${whereSql}
      ORDER BY "${config.orderBy}"
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `, [...params, pageSize, offset]);

    const total = totalRows[0]?.total || 0;
    res.json({
      table,
      columns: config.columns,
      page,
      pageSize,
      total,
      pageCount: Math.max(Math.ceil(total / pageSize), 1),
      rows
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/tables/:table/locate/:id', async (req, res) => {
  try {
    const table = req.params.table;
    const config = TABLE_CONFIGS[table];
    const id = Number(req.params.id);
    if (!config) {
      return res.status(404).json({ message: 'Unknown table.' });
    }
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID must be an integer.' });
    }

    const pageSize = parseIntegerQuery(req.query.pageSize, 100, { min: 1, max: 500 });
    const rows = await queryDatabase(`
      SELECT count(*)::int AS position
      FROM ${config.relation}
      WHERE "${config.pk}" <= $1
    `, [id]);
    const exists = await queryDatabase(`
      SELECT 1
      FROM ${config.relation}
      WHERE "${config.pk}" = $1
      LIMIT 1
    `, [id]);

    if (!exists.length) {
      return res.status(404).json({ message: 'Row was not found.' });
    }

    const position = rows[0]?.position || 1;
    res.json({
      table,
      id,
      page: Math.max(Math.ceil(position / pageSize), 1),
      pageSize
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/tables/:table/:id', async (req, res) => {
  try {
    const table = req.params.table;
    const config = TABLE_CONFIGS[table];
    const id = Number(req.params.id);
    if (!config) {
      return res.status(404).json({ message: 'Unknown table.' });
    }
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID must be an integer.' });
    }

    const detail = await getTableDetail(table, id);
    if (!detail) {
      return res.status(404).json({ message: 'Detail was not found.' });
    }

    res.json(detail);
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/tables/artist', async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'library-manager artist create';
    const changedBy = auditContext.getStore()?.changedBy || database.activeConfig?.user || null;
    const result = await runTransaction((client) => createArtistDetail(client, req.body?.detail || req.body, {
      changedBy,
      reason
    }));
    const detail = await getTableDetail('artist', result.id);

    res.json({ detail });
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/tables/:table/:id', async (req, res) => {
  try {
    const table = req.params.table;
    const config = TABLE_CONFIGS[table];
    const id = Number(req.params.id);
    if (!config || !['album', 'artist', 'song', 'entry'].includes(table)) {
      return res.status(404).json({ message: 'Unknown table.' });
    }
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'ID must be an integer.' });
    }

    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'library-manager table edit';
    const changedBy = auditContext.getStore()?.changedBy || database.activeConfig?.user || null;
    await runTransaction((client) => updateTableDetail(client, table, id, req.body?.detail || req.body, {
      changedBy,
      reason
    }));
    const detail = await getTableDetail(table, id);

    res.json({ detail });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/tables/artist/:id/merge', async (req, res) => {
  try {
    const sourceArtistId = Number(req.params.id);
    const targetArtistId = Number(req.body?.targetArtistId);
    if (!Number.isInteger(sourceArtistId) || !Number.isInteger(targetArtistId)) {
      return res.status(400).json({ message: 'Source and target artist IDs must be integers.' });
    }

    if (req.body?.dryRun === true) {
      const preview = await runTransaction((client) => getArtistMergePreview(client, sourceArtistId, targetArtistId));
      return res.json(preview);
    }

    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'library-manager artist merge';
    const changedBy = auditContext.getStore()?.changedBy || database.activeConfig?.user || null;
    const result = await runTransaction((client) => mergeArtistIntoArtist(client, sourceArtistId, targetArtistId, {
      changedBy,
      reason
    }));
    const detail = await getArtistDetail(targetArtistId);

    res.json({
      ...result,
      detail
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/mappings/:entryId/:songId/status', async (req, res) => {
  try {
    const entryId = Number(req.params.entryId);
    const songId = Number(req.params.songId);
    if (!Number.isInteger(entryId) || !Number.isInteger(songId)) {
      return res.status(400).json({ message: 'Entry ID and Song ID must be integers.' });
    }

    const nextStatus = getRequiredEnumValueByName(DB_STATUSES, req.body?.status, 'mapping status');
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'library-manager status update';
    const changedBy = auditContext.getStore()?.changedBy || database.activeConfig?.user || null;

    const result = nextStatus === 1
      ? await confirmEntryMappingsWithMetadata([{ entryId, songId }], { changedBy, reason })
      : await runTransaction((client) => updateMappingStatus(client, {
        entryId,
        songId,
        nextStatus,
        changedBy,
        reason
      }));

    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/mappings/status', async (req, res) => {
  try {
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    if (!mappings.length) {
      return res.status(400).json({ message: 'Please select at least one entry mapping.' });
    }

    const normalizedMappings = mappings.map((mapping) => ({
      entryId: Number(mapping.entryId),
      songId: Number(mapping.songId)
    }));
    if (normalizedMappings.some((mapping) => !Number.isInteger(mapping.entryId) || !Number.isInteger(mapping.songId))) {
      return res.status(400).json({ message: 'Every selected mapping must include integer entryId and songId.' });
    }

    const nextStatus = getRequiredEnumValueByName(DB_STATUSES, req.body?.status, 'mapping status');
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'library-manager batch status update';
    const changedBy = auditContext.getStore()?.changedBy || database.activeConfig?.user || null;

    const result = nextStatus === 1
      ? await confirmEntryMappingsWithMetadata(normalizedMappings, { changedBy, reason })
      : await runTransaction(async (client) => {
        const changedRows = [];
        const statuses = [];
        const seen = new Set();

        for (const mapping of normalizedMappings) {
          const key = `${mapping.entryId}:${mapping.songId}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);

          const updateResult = await updateMappingStatus(client, {
            ...mapping,
            nextStatus,
            changedBy,
            reason
          });
          statuses.push({
            entryId: mapping.entryId,
            songId: mapping.songId,
            status: updateResult.status
          });
          changedRows.push(...updateResult.changedRows);
        }

        return {
          status: DB_STATUSES[nextStatus],
          updatedCount: statuses.length,
          statuses,
          changedRows
        };
      });

    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/groups/:groupId/status', async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!Number.isInteger(groupId)) {
      return res.status(400).json({ message: 'Group ID must be an integer.' });
    }

    const nextStatus = getRequiredEnumValueByName(DB_STATUSES, req.body?.status, 'entry group status');
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'library-manager entry group status update';
    const changedBy = auditContext.getStore()?.changedBy || database.activeConfig?.user || null;

    const result = await runTransaction((client) => updateEntryGroupStatus(client, {
      groupId,
      nextStatus,
      changedBy,
      reason,
      createSong: req.body?.createSong === true,
      songPlan: req.body?.songPlan || null
    }));

    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/groups/status', async (req, res) => {
  try {
    const groupIds = Array.isArray(req.body?.groupIds)
      ? req.body.groupIds.map(Number).filter((id) => Number.isInteger(id))
      : [];
    const uniqueGroupIds = [...new Set(groupIds)];

    if (!uniqueGroupIds.length) {
      return res.status(400).json({ message: 'Please select at least one entry group.' });
    }

    const nextStatus = getRequiredEnumValueByName(DB_STATUSES, req.body?.status, 'entry group status');
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'library-manager batch entry group status update';
    const changedBy = auditContext.getStore()?.changedBy || database.activeConfig?.user || null;

    const result = await runTransaction(async (client) => {
      const statuses = [];
      const changedRows = [];
      let resolvedIssueCount = 0;

      for (const groupId of uniqueGroupIds) {
        const updateResult = await updateEntryGroupStatus(client, {
          groupId,
          nextStatus,
          changedBy,
          reason
        });
        statuses.push({
          groupId,
          status: updateResult.status
        });
        changedRows.push(...updateResult.changedRows);
        resolvedIssueCount += updateResult.resolvedIssueCount || 0;
      }

      return {
        status: DB_STATUSES[nextStatus],
        updatedCount: statuses.length,
        statuses,
        changedRows,
        resolvedIssueCount
      };
    });

    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/issues/:issueId/resolve', async (req, res) => {
  try {
    const issueId = Number(req.params.issueId);
    if (!Number.isInteger(issueId)) {
      return res.status(400).json({ message: 'Issue ID must be an integer.' });
    }

    const rows = await queryDatabase(`
      UPDATE entry_issues
      SET resolved_at = COALESCE(resolved_at, now())
      WHERE issue_id = $1
      RETURNING issue_id, resolved_at
    `, [issueId]);

    if (!rows.length) {
      return res.status(404).json({ message: 'Issue was not found.' });
    }

    res.json({
      issueId: toInt(rows[0].issue_id),
      resolvedAt: rows[0].resolved_at
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.patch('/api/issues/resolve', async (req, res) => {
  try {
    const issueIds = Array.isArray(req.body?.issueIds)
      ? req.body.issueIds.map(Number).filter((id) => Number.isInteger(id))
      : [];
    const uniqueIssueIds = [...new Set(issueIds)];

    if (!uniqueIssueIds.length) {
      return res.status(400).json({ message: 'Issue IDs must be a non-empty integer array.' });
    }

    const rows = await queryDatabase(`
      UPDATE entry_issues
      SET resolved_at = COALESCE(resolved_at, now())
      WHERE issue_id = ANY($1::bigint[])
      RETURNING issue_id, resolved_at
    `, [uniqueIssueIds]);

    res.json({
      resolvedCount: rows.length,
      issues: rows.map((row) => ({
        issueId: toInt(row.issue_id),
        resolvedAt: row.resolved_at
      }))
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/issues/:issueId', async (req, res) => {
  try {
    const issueId = Number(req.params.issueId);
    if (!Number.isInteger(issueId)) {
      return res.status(400).json({ message: 'Issue ID must be an integer.' });
    }

    const rows = await queryDatabase(`
      SELECT
        ei.issue_id,
        ei.entry_id,
        ei.song_id,
        ei.match_method,
        ei.reason,
        ei.details,
        ei.created_at,
        ei.resolved_at,
        e.source_id,
        e.source_item_id,
        e.raw_title,
        e.raw_artist,
        e.raw_album,
        e.raw_json AS entry_raw_json,
        COALESCE(
          e.raw_json ->> 'album_artwork',
          e.raw_json #>> '{albums,0,artwork}'
        ) AS entry_artwork,
        e.raw_duration,
        src.source_file,
        ${buildSongProjection()}
      FROM entry_issues ei
      JOIN entries e
        ON e.entry_id = ei.entry_id
      JOIN sources src
        ON src.source_id = e.source_id
      LEFT JOIN entry_mapping em
        ON em.entry_id = ei.entry_id
       AND em.song_id IS NOT DISTINCT FROM ei.song_id
      ${buildSongJoins('COALESCE(ei.song_id, em.song_id)')}
      WHERE ei.issue_id = $1
      LIMIT 1
    `, [issueId]);

    if (!rows.length) {
      return res.status(404).json({ message: 'Issue was not found.' });
    }

    res.json({ row: normalizeIssueRow(rows[0]) });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/issues', async (req, res) => {
  try {
    const reason = typeof req.query.reason === 'string' ? req.query.reason : null;
    const includeResolved = req.query.includeResolved === 'true';
    const params = [];
    const where = [];

    if (reason) {
      params.push(reason);
      where.push(`ei.reason = $${params.length}`);
    }
    if (!includeResolved) {
      where.push('ei.resolved_at IS NULL');
    }

    const rows = await queryDatabase(`
      SELECT
        ei.issue_id,
        ei.entry_id,
        ei.song_id,
        ei.match_method,
        ei.reason,
        ei.details,
        ei.created_at,
        ei.resolved_at,
        e.source_id,
        e.source_item_id,
        e.raw_title,
        e.raw_artist,
        e.raw_album,
        e.raw_json AS entry_raw_json,
        COALESCE(
          e.raw_json ->> 'album_artwork',
          e.raw_json #>> '{albums,0,artwork}'
        ) AS entry_artwork,
        e.raw_duration,
        src.source_file,
        ${buildSongProjection()}
      FROM entry_issues ei
      JOIN entries e
        ON e.entry_id = ei.entry_id
      JOIN sources src
        ON src.source_id = e.source_id
      LEFT JOIN entry_mapping em
        ON em.entry_id = ei.entry_id
       AND em.song_id IS NOT DISTINCT FROM ei.song_id
      ${buildSongJoins('COALESCE(ei.song_id, em.song_id)')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ei.resolved_at NULLS FIRST, ei.created_at DESC, ei.issue_id DESC
      LIMIT 500
    `, params);

    res.json({
      reason,
      includeResolved,
      rows: rows.map(normalizeIssueRow)
    });
  } catch (error) {
    handleError(res, error);
  }
});

}

registerPortal({ app, database, requireAudit, registerApiRoutes, TABLE_CONFIGS, buildSongJoins, buildSongProjection, normalizeMappingRow, normalizeIssueRow, normalizeEntryGroupRow, normalizeChangeLogRow, getTableDetail, queryDatabase, handleError, foldLatinSql, foldLatinText });

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) app.listen(port, () => {
  console.log(`Library Portal is running at http://localhost:${port}`);
});

module.exports = { app, database };
