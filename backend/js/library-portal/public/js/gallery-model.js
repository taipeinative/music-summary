(function (root) {
  const modes = { albums: ['locale', 'type', 'year'], artists: ['locale', 'tag'], songs: ['genre', 'locale', 'vocal', 'year'] };
  const node = (key, label, bit = 0, children = []) => ({ key, label, bit: String(bit), children });
  const genreTree = [
    node('classical', 'Classical', 1), node('country', 'Country', 2),
    node('dance', 'Dance', 4, [
      node('bass', 'Bass', 0, [node('color-bass', 'Color Bass', 256), node('future-bass', 'Future Bass', 512), node('kawaii-bass', 'Kawaii Bass', 1024), node('melodic-bass', 'Melodic Bass', 2048)]),
      node('downtempo', 'Downtempo', 4096), node('drum-and-bass', 'Drum and Bass', 8192),
      node('dubstep', 'Dubstep', 0, [node('brostep', 'Brostep', 16384), node('chillstep', 'Chillstep', 32768), node('melodic-dubstep', 'Melodic Dubstep', 65536), node('riddim', 'Riddim', 131072)]),
      node('glitch-hop', 'Glitch Hop', 524288),
      node('hard', 'Hard', 0, [node('artcore', 'Artcore', 1048576), node('future-core', 'Future Core', 2097152), node('happy-hardcore', 'Happy Hardcore', 4194304), node('hardcore', 'Hardcore', 8388608), node('hardstyle', 'Hardstyle', 16777216), node('j-core', 'J-Core', 33554432)]),
      node('house', 'House', 0, [node('ambient-house', 'Ambient House', 67108864), node('complextro', 'Complextro', 134217728), node('electro-house', 'Electro House', 268435456), node('future-house', 'Future House', 536870912), node('progressive-house', 'Progressive House', 1073741824), node('slap-house', 'Slap House', 2147483648), node('tropical-house', 'Tropical House', 4294967296)]),
      node('lo-fi', 'Lo-fi', 17179869184), node('synthwave', 'Synthwave', 274877906944), node('trance', 'Trance', 549755813888), node('trap', 'Trap', 1099511627776)
    ]),
    node('hip-hop', 'Hip-hop', 8), node('instrumental', 'Instrumental', 16), node('jazz', 'Jazz', 8589934592), node('pop', 'Pop', 32),
    node('r-and-b', 'R&B', 64, [node('funk', 'Funk', 262144)]),
    node('rock', 'Rock', 128, [node('alternative', 'Alternative', 34359738368), node('metal', 'Metal', 68719476736), node('soft-rock', 'Soft Rock', 137438953472)])
  ];
  const genres = [];
  const mask = (item) => item.children.reduce((value, child) => value | mask(child), BigInt(item.bit));
  function flatten(items, depth = 0) {
    for (const item of items) { genres.push({ key: item.key, label: item.label, depth, mask: String(mask(item)) }); flatten(item.children, depth + 1); }
  }
  flatten(genreTree);
  const locales = [
    ['acoustic', 'Acoustic', [0]], ['austronesian', 'Austronesian', [256]], ['chinese', 'Chinese', [8192, 16384, 32768]],
    ['english', 'English', [2]], ['french', 'French', [8]], ['hakka', 'Hakka', [16]], ['hindi', 'Hindi', [32]],
    ['japanese', 'Japanese', [64]], ['korean', 'Korean', [128]], ['southern-min', 'Southern Min', [512]], ['spanish', 'Spanish', [4]],
    ['thai', 'Thai', [1024]], ['vietnamese', 'Vietnamese', [2048]], ['yue', 'Yue', [4096]], ['undefined', 'Undefined', [1]]
  ].map(([key, label, codes]) => ({ key, label, codes, depth: 0 }));
  const catalog = {
    genre: genres, locale: locales,
    tag: ['No Tag', 'AI', 'Synthesizer', 'VTuber'].map((label, i) => ({ key: String([0, 1, 2, 4][i]), label, depth: 0 })),
    type: ['Single', 'EP', 'Album', 'Compilation'].map((label, i) => ({ key: String(i), label, depth: 0 })),
    vocal: ['Acoustic', 'Female', 'Male', 'Duet', 'Unknown'].map((label, i) => ({ key: String(i), label, depth: 0 }))
  };
  function groups(groupBy, counts) {
    if (groupBy !== 'year') return catalog[groupBy].filter((group) => counts.has(group.key)).map((group) => ({ ...group, total: counts.get(group.key) }));
    return [...counts].map(([key, total]) => {
      const [kind, value] = key.split(':');
      return { key, total, label: kind === 'decade' ? `${value}s` : kind === 'year' ? value : 'Unknown', depth: kind === 'year' ? 1 : 0, year: Number(value) || 0, kind };
    }).sort((a, b) => Math.floor(b.year / 10) - Math.floor(a.year / 10) || (a.kind === 'decade' ? -1 : b.kind === 'decade' ? 1 : b.year - a.year));
  }
  const api = { modes, catalog, groups };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PortalGallery = api;
})(globalThis);
