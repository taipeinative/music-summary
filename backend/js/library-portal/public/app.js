let detailAudio = null;
let detailAudioButton = null;
let detailAudioPlayer = null;
let artistArtworkPreviewTimer = null;
let previewAudio = null;
let previewAudioButton = null;
let previewAudioUrl = '';
let modalOpenCount = 0;
let searchToastCount = 0;
let groupEntriesEditor = null;
let groupEntrySearchRequestId = 0;
function $(id) {
  return document.getElementById(id);
}

function setAppBackgroundLocked(locked) {
  const appView = $('app-view');
  if (!appView) {
    return;
  }
  if (locked) {
    appView.setAttribute('inert', '');
    appView.setAttribute('aria-hidden', 'true');
  } else {
    appView.removeAttribute('inert');
    appView.removeAttribute('aria-hidden');
  }
}

function openModalUi(modal) {
  modalOpenCount += 1;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  setAppBackgroundLocked(true);
}

function closeModalUi(modal) {
  modal.classList.add('hidden');
  modalOpenCount = Math.max(modalOpenCount - 1, 0);
  if (modalOpenCount === 0) {
    document.body.classList.remove('modal-open');
    setAppBackgroundLocked(false);
  }
}

function showSearchToast(message = 'Searching...') {
  searchToastCount += 1;
  const toast = $('search-toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.remove('hidden');
  }
  return () => {
    searchToastCount = Math.max(searchToastCount - 1, 0);
    if (searchToastCount === 0) {
      $('search-toast')?.classList.add('hidden');
    }
  };
}

function showSearchToastForTerm(term, message = 'Searching...') {
  return String(term ?? '').trim() ? showSearchToast(message) : () => {};
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEnumOptions(options, selectedValue, { includeEmpty = false } = {}) {
  const selected = String(selectedValue ?? '');
  return `
    ${includeEmpty ? '<option value="">-</option>' : ''}
    ${Object.entries(options).map(([value, label]) => `
      <option value="${escapeHtml(value)}" ${String(value) === selected ? 'selected' : ''}>${escapeHtml(label)}</option>
    `).join('')}
  `;
}

function renderLocaleSelect(value, attributeName, label = 'Locale') {
  const localeValue = getLocaleOptionValue(value);
  return `
    <select ${attributeName} aria-label="${escapeHtml(label)}">
      ${renderEnumOptions(enumLabels.locale, localeValue)}
    </select>
  `;
}

function getLocaleOptionValue(value) {
  const raw = String(value ?? '').trim();
  const direct = Object.entries(enumLabels.locale).find(([optionValue, label]) => (
    raw === optionValue || raw.toLowerCase() === label.toLowerCase() || raw.toLowerCase() === label.slice(0, 2).toLowerCase()
  ));
  return direct?.[0] || '1';
}

function getTitleDisplayRank(title) {
  const locale = String(getLocaleOptionValue(title?.localeValue ?? title?.locale ?? title?.localeLabel));
  if (locale === '2') {
    return 0;
  }
  if (locale === '32768') {
    return 1;
  }
  if (title?.fallback) {
    return 2;
  }
  return 3;
}

function pickDisplayTitle(titles, fallback = '') {
  return [...(Array.isArray(titles) ? titles : [])]
    .filter((title) => String(title?.title || '').trim())
    .sort((left, right) => (
      getTitleDisplayRank(left) - getTitleDisplayRank(right)
      || Number(getLocaleOptionValue(left?.localeValue ?? left?.locale ?? left?.localeLabel))
        - Number(getLocaleOptionValue(right?.localeValue ?? right?.locale ?? right?.localeLabel))
      || String(left.title).localeCompare(String(right.title))
    ))[0]?.title || fallback;
}

function getFlagSummary(labels, selectedValue) {
  const selected = BigInt(selectedValue || 0);
  const names = Object.entries(labels)
    .filter(([value]) => {
      const bit = BigInt(value);
      return bit === 0n ? selected === 0n : (selected & bit) === bit;
    })
    .map(([, label]) => label);

  return names.length ? names.join(', ') : 'None';
}

function renderFlagDropdown(labels, selectedValue, dataAttribute) {
  const selected = BigInt(selectedValue || 0);
  return `
    <details class="preview-flag-dropdown" ${dataAttribute}>
      <summary>
        <span data-flag-summary>${escapeHtml(getFlagSummary(labels, selectedValue))}</span>
        <span class="preview-dropdown-caret">▾</span>
      </summary>
      <div class="preview-flag-menu">
        ${Object.entries(labels).map(([value, label]) => {
          const bit = BigInt(value);
          return `
            <label class="preview-flag-option">
              <input type="checkbox" value="${escapeHtml(value)}" ${(bit === 0n ? selected === 0n : (selected & bit) === bit) ? 'checked' : ''}>
              <span>${escapeHtml(label)}</span>
            </label>
          `;
        }).join('')}
      </div>
    </details>
  `;
}

function renderIconButton(action, label, extraClass = '') {
  const icons = {
    edit: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.9 3.4 16.6 6l-8.9 8.9-3.2.7.7-3.2 8.7-9Zm1.1-1.1a1.5 1.5 0 0 1 2.1 0l.6.6a1.5 1.5 0 0 1 0 2.1l-.4.4-2.7-2.7.4-.4ZM4 16.5h12V18H4v-1.5Z"/></svg>`,
    link: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 13.5H6a4 4 0 0 1 0-8h3v1.5H6a2.5 2.5 0 0 0 0 5h1.5v1.5Zm1-3.25h3v-1.5h-3v1.5Zm2.5 3.25H8v-1.5h3a2.5 2.5 0 0 0 0-5H9.5V5.5H11a4 4 0 0 1 0 8Z"/></svg>`,
    merge: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.25A2.25 2.25 0 1 1 4 8.75a2.25 2.25 0 0 1 0-4.5Zm0 1.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 5.5A2.25 2.25 0 1 1 4 15.75a2.25 2.25 0 0 1 0-4.5Zm0 1.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM15.75 7.75A2.25 2.25 0 1 1 15.75 12.25a2.25 2.25 0 0 1 0-4.5Zm0 1.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM6.2 7.05l5.9 2.45-.58 1.39-5.9-2.45.58-1.39Zm-.58 4.51 5.9-2.45.58 1.39-5.9 2.45-.58-1.39Zm6.36-4.5 3.77 2.69-3.77 2.69V7.06Z"/></svg>`,
    pause: audioPauseIcon,
    play: audioPlayIcon,
    search: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 3a5.5 5.5 0 0 1 4.38 8.83l3.15 3.14-1.06 1.06-3.14-3.15A5.5 5.5 0 1 1 8.5 3Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg>`,
    remove: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 6.5h9l-.6 9.5H6.1l-.6-9.5Zm2-3h5l.5 1H16V6H4V4.5h3l.5-1Zm.1 4.5.4 6.5h4l.4-6.5H7.6Z"/></svg>`
  };
  const iconKey = action.startsWith('remove')
    ? 'remove'
    : action.startsWith('edit')
      ? 'edit'
      : action.startsWith('audio')
        ? 'play'
      : action.startsWith('merge')
        ? 'merge'
      : action.includes('link')
        ? 'link'
        : action;

  return `
    <button class="preview-icon-btn ${extraClass}" type="button" data-preview-${escapeHtml(action)} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
      ${icons[iconKey] || ''}
    </button>
  `;
}

const iconButtonFeedbackTimers = new WeakMap();

function animateIconButtonSuccess(button) {
  if (!button) {
    return;
  }

  const oldTimer = iconButtonFeedbackTimers.get(button);
  if (oldTimer) {
    clearTimeout(oldTimer);
  }
  button.classList.remove('is-success');
  void button.offsetWidth;
  button.classList.add('is-success');

  const timer = setTimeout(() => {
    button.classList.remove('is-success');
    iconButtonFeedbackTimers.delete(button);
  }, 1200);
  iconButtonFeedbackTimers.set(button, timer);
}

function renderSearchInput(inputHtml, type, label) {
  return `
    <div class="preview-search-input">
      ${renderIconButton('search', label).replace('data-preview-search', `data-preview-search="${escapeHtml(type)}"`)}
      ${inputHtml}
    </div>
  `;
}

function renderNumberPair(leftValue, rightValue, leftAttr, rightAttr, label) {
  return `
    <div class="preview-number-pair" aria-label="${escapeHtml(label)}">
      <input ${leftAttr} type="number" min="1" value="${escapeHtml(leftValue || '')}" aria-label="${escapeHtml(label)} number">
      <span>/</span>
      <input ${rightAttr} type="number" min="1" value="${escapeHtml(rightValue || '')}" aria-label="${escapeHtml(label)} count">
    </div>
  `;
}

function renderArtworkInput(value, attributeName, label) {
  const artworkUrl = getArtworkUrl(value);

  return `
    <div class="preview-artwork-input-wrap">
      <input ${attributeName} data-artwork-input value="${escapeHtml(value || '')}" placeholder="Artwork URL" aria-label="${escapeHtml(label)}">
      <div class="preview-artwork-popover ${artworkUrl ? '' : 'hidden'}" aria-hidden="true">
        <img data-artwork-preview src="${escapeHtml(artworkUrl)}" alt="">
      </div>
    </div>
  `;
}

function renderAudioInput(value, attributeName, label) {
  return `
    <div class="preview-audio-input">
      <input ${attributeName} value="${escapeHtml(value || '')}" aria-label="${escapeHtml(label)}">
      ${renderIconButton('audio-toggle', 'Play audio')}
    </div>
  `;
}

function renderArtistRoleSelect(value, attributeName = 'data-artist-role') {
  return `
    <select ${attributeName} aria-label="Artist role">
      ${renderEnumOptions(enumLabels.role, value ?? 0)}
    </select>
  `;
}

function resetPreviewAudioButton(button = previewAudioButton) {
  if (!button) {
    return;
  }
  button.classList.remove('playing');
  button.innerHTML = audioPlayIcon;
  button.setAttribute('title', 'Play audio');
  button.setAttribute('aria-label', 'Play audio');
}

function setPreviewAudioButtonPlaying(button) {
  if (!button) {
    return;
  }
  button.classList.add('playing');
  button.innerHTML = audioPauseIcon;
  button.setAttribute('title', 'Pause audio');
  button.setAttribute('aria-label', 'Pause audio');
}

function stopPreviewAudio() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
  resetPreviewAudioButton();
  previewAudioButton = null;
  previewAudioUrl = '';
}

function syncPreviewAudioButton(root = document) {
  const button = root.querySelector?.('[data-preview-audio-toggle]');
  const input = button?.closest('.preview-audio-input')?.querySelector('input');
  const audioUrl = input?.value?.trim() || '';
  if (!button || !previewAudio || !audioUrl || audioUrl !== previewAudioUrl) {
    return;
  }

  resetPreviewAudioButton(previewAudioButton);
  previewAudioButton = button;
  if (previewAudio.paused) {
    resetPreviewAudioButton(button);
  } else {
    setPreviewAudioButtonPlaying(button);
  }
}

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function updateDetailAudioPlayer(player = detailAudioPlayer, audio = detailAudio) {
  if (!player) {
    return;
  }

  const range = player.querySelector('[data-detail-audio-range]');
  const current = player.querySelector('[data-detail-audio-current]');
  const duration = player.querySelector('[data-detail-audio-duration]');
  const audioDuration = Number(audio?.duration);
  const currentTime = Number(audio?.currentTime) || 0;

  if (range) {
    range.max = Number.isFinite(audioDuration) && audioDuration > 0 ? String(audioDuration) : '100';
    range.value = String(Math.min(currentTime, Number(range.max)));
    updateAudioRangeProgress(range);
  }
  if (current) {
    current.textContent = formatAudioTime(currentTime);
  }
  if (duration) {
    duration.textContent = formatAudioTime(audioDuration);
  }
}

function updateAudioRangeProgress(range) {
  if (!range) {
    return;
  }
  const max = Number(range.max);
  const value = Number(range.value);
  const progress = max > 0 ? (value / max) * 100 : 0;
  range.style.setProperty('--audio-progress', `${Math.max(0, Math.min(progress, 100))}%`);
}

function resetDetailAudioButton(button = detailAudioButton) {
  if (!button) {
    return;
  }
  button.classList.remove('playing');
  button.innerHTML = audioPlayIcon;
  button.setAttribute('title', 'Play audio');
  button.setAttribute('aria-label', 'Play audio');
}

function stopDetailAudio() {
  if (detailAudio) {
    detailAudio.pause();
    detailAudio = null;
  }
  resetDetailAudioButton();
  updateDetailAudioPlayer(detailAudioPlayer, null);
  detailAudioButton = null;
  detailAudioPlayer = null;
}

function toggleDetailAudio(button) {
  const player = button.closest('[data-detail-audio-player]');
  const audioUrl = player?.dataset.audioUrl?.trim();
  if (!audioUrl || !player) {
    stopDetailAudio();
    return;
  }

  if (detailAudio && detailAudioButton === button) {
    if (detailAudio.paused) {
      detailAudio.play().catch(stopDetailAudio);
      button.classList.add('playing');
      button.innerHTML = audioPauseIcon;
      button.setAttribute('title', 'Pause audio');
      button.setAttribute('aria-label', 'Pause audio');
    } else {
      detailAudio.pause();
      resetDetailAudioButton(button);
    }
    return;
  }

  stopPreviewAudio();
  stopDetailAudio();
  detailAudio = new Audio(audioUrl);
  detailAudioButton = button;
  detailAudioPlayer = player;
  button.classList.add('playing');
  button.innerHTML = audioPauseIcon;
  button.setAttribute('title', 'Pause audio');
  button.setAttribute('aria-label', 'Pause audio');
  detailAudio.addEventListener('loadedmetadata', () => updateDetailAudioPlayer(player, detailAudio));
  detailAudio.addEventListener('timeupdate', () => updateDetailAudioPlayer(player, detailAudio));
  detailAudio.addEventListener('ended', stopDetailAudio, { once: true });
  detailAudio.addEventListener('error', stopDetailAudio, { once: true });
  detailAudio.play().catch(stopDetailAudio);
}

function seekDetailAudio(range) {
  const player = range.closest('[data-detail-audio-player]');
  const nextTime = Number(range.value) || 0;
  if (detailAudio && detailAudioPlayer === player) {
    detailAudio.currentTime = nextTime;
    updateDetailAudioPlayer(player, detailAudio);
    return;
  }

  updateAudioRangeProgress(range);
  player?.querySelector('[data-detail-audio-current]')?.replaceChildren(document.createTextNode(formatAudioTime(nextTime)));
}

function togglePreviewAudio(button) {
  const input = button.closest('.preview-audio-input')?.querySelector('input');
  const audioUrl = input?.value?.trim();
  if (!audioUrl) {
    stopPreviewAudio();
    return;
  }

  if (previewAudio && previewAudioUrl === audioUrl) {
    resetPreviewAudioButton(previewAudioButton);
    previewAudioButton = button;
    if (previewAudio.paused) {
      setPreviewAudioButtonPlaying(button);
      previewAudio.play().catch(() => {
        stopPreviewAudio();
      });
    } else {
      previewAudio.pause();
      resetPreviewAudioButton(button);
    }
    return;
  }

  stopPreviewAudio();
  previewAudio = new Audio(audioUrl);
  previewAudioButton = button;
  previewAudioUrl = audioUrl;
  setPreviewAudioButtonPlaying(button);
  previewAudio.addEventListener('ended', stopPreviewAudio, { once: true });
  previewAudio.addEventListener('error', stopPreviewAudio, { once: true });
  previewAudio.play().catch(() => {
    stopPreviewAudio();
  });
}

function formatDate(value) {
  if (!value) {
    return '-';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('en-US');
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return '-';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function normalizeComparisonValue(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function valuesDiffer(left, right) {
  return normalizeComparisonValue(left) !== normalizeComparisonValue(right);
}

function durationDiffers(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  return Math.abs(left - right) > 2000;
}

function getFuzzyWarnings(row, songArtists) {
  if (row.matchMethod !== 'FUZZY') {
    return {};
  }

  return {
    title: valuesDiffer(row.entryTitle, row.songTitle),
    artist: valuesDiffer(row.entryArtist, songArtists),
    album: valuesDiffer(row.entryAlbum, row.songAlbum),
    duration: durationDiffers(row.entryDuration, row.songDuration)
  };
}

function getIssueWarnings(row) {
  if (!row || !row.reason) {
    return {};
  }

  const warnings = {};
  if (['TITLE_CONFLICT'].includes(row.reason)) {
    warnings.title = true;
  }
  if (['ARTIST_CONFLICT', 'REFERENCED_ARTIST_MISSING'].includes(row.reason)) {
    warnings.artist = true;
  }
  if (['REFERENCED_ALBUM_MISSING'].includes(row.reason)) {
    warnings.album = true;
  }
  if (['DURATION_MISMATCH'].includes(row.reason)) {
    warnings.duration = true;
  }
  if (['AUTHORITY_CONFLICT'].includes(row.reason)) {
    warnings.authority = true;
  }

  return warnings;
}

function getDetailWarnings(row, songArtists) {
  return {
    ...getFuzzyWarnings(row, songArtists),
    ...getIssueWarnings(row)
  };
}

function getArtworkUrl(artwork) {
  if (!artwork) {
    return '';
  }

  const url = String(artwork);
  if (!url.startsWith('https://is1-ssl.mzstatic.com/')) {
    return url;
  }
  if (/\/\d+x\d+bb\.(webp|jpg|jpeg|png)$/i.test(url)) {
    return url;
  }

  return `${url}${url.endsWith('/') ? '' : '/'}400x400bb.webp`;
}

function renderAppleMusicLinks(ids, separator = ', ') {
  if (!Array.isArray(ids) || ids.length === 0) {
    return '-';
  }

  return ids.map((id) => {
    const cleanId = String(id).trim();
    if (!cleanId) {
      return '';
    }
    const href = `https://music.apple.com/us/song/${encodeURIComponent(cleanId)}`;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanId)}</a>`;
  }).filter(Boolean).join(separator);
}

function renderArtworkFrame(artwork, extraClass = '') {
  const artworkUrl = getArtworkUrl(artwork);
  const className = `artwork-frame${extraClass ? ` ${extraClass}` : ''}`;

  return `
    <div class="${className}">
      ${artworkUrl ? `<img class="album-artwork" src="${escapeHtml(artworkUrl)}" alt="">` : '<div class="album-artwork artwork-placeholder"></div>'}
    </div>
  `;
}

function getMappingSelectionKey(row) {
  return `${row.entryId}:${row.songId}`;
}

function getGroupSelectionKey(row) {
  return String(row.groupId);
}

function getSelectedGroupIds() {
  return Array.from(state.selectedGroups).map(Number);
}

function getIssueSelectionKey(row) {
  return String(row.issueId);
}

function getSelectedIssueIds() {
  return Array.from(state.selectedIssues).map(Number);
}

function getSelectedMappings() {
  return Array.from(state.selectedMappings).map((key) => {
    const [entryId, songId] = key.split(':').map(Number);
    return { entryId, songId };
  });
}

function selectGroupRange(fromIndex, toIndex, additive = false) {
  if (!additive) {
    state.selectedGroups.clear();
  }

  const start = Math.max(0, Math.min(fromIndex, toIndex));
  const end = Math.min(state.rows.length - 1, Math.max(fromIndex, toIndex));
  for (let index = start; index <= end; index += 1) {
    const row = state.rows[index];
    if (row?.groupId !== undefined) {
      state.selectedGroups.add(getGroupSelectionKey(row));
    }
  }
}

function handleGroupSelection(index, event) {
  const row = state.rows[index];
  if (!row) {
    return;
  }

  const key = getGroupSelectionKey(row);
  if (event.shiftKey && state.groupSelectionAnchorIndex !== null) {
    selectGroupRange(state.groupSelectionAnchorIndex, index, event.ctrlKey || event.metaKey);
  } else if (event.ctrlKey || event.metaKey) {
    if (state.selectedGroups.has(key)) {
      state.selectedGroups.delete(key);
    } else {
      state.selectedGroups.add(key);
    }
    state.groupSelectionAnchorIndex = index;
  } else {
    if (state.selectedGroups.has(key)) {
      state.selectedGroups.delete(key);
      state.groupSelectionAnchorIndex = state.selectedGroups.size ? index : null;
    } else {
      state.selectedGroups.clear();
      state.selectedGroups.add(key);
      state.groupSelectionAnchorIndex = index;
    }
  }

  showBulkGroupDetail();
  updateGroupSelectionUi();
}

function selectMappingRange(fromIndex, toIndex, additive = false) {
  if (!additive) {
    state.selectedMappings.clear();
  }

  const start = Math.max(0, Math.min(fromIndex, toIndex));
  const end = Math.min(state.rows.length - 1, Math.max(fromIndex, toIndex));
  for (let index = start; index <= end; index += 1) {
    const row = state.rows[index];
    if (row?.entryId !== undefined && row?.songId !== undefined) {
      state.selectedMappings.add(getMappingSelectionKey(row));
    }
  }
}

function selectIssueRange(fromIndex, toIndex, additive = false) {
  if (!additive) {
    state.selectedIssues.clear();
  }

  const start = Math.max(0, Math.min(fromIndex, toIndex));
  const end = Math.min(state.rows.length - 1, Math.max(fromIndex, toIndex));
  for (let index = start; index <= end; index += 1) {
    const row = state.rows[index];
    if (row?.issueId !== undefined) {
      state.selectedIssues.add(getIssueSelectionKey(row));
    }
  }
}

function handleIssueSelection(index, event) {
  const row = state.rows[index];
  if (!row) {
    return;
  }

  const key = getIssueSelectionKey(row);
  if (event.shiftKey && state.issueSelectionAnchorIndex !== null) {
    selectIssueRange(state.issueSelectionAnchorIndex, index, event.ctrlKey || event.metaKey);
  } else if (event.ctrlKey || event.metaKey) {
    if (state.selectedIssues.has(key)) {
      state.selectedIssues.delete(key);
    } else {
      state.selectedIssues.add(key);
    }
    state.issueSelectionAnchorIndex = index;
  } else {
    if (state.selectedIssues.has(key)) {
      state.selectedIssues.delete(key);
      state.issueSelectionAnchorIndex = state.selectedIssues.size ? index : null;
    } else {
      state.selectedIssues.clear();
      state.selectedIssues.add(key);
      state.issueSelectionAnchorIndex = index;
    }
  }

  showBulkIssueDetail();
  updateIssueSelectionUi();
}

function handleMappingSelection(index, event) {
  const row = state.rows[index];
  if (!row) {
    return;
  }

  const key = getMappingSelectionKey(row);
  if (event.shiftKey && state.selectionAnchorIndex !== null) {
    selectMappingRange(state.selectionAnchorIndex, index, event.ctrlKey || event.metaKey);
  } else if (event.ctrlKey || event.metaKey) {
    if (state.selectedMappings.has(key)) {
      state.selectedMappings.delete(key);
    } else {
      state.selectedMappings.add(key);
    }
    state.selectionAnchorIndex = index;
  } else {
    if (state.selectedMappings.has(key)) {
      state.selectedMappings.delete(key);
      state.selectionAnchorIndex = state.selectedMappings.size ? index : null;
    } else {
      state.selectedMappings.clear();
      state.selectedMappings.add(key);
      state.selectionAnchorIndex = index;
    }
  }

  showBulkMappingDetail();
  updateMappingSelectionUi();
}

function isSelectionDotSelected(row, selectionType) {
  if (selectionType === 'group') {
    return state.selectedGroups.has(getGroupSelectionKey(row));
  }
  if (selectionType === 'issue') {
    return state.selectedIssues.has(getIssueSelectionKey(row));
  }
  return state.selectedMappings.has(getMappingSelectionKey(row));
}

function renderSelectionDot(row, selectionType = 'mapping') {
  const selected = isSelectionDotSelected(row, selectionType);
  const targetLabel = selectionType === 'group' ? 'entry group' : selectionType === 'issue' ? 'issue' : 'mapping';
  return `
    <button class="mapping-select-dot${selected ? ' selected' : ''}" type="button" aria-label="${selected ? `Unselect ${targetLabel}` : `Select ${targetLabel}`}" aria-pressed="${selected ? 'true' : 'false'}"></button>
  `;
}

function renderComparisonCardBody(row, index, key, extraClass = '', selectable = false, selectionType = 'mapping') {
  const songArtists = Array.isArray(row.songArtists) && row.songArtists.length
    ? row.songArtists.join(', ')
    : '(no artists)';
  const selected = selectable && isSelectionDotSelected(row, selectionType);
  const className = `record-card mapping-card${selected ? ' selected' : ''}${extraClass ? ` ${extraClass}` : ''}`;

  return `
    <article class="${className}" data-key="${escapeHtml(key)}" data-index="${index}">
      ${renderArtworkFrame(row.entryArtwork, 'entry-artwork-frame')}
      <div class="mapping-side entry-side">
        <div class="mapping-line mapping-name">${escapeHtml(row.entryTitle || '(no raw title)')}</div>
        <div class="mapping-line">${escapeHtml(row.entryArtist || '(no raw artist)')}</div>
        <div class="mapping-line">${escapeHtml(row.entryAlbum || '(no raw album)')}</div>
      </div>
      <div class="mapping-side song-side">
        <div class="mapping-line mapping-name">${escapeHtml(row.songTitle || '(no fallback title)')}</div>
        <div class="mapping-line">${escapeHtml(songArtists)}</div>
        <div class="mapping-line">${escapeHtml(row.songAlbum || '(no album)')}</div>
      </div>
      ${renderArtworkFrame(row.albumArtwork)}
    </article>
  `;
}

function renderComparisonCard(row, index, key, extraClass = '', selectable = false, selectionType = 'mapping') {
  const card = renderComparisonCardBody(row, index, key, extraClass, selectable, selectionType);
  if (!selectable) {
    return card;
  }

  return `
    <div class="mapping-select-row" data-index="${index}" data-selection-type="${escapeHtml(selectionType)}">
      ${renderSelectionDot(row, selectionType)}
      ${card}
    </div>
  `;
}

function renderEntryGroupCard(row, index, key, selectable = true) {
  const selected = selectable && state.selectedGroups.has(getGroupSelectionKey(row));
  const entryCount = Array.isArray(row.entries) ? row.entries.length : 0;
  const issueCount = Array.isArray(row.issues) ? row.issues.length : 0;
  const firstEntry = entryCount ? row.entries[0] : null;
  const title = firstEntry?.rawTitle || row.songTitle || `Entry Group ${row.groupId}`;
  const artist = firstEntry?.rawArtist || (Array.isArray(row.songArtists) ? row.songArtists.join(', ') : '');
  const album = firstEntry?.rawAlbum || row.songAlbum || '';
  const card = `
    <article class="record-card entry-group-card${selected ? ' selected' : ''}" data-key="${escapeHtml(key)}" data-index="${index}">
      ${renderArtworkFrame(firstEntry?.artwork || row.albumArtwork, 'entry-artwork-frame')}
      <div class="entry-group-main">
        <div class="mapping-line mapping-name">Group ${escapeHtml(row.groupId)} · ${escapeHtml(formatStatus(row.status))}</div>
        <div class="mapping-line">${escapeHtml(title || '(no title)')}</div>
        <div class="mapping-line">${escapeHtml([artist, album].filter(Boolean).join(' · ') || '-')}</div>
      </div>
      <div class="entry-group-summary">
        <div>${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}</div>
        <div>${issueCount} issue${issueCount === 1 ? '' : 's'}</div>
        <div>${escapeHtml(formatDate(row.createdAt))}</div>
      </div>
    </article>
  `;

  if (!selectable) {
    return card;
  }

  return `
    <div class="mapping-select-row" data-index="${index}" data-selection-type="group">
      ${renderSelectionDot(row, 'group')}
      ${card}
    </div>
  `;
}

function summarizeJson(value) {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  return JSON.stringify(value);
}

function getChangelogGridTemplate() {
  return changelogColumns
    .map((column) => `${state.changelog.columnWidths[column.key] || 120}px`)
    .join(' ');
}

function getChangelogCellValue(row, key) {
  if (key === 'table') {
    return row.tableName || '-';
  }
  if (key === 'operation') {
    return row.operation || '-';
  }
  if (key === 'pk') {
    return summarizeJson(row.rowPk);
  }
  if (key === 'initiator') {
    return row.changedBy || '-';
  }
  if (key === 'reason') {
    return row.reason || '-';
  }
  if (key === 'date') {
    return formatDate(row.changedAt);
  }
  return '-';
}

function renderChangelogTable() {
  const gridTemplate = getChangelogGridTemplate();

  return `
    <div class="changelog-table-wrap">
      <div class="changelog-table" style="--changelog-columns: ${escapeHtml(gridTemplate)};">
        <div class="changelog-header-row">
          ${changelogColumns.map((column, index) => `
            <div class="changelog-header-cell" data-column="${escapeHtml(column.key)}">
              <span>${escapeHtml(column.label)}</span>
              ${index < changelogColumns.length - 1 ? '<span class="column-resizer" role="separator" aria-orientation="vertical" tabindex="0"></span>' : ''}
            </div>
          `).join('')}
        </div>
        ${state.rows.map((row, index) => `
          <button class="changelog-row" type="button" data-key="changelog-${index}" data-index="${index}">
            ${changelogColumns.map((column) => `
              <span class="changelog-cell${column.key === 'date' ? ' nowrap' : ''}${['table', 'pk'].includes(column.key) ? ' monospace' : ''}" data-column="${escapeHtml(column.key)}">
                ${escapeHtml(getChangelogCellValue(row, column.key))}
              </span>
            `).join('')}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function getTableColumnWidth(key) {
  const tableWidths = state.table.columnWidths[state.table.key] || {};
  return tableWidths[key] || 140;
}

function setTableColumnWidth(key, width) {
  if (!state.table.columnWidths[state.table.key]) {
    state.table.columnWidths[state.table.key] = {};
  }
  state.table.columnWidths[state.table.key][key] = width;
}

function getTableGridTemplate() {
  return state.table.columns
    .map((column) => `${getTableColumnWidth(column)}px`)
    .join(' ');
}

function formatFlagValue(value, labels) {
  let numericValue;
  try {
    numericValue = BigInt(value);
  } catch (_error) {
    return String(value);
  }

  if (numericValue === 0n) {
    return 'None';
  }

  const names = [];
  for (const [flag, label] of Object.entries(labels)) {
    const numericFlag = BigInt(flag);
    if ((numericValue & numericFlag) === numericFlag) {
      names.push(label);
    }
  }

  return names.length ? names.join(', ') : String(value);
}

function formatEnumValue(column, value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (column === 'duration') return formatDuration(Number(value));
  if (/_date$|_at$/.test(column)) return formatDate(value);
  if (flagLabels[column]) {
    return formatFlagValue(value, flagLabels[column]);
  }
  if (enumLabels[column]) {
    return enumLabels[column][value] || String(value);
  }
  return null;
}

function formatTableCellValue(column, value) {
  const enumValue = formatEnumValue(column, value);
  if (enumValue !== null) {
    return enumValue;
  }
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '-';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function renderTableDataTable() {
  const gridTemplate = getTableGridTemplate();
  const pk = getTablePrimaryKey(state.table.key);

  return `
    <div class="changelog-table-wrap">
      <div class="changelog-table" style="--changelog-columns: ${escapeHtml(gridTemplate)};">
        <div class="changelog-header-row">
          ${state.table.columns.map((column, index) => `
            <div class="changelog-header-cell" data-column="${escapeHtml(column)}">
              <span>${escapeHtml(column)}</span>
              ${index < state.table.columns.length - 1 ? '<span class="column-resizer" role="separator" aria-orientation="vertical" tabindex="0"></span>' : ''}
            </div>
          `).join('')}
        </div>
        ${state.rows.map((row, index) => `
          <button class="changelog-row" type="button" data-key="table-${index}" data-index="${index}" data-id="${escapeHtml(row[pk] ?? '')}">
            ${state.table.columns.map((column) => `
              <span class="changelog-cell${/_id$|_ids$/.test(column) ? ' monospace' : ''}" data-column="${escapeHtml(column)}">
                ${escapeHtml(column === 'locale' && row.locales ? PortalModel.locales(row.locales, enumLabels.locale) : formatTableCellValue(column, row[column]))}
              </span>
            `).join('')}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function getTablePrimaryKey(key) {
  if (key === 'album') {
    return 'album_id';
  }
  if (key === 'artist') {
    return 'artist_id';
  }
  if (key === 'song') {
    return 'song_id';
  }
  if (key === 'entry') {
    return 'entry_id';
  }
  return 'source_id';
}

function getMappingPage(key) {
  return state.mapping.pages[key] || 1;
}

function setMappingPage(key, page) {
  state.mapping.pages[key] = Math.max(Number(page) || 1, 1);
  if (state.currentView.type === 'mapping' && state.currentView.key === key) {
    state.mapping.page = state.mapping.pages[key];
  }
}

function getTablePage(key) {
  return state.table.pages[key] || 1;
}

function setTablePage(key, page) {
  state.table.pages[key] = Math.max(Number(page) || 1, 1);
  if (state.currentView.type === 'table' && state.currentView.key === key) {
    state.table.page = state.table.pages[key];
  }
}

function getLastView() {
  try {
    const value = JSON.parse(localStorage.getItem(lastViewStorageKey) || 'null');
    if (!value || typeof value !== 'object') {
      return null;
    }
    const type = String(value.type || '');
    const key = String(value.key || '');
    if (type === 'mapping' && mappingViews.some((view) => view.key === key)) {
      return { type, key };
    }
    if (type === 'table' && tableViews.some((view) => view.key === key)) {
      return { type, key };
    }
    if (type === 'group') {
      return { type: 'group', key: 'all' };
    }
    if (type === 'changelog') {
      return { type: 'changelog', key: 'changelog' };
    }
    if (type === 'issue' && key) {
      return { type, key };
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function saveLastView() {
  try {
    localStorage.setItem(lastViewStorageKey, JSON.stringify({
      type: state.currentView.type,
      key: state.currentView.key
    }));
  } catch (_error) {
    // Browsers can deny storage in private or restricted contexts.
  }
}

async function selectLastViewOrDefault() {
  const view = getLastView();
  try {
    if (view?.type === 'table') {
      await selectTableView(view.key);
      return;
    }
    if (view?.type === 'mapping') {
      await selectMappingView(view.key);
      return;
    }
    if (view?.type === 'group') {
      await selectGroupView();
      return;
    }
    if (view?.type === 'changelog') {
      await selectChangelogView();
      return;
    }
    if (view?.type === 'issue') {
      await selectIssueView(view.key);
      return;
    }
  } catch (_error) {
    try {
      localStorage.removeItem(lastViewStorageKey);
    } catch (_storageError) {
      // Ignore storage cleanup failures.
    }
  }
  await selectMappingView('pending');
}

function buildMappingUrl(category) {
  return LibraryManagerApi.buildMappingUrl(category, {
    page: getMappingPage(category),
    pageSize: state.mapping.pageSize,
    filters: getMappingFilters(category)
  });
}

function buildChangelogUrl() {
  return LibraryManagerApi.buildChangelogUrl({
    page: state.changelog.page,
    pageSize: state.changelog.pageSize,
    filters: state.changelog.filters
  });
}

function buildGroupUrl() {
  return LibraryManagerApi.buildGroupUrl({
    page: state.group.page,
    pageSize: state.group.pageSize,
    filters: state.group.filters
  });
}

function createDefaultMappingFilters() {
  return {
    status: 'ANY',
    method: 'ANY',
    search: ''
  };
}

function getMappingFilters(key = state.currentView.key) {
  if (!state.mapping.filtersByKey || typeof state.mapping.filtersByKey !== 'object') {
    state.mapping.filtersByKey = {};
  }
  if (!state.mapping.filtersByKey[key]) {
    const useLegacyFilters = Object.keys(state.mapping.filtersByKey).length === 0
      && state.currentView.type === 'mapping'
      && key === state.currentView.key;
    state.mapping.filtersByKey[key] = {
      ...createDefaultMappingFilters(),
      ...(useLegacyFilters ? state.mapping.filters : {})
    };
  }
  return state.mapping.filtersByKey[key];
}

function createDefaultTableFilters() {
  return {
    search: '',
    sourceType: 'ANY',
    mappingStatus: 'ANY'
  };
}

function getTableFilters(key = state.table.key) {
  if (!state.table.filtersByKey || typeof state.table.filtersByKey !== 'object') {
    state.table.filtersByKey = {};
  }
  if (!state.table.filtersByKey[key]) {
    const useLegacyFilters = Object.keys(state.table.filtersByKey).length === 0
      && key === state.table.key;
    state.table.filtersByKey[key] = {
      ...createDefaultTableFilters(),
      ...(useLegacyFilters ? state.table.filters : {})
    };
  }
  return state.table.filtersByKey[key];
}

function startViewRequest(type) {
  if (!state.requests) {
    state.requests = {};
  }
  state.requests[type] = (state.requests[type] || 0) + 1;
  return state.requests[type];
}

function isLatestViewRequest(type, requestId, key = null) {
  return state.requests?.[type] === requestId
    && (!key || state.currentView.key === key)
    && state.currentView.type === type;
}

const listCacheLimit = 80;

function cloneListPayload(payload) {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload);
  }
  return JSON.parse(JSON.stringify(payload));
}

function ensureListCache(scope) {
  if (!state.listCache || typeof state.listCache !== 'object') {
    state.listCache = {};
  }
  if (!state.listCache[scope] || typeof state.listCache[scope] !== 'object') {
    state.listCache[scope] = {};
  }
  return state.listCache[scope];
}

function clearListCache(scope = null) {
  if (!scope) {
    state.listCache = {
      mapping: {},
      group: {},
      table: {},
      changelog: {}
    };
    return;
  }
  ensureListCache(scope);
  state.listCache[scope] = {};
}

function getCachedListPayload(scope, url) {
  const cache = ensureListCache(scope);
  const item = cache[url];
  return item ? cloneListPayload(item.payload) : null;
}

function setCachedListPayload(scope, url, payload) {
  const cache = ensureListCache(scope);
  cache[url] = {
    payload: cloneListPayload(payload),
    cachedAt: Date.now()
  };
  const keys = Object.keys(cache);
  if (keys.length > listCacheLimit) {
    keys
      .sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0))
      .slice(0, keys.length - listCacheLimit)
      .forEach((key) => {
        delete cache[key];
      });
  }
}

async function fetchCachedListPayload(scope, url) {
  const cached = getCachedListPayload(scope, url);
  if (cached) {
    return { payload: cached, cached: true };
  }
  const payload = await fetchJson(url);
  setCachedListPayload(scope, url, payload);
  return { payload, cached: false };
}

function buildTableUrl(key) {
  return LibraryManagerApi.buildTableUrl(key, {
    page: getTablePage(key),
    pageSize: state.table.pageSize,
    filters: getTableFilters(key)
  });
}

async function fetchJson(url, options = {}) {
  return LibraryManagerApi.fetchJson(url, options);
}

function applySettings(settings) {
  if (settings?.changelogColumnWidths && typeof settings.changelogColumnWidths === 'object') {
    for (const column of changelogColumns) {
      const width = Number(settings.changelogColumnWidths[column.key]);
      if (Number.isFinite(width)) {
        state.changelog.columnWidths[column.key] = Math.max(80, Math.min(width, 700));
      }
    }
  }
  if (settings?.tableColumnWidths && typeof settings.tableColumnWidths === 'object') {
    state.table.columnWidths = settings.tableColumnWidths;
  }
}

async function loadSettings() {
  const settings = await fetchJson('/api/settings');
  applySettings(settings);
}

async function saveChangelogColumnWidths() {
  await fetchJson('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      changelogColumnWidths: state.changelog.columnWidths
    })
  });
}

async function saveTableColumnWidths() {
  await fetchJson('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      tableColumnWidths: state.table.columnWidths
    })
  });
}

function showLogin(message = '') {
  $('login-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
  $('login-message').textContent = message;
}

function showApp(connection) {
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('connection-info').innerHTML = `
    <div class="connection-row">
      <strong>${escapeHtml(connection.user)}@${escapeHtml(connection.database)}</strong>
      <div class="connection-actions">
        <button id="refresh-btn" class="icon-btn" type="button" title="Reload" aria-label="Reload">
          <svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.45 5h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h8V3l-3.35 3.35z"/></svg>
        </button>
        <button id="logout-btn" class="icon-btn" type="button" title="Log out" aria-label="Log out">
          <svg viewBox="0 0 24 24"><path d="M10 17v-3H3v-4h7V7l5 5-5 5zm2-14h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7v-2h7V5h-7V3z"/></svg>
        </button>
      </div>
    </div>
  `;
  bindConnectionActions();
}

function syncMappingFilterInputs() {
  const filters = getMappingFilters(state.currentView.key);
  $('status-filter').value = filters.status;
  $('method-filter').value = filters.method;
  $('mapping-search').value = filters.search;
}

function syncTableFilterInputs() {
  const searchInput = $('table-search');
  const sourceTypeSelect = $('entry-source-type-filter');
  const mappingStatusSelect = $('entry-mapping-status-filter');
  const addArtistButton = $('add-artist-btn');
  const isEntryTable = state.table.key === 'entry';
  const isArtistTable = state.table.key === 'artist';
  const filters = getTableFilters(state.table.key);

  searchInput.value = filters.search;
  searchInput.placeholder = isEntryTable ? 'Search entry' : 'Search table';
  sourceTypeSelect.innerHTML = `
    <option value="ANY">Any source type</option>
    ${renderEnumOptions(enumLabels.source_type, filters.sourceType)}
  `;
  sourceTypeSelect.value = filters.sourceType;
  mappingStatusSelect.value = filters.mappingStatus;
  sourceTypeSelect.classList.toggle('hidden', !isEntryTable);
  mappingStatusSelect.classList.toggle('hidden', !isEntryTable);
  addArtistButton?.classList.toggle('hidden', !isArtistTable);
}

function syncGroupFilterInputs() {
  $('group-search').value = state.group.filters.search;
  $('group-filter-button').classList.toggle('is-active', Boolean(
    state.group.filters.rules.length || state.group.filters.sort.length || state.group.filters.includeConfirmed
  ));
}

const groupRuleFields = {
  id: 'ID (entry group)',
  title: 'Title (entry)',
  artist: 'Artist (entry)',
  album: 'Album (entry)',
  releaseDate: 'Release date (entry)'
};
const groupTextOperators = { is: 'is', isNot: 'is not', contains: 'contains', notContains: 'not contains', matches: 'matches' };
const groupNumberOperators = { gt: '>', gte: '>=', eq: '=', lte: '<=', lt: '<' };

function renderGroupRule(rule, type, index) {
  const isFilter = type === 'filter';
  const numeric = rule.field === 'id' || rule.field === 'releaseDate';
  const operators = numeric ? groupNumberOperators : groupTextOperators;
  return `
    <div class="group-rule-row" data-group-rule="${type}">
      <select data-group-field aria-label="${isFilter ? 'Filter' : 'Sort'} field">${renderEnumOptions(groupRuleFields, rule.field)}</select>
      ${isFilter ? `
        <select data-group-operator aria-label="Filter condition">${renderEnumOptions(operators, rule.operator)}</select>
        <input data-group-value type="${rule.field === 'id' ? 'number' : rule.field === 'releaseDate' ? 'date' : 'text'}" ${rule.field === 'id' ? 'min="1" step="1"' : ''} value="${escapeHtml(rule.value)}" aria-label="Filter value">
      ` : `
        <select data-group-direction aria-label="Sort direction">
          <option value="asc" ${rule.direction === 'asc' ? 'selected' : ''}>Ascending</option>
          <option value="desc" ${rule.direction === 'desc' ? 'selected' : ''}>Descending</option>
        </select>
        <button class="group-rule-action" type="button" data-group-move="up" title="Move up" aria-label="Move sort up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="group-rule-action" type="button" data-group-move="down" title="Move down" aria-label="Move sort down">↓</button>
      `}
      <button class="group-rule-action" type="button" data-group-remove title="Remove ${type}" aria-label="Remove ${type}">×</button>
    </div>
  `;
}

function updateGroupSortMoveButtons() {
  const rows = [...$('group-sort-list').querySelectorAll('[data-group-rule]')];
  rows.forEach((row, index) => {
    row.querySelector('[data-group-move="up"]').disabled = index === 0;
    row.querySelector('[data-group-move="down"]').disabled = index === rows.length - 1;
  });
}

function addGroupRule(type, rule = null) {
  const list = $(type === 'filter' ? 'group-filter-list' : 'group-sort-list');
  const defaultRule = type === 'filter'
    ? { field: 'title', operator: 'contains', value: '' }
    : { field: 'id', direction: 'asc' };
  list.insertAdjacentHTML('beforeend', renderGroupRule(rule || defaultRule, type, list.children.length));
  updateGroupSortMoveButtons();
}

function readGroupRules(type) {
  const list = $(type === 'filter' ? 'group-filter-list' : 'group-sort-list');
  return [...list.querySelectorAll('[data-group-rule]')].map((row) => type === 'filter' ? {
    field: row.querySelector('[data-group-field]').value,
    operator: row.querySelector('[data-group-operator]').value,
    value: row.querySelector('[data-group-value]').value.trim()
  } : {
    field: row.querySelector('[data-group-field]').value,
    direction: row.querySelector('[data-group-direction]').value
  });
}

function closeGroupFilterModal() {
  closeModalUi($('group-filter-modal'));
  $('group-filter-button').focus();
}

function openGroupFilterModal() {
  $('group-filter-list').replaceChildren();
  $('group-sort-list').replaceChildren();
  state.group.filters.rules.forEach((rule) => addGroupRule('filter', rule));
  state.group.filters.sort.forEach((rule) => addGroupRule('sort', rule));
  $('include-confirmed-groups').checked = state.group.filters.includeConfirmed;
  $('group-filter-error').classList.add('hidden');
  openModalUi($('group-filter-modal'));
  $('group-filter-add').focus();
}

async function completeGroupFilterModal() {
  const rules = readGroupRules('filter');
  const invalid = rules.find((rule) => !rule.value || (rule.field === 'id' && (!/^[1-9]\d{0,9}$/.test(rule.value) || Number(rule.value) > 2147483647)));
  if (invalid) {
    $('group-filter-error').textContent = 'Enter a valid value for every filter.';
    $('group-filter-error').classList.remove('hidden');
    return;
  }
  const previousFilters = {
    rules: state.group.filters.rules,
    sort: state.group.filters.sort,
    includeConfirmed: state.group.filters.includeConfirmed
  };
  const previousPage = state.group.page;
  state.group.filters.rules = rules;
  state.group.filters.sort = readGroupRules('sort');
  state.group.filters.includeConfirmed = $('include-confirmed-groups').checked;
  state.group.page = 1;
  $('group-filter-complete').disabled = true;
  try {
    await selectGroupView();
    closeGroupFilterModal();
  } catch (error) {
    Object.assign(state.group.filters, previousFilters);
    state.group.page = previousPage;
    $('group-filter-error').textContent = error.message;
    $('group-filter-error').classList.remove('hidden');
  } finally {
    $('group-filter-complete').disabled = false;
  }
}

function bindGroupFilterModal() {
  $('group-filter-button').addEventListener('click', openGroupFilterModal);
  $('group-filter-close').addEventListener('click', closeGroupFilterModal);
  $('group-filter-complete').addEventListener('click', completeGroupFilterModal);
  $('group-filter-add').addEventListener('click', () => addGroupRule('filter'));
  $('group-sort-add').addEventListener('click', () => addGroupRule('sort'));
  $('group-filter-modal').addEventListener('click', (event) => {
    const row = event.target.closest('[data-group-rule]');
    if (!row) {
      return;
    }
    if (event.target.closest('[data-group-remove]')) {
      row.remove();
      updateGroupSortMoveButtons();
    } else {
      const move = event.target.closest('[data-group-move]')?.dataset.groupMove;
      if (move === 'up' && row.previousElementSibling) {
        row.previousElementSibling.before(row);
      } else if (move === 'down' && row.nextElementSibling) {
        row.nextElementSibling.after(row);
      }
      updateGroupSortMoveButtons();
    }
  });
  $('group-filter-list').addEventListener('change', (event) => {
    if (!event.target.matches('[data-group-field]')) {
      return;
    }
    const row = event.target.closest('[data-group-rule]');
    const field = event.target.value;
    const numeric = field === 'id' || field === 'releaseDate';
    row.querySelector('[data-group-operator]').innerHTML = renderEnumOptions(numeric ? groupNumberOperators : groupTextOperators, numeric ? 'eq' : 'contains');
    const input = row.querySelector('[data-group-value]');
    input.type = field === 'id' ? 'number' : field === 'releaseDate' ? 'date' : 'text';
    input.value = '';
  });
}

function renderSelectOptions(select, options, selectedValue, anyLabel) {
  const values = [selectedValue, ...options]
    .filter((value) => value && value !== 'ANY');
  const uniqueValues = [...new Set(values)];
  select.innerHTML = `
    <option value="ANY">${escapeHtml(anyLabel)}</option>
    ${uniqueValues.map((value) => `<option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
  `;
  select.value = selectedValue;
}

function syncChangelogFilterInputs() {
  renderSelectOptions(
    $('changelog-table-filter'),
    state.changelog.filterOptions.tables,
    state.changelog.filters.table,
    'Any table'
  );
  renderSelectOptions(
    $('changelog-operation-filter'),
    state.changelog.filterOptions.operations,
    state.changelog.filters.operation,
    'Any operation'
  );
}

function showMappingToolbar() {
  $('mapping-controls').classList.remove('hidden');
  $('mapping-filters').classList.remove('hidden');
  $('table-filters').classList.add('hidden');
  $('group-filters').classList.add('hidden');
  $('changelog-filters').classList.add('hidden');
  $('include-resolved').disabled = true;
  $('include-resolved').closest('.toggle-label').classList.add('hidden');
  syncMappingFilterInputs();
}

function showIssueToolbar() {
  $('mapping-controls').classList.add('hidden');
  $('mapping-filters').classList.remove('hidden');
  $('table-filters').classList.add('hidden');
  $('group-filters').classList.add('hidden');
  $('changelog-filters').classList.add('hidden');
  $('include-resolved').disabled = false;
  $('include-resolved').closest('.toggle-label').classList.remove('hidden');
}

function showChangelogToolbar() {
  $('mapping-controls').classList.remove('hidden');
  $('mapping-filters').classList.add('hidden');
  $('table-filters').classList.add('hidden');
  $('group-filters').classList.add('hidden');
  $('changelog-filters').classList.remove('hidden');
  $('include-resolved').disabled = true;
  $('include-resolved').closest('.toggle-label').classList.add('hidden');
  $('pagination').classList.add('hidden');
  syncChangelogFilterInputs();
}

function showGroupToolbar() {
  $('mapping-controls').classList.remove('hidden');
  $('mapping-filters').classList.add('hidden');
  $('table-filters').classList.add('hidden');
  $('group-filters').classList.remove('hidden');
  $('changelog-filters').classList.add('hidden');
  $('include-resolved').disabled = true;
  $('include-resolved').closest('.toggle-label').classList.add('hidden');
  syncGroupFilterInputs();
}

function showTableToolbar() {
  $('mapping-controls').classList.remove('hidden');
  $('mapping-filters').classList.add('hidden');
  $('table-filters').classList.remove('hidden');
  $('group-filters').classList.add('hidden');
  $('changelog-filters').classList.add('hidden');
  $('include-resolved').disabled = true;
  $('include-resolved').closest('.toggle-label').classList.add('hidden');
  syncTableFilterInputs();
}

async function initialize() {
  try {
    const session = await fetchJson('/api/session');
    if (!session.authenticated) {
      showLogin(session.message || '');
      return;
    }

    showApp(session.connection);
    await loadSettings();
    await loadSummary();
    await selectLastViewOrDefault();
  } catch (error) {
    showLogin(error.message);
  }
}

async function loadSummary() {
  state.summary = await fetchJson('/api/summary');
  renderSidebar();
}

function renderSidebar() {
  const nav = $('sidebar-nav');
  const issueReasons = state.summary?.issues?.reasons || [];
  const mappingCounts = state.summary?.mappings || {};
  const groupCounts = state.summary?.groups || {};
  const visibleGroupCount = (groupCounts.pending ?? 0) + (groupCounts.rejected ?? 0);
  const tableCounts = state.summary?.tables || {};
  const changelogCount = state.summary?.changelog?.total ?? 0;

  const tableHtml = tableViews.map((view) => {
    const active = state.currentView.type === 'table' && state.currentView.key === view.key ? ' active' : '';
    const count = tableCounts[view.key] ?? 0;
    return `
      <button class="nav-item${active}" type="button" data-type="table" data-key="${escapeHtml(view.key)}">
        <span>${escapeHtml(view.label)}</span>
        <span class="nav-count">${count}</span>
      </button>
    `;
  }).join('');

  const mappingHtml = mappingViews.map((view) => {
    const active = state.currentView.type === 'mapping' && state.currentView.key === view.key ? ' active' : '';
    const count = mappingCounts[view.key] ?? 0;
    return `
      <button class="nav-item${active}" type="button" data-type="mapping" data-key="${escapeHtml(view.key)}">
        <span>${escapeHtml(view.label)}</span>
        <span class="nav-count">${count}</span>
      </button>
    `;
  }).join('');

  const issueHtml = issueReasons.length
    ? issueReasons.map((item) => {
      const active = state.currentView.type === 'issue' && state.currentView.key === item.reason ? ' active' : '';
      return `
        <button class="nav-item${active}" type="button" data-type="issue" data-key="${escapeHtml(item.reason)}">
          <span>${escapeHtml(getIssueLabel(item.reason))}</span>
          <span class="nav-count">${item.count}</span>
        </button>
      `;
    }).join('')
    : '<p class="meta" style="padding: 0.4rem 1.5rem 0.8rem 2.5rem;">No review issues</p>';

  nav.innerHTML = `
    <section class="nav-section">
      <span class="genre-header">Tables</span>
      ${tableHtml}
    </section>
    <section class="nav-section">
      <span class="genre-header">Entry Mapping</span>
      ${mappingHtml}
    </section>
    <section class="nav-section">
      <span class="genre-header">Entry Group</span>
      <button class="nav-item${state.currentView.type === 'group' ? ' active' : ''}" type="button" data-type="group" data-key="all">
        <span>All Groups</span>
        <span class="nav-count">${visibleGroupCount}</span>
      </button>
    </section>
    <section class="nav-section">
      <span class="genre-header">Review Issue</span>
      ${issueHtml}
    </section>
    <section class="nav-section">
      <span class="genre-header">History</span>
      <button class="nav-item${state.currentView.type === 'changelog' ? ' active' : ''}" type="button" data-type="changelog" data-key="changelog">
        <span>Changelog</span>
        <span class="nav-count">${changelogCount}</span>
      </button>
    </section>
  `;

  nav.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', async () => {
      const type = button.dataset.type;
      const key = button.dataset.key;
      if (type === 'table') {
        await selectTableView(key);
      } else if (type === 'mapping') {
        await selectMappingView(key);
      } else if (type === 'group') {
        await selectGroupView();
      } else if (type === 'changelog') {
        await selectChangelogView();
      } else {
        await selectIssueView(key);
      }
    });
  });
}

async function selectMappingView(key) {
  const view = mappingViews.find((item) => item.key === key) || mappingViews[0];
  state.currentView = { type: 'mapping', key: view.key, label: view.label };
  const requestId = startViewRequest('mapping');
  state.selectedKey = null;
  state.mapping.filters = getMappingFilters(view.key);
  state.mapping.page = getMappingPage(view.key);
  showMappingToolbar();
  let hideSearchToast = () => {};

  try {
    let url = buildMappingUrl(view.key);
    if (!getCachedListPayload('mapping', url)) {
      hideSearchToast = showSearchToastForTerm(state.mapping.filters.search, 'Searching mappings...');
    }
    let { payload } = await fetchCachedListPayload('mapping', url);
    if (!isLatestViewRequest('mapping', requestId, view.key)) {
      return;
    }
    if ((payload.rows || []).length === 0 && payload.total > 0 && payload.page > payload.pageCount) {
      setMappingPage(view.key, payload.pageCount || 1);
      url = buildMappingUrl(view.key);
      if (!getCachedListPayload('mapping', url)) {
        hideSearchToast();
        hideSearchToast = showSearchToastForTerm(state.mapping.filters.search, 'Searching mappings...');
      }
      ({ payload } = await fetchCachedListPayload('mapping', url));
      if (!isLatestViewRequest('mapping', requestId, view.key)) {
        return;
      }
    }
    state.rows = payload.rows || [];
    setMappingPage(view.key, payload.page || state.mapping.page);
    state.mapping.pageSize = payload.pageSize || state.mapping.pageSize;
    state.mapping.total = payload.total || 0;
    state.mapping.pageCount = payload.pageCount || 1;
    renderSidebar();
    renderRows();
    renderPagination();
    saveLastView();
  } finally {
    hideSearchToast();
  }
}

async function selectIssueView(reason) {
  state.currentView = { type: 'issue', key: reason, label: getIssueLabel(reason) };
  const requestId = startViewRequest('issue');
  state.selectedKey = null;
  showIssueToolbar();

  const includeResolved = $('include-resolved').checked ? 'true' : 'false';
  const payload = await fetchJson(`/api/issues?reason=${encodeURIComponent(reason)}&includeResolved=${includeResolved}`);
  if (!isLatestViewRequest('issue', requestId, reason)) {
    return;
  }
  state.rows = payload.rows || [];
  renderSidebar();
  renderRows();
  $('pagination').classList.add('hidden');
  saveLastView();
}

async function selectGroupView() {
  state.currentView = { type: 'group', key: 'all', label: 'Entry Group' };
  const requestId = startViewRequest('group');
  state.selectedKey = null;
  showGroupToolbar();
  let hideSearchToast = () => {};

  try {
    const url = buildGroupUrl();
    if (!getCachedListPayload('group', url)) {
      hideSearchToast = showSearchToastForTerm(state.group.filters.search, 'Searching entry groups...');
    }
    const { payload } = await fetchCachedListPayload('group', url);
    if (!isLatestViewRequest('group', requestId, 'all')) {
      return;
    }
    state.rows = payload.rows || [];
    state.group.page = payload.page || state.group.page;
    state.group.pageSize = payload.pageSize || state.group.pageSize;
    state.group.total = payload.total || 0;
    state.group.pageCount = payload.pageCount || 1;
    renderSidebar();
    renderRows();
    renderPagination();
    saveLastView();
  } finally {
    hideSearchToast();
  }
}

async function selectTableView(key) {
  const view = tableViews.find((item) => item.key === key) || tableViews[0];
  state.currentView = { type: 'table', key: view.key, label: view.label };
  const requestId = startViewRequest('table');
  state.selectedKey = null;
  state.table.key = view.key;
  state.table.filters = getTableFilters(view.key);
  state.table.page = getTablePage(view.key);
  showTableToolbar();
  let hideSearchToast = () => {};

  try {
    let url = buildTableUrl(view.key);
    if (!getCachedListPayload('table', url)) {
      hideSearchToast = showSearchToastForTerm(state.table.filters.search, `Searching ${view.label}...`);
    }
    let { payload } = await fetchCachedListPayload('table', url);
    if (!isLatestViewRequest('table', requestId, view.key)) {
      return;
    }
    if ((payload.rows || []).length === 0 && payload.total > 0 && payload.page > payload.pageCount) {
      setTablePage(view.key, payload.pageCount || 1);
      url = buildTableUrl(view.key);
      if (!getCachedListPayload('table', url)) {
        hideSearchToast();
        hideSearchToast = showSearchToastForTerm(state.table.filters.search, `Searching ${view.label}...`);
      }
      ({ payload } = await fetchCachedListPayload('table', url));
      if (!isLatestViewRequest('table', requestId, view.key)) {
        return;
      }
    }
    state.rows = payload.rows || [];
    state.table.columns = payload.columns || [];
    setTablePage(view.key, payload.page || state.table.page);
    state.table.pageSize = payload.pageSize || state.table.pageSize;
    state.table.total = payload.total || 0;
    state.table.pageCount = payload.pageCount || 1;
    renderSidebar();
    renderRows();
    renderPagination();
    saveLastView();
  } finally {
    hideSearchToast();
  }
}

async function selectChangelogView() {
  state.currentView = { type: 'changelog', key: 'changelog', label: 'Changelog' };
  const requestId = startViewRequest('changelog');
  state.selectedKey = null;
  showChangelogToolbar();

  const url = buildChangelogUrl();
  const { payload } = await fetchCachedListPayload('changelog', url);
  if (!isLatestViewRequest('changelog', requestId, 'changelog')) {
    return;
  }
  state.rows = payload.rows || [];
  state.changelog.page = payload.page || state.changelog.page;
  state.changelog.pageSize = payload.pageSize || state.changelog.pageSize;
  state.changelog.total = payload.total || 0;
  state.changelog.pageCount = payload.pageCount || 1;
  state.changelog.filterOptions.tables = payload.tableOptions || state.changelog.filterOptions.tables;
  state.changelog.filterOptions.operations = payload.operationOptions || state.changelog.filterOptions.operations;
  syncChangelogFilterInputs();
  renderSidebar();
  renderRows();
  renderPagination();
  saveLastView();
}

function renderRows() {
  $('view-title').textContent = state.currentView.label;
  if (state.currentView.type === 'mapping') {
    const start = state.mapping.total === 0 ? 0 : ((state.mapping.page - 1) * state.mapping.pageSize) + 1;
    const end = Math.min(state.mapping.page * state.mapping.pageSize, state.mapping.total);
    $('view-count').textContent = `${start}-${end} of ${state.mapping.total} rows`;
  } else if (state.currentView.type === 'group') {
    const start = state.group.total === 0 ? 0 : ((state.group.page - 1) * state.group.pageSize) + 1;
    const end = Math.min(state.group.page * state.group.pageSize, state.group.total);
    $('view-count').textContent = `${start}-${end} of ${state.group.total} groups`;
  } else if (state.currentView.type === 'changelog') {
    const start = state.changelog.total === 0 ? 0 : ((state.changelog.page - 1) * state.changelog.pageSize) + 1;
    const end = Math.min(state.changelog.page * state.changelog.pageSize, state.changelog.total);
    $('view-count').textContent = `${start}-${end} of ${state.changelog.total} changes`;
  } else if (state.currentView.type === 'table') {
    const start = state.table.total === 0 ? 0 : ((state.table.page - 1) * state.table.pageSize) + 1;
    const end = Math.min(state.table.page * state.table.pageSize, state.table.total);
    $('view-count').textContent = `${start}-${end} of ${state.table.total} rows`;
  } else {
    $('view-count').textContent = `${state.rows.length} rows, showing up to 500`;
  }
  const results = $('results');
  const detail = $('detail-content');
  detail.innerHTML = '<p class="meta empty-detail">Select a row to view details</p>';

  if (!state.rows.length) {
    results.innerHTML = '<div class="empty-state">No results</div>';
    return;
  }

  if (state.currentView.type === 'changelog') {
    results.innerHTML = renderChangelogTable();
    bindChangelogTable();
    return;
  }
  if (state.currentView.type === 'table') {
    results.innerHTML = renderTableDataTable();
    bindTableDataTable();
    return;
  }

  results.innerHTML = state.rows.map((row, index) => {
    const key = `${state.currentView.type}-${index}`;
    if (state.currentView.type === 'group') {
      return renderEntryGroupCard(row, index, key, true);
    }
    const isIssue = state.currentView.type === 'issue';
    if (!isIssue) {
      return renderComparisonCard(row, index, key, '', state.currentView.type === 'mapping');
    }

    return renderComparisonCard(row, index, key, 'issue-card', true, 'issue');
  }).join('');

  results.querySelectorAll('.mapping-select-dot').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      results.querySelectorAll('.record-card').forEach((item) => item.classList.remove('active'));
      const row = button.closest('.mapping-select-row');
      if (row.dataset.selectionType === 'group') {
        handleGroupSelection(Number(row.dataset.index), event);
      } else if (row.dataset.selectionType === 'issue') {
        handleIssueSelection(Number(row.dataset.index), event);
      } else {
        handleMappingSelection(Number(row.dataset.index), event);
      }
    });
  });

  results.querySelectorAll('.record-card').forEach((card) => {
    card.addEventListener('click', () => {
      results.querySelectorAll('.record-card').forEach((item) => item.classList.remove('active'));
      card.classList.add('active');
      showDetail(state.rows[Number(card.dataset.index)]);
    });
  });
}

function updateChangelogColumnTemplate() {
  const table = document.querySelector('.changelog-table');
  if (table) {
    table.style.setProperty('--changelog-columns', getChangelogGridTemplate());
  }
}

function fitChangelogColumn(columnKey) {
  const headerCell = document.querySelector(`.changelog-header-cell[data-column="${CSS.escape(columnKey)}"]`);
  const cells = Array.from(document.querySelectorAll(`.changelog-cell[data-column="${CSS.escape(columnKey)}"]`));
  const widths = [
    headerCell ? headerCell.scrollWidth : 0,
    ...cells.map((cell) => cell.scrollWidth)
  ];
  const nextWidth = Math.max(80, Math.min(700, Math.ceil(Math.max(...widths, 0) + 18)));
  state.changelog.columnWidths[columnKey] = nextWidth;
  updateChangelogColumnTemplate();
  return saveChangelogColumnWidths();
}

function bindChangelogTable() {
  const results = $('results');

  results.querySelectorAll('.changelog-row').forEach((rowElement) => {
    rowElement.addEventListener('click', () => {
      results.querySelectorAll('.changelog-row').forEach((item) => item.classList.remove('active'));
      rowElement.classList.add('active');
      showDetail(state.rows[Number(rowElement.dataset.index)]);
    });
  });

  results.querySelectorAll('.column-resizer').forEach((handle) => {
    handle.addEventListener('dblclick', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const columnKey = handle.closest('.changelog-header-cell')?.dataset.column;
      if (!columnKey) {
        return;
      }
      try {
        await fitChangelogColumn(columnKey);
      } catch (error) {
        console.error(error);
      }
    });

    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const headerCell = handle.closest('.changelog-header-cell');
      const columnKey = headerCell?.dataset.column;
      if (!columnKey) {
        return;
      }

      const startX = event.clientX;
      const startWidth = state.changelog.columnWidths[columnKey] || headerCell.getBoundingClientRect().width;
      handle.setPointerCapture(event.pointerId);

      const onPointerMove = (moveEvent) => {
        const nextWidth = Math.max(80, Math.min(700, startWidth + moveEvent.clientX - startX));
        state.changelog.columnWidths[columnKey] = Math.round(nextWidth);
        updateChangelogColumnTemplate();
      };

      const onPointerUp = async (upEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerUp);
        try {
          await saveChangelogColumnWidths();
        } catch (error) {
          console.error(error);
        }
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });
  });
}

function updateTableColumnTemplate() {
  const table = document.querySelector('.changelog-table');
  if (table) {
    table.style.setProperty('--changelog-columns', getTableGridTemplate());
  }
}

function fitTableColumn(columnKey) {
  const headerCell = document.querySelector(`.changelog-header-cell[data-column="${CSS.escape(columnKey)}"]`);
  const cells = Array.from(document.querySelectorAll(`.changelog-cell[data-column="${CSS.escape(columnKey)}"]`));
  const widths = [
    headerCell ? headerCell.scrollWidth : 0,
    ...cells.map((cell) => cell.scrollWidth)
  ];
  const nextWidth = Math.max(80, Math.min(700, Math.ceil(Math.max(...widths, 0) + 18)));
  setTableColumnWidth(columnKey, nextWidth);
  updateTableColumnTemplate();
  return saveTableColumnWidths();
}

function bindTableDataTable() {
  const results = $('results');

  results.querySelectorAll('.changelog-row').forEach((rowElement) => {
    rowElement.addEventListener('click', async () => {
      results.querySelectorAll('.changelog-row').forEach((item) => item.classList.remove('active'));
      rowElement.classList.add('active');
      await showTableDetail(state.currentView.key, rowElement.dataset.id);
    });
  });

  results.querySelectorAll('.column-resizer').forEach((handle) => {
    handle.addEventListener('dblclick', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const columnKey = handle.closest('.changelog-header-cell')?.dataset.column;
      if (!columnKey) {
        return;
      }
      try {
        await fitTableColumn(columnKey);
      } catch (error) {
        console.error(error);
      }
    });

    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const headerCell = handle.closest('.changelog-header-cell');
      const columnKey = headerCell?.dataset.column;
      if (!columnKey) {
        return;
      }

      const startX = event.clientX;
      const startWidth = getTableColumnWidth(columnKey) || headerCell.getBoundingClientRect().width;
      handle.setPointerCapture(event.pointerId);

      const onPointerMove = (moveEvent) => {
        const nextWidth = Math.max(80, Math.min(700, startWidth + moveEvent.clientX - startX));
        setTableColumnWidth(columnKey, Math.round(nextWidth));
        updateTableColumnTemplate();
      };

      const onPointerUp = async (upEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerUp);
        try {
          await saveTableColumnWidths();
        } catch (error) {
          console.error(error);
        }
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });
  });
}

function updateMappingSelectionUi() {
  const selectedCount = state.selectedMappings.size;

  document.querySelectorAll('.mapping-select-row[data-selection-type="mapping"]').forEach((rowElement) => {
    const row = state.rows[Number(rowElement.dataset.index)];
    if (!row) {
      return;
    }
    const selected = state.selectedMappings.has(getMappingSelectionKey(row));
    rowElement.classList.toggle('selected', selected);
    rowElement.querySelector('.mapping-card')?.classList.toggle('selected', selected);
    const dot = rowElement.querySelector('.mapping-select-dot');
    if (dot) {
      dot.classList.toggle('selected', selected);
      dot.setAttribute('aria-pressed', selected ? 'true' : 'false');
      dot.setAttribute('aria-label', selected ? 'Unselect mapping' : 'Select mapping');
    }
  });

  const countElement = $('selected-mapping-count');
  if (countElement) {
    countElement.textContent = `${selectedCount} selected entry mapping${selectedCount === 1 ? '' : 's'}`;
  }

  const bulkButton = $('bulk-status-save-btn');
  const bulkSelect = $('bulk-status-select');
  if (bulkButton) {
    bulkButton.disabled = selectedCount === 0;
  }
  if (bulkSelect) {
    bulkSelect.disabled = selectedCount === 0;
  }
}

function updateGroupSelectionUi() {
  const selectedCount = state.selectedGroups.size;

  document.querySelectorAll('.mapping-select-row[data-selection-type="group"]').forEach((rowElement) => {
    const row = state.rows[Number(rowElement.dataset.index)];
    if (!row) {
      return;
    }
    const selected = state.selectedGroups.has(getGroupSelectionKey(row));
    rowElement.classList.toggle('selected', selected);
    rowElement.querySelector('.entry-group-card')?.classList.toggle('selected', selected);
    const dot = rowElement.querySelector('.mapping-select-dot');
    if (dot) {
      dot.classList.toggle('selected', selected);
      dot.setAttribute('aria-pressed', selected ? 'true' : 'false');
      dot.setAttribute('aria-label', selected ? 'Unselect entry group' : 'Select entry group');
    }
  });

  const countElement = $('selected-group-count');
  if (countElement) {
    countElement.textContent = `${selectedCount} selected entry group${selectedCount === 1 ? '' : 's'}`;
  }

  const bulkButton = $('bulk-group-status-save-btn');
  const bulkSelect = $('bulk-group-status-select');
  if (bulkButton) {
    bulkButton.disabled = selectedCount === 0;
  }
  if (bulkSelect) {
    bulkSelect.disabled = selectedCount === 0;
  }
}

function updateIssueSelectionUi() {
  const selectedCount = state.selectedIssues.size;

  document.querySelectorAll('.mapping-select-row[data-selection-type="issue"]').forEach((rowElement) => {
    const row = state.rows[Number(rowElement.dataset.index)];
    if (!row) {
      return;
    }
    const selected = state.selectedIssues.has(getIssueSelectionKey(row));
    rowElement.classList.toggle('selected', selected);
    rowElement.querySelector('.mapping-card')?.classList.toggle('selected', selected);
    const dot = rowElement.querySelector('.mapping-select-dot');
    if (dot) {
      dot.classList.toggle('selected', selected);
      dot.setAttribute('aria-pressed', selected ? 'true' : 'false');
      dot.setAttribute('aria-label', selected ? 'Unselect issue' : 'Select issue');
    }
  });

  const countElement = $('selected-issue-count');
  if (countElement) {
    countElement.textContent = `${selectedCount} selected issue${selectedCount === 1 ? '' : 's'}`;
  }

  const bulkButton = $('bulk-resolve-issue-btn');
  if (bulkButton) {
    bulkButton.disabled = selectedCount === 0;
  }
}

function renderPagination() {
  const pagination = $('pagination');
  if (!['mapping', 'group', 'changelog', 'table'].includes(state.currentView.type)) {
    pagination.classList.add('hidden');
    pagination.innerHTML = '';
    return;
  }

  const pageState = state.currentView.type === 'mapping'
    ? state.mapping
    : state.currentView.type === 'group'
      ? state.group
      : state.currentView.type === 'changelog'
        ? state.changelog
        : state.table;
  if (pageState.total === 0) {
    pagination.classList.add('hidden');
    pagination.innerHTML = '';
    return;
  }

  const page = pageState.page;
  const pageCount = pageState.pageCount;
  pagination.classList.remove('hidden');
  pagination.innerHTML = `
    <button class="page-btn" type="button" data-page="1" ${page <= 1 ? 'disabled' : ''}>First</button>
    <button class="page-btn" type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
    <span class="page-status">Page ${page} of ${pageCount}</span>
    <button class="page-btn" type="button" data-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''}>Next</button>
    <button class="page-btn" type="button" data-page="${pageCount}" ${page >= pageCount ? 'disabled' : ''}>Last</button>
  `;

  pagination.querySelectorAll('.page-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextPage = Number(button.dataset.page);
      if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > pageCount || nextPage === page) {
        return;
      }
      if (state.currentView.type === 'mapping') {
        setMappingPage(state.currentView.key, nextPage);
        await selectMappingView(state.currentView.key);
      } else if (state.currentView.type === 'group') {
        state.group.page = nextPage;
        await selectGroupView();
      } else if (state.currentView.type === 'changelog') {
        state.changelog.page = nextPage;
        await selectChangelogView();
      } else {
        setTablePage(state.currentView.key, nextPage);
        await selectTableView(state.currentView.key);
      }
    });
  });
}

function renderDetailSection(title) {
  return `
    <h2 class="detail-section-title">${escapeHtml(title)}</h2>
  `;
}

function renderLocaleRows(titles) {
  if (!Array.isArray(titles) || titles.length === 0) {
    return '<div class="detail-extra-empty">No localized titles</div>';
  }

  return [...titles].sort((left, right) => (
    Number(getLocaleOptionValue(left?.localeValue ?? left?.locale ?? left?.localeLabel))
      - Number(getLocaleOptionValue(right?.localeValue ?? right?.locale ?? right?.localeLabel))
  )).map((item) => `
    <div class="detail-locale-row">
      <span class="detail-locale-code">${escapeHtml(item.locale)}</span>
      <span class="detail-locale-title ${item.fallback ? 'detail-locale-fallback' : ''}">${escapeHtml(item.title || '-')}</span>
    </div>
  `).join('');
}

function renderTitleExpansion(mainValue, titles) {
  return `
    <details class="detail-expand">
      <summary><span>${escapeHtml(mainValue || '-')}</span></summary>
      <div class="detail-extra-list">${renderLocaleRows(titles)}</div>
    </details>
  `;
}

function renderGroupedTitleExpansion(mainValue, groups) {
  const groupHtml = Array.isArray(groups) && groups.length
    ? groups.map((group) => `
      <div class="detail-title-box">
        <div class="detail-title-box-id">${escapeHtml(group.id ?? '-')}</div>
        ${renderLocaleRows(group.titles)}
      </div>
    `).join('')
    : '<div class="detail-extra-empty">No localized titles</div>';

  return `
    <details class="detail-expand">
      <summary><span>${escapeHtml(mainValue || '-')}</span></summary>
      <div class="detail-extra-list">${groupHtml}</div>
    </details>
  `;
}

function renderPairItem(label, entryValue, songValue, { entryHtml = false, songHtml = false, warning = false } = {}) {
  const entryValueHtml = entryHtml ? (entryValue || '-') : escapeHtml(entryValue ?? '-');
  const songValueHtml = songHtml ? (songValue || '-') : escapeHtml(songValue ?? '-');
  const warningClass = warning ? ' detail-warning' : '';

  return `
    <div class="detail-pair-item${warningClass}">
      <span class="detail-label">${escapeHtml(label)}${warning ? '<span class="warning-mark" title="Large fuzzy difference">!</span>' : ''}</span>
      <div class="detail-pair-values">
        <div class="detail-entry-value">${entryValueHtml}</div>
        <div class="detail-song-value">${songValueHtml}</div>
      </div>
    </div>
  `;
}

function renderSingleItem(label, value, { html = false } = {}) {
  const valueHtml = html ? (value || '-') : escapeHtml(value ?? '-');

  return `
    <div class="detail-single-item">
      <span class="detail-label">${escapeHtml(label)}</span>
      <div class="detail-single-value">${valueHtml}</div>
    </div>
  `;
}

function renderDetailAudioPlayer(audioUrl) {
  const cleanUrl = String(audioUrl || '').trim();
  if (!cleanUrl) {
    return '<span class="detail-empty-text">No audio</span>';
  }

  return `
    <div class="detail-audio-player" data-detail-audio-player data-audio-url="${escapeHtml(cleanUrl)}">
      <button class="detail-audio-button" type="button" data-detail-audio-toggle title="Play audio" aria-label="Play audio">
        ${audioPlayIcon}
      </button>
      <div class="detail-audio-track">
        <input class="detail-audio-range" type="range" min="0" max="100" value="0" step="0.01" data-detail-audio-range aria-label="Audio progress">
        <div class="detail-audio-times">
          <span data-detail-audio-current>0:00</span>
          <span data-detail-audio-duration>--:--</span>
        </div>
      </div>
    </div>
  `;
}

function bindDetailAudioPlayer() {
  document.querySelectorAll('[data-detail-audio-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      toggleDetailAudio(button);
    });
  });
  document.querySelectorAll('[data-detail-audio-range]').forEach((range) => {
    range.addEventListener('input', () => {
      seekDetailAudio(range);
    });
  });
}

function renderIssueResolveButton(row) {
  const resolved = Boolean(row.resolvedAt);
  return `
    <div class="issue-action-bar">
      <button id="resolve-issue-btn" class="status-save-btn" type="button" ${resolved ? 'disabled' : ''}>
        ${resolved ? 'Resolved' : 'Mark Resolved'}
      </button>
      <span id="resolve-issue-message" class="detail-message" aria-live="polite">${resolved ? `Resolved ${formatDate(row.resolvedAt)}` : ''}</span>
    </div>
  `;
}

function renderBulkIssueResolveButton() {
  const selectedCount = state.selectedIssues.size;
  return `
    <div class="issue-action-bar">
      <button id="bulk-resolve-issue-btn" class="status-save-btn" type="button" ${selectedCount === 0 ? 'disabled' : ''}>
        Mark Resolved
      </button>
      <span id="bulk-resolve-issue-message" class="detail-message" aria-live="polite"></span>
    </div>
  `;
}

function bindIssueResolveButton(row) {
  const button = $('resolve-issue-btn');
  if (!button || row.resolvedAt) {
    return;
  }

  button.addEventListener('click', async () => {
    const message = $('resolve-issue-message');
    button.disabled = true;
    message.textContent = 'Saving...';
    try {
      const payload = await fetchJson(`/api/issues/${encodeURIComponent(row.issueId)}/resolve`, {
        method: 'PATCH'
      });
      row.resolvedAt = payload.resolvedAt;
      message.textContent = `Resolved ${formatDate(row.resolvedAt)}`;
      await refreshCurrentView();
    } catch (error) {
      button.disabled = false;
      message.textContent = error.message;
    }
  });
}

function bindBulkIssueResolveButton() {
  const button = $('bulk-resolve-issue-btn');
  if (!button) {
    return;
  }

  button.addEventListener('click', async () => {
    const issueIds = getSelectedIssueIds();
    const message = $('bulk-resolve-issue-message');
    if (!issueIds.length) {
      message.textContent = 'No selected issues';
      return;
    }

    button.disabled = true;
    message.textContent = 'Saving...';
    try {
      const payload = await fetchJson('/api/issues/resolve', {
        method: 'PATCH',
        body: JSON.stringify({ issueIds })
      });
      message.textContent = `Resolved ${payload.resolvedCount || issueIds.length} issue${(payload.resolvedCount || issueIds.length) === 1 ? '' : 's'}`;
      state.selectedIssues.clear();
      state.issueSelectionAnchorIndex = null;
      await refreshCurrentView();
    } catch (error) {
      message.textContent = error.message;
      updateIssueSelectionUi();
    }
  });
}

function renderGroupStatusEditor(row) {
  return `
    <form id="group-status-form" class="mapping-status-editor">
      <label>
        <span class="detail-label">Entry Group Status</span>
        <select id="group-status-select">
          <option value="CONFIRMED" ${row.status === 'CONFIRMED' ? 'selected' : ''}>Confirmed</option>
          <option value="PENDING" ${row.status === 'PENDING' ? 'selected' : ''}>Pending</option>
          <option value="REJECTED" ${row.status === 'REJECTED' ? 'selected' : ''}>Rejected</option>
        </select>
      </label>
      <button class="status-save-btn" type="submit">Save</button>
      <span id="group-status-message" class="detail-message" aria-live="polite"></span>
      <label class="status-checkbox-row">
        <input id="group-create-song-checkbox" type="checkbox" ${state.group.createSongOnConfirm ? 'checked' : ''}>
        <span>Create song</span>
      </label>
    </form>
  `;
}

function renderBulkGroupStatusEditor() {
  const selectedCount = state.selectedGroups.size;
  return `
    <form id="bulk-group-status-form" class="mapping-status-editor bulk-status-editor">
      <label>
        <span class="detail-label">Selected Group Status</span>
        <select id="bulk-group-status-select" ${selectedCount === 0 ? 'disabled' : ''}>
          <option value="CONFIRMED">Confirmed</option>
          <option value="PENDING">Pending</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      <button id="bulk-group-status-save-btn" class="status-save-btn" type="submit" ${selectedCount === 0 ? 'disabled' : ''}>Save</button>
      <span id="bulk-group-status-message" class="detail-message" aria-live="polite"></span>
    </form>
  `;
}

function renderPreviewEmpty() {
  return '<p class="preview-empty">-</p>';
}

function renderPreviewRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return renderPreviewEmpty();
  }

  return `
    <dl class="preview-field-grid">
      ${rows.map(([label, value, options = {}]) => `
        <dt>${escapeHtml(label)}</dt>
        <dd class="${options.danger ? 'preview-danger-text' : ''}">${escapeHtml(value === null || value === undefined || value === '' ? '-' : value)}</dd>
      `).join('')}
    </dl>
  `;
}

function renderSongPreviewEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return renderPreviewEmpty();
  }

  return entries.map((entry) => `
    <article class="preview-mini-card">
      <h4>Entry ${escapeHtml(entry.entryId)}</h4>
      ${renderPreviewRows([
        ['Title', entry.rawTitle],
        ['Artist', entry.rawArtist],
        ['Album', entry.rawAlbum],
        ['Duration', formatDuration(entry.rawDuration)]
      ])}
    </article>
  `).join('');
}

function renderSongPreviewTitleList(titles) {
  if (!Array.isArray(titles) || !titles.length) {
    return `
      <div class="preview-title-list" data-title-list>
        ${renderPreviewEmpty()}
        <button class="preview-add-btn" type="button" data-preview-add-title>Add Title</button>
      </div>
    `;
  }
  const fallbackGroupName = `fallback-${Math.random().toString(36).slice(2)}`;

  return `
    <div class="preview-title-list" data-title-list>
      ${titles.map((title) => {
    const titleInput = `<input data-title-value value="${escapeHtml(title.title || '')}" aria-label="Title">`;
    return `
        <div class="preview-title-row ${title.fallback ? 'preview-title-fallback' : ''}">
          ${renderLocaleSelect(title.localeValue ?? title.locale ?? title.localeLabel, 'data-title-locale', 'Title locale')}
          ${title.searchType === null ? titleInput : renderSearchInput(titleInput, title.searchType || 'song', 'Search by title')}
          <label class="preview-inline-option">
            <input data-title-fallback type="radio" name="${fallbackGroupName}" ${title.fallback ? 'checked' : ''}>
            Fallback
          </label>
          ${renderIconButton('remove-title', 'Remove title', 'danger')}
        </div>
      `;
  }).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-title>Add Title</button>
    </div>
  `;
}

function renderPreviewAliasList(aliases) {
  if (!Array.isArray(aliases) || !aliases.length) {
    return '-';
  }

  return aliases.join(' . ');
}

function getAlbumTypeOptionValue(value) {
  const raw = String(value ?? '').trim();
  const match = Object.entries(enumLabels.album_type).find(([optionValue, label]) => (
    raw === optionValue || raw.toLowerCase() === label.toLowerCase()
  ));
  return match?.[0] || '';
}

function isCompilationAlbumType(value) {
  const optionValue = getAlbumTypeOptionValue(value);
  const label = enumLabels.album_type[optionValue] || value;
  return String(label || '').trim().toLowerCase().replace(/[\s_-]+/g, '') === 'compilation'
    || String(label || '').trim().toLowerCase().replace(/[\s_-]+/g, '') === 'compilations';
}

function renderAliasEditor(aliases) {
  const rows = Array.isArray(aliases) && aliases.length ? aliases : [''];
  return `
    <div class="preview-alias-list" data-alias-list>
      ${rows.map((alias) => `
        <div class="preview-alias-row">
          <input data-artist-alias value="${escapeHtml(alias)}" aria-label="Artist alias">
          ${renderIconButton('remove-alias', 'Remove alias', 'danger')}
        </div>
      `).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-alias>Add Alias</button>
    </div>
  `;
}

function getPreviewAuthoritySortValue(authority) {
  return Number.isInteger(Number(authority.authorityValue))
    ? Number(authority.authorityValue)
    : Number(authority.authority);
}

function getPreviewAuthorityLabel(authority) {
  return authority.authorityLabel || authority.authority || '-';
}

function renderPreviewAuthorityLinkButton() {
  return renderIconButton('authority-link', 'Open authority link', 'inactive').replace('data-preview-authority-link', 'data-preview-authority-link disabled');
}

function renderSongPreviewAuthorities(authorities) {
  const rows = Array.isArray(authorities) ? authorities : [];
  return `
    <div class="preview-authority-list" data-authority-list>
      ${rows.map((authority) => `
      <div class="preview-authority-row">
        <select data-authority-kind aria-label="Authority">
          ${Object.entries(enumLabels.source_type).map(([value, label]) => `
            <option value="${escapeHtml(value)}" ${Number(value) === getPreviewAuthoritySortValue(authority) ? 'selected' : ''}>${escapeHtml(label)}</option>
          `).join('')}
        </select>
        <input data-authority-code value="${escapeHtml(authority.code || '')}" aria-label="Authority code">
        ${renderPreviewAuthorityLinkButton()}
        ${renderIconButton('remove-authority', 'Remove authority', 'danger')}
      </div>
    `).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-authority>Add Authority</button>
    </div>
  `;
}

function renderPreviewDetailRow(label, value, options = {}) {
  const valueHtml = options.html
    ? value
    : escapeHtml(value === null || value === undefined || value === '' ? '-' : value);

  return `
    <div class="preview-detail-row">
      <h5>${escapeHtml(label)}</h5>
      <div class="${options.danger ? 'preview-danger-text' : ''}">${valueHtml}</div>
    </div>
  `;
}

function renderSongPreviewLocales(locales, primaryLocale) {
  const rows = Array.isArray(locales) && locales.length
    ? locales
    : [{ locale: primaryLocale || '1', localeLabel: primaryLocale || 'und', isPrimary: true }];
  const groupName = `primary-locale-${Math.random().toString(36).slice(2)}`;

  return `
    <div class="preview-locale-list" data-locale-list>
      ${rows.map((locale) => `
        <div class="preview-locale-edit-row">
          ${renderLocaleSelect(locale.localeValue ?? locale.locale ?? locale.localeLabel, 'data-song-locale-item', 'Song locale')}
          <label class="preview-inline-option">
            <input data-song-locale-primary type="radio" name="${groupName}" ${locale.isPrimary ? 'checked' : ''}>
            Primary
          </label>
          ${renderIconButton('remove-locale', 'Remove locale', 'danger')}
        </div>
      `).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-locale>Add Locale</button>
    </div>
  `;
}

function getArtistFallbackTitle(artist, fallback = 'Untitled Artist') {
  return pickDisplayTitle(artist?.titles, artist?.title || fallback);
}

function hasSongArtistReference(artist) {
  const rawIndex = artist?.songArtistIndex;
  if (rawIndex === null || rawIndex === undefined || rawIndex === '') {
    return false;
  }
  const index = Number(rawIndex);
  return Number.isInteger(index) && index >= 0;
}

function renderSongArtistReferenceSelect(artist, songArtists) {
  const selectedIndex = hasSongArtistReference(artist) ? Number(artist.songArtistIndex) : -1;
  const options = (Array.isArray(songArtists) ? songArtists : [])
    .map((songArtist, index) => ({ songArtist, index }))
    .filter(({ songArtist }) => songArtist?.artistId || songArtist?.createMissing);

  return `
    <select data-song-artist-reference aria-label="Use song artist">
      <option value="">Separate album artist</option>
      ${options.map(({ songArtist, index }) => `
        <option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${escapeHtml(getArtistFallbackTitle(songArtist))}</option>
      `).join('')}
    </select>
  `;
}

function renderSongPreviewArtistDetail(artist, index = null, options = {}) {
  const heading = index === null
    ? 'Artist'
    : `Artist ${index + 1}`;
  const referencesSongArtist = hasSongArtistReference(artist);
  const isMissing = !artist.artistId && !artist.createMissing && !referencesSongArtist;

  return `
    <article class="preview-detail-card ${isMissing ? 'preview-card-danger' : ''}" data-artist-card data-artist-metadata-loaded="${artist.metadataLoaded ? 'true' : 'false'}">
      <div class="preview-card-heading">
        <h4>${escapeHtml(heading)}</h4>
        ${renderIconButton('remove-artist', 'Remove artist', 'danger')}
      </div>
      ${options.albumArtist ? renderPreviewDetailRow('Use Song Artist', renderSongArtistReferenceSelect(artist, options.songArtists), { html: true }) : ''}
      ${referencesSongArtist ? `
        <div class="preview-reference-note">
          Using ${escapeHtml(getArtistFallbackTitle(options.songArtists?.[Number(artist.songArtistIndex)]))}. Edit this artist in the Song Artists section above.
        </div>
      ` : `
      ${renderPreviewDetailRow('Artist ID', `
        ${renderSearchInput(`<input data-artist-id value="${escapeHtml(artist.artistId || '')}" aria-label="Artist ID">`, 'artist', 'Search artist')}
        ${!artist.artistId && !referencesSongArtist ? `
          <label class="preview-inline-option preview-create-missing">
            <input data-artist-create-missing type="checkbox" ${artist.createMissing ? 'checked' : ''}>
            Create artist
          </label>
        ` : ''}
      `, { html: true, danger: !artist.artistId })}
      ${!options.albumArtist ? renderPreviewDetailRow('Display Title', `<input data-artist-display-title value="${escapeHtml(artist.displayTitle || '')}" placeholder="Use fallback title" aria-label="Artist display title">`, { html: true }) : ''}
      ${!options.albumArtist ? renderPreviewDetailRow('Role', renderArtistRoleSelect(artist.role ?? 0), { html: true }) : ''}
      ${renderPreviewDetailRow('Artist Tag', renderFlagDropdown(flagLabels.artist_tag, artist.artistTag ?? artist.artist_tag ?? 0, 'data-artist-tag'), { html: true })}
      <section class="preview-subsection">
        <h5>Titles</h5>
        ${renderSongPreviewTitleList((artist.titles || []).map((title) => ({ ...title, searchType: 'artist' })))}
      </section>
      ${renderPreviewDetailRow('Alias', renderAliasEditor(artist.aliases), { html: true })}
      ${renderPreviewDetailRow('Artwork', renderArtworkInput(artist.artwork, 'data-artist-artwork', 'Artist artwork'), { html: true })}
      <section class="preview-subsection">
        <h5>Authority</h5>
        ${renderSongPreviewAuthorities(artist.authorities)}
      </section>
      `}
    </article>
  `;
}

function renderSongPreviewArtists(artists, options = {}) {
  if (!Array.isArray(artists) || !artists.length) {
    return '<div class="preview-card-list" data-artist-list><button class="preview-add-btn" type="button" data-preview-add-artist>Add Artist</button></div>';
  }

  return `
    <div class="preview-card-list" data-artist-list>
      ${artists.map((artist, index) => renderSongPreviewArtistDetail(artist, index, options)).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-artist>Add Artist</button>
    </div>
  `;
}

function renderSongPreviewAlbums(albums, songArtists = []) {
  if (!Array.isArray(albums) || !albums.length) {
    return `${renderPreviewEmpty()}<button class="preview-add-btn" type="button" data-preview-add-album>Add Album</button>`;
  }

  return albums.map((album) => {
    const disc = `${album.discNumber || '-'}/${album.discCount || '-'}`;
    const track = `${album.trackNumber || '-'}/${album.trackCount || '-'}`;
    const isMissing = !album.albumId && !album.createMissing;

    return `
      <article class="preview-detail-card ${isMissing ? 'preview-card-danger' : ''}" data-album-card>
        <div class="preview-card-heading">
          <h4>Album</h4>
          ${renderIconButton('remove-album', 'Remove album', 'danger')}
        </div>
        ${renderPreviewDetailRow('Album ID', `
          ${renderSearchInput(`<input data-album-id value="${escapeHtml(album.albumId || '')}" aria-label="Album ID">`, 'album', 'Search album')}
          ${!album.albumId ? `
            <label class="preview-inline-option preview-create-missing">
              <input data-album-create-missing type="checkbox" ${album.createMissing ? 'checked' : ''}>
              Create album
            </label>
          ` : ''}
        `, { html: true, danger: !album.albumId })}
        <section class="preview-subsection">
          <h5>Titles</h5>
          ${renderSongPreviewTitleList((album.titles || []).map((title) => ({ ...title, searchType: 'album' })))}
        </section>
        ${renderPreviewDetailRow('Disc', renderNumberPair(album.discNumber, album.discCount, 'data-album-disc-number', 'data-album-disc-count', 'Disc'), { html: true })}
        ${renderPreviewDetailRow('Track', renderNumberPair(album.trackNumber, album.trackCount, 'data-album-track-number', 'data-album-track-count', 'Track'), { html: true })}
        ${renderPreviewDetailRow('Type', `
          <select data-album-type aria-label="Album type">
            ${renderEnumOptions(enumLabels.album_type, getAlbumTypeOptionValue(album.albumType), { includeEmpty: true })}
          </select>
        `, { html: true })}
        <section class="preview-subsection">
          <h5>Artists</h5>
          ${renderSongPreviewArtists(album.artists, { albumArtist: true, songArtists })}
        </section>
        ${renderPreviewDetailRow('Artwork', renderArtworkInput(album.artwork, 'data-album-artwork', 'Album artwork'), { html: true })}
        ${renderPreviewDetailRow('Release Date', `<input data-album-release-date type="date" value="${escapeHtml((album.releaseDate || '').slice(0, 10))}" aria-label="Album release date">`, { html: true })}
        <section class="preview-subsection">
          <h5>Authority</h5>
          ${renderSongPreviewAuthorities(album.authorities)}
        </section>
      </article>
    `;
  }).join('') + '<button class="preview-add-btn" type="button" data-preview-add-album>Add Album</button>';
}

function getPreviewArtists(song, { includeCompilationAlbumArtists = true } = {}) {
  const artists = Array.isArray(song?.artists) ? [...song.artists] : [];
  for (const album of Array.isArray(song?.albums) ? song.albums : []) {
    if (Array.isArray(album.artists) && (includeCompilationAlbumArtists || !isCompilationAlbumType(album.albumType))) {
      artists.push(...album.artists);
    }
  }
  return artists;
}

function getTitleValidationErrors(titles, label, { required = false } = {}) {
  const errors = [];
  const normalized = (Array.isArray(titles) ? titles : [])
    .map((title) => ({
      locale: getLocaleOptionValue(title.localeValue ?? title.locale ?? title.localeLabel),
      title: String(title.title || '').trim(),
      fallback: Boolean(title.fallback)
    }))
    .filter((title) => title.locale && title.title);

  if (required && !normalized.length) {
    errors.push(`${label} must have at least one title.`);
    return errors;
  }

  const seen = new Set();
  for (const title of normalized) {
    if (seen.has(title.locale)) {
      errors.push(`${label} has duplicated title locale: ${enumLabels.locale[title.locale] || title.locale}.`);
    }
    seen.add(title.locale);
  }

  if (normalized.length && normalized.filter((title) => title.fallback).length !== 1) {
    errors.push(`${label} must have exactly one fallback title.`);
  }

  return errors;
}

function getArtistValidationErrors(artist, label) {
  if (hasSongArtistReference(artist)) {
    return [];
  }
  const requiresTitle = !artist?.artistId && Boolean(artist?.createMissing);
  const titleLabel = artist?.artistId ? `Artist ${artist.artistId}` : label;
  return getTitleValidationErrors(artist?.titles, titleLabel, { required: requiresTitle });
}

function getPreviewValidationErrors(preview) {
  const errors = [
    ...getTitleValidationErrors(preview.song?.titles, 'Song', { required: true })
  ];

  for (const artist of Array.isArray(preview.song?.artists) ? preview.song.artists : []) {
    errors.push(...getArtistValidationErrors(artist, !artist?.artistId && artist?.createMissing ? 'New Artist' : 'Song artist'));
  }

  for (const album of Array.isArray(preview.song?.albums) ? preview.song.albums : []) {
    const albumLabel = album?.albumId ? `Album ${album.albumId}` : (!album?.albumId && album?.createMissing ? 'New Album' : 'Album');
    errors.push(...getTitleValidationErrors(album?.titles, albumLabel, { required: !album?.albumId && Boolean(album?.createMissing) }));
    if (!isCompilationAlbumType(album?.albumType)) {
      for (const artist of Array.isArray(album?.artists) ? album.artists : []) {
        errors.push(...getArtistValidationErrors(artist, !artist?.artistId && artist?.createMissing ? 'New Artist' : 'Album artist'));
      }
    }
  }

  return errors;
}

function hasExactlyOneChecked(rows, key) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    return true;
  }
  return items.filter((row) => Boolean(row?.[key])).length === 1;
}

function hasResolvedFallbackTitleLocaleIssue(preview) {
  const groups = [
    [preview.song?.titles, 'fallback'],
    [preview.song?.locales, 'isPrimary']
  ];

  for (const artist of Array.isArray(preview.song?.artists) ? preview.song.artists : []) {
    if (!hasSongArtistReference(artist)) {
      groups.push([artist.titles, 'fallback']);
    }
  }

  for (const album of Array.isArray(preview.song?.albums) ? preview.song.albums : []) {
    groups.push([album.titles, 'fallback']);
    for (const artist of Array.isArray(album?.artists) ? album.artists : []) {
      if (!hasSongArtistReference(artist)) {
        groups.push([artist.titles, 'fallback']);
      }
    }
  }

  return groups.every(([rows, key]) => hasExactlyOneChecked(rows, key));
}

function getVisiblePreviewErrors(preview) {
  const errors = Array.isArray(preview.errors) ? preview.errors : [];
  const hasMissingArtist = getPreviewArtists(preview.song, { includeCompilationAlbumArtists: false })
    .some((artist) => !artist.artistId && !artist.createMissing && !hasSongArtistReference(artist));
  const hasMissingAlbum = (Array.isArray(preview.song?.albums) ? preview.song.albums : [])
    .some((album) => !album.albumId && !album.createMissing);

  const filteredErrors = errors.filter((error) => {
    if (
      String(error).startsWith('Referenced artist authority was not found:')
      || String(error).includes('artists contains a missing or invalid artist ID.')
    ) {
      return hasMissingArtist;
    }
    if (
      String(error).startsWith('Referenced album authority was not found:')
      || String(error).includes('Albums contains a missing or invalid album ID.')
    ) {
      return hasMissingAlbum;
    }
    if (String(error) === fallbackTitleLocaleError) {
      return !hasResolvedFallbackTitleLocaleIssue(preview);
    }
    return true;
  });
  return [...new Set([...filteredErrors, ...getPreviewValidationErrors(preview)])];
}

function renderSongCreationPreview(preview) {
  const errors = getVisiblePreviewErrors(preview);
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const hasErrors = errors.length > 0;

  return `
    <div class="preview-status ${hasErrors ? 'preview-status-danger' : 'preview-status-ok'}">
      ${hasErrors
        ? 'This song cannot be created yet. Review the blocking issues below.'
        : 'Review the merged entries and fields before creating the song.'}
    </div>
    ${errors.length ? `
      <section class="preview-section preview-blocking">
        <h3>Blocking Issues</h3>
        <ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>
      </section>
    ` : ''}
    ${warnings.length ? `
      <section class="preview-section preview-warnings">
        <h3>Warnings</h3>
        <ul>${warnings.map((warning) => `<li>${escapeHtml(warning.message || JSON.stringify(warning))}</li>`).join('')}</ul>
      </section>
    ` : ''}
    <section class="preview-section" data-song-titles>
      <h3>Titles</h3>
      ${renderSongPreviewTitleList(preview.song?.titles)}
    </section>
    <section class="preview-section" data-song-artists>
      <h3>Artists</h3>
      ${renderSongPreviewArtists(preview.song?.artists)}
    </section>
    <section class="preview-section" data-song-albums>
      <h3>Albums</h3>
      <div class="preview-card-list" data-album-list>${renderSongPreviewAlbums(preview.song?.albums, preview.song?.artists)}</div>
    </section>
    <section class="preview-section preview-song-scalar-section">
      ${renderPreviewDetailRow('Target Song ID', `<input data-song-target-id value="${escapeHtml(preview.targetSongId || '')}" placeholder="New song" aria-label="Target song ID">`, { html: true })}
      ${renderPreviewDetailRow('Audio', renderAudioInput(preview.song?.audio, 'data-song-audio', 'Audio'), { html: true })}
      ${renderPreviewDetailRow('Vocal', `
        <select data-song-vocal aria-label="Vocal">
          ${renderEnumOptions(enumLabels.vocal, preview.song?.vocal ?? 4)}
        </select>
      `, { html: true })}
      ${renderPreviewDetailRow('Locale', renderSongPreviewLocales(preview.song?.locales, preview.song?.localeLabel || preview.song?.locale), { html: true })}
      ${renderPreviewDetailRow('Genre Tag', renderFlagDropdown(flagLabels.genre_tag, preview.song?.genreTag ?? 0, 'data-song-genre-tag'), { html: true })}
      ${renderPreviewDetailRow('Genre Info', `
        <select data-song-genre-info aria-label="Genre info">
          ${renderEnumOptions(enumLabels.genre_info, preview.song?.genreInfo ?? 0)}
        </select>
      `, { html: true })}
      ${renderPreviewDetailRow('Media Tag', renderFlagDropdown(flagLabels.media_tag, preview.song?.mediaTag ?? 0, 'data-song-media-tag'), { html: true })}
      ${renderPreviewDetailRow('Duration', `<input data-song-duration type="number" min="1" value="${escapeHtml(preview.song?.duration || '')}" aria-label="Duration">`, { html: true })}
      ${renderPreviewDetailRow('Release Date', `<input data-song-release-date type="date" value="${escapeHtml((preview.song?.releaseDate || '').slice(0, 10))}" aria-label="Release date">`, { html: true })}
    </section>
    <section class="preview-section" data-song-authorities>
      <h3>Authority</h3>
      ${renderSongPreviewAuthorities(preview.song?.authorities)}
    </section>
    <section class="preview-section">
      <h3>Entries To Merge</h3>
      <div class="preview-card-list">${renderSongPreviewEntries(preview.entries)}</div>
    </section>
  `;
}

function clonePreview(preview) {
  return JSON.parse(JSON.stringify(preview || {}));
}

function getElementValue(root, selector, fallback = '') {
  const element = root.querySelector(selector);
  return element ? element.value : fallback;
}

function collectTitleList(root) {
  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll(':scope > .preview-title-row')).map((row) => ({
    locale: getElementValue(row, '[data-title-locale]', 'und'),
    localeValue: Number(getElementValue(row, '[data-title-locale]', '1')),
    localeLabel: enumLabels.locale[getElementValue(row, '[data-title-locale]', '1')] || 'und',
    title: getElementValue(row, '[data-title-value]', ''),
    fallback: Boolean(row.querySelector('[data-title-fallback]')?.checked)
  })).filter((title) => title.locale || title.title);
}

function collectAuthorityList(root) {
  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll(':scope > .preview-authority-row')).map((row) => {
    const authorityValue = Number(getElementValue(row, '[data-authority-kind]', ''));
    return {
      authority: authorityValue,
      authorityValue,
      authorityLabel: enumLabels.source_type[authorityValue] || String(authorityValue),
      code: getElementValue(row, '[data-authority-code]', '')
    };
  }).filter((authority) => Number.isInteger(authority.authorityValue) && authority.code);
}

function collectFlagValue(root) {
  if (!root) {
    return 0;
  }

  return Array.from(root.querySelectorAll('input[type="checkbox"]:checked'))
    .reduce((value, input) => value + Number(input.value || 0), 0);
}

function updateFlagDropdownSummary(dropdown) {
  if (!dropdown) {
    return;
  }

  const summary = dropdown.querySelector('[data-flag-summary]');
  if (!summary) {
    return;
  }

  const labels = dropdown.matches('[data-song-media-tag], [data-edit-media-tag]')
    ? flagLabels.media_tag
    : dropdown.matches('[data-artist-tag], [data-edit-artist-tag]')
      ? flagLabels.artist_tag
    : flagLabels.genre_tag;
  summary.textContent = getFlagSummary(labels, collectFlagValue(dropdown));
}

function collectLocaleList(root) {
  if (!root) {
    return [];
  }

  const rows = Array.from(root.querySelectorAll(':scope > .preview-locale-edit-row')).map((row) => {
    const localeValue = getElementValue(row, '[data-song-locale-item]', '1');
    return {
      locale: localeValue,
      localeValue: Number(localeValue),
      localeLabel: enumLabels.locale[localeValue] || 'und',
      isPrimary: Boolean(row.querySelector('[data-song-locale-primary]')?.checked)
    };
  });

  if (rows.length && !rows.some((row) => row.isPrimary)) {
    rows[0].isPrimary = true;
  }

  return rows;
}

function collectAliasList(root) {
  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll(':scope > .preview-alias-row [data-artist-alias]'))
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function collectArtistCard(card) {
  const songArtistIndexValue = getElementValue(card, '[data-song-artist-reference]', '');
  const songArtistIndex = songArtistIndexValue === '' ? null : Number(songArtistIndexValue);

  return {
    artistId: Number(getElementValue(card, '[data-artist-id]', '')),
    songArtistIndex: Number.isInteger(songArtistIndex) && songArtistIndex >= 0 ? songArtistIndex : null,
    displayTitle: getElementValue(card, '[data-artist-display-title]', '').trim() || null,
    role: Number(getElementValue(card, '[data-artist-role]', '0')),
    artistTag: collectFlagValue(card.querySelector('[data-artist-tag]')),
    metadataLoaded: card.dataset.artistMetadataLoaded === 'true',
    title: collectTitleList(card.querySelector(':scope > .preview-subsection [data-title-list]'))[0]?.title || '',
    titles: collectTitleList(card.querySelector(':scope > .preview-subsection [data-title-list]')),
    createMissing: Boolean(card.querySelector('[data-artist-create-missing]')?.checked),
    aliases: collectAliasList(card.querySelector('[data-alias-list]')),
    artwork: getElementValue(card, '[data-artist-artwork]', ''),
    authorities: collectAuthorityList(card.querySelector(':scope > .preview-subsection [data-authority-list]'))
  };
}

function collectArtistList(root) {
  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll(':scope > [data-artist-card]')).map(collectArtistCard);
}

function collectAlbumCard(card) {
  const titleList = card.querySelector(':scope > .preview-subsection [data-title-list]');
  const artistList = Array.from(card.querySelectorAll(':scope > .preview-subsection [data-artist-list]'))[0];
  const authorityList = Array.from(card.querySelectorAll(':scope > .preview-subsection [data-authority-list]')).at(-1);

  return {
    albumId: Number(getElementValue(card, '[data-album-id]', '')),
    createMissing: Boolean(card.querySelector('[data-album-create-missing]')?.checked),
    title: collectTitleList(titleList)[0]?.title || '',
    titles: collectTitleList(titleList),
    albumType: getElementValue(card, '[data-album-type]', ''),
    artwork: getElementValue(card, '[data-album-artwork]', ''),
    releaseDate: getElementValue(card, '[data-album-release-date]', ''),
    discNumber: Number(getElementValue(card, '[data-album-disc-number]', '')),
    discCount: Number(getElementValue(card, '[data-album-disc-count]', '')),
    trackNumber: Number(getElementValue(card, '[data-album-track-number]', '')),
    trackCount: Number(getElementValue(card, '[data-album-track-count]', '')),
    artists: collectArtistList(artistList),
    authorities: collectAuthorityList(authorityList)
  };
}

function collectAlbumList(root) {
  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll(':scope > [data-album-card]')).map(collectAlbumCard);
}

function collectPreviewPlan(content, preview) {
  const plan = clonePreview(preview);
  plan.targetSongId = Number(getElementValue(content, '[data-song-target-id]', '')) || null;
  const locales = collectLocaleList(content.querySelector('[data-locale-list]'));
  const primaryLocale = locales.find((locale) => locale.isPrimary) || locales[0];
  plan.song = {
    ...plan.song,
    targetSongId: plan.targetSongId,
    audio: getElementValue(content, '[data-song-audio]', ''),
    titles: collectTitleList(content.querySelector('[data-song-titles] [data-title-list]')),
    artists: collectArtistList(content.querySelector('[data-song-artists] [data-artist-list]')),
    albums: collectAlbumList(content.querySelector('[data-song-albums] [data-album-list]')),
    vocal: Number(getElementValue(content, '[data-song-vocal]', '4')),
    locales,
    locale: primaryLocale?.localeValue ?? 1,
    localeLabel: primaryLocale?.localeLabel ?? 'und',
    genreTag: collectFlagValue(content.querySelector('[data-song-genre-tag]')),
    genreInfo: Number(getElementValue(content, '[data-song-genre-info]', '0')),
    mediaTag: collectFlagValue(content.querySelector('[data-song-media-tag]')),
    duration: Number(getElementValue(content, '[data-song-duration]', '0')),
    releaseDate: getElementValue(content, '[data-song-release-date]', ''),
    authorities: collectAuthorityList(content.querySelector('[data-song-authorities] [data-authority-list]'))
  };
  return plan;
}

function getPreviewCollectionIndex(element, selector) {
  const card = element.closest(selector);
  if (!card || !card.parentElement) {
    return -1;
  }

  return Array.from(card.parentElement.querySelectorAll(`:scope > ${selector}`)).indexOf(card);
}

function getSearchTerm(button) {
  const referenceRow = button.closest('[data-reference-artist-row], [data-reference-album-row], [data-album-track-row], [data-artist-relation-row], [data-artist-merge-row], [data-entry-group-row], [data-entry-mapping-row]');
  if (referenceRow) {
    const label = referenceRow.querySelector('.preview-reference-label')?.textContent?.trim();
    const value = referenceRow.querySelector('input[type="number"]')?.value?.trim();
    if (referenceRow.matches('[data-entry-mapping-row]') && !value) {
      return '';
    }
    if (referenceRow.matches('[data-entry-group-row]') && !value) {
      return '';
    }
    return label && !/^Artist $|^Album $|^Song $/.test(label) ? label : value || '';
  }

  const titleRow = button.closest('.preview-title-row');
  if (titleRow) {
    return getElementValue(titleRow, '[data-title-value]', '');
  }

  const card = button.closest('[data-artist-card], [data-album-card]');
  if (card) {
    return collectTitleList(card.querySelector('[data-title-list]'))[0]?.title || '';
  }

  return '';
}

function renderPreviewSearchResults(rows, type) {
  if (!Array.isArray(rows) || !rows.length) {
    return '<p class="preview-empty">No similar item was found.</p>';
  }

  return rows.map((row, index) => {
    const year = row.meta?.year ? ` (${row.meta.year})` : '';
    const artist = row.meta?.artist || '';
    return `
      <button class="preview-search-result" type="button" data-preview-use-search="${index}" data-preview-use-type="${escapeHtml(type)}">
        <span class="preview-search-result-main">
          <span class="preview-search-result-title">${escapeHtml(row.label || `${type} ${row.id}`)}${escapeHtml(year)}</span>
          ${artist ? `<span class="preview-search-result-meta">${escapeHtml(artist)}</span>` : ''}
        </span>
        <span class="preview-search-result-id">ID ${escapeHtml(row.id)}</span>
      </button>
    `;
  }).join('');
}

function renderPreviewSearchBox(type, query = '') {
  const placeholder = type === 'entry-group'
    ? 'Search by group, canonical song, or entry'
    : 'Search by title, alias, or authority';
  return `
    <div class="preview-side-search">
      <label>
        <span>Search ${escapeHtml(type)}</span>
        <input data-preview-side-search-input type="search" value="${escapeHtml(query)}" placeholder="${escapeHtml(placeholder)}">
      </label>
      <button class="preview-small-btn" type="button" data-preview-side-search-run="${escapeHtml(type)}">Search</button>
    </div>
    <div data-preview-side-search-results></div>
  `;
}

function closePreviewSearchPanel() {
  const resultsPanel = $('preview-search-results');
  if (!resultsPanel) {
    return;
  }
  resultsPanel.classList.add('hidden');
  resultsPanel.innerHTML = '';
  resultsPanel.style.left = '';
  resultsPanel.style.top = '';
  resultsPanel.style.width = '';
  resultsPanel.style.maxHeight = '';
}

async function searchPreviewSidePanel(type, query) {
  const resultsPanel = $('preview-search-results');
  resultsPanel.classList.remove('hidden');
  positionPreviewSearchResults();
  resultsPanel.innerHTML = `
    <div class="preview-search-header">
      <h3>Search ${escapeHtml(type)}</h3>
      <button class="modal-icon-button preview-search-close" type="button" data-preview-close-search aria-label="Close search">×</button>
    </div>
    ${renderPreviewSearchBox(type, query)}
  `;
  const resultContainer = resultsPanel.querySelector('[data-preview-side-search-results]');
  const input = resultsPanel.querySelector('[data-preview-side-search-input]');
  if (!query.trim()) {
    resultContainer.innerHTML = '<p class="preview-empty">Enter a search term.</p>';
    input?.focus();
    positionPreviewSearchResults();
    return [];
  }

  resultContainer.innerHTML = '<p class="preview-empty">Searching...</p>';
  const hideSearchToast = showSearchToast(`Searching ${type}...`);
  try {
    const payload = await fetchJson(`/api/search/${encodeURIComponent(type)}?q=${encodeURIComponent(query)}`);
    const rows = payload.rows || [];
    resultContainer.innerHTML = renderPreviewSearchResults(rows, type);
    input?.focus();
    positionPreviewSearchResults();
    return rows;
  } finally {
    hideSearchToast();
  }
}

function getPreviewAuthorityContext(input) {
  const contextHost = input.closest('[data-authority-context]');
  if (contextHost?.dataset.authorityContext) {
    return contextHost.dataset.authorityContext;
  }
  if (input.closest('[data-song-authorities]')) {
    return 'song';
  }
  if (input.closest('[data-album-card]')) {
    const artistCard = input.closest('[data-artist-card]');
    const albumCard = input.closest('[data-album-card]');
    if (artistCard && albumCard?.contains(artistCard)) {
      return 'artist';
    }
    return 'album';
  }
  if (input.closest('[data-artist-card]')) {
    return 'artist';
  }
  return null;
}

function getPreviewAuthorityUrlPattern(authorityValue, context) {
  const patterns = {
    1: {
      album: /^https:\/\/music\.apple\.com\/[^/]+\/album\/(?:[^/?#]+\/)?(\d+)(?:[/?#].*)?$/i,
      artist: /^https:\/\/music\.apple\.com\/[^/]+\/artist\/(?:[^/?#]+\/)?(\d+)(?:[/?#].*)?$/i,
      song: /^https:\/\/music\.apple\.com\/[^/]+\/song\/(?:[^/?#]+\/)?(\d+)(?:[/?#].*)?$/i
    },
    3: {
      album: /^https:\/\/open\.spotify\.com\/album\/([A-Za-z0-9]+)(?:[/?#].*)?$/i,
      artist: /^https:\/\/open\.spotify\.com\/artist\/([A-Za-z0-9]+)(?:[/?#].*)?$/i,
      song: /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]+)(?:[/?#].*)?$/i
    },
    4: {
      album: /^https:\/\/soundcloud\.com\/([^?#]*[^/?#])\/?(?:[?#].*)?$/i,
      artist: /^https:\/\/soundcloud\.com\/([^?#]*[^/?#])\/?(?:[?#].*)?$/i,
      song: /^https:\/\/soundcloud\.com\/([^?#]*[^/?#])\/?(?:[?#].*)?$/i
    },
    5: {
      album: /^https:\/\/music\.youtube\.com\/playlist\?(?:[^#]*&)?list=([A-Za-z0-9_-]+)(?:[&#].*)?$/i,
      artist: /^https:\/\/music\.youtube\.com\/(@[A-Za-z0-9_-]+|channel\/[A-Za-z0-9_-]+)(?:[/?#].*)?$/i,
      song: /^https:\/\/music\.youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]+)(?:[&#].*)?$/i
    },
    6: {
      album: /^https:\/\/www\.discogs\.com\/(master|release)\/(\d+)(?:-[^/?#]+)?(?:[/?#].*)?$/i,
      artist: /^https:\/\/www\.discogs\.com\/artist\/(\d+)(?:-[^/?#]+)?(?:[/?#].*)?$/i
    },
    7: {
      album: /^https:\/\/rateyourmusic\.com\/(?:release\/(?<releaseType>album|comp|ep|single)\/(?<releasePath>[^?#]*[^/?#])|work\/(?<workPath>[^?#]*[^/?#]))\/?(?:[?#].*)?$/i,
      artist: /^https:\/\/rateyourmusic\.com\/artist\/([^/?#]+)(?:[/?#].*)?$/i,
      song: /^https:\/\/rateyourmusic\.com\/(?<songKind>song|work)\/(?<songPath>[^?#]*[^/?#])\/?(?:[?#].*)?$/i
    }
  };

  return patterns[authorityValue]?.[context] || null;
}

function normalizeAuthorityCodeFromUrlMatch(authorityValue, context, match) {
  if (authorityValue === 6 && context === 'album') {
    const prefix = String(match[1] || '').toLowerCase() === 'release' ? 'r' : 'm';
    return `${prefix}${match[2] || ''}`;
  }

  if (authorityValue === 7 && context === 'album') {
    const releaseTypePrefixes = {
      album: 'a',
      comp: 'c',
      ep: 'e',
      single: 's'
    };
    const workPath = String(match.groups?.workPath || '').replace(/\/$/, '');
    if (workPath) {
      return `w/${workPath}`;
    }

    const prefix = releaseTypePrefixes[String(match.groups?.releaseType || match[1] || '').toLowerCase()];
    const path = String(match.groups?.releasePath || match[2] || '').replace(/\/$/, '');
    return prefix && path ? `${prefix}/${path}` : '';
  }

  if (authorityValue === 7 && context === 'song') {
    const songKind = String(match.groups?.songKind || match[1] || '').toLowerCase();
    const songPath = String(match.groups?.songPath || match[2] || '').replace(/\/$/, '');
    return songKind === 'work' && songPath ? `w/${songPath}` : songPath;
  }

  const matchedCode = String(match.groups?.code || match[1] || '').replace(/\/$/, '');
  if (authorityValue === 5 && context === 'artist') {
    return matchedCode.replace(/^channel\//i, '');
  }
  return matchedCode;
}

function normalizePreviewAuthorityInput(input) {
  const row = input.closest('.preview-authority-row');
  const authorityValue = Number(getElementValue(row, '[data-authority-kind]', ''));
  const context = getPreviewAuthorityContext(input);
  const pattern = getPreviewAuthorityUrlPattern(authorityValue, context);
  const value = input.value.trim();
  if (!pattern || !value) {
    input.value = value;
    return;
  }

  const match = value.match(pattern);
  if (match) {
    const normalizedCode = normalizeAuthorityCodeFromUrlMatch(authorityValue, context, match);
    input.value = decodeURIComponent(normalizedCode);
    return;
  }
  input.value = value;
}

function getYouTubeArtistCodeForUrl(code) {
  const normalizedCode = code.replace(/^\/+/, '');
  if (normalizedCode.startsWith('@')) {
    return normalizedCode;
  }
  return `channel/${normalizedCode.replace(/^channel\//, '')}`;
}

function getDiscogsAlbumPathForUrl(code) {
  const normalizedCode = code.replace(/^\/+/, '');
  const match = normalizedCode.match(/^([mr])(\d+)$/i);
  if (match) {
    const pathPrefix = match[1].toLowerCase() === 'r' ? 'release' : 'master';
    return `${pathPrefix}/${match[2]}`;
  }

  if (/^\d+$/.test(normalizedCode)) {
    return `master/${normalizedCode}`;
  }
  return null;
}

function getRateYourMusicPathForUrl(code, table) {
  const normalizedCode = code.replace(/^\/+|\/+$/g, '');
  const workMatch = normalizedCode.match(/^w\/(.+)$/i);
  if (workMatch?.[1]) {
    return `work/${workMatch[1].replace(/^\/+|\/+$/g, '')}`;
  }

  if (table === 'song') {
    return normalizedCode ? `song/${normalizedCode}` : null;
  }

  const match = normalizedCode.match(/^([aces])\/(.+)$/i);
  const releaseTypes = {
    a: 'album',
    c: 'comp',
    e: 'ep',
    s: 'single'
  };

  if (match) {
    const releaseType = releaseTypes[match[1].toLowerCase()];
    const path = match[2].replace(/^\/+|\/+$/g, '');
    return releaseType && path ? `release/${releaseType}/${path}` : null;
  }

  return normalizedCode ? `release/album/${normalizedCode}` : null;
}

function buildAuthorityUrl(table, authorityName, rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) {
    return null;
  }

  const normalizedAuthority = String(authorityName || '').toLowerCase().replace(/\s+/g, '');
  if (normalizedAuthority === 'discogs' && table === 'album') {
    const discogsAlbumPath = getDiscogsAlbumPathForUrl(code);
    return discogsAlbumPath ? `https://www.discogs.com/${discogsAlbumPath}` : null;
  }

  if (normalizedAuthority === 'rateyourmusic' && ['album', 'song'].includes(table)) {
    const rymPath = getRateYourMusicPathForUrl(code, table);
    return rymPath ? `https://rateyourmusic.com/${encodeURI(rymPath)}` : null;
  }

  if (normalizedAuthority === 'soundcloud' && ['album', 'artist', 'song'].includes(table)) {
    const soundcloudPath = code.replace(/^\/+|\/+$/g, '');
    return soundcloudPath ? `https://soundcloud.com/${encodeURI(soundcloudPath)}` : null;
  }

  const urlPrefixes = {
    applemusic: {
      album: 'https://music.apple.com/us/album/',
      artist: 'https://music.apple.com/us/artist/',
      song: 'https://music.apple.com/us/song/'
    },
    spotify: {
      album: 'https://open.spotify.com/album/',
      artist: 'https://open.spotify.com/artist/',
      song: 'https://open.spotify.com/track/'
    },
    youtube: {
      album: 'https://music.youtube.com/playlist?list=',
      artist: 'https://music.youtube.com/',
      song: 'https://music.youtube.com/watch?v='
    },
    discogs: {
      artist: 'https://www.discogs.com/artist/'
    },
    rateyourmusic: {
      artist: 'https://rateyourmusic.com/artist/'
    }
  };
  const prefix = urlPrefixes[normalizedAuthority]?.[table];
  if (!prefix) {
    return null;
  }

  const normalizedCode = normalizedAuthority === 'youtube' && table === 'artist'
    ? getYouTubeArtistCodeForUrl(code)
    : code.replace(/^\/+/, '');
  const encodedCode = (normalizedAuthority === 'youtube' && table === 'artist') || (normalizedAuthority === 'rateyourmusic' && ['album', 'song'].includes(table))
    ? encodeURI(normalizedCode)
    : encodeURIComponent(code);
  return `${prefix}${encodedCode}`;
}

function getPreviewAuthorityUrl(row) {
  const authorityValue = getElementValue(row, '[data-authority-kind]', '');
  const context = getPreviewAuthorityContext(row);
  const code = getElementValue(row, '[data-authority-code]', '').trim();
  return buildAuthorityUrl(context, enumLabels.source_type[authorityValue], code);
}

function updatePreviewAuthorityLinkButton(row) {
  const button = row?.querySelector('[data-preview-authority-link]');
  if (!button) {
    return;
  }
  const url = getPreviewAuthorityUrl(row);
  button.classList.toggle('inactive', !url);
  button.disabled = !url;
  button.dataset.previewAuthorityUrl = url || '';
  button.setAttribute('aria-disabled', url ? 'false' : 'true');
  button.setAttribute('title', url ? 'Open authority link' : 'No link available');
}

function updatePreviewAuthorityLinkButtons(root = document) {
  root.querySelectorAll('.preview-authority-row').forEach(updatePreviewAuthorityLinkButton);
}

function positionPreviewSearchResults() {
  const panel = $('preview-search-results');
  const main = document.querySelector('.song-preview-main');
  const content = $('song-preview-content');
  if (!panel || !main || !content || panel.classList.contains('hidden')) {
    return;
  }

  if (window.innerWidth <= 900) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.width = '';
    panel.style.maxHeight = '';
    return;
  }

  const rect = main.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const gap = 32;
  const availableWidth = window.innerWidth - rect.right - gap - 16;
  const width = Math.max(260, Math.min(328, availableWidth));
  panel.style.left = `${Math.round(rect.right + gap)}px`;
  panel.style.top = `${Math.round(contentRect.top)}px`;
  panel.style.width = `${Math.round(width)}px`;
  panel.style.maxHeight = `${Math.max(220, Math.round(window.innerHeight - contentRect.top - 32))}px`;
}

function showSongCreationPreview(preview) {
  const modal = $('song-preview-modal');
  const title = $('song-preview-title');
  const kicker = $('song-preview-kicker');
  const content = $('song-preview-content');
  const closeButton = $('song-preview-close');
  const cancelButton = $('song-preview-cancel');
  const confirmButton = $('song-preview-confirm');
  let workingPreview = clonePreview(preview);
  let lastSearch = null;

  const render = () => {
    const hasErrors = getVisiblePreviewErrors(workingPreview).length > 0;
    title.textContent = hasErrors ? 'Edit Song Preview' : 'Confirm Song Creation';
    kicker.textContent = `Entry Group ${workingPreview.groupId}`;
    content.innerHTML = `
      <div class="song-preview-layout">
        <div class="song-preview-main">
          ${renderSongCreationPreview(workingPreview)}
        </div>
        <aside id="preview-search-results" class="preview-search-results hidden"></aside>
      </div>
    `;
    updatePreviewAuthorityLinkButtons(content);
    confirmButton.classList.remove('hidden');
    confirmButton.disabled = false;
    confirmButton.textContent = workingPreview.targetSongId ? 'Complete Merge' : 'Complete';
    cancelButton.textContent = 'Cancel';
    syncPreviewAudioButton(content);
  };

  render();
  openModalUi(modal);

  return new Promise((resolve) => {
    const close = (value) => {
      closeModalUi(modal);
      stopPreviewAudio();
      closeButton.removeEventListener('click', closeAsFalse);
      cancelButton.removeEventListener('click', closeAsFalse);
      confirmButton.removeEventListener('click', closeAsTrue);
      document.removeEventListener('keydown', handleKeydown);
      content.removeEventListener('click', handleContentClick);
      content.removeEventListener('change', handleContentChange);
      content.removeEventListener('focusout', handleContentFocusOut);
      content.removeEventListener('input', handleContentInput);
      content.removeEventListener('keydown', handleContentKeydown);
      content.removeEventListener('scroll', positionPreviewSearchResults);
      window.removeEventListener('resize', positionPreviewSearchResults);
      resolve(value);
    };
    const closeAsFalse = () => close(false);
    const closeAsTrue = () => {
      workingPreview = collectPreviewPlan(content, workingPreview);
      if (getVisiblePreviewErrors(workingPreview).length) {
        render();
        return;
      }
      close(workingPreview);
    };
    const handleKeydown = (event) => {
      if (event.key === 'Escape') {
        close(false);
      }
    };
    const handleContentChange = (event) => {
      const dropdown = event.target.closest('.preview-flag-dropdown');
      if (dropdown) {
        updateFlagDropdownSummary(dropdown);
      }
      if (event.target.matches('[data-authority-kind]')) {
        updatePreviewAuthorityLinkButton(event.target.closest('.preview-authority-row'));
      }
      if (event.target.matches('[data-artist-create-missing], [data-album-create-missing]')) {
        workingPreview = collectPreviewPlan(content, workingPreview);
        render();
      }
      if (event.target.matches('[data-album-type]')) {
        workingPreview = collectPreviewPlan(content, workingPreview);
        render();
      }
      if (event.target.matches('[data-song-artist-reference]')) {
        workingPreview = collectPreviewPlan(content, workingPreview);
        render();
      }
      if (event.target.matches('[data-title-fallback], [data-song-locale-primary]')) {
        workingPreview = collectPreviewPlan(content, workingPreview);
        render();
      }
    };
    const handleContentFocusOut = (event) => {
      if (event.target.matches('[data-authority-code]')) {
        normalizePreviewAuthorityInput(event.target);
        updatePreviewAuthorityLinkButton(event.target.closest('.preview-authority-row'));
      }
    };
    const handleContentInput = (event) => {
      if (event.target.matches('[data-song-audio], [data-edit-audio]')) {
        stopPreviewAudio();
        return;
      }
      if (event.target.matches('[data-entry-group-id]')) {
        const row = event.target.closest('[data-entry-group-row]');
        const label = row?.querySelector('.preview-reference-label');
        if (label) {
          label.textContent = event.target.value.trim() ? `Entry Group ${event.target.value.trim()}` : 'No group';
        }
        return;
      }
      if (event.target.matches('[data-entry-mapping-song-id]')) {
        const row = event.target.closest('[data-entry-mapping-row]');
        const label = row?.querySelector('.preview-reference-label');
        if (label) {
          label.textContent = event.target.value.trim() ? `Song ${event.target.value.trim()}` : 'No mapping';
        }
        return;
      }
      if (event.target.matches('[data-authority-code]')) {
        updatePreviewAuthorityLinkButton(event.target.closest('.preview-authority-row'));
        return;
      }
      if (!event.target.matches('[data-artwork-input]')) {
        return;
      }
      const wrap = event.target.closest('.preview-artwork-input-wrap');
      const popover = wrap?.querySelector('.preview-artwork-popover');
      const image = wrap?.querySelector('[data-artwork-preview]');
      const artworkUrl = getArtworkUrl(event.target.value);
      if (!popover || !image) {
        return;
      }
      if (!artworkUrl) {
        image.removeAttribute('src');
        popover.classList.add('hidden');
        return;
      }
      image.src = artworkUrl;
      popover.classList.remove('hidden');
    };
    const handleContentKeydown = async (event) => {
      if (event.key !== 'Enter' || !event.target.matches('[data-preview-side-search-input]')) {
        return;
      }
      event.preventDefault();
      if (!lastSearch) {
        return;
      }
      lastSearch.rows = await searchPreviewSidePanel(lastSearch.type, event.target.value);
    };
    const handleContentClick = async (event) => {
      const button = event.target.closest('button');
      if (!button) {
        return;
      }

      if (button.matches('[data-preview-close-search]')) {
        closePreviewSearchPanel();
        lastSearch = null;
        return;
      }

      if (button.matches('[data-preview-audio-toggle]')) {
        togglePreviewAudio(button);
        return;
      }

      if (button.disabled) {
        return;
      }

      if (button.matches('[data-preview-authority-link]')) {
        const url = button.dataset.previewAuthorityUrl;
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      if (button.matches('[data-preview-side-search-run]')) {
        if (!lastSearch) {
          return;
        }
        const query = $('preview-search-results')?.querySelector('[data-preview-side-search-input]')?.value || '';
        lastSearch.rows = await searchPreviewSidePanel(lastSearch.type, query);
        return;
      }

      workingPreview = collectPreviewPlan(content, workingPreview);

      if (button.matches('[data-preview-add-title]')) {
        const list = button.closest('[data-title-list]');
        const owner = list.closest('[data-artist-card], [data-album-card]');
        const newTitle = { locale: 1, localeValue: 1, localeLabel: 'und', title: '', fallback: false };
        if (!owner && list.closest('[data-song-titles]')) {
          workingPreview.song.titles.push(newTitle);
        } else if (owner?.matches('[data-artist-card]')) {
          const albumCard = owner.closest('[data-album-card]');
          const index = getPreviewCollectionIndex(owner, '[data-artist-card]');
          const target = albumCard
            ? workingPreview.song.albums[getPreviewCollectionIndex(albumCard, '[data-album-card]')]?.artists
            : workingPreview.song.artists;
          target?.[index]?.titles.push({ ...newTitle, searchType: 'artist' });
        } else if (owner?.matches('[data-album-card]')) {
          workingPreview.song.albums[getPreviewCollectionIndex(owner, '[data-album-card]')]?.titles.push({ ...newTitle, searchType: 'album' });
        }
        render();
        return;
      }

      if (button.matches('[data-preview-add-locale]')) {
        workingPreview.song.locales = workingPreview.song.locales || [];
        workingPreview.song.locales.push({
          locale: 1,
          localeValue: 1,
          localeLabel: 'und',
          isPrimary: !workingPreview.song.locales.length
        });
        render();
        return;
      }

      if (button.matches('[data-preview-remove-locale]')) {
        button.closest('.preview-locale-edit-row')?.remove();
        workingPreview = collectPreviewPlan(content, workingPreview);
        if (workingPreview.song.locales.length && !workingPreview.song.locales.some((locale) => locale.isPrimary)) {
          workingPreview.song.locales[0].isPrimary = true;
        }
        render();
        return;
      }

      if (button.matches('[data-preview-remove-title]')) {
        button.closest('.preview-title-row')?.remove();
        workingPreview = collectPreviewPlan(content, workingPreview);
        render();
        return;
      }

      if (button.matches('[data-preview-add-authority]')) {
        const authorityList = button.closest('[data-authority-list]');
        const newAuthority = { authority: 1, authorityValue: 1, authorityLabel: 'Apple Music', code: '' };
        const artistCard = authorityList.closest('[data-artist-card]');
        const albumCard = authorityList.closest('[data-album-card]');
        if (artistCard && (!albumCard || albumCard.contains(artistCard))) {
          const artistIndex = getPreviewCollectionIndex(artistCard, '[data-artist-card]');
          if (albumCard) {
            workingPreview.song.albums[getPreviewCollectionIndex(albumCard, '[data-album-card]')]?.artists[artistIndex]?.authorities.push(newAuthority);
          } else {
            workingPreview.song.artists[artistIndex]?.authorities.push(newAuthority);
          }
        } else if (albumCard) {
          workingPreview.song.albums[getPreviewCollectionIndex(albumCard, '[data-album-card]')]?.authorities.push(newAuthority);
        } else {
          workingPreview.song.authorities.push(newAuthority);
        }
        render();
        return;
      }

      if (button.matches('[data-preview-remove-authority]')) {
        button.closest('.preview-authority-row')?.remove();
        workingPreview = collectPreviewPlan(content, workingPreview);
        render();
        return;
      }

      if (button.matches('[data-preview-add-alias]')) {
        const artistCard = button.closest('[data-artist-card]');
        const albumCard = artistCard.closest('[data-album-card]');
        const artistIndex = getPreviewCollectionIndex(artistCard, '[data-artist-card]');
        if (albumCard) {
          workingPreview.song.albums[getPreviewCollectionIndex(albumCard, '[data-album-card]')]?.artists[artistIndex]?.aliases.push('');
        } else {
          workingPreview.song.artists[artistIndex]?.aliases.push('');
        }
        render();
        return;
      }

      if (button.matches('[data-preview-remove-alias]')) {
        button.closest('.preview-alias-row')?.remove();
        workingPreview = collectPreviewPlan(content, workingPreview);
        render();
        return;
      }

      if (button.matches('[data-preview-add-artist]')) {
        const albumCard = button.closest('[data-album-card]');
        const newArtist = { artistId: null, songArtistIndex: null, displayTitle: null, role: 0, artistTag: 0, title: '', titles: [{ locale: 1, localeValue: 1, localeLabel: 'und', title: '', fallback: true }], aliases: [], artwork: '', authorities: [] };
        if (albumCard) {
          workingPreview.song.albums[getPreviewCollectionIndex(albumCard, '[data-album-card]')]?.artists.push(newArtist);
        } else {
          workingPreview.song.artists.push(newArtist);
        }
        render();
        return;
      }

      if (button.matches('[data-preview-remove-artist]')) {
        const artistCard = button.closest('[data-artist-card]');
        const albumCard = artistCard.closest('[data-album-card]');
        const index = getPreviewCollectionIndex(artistCard, '[data-artist-card]');
        if (albumCard) {
          workingPreview.song.albums[getPreviewCollectionIndex(albumCard, '[data-album-card]')]?.artists.splice(index, 1);
        } else {
          workingPreview.song.artists.splice(index, 1);
        }
        render();
        return;
      }

      if (button.matches('[data-preview-add-album]')) {
        workingPreview.song.albums.push({
          albumId: null,
          title: '',
          titles: [{ locale: 1, localeValue: 1, localeLabel: 'und', title: '', fallback: true }],
          albumType: '',
          artwork: '',
          releaseDate: '',
          discNumber: 1,
          discCount: null,
          trackNumber: null,
          trackCount: null,
          artists: [],
          authorities: []
        });
        render();
        return;
      }

      if (button.matches('[data-preview-remove-album]')) {
        const albumCard = button.closest('[data-album-card]');
        workingPreview.song.albums.splice(getPreviewCollectionIndex(albumCard, '[data-album-card]'), 1);
        render();
        return;
      }

      if (button.matches('[data-preview-search]')) {
        const type = button.dataset.previewSearch;
        const q = getSearchTerm(button);
        lastSearch = {
          type,
          rows: [],
          artistIndex: button.closest('[data-artist-card]') ? getPreviewCollectionIndex(button.closest('[data-artist-card]'), '[data-artist-card]') : -1,
          albumIndex: button.closest('[data-album-card]') ? getPreviewCollectionIndex(button.closest('[data-album-card]'), '[data-album-card]') : -1,
          nestedInAlbum: Boolean(button.closest('[data-artist-card]')?.closest('[data-album-card]'))
        };
        lastSearch.rows = await searchPreviewSidePanel(type, q);
        return;
      }

      if (button.matches('[data-preview-use-search]') && lastSearch) {
        const result = lastSearch.rows[Number(button.dataset.previewUseSearch)];
        if (!result?.detail) {
          return;
        }
        if (lastSearch.type === 'song') {
          workingPreview.targetSongId = result.detail.targetSongId;
          workingPreview.song = { ...workingPreview.song, ...result.detail.song, targetSongId: result.detail.targetSongId };
        } else if (lastSearch.type === 'artist') {
          if (lastSearch.nestedInAlbum && lastSearch.albumIndex >= 0 && lastSearch.artistIndex >= 0) {
            workingPreview.song.albums[lastSearch.albumIndex].artists[lastSearch.artistIndex] = result.detail;
          } else if (lastSearch.artistIndex >= 0) {
            workingPreview.song.artists[lastSearch.artistIndex] = {
              ...result.detail,
              role: workingPreview.song.artists[lastSearch.artistIndex]?.role ?? result.detail.role ?? 0
            };
          } else {
            workingPreview.song.artists.push(result.detail);
          }
        } else if (lastSearch.type === 'album') {
          if (lastSearch.albumIndex >= 0) {
            workingPreview.song.albums[lastSearch.albumIndex] = {
              ...result.detail,
              discNumber: workingPreview.song.albums[lastSearch.albumIndex]?.discNumber || result.detail.discNumber,
              trackNumber: workingPreview.song.albums[lastSearch.albumIndex]?.trackNumber || result.detail.trackNumber,
              trackCount: workingPreview.song.albums[lastSearch.albumIndex]?.trackCount || result.detail.trackCount
            };
          } else {
            workingPreview.song.albums.push(result.detail);
          }
        }
        render();
      }
    };

    closeButton.addEventListener('click', closeAsFalse);
    cancelButton.addEventListener('click', closeAsFalse);
    confirmButton.addEventListener('click', closeAsTrue);
    document.addEventListener('keydown', handleKeydown);
    content.addEventListener('click', handleContentClick);
    content.addEventListener('change', handleContentChange);
    content.addEventListener('focusout', handleContentFocusOut);
    content.addEventListener('input', handleContentInput);
    content.addEventListener('keydown', handleContentKeydown);
    content.addEventListener('scroll', positionPreviewSearchResults);
    window.addEventListener('resize', positionPreviewSearchResults);
    confirmButton.focus();
  });
}

function bindGroupStatusEditor(row) {
  const form = $('group-status-form');
  if (!form) {
    return;
  }

  const createSongCheckbox = $('group-create-song-checkbox');
  if (createSongCheckbox) {
    createSongCheckbox.addEventListener('change', () => {
      state.group.createSongOnConfirm = createSongCheckbox.checked;
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const select = $('group-status-select');
    const message = $('group-status-message');
    const nextStatus = select.value;
    const button = form.querySelector('button[type="submit"]');
    const shouldCreateSong = Boolean(createSongCheckbox?.checked)
      && nextStatus === 'CONFIRMED'
      && !row.canonicalSongId;

    button.disabled = true;
    message.textContent = shouldCreateSong ? 'Preparing preview...' : 'Saving...';
    try {
      let songPlan = null;
      if (shouldCreateSong) {
        const preview = await fetchJson(`/api/groups/${encodeURIComponent(row.groupId)}/song-preview`);
        songPlan = await showSongCreationPreview(preview);
        if (!songPlan) {
          message.textContent = 'Canceled';
          select.value = row.status;
          return;
        }
        message.textContent = 'Saving...';
      }

      const payload = await fetchJson(`/api/groups/${encodeURIComponent(row.groupId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextStatus,
          createSong: shouldCreateSong,
          songPlan
        })
      });
      row.status = payload.status || nextStatus;
      if (payload.createdSongId) {
        row.canonicalSongId = payload.createdSongId;
      }
      select.value = row.status;
      const resolvedText = payload.resolvedIssueCount
        ? ` · resolved ${payload.resolvedIssueCount} issue${payload.resolvedIssueCount === 1 ? '' : 's'}`
        : '';
      const songText = payload.createdSongId
        ? ` · created song ${payload.createdSongId}`
        : shouldCreateSong
          ? ' · no song was created'
          : '';
      message.textContent = `Saved${songText}${resolvedText}`;
      await refreshCurrentView();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

function bindBulkGroupStatusEditor() {
  const form = $('bulk-group-status-form');
  if (!form) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const groupIds = getSelectedGroupIds();
    const select = $('bulk-group-status-select');
    const message = $('bulk-group-status-message');
    const button = $('bulk-group-status-save-btn');
    if (!groupIds.length) {
      message.textContent = 'No selected groups';
      return;
    }

    button.disabled = true;
    select.disabled = true;
    message.textContent = 'Saving...';
    try {
      const payload = await fetchJson('/api/groups/status', {
        method: 'PATCH',
        body: JSON.stringify({
          status: select.value,
          groupIds
        })
      });
      const issueText = payload.resolvedIssueCount
        ? ` · resolved ${payload.resolvedIssueCount} issue${payload.resolvedIssueCount === 1 ? '' : 's'}`
        : '';
      message.textContent = `Saved ${payload.updatedCount || groupIds.length} group${(payload.updatedCount || groupIds.length) === 1 ? '' : 's'}${issueText}`;
      state.selectedGroups.clear();
      state.groupSelectionAnchorIndex = null;
      await refreshCurrentView();
    } catch (error) {
      message.textContent = error.message;
      updateGroupSelectionUi();
    }
  });
}

function renderMappingStatusEditor(row) {
  return `
    <form id="mapping-status-form" class="mapping-status-editor">
      <label>
        <span class="detail-label">Mapping Status</span>
        <select id="mapping-status-select">
          <option value="CONFIRMED" ${row.status === 'CONFIRMED' ? 'selected' : ''}>Confirmed</option>
          <option value="PENDING" ${row.status === 'PENDING' ? 'selected' : ''}>Pending</option>
          <option value="REJECTED" ${row.status === 'REJECTED' ? 'selected' : ''}>Rejected</option>
        </select>
      </label>
      <button class="status-save-btn" type="submit">Save</button>
      <span id="mapping-status-message" class="detail-message" aria-live="polite"></span>
    </form>
  `;
}

function renderBulkMappingStatusEditor() {
  const selectedCount = state.selectedMappings.size;
  return `
    <form id="bulk-status-form" class="mapping-status-editor bulk-status-editor">
      <label>
        <span class="detail-label">Selected Mapping Status</span>
        <select id="bulk-status-select" ${selectedCount === 0 ? 'disabled' : ''}>
          <option value="CONFIRMED">Confirmed</option>
          <option value="PENDING">Pending</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      <button id="bulk-status-save-btn" class="status-save-btn" type="submit" ${selectedCount === 0 ? 'disabled' : ''}>Save</button>
      <span id="bulk-status-message" class="detail-message" aria-live="polite"></span>
    </form>
  `;
}

function bindMappingStatusEditor(row) {
  const form = $('mapping-status-form');
  if (!form) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const select = $('mapping-status-select');
    const message = $('mapping-status-message');
    const nextStatus = select.value;
    const button = form.querySelector('button[type="submit"]');

    button.disabled = true;
    message.textContent = 'Saving...';
    try {
      const payload = await fetchJson(`/api/mappings/${encodeURIComponent(row.entryId)}/${encodeURIComponent(row.songId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus })
      });
      row.status = payload.status || nextStatus;
      select.value = row.status;
      message.textContent = payload.metadataMerged ? 'Saved · merged metadata' : 'Saved';
      await refreshCurrentView();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

function bindBulkMappingStatusEditor() {
  const form = $('bulk-status-form');
  if (!form) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selectedMappings = getSelectedMappings();
    const select = $('bulk-status-select');
    const message = $('bulk-status-message');
    const button = $('bulk-status-save-btn');
    if (!selectedMappings.length) {
      message.textContent = 'No selected mappings';
      return;
    }

    button.disabled = true;
    select.disabled = true;
    message.textContent = 'Saving...';
    try {
      const payload = await fetchJson('/api/mappings/status', {
        method: 'PATCH',
        body: JSON.stringify({
          status: select.value,
          mappings: selectedMappings
        })
      });
      message.textContent = `Saved ${payload.updatedCount || selectedMappings.length} mapping${(payload.updatedCount || selectedMappings.length) === 1 ? '' : 's'}${payload.metadataMerged ? ' · merged metadata' : ''}`;
      state.selectedMappings.clear();
      await refreshCurrentView();
    } catch (error) {
      message.textContent = error.message;
      updateMappingSelectionUi();
    }
  });
}

function formatIssueDetailValue(value) {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '-';
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  return String(value);
}

function renderIssueHighlightField(label, value) {
  return `
    <div class="issue-highlight-item">
      <span class="issue-highlight-label">${escapeHtml(label)}</span>
      <span class="issue-highlight-value">${escapeHtml(formatIssueDetailValue(value))}</span>
    </div>
  `;
}

function getIssueHighlightFields(row) {
  const details = row.details || {};

  if (row.reason === 'ARTIST_CONFLICT') {
    return [
      ['Incoming artist IDs', details.incoming_artist_ids],
      ['Candidate artist IDs', details.candidate_artist_ids],
      ['Missing artist IDs', details.missing_artist_ids],
      ['Extra artist IDs', details.extra_artist_ids],
      ['Authority matched', details.authority_matched]
    ];
  }

  if (row.reason === 'REFERENCED_ARTIST_MISSING') {
    return [
      ['Referenced artist ID', details.referenced_artist_id],
      ['Display name', details.display_name],
      ['Reference field', details.reference_field],
      ['Reference context', details.reference_context],
      ['Referencing collection', details.referencing_collection],
      ['Referencing item ID', details.referencing_item_id],
      ['Suspected Various Artists', details.suspected_various_artists]
    ];
  }

  if (row.reason === 'REFERENCED_ALBUM_MISSING') {
    return [
      ['Referenced album ID', details.referenced_album_id],
      ['Reference field', details.reference_field],
      ['Reference context', details.reference_context],
      ['Referencing collection', details.referencing_collection],
      ['Referencing item ID', details.referencing_item_id]
    ];
  }

  return [];
}

function renderIssueHighlights(row) {
  const fields = getIssueHighlightFields(row);
  if (!fields.length) {
    return '';
  }

  return `
    <div class="issue-highlight-box">
      ${fields.map(([label, value]) => renderIssueHighlightField(label, value)).join('')}
    </div>
  `;
}

function renderJsonBlock(value) {
  return `<pre class="details-json">${escapeHtml(JSON.stringify(value ?? null, null, 2))}</pre>`;
}

function renderDetailArtwork(artwork, label) {
  const artworkUrl = getArtworkUrl(artwork);
  if (!artworkUrl) {
    return '';
  }

  return `
    <div class="detail-artwork-wrap">
      <img class="detail-artwork" src="${escapeHtml(artworkUrl)}" alt="${escapeHtml(label)}">
    </div>
  `;
}

function getAuthorityUrl(table, authority) {
  return buildAuthorityUrl(table, authority?.authority, authority?.code);
}

function formatAuthorityCode(code) {
  const value = String(code || '-');
  return value.length > 15 ? `${value.slice(0, 15)}...` : value;
}

function formatAuthorityCodeForDisplay(authority, table) {
  const code = String(authority?.code || '-');
  if (['album', 'song'].includes(table) && getAuthoritySortValue(authority) === 7) {
    return formatAuthorityCode(code.replace(/^[acesw]\//i, ''));
  }
  return formatAuthorityCode(code);
}

function getAuthoritySortValue(authority) {
  const value = Number(authority?.authorityValue);
  if (Number.isInteger(value)) {
    return value;
  }

  return Number(Object.entries(enumLabels.source_type).find(([, label]) => (
    String(label).toLowerCase() === String(authority?.authority || '').toLowerCase()
  ))?.[0] ?? Number.MAX_SAFE_INTEGER);
}

function parseDiscogsAuthorityCode(code) {
  const value = String(code || '');
  const match = value.match(/^([mr])(\d+)$/i);
  if (match) {
    return {
      prefix: match[1].toLowerCase(),
      number: Number(match[2]),
      raw: value
    };
  }

  if (/^\d+$/.test(value)) {
    return {
      prefix: 'm',
      number: Number(value),
      raw: value
    };
  }

  return {
    prefix: 'z',
    number: Number.MAX_SAFE_INTEGER,
    raw: value
  };
}

function compareDiscogsAuthorityCode(left, right) {
  const prefixOrder = { m: 0, r: 1, z: 2 };
  const leftCode = parseDiscogsAuthorityCode(left?.code);
  const rightCode = parseDiscogsAuthorityCode(right?.code);
  const prefixDiff = (prefixOrder[leftCode.prefix] ?? 9) - (prefixOrder[rightCode.prefix] ?? 9);
  if (prefixDiff) {
    return prefixDiff;
  }
  if (leftCode.number !== rightCode.number) {
    return leftCode.number - rightCode.number;
  }
  return leftCode.raw.localeCompare(rightCode.raw);
}

function compareAuthorityCode(left, right, authorityValue) {
  const leftCode = String(left?.code || '');
  const rightCode = String(right?.code || '');
  if (authorityValue === 6) {
    return compareDiscogsAuthorityCode(left, right);
  }
  if (authorityValue === 1) {
    const leftNumber = Number(leftCode);
    const rightNumber = Number(rightCode);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
  }
  return leftCode.localeCompare(rightCode);
}

function sortRenderedAuthorities(authorities) {
  return [...authorities].sort((left, right) => {
    const leftAuthority = getAuthoritySortValue(left);
    const rightAuthority = getAuthoritySortValue(right);
    if (leftAuthority !== rightAuthority) {
      return leftAuthority - rightAuthority;
    }
    return compareAuthorityCode(left, right, leftAuthority);
  });
}

function renderAuthorityList(authorities, table) {
  if (!Array.isArray(authorities) || !authorities.length) {
    return '-';
  }

  return `
    <div class="detail-extra-list authority-list">
      ${sortRenderedAuthorities(authorities).map((authority) => {
    const href = getAuthorityUrl(table, authority);
    const code = authority.code || '-';
    const displayCode = formatAuthorityCodeForDisplay(authority, table);
    const codeHtml = href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(code)}">${escapeHtml(displayCode)}</a>`
      : `<span title="${escapeHtml(code)}">${escapeHtml(displayCode)}</span>`;
    return `
        <div class="authority-row">
          <span class="authority-source">${escapeHtml(authority.authority || '-')}</span>
          <span class="authority-code">${codeHtml}</span>
        </div>
    `;
  }).join('')}
    </div>
  `;
}

function renderExpandedTitles(titles) {
  return `<div class="detail-extra-list">${renderLocaleRows(titles)}</div>`;
}

function renderAliasList(aliases) {
  return Array.isArray(aliases) && aliases.length ? aliases.join(' · ') : '-';
}

function renderTrackCountInfo(detail) {
  const parts = [];
  if (detail.discCount !== null && detail.discCount !== undefined) {
    parts.push(`${detail.discCount} disc${detail.discCount === 1 ? '' : 's'}`);
  }
  if (Array.isArray(detail.trackCounts) && detail.trackCounts.length) {
    parts.push(detail.trackCounts
      .map((item) => `Disc ${item.disc_number}: ${item.track_count}`)
      .join(' · '));
  }
  return parts.length ? parts.join(' · ') : '-';
}

function renderArtistLinks(artists, showRole = false) {
  if (!Array.isArray(artists) || !artists.length) {
    return '-';
  }

  const rows = artists
    .map((artist) => {
      const artistId = artist.artist_id ?? artist.artistId ?? artist.id;
      if (artistId === null || artistId === undefined || artistId === '') {
        return '';
      }

      const title = artist.title || artist.displayTitle || `Artist ${artistId}`;
      const artwork = getArtworkUrl(artist.artwork);
      return `
        <button
          class="artist-link artist-list-row"
          type="button"
          data-artist-id="${escapeHtml(artistId)}"
          data-artist-title="${escapeHtml(title)}"
          ${artwork ? `data-artist-artwork="${escapeHtml(artwork)}"` : ''}
        >
          <span class="artist-list-id">${escapeHtml(artistId)}</span>
          <span class="artist-list-title">${escapeHtml(title)}${showRole && PortalModel.role(artist.role) !== 'main' ? `<span class="artist-role">${escapeHtml(PortalModel.role(artist.role))}</span>` : ''}</span>
        </button>
      `;
    })
    .filter(Boolean)
    .join('');

  return rows ? `<div class="detail-extra-list artist-list">${rows}</div>` : '-';
}

function formatArtistRelationLabel(relation) {
  const relationValue = Number(relation?.relationToRef ?? relation?.relation_to_ref ?? 0);
  if (relation?.direction === 'incoming' && relationValue === 1) {
    return 'Has Member';
  }
  return enumLabels.relation[relationValue] || relation?.relation || String(relationValue);
}

function renderArtistRelationSection(relations) {
  if (!Array.isArray(relations) || !relations.length) {
    return '<p class="detail-empty-text">No related artists</p>';
  }

  return relations.map((relation) => {
    const artistId = relation.artistId ?? relation.artist_id ?? relation.refArtistId ?? relation.ref_artist_id;
    return `
      <div class="detail-mini-card">
        <button class="artist-link" type="button" data-artist-id="${escapeHtml(artistId)}">${escapeHtml(relation.title || `Artist ${artistId}`)}</button>
        <div class="detail-mini-meta">${escapeHtml(formatArtistRelationLabel(relation))}</div>
      </div>
    `;
  }).join('');
}

function bindArtistLinks() {
  document.querySelectorAll('.artist-link').forEach((button) => {
    button.addEventListener('click', async () => {
      hideArtistArtworkPreview();
      await openArtistTableRow(Number(button.dataset.artistId));
    });
    bindArtistArtworkPreview(button);
  });
}

function bindArtistArtworkPreview(button) {
  if (!button.dataset.artistArtwork) {
    return;
  }

  button.addEventListener('mouseenter', () => {
    scheduleArtistArtworkPreview(button);
  });
  button.addEventListener('mouseleave', hideArtistArtworkPreview);
  button.addEventListener('focus', () => {
    scheduleArtistArtworkPreview(button);
  });
  button.addEventListener('blur', hideArtistArtworkPreview);
}

function ensureArtistArtworkPreview() {
  let preview = document.getElementById('artist-artwork-preview');
  if (preview) {
    return preview;
  }

  preview = document.createElement('div');
  preview.id = 'artist-artwork-preview';
  preview.className = 'artist-artwork-preview hidden';
  preview.innerHTML = '<img alt="">';
  document.body.appendChild(preview);
  return preview;
}

function hideArtistArtworkPreview() {
  if (artistArtworkPreviewTimer) {
    clearTimeout(artistArtworkPreviewTimer);
    artistArtworkPreviewTimer = null;
  }

  const preview = document.getElementById('artist-artwork-preview');
  if (preview) {
    preview.classList.add('hidden');
  }
}

function positionArtistArtworkPreview(button, preview) {
  const rect = button.getBoundingClientRect();
  const gap = 8;
  const previewSize = 172;
  const left = Math.min(
    Math.max(gap, rect.left),
    Math.max(gap, window.innerWidth - previewSize - gap)
  );
  const top = Math.min(
    rect.bottom + gap,
    Math.max(gap, window.innerHeight - previewSize - gap)
  );

  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
}

function scheduleArtistArtworkPreview(button) {
  hideArtistArtworkPreview();
  artistArtworkPreviewTimer = setTimeout(() => {
    const artwork = button.dataset.artistArtwork;
    if (!artwork || !button.matches(':hover, :focus')) {
      return;
    }

    const preview = ensureArtistArtworkPreview();
    const image = preview.querySelector('img');
    image.src = artwork;
    image.alt = button.dataset.artistTitle || 'Artist artwork';
    positionArtistArtworkPreview(button, preview);
    preview.classList.remove('hidden');
  }, 1000);
}

async function openArtistTableRow(artistId) {
  const locate = await fetchJson(`/api/tables/artist/locate/${encodeURIComponent(artistId)}?pageSize=${encodeURIComponent(state.table.pageSize)}`);
  setTablePage('artist', locate.page || 1);
  await selectTableView('artist');
  const row = document.querySelector(`.changelog-row[data-id="${CSS.escape(String(artistId))}"]`);
  if (row) {
    document.querySelectorAll('.changelog-row').forEach((item) => item.classList.remove('active'));
    row.classList.add('active');
  }
  await showTableDetail('artist', artistId);
}

async function openAlbumTableRow(albumId) {
  const locate = await fetchJson(`/api/tables/album/locate/${encodeURIComponent(albumId)}?pageSize=${encodeURIComponent(state.table.pageSize)}`);
  setTablePage('album', locate.page || 1);
  await selectTableView('album');
  const row = document.querySelector(`.changelog-row[data-id="${CSS.escape(String(albumId))}"]`);
  if (row) {
    document.querySelectorAll('.changelog-row').forEach((item) => item.classList.remove('active'));
    row.classList.add('active');
  }
  await showTableDetail('album', albumId);
}

async function openSongTableRow(songId) {
  const locate = await fetchJson(`/api/tables/song/locate/${encodeURIComponent(songId)}?pageSize=${encodeURIComponent(state.table.pageSize)}`);
  setTablePage('song', locate.page || 1);
  await selectTableView('song');
  const row = document.querySelector(`.changelog-row[data-id="${CSS.escape(String(songId))}"]`);
  if (row) {
    document.querySelectorAll('.changelog-row').forEach((item) => item.classList.remove('active'));
    row.classList.add('active');
  }
  await showTableDetail('song', songId);
}

async function openEntryTableRow(entryId) {
  const filters = getTableFilters('entry');
  filters.search = '';
  filters.sourceType = 'ANY';
  filters.mappingStatus = 'ANY';
  state.table.filters = filters;
  const locate = await fetchJson(`/api/tables/entry/locate/${encodeURIComponent(entryId)}?pageSize=${encodeURIComponent(state.table.pageSize)}`);
  setTablePage('entry', locate.page || 1);
  await selectTableView('entry');
  const row = document.querySelector(`.changelog-row[data-id="${CSS.escape(String(entryId))}"]`);
  if (row) {
    document.querySelectorAll('.changelog-row').forEach((item) => item.classList.remove('active'));
    row.classList.add('active');
  }
  await showTableDetail('entry', entryId);
}

async function openEntryGroupRow(groupId) {
  state.group.filters.search = '';
  state.group.filters.includeConfirmed = true;
  state.group.filters.rules = [];
  state.group.filters.sort = [];
  state.group.page = 1;
  await selectGroupView();
  const groupIndex = state.rows.findIndex((row) => Number(row.groupId) === Number(groupId));
  if (groupIndex === -1) {
    return;
  }
  const card = document.querySelector(`.record-card[data-index="${CSS.escape(String(groupIndex))}"]`);
  document.querySelectorAll('.record-card').forEach((item) => item.classList.remove('active'));
  card?.classList.add('active');
  showEntryGroupDetail(state.rows[groupIndex]);
}

function renderAlbumTrackSection(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) {
    return '<p class="detail-empty-text">No linked songs</p>';
  }

  return tracks.map((track) => {
    const trackInfo = [
      track.disc_number ? `Disc ${track.disc_number}` : null,
      track.track_number ? `Track ${track.track_number}` : null,
      track.duration ? formatDuration(Number(track.duration)) : null
    ].filter(Boolean).join(' · ');
    return `
      <div class="detail-mini-card">
        <button class="song-link" type="button" data-song-id="${escapeHtml(track.song_id)}">${escapeHtml(track.title || `Song ${track.song_id}`)}</button>
        <div class="detail-mini-meta">${escapeHtml(trackInfo || '-')}</div>
      </div>
    `;
  }).join('');
}

function renderArtistAlbumSection(albums) {
  if (!Array.isArray(albums) || !albums.length) {
    return '<p class="detail-empty-text">No linked albums</p>';
  }

  return albums.map((album) => `
    <div class="detail-mini-card">
      <button class="album-link" type="button" data-album-id="${escapeHtml(album.album_id)}">${escapeHtml(album.title || `Album ${album.album_id}`)}</button>
      <div class="detail-mini-meta">${escapeHtml([formatTableCellValue('album_type', album.album_type), formatDate(album.release_date)].filter((value) => value && value !== '-').join(' · ') || '-')}</div>
    </div>
  `).join('');
}

function renderArtistSongSection(songs) {
  if (!Array.isArray(songs) || !songs.length) {
    return '<p class="detail-empty-text">No linked songs</p>';
  }

  return songs.map((song) => {
    const role = PortalModel.role(song.role);
    const roleLabel = role && role !== '-' ? role.charAt(0).toUpperCase() + role.slice(1) : null;
    const metadata = [roleLabel, song.duration ? formatDuration(Number(song.duration)) : null, formatDate(song.release_date)]
      .filter((value) => value && value !== '-')
      .join(' · ');
    return `
      <div class="detail-mini-card">
        <button class="song-link" type="button" data-song-id="${escapeHtml(song.song_id)}">${escapeHtml(song.title || `Song ${song.song_id}`)}</button>
        <div class="detail-mini-meta">${escapeHtml(metadata || '-')}</div>
      </div>
    `;
  }).join('');
}

function renderSongAlbumSection(albums) {
  if (!Array.isArray(albums) || !albums.length) {
    return '<p class="detail-empty-text">No albums</p>';
  }

  return albums.map((album) => {
    const trackInfo = [
      album.disc_number ? `Disc ${album.disc_number}` : null,
      album.track_number ? `Track ${album.track_number}` : null,
      album.track_count ? `of ${album.track_count}` : null
    ].filter(Boolean).join(' ');
    return `
      <div class="detail-mini-card">
        <button class="album-link" type="button" data-album-id="${escapeHtml(album.album_id)}">${escapeHtml(album.title || `Album ${album.album_id}`)}</button>
        <div class="detail-mini-meta">${escapeHtml(trackInfo || '-')}</div>
      </div>
    `;
  }).join('');
}

function bindAlbumLinks() {
  document.querySelectorAll('.album-link').forEach((button) => {
    button.addEventListener('click', async () => {
      await openAlbumTableRow(Number(button.dataset.albumId));
    });
  });
}

function bindSongLinks() {
  document.querySelectorAll('.song-link').forEach((button) => {
    button.addEventListener('click', async () => {
      await openSongTableRow(Number(button.dataset.songId));
    });
  });
}

function bindEntryLinks() {
  document.querySelectorAll('.entry-link').forEach((button) => {
    button.addEventListener('click', async () => {
      await openEntryTableRow(Number(button.dataset.entryId));
    });
  });
}

function bindEntryGroupLinks() {
  document.querySelectorAll('.entry-group-link').forEach((button) => {
    button.addEventListener('click', async () => {
      await openEntryGroupRow(Number(button.dataset.entryGroupId));
    });
  });
}

function renderSongEntryMappings(entryMappings) {
  if (!Array.isArray(entryMappings) || !entryMappings.length) {
    return '<p class="detail-empty-text">No entry mappings</p>';
  }

  return entryMappings.map((mapping) => `
    <div class="detail-mini-card">
      <button class="entry-link" type="button" data-entry-id="${escapeHtml(mapping.entryId)}">${escapeHtml(mapping.rawTitle || `Entry ${mapping.entryId}`)}</button>
      <div class="detail-mini-meta">${escapeHtml([mapping.rawArtist, mapping.rawAlbum].filter(Boolean).join(' · ') || '-')}</div>
      <div class="detail-mini-meta">${escapeHtml(`${mapping.status} · ${mapping.matchMethod} · ${mapping.confidence === null || mapping.confidence === undefined ? '-' : Number(mapping.confidence).toFixed(4)}`)}</div>
    </div>
  `).join('');
}

function renderEntrySourceDetail(detail) {
  const typeLabel = formatTableCellValue('source_type', detail.sourceType);
  return `
    <div>${escapeHtml(detail.sourcePath || '-')}</div>
    <div class="detail-mini-meta">${escapeHtml(`Source ${detail.sourceId || '-'} · ${typeLabel} · Item ${detail.sourceItemId || '-'}`)}</div>
  `;
}

function renderDetailHeader(table, detail) {
  if (!['album', 'artist', 'song', 'entry'].includes(table)) {
    return '';
  }
  const mergeButton = table === 'artist'
    ? renderIconButton('merge-artist', 'Merge artist').replace('data-preview-merge-artist', `data-merge-artist="${escapeHtml(detail.id)}"`)
    : '';
  return `
    <div class="detail-panel-header">
      <span>${escapeHtml(`${table} ${detail.id}`)}</span>
      <div class="detail-panel-actions">
        ${mergeButton}
        ${renderIconButton('edit-table', `Edit ${table}`).replace('data-preview-edit-table', `data-edit-table="${escapeHtml(table)}" data-edit-id="${escapeHtml(detail.id)}"`)}
      </div>
    </div>
  `;
}

function normalizeEditTitles(titles) {
  return (Array.isArray(titles) ? titles : []).map((title) => ({
    locale: title.localeValue ?? title.locale,
    localeValue: Number(getLocaleOptionValue(title.localeValue ?? title.locale)),
    localeLabel: title.localeLabel || title.locale,
    title: title.title || '',
    fallback: Boolean(title.fallback),
    searchType: null
  }));
}

function normalizeEditAuthorities(authorities) {
  return (Array.isArray(authorities) ? authorities : []).map((authority) => ({
    authority: authority.authorityValue ?? authority.authority,
    authorityValue: Number(authority.authorityValue ?? authority.authority),
    authorityLabel: authority.authorityLabel || authority.authority,
    code: authority.code || authority.authority_code || ''
  }));
}

function getEnumDbName(type, value, fallback = 'NONE') {
  return dbEnumNames[type]?.[Number(value)] || fallback;
}

function getEnumValueByDbName(type, name, fallback = 0) {
  const raw = String(name ?? '').trim();
  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }

  const normalized = raw.toUpperCase().replace(/[\s-]+/g, '_');
  const match = Object.entries(dbEnumNames[type] || {}).find(([, label]) => label === normalized);
  return match ? Number(match[0]) : fallback;
}

function formatFlagDbNames(type, value) {
  const labels = dbEnumNames[type] || {};
  const selected = BigInt(value || 0);
  const names = Object.entries(labels)
    .filter(([bitValue]) => {
      const bit = BigInt(bitValue);
      return bit > 0n && (selected & bit) === bit;
    })
    .map(([, label]) => label);

  return names.length ? names.join(', ') : 'NONE';
}

function parseFlagDbNames(type, value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }

  const raw = String(value ?? '').trim();
  if (!raw || raw.toUpperCase() === 'NONE') {
    return 0;
  }
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  const labels = dbEnumNames[type] || {};
  const parts = raw.split(',').map((part) => part.trim().toUpperCase().replace(/[\s-]+/g, '_')).filter(Boolean);
  let selected = 0n;
  for (const part of parts) {
    const match = Object.entries(labels).find(([, label]) => label === part);
    if (match) {
      selected |= BigInt(match[0]);
    }
  }
  return Number(selected);
}

function getClipboardLocaleCode(value) {
  const localeValue = getLocaleOptionValue(value);
  return (enumLabels.locale[localeValue] || 'und').toLowerCase();
}

function getClipboardLocaleEnumName(value) {
  return getClipboardLocaleCode(value).replace(/-/g, '_').toUpperCase();
}

function titleRowsToClipboard(titles) {
  return normalizeEditTitles(titles).reduce((result, title) => {
    const text = String(title.title || '').trim();
    if (!text) {
      return result;
    }
    result[getClipboardLocaleCode(title.localeValue)] = {
      text,
      primary: Boolean(title.fallback)
    };
    return result;
  }, {});
}

function clipboardTitlesToEditRows(titles) {
  const rows = Object.entries(titles && typeof titles === 'object' ? titles : {}).map(([locale, value]) => {
    const text = typeof value === 'object' && value !== null ? value.text : value;
    const fallback = typeof value === 'object' && value !== null ? value.primary : false;
    const localeValue = Number(getLocaleOptionValue(locale));
    return {
      locale: localeValue,
      localeValue,
      localeLabel: enumLabels.locale[localeValue] || locale,
      title: String(text ?? ''),
      fallback: Boolean(fallback),
      searchType: null
    };
  }).filter((row) => row.title.trim());

  if (rows.length && rows.filter((row) => row.fallback).length !== 1) {
    rows.forEach((row, index) => {
      row.fallback = index === 0;
    });
  }
  return rows;
}

function authoritiesToClipboard(authorities) {
  return normalizeEditAuthorities(authorities).map((authority) => ({
    type: getEnumDbName('source_type', authority.authorityValue),
    code: String(authority.code || '').trim()
  })).filter((authority) => authority.code);
}

function clipboardAuthoritiesToEditRows(authorities) {
  return (Array.isArray(authorities) ? authorities : []).map((authority) => {
    const authorityValue = getEnumValueByDbName('source_type', authority?.type ?? authority?.authority, 1);
    return {
      authority: authorityValue,
      authorityValue,
      authorityLabel: enumLabels.source_type[authorityValue] || authority?.type || 'Apple Music',
      code: String(authority?.code ?? authority?.authority_code ?? '').trim()
    };
  }).filter((authority) => authority.code);
}

function relationRowsToClipboard(relations) {
  return (Array.isArray(relations) ? relations : []).map((relation) => {
    const ref = Number(relation.refArtistId ?? relation.ref_artist_id ?? relation.ref ?? relation.artistId ?? relation.artist_id);
    return {
      ref,
      role: getEnumDbName('relation', relation.relationToRef ?? relation.relation_to_ref ?? relation.role, 'MEMBER_OF')
    };
  }).filter((relation) => Number.isInteger(relation.ref) && relation.ref > 0);
}

function clipboardRelationsToEditRows(relations) {
  return (Array.isArray(relations) ? relations : []).map((relation) => ({
    refArtistId: Number(relation?.ref ?? relation?.refArtistId ?? relation?.ref_artist_id),
    relationToRef: getEnumValueByDbName('relation', relation?.role ?? relation?.relationToRef ?? relation?.relation_to_ref, 1),
    title: relation?.title || ''
  })).filter((relation) => Number.isInteger(relation.refArtistId) && relation.refArtistId > 0);
}

function getDetailId(detail, keys) {
  for (const key of keys) {
    const value = Number(detail?.[key]);
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function getFallbackTitle(titles) {
  return pickDisplayTitle(normalizeEditTitles(titles));
}

function buildClipboardArtistJson(artist) {
  const artistId = getDetailId(artist, ['artistId', 'artist_id', 'id']);
  return {
    id: artistId,
    title: titleRowsToClipboard(artist.titles),
    alias: Array.isArray(artist.aliases) ? artist.aliases.map((alias) => String(alias).trim()).filter(Boolean) : [],
    artistTag: formatFlagDbNames('artist_tag', artist.artistTag ?? artist.artist_tag ?? 0),
    artwork: artist.artwork || null,
    authority: authoritiesToClipboard(artist.authorities),
    relations: relationRowsToClipboard(artist.editableRelations || artist.relations)
  };
}

function buildClipboardAlbumJson(album) {
  const albumId = getDetailId(album, ['albumId', 'album_id', 'id']);
  const trackCounts = Array.isArray(album.trackCounts) && album.trackCounts.length
    ? album.trackCounts
    : album.trackCount || album.track_count
      ? [{ discNumber: album.discNumber ?? album.disc_number ?? 1, trackCount: album.trackCount ?? album.track_count }]
      : [];
  return {
    id: albumId,
    title: titleRowsToClipboard(album.titles),
    artists: (Array.isArray(album.artists) ? album.artists : [])
      .map((artist) => getDetailId(artist, ['artistId', 'artist_id', 'id']))
      .filter(Boolean),
    albumType: typeof album.albumType === 'string' && !/^\d+$/.test(album.albumType)
      ? album.albumType.toUpperCase().replace(/[\s-]+/g, '_')
      : getEnumDbName('album_type', album.albumType ?? album.album_type, 'ALBUM'),
    releaseDate: album.releaseDate || album.release_date || null,
    artwork: album.artwork || null,
    discCount: Number(album.discCount ?? album.disc_count) || null,
    trackCounts: trackCounts.map((row) => ({
      disc: Number(row.discNumber ?? row.disc_number ?? row.disc),
      trackCount: Number(row.trackCount ?? row.track_count)
    })).filter((row) => Number.isInteger(row.disc) && row.disc > 0 && Number.isInteger(row.trackCount) && row.trackCount > 0),
    authority: authoritiesToClipboard(album.authorities)
  };
}

function mergeSongEditMetadata(previousDetail, nextDetail) {
  const artistDetails = new Map();
  for (const artist of [...(previousDetail.relatedArtists || []), ...(previousDetail.artists || [])]) {
    const artistId = getDetailId(artist, ['artistId', 'artist_id', 'id']);
    if (artistId) {
      artistDetails.set(artistId, artist);
    }
  }

  const albumDetails = new Map();
  for (const album of previousDetail.albums || []) {
    const albumId = getDetailId(album, ['albumId', 'album_id', 'id']);
    if (albumId) {
      albumDetails.set(albumId, album);
    }
  }

  const artists = (nextDetail.artists || []).map((artist) => {
    const artistId = getDetailId(artist, ['artistId', 'artist_id', 'id']);
    const detail = artistDetails.get(artistId) || {};
    return {
      ...detail,
      ...artist,
      artistId,
      artist_id: artistId,
      title: detail.title || artist.title || getFallbackTitle(detail.titles) || `Artist ${artistId}`
    };
  });

  const albums = (nextDetail.albums || []).map((album) => {
    const albumId = getDetailId(album, ['albumId', 'album_id', 'id']);
    const detail = albumDetails.get(albumId) || {};
    return {
      ...detail,
      ...album,
      albumId,
      album_id: albumId,
      title: detail.title || album.title || getFallbackTitle(detail.titles) || `Album ${albumId}`
    };
  });

  const relatedArtistMap = new Map();
  for (const artist of [...(previousDetail.relatedArtists || []), ...artists]) {
    const artistId = getDetailId(artist, ['artistId', 'artist_id', 'id']);
    if (artistId) {
      relatedArtistMap.set(artistId, artistDetails.get(artistId) || artist);
    }
  }

  return {
    ...previousDetail,
    ...nextDetail,
    artists,
    albums,
    relatedArtists: [...relatedArtistMap.values()]
  };
}

function buildClipboardSongJson(detail) {
  const artistMap = new Map();
  for (const artist of [...(detail.relatedArtists || []), ...(detail.artists || [])]) {
    const artistId = getDetailId(artist, ['artistId', 'artist_id', 'id']);
    if (artistId) {
      artistMap.set(artistId, artist);
    }
  }
  for (const album of detail.albums || []) {
    for (const artist of album.artists || []) {
      const artistId = getDetailId(artist, ['artistId', 'artist_id', 'id']);
      if (artistId && !artistMap.has(artistId)) {
        artistMap.set(artistId, artist);
      }
    }
  }

  const song = {
    title: titleRowsToClipboard(detail.titles),
    artists: (detail.artists || []).map((artist) => ({
      id: getDetailId(artist, ['artistId', 'artist_id', 'id']),
      displayTitle: artist.displayTitle ?? artist.display_title ?? null,
      role: getEnumDbName('role', artist.role ?? 0, 'MAIN')
    })).filter((artist) => artist.id),
    albums: (detail.albums || []).map((album) => ({
      id: getDetailId(album, ['albumId', 'album_id', 'id']),
      disc: Number(album.discNumber ?? album.disc_number ?? 1),
      track: Number(album.trackNumber ?? album.track_number)
    })).filter((album) => album.id && Number.isInteger(album.track) && album.track > 0),
    audio: detail.audio || null,
    vocal: getEnumDbName('vocal', detail.vocal ?? 4, 'UNKNOWN'),
    locale: (Array.isArray(detail.locales) && detail.locales.length ? detail.locales : [{ localeValue: detail.locale ?? 1, isPrimary: true }]).map((locale) => ({
      locale: getClipboardLocaleEnumName(locale.localeValue ?? locale.locale),
      primary: Boolean(locale.isPrimary)
    })),
    genreTag: formatFlagDbNames('genre_tag', detail.genreTag ?? detail.genre_tag ?? 0),
    genreInfo: getEnumDbName('genre_info', detail.genreInfo ?? detail.genre_info ?? 0, 'NONE'),
    mediaTag: formatFlagDbNames('media_tag', detail.mediaTag ?? detail.media_tag ?? 0),
    duration: Number(detail.duration) || 0,
    releaseDate: detail.releaseDate || detail.release_date || null,
    authority: authoritiesToClipboard(detail.authorities)
  };

  return {
    source: 'CLIPBOARD',
    time: new Date().toISOString().slice(0, 19),
    artists: [...artistMap.values()].map(buildClipboardArtistJson),
    albums: (detail.albums || []).map(buildClipboardAlbumJson),
    songs: [song]
  };
}

function clipboardArtistToDetail(artist) {
  const artistId = Number(artist?.id ?? artist?.artistId ?? artist?.artist_id);
  const titles = clipboardTitlesToEditRows(artist?.title);
  return {
    artistId,
    artist_id: artistId,
    title: getFallbackTitle(titles) || `Artist ${artistId}`,
    titles,
    aliases: Array.isArray(artist?.alias) ? artist.alias : [],
    artistTag: parseFlagDbNames('artist_tag', artist?.artistTag ?? artist?.artist_tag),
    artwork: artist?.artwork || null,
    authorities: clipboardAuthoritiesToEditRows(artist?.authority ?? artist?.authorities),
    relations: clipboardRelationsToEditRows(artist?.relations),
    editableRelations: clipboardRelationsToEditRows(artist?.relations)
  };
}

function clipboardAlbumToDetail(album) {
  const albumId = Number(album?.id ?? album?.albumId ?? album?.album_id);
  const titles = clipboardTitlesToEditRows(album?.title);
  const trackCounts = (Array.isArray(album?.trackCounts) ? album.trackCounts : []).map((row) => ({
    discNumber: Number(row?.disc ?? row?.discNumber ?? row?.disc_number),
    trackCount: Number(row?.trackCount ?? row?.track_count)
  }));
  return {
    albumId,
    album_id: albumId,
    title: getFallbackTitle(titles) || `Album ${albumId}`,
    titles,
    artists: (Array.isArray(album?.artists) ? album.artists : []).map((artistId) => ({
      artistId: Number(artistId),
      artist_id: Number(artistId),
      title: `Artist ${artistId}`
    })),
    albumType: getEnumValueByDbName('album_type', album?.albumType ?? album?.album_type, 2),
    releaseDate: album?.releaseDate || album?.release_date || null,
    artwork: album?.artwork || null,
    discCount: Number(album?.discCount ?? album?.disc_count) || null,
    trackCounts,
    authorities: clipboardAuthoritiesToEditRows(album?.authority ?? album?.authorities)
  };
}

function applyClipboardSongJson(detail, payload) {
  if (!payload || payload.source !== 'CLIPBOARD' || !Array.isArray(payload.songs) || payload.songs.length !== 1) {
    throw new Error('Clipboard does not contain a Library Manager song JSON.');
  }

  const song = payload.songs[0];
  const relatedArtists = (Array.isArray(payload.artists) ? payload.artists : []).map(clipboardArtistToDetail);
  const artistById = new Map(relatedArtists.map((artist) => [artist.artistId, artist]));
  const albums = (Array.isArray(payload.albums) ? payload.albums : []).map((album) => {
    const detailAlbum = clipboardAlbumToDetail(album);
    detailAlbum.artists = detailAlbum.artists.map((artist) => artistById.get(artist.artistId) || artist);
    return detailAlbum;
  });
  const albumById = new Map(albums.map((album) => [album.albumId, album]));
  const locales = (Array.isArray(song.locale) ? song.locale : []).map((locale) => {
    const localeValue = Number(getLocaleOptionValue(locale?.locale ?? locale?.localeValue ?? locale));
    return {
      locale: enumLabels.locale[localeValue] || 'und',
      localeValue,
      localeLabel: enumLabels.locale[localeValue] || 'und',
      isPrimary: Boolean(locale?.primary ?? locale?.isPrimary)
    };
  });

  if (locales.length && locales.filter((locale) => locale.isPrimary).length !== 1) {
    locales.forEach((locale, index) => {
      locale.isPrimary = index === 0;
    });
  }

  return {
    ...detail,
    relatedArtists,
    titles: clipboardTitlesToEditRows(song.title),
    artists: (Array.isArray(song.artists) ? song.artists : []).map((artist) => {
      const artistId = Number(artist?.id ?? artist?.artistId ?? artist?.artist_id);
      const fullArtist = artistById.get(artistId) || {};
      return {
        ...fullArtist,
        artistId,
        artist_id: artistId,
        displayTitle: artist?.displayTitle ?? artist?.display_title ?? null,
        role: getEnumValueByDbName('role', artist?.role, 0),
        title: fullArtist.title || `Artist ${artistId}`
      };
    }).filter((artist) => artist.artistId),
    albums: (Array.isArray(song.albums) ? song.albums : []).map((album) => {
      const albumId = Number(album?.id ?? album?.albumId ?? album?.album_id);
      const fullAlbum = albumById.get(albumId) || {};
      return {
        ...fullAlbum,
        albumId,
        album_id: albumId,
        discNumber: Number(album?.disc ?? album?.discNumber ?? album?.disc_number ?? 1),
        trackNumber: Number(album?.track ?? album?.trackNumber ?? album?.track_number),
        trackCount: fullAlbum.trackCounts?.find((row) => Number(row.discNumber) === Number(album?.disc ?? 1))?.trackCount ?? fullAlbum.trackCount ?? null,
        title: fullAlbum.title || `Album ${albumId}`
      };
    }).filter((album) => album.albumId),
    audio: song.audio || '',
    vocal: getEnumValueByDbName('vocal', song.vocal, 4),
    locales,
    locale: locales.find((locale) => locale.isPrimary)?.localeValue ?? 1,
    localeLabel: locales.find((locale) => locale.isPrimary)?.localeLabel ?? 'und',
    genreTag: parseFlagDbNames('genre_tag', song.genreTag ?? song.genre_tag),
    genreInfo: getEnumValueByDbName('genre_info', song.genreInfo ?? song.genre_info, 0),
    mediaTag: parseFlagDbNames('media_tag', song.mediaTag ?? song.media_tag),
    duration: Number(song.duration) || 0,
    releaseDate: song.releaseDate || song.release_date || '',
    authorities: clipboardAuthoritiesToEditRows(song.authority ?? song.authorities)
  };
}

function renderTableEditStatus(errors = []) {
  if (!errors.length) {
    return '<div class="preview-status preview-status-ok">Review the fields before saving changes.</div>';
  }
  return `
    <div class="preview-status preview-status-danger">This item cannot be saved yet. Review the blocking issues below.</div>
    <section class="preview-section preview-blocking">
      <h3>Blocking Issues</h3>
      <ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>
    </section>
  `;
}

function renderReferenceArtistRows(artists, { includeDisplayTitle = false, includeRole = false } = {}) {
  const rows = Array.isArray(artists) && artists.length ? artists : [];
  return `
    <div class="preview-reference-list" data-reference-artist-list>
      ${rows.map((artist) => `
        <div class="preview-reference-row ${includeDisplayTitle && includeRole ? 'preview-reference-row-song-artist' : includeDisplayTitle ? 'preview-reference-row-medium' : ''}" data-reference-artist-row>
          ${renderSearchInput(`<input data-reference-artist-id type="number" min="1" value="${escapeHtml(artist.artistId ?? artist.artist_id ?? '')}" aria-label="Artist ID" placeholder="Artist ID">`, 'artist', 'Search artist')}
          ${includeDisplayTitle ? `<input data-reference-display-title value="${escapeHtml(artist.displayTitle ?? artist.display_title ?? '')}" placeholder="Display title" aria-label="Display title">` : ''}
          ${includeRole ? renderArtistRoleSelect(artist.role ?? 0, 'data-reference-artist-role') : ''}
          <span class="preview-reference-label">${escapeHtml(artist.title || `Artist ${artist.artistId ?? artist.artist_id ?? ''}`)}</span>
          ${renderIconButton('remove-reference-artist', 'Remove artist', 'danger')}
        </div>
      `).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-reference-artist>Add Artist</button>
    </div>
  `;
}

function renderArtistRelationRows(relations) {
  const rows = Array.isArray(relations) && relations.length ? relations : [];
  return `
    <div class="preview-reference-list" data-artist-relation-list>
      ${rows.map((relation) => {
        const artistId = relation.refArtistId ?? relation.ref_artist_id ?? relation.artistId ?? relation.artist_id ?? '';
        return `
          <div class="preview-reference-row preview-reference-row-wide" data-artist-relation-row>
            ${renderSearchInput(`<input data-relation-artist-id type="number" min="1" value="${escapeHtml(artistId)}" aria-label="Related artist ID" placeholder="Artist ID">`, 'artist', 'Search artist')}
            <select data-relation-to-ref aria-label="Artist relation">
              ${renderEnumOptions(enumLabels.relation, relation.relationToRef ?? relation.relation_to_ref ?? 1)}
            </select>
            <span class="preview-reference-label">${escapeHtml(relation.title || `Artist ${artistId}`)}</span>
            ${renderIconButton('remove-artist-relation', 'Remove relation', 'danger')}
          </div>
        `;
      }).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-artist-relation>Add Relation</button>
    </div>
  `;
}

function renderArtistMergePreview(preview) {
  if (!preview) {
    return '';
  }

  const albumRows = preview.references?.albums || [];
  const songRows = preview.references?.songs || [];
  const deletedTableRows = preview.deletedTables || Object.entries(preview.deletedSourceRows || {}).map(([tableName, rowCount]) => ({
    tableName,
    rowCount
  }));
  const authorityRows = (preview.authorities?.rows || []).slice(0, 12).map((row) => `
    <li>${escapeHtml(row.action === 'move' ? 'Move' : 'Skip duplicate')}: ${escapeHtml(row.authority)} ${escapeHtml(row.code)}</li>
  `).join('');
  const aliasRows = (preview.aliases?.rows || []).slice(0, 12).map((row) => `
    <li>${escapeHtml(row.action === 'add' ? 'Add' : 'Skip duplicate')}: ${escapeHtml(row.alias || '-')} <span class="detail-empty-text">from ${escapeHtml(row.source)}</span></li>
  `).join('');
  const albumList = albumRows.map((row) => `
    <li>${escapeHtml(row.title || `Album ${row.albumId}`)} <span class="detail-empty-text">album ${escapeHtml(row.albumId)} · order ${escapeHtml(row.displayOrder)}</span></li>
  `).join('');
  const songList = songRows.map((row) => `
    <li>${escapeHtml(row.title || `Song ${row.songId}`)} <span class="detail-empty-text">song ${escapeHtml(row.songId)} · order ${escapeHtml(row.displayOrder)} · display "${escapeHtml(row.oldDisplayTitle || '-')}" -> "${escapeHtml(row.newDisplayTitle || '')}"</span></li>
  `).join('');
  const deleteRows = deletedTableRows.map((row) => `
    <li>${escapeHtml(row.tableName)}: ${escapeHtml(row.rowCount)} row(s)</li>
  `).join('');

  return `
    <section class="preview-section preview-blocking" data-artist-merge-preview>
      <h3>Merge Preview</h3>
      <div class="preview-status preview-status-danger">
        Artist ${escapeHtml(preview.sourceArtist?.id)} (${escapeHtml(preview.sourceArtist?.title)}) will be merged into artist ${escapeHtml(preview.targetArtist?.id)} (${escapeHtml(preview.targetArtist?.title)}).
      </div>
      <div class="detail-mini-card">
        <div class="detail-mini-title">References</div>
        <div class="detail-mini-meta">${escapeHtml(`${preview.references?.albumArtistRowsUpdated || 0} album artist row(s), ${preview.references?.songArtistRowsUpdated || 0} song artist row(s)`)}</div>
        <div class="detail-mini-meta">${escapeHtml(`Song display title becomes "${preview.references?.songDisplayTitle || ''}"`)}</div>
      </div>
      <details class="detail-expand">
        <summary><span>${escapeHtml(`Changed Albums (${albumRows.length})`)}</span></summary>
        ${albumList ? `<ul>${albumList}</ul>` : '<p class="detail-empty-text">No album artist rows will change.</p>'}
      </details>
      <details class="detail-expand">
        <summary><span>${escapeHtml(`Changed Songs (${songRows.length})`)}</span></summary>
        ${songList ? `<ul>${songList}</ul>` : '<p class="detail-empty-text">No song artist rows will change.</p>'}
      </details>
      <div class="detail-mini-card">
        <div class="detail-mini-title">Relations</div>
        <div class="detail-mini-meta">${escapeHtml(`${preview.relations?.updated || 0} update(s), ${preview.relations?.deleted || 0} duplicate/self relation delete(s)`)}</div>
      </div>
      <div class="detail-mini-card">
        <div class="detail-mini-title">Authorities</div>
        <div class="detail-mini-meta">${escapeHtml(`${preview.authorities?.moved || 0} move(s), ${preview.authorities?.skipped || 0} duplicate skip(s)`)}</div>
        ${authorityRows ? `<ul>${authorityRows}</ul>` : ''}
      </div>
      <div class="detail-mini-card">
        <div class="detail-mini-title">Aliases</div>
        <div class="detail-mini-meta">${escapeHtml(`${preview.aliases?.inserted || 0} add(s), ${preview.aliases?.skipped || 0} duplicate skip(s)`)}</div>
        ${aliasRows ? `<ul>${aliasRows}</ul>` : ''}
      </div>
      <div class="detail-mini-card">
        <div class="detail-mini-title">Delete Targets</div>
        ${deleteRows ? `<ul>${deleteRows}</ul>` : '<div class="detail-mini-meta">No source rows will be deleted.</div>'}
      </div>
    </section>
  `;
}

function renderArtistMergeControls(detail) {
  const mergeTargetArtistId = detail.mergePreview?.targetArtist?.id ?? detail.mergeTargetArtistId ?? '';
  const canPreview = Number.isInteger(Number(mergeTargetArtistId)) && Number(mergeTargetArtistId) > 0;
  return `
    <div class="preview-reference-list">
      <div class="preview-reference-row" data-artist-merge-row>
        ${renderSearchInput(`<input data-merge-target-artist-id type="number" min="1" value="${escapeHtml(mergeTargetArtistId)}" aria-label="Target artist ID" placeholder="Target artist ID">`, 'artist', 'Search target artist')}
        <span class="preview-reference-label">${escapeHtml(detail.mergePreview?.targetArtist?.title || 'Target artist')}</span>
        <button class="preview-small-btn danger" type="button" data-preview-dry-run-merge-artist ${canPreview ? '' : 'disabled'}>Preview Merge</button>
      </div>
      <p class="detail-empty-text">
        Merge artist ${escapeHtml(detail.id)} into the target artist. Authorities move to the target, source titles and aliases become target aliases, references are rewired, and this artist is deleted.
      </p>
      ${renderArtistMergePreview(detail.mergePreview)}
    </div>
  `;
}

function getArtistMergeStatus(detail, errors = []) {
  if (errors.length) {
    return {
      tone: 'danger',
      message: errors[0]
    };
  }
  const targetArtistId = Number(detail.mergePreview?.targetArtist?.id ?? detail.mergeTargetArtistId ?? '');
  if (!Number.isInteger(targetArtistId) || targetArtistId <= 0) {
    return {
      tone: 'pending',
      message: 'Enter or search for the target artist to merge into.'
    };
  }
  if (!detail.mergePreview) {
    return {
      tone: 'pending',
      message: 'Run Preview Merge to review the exact changes before completing.'
    };
  }
  return {
    tone: 'ok',
    message: 'Preview is ready. Review the changes below, then press Complete Merge.'
  };
}

function renderArtistMergeStatus(detail, errors = []) {
  const status = getArtistMergeStatus(detail, errors);
  return `<div class="preview-status preview-status-${escapeHtml(status.tone)}" data-artist-merge-status>${escapeHtml(status.message)}</div>`;
}

function syncArtistMergeModalControls(content, workingDetail, confirmButton) {
  const input = content.querySelector('[data-merge-target-artist-id]');
  const previewButton = content.querySelector('[data-preview-dry-run-merge-artist]');
  const statusElement = content.querySelector('[data-artist-merge-status]');
  const targetArtistId = Number(input?.value || '');
  const hasTarget = Number.isInteger(targetArtistId) && targetArtistId > 0;
  const hasCurrentPreview = Boolean(workingDetail.mergePreview && targetArtistId === Number(workingDetail.mergePreview.targetArtist?.id));

  if (previewButton) {
    previewButton.disabled = !hasTarget;
  }
  if (confirmButton) {
    confirmButton.disabled = !hasCurrentPreview;
  }
  if (!hasCurrentPreview) {
    content.querySelector('[data-artist-merge-preview]')?.remove();
  }
  if (statusElement) {
    const status = getArtistMergeStatus(workingDetail);
    statusElement.className = `preview-status preview-status-${status.tone}`;
    statusElement.textContent = status.message;
  }
}

function renderReferenceAlbumRows(albums) {
  const rows = Array.isArray(albums) && albums.length ? albums : [];
  return `
    <div class="preview-reference-list" data-reference-album-list>
      ${rows.map((album) => `
        <div class="preview-reference-row preview-reference-row-wide" data-reference-album-row>
          ${renderSearchInput(`<input data-reference-album-id type="number" min="1" value="${escapeHtml(album.albumId ?? album.album_id ?? '')}" aria-label="Album ID" placeholder="Album ID">`, 'album', 'Search album')}
          ${renderNumberPair(album.discNumber ?? album.disc_number ?? 1, album.trackNumber ?? album.track_number, 'data-reference-disc-number', 'data-reference-track-number', 'Disc and track')}
          <input data-reference-track-count type="number" min="1" value="${escapeHtml(album.trackCount ?? album.track_count ?? '')}" placeholder="Track count" aria-label="Track count">
          <span class="preview-reference-label">${escapeHtml(album.title || `Album ${album.albumId ?? album.album_id ?? ''}`)}</span>
          ${renderIconButton('remove-reference-album', 'Remove album', 'danger')}
        </div>
      `).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-reference-album>Add Album</button>
    </div>
  `;
}

function renderTrackCountRows(trackCounts) {
  const rows = Array.isArray(trackCounts) && trackCounts.length ? trackCounts : [];
  return `
    <div class="preview-reference-list" data-track-count-list>
      ${rows.map((row) => `
        <div class="preview-reference-row" data-track-count-row>
          <input data-track-count-disc type="number" min="1" value="${escapeHtml(row.discNumber ?? row.disc_number ?? '')}" placeholder="Disc" aria-label="Disc number">
          <input data-track-count-value type="number" min="1" value="${escapeHtml(row.trackCount ?? row.track_count ?? '')}" placeholder="Track count" aria-label="Track count">
          ${renderIconButton('remove-track-count', 'Remove track count', 'danger')}
        </div>
      `).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-track-count>Add Track Count</button>
    </div>
  `;
}

function renderAlbumTrackRows(tracks) {
  const rows = Array.isArray(tracks) && tracks.length ? tracks : [];
  return `
    <div class="preview-reference-list" data-album-track-list>
      ${rows.map((track) => `
        <div class="preview-reference-row preview-reference-row-medium" data-album-track-row>
          ${renderSearchInput(`<input data-track-song-id type="number" min="1" value="${escapeHtml(track.songId ?? track.song_id ?? '')}" aria-label="Song ID" placeholder="Song ID">`, 'song', 'Search song')}
          ${renderNumberPair(track.discNumber ?? track.disc_number ?? 1, track.trackNumber ?? track.track_number, 'data-track-disc-number', 'data-track-track-number', 'Disc and track')}
          <span class="preview-reference-label">${escapeHtml(track.title || `Song ${track.songId ?? track.song_id ?? ''}`)}</span>
          ${renderIconButton('remove-album-track', 'Remove linked song', 'danger')}
        </div>
      `).join('')}
      <button class="preview-add-btn" type="button" data-preview-add-album-track>Add Linked Song</button>
    </div>
  `;
}

function renderArtistEditForm(detail, errors = []) {
  return `
    ${renderTableEditStatus(errors)}
    <section class="preview-section" data-edit-titles>
      <h3>Titles</h3>
      ${renderSongPreviewTitleList(normalizeEditTitles(detail.titles))}
    </section>
    <section class="preview-section">
      <h3>Alias</h3>
      ${renderAliasEditor(detail.aliases)}
    </section>
    <section class="preview-section">
      <h3>Artist Tag</h3>
      ${renderFlagDropdown(flagLabels.artist_tag, detail.artistTag ?? detail.artist_tag ?? 0, 'data-edit-artist-tag')}
    </section>
    <section class="preview-section">
      <h3>Artwork</h3>
      ${renderArtworkInput(detail.artwork, 'data-edit-artwork', 'Artist artwork')}
    </section>
    <section class="preview-section" data-edit-authorities data-authority-context="artist">
      <h3>Authority</h3>
      ${renderSongPreviewAuthorities(normalizeEditAuthorities(detail.authorities))}
    </section>
    <section class="preview-section">
      <h3>Relations</h3>
      ${renderArtistRelationRows(detail.editableRelations || detail.relations)}
    </section>
  `;
}

function renderAlbumEditForm(detail, errors = []) {
  return `
    ${renderTableEditStatus(errors)}
    <section class="preview-section" data-edit-titles>
      <h3>Titles</h3>
      ${renderSongPreviewTitleList(normalizeEditTitles(detail.titles))}
    </section>
    <section class="preview-section preview-song-scalar-section">
      ${renderPreviewDetailRow('Album Type', `<select data-edit-album-type aria-label="Album type">${renderEnumOptions(enumLabels.album_type, getAlbumTypeOptionValue(detail.albumType))}</select>`, { html: true })}
      ${renderPreviewDetailRow('Disc Count', `<input data-edit-disc-count type="number" min="1" value="${escapeHtml(detail.discCount || '')}" aria-label="Disc count">`, { html: true })}
      ${renderPreviewDetailRow('Release Date', `<input data-edit-release-date type="date" value="${escapeHtml((detail.releaseDate || '').slice(0, 10))}" aria-label="Release date">`, { html: true })}
      ${renderPreviewDetailRow('Artwork', renderArtworkInput(detail.artwork, 'data-edit-artwork', 'Album artwork'), { html: true })}
    </section>
    <section class="preview-section">
      <h3>Artists</h3>
      ${renderReferenceArtistRows(detail.artists)}
    </section>
    <section class="preview-section">
      <h3>Track Counts</h3>
      ${renderTrackCountRows(detail.trackCounts)}
    </section>
    <section class="preview-section">
      <h3>Songs</h3>
      ${renderAlbumTrackRows(detail.tracks)}
    </section>
    <section class="preview-section" data-edit-authorities data-authority-context="album">
      <h3>Authority</h3>
      ${renderSongPreviewAuthorities(normalizeEditAuthorities(detail.authorities))}
    </section>
  `;
}

function renderSongEditForm(detail, errors = []) {
  return `
    ${renderTableEditStatus(errors)}
    <section class="preview-section" data-edit-titles>
      <h3>Titles</h3>
      ${renderSongPreviewTitleList(normalizeEditTitles(detail.titles))}
    </section>
    <section class="preview-section">
      <h3>Artists</h3>
      ${renderReferenceArtistRows(detail.artists, { includeDisplayTitle: true, includeRole: true })}
    </section>
    <section class="preview-section preview-song-scalar-section">
      ${renderPreviewDetailRow('Audio', renderAudioInput(detail.audio, 'data-edit-audio', 'Audio'), { html: true })}
      ${renderPreviewDetailRow('Vocal', `<select data-edit-vocal aria-label="Vocal">${renderEnumOptions(enumLabels.vocal, detail.vocal ?? 4)}</select>`, { html: true })}
      ${renderPreviewDetailRow('Locale', renderSongPreviewLocales(detail.locales, detail.locale), { html: true })}
      ${renderPreviewDetailRow('Genre Tag', renderFlagDropdown(flagLabels.genre_tag, detail.genreTag ?? 0, 'data-edit-genre-tag'), { html: true })}
      ${renderPreviewDetailRow('Genre Info', `<select data-edit-genre-info aria-label="Genre info">${renderEnumOptions(enumLabels.genre_info, detail.genreInfo ?? 0)}</select>`, { html: true })}
      ${renderPreviewDetailRow('Media Tag', renderFlagDropdown(flagLabels.media_tag, detail.mediaTag ?? 0, 'data-edit-media-tag'), { html: true })}
      ${renderPreviewDetailRow('Duration', `<input data-edit-duration type="number" min="1" value="${escapeHtml(detail.duration || '')}" aria-label="Duration">`, { html: true })}
      ${renderPreviewDetailRow('Release Date', `<input data-edit-release-date type="date" value="${escapeHtml((detail.releaseDate || '').slice(0, 10))}" aria-label="Release date">`, { html: true })}
    </section>
    <section class="preview-section">
      <h3>Albums</h3>
      ${renderReferenceAlbumRows(detail.albums)}
    </section>
    <section class="preview-section" data-edit-authorities data-authority-context="song">
      <h3>Authority</h3>
      ${renderSongPreviewAuthorities(normalizeEditAuthorities(detail.authorities))}
    </section>
  `;
}

function renderEntryEditForm(detail, errors = []) {
  const groupMode = detail.entryGroupMode || (detail.entryGroupId ? 'existing' : 'none');
  const groupLookupDisabled = groupMode !== 'existing';
  const songId = detail.songId || '';
  const status = detail.status || 'PENDING';
  const groupLabel = detail.entryGroupSongTitle
    ? `${detail.entryGroupSongTitle}${detail.entryGroupSongId ? ` · Song ${detail.entryGroupSongId}` : ''}`
    : detail.entryGroupId
      ? `Entry Group ${detail.entryGroupId}`
      : 'No group';
  const mappingLabel = detail.songTitle
    ? `${detail.songTitle} · Song ${detail.songId}`
    : detail.songId
      ? `Song ${detail.songId}`
      : 'No mapping';
  return `
    ${renderTableEditStatus(errors)}
    <section class="preview-section">
      <h3>Details</h3>
      ${renderPreviewDetailRow('ID', detail.id)}
      ${renderPreviewDetailRow('Source', renderEntrySourceDetail(detail), { html: true })}
      ${renderPreviewDetailRow('Title', detail.title)}
      ${renderPreviewDetailRow('Artist', detail.artist)}
      ${renderPreviewDetailRow('Album', detail.album)}
    </section>
    <section class="preview-section">
      <h3>Entry Group</h3>
      <div class="preview-reference-list">
        <div class="preview-reference-row" data-entry-group-row>
          ${renderSearchInput(`<input data-entry-group-id type="number" min="1" value="${escapeHtml(detail.entryGroupId || '')}" aria-label="Entry group ID" placeholder="Group ID" ${groupLookupDisabled ? 'disabled' : ''}>`, 'entry-group', 'Search entry group').replace('data-preview-search', `${groupLookupDisabled ? 'disabled ' : ''}data-preview-search`)}
          <select data-entry-group-mode aria-label="Entry group action">
            <option value="none" ${groupMode === 'none' ? 'selected' : ''}>No group</option>
            <option value="existing" ${groupMode === 'existing' ? 'selected' : ''}>Use existing group</option>
            <option value="new" ${groupMode === 'new' ? 'selected' : ''}>Create new group</option>
          </select>
          <span class="preview-reference-label">${escapeHtml(groupLabel)}</span>
        </div>
      </div>
    </section>
    <section class="preview-section">
      <h3>Entry Mapping</h3>
      <div class="preview-reference-list">
        <div class="preview-reference-row" data-entry-mapping-row>
          ${renderSearchInput(`<input data-entry-mapping-song-id type="number" min="1" value="${escapeHtml(songId)}" aria-label="Song ID" placeholder="Song ID">`, 'song', 'Search song')}
          <select data-entry-mapping-status aria-label="Entry mapping status">
            <option value="PENDING" ${status === 'PENDING' ? 'selected' : ''}>Pending</option>
            <option value="CONFIRMED" ${status === 'CONFIRMED' ? 'selected' : ''}>Confirmed</option>
            <option value="REJECTED" ${status === 'REJECTED' ? 'selected' : ''}>Rejected</option>
          </select>
          <span class="preview-reference-label">${escapeHtml(mappingLabel)}</span>
        </div>
      </div>
      <p class="detail-empty-text">Leave Song ID empty to remove entry mapping.</p>
    </section>
  `;
}

function syncEntryGroupLookupControls(row) {
  if (!row) {
    return;
  }
  const mode = row.querySelector('[data-entry-group-mode]')?.value || 'none';
  const disabled = mode !== 'existing';
  const input = row.querySelector('[data-entry-group-id]');
  const searchButton = row.querySelector('[data-preview-search="entry-group"]');
  const label = row.querySelector('.preview-reference-label');

  if (input) {
    input.disabled = disabled;
  }
  if (searchButton) {
    searchButton.disabled = disabled;
  }
  if (disabled && label) {
    label.textContent = mode === 'new' ? 'New entry group will be created' : 'No group';
  } else if (!disabled && label && input && !input.value.trim()) {
    label.textContent = 'No group';
  }
}

function renderTableEditForm(table, detail, errors = []) {
  if (table === 'entry') {
    return renderEntryEditForm(detail, errors);
  }
  if (table === 'artist') {
    return renderArtistEditForm(detail, errors);
  }
  if (table === 'album') {
    return renderAlbumEditForm(detail, errors);
  }
  if (table === 'song') {
    return renderSongEditForm(detail, errors);
  }
  return '';
}

function collectReferenceArtists(root, { includeDisplayTitle = false } = {}) {
  if (!root) {
    return [];
  }
  return Array.from(root.querySelectorAll(':scope [data-reference-artist-row]')).map((row) => ({
    artistId: Number(getElementValue(row, '[data-reference-artist-id]', '')),
    displayTitle: includeDisplayTitle ? getElementValue(row, '[data-reference-display-title]', '').trim() || null : null,
    role: Number(getElementValue(row, '[data-reference-artist-role]', '0')),
    title: row.querySelector('.preview-reference-label')?.textContent?.trim() || ''
  })).filter((artist) => artist.artistId || artist.displayTitle);
}

function collectArtistRelations(root) {
  if (!root) {
    return [];
  }
  return Array.from(root.querySelectorAll(':scope [data-artist-relation-row]')).map((row) => ({
    refArtistId: Number(getElementValue(row, '[data-relation-artist-id]', '')),
    relationToRef: Number(getElementValue(row, '[data-relation-to-ref]', '1')),
    title: row.querySelector('.preview-reference-label')?.textContent?.trim() || ''
  })).filter((relation) => relation.refArtistId || relation.title);
}

function collectReferenceAlbums(root) {
  if (!root) {
    return [];
  }
  return Array.from(root.querySelectorAll(':scope [data-reference-album-row]')).map((row) => ({
    albumId: Number(getElementValue(row, '[data-reference-album-id]', '')),
    discNumber: Number(getElementValue(row, '[data-reference-disc-number]', '1')),
    trackNumber: Number(getElementValue(row, '[data-reference-track-number]', '')),
    trackCount: Number(getElementValue(row, '[data-reference-track-count]', '')),
    title: row.querySelector('.preview-reference-label')?.textContent?.trim() || ''
  })).filter((album) => album.albumId || album.trackNumber);
}

function collectTrackCounts(root) {
  if (!root) {
    return [];
  }
  return Array.from(root.querySelectorAll(':scope [data-track-count-row]')).map((row) => ({
    discNumber: Number(getElementValue(row, '[data-track-count-disc]', '')),
    trackCount: Number(getElementValue(row, '[data-track-count-value]', ''))
  })).filter((row) => row.discNumber || row.trackCount);
}

function collectAlbumTracks(root) {
  if (!root) {
    return [];
  }
  return Array.from(root.querySelectorAll(':scope [data-album-track-row]')).map((row) => ({
    songId: Number(getElementValue(row, '[data-track-song-id]', '')),
    discNumber: Number(getElementValue(row, '[data-track-disc-number]', '1')),
    trackNumber: Number(getElementValue(row, '[data-track-track-number]', '')),
    title: row.querySelector('.preview-reference-label')?.textContent?.trim() || ''
  })).filter((row) => row.songId || row.trackNumber);
}

function collectTableEditPlan(table, content, detail) {
  if (table === 'entry') {
    return {
      ...detail,
      entryGroupMode: getElementValue(content, '[data-entry-group-mode]', 'none'),
      entryGroupId: Number(getElementValue(content, '[data-entry-group-id]', '')),
      songId: Number(getElementValue(content, '[data-entry-mapping-song-id]', '')),
      status: getElementValue(content, '[data-entry-mapping-status]', 'PENDING')
    };
  }

  const common = {
    id: detail.id,
    titles: collectTitleList(content.querySelector('[data-edit-titles] [data-title-list]')),
    authorities: collectAuthorityList(content.querySelector('[data-edit-authorities] [data-authority-list]'))
  };
  if (table === 'artist') {
    const relations = collectArtistRelations(content.querySelector('[data-artist-relation-list]'));
    return {
      ...detail,
      ...common,
      artistTag: collectFlagValue(content.querySelector('[data-edit-artist-tag]')),
      aliases: collectAliasList(content.querySelector('[data-alias-list]')),
      artwork: getElementValue(content, '[data-edit-artwork]', ''),
      editableRelations: relations,
      relations
    };
  }
  if (table === 'album') {
    return {
      ...detail,
      ...common,
      albumType: getElementValue(content, '[data-edit-album-type]', ''),
      discCount: Number(getElementValue(content, '[data-edit-disc-count]', '')),
      releaseDate: getElementValue(content, '[data-edit-release-date]', ''),
      artwork: getElementValue(content, '[data-edit-artwork]', ''),
      artists: collectReferenceArtists(content.querySelector('[data-reference-artist-list]')),
      trackCounts: collectTrackCounts(content.querySelector('[data-track-count-list]')),
      tracks: collectAlbumTracks(content.querySelector('[data-album-track-list]'))
    };
  }
  const locales = collectLocaleList(content.querySelector('[data-locale-list]'));
  const primaryLocale = locales.find((locale) => locale.isPrimary) || locales[0];
  return {
    ...detail,
    ...common,
    audio: getElementValue(content, '[data-edit-audio]', ''),
    vocal: Number(getElementValue(content, '[data-edit-vocal]', '4')),
    locales,
    locale: primaryLocale?.localeValue ?? 1,
    localeLabel: primaryLocale?.localeLabel ?? 'und',
    genreTag: collectFlagValue(content.querySelector('[data-edit-genre-tag]')),
    genreInfo: Number(getElementValue(content, '[data-edit-genre-info]', '0')),
    mediaTag: collectFlagValue(content.querySelector('[data-edit-media-tag]')),
    duration: Number(getElementValue(content, '[data-edit-duration]', '0')),
    releaseDate: getElementValue(content, '[data-edit-release-date]', ''),
    artists: collectReferenceArtists(content.querySelector('[data-reference-artist-list]'), { includeDisplayTitle: true }),
    albums: collectReferenceAlbums(content.querySelector('[data-reference-album-list]'))
  };
}

function getTableEditValidationErrors(table, plan) {
  if (table === 'entry') {
    const errors = [];
    if (plan.entryGroupMode === 'existing' && (!Number.isInteger(Number(plan.entryGroupId)) || Number(plan.entryGroupId) <= 0)) {
      errors.push('Entry group ID is required when using an existing group.');
    }
    if (!['none', 'existing', 'new'].includes(plan.entryGroupMode)) {
      errors.push('Entry group action is unknown.');
    }
    if (plan.songId && (!Number.isInteger(Number(plan.songId)) || Number(plan.songId) <= 0)) {
      errors.push('Entry mapping song ID must be a positive integer.');
    }
    if (plan.songId && !['PENDING', 'CONFIRMED', 'REJECTED'].includes(plan.status)) {
      errors.push('Entry mapping status is unknown.');
    }
    return [...new Set(errors)];
  }

  const errors = [
    ...getTitleValidationErrors(plan.titles, `${table} title`, { required: true })
  ];
  if (table === 'artist') {
    for (const relation of plan.relations || []) {
      if (!Number.isInteger(Number(relation.refArtistId)) || Number(relation.refArtistId) <= 0) {
        errors.push('Artist relations contains a missing or invalid artist ID.');
      }
      if (Number(relation.refArtistId) === Number(plan.id)) {
        errors.push('Artist relations cannot reference the artist itself.');
      }
      if (!Object.prototype.hasOwnProperty.call(enumLabels.relation, String(relation.relationToRef))) {
        errors.push('Artist relations contains an unknown relation.');
      }
    }
  }
  if (table === 'album') {
    if (!isCompilationAlbumType(plan.albumType) && !plan.artists?.length) {
      errors.push('Album must have at least one artist.');
    }
    for (const artist of plan.artists || []) {
      if (!Number.isInteger(Number(artist.artistId)) || Number(artist.artistId) <= 0) {
        errors.push('Album artists contains a missing or invalid artist ID.');
      }
    }
    for (const track of plan.tracks || []) {
      if (!Number.isInteger(Number(track.songId)) || Number(track.songId) <= 0 || !Number.isInteger(Number(track.trackNumber)) || Number(track.trackNumber) <= 0) {
        errors.push('Album songs contains a missing or invalid song ID or track number.');
      }
    }
  }
  if (table === 'song') {
    if (!plan.artists?.length) {
      errors.push('Song must have at least one artist.');
    }
    if (!Number.isInteger(Number(plan.duration)) || Number(plan.duration) <= 0) {
      errors.push('Song duration must be positive.');
    }
    for (const artist of plan.artists || []) {
      if (!Number.isInteger(Number(artist.artistId)) || Number(artist.artistId) <= 0) {
        errors.push('Song artists contains a missing or invalid artist ID.');
      }
    }
    for (const album of plan.albums || []) {
      if (!Number.isInteger(Number(album.albumId)) || Number(album.albumId) <= 0 || !Number.isInteger(Number(album.trackNumber)) || Number(album.trackNumber) <= 0) {
        errors.push('Song albums contains a missing or invalid album ID or track number.');
      }
    }
  }
  return [...new Set(errors)];
}

function addTableEditRow(table, workingDetail, action, context = null) {
  if (action === 'title') {
    workingDetail.titles = workingDetail.titles || [];
    workingDetail.titles.push({ locale: 1, localeValue: 1, localeLabel: 'und', title: '', fallback: !workingDetail.titles.length, searchType: null });
  } else if (action === 'authority') {
    workingDetail.authorities = workingDetail.authorities || [];
    workingDetail.authorities.push({ authority: 1, authorityValue: 1, authorityLabel: 'Apple Music', code: '' });
  } else if (action === 'alias') {
    workingDetail.aliases = workingDetail.aliases || [];
    workingDetail.aliases.push('');
  } else if (action === 'artist') {
    workingDetail.artists = workingDetail.artists || [];
    workingDetail.artists.push({ artistId: null, artist_id: null, title: '' });
  } else if (action === 'artist-relation') {
    workingDetail.editableRelations = workingDetail.editableRelations || [];
    workingDetail.editableRelations.push({ refArtistId: null, relationToRef: 1, title: '' });
    workingDetail.relations = workingDetail.editableRelations;
  } else if (action === 'album') {
    workingDetail.albums = workingDetail.albums || [];
    workingDetail.albums.push({ albumId: null, album_id: null, discNumber: 1, trackNumber: null, trackCount: null, title: '' });
  } else if (action === 'track-count') {
    workingDetail.trackCounts = workingDetail.trackCounts || [];
    workingDetail.trackCounts.push({ discNumber: null, trackCount: null });
  } else if (action === 'album-track') {
    workingDetail.tracks = workingDetail.tracks || [];
    workingDetail.tracks.push({ songId: null, discNumber: 1, trackNumber: null, title: '' });
  } else if (action === 'locale') {
    workingDetail.locales = workingDetail.locales || [];
    workingDetail.locales.push({ locale: 1, localeValue: 1, localeLabel: 'und', isPrimary: !workingDetail.locales.length });
  }
  return context;
}

async function showTableEditModal(table, detail) {
  const modal = $('song-preview-modal');
  const title = $('song-preview-title');
  const kicker = $('song-preview-kicker');
  const content = $('song-preview-content');
  const closeButton = $('song-preview-close');
  const cancelButton = $('song-preview-cancel');
  const confirmButton = $('song-preview-confirm');
  const clipboardActions = $('song-edit-clipboard-actions');
  const copyJsonButton = $('song-copy-json');
  const pasteJsonButton = $('song-paste-json');
  let workingDetail = clonePreview(detail);
  let errors = Array.isArray(detail.errors) ? detail.errors : [];
  let lastReferenceSearch = null;

  const render = () => {
    modal.dataset.editTable = table;
    clipboardActions?.classList.toggle('hidden', table !== 'song');
    title.textContent = `Edit ${table[0].toUpperCase()}${table.slice(1)}`;
    kicker.textContent = `${table} ${detail.id}`;
    content.innerHTML = `
      <div class="song-preview-layout">
        <div class="song-preview-main">
          ${renderTableEditForm(table, workingDetail, errors)}
        </div>
        <aside id="preview-search-results" class="preview-search-results hidden"></aside>
      </div>
    `;
    updatePreviewAuthorityLinkButtons(content);
    confirmButton.classList.remove('hidden');
    confirmButton.disabled = false;
    confirmButton.textContent = 'Save Changes';
    cancelButton.textContent = 'Cancel';
    syncPreviewAudioButton(content);
  };

  render();
  openModalUi(modal);

  return new Promise((resolve) => {
    const close = (value) => {
      closeModalUi(modal);
      stopPreviewAudio();
      closeButton.removeEventListener('click', closeAsFalse);
      cancelButton.removeEventListener('click', closeAsFalse);
      confirmButton.removeEventListener('click', closeAsTrue);
      copyJsonButton?.removeEventListener('click', copySongJson);
      pasteJsonButton?.removeEventListener('click', pasteSongJson);
      document.removeEventListener('keydown', handleKeydown);
      content.removeEventListener('click', handleContentClick);
      content.removeEventListener('change', handleContentChange);
      content.removeEventListener('focusout', handleContentFocusOut);
      content.removeEventListener('input', handleContentInput);
      content.removeEventListener('keydown', handleContentKeydown);
      content.removeEventListener('scroll', positionPreviewSearchResults);
      window.removeEventListener('resize', positionPreviewSearchResults);
      clipboardActions?.classList.add('hidden');
      delete modal.dataset.editTable;
      resolve(value);
    };
    const closeAsFalse = () => close(false);
    const closeAsTrue = () => {
      const collectedDetail = collectTableEditPlan(table, content, workingDetail);
      workingDetail = table === 'song'
        ? mergeSongEditMetadata(workingDetail, collectedDetail)
        : collectedDetail;
      errors = getTableEditValidationErrors(table, workingDetail);
      if (errors.length) {
        render();
        return;
      }
      close(workingDetail);
    };
    const copySongJson = async () => {
      if (table !== 'song') {
        return;
      }
      try {
        const collectedDetail = collectTableEditPlan(table, content, workingDetail);
        workingDetail = mergeSongEditMetadata(workingDetail, collectedDetail);
        const text = JSON.stringify(buildClipboardSongJson(workingDetail), null, 2);
        await navigator.clipboard.writeText(text);
        animateIconButtonSuccess(copyJsonButton);
      } catch (error) {
        errors = [error.message || 'Unable to copy song JSON.'];
        render();
      }
    };
    const pasteSongJson = async () => {
      if (table !== 'song') {
        return;
      }
      try {
        const text = await navigator.clipboard.readText();
        const payload = JSON.parse(text);
        workingDetail = applyClipboardSongJson(workingDetail, payload);
        errors = getTableEditValidationErrors(table, workingDetail);
        render();
        animateIconButtonSuccess(pasteJsonButton);
      } catch (error) {
        errors = [error.message || 'Clipboard does not contain valid song JSON.'];
        render();
      }
    };
    const handleKeydown = (event) => {
      if (event.key === 'Escape') {
        close(false);
      }
    };
    const handleContentChange = (event) => {
      const dropdown = event.target.closest('.preview-flag-dropdown');
      if (dropdown) {
        updateFlagDropdownSummary(dropdown);
      }
      if (event.target.matches('[data-authority-kind]')) {
        updatePreviewAuthorityLinkButton(event.target.closest('.preview-authority-row'));
      }
      if (event.target.matches('[data-edit-album-type]')) {
        workingDetail = collectTableEditPlan(table, content, workingDetail);
        errors = getTableEditValidationErrors(table, workingDetail);
        render();
        return;
      }
      if (event.target.matches('[data-entry-group-mode]')) {
        syncEntryGroupLookupControls(event.target.closest('[data-entry-group-row]'));
        workingDetail = collectTableEditPlan(table, content, workingDetail);
      }
    };
    const handleContentFocusOut = (event) => {
      if (event.target.matches('[data-authority-code]')) {
        normalizePreviewAuthorityInput(event.target);
        updatePreviewAuthorityLinkButton(event.target.closest('.preview-authority-row'));
      }
    };
    const handleContentInput = (event) => {
      if (event.target.matches('[data-song-audio], [data-edit-audio]')) {
        stopPreviewAudio();
        return;
      }
      if (event.target.matches('[data-entry-group-id]')) {
        const row = event.target.closest('[data-entry-group-row]');
        const label = row?.querySelector('.preview-reference-label');
        if (label) {
          label.textContent = event.target.value.trim() ? `Entry Group ${event.target.value.trim()}` : 'No group';
        }
        workingDetail.entryGroupSongTitle = '';
        workingDetail.entryGroupSongId = null;
        return;
      }
      if (event.target.matches('[data-entry-mapping-song-id]')) {
        const row = event.target.closest('[data-entry-mapping-row]');
        const label = row?.querySelector('.preview-reference-label');
        if (label) {
          label.textContent = event.target.value.trim() ? `Song ${event.target.value.trim()}` : 'No mapping';
        }
        workingDetail.songTitle = '';
        return;
      }
      if (event.target.matches('[data-authority-code]')) {
        updatePreviewAuthorityLinkButton(event.target.closest('.preview-authority-row'));
        return;
      }
      if (!event.target.matches('[data-artwork-input]')) {
        return;
      }
      const wrap = event.target.closest('.preview-artwork-input-wrap');
      const popover = wrap?.querySelector('.preview-artwork-popover');
      const image = wrap?.querySelector('[data-artwork-preview]');
      const artworkUrl = getArtworkUrl(event.target.value);
      if (!popover || !image) {
        return;
      }
      if (!artworkUrl) {
        image.removeAttribute('src');
        popover.classList.add('hidden');
        return;
      }
      image.src = artworkUrl;
      popover.classList.remove('hidden');
    };
    const handleContentKeydown = async (event) => {
      if (event.key !== 'Enter' || !event.target.matches('[data-preview-side-search-input]')) {
        return;
      }
      event.preventDefault();
      if (!lastReferenceSearch) {
        return;
      }
      lastReferenceSearch.rows = await searchPreviewSidePanel(lastReferenceSearch.type, event.target.value);
    };
    const handleContentClick = async (event) => {
      const button = event.target.closest('button');
      if (!button) {
        return;
      }

      if (button.matches('[data-preview-authority-link]')) {
        const url = button.dataset.previewAuthorityUrl;
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      if (button.matches('[data-preview-close-search]')) {
        closePreviewSearchPanel();
        lastReferenceSearch = null;
        return;
      }

      if (button.matches('[data-preview-audio-toggle]')) {
        togglePreviewAudio(button);
        return;
      }

      if (button.matches('[data-preview-side-search-run]')) {
        if (!lastReferenceSearch) {
          return;
        }
        const query = $('preview-search-results')?.querySelector('[data-preview-side-search-input]')?.value || '';
        lastReferenceSearch.rows = await searchPreviewSidePanel(lastReferenceSearch.type, query);
        return;
      }

      if (button.matches('[data-preview-use-search]') && lastReferenceSearch) {
        const result = lastReferenceSearch.rows[Number(button.dataset.previewUseSearch)];
        const row = lastReferenceSearch.row;
        if (!result || !row?.isConnected) {
          return;
        }
        if (lastReferenceSearch.type === 'artist') {
          const input = row.querySelector('[data-reference-artist-id], [data-relation-artist-id], [data-merge-target-artist-id]');
          if (input) {
            input.value = result.id;
          }
        } else if (lastReferenceSearch.type === 'album') {
          const input = row.querySelector('[data-reference-album-id]');
          if (input) {
            input.value = result.id;
          }
        } else if (lastReferenceSearch.type === 'song') {
          const input = row.querySelector('[data-track-song-id], [data-entry-mapping-song-id]');
          if (input) {
            input.value = result.id;
          }
          if (row.matches('[data-entry-mapping-row]')) {
            workingDetail.songTitle = getFallbackTitle(result.detail?.song?.titles) || result.label || '';
          }
        } else if (lastReferenceSearch.type === 'entry-group') {
          const input = row.querySelector('[data-entry-group-id]');
          if (input) {
            input.value = result.id;
          }
          const mode = content.querySelector('[data-entry-group-mode]');
          if (mode) {
            mode.value = 'existing';
          }
          syncEntryGroupLookupControls(row);
          workingDetail.entryGroupSongId = result.detail?.songId || null;
          workingDetail.entryGroupSongTitle = result.detail?.songTitle || result.label || '';
        }
        const label = row.querySelector('.preview-reference-label');
        if (label) {
          const fallbackSongTitle = lastReferenceSearch.type === 'song'
            ? getFallbackTitle(result.detail?.song?.titles)
            : '';
          const detailLabel = lastReferenceSearch.type === 'entry-group' && result.detail?.songTitle
            ? `${result.detail.songTitle}${result.detail.songId ? ` · Song ${result.detail.songId}` : ''}`
            : fallbackSongTitle
              ? `${fallbackSongTitle} · Song ${result.id}`
              : result.label || `${lastReferenceSearch.type} ${result.id}`;
          label.textContent = detailLabel;
        }
        workingDetail = collectTableEditPlan(table, content, workingDetail);
        return;
      }

      workingDetail = collectTableEditPlan(table, content, workingDetail);
      if (button.matches('[data-preview-search]')) {
        const type = button.dataset.previewSearch;
        const row = button.closest('[data-reference-artist-row], [data-reference-album-row], [data-album-track-row], [data-artist-relation-row], [data-artist-merge-row], [data-entry-group-row], [data-entry-mapping-row]');
        if (!row || !['artist', 'album', 'song', 'entry-group'].includes(type)) {
          return;
        }
        lastReferenceSearch = {
          type,
          row,
          rows: []
        };
        lastReferenceSearch.rows = await searchPreviewSidePanel(type, getSearchTerm(button));
        return;
      }

      if (button.matches('[data-preview-add-title]')) {
        addTableEditRow(table, workingDetail, 'title');
      } else if (button.matches('[data-preview-remove-title]')) {
        button.closest('.preview-title-row')?.remove();
        workingDetail = collectTableEditPlan(table, content, workingDetail);
      } else if (button.matches('[data-preview-add-authority]')) {
        addTableEditRow(table, workingDetail, 'authority');
      } else if (button.matches('[data-preview-remove-authority]')) {
        button.closest('.preview-authority-row')?.remove();
        workingDetail = collectTableEditPlan(table, content, workingDetail);
      } else if (button.matches('[data-preview-add-alias]')) {
        addTableEditRow(table, workingDetail, 'alias');
      } else if (button.matches('[data-preview-remove-alias]')) {
        button.closest('.preview-alias-row')?.remove();
        workingDetail = collectTableEditPlan(table, content, workingDetail);
      } else if (button.matches('[data-preview-add-reference-artist]')) {
        addTableEditRow(table, workingDetail, 'artist');
      } else if (button.matches('[data-preview-remove-reference-artist]')) {
        button.closest('[data-reference-artist-row]')?.remove();
        workingDetail = collectTableEditPlan(table, content, workingDetail);
      } else if (button.matches('[data-preview-add-artist-relation]')) {
        addTableEditRow(table, workingDetail, 'artist-relation');
      } else if (button.matches('[data-preview-remove-artist-relation]')) {
        button.closest('[data-artist-relation-row]')?.remove();
        workingDetail = collectTableEditPlan(table, content, workingDetail);
      } else if (button.matches('[data-preview-add-reference-album]')) {
        addTableEditRow(table, workingDetail, 'album');
      } else if (button.matches('[data-preview-remove-reference-album]')) {
        button.closest('[data-reference-album-row]')?.remove();
        workingDetail = collectTableEditPlan(table, content, workingDetail);
      } else if (button.matches('[data-preview-add-track-count]')) {
        addTableEditRow(table, workingDetail, 'track-count');
      } else if (button.matches('[data-preview-remove-track-count]')) {
        button.closest('[data-track-count-row]')?.remove();
        workingDetail = collectTableEditPlan(table, content, workingDetail);
      } else if (button.matches('[data-preview-add-album-track]')) {
        addTableEditRow(table, workingDetail, 'album-track');
      } else if (button.matches('[data-preview-remove-album-track]')) {
        button.closest('[data-album-track-row]')?.remove();
        workingDetail = collectTableEditPlan(table, content, workingDetail);
      } else if (button.matches('[data-preview-add-locale]')) {
        addTableEditRow(table, workingDetail, 'locale');
      } else if (button.matches('[data-preview-remove-locale]')) {
        button.closest('.preview-locale-edit-row')?.remove();
        workingDetail = collectTableEditPlan(table, content, workingDetail);
        if (workingDetail.locales.length && !workingDetail.locales.some((locale) => locale.isPrimary)) {
          workingDetail.locales[0].isPrimary = true;
        }
      } else {
        return;
      }
      errors = [];
      render();
    };

    closeButton.addEventListener('click', closeAsFalse);
    cancelButton.addEventListener('click', closeAsFalse);
    confirmButton.addEventListener('click', closeAsTrue);
    copyJsonButton?.addEventListener('click', copySongJson);
    pasteJsonButton?.addEventListener('click', pasteSongJson);
    document.addEventListener('keydown', handleKeydown);
    content.addEventListener('click', handleContentClick);
    content.addEventListener('change', handleContentChange);
    content.addEventListener('focusout', handleContentFocusOut);
    content.addEventListener('input', handleContentInput);
    content.addEventListener('keydown', handleContentKeydown);
    content.addEventListener('scroll', positionPreviewSearchResults);
    window.addEventListener('resize', positionPreviewSearchResults);
    confirmButton.focus();
  });
}

function captureScrollSnapshot(anchor = {}) {
  const rowId = anchor.rowId ?? null;
  const anchorRow = rowId === null || rowId === undefined
    ? null
    : document.querySelector(`.changelog-row[data-id="${CSS.escape(String(rowId))}"]`);
  const tableWrap = anchorRow?.closest('.changelog-table-wrap') || document.querySelector('.changelog-table-wrap');

  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    tableWrapScrollTop: tableWrap?.scrollTop ?? 0,
    detailPanel: $('detail-panel')?.scrollTop ?? 0,
    sidebar: document.querySelector('.sidebar')?.scrollTop ?? 0,
    anchor: anchorRow
      ? {
        rowId: String(rowId),
        tableKey: anchor.tableKey ?? state.currentView.key,
        top: anchorRow.getBoundingClientRect().top,
        wrapTop: tableWrap?.getBoundingClientRect().top ?? 0
      }
      : null
  };
}

function restoreScrollSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const detailPanel = $('detail-panel');
      const sidebar = document.querySelector('.sidebar');
      const tableWrap = document.querySelector('.changelog-table-wrap');
      if (detailPanel) {
        detailPanel.scrollTop = snapshot.detailPanel;
      }
      if (sidebar) {
        sidebar.scrollTop = snapshot.sidebar;
      }
      if (tableWrap) {
        tableWrap.scrollTop = snapshot.tableWrapScrollTop ?? 0;
      }
      window.scrollTo(snapshot.windowX, snapshot.windowY);

      if (snapshot.anchor && state.currentView.type === 'table' && state.currentView.key === snapshot.anchor.tableKey) {
        const anchorRow = document.querySelector(`.changelog-row[data-id="${CSS.escape(snapshot.anchor.rowId)}"]`);
        const nextTableWrap = anchorRow?.closest('.changelog-table-wrap');
        if (anchorRow && nextTableWrap) {
          const previousOffset = snapshot.anchor.top - snapshot.anchor.wrapTop;
          const nextOffset = anchorRow.getBoundingClientRect().top - nextTableWrap.getBoundingClientRect().top;
          const delta = nextOffset - previousOffset;
          if (Math.abs(delta) > 1) {
            nextTableWrap.scrollTop += delta;
          }
          document.querySelectorAll('.changelog-row').forEach((item) => item.classList.remove('active'));
          anchorRow.classList.add('active');
        }
      }
    });
  });
}

async function showArtistMergeModal(detail) {
  const modal = $('song-preview-modal');
  const title = $('song-preview-title');
  const kicker = $('song-preview-kicker');
  const content = $('song-preview-content');
  const closeButton = $('song-preview-close');
  const cancelButton = $('song-preview-cancel');
  const confirmButton = $('song-preview-confirm');
  const clipboardActions = $('song-edit-clipboard-actions');
  let workingDetail = { ...detail, mergePreview: null, mergeTargetArtistId: '' };
  let errors = [];
  let lastReferenceSearch = null;

  const render = () => {
    modal.dataset.mergeArtist = String(detail.id);
    clipboardActions?.classList.add('hidden');
    title.textContent = 'Merge Artist';
    kicker.textContent = `artist ${detail.id}`;
    content.innerHTML = `
      <div class="song-preview-layout">
        <div class="song-preview-main">
          ${renderArtistMergeStatus(workingDetail, errors)}
          <section class="preview-section">
            <h3>Target Artist</h3>
            ${renderArtistMergeControls(workingDetail)}
          </section>
        </div>
        <aside id="preview-search-results" class="preview-search-results hidden"></aside>
      </div>
    `;
    confirmButton.classList.remove('hidden');
    confirmButton.disabled = !workingDetail.mergePreview;
    confirmButton.textContent = 'Complete Merge';
    cancelButton.textContent = 'Cancel';
    syncArtistMergeModalControls(content, workingDetail, confirmButton);
  };

  render();
  openModalUi(modal);

  return new Promise((resolve) => {
    const close = (value) => {
      closeModalUi(modal);
      closeButton.removeEventListener('click', closeAsFalse);
      cancelButton.removeEventListener('click', closeAsFalse);
      confirmButton.removeEventListener('click', confirmMerge);
      document.removeEventListener('keydown', handleKeydown);
      content.removeEventListener('click', handleContentClick);
      content.removeEventListener('input', handleContentInput);
      content.removeEventListener('scroll', positionPreviewSearchResults);
      window.removeEventListener('resize', positionPreviewSearchResults);
      delete modal.dataset.mergeArtist;
      confirmButton.disabled = false;
      resolve(value);
    };
    const closeAsFalse = () => close(false);
    const handleKeydown = (event) => {
      if (event.key === 'Escape') {
        close(false);
      }
    };
    const runDryRun = async () => {
      const targetArtistId = Number(getElementValue(content, '[data-merge-target-artist-id]', ''));
      if (!Number.isInteger(targetArtistId) || targetArtistId <= 0) {
        errors = ['Target artist ID must be a positive integer.'];
        render();
        return;
      }
      if (targetArtistId === Number(detail.id)) {
        errors = ['Cannot merge an artist into itself.'];
        render();
        return;
      }

      try {
        const mergePreview = await fetchJson(`/api/tables/artist/${encodeURIComponent(detail.id)}/merge`, {
          method: 'POST',
          body: JSON.stringify({
            targetArtistId,
            dryRun: true
          })
        });
        workingDetail = {
          ...workingDetail,
          mergeTargetArtistId: targetArtistId,
          mergePreview
        };
        errors = [];
        render();
      } catch (error) {
        workingDetail = {
          ...workingDetail,
          mergeTargetArtistId: targetArtistId,
          mergePreview: null
        };
        errors = [error.message];
        render();
      }
    };
    const confirmMerge = async () => {
      const targetArtistId = Number(getElementValue(content, '[data-merge-target-artist-id]', ''));
      const mergePreview = workingDetail.mergePreview;
      if (!mergePreview || targetArtistId !== Number(mergePreview.targetArtist?.id)) {
        errors = ['Run merge preview again before confirming.'];
        render();
        return;
      }

      confirmButton.disabled = true;
      try {
        await fetchJson(`/api/tables/artist/${encodeURIComponent(detail.id)}/merge`, {
          method: 'POST',
          body: JSON.stringify({
            targetArtistId,
            reason: 'library-manager artist merge'
          })
        });
        close({
          sourceArtistId: Number(detail.id),
          targetArtistId
        });
      } catch (error) {
        errors = [error.message];
        confirmButton.disabled = false;
        render();
      }
    };
    const handleContentClick = async (event) => {
      const button = event.target.closest('button');
      if (!button) {
        return;
      }

      if (button.matches('[data-preview-close-search]')) {
        closePreviewSearchPanel();
        lastReferenceSearch = null;
        return;
      }

      if (button.matches('[data-preview-side-search-run]')) {
        if (!lastReferenceSearch) {
          return;
        }
        const query = $('preview-search-results')?.querySelector('[data-preview-side-search-input]')?.value || '';
        lastReferenceSearch.rows = await searchPreviewSidePanel(lastReferenceSearch.type, query);
        return;
      }

      if (button.matches('[data-preview-use-search]') && lastReferenceSearch) {
        const result = lastReferenceSearch.rows[Number(button.dataset.previewUseSearch)];
        const row = lastReferenceSearch.row;
        if (!result || !row?.isConnected) {
          return;
        }
        const input = row.querySelector('[data-merge-target-artist-id]');
        if (input) {
          input.value = result.id;
        }
        const label = row.querySelector('.preview-reference-label');
        if (label) {
          label.textContent = result.label || `Artist ${result.id}`;
        }
        workingDetail = {
          ...workingDetail,
          mergeTargetArtistId: result.id,
          mergePreview: null
        };
        syncArtistMergeModalControls(content, workingDetail, confirmButton);
        return;
      }

      if (button.matches('[data-preview-search]')) {
        const type = button.dataset.previewSearch;
        const row = button.closest('[data-artist-merge-row]');
        if (!row || type !== 'artist') {
          return;
        }
        lastReferenceSearch = {
          type,
          row,
          rows: []
        };
        lastReferenceSearch.rows = await searchPreviewSidePanel(type, getSearchTerm(button));
        return;
      }

      if (button.matches('[data-preview-dry-run-merge-artist]')) {
        await runDryRun();
      }
    };
    const handleContentInput = (event) => {
      if (!event.target.matches('[data-merge-target-artist-id]')) {
        return;
      }
      const targetArtistId = Number(event.target.value || '');
      const previewTargetId = Number(workingDetail.mergePreview?.targetArtist?.id);
      workingDetail = {
        ...workingDetail,
        mergeTargetArtistId: event.target.value.trim(),
        mergePreview: targetArtistId === previewTargetId ? workingDetail.mergePreview : null
      };
      const label = content.querySelector('[data-artist-merge-row] .preview-reference-label');
      if (label && !workingDetail.mergePreview) {
        label.textContent = 'Target artist';
      }
      syncArtistMergeModalControls(content, workingDetail, confirmButton);
    };

    closeButton.addEventListener('click', closeAsFalse);
    cancelButton.addEventListener('click', closeAsFalse);
    confirmButton.addEventListener('click', confirmMerge);
    document.addEventListener('keydown', handleKeydown);
    content.addEventListener('click', handleContentClick);
    content.addEventListener('input', handleContentInput);
    content.addEventListener('scroll', positionPreviewSearchResults);
    window.addEventListener('resize', positionPreviewSearchResults);
    confirmButton.focus();
  });
}

function bindArtistMergeButton(detail) {
  const button = document.querySelector('[data-merge-artist]');
  if (!button) {
    return;
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await showArtistMergeModal(detail);
      if (!result) {
        return;
      }
      await selectTableView('artist');
      await showTableDetail('artist', result.targetArtistId);
    } finally {
      button.disabled = false;
    }
  });
}

function createEmptyArtistDetail() {
  return {
    type: 'artist',
    id: 'new',
    artistTag: 0,
    artwork: '',
    titles: [{
      locale: 'und',
      localeValue: 1,
      localeLabel: 'und',
      title: '',
      fallback: true
    }],
    aliases: [],
    authorities: [],
    relations: [],
    editableRelations: []
  };
}

function bindAddArtistButton() {
  const button = $('add-artist-btn');
  if (!button) {
    return;
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    let nextDetail = createEmptyArtistDetail();
    try {
      while (nextDetail) {
        const plan = await showTableEditModal('artist', nextDetail);
        if (!plan) {
          return;
        }
        try {
          const payload = await fetchJson('/api/tables/artist', {
            method: 'POST',
            body: JSON.stringify({
              detail: plan,
              reason: 'library-manager artist create'
            })
          });
          getTableFilters('artist').search = '';
          await refreshCurrentView();
          await openArtistTableRow(payload.detail.id);
          return;
        } catch (error) {
          nextDetail = { ...plan, id: 'new', errors: [error.message] };
        }
      }
    } finally {
      button.disabled = false;
    }
  });
}

function bindTableEditButton(detail) {
  const button = document.querySelector('[data-edit-table]');
  if (!button) {
    return;
  }
  button.addEventListener('click', async () => {
    const table = button.dataset.editTable;
    const id = Number(button.dataset.editId);
    button.disabled = true;
    let nextDetail = detail;
    try {
      while (nextDetail) {
        const plan = await showTableEditModal(table, nextDetail);
        if (!plan) {
          return;
        }
        try {
          const scrollSnapshot = captureScrollSnapshot({ tableKey: table, rowId: id });
          await fetchJson(`/api/tables/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              detail: plan,
              reason: 'library-manager table edit'
            })
          });
          await refreshCurrentView();
          await showTableDetail(table, id);
          restoreScrollSnapshot(scrollSnapshot);
          return;
        } catch (error) {
          nextDetail = { ...plan, errors: [error.message] };
        }
      }
    } finally {
      button.disabled = false;
    }
  });
}

async function showTableDetail(table, id) {
  stopDetailAudio();
  const detailRequest = ++portalDetailRequest;
  const detail = await fetchJson(`/api/tables/${encodeURIComponent(table)}/${encodeURIComponent(id)}`);
  if (detailRequest !== portalDetailRequest) return;

  if (table === 'entry') {
    $('detail-content').innerHTML = `
      ${renderDetailHeader(table, detail)}
      ${renderDetailSection('Details')}
      ${renderSingleItem('ID', detail.id)}
      ${renderSingleItem('Source', renderEntrySourceDetail(detail), { html: true })}
      ${renderSingleItem('Title', detail.title)}
      ${renderSingleItem('Artist', detail.artist)}
      ${renderSingleItem('Album', detail.album)}
      ${renderDetailSection('Mapping')}
      ${renderSingleItem('Status', detail.status || '-')}
      ${renderSingleItem('Entry Group ID', renderEntryGroupLink(detail.entryGroupId), { html: true })}
      ${renderSingleItem('Song ID', renderSongLink(detail.songId), { html: true })}
      ${renderDetailSection('Issues')}
      ${renderEntryGroupIssues(detail.issues, 'No related issues')}
      ${renderDetailSection('Raw JSON')}
      ${renderJsonBlock(detail.rawJson)}
    `;
    bindTableEditButton(detail);
    bindEntryGroupLinks();
    bindSongLinks();
    bindEntryGroupIssueLinks();
    return;
  }

  if (table === 'album') {
    $('detail-content').innerHTML = `
      ${renderDetailHeader(table, detail)}
      ${renderDetailArtwork(detail.artwork, 'Album artwork')}
      ${renderSingleItem('ID', detail.id)}
      ${renderSingleItem('Titles', renderExpandedTitles(detail.titles), { html: true })}
      ${renderSingleItem('Artists', renderArtistLinks(detail.artists), { html: true })}
      ${renderSingleItem('Album Type', detail.albumType)}
      ${renderSingleItem('Track Counts', renderTrackCountInfo(detail))}
      ${renderSingleItem('Authority', renderAuthorityList(detail.authorities, 'album'), { html: true })}
      ${renderSingleItem('Release Date', formatDate(detail.releaseDate))}
      ${renderSingleItem('Updated At', formatDate(detail.updatedAt))}
      ${renderDetailSection('Songs')}
      ${renderAlbumTrackSection(detail.tracks)}
    `;
    bindTableEditButton(detail);
    bindArtistLinks();
    bindSongLinks();
    return;
  }

  if (table === 'artist') {
    $('detail-content').innerHTML = `
      ${renderDetailHeader(table, detail)}
      ${renderDetailArtwork(detail.artwork, 'Artist artwork')}
      ${renderSingleItem('ID', detail.id)}
      ${renderSingleItem('Titles', renderExpandedTitles(detail.titles), { html: true })}
      ${renderSingleItem('Alias', renderAliasList(detail.aliases))}
      ${renderSingleItem('Artist Tag', formatTableCellValue('artist_tag', detail.artistTag ?? 0))}
      ${renderSingleItem('Authority', renderAuthorityList(detail.authorities, 'artist'), { html: true })}
      ${renderSingleItem('Updated At', formatDate(detail.updatedAt))}
      ${renderDetailSection('Albums')}
      ${renderArtistAlbumSection(detail.albums)}
      ${renderDetailSection('Songs')}
      ${renderArtistSongSection(detail.songs)}
      ${renderDetailSection('Relations')}
      ${renderArtistRelationSection(detail.relations)}
    `;
    bindTableEditButton(detail);
    bindArtistMergeButton(detail);
    bindArtistLinks();
    bindAlbumLinks();
    bindSongLinks();
    return;
  }

  if (table === 'song') {
    $('detail-content').innerHTML = `
      ${renderDetailHeader(table, detail)}
      ${renderSingleItem('ID', detail.id)}
      ${renderSingleItem('Titles', renderExpandedTitles(detail.titles), { html: true })}
      ${renderSingleItem('Artists', renderArtistLinks(detail.artists, true), { html: true })}
      ${renderSingleItem('Vocal', formatTableCellValue('vocal', detail.vocal))}
      ${renderSingleItem('Locale', PortalModel.locales(detail.locales, enumLabels.locale))}
      ${renderSingleItem('Genre Tag', formatTableCellValue('genre_tag', detail.genreTag))}
      ${renderSingleItem('Genre Info', formatTableCellValue('genre_info', detail.genreInfo))}
      ${renderSingleItem('Media Tag', formatTableCellValue('media_tag', detail.mediaTag))}
      ${renderSingleItem('Duration', formatDuration(detail.duration))}
      ${renderSingleItem('Audio', renderDetailAudioPlayer(detail.audio), { html: true })}
      ${renderSingleItem('Authority', renderAuthorityList(detail.authorities, 'song'), { html: true })}
      ${renderSingleItem('Release Date', formatDate(detail.releaseDate))}
      ${renderSingleItem('Updated At', formatDate(detail.updatedAt))}
      ${renderDetailSection('Album')}
      ${renderSongAlbumSection(detail.albums)}
      ${renderDetailSection('Entry')}
      ${renderSongEntryMappings(detail.entryMappings)}
    `;
    bindTableEditButton(detail);
    bindArtistLinks();
    bindAlbumLinks();
    bindEntryLinks();
    bindDetailAudioPlayer();
  }
}

function showChangelogDetail(row) {
  $('detail-content').innerHTML = `
    ${renderDetailSection('Details')}
    ${renderSingleItem('Change ID', row.changeId)}
    ${renderSingleItem('Table', row.tableName)}
    ${renderSingleItem('Operation', row.operation)}
    ${renderSingleItem('Row PK', summarizeJson(row.rowPk))}
    ${renderDetailSection('Metadata')}
    ${renderSingleItem('Changed By', row.changedBy)}
    ${renderSingleItem('Reason', row.reason)}
    ${renderSingleItem('Date', formatDate(row.changedAt))}
    ${renderDetailSection('Data')}
    ${renderSingleItem('Old Data', renderJsonBlock(row.oldData), { html: true })}
    ${renderSingleItem('New Data', renderJsonBlock(row.newData), { html: true })}
  `;
}

function showBulkMappingDetail() {
  $('detail-content').innerHTML = `
    ${renderBulkMappingStatusEditor()}
    <p id="selected-mapping-count" class="selected-count">${state.selectedMappings.size} selected entry mapping${state.selectedMappings.size === 1 ? '' : 's'}</p>
  `;
  bindBulkMappingStatusEditor();
  updateMappingSelectionUi();
}

function renderEntryGroupEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return '<p class="detail-empty-text">No entries</p>';
  }

  return entries.map((entry) => `
    <div class="detail-mini-card">
      <button class="entry-link" type="button" data-entry-id="${escapeHtml(entry.entryId)}">${escapeHtml(entry.rawTitle || `Entry ${entry.entryId}`)}</button>
      <div class="detail-mini-meta">${escapeHtml([entry.rawArtist, entry.rawAlbum].filter(Boolean).join(' · ') || '-')}</div>
      <div class="detail-mini-meta">${escapeHtml(`Entry ${entry.entryId} · Source ${entry.sourceId} · Item ${entry.sourceItemId}`)}</div>
    </div>
  `).join('');
}

function renderGroupEntryEditorRows(entries, selectedIds, { emptyMessage = 'No entries' } = {}) {
  if (!entries.length) {
    return `<p class="detail-empty-text">${escapeHtml(emptyMessage)}</p>`;
  }
  return `
    <div class="group-entry-row group-entry-head" aria-hidden="true">
      <span>ID</span><span>Title</span><span>Artist</span><span>Album</span><span>Cover</span><span>Add/Remove</span>
    </div>
    ${entries.map((entry) => {
      const added = selectedIds.has(entry.entryId);
      const artwork = getArtworkUrl(entry.artwork);
      return `
        <div class="group-entry-row">
          <span class="group-entry-id">${escapeHtml(entry.entryId)}</span>
          <span>${escapeHtml(entry.rawTitle || '-')}</span>
          <span>${escapeHtml(entry.rawArtist || '-')}</span>
          <span>${escapeHtml(entry.rawAlbum || '-')}</span>
          <span class="group-entry-cover">${artwork ? `<img src="${escapeHtml(artwork)}" alt="">` : '<span class="group-entry-cover-empty">No cover</span>'}</span>
          <button class="${added ? 'secondary-btn' : 'primary-btn'} group-entry-toggle" type="button" data-entry-toggle="${escapeHtml(entry.entryId)}" aria-label="${added ? 'Remove' : 'Add'} entry ${escapeHtml(entry.entryId)}">${added ? 'Remove' : 'Add'}</button>
        </div>
      `;
    }).join('')}
  `;
}

function renderGroupEntriesEditor() {
  const editor = groupEntriesEditor;
  if (!editor) {
    return;
  }
  const selectedIds = new Set(editor.added.keys());
  $('group-added-list').innerHTML = renderGroupEntryEditorRows([...editor.added.values()].sort((a, b) => a.entryId - b.entryId), selectedIds);
  $('group-entry-results').innerHTML = renderGroupEntryEditorRows(editor.results, selectedIds, {
    emptyMessage: editor.search ? 'No matching entries' : 'Enter a search term.'
  });
  const currentIds = [...selectedIds].sort((a, b) => a - b);
  $('group-entries-save').disabled = editor.saving || JSON.stringify(currentIds) === JSON.stringify(editor.originalIds);
  $('group-entry-page').textContent = editor.search && editor.total ? `Page ${editor.page} of ${editor.pageCount}` : '';
  $('group-entry-prev').disabled = editor.page <= 1;
  $('group-entry-next').disabled = editor.page >= editor.pageCount;
}

function closeGroupEntriesEditor() {
  if (groupEntriesEditor?.saving) {
    return;
  }
  groupEntrySearchRequestId += 1;
  groupEntriesEditor = null;
  closeModalUi($('group-entries-modal'));
  $('group-entries-edit')?.focus();
}

function openGroupEntriesEditor(row) {
  const firstEntry = (row.entries || []).reduce((smallest, entry) => (
    !smallest || entry.entryId < smallest.entryId ? entry : smallest
  ), null);
  const initialSearch = firstEntry?.rawTitle || '';
  groupEntriesEditor = {
    groupId: row.groupId,
    added: new Map((row.entries || []).map((entry) => [entry.entryId, entry])),
    originalIds: (row.entries || []).map((entry) => entry.entryId).sort((a, b) => a - b),
    results: [],
    search: initialSearch,
    page: 1,
    pageCount: 1,
    total: 0,
    saving: false
  };
  $('group-entries-title').textContent = `Add/Remove entries · Group ${row.groupId}`;
  $('group-entry-search').value = initialSearch;
  $('group-entry-search-status').textContent = initialSearch.trim() ? 'Searching entries...' : 'Enter a search term.';
  $('group-entries-error').classList.add('hidden');
  renderGroupEntriesEditor();
  openModalUi($('group-entries-modal'));
  $('group-entry-search').focus();
  if (initialSearch.trim()) {
    searchGroupEntries();
  }
}

async function searchGroupEntries() {
  const editor = groupEntriesEditor;
  if (!editor) {
    return;
  }
  const requestId = ++groupEntrySearchRequestId;
  const search = editor.search;
  if (!search.trim()) {
    editor.results = [];
    editor.total = 0;
    editor.pageCount = 1;
    $('group-entry-search-status').textContent = 'Enter a search term.';
    renderGroupEntriesEditor();
    return;
  }
  $('group-entry-search-status').textContent = 'Searching entries...';
  try {
    const params = new URLSearchParams({ search, page: String(editor.page) });
    const payload = await fetchJson(`/api/groups/${encodeURIComponent(editor.groupId)}/entries/search?${params}`);
    if (requestId !== groupEntrySearchRequestId || groupEntriesEditor !== editor) {
      return;
    }
    editor.results = payload.rows || [];
    editor.total = payload.total || 0;
    editor.pageCount = payload.pageCount || 1;
    $('group-entry-search-status').textContent = `${editor.total} matching ${editor.total === 1 ? 'entry' : 'entries'}`;
    renderGroupEntriesEditor();
  } catch (error) {
    if (requestId === groupEntrySearchRequestId && groupEntriesEditor === editor) {
      $('group-entry-search-status').textContent = error.message;
    }
  }
}

async function saveGroupEntriesEditor() {
  const editor = groupEntriesEditor;
  if (!editor || editor.saving) {
    return;
  }
  editor.saving = true;
  $('group-entries-error').classList.add('hidden');
  renderGroupEntriesEditor();
  try {
    await fetchJson(`/api/groups/${encodeURIComponent(editor.groupId)}/entries`, {
      method: 'PUT',
      body: JSON.stringify({ entryIds: [...editor.added.keys()], originalEntryIds: editor.originalIds })
    });
    editor.saving = false;
    closeGroupEntriesEditor();
    await refreshCurrentView();
    let row = state.rows.find((item) => item.groupId === editor.groupId);
    if (!row) {
      const params = new URLSearchParams({ includeConfirmed: 'true', pageSize: '1', rules: JSON.stringify([{ field: 'id', operator: 'eq', value: String(editor.groupId) }]) });
      row = (await fetchJson(`/api/groups?${params}`)).rows?.[0];
    }
    if (row && state.currentView.type === 'group') {
      showEntryGroupDetail(row);
      const index = state.rows.findIndex((item) => item.groupId === editor.groupId);
      document.querySelector(`.entry-group-card[data-index="${index}"]`)?.classList.add('active');
    }
  } catch (error) {
    editor.saving = false;
    if (groupEntriesEditor === editor) {
      $('group-entries-error').textContent = error.message;
      $('group-entries-error').classList.remove('hidden');
      renderGroupEntriesEditor();
    } else {
      alert(error.message);
    }
  }
}

function bindGroupEntriesEditor() {
  $('group-entries-close').addEventListener('click', closeGroupEntriesEditor);
  $('group-entries-cancel').addEventListener('click', closeGroupEntriesEditor);
  $('group-entries-save').addEventListener('click', saveGroupEntriesEditor);
  $('group-entries-modal').addEventListener('click', (event) => {
    const button = event.target.closest('[data-entry-toggle]');
    if (!button || !groupEntriesEditor || groupEntriesEditor.saving) {
      return;
    }
    const entryId = Number(button.dataset.entryToggle);
    if (groupEntriesEditor.added.has(entryId)) {
      groupEntriesEditor.added.delete(entryId);
    } else {
      const entry = groupEntriesEditor.results.find((item) => item.entryId === entryId);
      if (entry) {
        groupEntriesEditor.added.set(entryId, entry);
      }
    }
    renderGroupEntriesEditor();
  });
  const debouncedSearch = debounce(searchGroupEntries, 300);
  $('group-entry-search').addEventListener('input', (event) => {
    if (!groupEntriesEditor) {
      return;
    }
    groupEntrySearchRequestId += 1;
    groupEntriesEditor.search = event.target.value;
    groupEntriesEditor.page = 1;
    groupEntriesEditor.results = [];
    groupEntriesEditor.total = 0;
    groupEntriesEditor.pageCount = 1;
    $('group-entry-search-status').textContent = groupEntriesEditor.search.trim() ? 'Searching entries...' : 'Enter a search term.';
    renderGroupEntriesEditor();
    debouncedSearch();
  });
  $('group-entry-prev').addEventListener('click', () => {
    if (groupEntriesEditor?.page > 1) {
      groupEntriesEditor.page -= 1;
      searchGroupEntries();
    }
  });
  $('group-entry-next').addEventListener('click', () => {
    if (groupEntriesEditor && groupEntriesEditor.page < groupEntriesEditor.pageCount) {
      groupEntriesEditor.page += 1;
      searchGroupEntries();
    }
  });
}

function renderEntryLink(entryId) {
  if (!entryId) {
    return '-';
  }
  return `<button class="entry-link" type="button" data-entry-id="${escapeHtml(entryId)}">Entry ${escapeHtml(entryId)}</button>`;
}

function renderSongLink(songId, label = null) {
  if (!songId) {
    return '-';
  }
  return `<button class="song-link" type="button" data-song-id="${escapeHtml(songId)}">${escapeHtml(label || `Song ${songId}`)}</button>`;
}

function renderEntryGroupLink(groupId) {
  if (!groupId) {
    return '-';
  }
  return `<button class="entry-group-link" type="button" data-entry-group-id="${escapeHtml(groupId)}">Entry Group ${escapeHtml(groupId)}</button>`;
}

function renderEntryGroupIssues(issues, emptyText = 'No linked issues') {
  if (!Array.isArray(issues) || !issues.length) {
    return `<p class="detail-empty-text">${escapeHtml(emptyText)}</p>`;
  }

  return issues.map((issue) => `
    <button class="detail-mini-card detail-mini-button entry-group-issue-link" type="button" data-issue-id="${escapeHtml(issue.issueId)}" data-issue-reason="${escapeHtml(issue.reason)}" data-issue-resolved="${issue.resolvedAt ? 'true' : 'false'}">
      <div class="detail-mini-title">${escapeHtml(getIssueLabel(issue.reason))}</div>
      <div class="detail-mini-meta">${escapeHtml(`Issue ${issue.issueId} · Entry ${issue.entryId}${issue.songId ? ` · Song ${issue.songId}` : ''}`)}</div>
      <div class="detail-mini-meta">${escapeHtml(issue.resolvedAt ? `Resolved ${formatDate(issue.resolvedAt)}` : 'Open')}</div>
    </button>
  `).join('');
}

function bindEntryGroupIssueLinks() {
  document.querySelectorAll('.entry-group-issue-link').forEach((button) => {
    button.addEventListener('click', async () => {
      const issueId = Number(button.dataset.issueId);
      const reason = button.dataset.issueReason;
      const resolved = button.dataset.issueResolved === 'true';
      if (!Number.isInteger(issueId) || !reason) {
        return;
      }

      if (resolved) {
        $('include-resolved').checked = true;
      }
      await selectIssueView(reason);
      const issueIndex = state.rows.findIndex((row) => row.issueId === issueId);
      let issueRow = issueIndex === -1 ? null : state.rows[issueIndex];
      if (!issueRow) {
        const payload = await fetchJson(`/api/issues/${encodeURIComponent(issueId)}`);
        issueRow = payload.row;
      }

      const card = issueIndex === -1
        ? null
        : document.querySelector(`.record-card[data-index="${CSS.escape(String(issueIndex))}"]`);
      document.querySelectorAll('.record-card').forEach((item) => item.classList.remove('active'));
      if (card) {
        card.classList.add('active');
      }
      showDetail(issueRow);
    });
  });
}

function showBulkGroupDetail() {
  $('detail-content').innerHTML = `
    ${renderBulkGroupStatusEditor()}
    <p id="selected-group-count" class="selected-count">${state.selectedGroups.size} selected entry group${state.selectedGroups.size === 1 ? '' : 's'}</p>
  `;
  bindBulkGroupStatusEditor();
  updateGroupSelectionUi();
}

function showBulkIssueDetail() {
  $('detail-content').innerHTML = `
    ${renderBulkIssueResolveButton()}
    <p id="selected-issue-count" class="selected-count">${state.selectedIssues.size} selected issue${state.selectedIssues.size === 1 ? '' : 's'}</p>
  `;
  bindBulkIssueResolveButton();
  updateIssueSelectionUi();
}

function showEntryGroupDetail(row) {
  const statusDate = `${formatDate(row.createdAt)}${row.resolvedAt ? ` / resolved ${formatDate(row.resolvedAt)}` : ''}`;
  $('detail-content').innerHTML = `
    ${renderGroupStatusEditor(row)}
    ${renderDetailSection('Details')}
    ${renderSingleItem('Group ID', row.groupId)}
    ${renderSingleItem('Status', formatStatus(row.status))}
    ${renderDetailSection('Entries')}
    ${renderEntryGroupEntries(row.entries)}
    <button id="group-entries-edit" class="secondary-btn group-entries-edit" type="button">Add/Remove</button>
    ${renderDetailSection('Issues')}
    ${renderEntryGroupIssues(row.issues)}
    ${renderDetailSection('Metadata')}
    ${renderSingleItem('Canonical Song ID', row.canonicalSongId)}
    ${renderSingleItem('Canonical Title', row.songTitle || '-')}
    ${renderSingleItem('Canonical Artist', Array.isArray(row.songArtists) && row.songArtists.length ? row.songArtists.join(', ') : '-')}
    ${renderSingleItem('Canonical Album', row.songAlbum || '-')}
    ${renderSingleItem('Duration', formatDuration(row.songDuration))}
    ${renderSingleItem('Authority', renderAppleMusicLinks(row.appleMusicIds, ' ‧ '), { html: true })}
    ${renderSingleItem('Confidence', row.confidence === null || row.confidence === undefined ? '-' : row.confidence.toFixed(4))}
    ${renderSingleItem('Method', formatMethod(row.matchMethod))}
    ${renderSingleItem('Date', statusDate)}
    ${renderSingleItem('Raw Details', renderJsonBlock(row.details), { html: true })}
  `;
  bindGroupStatusEditor(row);
  $('group-entries-edit').addEventListener('click', () => openGroupEntriesEditor(row));
  bindEntryGroupIssueLinks();
  bindEntryLinks();
  updateGroupSelectionUi();
}

function showDetail(row) {
  const isIssue = state.currentView.type === 'issue';
  if (state.currentView.type === 'group') {
    showEntryGroupDetail(row);
    return;
  }
  if (state.currentView.type === 'changelog') {
    showChangelogDetail(row);
    return;
  }

  const songArtists = Array.isArray(row.songArtists) ? row.songArtists.join(', ') : '';
  const warnings = getDetailWarnings(row, songArtists);
  const dateValue = isIssue
    ? `${formatDate(row.createdAt)}${row.resolvedAt ? ` / resolved ${formatDate(row.resolvedAt)}` : ''}`
    : formatDate(row.createdAt);

  $('detail-content').innerHTML = `
    ${!isIssue ? renderMappingStatusEditor(row) : ''}
    ${isIssue ? renderIssueResolveButton(row) : ''}
    ${renderDetailSection('Details')}
    ${renderPairItem('Title', renderTitleExpansion(row.entryTitle, row.entryTitles), renderTitleExpansion(row.songTitle, row.songTitles), { entryHtml: true, songHtml: true, warning: warnings.title })}
    ${renderPairItem('Artist', renderGroupedTitleExpansion(row.entryArtist, row.entryArtistTitleGroups), renderGroupedTitleExpansion(songArtists, row.artistTitleGroups), { entryHtml: true, songHtml: true, warning: warnings.artist })}
    ${renderPairItem('Album', renderGroupedTitleExpansion(row.entryAlbum, row.entryAlbumTitleGroups), renderGroupedTitleExpansion(row.songAlbum, row.albumTitleGroups), { entryHtml: true, songHtml: true, warning: warnings.album })}
    ${renderPairItem('Duration', formatDuration(row.entryDuration), formatDuration(row.songDuration), { warning: warnings.duration })}
    ${renderPairItem('Authority', renderAppleMusicLinks(row.entryAppleMusicIds, ' ‧ '), renderAppleMusicLinks(row.appleMusicIds, ' ‧ '), { entryHtml: true, songHtml: true, warning: warnings.authority })}
    ${renderDetailSection('Metadata')}
    ${renderSingleItem('Entry ID', renderEntryLink(row.entryId), { html: true })}
    ${renderSingleItem('Song ID', renderSongLink(row.songId), { html: true })}
    ${renderSingleItem('Confidence', row.confidence === null || row.confidence === undefined ? '-' : row.confidence.toFixed(4))}
    ${renderSingleItem('Method', formatMethod(row.matchMethod))}
    ${renderSingleItem('Date', dateValue)}
    ${isIssue ? `
      <div class="detail-single-item">
        <span class="detail-label">Issue Details</span>
        ${renderIssueHighlights(row)}
        <pre class="details-json">${escapeHtml(JSON.stringify(row.details, null, 2))}</pre>
      </div>
    ` : ''}
  `;

  if (!isIssue) {
    bindMappingStatusEditor(row);
    updateMappingSelectionUi();
  } else {
    bindIssueResolveButton(row);
  }
  bindEntryLinks();
  bindSongLinks();
}

async function handleLogin(event) {
  event.preventDefault();
  $('login-message').textContent = 'Connecting...';

  const payload = {
    host: $('db-host').value,
    port: Number($('db-port').value || 5432),
    database: $('db-name').value,
    user: $('db-user').value,
    password: $('db-password').value
  };

  try {
    const session = await fetchJson('/api/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showApp(session.connection);
    await loadSettings();
    await loadSummary();
    await selectLastViewOrDefault();
  } catch (error) {
    $('login-message').textContent = error.message;
  }
}

async function refreshCurrentView({ invalidateCache = true } = {}) {
  if (invalidateCache) {
    clearListCache();
  }
  await loadSummary();
  if (state.currentView.type === 'mapping') {
    await selectMappingView(state.currentView.key);
  } else if (state.currentView.type === 'group') {
    await selectGroupView();
  } else if (state.currentView.type === 'issue') {
    await selectIssueView(state.currentView.key);
  } else if (state.currentView.type === 'table') {
    await selectTableView(state.currentView.key);
  } else {
    await selectChangelogView();
  }
}

function bindConnectionActions() {
  $('refresh-btn').addEventListener('click', async () => {
    try {
      await refreshCurrentView();
    } catch (error) {
      alert(error.message);
    }
  });

  $('logout-btn').addEventListener('click', async () => {
    await fetchJson('/api/logout', {
      method: 'POST',
      body: JSON.stringify({ forget: true })
    });
    showLogin('');
  });
}

async function applyMappingFilters(keyOverride = null) {
  if (keyOverride && (state.currentView.type !== 'mapping' || state.currentView.key !== keyOverride)) {
    return;
  }
  const key = keyOverride || state.currentView.key;
  const filters = getMappingFilters(key);
  filters.status = $('status-filter').value;
  filters.method = $('method-filter').value;
  filters.search = $('mapping-search').value;
  state.mapping.filters = filters;
  state.mapping.page = 1;
  state.mapping.pages[key] = 1;
  await selectMappingView(key);
}

async function applyTableFilters(keyOverride = null) {
  if (keyOverride && (state.currentView.type !== 'table' || state.currentView.key !== keyOverride)) {
    return;
  }
  const key = keyOverride || (state.currentView.type === 'table' ? state.currentView.key : state.table.key);
  const filters = getTableFilters(key);
  filters.search = $('table-search').value;
  filters.sourceType = $('entry-source-type-filter').value;
  filters.mappingStatus = $('entry-mapping-status-filter').value;
  state.table.filters = filters;
  state.table.page = 1;
  state.table.pages[key] = 1;
  await selectTableView(key);
}

async function applyGroupFilters({ requireCurrent = false } = {}) {
  if (requireCurrent && state.currentView.type !== 'group') {
    return;
  }
  state.group.filters.search = $('group-search').value;
  state.group.page = 1;
  await selectGroupView();
}

async function applyChangelogFilters() {
  state.changelog.filters.table = $('changelog-table-filter').value;
  state.changelog.filters.operation = $('changelog-operation-filter').value;
  state.changelog.page = 1;
  await selectChangelogView();
}

function debounce(fn, delay) {
  let timeoutId = null;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

const debouncedApplyMappingFilters = debounce(applyMappingFilters, 300);
const debouncedApplyTableFilters = debounce(applyTableFilters, 300);
const debouncedApplyGroupFilters = debounce(applyGroupFilters, 300);

function handleMappingSearchInput() {
  const key = state.currentView.key;
  getMappingFilters(key).search = $('mapping-search').value;
  startViewRequest('mapping');
  debouncedApplyMappingFilters(key);
}

function handleTableSearchInput() {
  const key = state.currentView.type === 'table' ? state.currentView.key : state.table.key;
  getTableFilters(key).search = $('table-search').value;
  startViewRequest('table');
  debouncedApplyTableFilters(key);
}

function handleGroupSearchInput() {
  state.group.filters.search = $('group-search').value;
  startViewRequest('group');
  debouncedApplyGroupFilters({ requireCurrent: true });
}

function getIssueLabel(reason) {
  return issueLabels[reason] || String(reason || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatMethod(method) {
  return getIssueLabel(method);
}

function formatStatus(status) {
  return getIssueLabel(status);
}

$('login-form').addEventListener('submit', handleLogin);

$('status-filter').addEventListener('change', () => applyMappingFilters());
$('method-filter').addEventListener('change', () => applyMappingFilters());
$('mapping-search').addEventListener('input', handleMappingSearchInput);
$('table-search').addEventListener('input', handleTableSearchInput);
$('entry-source-type-filter').addEventListener('change', () => applyTableFilters());
$('entry-mapping-status-filter').addEventListener('change', () => applyTableFilters());
bindAddArtistButton();
$('group-search').addEventListener('input', handleGroupSearchInput);
bindGroupFilterModal();
bindGroupEntriesEditor();
$('changelog-table-filter').addEventListener('change', applyChangelogFilters);
$('changelog-operation-filter').addEventListener('change', applyChangelogFilters);

$('include-resolved').addEventListener('change', async () => {
  if (state.currentView.type === 'issue') {
    await selectIssueView(state.currentView.key);
  }
});

