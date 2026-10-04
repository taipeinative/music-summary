const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PortalModel = require('../public/js/portal-model');

function renderer() {
  const context = vm.createContext({ PortalModel, URLSearchParams, setTimeout, clearTimeout, fetch: () => { throw new Error('Unexpected network call'); } });
  for (const file of ['js/app-config.js', 'js/api-client.js', 'app.js']) {
    let source = fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
    if (file === 'app.js') {
      const marker = "$('login-form').addEventListener('submit', handleLogin);";
      assert.equal(source.split(marker).length, 2, 'Review DOM startup boundary');
      source = source.slice(0, source.indexOf(marker));
    }
    vm.runInContext(source, context, { filename: file });
  }
  return (source) => vm.runInContext(source, context);
}

test('Song artist roles stay inside the clickable row and escape untrusted titles', () => {
  const run = renderer();
  const html = run("renderArtistLinks([{artist_id: 1, title: '<main>', role: 0}, {artist_id: 2, title: 'Guest', role: 1}], true)");
  assert.match(html, /&lt;main&gt;/); assert.doesNotMatch(html, /<main>/);
  assert.equal((html.match(/class="artist-role"/g) || []).length, 1);
  assert.match(html, /data-artist-id="2"[\s\S]*class="artist-role">featured<\/span>[\s\S]*<\/button>/);
  const songCard = run("renderArtistSongSection([{song_id: 1, title: 'Song', role: 1, duration: 254000, release_date: '2016-10-20'}])");
  assert.match(songCard, /Featured · 4:14 · 2016-10-20/);
  assert.doesNotMatch(songCard, /DBRole:/);
});

test('Actual song table renders locale order instead of its numeric bitmask', () => {
  const run = renderer();
  const html = run("state.table.key = 'song'; state.table.columns = ['song_id', 'locale']; state.rows = [{song_id: 1, locale: 32770, locales: [{locale: 2, isPrimary: false}, {locale: 32768, isPrimary: true}]}]; renderTableDataTable()");
  assert.match(html, /zh-Hant; en/); assert.doesNotMatch(html, />\s*32770\s*</);
});

test('Flag None is exclusive and high bits survive rendering', () => {
  const run = renderer();
  assert.equal(run("getFlagSummary({'0': 'None', '1': 'A', '1099511627776': 'High'}, '1099511627777')"), 'A, High');
  assert.equal(run("getFlagSummary({'0': 'None', '1': 'A'}, '0')"), 'None');
  assert.match(run("renderFlagDropdown({'0': 'None', '1': 'A'}, '1', '')"), /value="0" >[\s\S]*value="1" checked/);
});
