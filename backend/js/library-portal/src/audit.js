const { AsyncLocalStorage } = require('node:async_hooks');
const tables = require('./audit-tables.json');
const auditContext = new AsyncLocalStorage();

// V1 serializes edits and compares transaction-local snapshots in PostgreSQL.
// Temporary tables avoid loading the library into the Node/Python heap.
async function beginAudit(client) {
  await client.query('SET LOCAL lock_timeout = \'15s\'');
  await client.query(`LOCK TABLE ${Object.keys(tables).map((t) => `public.${t}`).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
  for (const table of Object.keys(tables)) {
    await client.query(`CREATE TEMP TABLE audit_before_${table} ON COMMIT DROP AS SELECT * FROM public.${table}`);
  }
}

async function finishAudit(client, { changedBy, reason }) {
  for (const [table, keys] of Object.entries(tables)) {
    const join = keys.map((k) => `o.${k} = n.${k}`).join(' AND ');
    const pk = keys.map((k) => `'${k}', COALESCE(to_jsonb(n)->'${k}', to_jsonb(o)->'${k}')`).join(', ');
    await client.query(`INSERT INTO change_log(table_name, row_pk, operation, old_data, new_data, changed_by, reason)
      SELECT $1, jsonb_build_object(${pk}),
        CASE WHEN o.${keys[0]} IS NULL THEN 'INSERT' WHEN n.${keys[0]} IS NULL THEN 'DELETE' ELSE 'UPDATE' END,
        to_jsonb(o), to_jsonb(n), $2, $3
      FROM audit_before_${table} o FULL JOIN public.${table} n ON ${join}
      WHERE to_jsonb(o) IS DISTINCT FROM to_jsonb(n)`, [table, changedBy, reason]);
  }
}

function requireAudit(req, res, next) {
  const preview = req.method === 'POST' && /^\/api\/v1\/artists\/\d+\/merge$/.test(req.path) && req.body?.dryRun === true;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || /^\/api\/v1\/(login|logout)$/.test(req.path) || preview) return next();
  const changedBy = typeof req.body?.changedBy === 'string' ? req.body.changedBy.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!changedBy || !reason) return res.status(400).json({ message: 'changedBy and reason are required.' });
  auditContext.run({ changedBy, reason, python: /^\/api\/v1\/entries\/\d+$/.test(req.path) }, next);
}

module.exports = { auditContext, beginAudit, finishAudit, requireAudit };
