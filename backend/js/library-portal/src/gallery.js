const Gallery = require('../public/js/gallery-model');
const { compile } = require('./query');

function membership(mode, groupBy) {
  if (groupBy === 'genre') {
    const values = Gallery.catalog.genre.map((g) => `('${g.key}', ${g.mask}::bigint)`).join(',');
    return `SELECT key FROM (VALUES ${values}) tags(key, bits) WHERE (p.genre_tag::bigint & bits) <> 0`;
  }
  if (groupBy === 'tag') return `SELECT bits::text AS key FROM unnest(ARRAY[0,1,2,4]) bits WHERE CASE WHEN bits = 0 THEN p.artist_tag = 0 ELSE (p.artist_tag & bits) <> 0 END`;
  if (groupBy === 'type' || groupBy === 'vocal') return `SELECT p.${groupBy === 'type' ? 'album_type' : 'vocal'}::text AS key`;
  if (groupBy === 'locale') {
    const type = mode === 'albums' ? 'album' : 'artist';
    const codes = mode === 'songs'
      ? 'SELECT locale FROM song_locales WHERE song_id = p.id'
      : `SELECT locale FROM ${type}_titles WHERE ${type}_id = p.id AND fallback`;
    const cases = Gallery.catalog.locale.map((g) => `WHEN code IN (${g.codes.join(',')}) THEN '${g.key}'`).join(' ');
    return `SELECT DISTINCT CASE ${cases} ELSE 'undefined' END AS key FROM unnest(COALESCE(NULLIF(ARRAY(${codes}), ARRAY[]::integer[]), ARRAY[1])) code`;
  }
  return `SELECT unnest(CASE WHEN p.release_date IS NULL THEN ARRAY['unknown'] ELSE ARRAY['decade:' || (floor(extract(year FROM p.release_date) / 10) * 10)::int, 'year:' || extract(year FROM p.release_date)::int] END) AS key`;
}

function registerGallery({ app, database, handleError, baseSql, title, foldLatinSql, foldLatinText }) {
  app.get('/api/v1/gallery', async (req, res) => {
    try {
      const mode = req.query.mode || 'albums';
      const groupBy = req.query.groupBy || Gallery.modes[mode]?.[0];
      if (typeof mode !== 'string' || !Object.hasOwn(Gallery.modes, mode) || !Gallery.modes[mode].includes(groupBy)) return res.status(400).json({ message: 'Invalid gallery mode or grouping.' });
      const groupKey = req.query.group;
      if (groupKey !== undefined && (typeof groupKey !== 'string' || groupKey.length > 80)) return res.status(400).json({ message: 'Invalid gallery group.' });
      const query = compile(mode, { search: req.query.search, page: req.query.page, pageSize: 24 }, { fold: foldLatinSql, foldText: foldLatinText });
      const base = baseSql(mode, {});
      const matched = `SELECT p.id, p.title, g.key FROM (${base.sql}) p CROSS JOIN LATERAL (${membership(mode, groupBy)}) g ${query.where}`;
      const payload = await database.transaction(async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        await client.query("SET LOCAL statement_timeout = '15s'");
        const counts = await client.query(`WITH matched AS (${matched}) SELECT key, count(*)::int AS total FROM matched GROUP BY key`, query.params);
        let groups = Gallery.groups(groupBy, new Map(counts.rows.map((row) => [row.key, row.total])));
        if (groupKey !== undefined) groups = groups.filter((group) => group.key === groupKey);
        const params = [...query.params];
        let condition = '';
        if (groupKey !== undefined) { params.push(groupKey); condition = `WHERE key = $${params.length}`; }
        const page = groupKey === undefined || query.page > Math.ceil((groups[0]?.total || 0) / 24) ? 1 : query.page;
        const first = (page - 1) * 24 + 1;
        const last = page * 24;
        const type = { albums: 'album', artists: 'artist', songs: 'song' }[mode];
        const artwork = mode === 'songs' ? `(SELECT al.artwork FROM album_tracks tr JOIN albums al USING(album_id) WHERE tr.song_id = a.song_id AND NULLIF(al.artwork, '') IS NOT NULL ORDER BY (al.album_type = 2) DESC, al.album_id LIMIT 1)` : 'a.artwork';
        const artists = mode === 'artists' ? 'NULL::text' : `(SELECT string_agg(${title('artist', 'ar.artist_id')}, ', ' ORDER BY ar.display_order) FROM ${type}_artists ar WHERE ar.${type}_id = a.${type}_id)`;
        const extra = mode === 'artists' ? `(SELECT count(DISTINCT album_id)::int FROM album_artists WHERE artist_id = a.artist_id) AS album_count, (SELECT count(DISTINCT song_id)::int FROM song_artists WHERE artist_id = a.artist_id) AS track_count, NULL::int AS year`
          : 'NULL::int AS album_count, NULL::int AS track_count, extract(year FROM a.release_date)::int AS year';
        const rows = groups.length ? (await client.query(`WITH matched AS (${matched}), ranked AS (SELECT *, row_number() OVER (PARTITION BY key ORDER BY lower(title) NULLS LAST, id) AS position FROM matched ${condition})
          SELECT r.key, r.id, r.title, ${artwork} AS artwork, ${artists} AS artists, ${extra}
          FROM ranked r JOIN ${mode} a ON a.${type}_id = r.id WHERE r.position BETWEEN ${first} AND ${last} ORDER BY r.key, r.position`, params)).rows : [];
        return { mode, groupBy, groups: groups.map((group) => ({ key: group.key, label: group.label, depth: group.depth, total: group.total, page, pageSize: 24, rows: rows.filter((row) => row.key === group.key) })) };
      }, { readOnly: true });
      res.json(payload);
    } catch (error) { handleError(res, error); }
  });
}
module.exports = { registerGallery, membership };
