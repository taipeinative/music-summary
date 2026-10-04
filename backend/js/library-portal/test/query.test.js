const test = require('node:test');
const assert = require('node:assert/strict');
const { compile } = require('../src/query');
const { restore, title, duration, locales, role } = require('../public/js/portal-model');

test('Locale presentation keeps primary first, separates secondary languages, and leaves data unchanged', () => {
  const values = [{ locale: 2, isPrimary: false }, { locale: 32768, isPrimary: true }, { localeValue: 64, is_primary: false }];
  assert.equal(locales(values, { 2: 'en', 32768: 'zh-hant', 64: 'ja' }), 'zh-hant; en; ja');
  assert.equal(values[0].locale, 2); assert.equal(locales([], {}), '-');
  assert.equal(role(0), 'main'); assert.equal(role(1), 'featured'); assert.equal(role('REMIX'), 'remix');
});
test('Preferences reset major versions and retain values while filling minor defaults', () => {
  assert.equal(restore('{bad').view, 'songs');
  assert.equal(restore({ version: '2.0', theme: 'red' }).theme, 'blue');
  const value = restore({ version: '1.9', theme: 'red', view: 'missing' });
  assert.equal(value.theme, 'red'); assert.equal(value.pinned, false); assert.equal(value.view, 'songs'); assert.equal(value.version, '1.0');
});
test('Multilingual selection follows the exact fallback chains', () => {
  const values = [{ locale: 'en', title: 'English' }, { locale: 'zh-hans', title: '简体' }, { locale: 'zh', title: '中文' }, { locale: 1, title: 'Original', fallback: true }];
  assert.equal(title(values, 'original'), 'Original'); assert.equal(title(values, 'chinese'), '简体'); assert.equal(title(values, 'english'), 'English');
  assert.equal(title(values.filter((v) => v.locale !== 'en'), 'english'), 'Original');
});
test('Query compiler binds values and rejects injected fields, operators and invalid input', () => {
  const q = compile('songs', { filters: [{ field: 'title', operator: 'is', value: "x'; DROP TABLE songs; --" }] });
  assert.equal(q.params.length, 1); assert.ok(!q.where.includes('DROP'));
  for (const filters of [[{ field: 'DROP', value: 1 }], [{ field: 'id', operator: 'or', value: 1 }], [{ field: 'release_date', operator: 'eq', value: '2024-02-30' }]]) assert.throws(() => compile('songs', { filters }));
  assert.throws(() => compile('artists', { sort: [{ field: 'has_member', direction: 'asc' }] }));
});
test('Duration accepts minutes:seconds and provides strict subsecond tolerance', () => {
  assert.equal(duration('3:05'), 185000); assert.throws(() => duration('3:99'));
  assert.match(compile('songs', { filters: [{ field: 'duration', operator: 'eq', value: '3:00' }] }).where, /< 1000/);
});
test('Mapping defaults and Category retain explicit Status precedence', () => {
  assert.match(compile('mappings', {}).where, /status = 1/);
  assert.match(compile('mappings', { filters: [{ field: 'category', value: 'incoming' }] }).where, /source_type = 1/);
  assert.doesNotMatch(compile('mappings', { filters: [{ field: 'category', value: 'pending' }, { field: 'status', value: '2' }] }).where, /status = 0/);
});
