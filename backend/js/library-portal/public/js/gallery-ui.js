let portalGalleryGroups = [];

function portalGalleryPrefs(prefs) {
  const mode = typeof prefs.mode === 'string' && Object.hasOwn(PortalGallery.modes, prefs.mode) ? prefs.mode : 'albums';
  const groupBy = PortalGallery.modes[mode].includes(prefs.groupBy) ? prefs.groupBy : PortalGallery.modes[mode][0];
  return { ...prefs, mode, groupBy };
}
function portalGalleryUrl(prefs, extra = {}) {
  return '/api/v1/gallery?' + new URLSearchParams({ mode: prefs.mode, groupBy: prefs.groupBy, search: prefs.search, ...extra });
}
function portalGalleryCard(row, mode) {
  const artwork = getArtworkUrl(row.artwork);
  const subtitle = mode === 'artists' ? `${row.album_count} ${row.album_count === 1 ? 'album' : 'albums'}` : row.artists || '—';
  const footer = mode === 'artists' ? `${row.track_count} ${row.track_count === 1 ? 'track' : 'tracks'}` : row.year || '—';
  const fallback = `<svg viewBox="0 0 24 24" aria-hidden="true">${navIcons[mode]}</svg>`;
  return `<button type="button" class="gallery-card" data-record="${row.id}" aria-pressed="false"><span class="gallery-artwork">${fallback}${artwork ? `<img src="${escapeHtml(artwork)}" alt="" loading="lazy">` : ''}</span><span class="gallery-card-title" title="${escapeHtml(row.title || '')}">${escapeHtml(row.title || 'Untitled')}</span><span class="gallery-card-subtitle" title="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</span><span class="gallery-card-year">${escapeHtml(footer)}</span></button>`;
}
function portalBindGalleryCards(container, mode) {
  const selected = $('results').querySelector('[data-record][aria-pressed="true"]')?.dataset.record;
  container.querySelectorAll('img').forEach((img) => {
    img.onerror = () => img.remove();
    if (img.complete && !img.naturalWidth) img.remove();
  });
  container.querySelectorAll('[data-record]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.record === selected));
    button.onclick = () => {
      $('results').querySelectorAll('[data-record]').forEach((card) => card.setAttribute('aria-pressed', String(card.dataset.record === button.dataset.record)));
      showTableDetail(resourceTables[mode], Number(button.dataset.record)).catch(portalError);
    };
  });
}
function portalGalleryMoreLabel(button, group) {
  button.hidden = group.rows.length >= group.total;
  button.textContent = `Load more (${group.rows.length} of ${group.total})`;
}
async function portalLoadGallery(prefs, request) {
  prefs = portalGalleryPrefs(prefs);
  const select = $('gallery-grouping');
  select.innerHTML = PortalGallery.modes[prefs.mode].map((key) => `<option value="${key}" ${key === prefs.groupBy ? 'selected' : ''}>${key[0].toUpperCase() + key.slice(1)}</option>`).join('');
  select.onchange = () => portalNavigate('gallery', { ...prefs, search: $('portal-search').value, groupBy: select.value }).catch(portalError);
  $('gallery-mode-switch').querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === prefs.mode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === prefs.mode));
    button.onclick = () => portalNavigate('gallery', { ...prefs, search: $('portal-search').value, mode: button.dataset.mode, groupBy: PortalGallery.modes[button.dataset.mode][0] }).catch(portalError);
  });
  $('results').innerHTML = '<p class="meta">Loading…</p>';
  let payload;
  try { payload = await fetchJson(portalGalleryUrl(prefs)); }
  catch (error) {
    if (request === portalRequest) $('results').innerHTML = '<div class="empty-state">Unable to load results. Use Reload to try again.</div>';
    if (request === portalRequest) throw error;
    return;
  }
  if (request !== portalRequest) return;
  portalPreferences.view = 'gallery';
  portalPreferences.views.gallery = prefs;
  state.currentView = { type: 'gallery', key: prefs.mode, label: 'Gallery' };
  portalGalleryGroups = payload.groups;
  $('results').innerHTML = payload.groups.map((group, index) => `<section class="gallery-group" data-group-index="${index}"><h2 style="--depth: ${group.depth}">${escapeHtml(group.label)}<small>${group.total}</small></h2><div class="gallery-members"><div class="gallery-grid">${group.rows.map((row) => portalGalleryCard(row, prefs.mode)).join('')}</div><button type="button" class="secondary-btn gallery-more" aria-label="Load more ${escapeHtml(group.label)}"></button></div></section>`).join('') || '<div class="empty-state">No results</div>';
  $('results').scrollTop = 0;
  portalBindGalleryCards($('results'), prefs.mode);
  $('results').querySelectorAll('[data-group-index]').forEach((section) => {
    const group = portalGalleryGroups[Number(section.dataset.groupIndex)];
    const more = section.querySelector('.gallery-more');
    portalGalleryMoreLabel(more, group);
    more.onclick = async () => {
      more.disabled = true;
      try {
        const data = await fetchJson(portalGalleryUrl(prefs, { group: group.key, page: group.page + 1 }));
        if (request !== portalRequest) return;
        const next = data.groups[0];
        // A changed database can invalidate the next page; refresh all groups together.
        if (!next || next.page !== group.page + 1) { await portalNavigate('gallery'); return; }
        const ids = new Set(group.rows.map((row) => row.id));
        const added = next.rows.filter((row) => !ids.has(row.id));
        group.rows.push(...added); group.total = next.total; group.page = next.page;
        section.querySelector('h2 small').textContent = group.total;
        section.querySelector('.gallery-grid').insertAdjacentHTML('beforeend', added.map((row) => portalGalleryCard(row, prefs.mode)).join(''));
        portalBindGalleryCards(section, prefs.mode);
        portalGalleryMoreLabel(more, group);
        // Do not keep offering pages after the last page when records moved during browsing.
        if (next.page * next.pageSize >= next.total) more.hidden = true;
      } catch (error) { if (request === portalRequest) portalError(error); }
      finally { more.disabled = false; }
    };
  });
  renderSidebar(); portalSave();
}
