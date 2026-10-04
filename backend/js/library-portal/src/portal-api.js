const { AsyncLocalStorage } = require('node:async_hooks');
const { compile } = require('./query');
const { groupSql } = require('./hydrate');
const { fields } = require('../public/js/portal-model');
const languageContext = new AsyncLocalStorage();
const singular = { albums: 'album', artists: 'artist', songs: 'song', entries: 'entry', sources: 'source' };
const resourceTables = { albums: 'albums', artists: 'artists', songs: 'songs', entries: 'entries', sources: 'sources', mappings: 'entry_mapping', 'entry-groups': 'entry_group', issues: 'entry_issues', history: 'change_log' };
function titleOrder(locale = 'locale', fallback = 'fallback') {
  const language = languageContext.getStore() || 'original';
  const codes = language === 'english' ? [2] : language === 'chinese' ? [32768, 16384, 8192] : [];
  return `CASE ${codes.map((code, i) => `WHEN ${locale} = ${code} THEN ${i}`).join(' ')} WHEN ${fallback} THEN ${codes.length} ELSE 99 END, ${locale}`;
}
function title(type, id) {
  return `(SELECT title FROM ${type}_titles WHERE ${type}_id = ${id} ORDER BY ${titleOrder()} LIMIT 1)`;
}
function baseSql(resource, deps) {
  const { buildSongJoins, buildSongProjection } = deps;
  if (['albums', 'artists', 'songs'].includes(resource)) {
    const type = singular[resource];
    const t = title(type, `a.${type}_id`);
    if (resource === 'artists') return { sql: `SELECT a.*, a.artist_id AS id, ${t} AS title,
      ARRAY(SELECT alias FROM artist_alias WHERE artist_id = a.artist_id) AS alias,
      EXISTS(SELECT 1 FROM artist_relations WHERE ref_artist_id = a.artist_id AND relation_to_ref = 1) AS has_member,
      EXISTS(SELECT 1 FROM artist_relations WHERE artist_id = a.artist_id AND relation_to_ref = 1) AS is_member FROM artists a`, arrays: ['alias'] };
    const artists = `ARRAY(SELECT ${title('artist', 'ar.artist_id')} FROM ${type}_artists ar WHERE ar.${type}_id = a.${type}_id ORDER BY ar.display_order)`;
    if (resource === 'albums') return { sql: `SELECT a.*, a.album_id AS id, ${t} AS title, ${artists} AS artists,
      COALESCE((SELECT sum(track_count) FROM album_track_counts WHERE album_id = a.album_id), 0) AS track_count,
      ARRAY(SELECT track_count FROM album_track_counts WHERE album_id = a.album_id ORDER BY disc_number) AS track_counts FROM albums a`, arrays: ['artists'] };
    return { sql: `SELECT a.*, a.song_id AS id, ${t} AS title, ${artists} AS artists,
      ARRAY(SELECT DISTINCT ${title('album', 'at.album_id')} FROM album_tracks at WHERE at.song_id = a.song_id) AS album,
      COALESCE((SELECT bit_or(locale::bigint) FROM song_locales WHERE song_id = a.song_id), 0) AS locale,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('locale', locale, 'isPrimary', is_primary) ORDER BY is_primary DESC, locale) FROM song_locales WHERE song_id = a.song_id), '[]'::jsonb) AS locales
      FROM songs a`, arrays: ['artists', 'album'] };
  }
  if (resource === 'sources') return { sql: 'SELECT s.*, s.source_id AS id FROM sources s' };
  if (resource === 'history') return { sql: 'SELECT c.*, c.change_id AS id FROM change_log c' };
  if (resource === 'entries') return { sql: `SELECT e.*, e.entry_id AS id, e.raw_title AS title, e.raw_artist AS artist, e.raw_album AS album, src.source_type, src.source_file,
    ARRAY(SELECT group_id FROM entry_group_entries WHERE entry_id = e.entry_id) AS entry_group_id,
    ARRAY(SELECT song_id FROM entry_mapping WHERE entry_id = e.entry_id) AS song_id,
    ARRAY(SELECT CASE status WHEN 0 THEN 'PENDING' WHEN 1 THEN 'CONFIRMED' ELSE 'REJECTED' END FROM entry_mapping WHERE entry_id = e.entry_id)
      || ARRAY[CASE WHEN EXISTS(SELECT 1 FROM entry_mapping WHERE entry_id = e.entry_id) THEN 'MAPPED' ELSE 'UNMAPPED' END] AS status,
    ARRAY(SELECT reason FROM entry_issues WHERE entry_id = e.entry_id) AS issue_type
    FROM entries e JOIN sources src ON src.source_id = e.source_id`, arrays: ['entry_group_id', 'song_id', 'status', 'issue_type'] };
  if (resource === 'entry-groups') {
    const sql = groupSql(buildSongJoins, buildSongProjection);
    return { sql: `SELECT g.*, g.group_id AS id,
      ARRAY(SELECT e.raw_title FROM entry_group_entries ge JOIN entries e USING(entry_id) WHERE ge.group_id = g.group_id) AS title,
      ARRAY(SELECT e.raw_artist FROM entry_group_entries ge JOIN entries e USING(entry_id) WHERE ge.group_id = g.group_id) AS artist,
      ARRAY(SELECT e.raw_album FROM entry_group_entries ge JOIN entries e USING(entry_id) WHERE ge.group_id = g.group_id) AS album,
      ARRAY(SELECT substring(COALESCE(e.raw_json #>> '{songs,0,releaseDate}', e.raw_json #>> '{songs,0,release_date}', e.raw_json #>> '{albums,0,releaseDate}', e.raw_json #>> '{albums,0,release_date}', e.raw_json ->> 'releaseDate', e.raw_json ->> 'release_date'),1,10) FROM entry_group_entries ge JOIN entries e USING(entry_id) WHERE ge.group_id = g.group_id) AS release_date
      FROM (${sql}) g`, arrays: ['title', 'artist', 'album', 'release_date'] };
  }
  const issue = resource === 'issues';
  const alias = issue ? 'ei' : 'em';
  return { sql: `SELECT ${alias}.*, ${issue ? 'ei.issue_id AS id, ei.reason AS issue_type,' : "CASE WHEN src.source_type = 1 THEN 'incoming' WHEN em.status = 0 THEN 'pending' ELSE 'existing' END AS category,"}
    e.source_id, e.source_item_id, e.raw_title, e.raw_artist, e.raw_album, e.raw_duration,
    e.raw_json AS entry_raw_json, COALESCE(e.raw_json ->> 'album_artwork', e.raw_json #>> '{albums,0,artwork}') AS entry_artwork,
    src.source_file, src.source_type, ${buildSongProjection()}
    FROM ${issue ? 'entry_issues ei' : 'entry_mapping em'} JOIN entries e ON e.entry_id = ${alias}.entry_id
    JOIN sources src ON src.source_id = e.source_id ${buildSongJoins(`${alias}.song_id`)}` };
}

function registerPortal(deps) {
  const { app, database, requireAudit, registerApiRoutes, queryDatabase, handleError, TABLE_CONFIGS } = deps;
  app.use('/api', (req, res, next) => {
    const language = ['original', 'english', 'chinese'].includes(req.query.language) ? req.query.language : 'original';
    languageContext.run(language, next);
  });
  app.use(requireAudit);
  app.get('/api/v1/summary', async (_req, res) => {
    try {
      const [row] = await queryDatabase(`SELECT ${Object.entries(resourceTables).map(([k, t]) => `(SELECT count(*)::int FROM ${t}) AS "${k}"`).join(', ')}`);
      res.json(row);
    } catch (error) { handleError(res, error); }
  });
  for (const resource of Object.keys(fields)) app.get(`/api/v1/${resource}`, async (req, res) => {
    try {
      const base = baseSql(resource, deps);
      const query = compile(resource, req.query, { arrays: base.arrays, fold: deps.foldLatinSql, foldText: deps.foldLatinText });
      // Repeatable-read keeps count and page consistent across concurrent commits.
      const payload = await database.transaction(async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        await client.query("SET LOCAL statement_timeout = '15s'");
        const from = `FROM (${base.sql}) p ${query.where}`;
        const count = await client.query(`SELECT count(*)::int AS total ${from}`, query.params);
        const total = count.rows[0].total;
        const allRows = await client.query(`SELECT count(*)::int AS total FROM ${resourceTables[resource]}`);
        const pageCount = Math.ceil(total / query.pageSize);
        const page = query.page > pageCount ? 1 : query.page;
        const data = await client.query(`SELECT p.* ${from} ORDER BY ${query.order} LIMIT $${query.params.length + 1} OFFSET $${query.params.length + 2}`, [...query.params, query.pageSize, (page - 1) * query.pageSize]);
        const normalizer = ({ mappings: deps.normalizeMappingRow, issues: deps.normalizeIssueRow, 'entry-groups': deps.normalizeEntryGroupRow, history: deps.normalizeChangeLogRow })[resource];
        return { page, pageSize: query.pageSize, pageCount, total, resourceTotal: allRows.rows[0].total, rows: normalizer ? data.rows.map(normalizer) : data.rows, columns: TABLE_CONFIGS[singular[resource]]?.columns || [] };
      });
      res.json(payload);
    } catch (error) { handleError(res, error); }
  });
  app.get('/api/v1/sources/:id', async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ message: 'Invalid Source ID.' });
      const rows = await queryDatabase('SELECT s.*, (SELECT count(*)::int FROM entries e WHERE e.source_id = s.source_id) AS imported_count FROM sources s WHERE source_id = $1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ message: 'Source not found.' });
      res.json(rows[0]);
    } catch (error) { handleError(res, error); }
  });
  // Register retained business handlers only under the new resource paths.
  const originals = {};
  for (const method of ['get', 'post', 'put', 'patch']) {
    originals[method] = app[method];
    app[method] = function (route, handler) {
      if (typeof route !== 'string') return originals[method].apply(app, arguments);
      if (method === 'get' && ['/api/summary', '/api/mappings/:category', '/api/groups', '/api/issues', '/api/changelog', '/api/tables/:table', '/api/settings'].includes(route)) return app;
      if (route === '/api/settings') return app;
      if (route.includes(':table')) {
        for (const [resource, table] of Object.entries(singular)) {
          if (resource === 'sources' && route.endsWith(':id')) continue;
          const newRoute = route.replace('/api/tables/:table', `/api/v1/${resource}`);
          originals[method].call(app, newRoute, (req, res) => { req.params.table = table; return handler(req, res); });
        }
        return app;
      }
      const newRoute = route.replace('/api/tables/artist', '/api/artists').replace('/api/groups', '/api/entry-groups').replace('/api/', '/api/v1/');
      return originals[method].call(app, newRoute, handler);
    };
  }
  registerApiRoutes();
  for (const method of Object.keys(originals)) app[method] = originals[method];
  app.use('/api', (_req, res) => res.status(404).json({ message: 'Unknown API resource.' }));
}
module.exports = { registerPortal, titleOrder, baseSql, languageContext };
