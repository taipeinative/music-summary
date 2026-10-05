/* Portal owns navigation/query state; the retained editor handles domain forms. */
const portalStorageKey = 'library-portal:preferences';
const portalColors = { blue: '#2764cc', red: '#bf3e4e', orange: '#b96516', green: '#23835e', purple: '#8152be' };
let portalPreferences;
try { portalPreferences = PortalModel.restore(localStorage.getItem(portalStorageKey)); } catch { portalPreferences = PortalModel.defaults(); }
let portalResource = portalPreferences.view;
let portalRequest = 0;
let portalConnection = null;
let portalDetailRequest = 0;
const resourceTables = { albums: 'album', artists: 'artist', songs: 'song', entries: 'entry', sources: 'source' };
const resourceNames = { albums: 'Albums', artists: 'Artists', songs: 'Songs', entries: 'Entries', sources: 'Sources', mappings: 'Mapping', 'entry-groups': 'Mapping', issues: 'Issues', history: 'History', gallery: 'Gallery', settings: 'Settings' };
const navIcons = {
  gallery: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  albums: '<rect x="3" y="3" width="17" height="18" rx="2"/><circle cx="13" cy="12" r="5"/><circle cx="13" cy="12" r="1"/><path d="M6 3v18"/>',
  artists: '<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  songs: '<path d="M15 3v14M15 3l5 4"/><ellipse cx="11" cy="18" rx="4" ry="3"/>',
  entries: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7" cy="7" r="1"/>',
  sources: '<rect x="2" y="4" width="5" height="16"/><rect x="8" y="3" width="5" height="17"/><path d="m15 5 5-1 3 15-5 1Z"/>',
  mappings: '<path d="M8 8l8 8M8 16l8-8"/><path d="M2 2h6v6H2zM16 2h6v6h-6zM2 16h6v6H2zM16 16h6v6h-6z"/>',
  issues: '<path d="m12 3 10 18H2Z M12 9v5M12 17v1"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  logout: '<path d="M9 3H3v18h6M8 12h13m-5-5 5 5-5 5"/>'
};
function portalSave() {
  portalPreferences.tableWidths = state.table.columnWidths;
  portalPreferences.historyWidths = state.changelog.columnWidths;
  try { localStorage.setItem(portalStorageKey, JSON.stringify(portalPreferences)); } catch { $('portal-error').textContent = 'Browser storage is unavailable; preferences cannot be saved.'; }
}
function portalView(resource = portalResource) {
  const saved = portalPreferences.views[resource];
  const value = { page: 1, pageSize: 100, search: '', filters: [], sort: [], includeResolved: false, includeConfirmed: false, ...(saved && typeof saved === 'object' ? saved : {}) };
  if (!Number.isInteger(value.page) || value.page < 1) value.page = 1;
  if (!Number.isInteger(value.pageSize) || value.pageSize < 1 || value.pageSize > 500) value.pageSize = 100;
  if (!Array.isArray(value.filters)) value.filters = [];
  if (!Array.isArray(value.sort)) value.sort = [];
  return value;
}
function portalTheme() {
  const color = portalColors[portalPreferences.theme];
  document.documentElement.style.setProperty('--primary', color);
  document.documentElement.style.setProperty('--primary-dark', color);
  document.documentElement.style.setProperty('--primary-light', color);
  $('app-view').classList.toggle('nav-expanded', portalPreferences.pinned);
}
function portalClearSelection() {
  portalReturnToList(false);
  portalDetailRequest++;
  stopDetailAudio();
  state.selectedKey = null;
  state.selectedGroups.clear(); state.selectedIssues.clear(); state.selectedMappings.clear();
  state.groupSelectionAnchorIndex = state.issueSelectionAnchorIndex = state.selectionAnchorIndex = null;
  $('detail-content').innerHTML = '<p class="meta empty-detail">Select a row to view details</p>';
}
function portalError(error) { $('portal-error').textContent = error.message; }
const originalFetchJson = LibraryManagerApi.fetchJson.bind(LibraryManagerApi);
function portalUrl(input) {
  const url = new URL(input, location.origin);
  if (!url.pathname.startsWith('/api/v1/')) {
    url.pathname = url.pathname.replace(/\/api\/tables\/(album|artist|song|entry|source)(?=\/|$)/, (_, key) => '/api/' + Object.keys(resourceTables).find((r) => resourceTables[r] === key))
      .replace('/api/groups', '/api/entry-groups').replace('/api/changelog', '/api/history').replace('/api/', '/api/v1/');
  }
  url.searchParams.set('language', portalPreferences.language);
  return url.pathname + url.search;
}
function portalModal(title, body, actions, { showClose = true } = {}) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay hidden'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', title);
  modal.innerHTML = `<section class="modal-card group-filter-card"><header class="modal-header"><h2>${escapeHtml(title)}</h2>${showClose ? '<button type="button" data-close aria-label="Close">×</button>' : ''}</header>${body}<footer class="modal-actions">${actions}</footer></section>`;
  document.body.append(modal);
  const closeButton = modal.querySelector('[data-close]');
  if (closeButton) closeButton.onclick = () => { closeModalUi(modal); modal.remove(); };
  openModalUi(modal);
  return modal;
}
async function portalAudit(reason = '') {
  return new Promise((resolve, reject) => {
    const modal = portalModal('Record this change', `<div class="portal-filter-body portal-audit"><label>Operator<input data-actor value="${escapeHtml(portalConnection?.user || '')}" required></label><label>Reason<input data-reason value="${escapeHtml(reason)}" required></label><p data-error role="alert"></p></div>`, '<button type="button" data-cancel class="secondary-btn">Cancel</button><button type="button" data-confirm class="primary-btn">Save change</button>');
    const cancel = () => { closeModalUi(modal); modal.remove(); reject(new Error('Change cancelled.')); };
    modal.querySelector('[data-close]').onclick = cancel;
    modal.querySelector('[data-cancel]').onclick = cancel;
    modal.querySelector('[data-confirm]').onclick = () => {
      const changedBy = modal.querySelector('[data-actor]').value.trim(); const text = modal.querySelector('[data-reason]').value.trim();
      if (!changedBy || !text) { modal.querySelector('[data-error]').textContent = 'Operator and reason are required.'; return; }
      closeModalUi(modal); modal.remove(); resolve({ changedBy, reason: text });
    };
    modal.querySelector('[data-reason]').focus();
  });
}
LibraryManagerApi.fetchJson = async function (url, options = {}) {
  const target = portalUrl(url);
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method) && !/\/api\/v1\/(login|logout)\?/.test(target)) {
    const body = JSON.parse(options.body || '{}');
    const preview = options.method === 'POST' && /^\/api\/v1\/artists\/\d+\/merge\?/.test(target) && body.dryRun === true;
    if (!preview) Object.assign(body, portalPreferences.autoEditMetadata
      ? PortalModel.editMetadata(options.method, new URL(target, location.origin).pathname, body, portalConnection?.user)
      : await portalAudit(body.reason || ''));
    options = { ...options, body: JSON.stringify(body) };
  }
  return originalFetchJson(target, options);
};

// Capture before document/background listeners; only the top modal may receive input.
const portalModalStack = [];
const previousOpenModal = openModalUi;
const previousCloseModal = closeModalUi;
openModalUi = function (modal) {
  portalModalStack.push({ modal, focus: document.activeElement });
  for (const entry of portalModalStack.slice(0, -1)) entry.modal.inert = true;
  previousOpenModal(modal); modal.inert = false;
};
closeModalUi = function (modal) {
  portalCloseFlags();
  const index = portalModalStack.findIndex((entry) => entry.modal === modal);
  const [entry] = index < 0 ? [] : portalModalStack.splice(index, 1);
  previousCloseModal(modal);
  const top = portalModalStack.at(-1)?.modal;
  if (top) top.inert = false;
  entry?.focus?.focus();
};
for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'keydown', 'wheel', 'contextmenu']) window.addEventListener(type, (event) => {
  const top = portalModalStack.at(-1)?.modal;
  if (!top) return;
  const card = top.querySelector('.modal-card') || top;
  if (!card.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  else if (type === 'keydown' && event.key === 'Tab') {
    const elements = [...card.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter((e) => e.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}, { capture: true, passive: false });

// The top layer avoids clipping without moving checkboxes out of their form.
let portalOpenFlags = null;
function portalCloseFlags() {
  if (!portalOpenFlags) return;
  const dropdown = portalOpenFlags;
  portalOpenFlags = null;
  dropdown.querySelector('.preview-flag-menu')?.hidePopover();
  dropdown.open = false;
}
function portalPositionFlags() {
  if (!portalOpenFlags?.isConnected) return;
  const menu = portalOpenFlags.querySelector('.preview-flag-menu');
  const rect = portalOpenFlags.querySelector('summary').getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const height = Math.min(260, Math.max(below, above));
  const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
  Object.assign(menu.style, { width: `${width}px`, maxHeight: `${height}px`, left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`, top: `${below >= Math.min(260, menu.scrollHeight) || below >= above ? rect.bottom + 4 : Math.max(12, rect.top - Math.min(height, menu.scrollHeight) - 4)}px` });
}
document.addEventListener('toggle', (event) => {
  const dropdown = event.target;
  if (!dropdown.matches?.('details.preview-flag-dropdown')) return;
  const menu = dropdown.querySelector('.preview-flag-menu');
  menu.setAttribute('popover', 'manual');
  if (!dropdown.open) { menu.hidePopover(); if (portalOpenFlags === dropdown) portalOpenFlags = null; return; }
  if (portalOpenFlags && portalOpenFlags !== dropdown) portalCloseFlags();
  portalOpenFlags = dropdown;
  menu.showPopover(); portalPositionFlags();
}, true);
document.addEventListener('click', (event) => { if (portalOpenFlags && !portalOpenFlags.contains(event.target)) portalCloseFlags(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') portalCloseFlags(); });
document.addEventListener('change', (event) => {
  const input = event.target;
  const dropdown = input.closest('.preview-flag-dropdown');
  if (!dropdown || input.type !== 'checkbox') return;
  const options = [...dropdown.querySelectorAll('input[type="checkbox"]')];
  if (input.checked) options.filter((other) => input.value === '0' ? other !== input : other.value === '0').forEach((other) => { other.checked = false; });
  if (!options.some((other) => other.checked)) { const zero = options.find((other) => other.value === '0'); if (zero) zero.checked = true; }
}, true);
document.addEventListener('scroll', portalPositionFlags, true);
window.addEventListener('resize', portalPositionFlags);

showApp = function (connection) {
  portalConnection = connection;
  $('login-view').classList.add('hidden'); $('app-view').classList.remove('hidden');
  document.querySelector('.brand h2').textContent = 'Library Portal';
  portalTheme();
};
loadSettings = async function () {
  state.table.columnWidths = portalPreferences.tableWidths;
  state.changelog.columnWidths = { ...state.changelog.columnWidths, ...portalPreferences.historyWidths };
};
saveTableColumnWidths = async function () { portalSave(); };
saveChangelogColumnWidths = async function () { portalSave(); };
pickDisplayTitle = (titles, fallback = '') => PortalModel.title(titles, portalPreferences.language, fallback);
loadSummary = async function () { state.summary = await fetchJson('/api/v1/summary'); renderSidebar(); };
saveLastView = portalSave;
selectLastViewOrDefault = () => portalNavigate(portalPreferences.view);
selectTableView = (key) => portalNavigate(Object.keys(resourceTables).find((r) => resourceTables[r] === key) || 'songs');
selectGroupView = () => portalNavigate('entry-groups');
selectMappingView = () => portalNavigate('mappings');
selectIssueView = () => portalNavigate('issues');
selectChangelogView = () => portalNavigate('history');
refreshCurrentView = () => portalNavigate(portalResource);

async function portalOpenRecord(resource, id) {
  const request = portalRequest;
  const prefs = { ...portalView(resource), filters: [], sort: [], search: '' };
  const locate = await fetchJson(`/api/v1/${resource}/locate/${encodeURIComponent(id)}?pageSize=${prefs.pageSize}`);
  if (request !== portalRequest) return;
  await portalNavigate(resource, { ...prefs, page: locate.page || 1 });
  if (portalResource !== resource) return;
  document.querySelector(`.changelog-row[data-id="${CSS.escape(String(id))}"]`)?.classList.add('active');
  await showTableDetail(resourceTables[resource], id);
}
openArtistTableRow = (id) => portalOpenRecord('artists', id);
openAlbumTableRow = (id) => portalOpenRecord('albums', id);
openSongTableRow = (id) => portalOpenRecord('songs', id);
openEntryTableRow = (id) => portalOpenRecord('entries', id);
openEntryGroupRow = async function (id) {
  await portalNavigate('entry-groups', { ...portalView('entry-groups'), page: 1, search: '', filters: [{ field: 'id', operator: 'eq', value: String(id) }], sort: [], includeConfirmed: true });
  if (portalResource === 'entry-groups' && state.rows[0]) showEntryGroupDetail(state.rows[0]);
};

renderSidebar = function () {
  const resource = portalResource;
  const item = (key, label, count = null) => `<button type="button" class="nav-item${(key === resource || (key === 'mappings' && resource === 'entry-groups')) ? ' active' : ''}" data-resource="${key}" aria-label="${label}" title="${label}"><span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${navIcons[key]}</svg></span><span class="nav-label">${label}</span>${count === null ? '' : `<span class="nav-count">${count}</span>`}</button>`;
  $('sidebar-nav').innerHTML = '<hr class="nav-divider">' + ['albums', 'artists', 'songs', 'entries', 'sources', 'mappings', 'issues', 'history'].map((key) => `${key === 'mappings' ? '<hr class="nav-divider">' : ''}${item(key, ({ albums: 'Album', artists: 'Artist', songs: 'Song', entries: 'Entry', sources: 'Source', mappings: 'Mapping', issues: 'Issue', history: 'History' })[key], state.summary?.[key === 'mappings' ? portalPreferences.mappingMode : key] || 0)}`).join('') + `<div class="nav-bottom">${item('gallery', 'Gallery')}${item('settings', 'Settings')}${item('logout', 'Logout')}</div>`;
  $('sidebar-nav').querySelectorAll('[data-resource]').forEach((button) => button.onclick = async () => {
    try {
      portalSetMobileMenu(false, false);
      if (button.dataset.resource === 'logout') {
        portalRequest++; portalSave();
        await fetchJson('/api/logout', { method: 'POST', body: JSON.stringify({ forget: true }) });
        portalClearSelection(); showLogin(''); return;
      }
      await portalNavigate(button.dataset.resource === 'mappings' ? portalPreferences.mappingMode : button.dataset.resource);
    } catch (error) { portalError(error); }
  });
};
function portalPagination(payload) {
  const start = payload.total ? (payload.page - 1) * payload.pageSize + 1 : 0;
  const end = Math.min(payload.page * payload.pageSize, payload.total);
  const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
  $('portal-pagination').innerHTML = `<button aria-label="First" title="First" data-page="1" ${payload.page <= 1 ? 'disabled' : ''}>${icon('M6 5v14M17 5l-7 7 7 7')}</button><button aria-label="Previous" title="Previous" data-page="${payload.page - 1}" ${payload.page <= 1 ? 'disabled' : ''}>${icon('M15 5l-7 7 7 7')}</button><span class="portal-page-summary">Page ${payload.total ? payload.page : 0} of ${payload.pageCount} <span class="portal-page-range">(${start}-${end} of ${payload.total})</span></span><button aria-label="Next" title="Next" data-page="${payload.page + 1}" ${payload.page >= payload.pageCount ? 'disabled' : ''}>${icon('M9 5l7 7-7 7')}</button><button aria-label="Last" title="Last" data-page="${payload.pageCount}" ${payload.page >= payload.pageCount ? 'disabled' : ''}>${icon('M18 5v14M7 5l7 7-7 7')}</button>`;
  $('portal-pagination').querySelectorAll('button').forEach((button) => button.onclick = () => portalNavigate(portalResource, { ...portalView(), page: Number(button.dataset.page) }).catch(portalError));
}
renderPagination = () => {};
async function portalNavigate(resource, candidate = null) {
  portalSetMobileMenu(false, false);
  clearTimeout(portalSearchTimer);
  if (!resourceNames[resource]) resource = 'songs';
  const request = ++portalRequest;
  const prefs = candidate || portalView(resource);
  portalResource = resource;
  $('portal-error').textContent = '';
  portalClearSelection();
  $('portal-title').textContent = resourceNames[resource];
  const settings = resource === 'settings';
  const gallery = resource === 'gallery';
  $('results').classList.toggle('gallery-view', gallery);
  $('results').classList.toggle('table-view', Boolean(resourceTables[resource]) || resource === 'history');
  for (const id of ['portal-query', 'portal-pagination', 'portal-reload']) $(id).classList.toggle('hidden', settings);
  $('portal-pagination').classList.toggle('hidden', settings || gallery);
  $('portal-filter').classList.toggle('hidden', gallery);
  $('gallery-grouping').classList.toggle('hidden', !gallery);
  $('gallery-mode-switch').classList.toggle('hidden', !gallery);
  const mapping = ['entry-groups', 'mappings'].includes(resource);
  $('mode-switch').classList.toggle('hidden', !mapping);
  $('mode-switch').querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.mode === resource));
  $('artist-action').append($('add-artist-btn'));
  $('add-artist-btn').classList.toggle('hidden', resource !== 'artists');
  if (settings) {
    state.currentView = { type: 'settings', key: 'settings', label: 'Settings' };
    portalPreferences.view = resource; portalSave(); renderSidebar(); portalSettings(); return;
  }
  $('portal-search').value = prefs.search;
  if (gallery) return portalLoadGallery(prefs, request);
  if (!candidate) $('results').innerHTML = '<p class="meta">Loading…</p>';
  const params = new URLSearchParams({ page: prefs.page, pageSize: prefs.pageSize, search: prefs.search, filters: JSON.stringify(prefs.filters), sort: JSON.stringify(prefs.sort), includeConfirmed: prefs.includeConfirmed, includeResolved: prefs.includeResolved });
  let payload;
  try { payload = await fetchJson(`/api/v1/${resource}?${params}`); }
  catch (error) {
    if (request === portalRequest) {
      $('portal-search').value = portalView(resource).search;
      if (!candidate) $('results').innerHTML = '<div class="empty-state">Unable to load results. Use Reload to try again.</div>';
    }
    throw error;
  }
  if (request !== portalRequest) return;
  portalPreferences.view = resource;
  portalPreferences.views[resource] = { ...prefs, page: payload.page };
  if (mapping) portalPreferences.mappingMode = resource;
  const table = resourceTables[resource];
  const type = table ? 'table' : ({ mappings: 'mapping', 'entry-groups': 'group', issues: 'issue', history: 'changelog' })[resource];
  state.currentView = { type, key: table || (type === 'mapping' ? 'existing' : type === 'group' ? 'all' : type === 'issue' ? '' : 'changelog'), label: resourceNames[resource] };
  state.rows = payload.rows;
  state.summary[resource] = payload.resourceTotal;
  if (type !== 'issue') Object.assign(state[type], { page: payload.page, pageSize: payload.pageSize, total: payload.total, pageCount: payload.pageCount, ...(table ? { key: table, columns: payload.columns } : {}) });
  renderRows(); portalPagination(payload); renderSidebar(); portalSave();
  $('portal-filter').classList.toggle('is-active', Boolean(prefs.filters.length || prefs.sort.length || prefs.includeConfirmed || prefs.includeResolved));
}
function portalSettings() {
  $('results').innerHTML = `<section class="portal-settings"><div class="portal-theme-setting"><span>Theme color</span><div class="portal-theme-colors" role="group" aria-label="Theme color">${Object.entries(portalColors).map(([name, color]) => `<button type="button" data-theme="${name}" style="--swatch: ${color}" aria-label="${name[0].toUpperCase() + name.slice(1)}" aria-pressed="${name === portalPreferences.theme}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg></button>`).join('')}</div></div><label>Keep navigation expanded<input id="portal-pinned" type="checkbox" ${portalPreferences.pinned ? 'checked' : ''}></label><label>Multilingual fields<select id="portal-language">${[['original', 'Original'], ['english', 'English'], ['chinese', '中文']].map(([value, label]) => `<option value="${value}" ${value === portalPreferences.language ? 'selected' : ''}>${label}</option>`).join('')}</select></label></section>`;
  $('results').querySelector('.portal-settings').insertAdjacentHTML('beforeend', `<label>Auto complete edit metadata<input id="portal-auto-edit-metadata" type="checkbox" ${portalPreferences.autoEditMetadata ? 'checked' : ''}></label>`);
  document.querySelectorAll('[data-theme]').forEach((button) => { button.onclick = () => {
    portalPreferences.theme = button.dataset.theme;
    document.querySelectorAll('[data-theme]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    portalTheme(); portalSave();
  }; });
  for (const [id, key] of [['portal-pinned', 'pinned'], ['portal-language', 'language'], ['portal-auto-edit-metadata', 'autoEditMetadata']]) $(id).onchange = () => { portalPreferences[key] = $(id).type === 'checkbox' ? $(id).checked : $(id).value; portalTheme(); portalSave(); };
}
const originalShowTableDetail = showTableDetail;
showTableDetail = async function (table, id) {
  portalShowDetailPane(true);
  const request = portalDetailRequest + 1;
  try {
    if (table !== 'source') return await originalShowTableDetail(table, id);
    portalDetailRequest++;
    const detail = await fetchJson(`/api/v1/sources/${encodeURIComponent(id)}`);
    if (request !== portalDetailRequest) return;
    $('detail-content').innerHTML = `<h2>Source</h2>${renderSingleItem('Source ID', detail.source_id)}${renderSingleItem('Export Date', formatDate(detail.export_date))}${renderSingleItem('Import Date', formatDate(detail.import_date))}${renderSingleItem('Imported entries', detail.imported_count)}`;
  } catch (error) {
    if (request === portalDetailRequest) $('detail-content').innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`;
  }
};

function portalRuleHtml(rule, index, sorting) {
  const catalog = PortalModel.fields[portalResource].filter((f) => !sorting || f.type !== 'relation');
  const field = catalog.find((f) => f.key === rule.field) || catalog[0];
  const options = PortalEnums[field.options] || {};
  let control;
  if (sorting) control = `<select data-direction>${renderEnumOptions({ asc: 'Ascending', desc: 'Descending' }, rule.direction || 'asc')}</select><button data-up aria-label="Move sort up">↑</button><button data-down aria-label="Move sort down">↓</button>`;
  else if (field.type === 'flag') control = renderFlagDropdown(options, rule.value || '0', 'data-filter-flags');
  else if (field.type === 'enum') control = `<select data-value>${renderEnumOptions(options, rule.value ?? Object.keys(options)[0])}</select>`;
  else if (field.type === 'relation') control = `<select data-value>${renderEnumOptions({ true: 'Yes', false: 'No' }, rule.value ?? 'true')}</select>`;
  else {
    const operators = field.type === 'text' ? { is: 'is', isNot: 'is not', contains: 'contains', notContains: 'not contains', matches: 'matches' } : { gt: '>', gte: '≥', eq: '=', ne: '≠', lte: '≤', lt: '<' };
    control = `<select data-operator>${renderEnumOptions(operators, rule.operator || (field.type === 'text' ? 'contains' : 'eq'))}</select><input data-value type="${field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}" value="${escapeHtml(rule.value ?? '')}" ${field.type === 'duration' ? 'placeholder="3:05"' : ''}>`;
  }
  return `<div class="portal-rule" data-index="${index}"><select data-field>${catalog.map((f) => `<option value="${f.key}" ${f.key === field.key ? 'selected' : ''}>${f.label}</option>`).join('')}</select>${control}<button data-remove aria-label="Remove condition">×</button></div>`;
}
function portalFilter() {
  const prefs = portalView();
  const modal = portalModal('Filter and sort', '<div class="portal-filter-body"><h3>Filters<button data-add-filter class="secondary-btn">Add filter</button></h3><div data-filters></div><h3>Sort order<button data-add-sort class="secondary-btn">Add sort</button></h3><div data-sorts></div><label data-extra-label></label><p data-error role="alert" class="form-message"></p></div>', '<button type="button" data-cancel class="secondary-btn">Cancel</button><button type="button" data-apply class="primary-btn">Apply</button>', { showClose: false });
  const read = (sorting) => [...modal.querySelector(sorting ? '[data-sorts]' : '[data-filters]').children].map((row) => {
    const field = row.querySelector('[data-field]').value;
    if (sorting) return { field, direction: row.querySelector('[data-direction]').value };
    const flags = row.querySelector('[data-filter-flags]');
    const value = flags ? [...flags.querySelectorAll('input:checked')].reduce((a, input) => a | BigInt(input.value), 0n).toString() : row.querySelector('[data-value]').value;
    return { field, operator: row.querySelector('[data-operator]')?.value || 'eq', value };
  });
  const render = (rules, sorting) => {
    const list = modal.querySelector(sorting ? '[data-sorts]' : '[data-filters]');
    list.innerHTML = rules.map((rule, i) => portalRuleHtml(rule, i, sorting)).join('');
    list.querySelectorAll('[data-field]').forEach((select) => select.onchange = () => { const next = read(sorting); next[[...list.children].indexOf(select.parentElement)] = { field: select.value }; render(next, sorting); });
    list.querySelectorAll('[data-remove]').forEach((button) => button.onclick = () => button.parentElement.remove());
    list.querySelectorAll('[data-up],[data-down]').forEach((button) => button.onclick = () => { const row = button.parentElement; if (button.hasAttribute('data-up') && row.previousElementSibling) row.previousElementSibling.before(row); else if (button.hasAttribute('data-down') && row.nextElementSibling) row.nextElementSibling.after(row); });
    list.querySelectorAll('[data-filter-flags] input').forEach((input) => input.onchange = () => { const dropdown = input.closest('[data-filter-flags]'); const value = [...dropdown.querySelectorAll('input:checked')].reduce((a, i) => a | BigInt(i.value), 0n); dropdown.querySelector('[data-flag-summary]').textContent = getFlagSummary(PortalEnums[PortalModel.fields[portalResource].find((f) => f.key === input.closest('.portal-rule').querySelector('[data-field]').value).options], value); });
  };
  render(prefs.filters, false); render(prefs.sort, true);
  modal.querySelector('[data-cancel]').onclick = () => { closeModalUi(modal); modal.remove(); };
  modal.querySelector('[data-add-filter]').onclick = () => render([...read(false), { field: PortalModel.fields[portalResource][0].key }], false);
  modal.querySelector('[data-add-sort]').onclick = () => render([...read(true), { field: PortalModel.fields[portalResource][0].key }], true);
  const extra = portalResource === 'issues' ? 'includeResolved' : portalResource === 'entry-groups' ? 'includeConfirmed' : null;
  if (extra) modal.querySelector('[data-extra-label]').innerHTML = `<input type="checkbox" data-extra ${prefs[extra] ? 'checked' : ''}> ${extra === 'includeResolved' ? 'Show resolved issues' : 'Show confirmed groups'}`;
  modal.querySelector('[data-apply]').onclick = async () => {
    const button = modal.querySelector('[data-apply]'); button.disabled = true;
    try {
      const candidate = { ...prefs, filters: read(false), sort: read(true), page: 1 };
      if (extra) candidate[extra] = modal.querySelector('[data-extra]').checked;
      await portalNavigate(portalResource, candidate);
      closeModalUi(modal); modal.remove();
    } catch (error) { modal.querySelector('[data-error]').textContent = error.message; }
    finally { button.disabled = false; }
  };
  modal.querySelector('[data-add-filter]').focus();
}
$('portal-filter').onclick = portalFilter;
$('portal-reload').onclick = () => portalNavigate(portalResource).catch(portalError);
$('mode-switch').querySelectorAll('button').forEach((button) => button.onclick = () => portalNavigate(button.dataset.mode).catch(portalError));
let portalSearchTimer;
$('portal-search').oninput = () => {
  clearTimeout(portalSearchTimer); portalRequest++;
  const resource = portalResource; const search = $('portal-search').value;
  portalSearchTimer = setTimeout(() => { if (resource === portalResource) portalNavigate(resource, { ...portalView(resource), search, page: 1 }).catch(portalError); }, 300);
};
const sidebar = document.querySelector('.sidebar');
sidebar.addEventListener('pointerenter', () => { if (!portalNarrowScreen.matches && !modalOpenCount) $('app-view').classList.add('nav-expanded'); });
sidebar.addEventListener('pointerleave', () => { if (!modalOpenCount && !portalPreferences.pinned && !sidebar.contains(document.activeElement)) $('app-view').classList.remove('nav-expanded'); });
sidebar.addEventListener('focusin', () => { if (!portalNarrowScreen.matches && !modalOpenCount) $('app-view').classList.add('nav-expanded'); });
sidebar.addEventListener('focusout', () => queueMicrotask(() => { if (!modalOpenCount && !portalPreferences.pinned && !sidebar.contains(document.activeElement) && !sidebar.matches(':hover')) $('app-view').classList.remove('nav-expanded'); }));
portalTheme();
portalInitializeResponsive();
initialize();
