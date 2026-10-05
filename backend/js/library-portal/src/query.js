const { fields, duration } = require('../public/js/portal-model');
const enums = require('./enums.json');
const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
function rules(value) {
  if (!value) return [];
  let result;
  try { result = typeof value === 'string' ? JSON.parse(value) : value; } catch { fail('Invalid rules JSON.'); }
  if (!Array.isArray(result) || result.length > 20 || result.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) fail('Rules must be an array of at most 20 objects.');
  return result;
}
function searchWhere(resource, parameter, fold) {
  const has = (expression) => `strpos(${fold(`COALESCE(${expression}, '')`)}, ${parameter}) > 0`;
  const titles = (type, id) => `EXISTS (SELECT 1 FROM ${type}_titles st WHERE st.${type}_id = ${id} AND ${has('st.title')})`;
  const artists = (type, id) => `EXISTS (SELECT 1 FROM ${type}_artists sa JOIN artist_titles st ON st.artist_id = sa.artist_id WHERE sa.${type}_id = ${id} AND ${has('st.title')})`;
  const entry = (alias) => ['raw_title', 'raw_artist', 'raw_album'].map((key) => has(`${alias}.${key}`)).join(' OR ');
  const expressions = {
    albums: () => [titles('album', 'p.id'), artists('album', 'p.id')],
    artists: () => [titles('artist', 'p.id'), `EXISTS (SELECT 1 FROM artist_alias aa WHERE aa.artist_id = p.id AND ${has('aa.alias')})`],
    songs: () => [titles('song', 'p.id'), artists('song', 'p.id'),
      `EXISTS (SELECT 1 FROM album_tracks at JOIN album_titles st ON st.album_id = at.album_id WHERE at.song_id = p.id AND ${has('st.title')})`,
      `EXISTS (SELECT 1 FROM entry_mapping em JOIN entries se ON se.entry_id = em.entry_id WHERE em.song_id = p.id AND (${entry('se')}))`],
    entries: () => [entry('p')],
    sources: () => [has('p.source_file')],
    issues: () => [entry('p')],
    history: () => [`EXISTS (SELECT 1 FROM jsonb_each_text(p.row_pk) pk WHERE ${has('pk.value')})`, has('p.changed_by'), has('p.reason')]
  };
  return expressions[resource] ? `(${expressions[resource]().join(' OR ')})` : `strpos(${fold('to_jsonb(p)::text')}, ${parameter}) > 0`;
}
function compile(resource, query, { arrays = [], fold = (sql) => `lower(${sql})`, foldText = (s) => s.toLowerCase() } = {}) {
  const catalog = fields[resource];
  if (!catalog) fail('Unknown resource.');
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200)) fail('Search must be text of at most 200 characters.');
  const params = [];
  const bind = (value) => { params.push(value); return `$${params.length}`; };
  const filters = rules(query.filters);
  const sort = rules(query.sort);
  const where = [];
  const operators = { gt: '>', gte: '>=', eq: '=', ne: '<>', lte: '<=', lt: '<' };
  for (const rule of filters) {
    const f = catalog.find((item) => item.key === rule.field);
    if (!f) fail('Unknown filter field.');
    if (f.key === 'category') {
      if (!['incoming', 'pending'].includes(rule.value)) fail('Invalid Category.');
      continue;
    }
    let value = rule.value;
    let expression = `p.${f.key}`;
    let op = rule.operator || 'eq';
    let array = arrays.includes(f.key);
    if (array) expression = 'v.value';
    let predicate;
    if (f.type === 'relation') {
      if (![true, false, 'true', 'false'].includes(value)) fail('Invalid relation filter.');
      predicate = `${expression} = ${bind(String(value) === 'true')}`;
    } else if (f.type === 'flag') {
      if (!/^\d+$/.test(String(value))) fail('Invalid flag.');
      let bits = 0n; for (const bit of Object.keys(enums[f.options] || {})) bits |= BigInt(bit);
      if ((BigInt(value) & bits) !== BigInt(value)) fail('Unknown flag bits.');
      const param = bind(String(value));
      predicate = BigInt(value) === 0n ? `${expression} = ${param}::bigint` : `(${expression}::bigint & ${param}::bigint) = ${param}::bigint`;
    } else if (f.type === 'enum') {
      if (!Object.hasOwn(enums[f.options] || {}, String(value))) fail(`Invalid ${f.label}.`);
      predicate = `${expression}::text = ${bind(String(value))}`;
    } else if (['number', 'date', 'duration'].includes(f.type)) {
      if (!operators[op]) fail('Invalid comparison.');
      if (f.type === 'date') {
        const date = new Date(`${value}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('Invalid date.');
        expression = `substring(${expression}::text, 1, 10)`;
      } else if (f.type === 'duration') {
        try { value = duration(value); } catch (error) { fail(error.message); }
      } else if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail('Invalid number.');
      const param = bind(value);
      if (f.type === 'duration') {
        const delta = `(${expression} - ${param}::bigint)`;
        predicate = ({ eq: `abs(${delta}) < 1000`, ne: `abs(${delta}) >= 1000`, gt: `${delta} >= 1000`, gte: `${delta} > -1000`, lt: `${delta} <= -1000`, lte: `${delta} < 1000` })[op];
      } else predicate = `${expression} ${operators[op]} ${param}`;
    } else {
      if (typeof value !== 'string' || value.length > 200 || !['is', 'isNot', 'contains', 'notContains', 'matches'].includes(op)) fail('Invalid text filter.');
      expression = fold(`${expression}::text`);
      const param = bind(foldText(value));
      if (op === 'matches') {
        if (value.length > 80 || !/^[\p{L}\p{N}\s.,:_\/^$*+?\[\]-]+$/u.test(value) || /[*+?]{2}/.test(value) || (value.match(/[*+?]/g) || []).length > 2) fail('Unsupported regex.');
        try { new RegExp(value); } catch { fail('Invalid regex.'); }
        predicate = `${expression} ~ ${param}`;
      } else if (op === 'contains' || op === 'notContains') predicate = `strpos(${expression}, ${param}) > 0`;
      else predicate = `${expression} = ${param}`;
    }
    if (array) predicate = `EXISTS (SELECT 1 FROM unnest(p.${f.key}) v(value) WHERE ${predicate})`;
    if (['isNot', 'notContains'].includes(op)) predicate = `NOT (${predicate})`;
    where.push(predicate);
  }
  if (resource === 'mappings') {
    const categoryRules = filters.filter((r) => r.field === 'category');
    if (categoryRules.length > 1) fail('Only one Category is allowed.');
    const category = categoryRules[0]?.value;
    if (category === 'incoming') where.push('p.source_type = 1');
    else if (!filters.some((r) => r.field === 'status')) where.push(`p.status = ${category === 'pending' ? 0 : 1}`);
  }
  if (resource === 'issues' && query.includeResolved !== 'true') where.push('p.resolved_at IS NULL');
  if (resource === 'entry-groups' && query.includeConfirmed !== 'true') where.push('p.status <> 1');
  if (query.search?.trim()) where.push(searchWhere(resource, bind(foldText(query.search.trim())), fold));
  const order = sort.map((rule) => {
    const f = catalog.find((item) => item.key === rule.field);
    if (!f || f.type === 'relation' || !['asc', 'desc'].includes(rule.direction)) fail('Invalid sort.');
    const dir = rule.direction.toUpperCase();
    let expression = `p.${f.key}`;
    if (arrays.includes(f.key)) expression = `(SELECT string_agg(value::text, '' ORDER BY value ${dir}) FROM unnest(p.${f.key}) v(value))`;
    return `${expression} ${dir} NULLS LAST`;
  });
  order.push(resource === 'mappings' ? 'p.entry_id, p.song_id' : 'p.id');
  const page = Number(query.page || 1); const pageSize = Number(query.pageSize || 100);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) fail('Invalid pagination.');
  return { params, where: where.length ? `WHERE ${where.join(' AND ')}` : '', order: order.join(', '), page, pageSize };
}
module.exports = { compile, rules };
