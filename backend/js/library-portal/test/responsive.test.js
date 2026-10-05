const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function responsive(narrow = true) {
  const elements = {};
  const document = { activeElement: null, querySelector: () => elements.content };
  function element(id) {
    const classes = new Set();
    return elements[id] = {
      attributes: {}, inert: false, isConnected: true, scrollTop: 0, scrollLeft: 0,
      classList: { contains: (key) => classes.has(key), add: (key) => classes.add(key), remove: (key) => classes.delete(key), toggle: (key, on) => on ? classes.add(key) : classes.delete(key) },
      setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; },
      focus() { document.activeElement = this; }, contains(target) { return target === this; },
      querySelector: () => null, querySelectorAll: () => []
    };
  }
  for (const id of ['app-view', 'content', 'portal-mobile-bar', 'portal-sidebar', 'portal-menu-toggle', 'portal-menu-close', 'portal-menu-backdrop', 'portal-detail-back', 'detail-panel', 'detail-content', 'results', 'table', 'row']) element(id);
  elements.results.querySelectorAll = () => [elements.table];
  elements['portal-detail-back'].querySelector = () => element('back-label');
  const media = { matches: narrow, addEventListener(_event, callback) { this.change = callback; } };
  const context = vm.createContext({ document, window: { matchMedia: () => media, addEventListener() {} }, $: (id) => elements[id], modalOpenCount: 0, portalDetailRequest: 0, resourceNames: { songs: 'Songs' }, portalResource: 'songs', portalPreferences: { pinned: true }, stopDetailAudio: () => { elements.audioStopped = true; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/portal-responsive.js'), 'utf8'), context);
  const run = (source) => vm.runInContext(source, context);
  run('portalInitializeResponsive()');
  return { elements, document, media, run };
}
test('Mobile navigation requires an explicit open even when desktop navigation is pinned', () => {
  const { elements: e, document, run } = responsive();
  assert.equal(e['portal-sidebar'].inert, true);
  assert.equal(e.content.inert, false);
  run('portalSetMobileMenu(true)');
  assert.equal(e.content.inert, true); assert.equal(e['detail-panel'].inert, true);
  assert.equal(e['portal-sidebar'].attributes['aria-modal'], 'true');
  assert.equal(document.activeElement, e['portal-menu-close']);
  run('portalSetMobileMenu(false)');
  assert.equal(e.content.inert, false); assert.equal(e['portal-sidebar'].inert, true);
  assert.equal(document.activeElement, e['portal-menu-toggle']);
});
test('Back restores list scroll and focus, stops audio, and invalidates pending detail responses', () => {
  const { elements: e, document, run } = responsive();
  document.activeElement = e.row;
  e.results.scrollTop = 400; e.table.scrollTop = 920; e.table.scrollLeft = 140;
  run('portalShowDetailPane(true)');
  assert.equal(e.content.inert, true); assert.equal(e['detail-panel'].inert, false);
  assert.equal(document.activeElement, e['portal-detail-back']);
  assert.equal(e['back-label'].textContent, 'Back to Songs');
  e.table.scrollTop = e.table.scrollLeft = e.results.scrollTop = 0;
  run('portalReturnToList()');
  assert.equal(run('portalDetailRequest'), 1);
  assert.equal(e.content.inert, false); assert.equal(e['detail-panel'].inert, true);
  assert.equal(e.results.scrollTop, 400); assert.equal(e.table.scrollTop, 920); assert.equal(e.table.scrollLeft, 140);
  assert.equal(document.activeElement, e.row); assert.equal(e.audioStopped, true);
});
test('Crossing the breakpoint closes transient panes and restores desktop pinned navigation', () => {
  const { elements: e, media, run } = responsive();
  run('portalShowDetailPane(); portalSetMobileMenu(true)');
  media.matches = false; media.change();
  assert.equal(e['app-view'].classList.contains('mobile-detail-open'), false);
  assert.equal(e['app-view'].classList.contains('mobile-menu-open'), false);
  assert.equal(e['app-view'].classList.contains('nav-expanded'), true);
  assert.equal(e.content.inert, false); assert.equal(e['detail-panel'].inert, false); assert.equal(e['portal-sidebar'].inert, false);
  media.matches = true; media.change();
  assert.equal(e['portal-sidebar'].inert, true); assert.equal(e.content.inert, false); assert.equal(e['detail-panel'].inert, true);
});
