const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PortalModel = require('../public/js/portal-model');

function renderer(globals = {}) {
  const context = vm.createContext({ PortalModel, URLSearchParams, setTimeout, clearTimeout, fetch: () => { throw new Error('Unexpected network call'); }, ...globals });
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

test('Tap BPM averages intervals and retains results through an idle reset', () => {
  let state = PortalModel.tapBpm(null, 0);
  assert.equal(state.bpm, null);
  state = PortalModel.tapBpm(state, 500);
  assert.equal(state.bpm, 120);
  state = PortalModel.tapBpm(state, 1500);
  assert.equal(state.bpm, 80);
  state = PortalModel.tapBpm(state, 3500);
  assert.equal(state.taps.length, 4, 'Exactly two seconds continues the sequence');
  state = PortalModel.tapBpm(state, 5501);
  assert.equal(state.taps.length, 1);
  assert.equal(state.bpm, 51);
  state = PortalModel.tapBpm(state, 6001);
  assert.equal(state.bpm, 120);
  assert.equal(PortalModel.tapBpm(state, 6001).bpm, 120);
  assert.equal(PortalModel.tapBpm(null, 7000).bpm, null);
});

test('Timestamps use local 24-hour time and date-only values remain dates', () => {
  const run = renderer();
  assert.equal(run("formatDate(new Date(2026, 0, 2, 3, 4, 5))"), '2026-01-02, 03:04:05');
  assert.equal(run("formatDate('2024-01-02')"), '2024-01-02');
  assert.equal(run('formatDate(null)'), '-');
});

test('Detail and editor audio are mutually exclusive, including delayed failures from replaced audio', async () => {
  const instances = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.paused = true; this.listeners = {}; instances.push(this); }
    play() { this.paused = false; return new Promise((_resolve, reject) => { this.rejectPlay = reject; }); }
    pause() { this.paused = true; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }
  const button = (container) => ({
    classList: { add() {}, remove() {} },
    setAttribute() {},
    closest: () => container
  });
  const detailButton = button({ dataset: { audioUrl: 'song-a' }, querySelector: () => null });
  const input = { value: 'song-a' };
  const previewButton = button({ querySelector: () => input });
  const run = renderer({ Audio: FakeAudio, detailButton, previewButton });
  const playing = () => instances.filter((audio) => !audio.paused);

  run('toggleDetailAudio(detailButton)');
  assert.deepEqual(playing(), [instances[0]]);
  run('togglePreviewAudio(previewButton)');
  assert.deepEqual(playing(), [instances[1]], 'Editor stops detail even for the same URL');
  run('togglePreviewAudio(previewButton)');
  assert.equal(playing().length, 0, 'Clicking the active control pauses');
  run('togglePreviewAudio(previewButton)');
  assert.deepEqual(playing(), [instances[1]], 'Paused editor resumes without another audio instance');
  input.value = 'song-b';
  run('togglePreviewAudio(previewButton)');
  instances[1].listeners.error();
  instances[1].rejectPlay(new Error('Late playback failure'));
  await Promise.resolve();
  assert.deepEqual(playing(), [instances[2]], 'Old editor callbacks cannot stop the latest audio');
  run('toggleDetailAudio(detailButton)');
  instances[0].listeners.ended();
  instances[0].rejectPlay(new Error('Late playback failure'));
  await Promise.resolve();
  assert.deepEqual(playing(), [instances[3]], 'Detail stops editor and ignores callbacks from old detail audio');
  run('stopDetailAudio(); stopPreviewAudio()');
  assert.equal(playing().length, 0);
});
