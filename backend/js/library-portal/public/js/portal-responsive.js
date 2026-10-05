const portalNarrowScreen = window.matchMedia('(max-width: 760px)');
let portalListPosition = null;
let portalListFocus = null;

function portalSyncPanes() {
  const narrow = portalNarrowScreen.matches;
  const app = $('app-view');
  const menu = narrow && app.classList.contains('mobile-menu-open');
  const detail = narrow && app.classList.contains('mobile-detail-open');
  document.querySelector('.content').inert = menu || detail;
  $('detail-panel').inert = menu || (narrow && !detail);
  $('portal-mobile-bar').inert = menu;
  $('portal-sidebar').inert = narrow && !menu;
  $('portal-menu-toggle').setAttribute('aria-expanded', String(menu));
  if (menu) {
    $('portal-sidebar').setAttribute('role', 'dialog');
    $('portal-sidebar').setAttribute('aria-modal', 'true');
  } else {
    $('portal-sidebar').removeAttribute('role');
    $('portal-sidebar').removeAttribute('aria-modal');
  }
}
function portalSetMobileMenu(open, restoreFocus = true) {
  const shown = Boolean(open && portalNarrowScreen.matches && !modalOpenCount);
  $('app-view').classList.toggle('mobile-menu-open', shown);
  portalSyncPanes();
  if (shown) $('portal-menu-close').focus();
  else if (restoreFocus && portalNarrowScreen.matches) $('portal-menu-toggle').focus();
}
function portalShowDetailPane(loading = false) {
  if (portalNarrowScreen.matches) {
    if (!$('app-view').classList.contains('mobile-detail-open')) {
      portalListFocus = document.activeElement;
      portalListPosition = [$('results'), ...$('results').querySelectorAll('.changelog-table-wrap')].map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    }
    $('portal-detail-back').querySelector('span').textContent = `Back to ${resourceNames[portalResource]}`;
    $('app-view').classList.add('mobile-detail-open');
    portalSyncPanes();
    if (!modalOpenCount) $('portal-detail-back').focus();
    $('detail-panel').scrollTop = 0;
  }
  if (loading) $('detail-content').innerHTML = '<p class="meta" role="status">Loading…</p>';
}
function portalReturnToList(restoreFocus = true) {
  portalDetailRequest++; // Ignore detail requests completed after Back or navigation.
  if ($('detail-content').querySelector('[role="status"]')) $('detail-content').innerHTML = '<p class="meta empty-detail">Select a row to view details</p>';
  $('app-view').classList.remove('mobile-detail-open');
  portalSyncPanes();
  if (restoreFocus) {
    stopDetailAudio();
    if (portalListFocus?.isConnected) portalListFocus.focus({ preventScroll: true });
    else $('portal-menu-toggle').focus({ preventScroll: true });
    for (const position of portalListPosition || []) if (position.element.isConnected) {
      position.element.scrollTop = position.top;
      position.element.scrollLeft = position.left;
    }
  }
  portalListPosition = portalListFocus = null;
}
function portalInitializeResponsive() {
  $('portal-menu-toggle').onclick = () => portalSetMobileMenu(true);
  $('portal-menu-close').onclick = $('portal-menu-backdrop').onclick = () => portalSetMobileMenu(false);
  $('portal-detail-back').onclick = () => portalReturnToList();
  portalNarrowScreen.addEventListener('change', () => {
    const menuHadFocus = $('portal-sidebar').contains(document.activeElement);
    const detailHadFocus = $('detail-panel').contains(document.activeElement);
    portalSetMobileMenu(false, false);
    // Resizing into the mobile layout always starts at the current list.
    portalReturnToList(false);
    $('app-view').classList.toggle('nav-expanded', !portalNarrowScreen.matches && portalPreferences.pinned);
    if (!modalOpenCount && !$('app-view').classList.contains('hidden')) {
      if (portalNarrowScreen.matches && (menuHadFocus || detailHadFocus)) $('portal-menu-toggle').focus();
      else if (!portalNarrowScreen.matches && $('portal-mobile-bar').contains(document.activeElement)) $('portal-sidebar').querySelector('.nav-item.active')?.focus();
    }
  });
  window.addEventListener('keydown', (event) => {
    if (!portalNarrowScreen.matches || !$('app-view').classList.contains('mobile-menu-open') || modalOpenCount) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); portalSetMobileMenu(false); }
    if (event.key === 'Tab') {
      const buttons = [...$('portal-sidebar').querySelectorAll('button:not(:disabled)')].filter((button) => button.getClientRects().length);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  portalSyncPanes();
}
