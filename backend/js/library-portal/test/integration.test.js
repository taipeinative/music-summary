const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./database-fixture');
const { auditContext } = require('../src/audit');

test('PostgreSQL API, filters, pagination and atomic audit', { skip: !process.env.PORTAL_TEST_DB }, async (t) => {
  const fixture = await createFixture();
  const { app, database } = require('../server');
  let savedConfig = fixture.config;
  database.configStore.readDatabaseConfig = async () => savedConfig;
  database.configStore.saveDatabaseConfig = async (config) => { savedConfig = config; };
  database.configStore.delete = async () => { savedConfig = null; };
  await database.connect(fixture.config);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (url, options = {}) => {
    const response = await fetch(base + url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await response.json(); return { status: response.status, data };
  };
  const meta = { changedBy: 'Portal test', reason: 'Atomicity verification' };
  try {
    await t.test('All nine lists execute against the real schema', async () => {
      for (const resource of ['albums', 'artists', 'songs', 'entries', 'sources', 'mappings', 'entry-groups', 'issues', 'history']) {
        const result = await call('/' + resource); assert.equal(result.status, 200, `${resource}: ${JSON.stringify(result.data)}`);
      }
    });
    await t.test('Every advertised filter and sortable field executes against PostgreSQL', async () => {
      const { fields } = require('../public/js/portal-model');
      const enums = require('../src/enums.json');
      for (const [resource, catalog] of Object.entries(fields)) for (const field of catalog) {
        const value = field.options ? Object.keys(enums[field.options])[0] : ({ number: '1', date: '2024-01-02', duration: '3:00', relation: true, text: 'A' })[field.type];
        const params = new URLSearchParams({ filters: JSON.stringify([{ field: field.key, value, operator: field.type === 'text' ? 'contains' : 'eq' }]), sort: JSON.stringify(field.type === 'relation' ? [] : [{ field: field.key, direction: 'desc' }]) });
        const result = await call(`/${resource}?${params}`);
        assert.equal(result.status, 200, `${resource}.${field.key}: ${JSON.stringify(result.data)}`);
      }
    });
    await t.test('Gallery modes, primary locale, multigroup flags, paging, cover preference and search', async () => {
      const gallery = async (mode, groupBy, extra = {}) => {
        const result = await call('/gallery?' + new URLSearchParams({ mode, groupBy, ...extra }));
        assert.equal(result.status, 200, JSON.stringify(result.data));
        return result.data.groups;
      };
      const catalog = require('../public/js/gallery-model');
      for (const [mode, groupings] of Object.entries(catalog.modes)) for (const grouping of groupings) await gallery(mode, grouping);
      const primary = await gallery('artists', 'locale', { language: 'chinese' });
      assert.deepEqual(primary.map((g) => g.key), ['undefined']);
      assert.equal(primary[0].total, 3);
      assert.ok(primary[0].rows.some((r) => r.title === '繁體藝人'));
      const tags = await gallery('artists', 'tag');
      assert.deepEqual(tags.map((g) => [g.label, g.total]), [['AI', 3], ['Synthesizer', 3]]);
      assert.equal(tags[0].rows.find((r) => r.id === 1).album_count, 1);
      assert.equal(tags[0].rows.find((r) => r.id === 1).track_count, 3);
      const first = await gallery('songs', 'genre');
      assert.deepEqual(first.map((g) => [g.label, g.total, g.rows.length]), [['Classical', 125, 24], ['Country', 125, 24]]);
      const second = await gallery('songs', 'genre', { group: 'classical', page: 2 });
      assert.equal(second.length, 1); assert.equal(second[0].page, 2);
      assert.equal(new Set([...first[0].rows, ...second[0].rows].map((r) => r.id)).size, 48);
      assert.equal((await gallery('songs', 'genre', { group: 'classical', page: 999 }))[0].page, 1);
      assert.deepEqual(await gallery('songs', 'genre', { search: '__no_results__' }), []);
      assert.deepEqual((await gallery('songs', 'genre', { search: 'Test Album' }))[0].rows.map((r) => r.id), [1, 2, 3]);
      assert.equal((await call('/gallery?mode=sources')).status, 400);
      assert.equal((await call('/gallery?mode[]=songs')).status, 400);
      assert.equal((await call('/gallery?mode=artists&groupBy=year')).status, 400);
      assert.deepEqual(await gallery('songs', 'genre', { group: "x'; DROP TABLE songs; --" }), []);
      await fixture.pool.query("INSERT INTO song_locales(song_id,locale,is_primary) VALUES(1,8192,false); UPDATE songs SET genre_tag = 1099511628032, release_date = NULL WHERE song_id = 125; UPDATE albums SET artwork = 'https://example.com/album.jpg' WHERE album_id = 1");
      const added = (await fixture.pool.query("INSERT INTO albums(album_type,artwork) VALUES(0,'https://example.com/single.jpg') RETURNING album_id")).rows[0].album_id;
      await fixture.pool.query('INSERT INTO album_tracks VALUES($1,1,1,1)', [added]);
      try {
        const locales = await gallery('songs', 'locale');
        assert.deepEqual(locales.map((g) => [g.label, g.total]), [['Chinese', 1], ['English', 1], ['Japanese', 1], ['Undefined', 124]]);
        const genres = await gallery('songs', 'genre', { search: 'Song 125' });
        assert.deepEqual(genres.map((g) => g.label), ['Dance', 'Bass', 'Color Bass', 'Trap']);
        const years = await gallery('songs', 'year');
        assert.deepEqual(years.map((g) => g.label), ['2020s', '2024', 'Unknown']);
        assert.equal((await gallery('songs', 'locale', { group: 'chinese' }))[0].rows[0].artwork, 'https://example.com/album.jpg');
      } finally {
        await fixture.pool.query('DELETE FROM album_tracks WHERE album_id = $1', [added]);
        await fixture.pool.query('DELETE FROM albums WHERE album_id = $1', [added]);
        await fixture.pool.query("DELETE FROM song_locales WHERE song_id = 1 AND locale = 8192; UPDATE songs SET genre_tag = 3, release_date = '2024-01-02' WHERE song_id = 125; UPDATE albums SET artwork = NULL WHERE album_id = 1");
      }
    });
    await t.test('First page recovery, filtered counts, source detail and language', async () => {
      assert.equal((await call('/songs?page=999')).data.page, 1);
      assert.equal((await call('/issues')).data.total, 3);
      assert.equal((await call('/summary')).data.issues, 4);
      assert.equal((await call('/sources/1')).data.imported_count, 4);
      assert.equal((await call('/songs?language=chinese')).data.rows[0].title, '繁體歌曲');
      const query = new URLSearchParams({ filters: JSON.stringify([{ field: 'track_count', operator: 'eq', value: '15' }]) });
      assert.equal((await call('/albums?' + query)).data.total, 1);
      const empty = (await call('/songs?search=__no_results__&page=99')).data;
      assert.equal(empty.page, 1); assert.equal(empty.pageCount, 0); assert.equal(empty.total, 0); assert.equal(empty.resourceTotal, 125);
      const locales = (await call('/songs')).data.rows[0].locales;
      assert.equal(locales[0].isPrimary, true); assert.equal(locales[0].locale, 32768);
      assert.equal((await call('/songs/1')).data.artists[1].role, 1);
      assert.equal((await call('/artists/2')).data.songs[0].role, 1);
    });
    await t.test('Flags, relation directions, multivalue ordering, duration and invalid query', async () => {
      const filter = async (resource, filters, sort = []) => call('/' + resource + '?' + new URLSearchParams({ filters: JSON.stringify(filters), sort: JSON.stringify(sort) }));
      assert.equal((await filter('artists', [{ field: 'has_member', value: true }])).data.rows[0].artist_id, 2);
      assert.equal((await filter('artists', [{ field: 'is_member', value: true }])).data.rows[0].artist_id, 1);
      assert.equal((await filter('songs', [{ field: 'genre_tag', value: '3' }])).data.total, 125);
      assert.equal((await filter('songs', [{ field: 'duration', operator: 'eq', value: '3:00' }])).data.total, 125);
      assert.equal((await filter('songs', [{ field: 'duration', operator: 'eq', value: '3:99' }])).status, 400);
      const sorted = await filter('songs', [{ field: 'id', operator: 'lte', value: '3' }], [{ field: 'artists', direction: 'asc' }]);
      assert.deepEqual(sorted.data.rows.map((r) => r.song_id), [3,1,2]);
      assert.equal((await filter('songs', [{ field: 'locale', value: '32770' }])).data.total, 1);
      assert.equal((await filter('songs', [{ field: 'locale', value: '32774' }])).data.total, 0);
      assert.equal((await filter('songs', [{ field: 'locale', value: '0' }])).data.total, 124);
      assert.equal((await filter('albums', [], [{ field: 'artists', direction: 'asc' }])).status, 200);
      assert.equal((await filter('songs', [{ field: 'id;DROP', value: '1' }])).status, 400);
    });
    await t.test('Search matches only the requested fields, including related titles and entry metadata', async () => {
      const search = async (resource, value) => {
        const result = await call(`/${resource}?search=${encodeURIComponent(value)}`);
        assert.equal(result.status, 200, JSON.stringify(result.data));
        return result.data;
      };
      for (const [resource, term] of [['albums', 'English A'], ['artists', 'Alias A'], ['songs', '繁體歌曲'], ['songs', 'Test Album'], ['entries', 'Test Album'], ['sources', 'portal-fixture.json'], ['issues', 'Song 1']]) {
        assert.ok((await search(resource, term)).total > 0, `${resource}: ${term}`);
      }
      for (const [resource, term] of [['albums', '2024-01-02'], ['artists', 'artist_tag'], ['songs', '180001'], ['entries', 'portal-fixture.json'], ['sources', '2024-01-01'], ['issues', 'NO_CANDIDATE']]) {
        assert.equal((await search(resource, term)).total, 0, `${resource}: excludes ${term}`);
      }
      await fixture.pool.query("UPDATE entries SET raw_title = 'EntryOnlyTitle', raw_artist = 'EntryOnlyArtist', raw_album = 'EntryOnlyAlbum' WHERE entry_id = 3");
      await fixture.pool.query("INSERT INTO change_log(table_name,row_pk,operation,changed_by,reason,old_data) VALUES('SearchTableOnly', '{\"SearchKeyOnly\":\"SearchValueOnly\"}', 'SearchOperationOnly', 'SearchInitiatorOnly', 'SearchReasonOnly', '{\"note\":\"SearchOldOnly\"}')");
      try {
        for (const term of ['EntryOnlyTitle', 'EntryOnlyArtist', 'EntryOnlyAlbum']) assert.deepEqual((await search('songs', term)).rows.map((row) => row.id), [3]);
        for (const term of ['SearchValueOnly', 'SearchInitiatorOnly', 'SearchReasonOnly']) assert.equal((await search('history', term)).total, 1);
        for (const term of ['SearchKeyOnly', 'SearchTableOnly', 'SearchOperationOnly', 'SearchOldOnly']) assert.equal((await search('history', term)).total, 0);
        assert.equal((await search('songs', "x'; DROP TABLE songs; --")).total, 0);
      } finally {
        await fixture.pool.query("UPDATE entries SET raw_title = 'Song 3', raw_artist = 'A', raw_album = 'Test Album' WHERE entry_id = 3");
        await fixture.pool.query("DELETE FROM change_log WHERE table_name = 'SearchTableOnly'");
      }
    });
    await t.test('Actor and reason required; issue resolution logs once; no-op logs nothing', async () => {
      assert.equal((await call('/issues/1/resolve', { method: 'PATCH', body: '{}' })).status, 400);
      assert.equal((await call('/issues/1/resolve', { method: 'PATCH', body: '{"dryRun":true}' })).status, 400);
      await assert.rejects(() => database.transaction((client) => client.query('DELETE FROM songs WHERE song_id = 125')), /read-only/);
      await assert.rejects(() => database.query('WITH removed AS (DELETE FROM songs WHERE song_id = 125 RETURNING *) SELECT * FROM removed'), /read-only/);
      assert.equal((await call('/issues/1/resolve', { method: 'PATCH', body: JSON.stringify(meta) })).status, 200);
      const logs = await fixture.pool.query("SELECT * FROM change_log WHERE table_name = 'entry_issues'");
      assert.equal(logs.rows.length, 1); assert.equal(logs.rows[0].changed_by, meta.changedBy); assert.equal(logs.rows[0].old_data.resolved_at, null);
      await call('/issues/1/resolve', { method: 'PATCH', body: JSON.stringify(meta) });
      assert.equal((await fixture.pool.query('SELECT * FROM change_log')).rows.length, 1);
    });
    await t.test('Failed audit rolls back every business row and log', async () => {
      await fixture.pool.query("ALTER TABLE change_log ADD CONSTRAINT injected_audit_failure CHECK (reason <> 'fail audit')");
      const result = await call('/issues/resolve', { method: 'PATCH', body: JSON.stringify({ ...meta, reason: 'fail audit', issueIds: [2,3] }) });
      assert.equal(result.status, 500);
      assert.equal((await fixture.pool.query('SELECT * FROM entry_issues WHERE issue_id IN (2,3) AND resolved_at IS NULL')).rows.length, 2);
      await fixture.pool.query('ALTER TABLE change_log DROP CONSTRAINT injected_audit_failure');
    });
    await t.test('Cascade deletions and logical composite keys are audited', async () => {
      await auditContext.run(meta, () => database.transaction((client) => client.query('DELETE FROM entry_group WHERE group_id = 3')));
      const logs = await fixture.pool.query("SELECT table_name FROM change_log WHERE operation = 'DELETE'");
      assert.deepEqual(logs.rows.map((r) => r.table_name).sort(), ['entry_group', 'entry_group_entries', 'entry_group_issues']);
    });
    if (process.env.LIBRARY_PORTAL_PYTHON) await t.test('Python confirmation and audit are atomic; failure in later batch item restores earlier item', async () => {
      const { pythonTransaction } = require('../src/python-client');
      await assert.rejects(() => pythonTransaction(fixture.config, meta, (client) => client.confirm([{ entryId: 1, songId: 1 }, { entryId: 999999, songId: 999999 }])));
      assert.equal((await fixture.pool.query('SELECT status FROM entry_mapping WHERE entry_id = 1')).rows[0].status, 0);
      await pythonTransaction(fixture.config, meta, (client) => client.confirm([{ entryId: 1, songId: 1 }]));
      assert.equal((await fixture.pool.query('SELECT status FROM entry_mapping WHERE entry_id = 1')).rows[0].status, 1);
      assert.ok((await fixture.pool.query("SELECT 1 FROM change_log WHERE table_name = 'entry_mapping'")).rows.length);
    });
    if (process.env.LIBRARY_PORTAL_PYTHON) await t.test('Entry membership and Python confirmation roll back together when audit fails', async () => {
      const before = (await fixture.pool.query('SELECT row_to_json(g) AS data FROM entry_group g ORDER BY group_id')).rows;
      const logCount = (await fixture.pool.query('SELECT count(*)::int AS n FROM change_log')).rows[0].n;
      await fixture.pool.query("ALTER TABLE change_log ADD CONSTRAINT injected_python_audit_failure CHECK (reason <> 'fail Python audit')");
      const input = { ...meta, reason: 'fail Python audit', detail: { entryGroupMode: 'existing', entryGroupId: 1, songId: 3, status: 'CONFIRMED' } };
      const failed = await call('/entries/3', { method: 'PATCH', body: JSON.stringify(input) });
      assert.equal(failed.status, 500, JSON.stringify(failed.data));
      assert.equal((await fixture.pool.query('SELECT status FROM entry_mapping WHERE entry_id = 3')).rows[0].status, 0);
      assert.equal((await fixture.pool.query('SELECT * FROM entry_group_entries WHERE entry_id = 3')).rows.length, 0);
      assert.deepEqual((await fixture.pool.query('SELECT row_to_json(g) AS data FROM entry_group g ORDER BY group_id')).rows, before);
      assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM change_log')).rows[0].n, logCount);
      await fixture.pool.query('ALTER TABLE change_log DROP CONSTRAINT injected_python_audit_failure');
      input.reason = meta.reason;
      const success = await call('/entries/3', { method: 'PATCH', body: JSON.stringify(input) });
      assert.equal(success.status, 200, JSON.stringify(success.data));
      assert.equal((await fixture.pool.query('SELECT status FROM entry_mapping WHERE entry_id = 3')).rows[0].status, 1);
      assert.equal(Number((await fixture.pool.query('SELECT group_id FROM entry_group_entries WHERE entry_id = 3')).rows[0].group_id), 1);
    });
    if (process.env.LIBRARY_PORTAL_PYTHON) await t.test('Direct mapping confirmation merges source metadata and audits the merged song', async () => {
      await fixture.pool.query('UPDATE entries SET raw_json = $1 WHERE entry_id = 2', [JSON.stringify({ songs: [{ releaseDate: '2020-03-04', title: { en: 'Source English Title' } }] })]);
      const result = await call('/mappings/2/2/status', { method: 'PATCH', body: JSON.stringify({ ...meta, status: 'CONFIRMED' }) });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.equal((await fixture.pool.query('SELECT release_date::text AS date FROM songs WHERE song_id = 2')).rows[0].date, '2020-03-04');
      const log = (await fixture.pool.query("SELECT * FROM change_log WHERE table_name = 'songs' AND row_pk->>'song_id' = '2' ORDER BY change_id DESC LIMIT 1")).rows[0];
      assert.equal(log.old_data.release_date, '2024-01-02'); assert.equal(log.new_data.release_date, '2020-03-04'); assert.equal(log.changed_by, meta.changedBy);
    });
    await t.test('Create, edit and merge artist record actual before/after values without duplicate logs', async () => {
      const detail = { artistTag: 0, titles: [{ locale: 1, title: 'Created Artist', fallback: true }], aliases: [], authorities: [], relations: [] };
      const created = await call('/artists', { method: 'POST', body: JSON.stringify({ ...meta, detail }) });
      assert.equal(created.status, 200, JSON.stringify(created.data));
      const id = created.data.detail.id;
      detail.titles[0].title = 'Updated Artist';
      const edited = await call(`/artists/${id}`, { method: 'PATCH', body: JSON.stringify({ ...meta, detail }) });
      assert.equal(edited.status, 200, JSON.stringify(edited.data));
      const changes = (await fixture.pool.query("SELECT * FROM change_log WHERE table_name = 'artist_titles' AND row_pk->>'artist_id' = $1 ORDER BY change_id", [String(id)])).rows;
      assert.deepEqual(changes.map((r) => r.operation), ['INSERT', 'UPDATE']);
      assert.equal(changes[1].old_data.title, 'Created Artist'); assert.equal(changes[1].new_data.title, 'Updated Artist');
      const count = (await fixture.pool.query('SELECT count(*)::int AS n FROM change_log')).rows[0].n;
      assert.equal((await call(`/artists/${id}`, { method: 'PATCH', body: JSON.stringify({ ...meta, detail }) })).status, 200);
      assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM change_log')).rows[0].n, count);
      const preview = await call(`/artists/${id}/merge`, { method: 'POST', body: JSON.stringify({ targetArtistId: 1, dryRun: true }) });
      assert.equal(preview.status, 200, JSON.stringify(preview.data));
      assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM change_log')).rows[0].n, count);
      const merged = await call(`/artists/${id}/merge`, { method: 'POST', body: JSON.stringify({ ...meta, targetArtistId: 1 }) });
      assert.equal(merged.status, 200, JSON.stringify(merged.data));
      assert.equal((await fixture.pool.query('SELECT * FROM artists WHERE artist_id = $1', [id])).rows.length, 0);
      assert.equal((await fixture.pool.query("SELECT * FROM change_log WHERE table_name = 'artists' AND operation = 'DELETE' AND row_pk->>'artist_id' = $1", [String(id)])).rows.length, 1);
    });
    await t.test('Logout returns unauthenticated; login restores access without exposing password', async () => {
      assert.equal((await call('/logout', { method: 'POST', body: '{"forget":true}' })).status, 200);
      assert.equal((await call('/session')).data.authenticated, false);
      assert.equal((await call('/songs')).status, 401);
      assert.equal((await call('/gallery')).status, 401);
      const login = await call('/login', { method: 'POST', body: JSON.stringify(fixture.config) });
      assert.equal(login.status, 200, JSON.stringify(login.data));
      assert.ok(!JSON.stringify(login.data).includes(fixture.config.password));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve)); await database.close(); await fixture.dispose();
  }
});
