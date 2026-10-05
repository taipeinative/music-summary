const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PortalModel = require('../public/js/portal-model');

test('Automatic metadata uses the connected operator and Manager reason conventions for every write', () => {
  const cases = [
    ['POST', '/artists', 'artist create'],
    ['POST', '/artists/1/merge', 'artist merge'],
    ...['albums', 'artists', 'songs', 'entries'].map((resource) => ['PATCH', `/${resource}/1`, 'table edit']),
    ['PUT', '/entry-groups/1/entries', 'entry group membership update'],
    ['PATCH', '/mappings/1/2/status', 'status update'],
    ['PATCH', '/mappings/status', 'batch status update'],
    ['PATCH', '/entry-groups/1/status', 'entry group status update'],
    ['PATCH', '/entry-groups/status', 'batch entry group status update'],
    ['PATCH', '/issues/1/resolve', 'issue resolve'],
    ['PATCH', '/issues/resolve', 'batch issue resolve']
  ];
  for (const [method, route, reason] of cases) {
    assert.deepEqual(PortalModel.editMetadata(method, `/api/v1${route}`, {}, ' test-user '), {
      changedBy: 'test-user', reason: `library-manager ${reason}`
    });
  }
  assert.equal(PortalModel.editMetadata('PATCH', '/api/v1/songs/1', { reason: ' custom reason ' }, 'user').reason, 'custom reason');
  assert.throws(() => PortalModel.editMetadata('PATCH', '/api/v1/songs/1', {}, ''), /sign in/);
  assert.throws(() => PortalModel.editMetadata('POST', '/api/v1/unknown', {}, 'user'), /unavailable/);
});

test('Request wrapper skips the metadata dialog only when enabled, retaining preview and login exclusions', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/portal-ui.js'), 'utf8');
  const start = source.indexOf('LibraryManagerApi.fetchJson = async function');
  const end = source.indexOf('// Capture before document/background listeners', start);
  assert.ok(start >= 0 && end > start);
  const sent = [];
  let prompts = 0;
  const context = vm.createContext({
    PortalModel, URL, location: { origin: 'http://localhost' }, LibraryManagerApi: {},
    portalPreferences: { autoEditMetadata: true }, portalConnection: { user: 'connected-user' },
    portalUrl: (url) => `${url}?language=original`,
    portalAudit: async () => { prompts++; return { changedBy: 'manual-user', reason: 'manual reason' }; },
    originalFetchJson: async (url, options) => { sent.push({ url, options }); return { ok: true }; }
  });
  vm.runInContext(source.slice(start, end), context);
  const call = (route, method, body = {}) => context.LibraryManagerApi.fetchJson(route, { method, body: JSON.stringify(body) });
  await call('/api/v1/issues/1/resolve', 'PATCH');
  assert.equal(prompts, 0);
  assert.deepEqual(JSON.parse(sent.at(-1).options.body), { changedBy: 'connected-user', reason: 'library-manager issue resolve' });
  await call('/api/v1/artists/1/merge', 'POST', { dryRun: true, targetArtistId: 2 });
  assert.equal(JSON.parse(sent.at(-1).options.body).changedBy, undefined);
  await call('/api/v1/login', 'POST');
  await call('/api/v1/logout', 'POST');
  assert.equal(prompts, 0);
  assert.equal(JSON.parse(sent.at(-1).options.body).changedBy, undefined);
  context.portalPreferences.autoEditMetadata = false;
  await call('/api/v1/artists/1/merge', 'POST', { dryRun: true, targetArtistId: 2 });
  assert.equal(prompts, 0);
  await call('/api/v1/songs/1', 'PATCH');
  assert.equal(prompts, 1);
  assert.equal(JSON.parse(sent.at(-1).options.body).changedBy, 'manual-user');
  context.portalPreferences.autoEditMetadata = true;
  context.portalConnection = null;
  const sentCount = sent.length;
  await assert.rejects(call('/api/v1/songs/1', 'PATCH'), /sign in/);
  assert.equal(sent.length, sentCount);
});
