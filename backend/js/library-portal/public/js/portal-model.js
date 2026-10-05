(function (root) {
  const field = (key, label, type = 'text', options = null) => ({ key, label, type, options });
  const F = field;
  const fields = {
    albums: [F('id', 'ID', 'number'), F('title', 'Title'), F('artists', 'Artists'), F('album_type', 'Album Type', 'enum', 'album_type'), F('track_count', 'Track Count', 'number'), F('disc_count', 'Disc Count', 'number'), F('release_date', 'Release Date', 'date')],
    artists: [F('id', 'ID', 'number'), F('title', 'Title'), F('alias', 'Alias'), F('artist_tag', 'Artist Tag', 'flag', 'artist_tag'), F('has_member', 'Has Member', 'relation'), F('is_member', 'Is Member of', 'relation')],
    songs: [F('id', 'ID', 'number'), F('title', 'Title'), F('artists', 'Artists'), F('album', 'Album'), F('vocal', 'Vocal', 'enum', 'vocal'), F('locale', 'Locale', 'flag', 'locale'), F('genre_tag', 'Genre Tag', 'flag', 'genre_tag'), F('genre_info', 'Genre Info', 'enum', 'genre_info'), F('media_tag', 'Media Tag', 'flag', 'media_tag'), F('duration', 'Duration', 'duration'), F('release_date', 'Release Date', 'date')],
    entries: [F('id', 'Entry ID', 'number'), F('source_id', 'Source ID', 'number'), F('source_item_id', 'Source Item ID', 'number'), F('entry_group_id', 'Entry Group ID', 'number'), F('song_id', 'Song ID', 'number'), F('title', 'Title'), F('artist', 'Artist'), F('album', 'Album'), F('source_type', 'Source Type', 'enum', 'source_type'), F('status', 'Mapping status', 'enum', 'mappingStatus'), F('issue_type', 'Issue Type', 'enum', 'issue')],
    sources: [F('id', 'ID', 'number'), F('export_date', 'Export Date', 'date'), F('import_date', 'Import Date', 'date')],
    mappings: [F('entry_id', 'Entry ID', 'number'), F('song_id', 'Song ID', 'number'), F('status', 'Status', 'enum', 'status'), F('match_method', 'Method', 'enum', 'method'), F('category', 'Category', 'enum', 'category')],
    'entry-groups': [F('id', 'ID', 'number'), F('title', 'Title'), F('artist', 'Artist'), F('album', 'Album'), F('release_date', 'Release date', 'date')],
    issues: [F('id', 'ID', 'number'), F('issue_type', 'Issue Type', 'enum', 'issue')],
    history: [F('id', 'ID', 'number'), F('table_name', 'Table'), F('operation', 'Operation'), F('changed_at', 'Date', 'date')]
  };
  const defaults = () => ({ version: '1.2', view: 'songs', mappingMode: 'entry-groups', theme: 'blue', language: 'original', pinned: false, autoEditMetadata: false, views: {}, tableWidths: {}, historyWidths: {} });
  function restore(raw) {
    const base = defaults();
    try {
      const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!saved || !/^1\.\d+$/.test(saved.version)) return base;
      const value = { ...base, ...saved, version: base.version };
      if (!fields[value.view] && !['settings', 'gallery'].includes(value.view)) value.view = 'songs';
      if (!['entry-groups', 'mappings'].includes(value.mappingMode)) value.mappingMode = 'entry-groups';
      if (!['original', 'english', 'chinese'].includes(value.language)) value.language = 'original';
      if (!['blue', 'red', 'orange', 'green', 'purple'].includes(value.theme)) value.theme = 'blue';
      value.autoEditMetadata = value.autoEditMetadata === true;
      for (const key of ['views', 'tableWidths', 'historyWidths']) if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key])) value[key] = {};
      return value;
    } catch { return base; }
  }
  function duration(value) {
    if (!/^\d+:[0-5]\d$/.test(String(value))) throw new Error('Duration must use minutes:seconds, for example 3:05.');
    const [minutes, seconds] = value.split(':').map(Number);
    const result = (minutes * 60 + seconds) * 1000;
    if (!Number.isSafeInteger(result)) throw new Error('Duration is too large.');
    return result;
  }
  function title(titles, language, fallback = '') {
    const values = (titles || []).filter((t) => t.title);
    const codes = language === 'english' ? [2] : language === 'chinese' ? [32768, 16384, 8192] : [];
    for (const code of codes) {
      const found = values.find((t) => {
        const value = t.localeValue ?? t.locale;
        return Number(value) === code || ({ en: 2, 'zh-hant': 32768, 'zh-hans': 16384, zh: 8192 })[String(value).toLowerCase()] === code;
      });
      if (found) return found.title;
    }
    return values.find((t) => t.fallback)?.title || fallback;
  }
  function locales(rows, labels) {
    return [...(rows || [])].sort((a, b) => Number(Boolean(b.isPrimary ?? b.is_primary)) - Number(Boolean(a.isPrimary ?? a.is_primary)))
      .map((row) => labels[row.localeValue ?? row.locale] || row.localeLabel || row.locale).join('; ') || '-';
  }
  function role(value) {
    return ({ 0: 'main', 1: 'featured', 2: 'remix', MAIN: 'main', FEAT: 'featured', REMIX: 'remix' })[value] || String(value ?? '-');
  }
  function editMetadata(method, pathname, body, user) {
    const changedBy = String(user || '').trim();
    if (!changedBy) throw new Error('Operator is unavailable. Please sign in again.');
    const routes = [
      ['POST', /^\/api\/v1\/artists$/, 'artist create'],
      ['POST', /^\/api\/v1\/artists\/\d+\/merge$/, 'artist merge'],
      ['PATCH', /^\/api\/v1\/(albums|artists|songs|entries)\/\d+$/, 'table edit'],
      ['PUT', /^\/api\/v1\/entry-groups\/\d+\/entries$/, 'entry group membership update'],
      ['PATCH', /^\/api\/v1\/mappings\/\d+\/\d+\/status$/, 'status update'],
      ['PATCH', /^\/api\/v1\/mappings\/status$/, 'batch status update'],
      ['PATCH', /^\/api\/v1\/entry-groups\/\d+\/status$/, 'entry group status update'],
      ['PATCH', /^\/api\/v1\/entry-groups\/status$/, 'batch entry group status update'],
      ['PATCH', /^\/api\/v1\/issues\/\d+\/resolve$/, 'issue resolve'],
      ['PATCH', /^\/api\/v1\/issues\/resolve$/, 'batch issue resolve']
    ];
    const action = routes.find(([verb, pattern]) => verb === method && pattern.test(pathname))?.[2];
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason && !action) throw new Error('Automatic edit metadata is unavailable for this operation.');
    return { changedBy, reason: reason || `library-manager ${action}` };
  }
  function tapBpm(state, now) {
    const previous = state?.taps || [];
    const bpm = state?.bpm ?? null;
    if (!Number.isFinite(now)) throw new Error('Invalid tap time.');
    if (previous.length && now <= previous.at(-1)) return { taps: previous, bpm };
    const taps = previous.length && now - previous.at(-1) <= 2000 ? [...previous, now] : [now];
    // The sum of successive intervals equals the elapsed time since the first tap.
    return { taps, bpm: taps.length < 2 ? bpm : Math.round(60000 * (taps.length - 1) / (now - taps[0])) };
  }
  const api = { fields, defaults, restore, duration, title, locales, role, tapBpm, editMetadata };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PortalModel = api;
})(globalThis);
