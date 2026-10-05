const test = require('node:test');
const assert = require('node:assert/strict');
const Gallery = require('../public/js/gallery-model');

test('Gallery keeps the requested taxonomy, hierarchy and high genre bits', () => {
  const bits = 256n | 1099511627776n;
  const counts = new Map(Gallery.catalog.genre.filter((g) => (BigInt(g.mask) & bits) !== 0n).map((g) => [g.key, 1]));
  const groups = Gallery.groups('genre', counts);
  assert.deepEqual(groups.map((g) => g.label), ['Dance', 'Bass', 'Color Bass', 'Trap']);
  assert.deepEqual(groups.map((g) => g.depth), [0, 1, 2, 1]);
  assert.deepEqual(Gallery.catalog.locale.find((g) => g.key === 'chinese').codes, [8192, 16384, 32768]);
  assert.deepEqual(Gallery.groups('tag', new Map([['4', 1], ['0', 2], ['1', 1]])).map((g) => g.label), ['No Tag', 'AI', 'VTuber']);
});
test('Gallery years include all actual years, newest decades first, with missing dates last', () => {
  const counts = new Map(['unknown', 'year:2019', 'decade:2010', 'year:2023', 'year:2026', 'decade:2020'].map((key) => [key, 1]));
  assert.deepEqual(Gallery.groups('year', counts).map((g) => g.label), ['2020s', '2026', '2023', '2010s', '2019', 'Unknown']);
});
