import { state } from './state.js';
import { renderMap } from './map-renderer.js';
import { browseSource } from './map-data-v2.js';
import { getLiveMapSource } from './live-map-source.js';
import { sendCommandText, sendRawCommand } from './input.js';
import { initSpeedwalk, startSpeedwalk } from './map-speedwalk.js';
import { parseAnsiText, styleToElement } from './ansi.js';
import { sparklinePoints } from './lag-core.mjs';
import {
  imagePreviewActionLabel,
  imagePreviewLabel,
  isImageFileUrl,
  openImagePreviewPane,
} from './image-preview.js';

// Click-to-walk: clicking a mapped room on the LIVE map speedwalks there
// over the active live map source. Steps are verified by the next authoritative
// room GMCP frame for that source. Wired once per panel body;
// renderMap replaces innerHTML each render, so the listener lives on bodyEl
// and resolves the clicked tile at event time. The browse pane (areaMap) is
// read-only and gets no wiring.
let speedwalkReady = false;
function wireSpeedwalk(bodyEl) {
  if (!speedwalkReady) {
    initSpeedwalk({
      send: sendRawCommand,
      rerender: () => renderMap(bodyEl, getLiveMapSource()),
      source: getLiveMapSource,
    });
    speedwalkReady = true;
  }
  if (bodyEl.dataset && bodyEl.dataset.speedwalkWired) return;
  if (bodyEl.dataset) bodyEl.dataset.speedwalkWired = '1';
  bodyEl.addEventListener('click', (ev) => {
    const tile = ev.target && ev.target.closest
      ? ev.target.closest('.map-tile-room[data-room-id]') : null;
    if (!tile) return;
    startSpeedwalk(tile.dataset.roomId, getLiveMapSource());
  });
}
import { fishingManager } from './fishing-manager.js';

let roomImageModal = null;
let roomImageModalKeyHandler = null;
const URL_PATTERN = /https?:\/\/[^\s<>"'\x00-\x1f\x7f]+/gi;

export function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return hours + 'h ' + remMinutes + 'm';
  }
  if (minutes > 0) return minutes + 'm ' + secs + 's';
  return secs + 's';
}

function formatStatusTitle(title, name) {
  if (!title) return title;
  const displayName = name || '';
  return String(title).replace(/\$N/g, displayName).replace(/\s+/g, ' ').trim();
}

function formatInt(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : n;
}

function isCompletedQuest(quest) {
  const status = String(quest && quest.status ? quest.status : '').trim().toLowerCase();
  return status === 'finished' || status === 'complete' || status === 'completed';
}

function trimLeadingFragments(fragments, charCount) {
  let remaining = Math.max(0, charCount);
  const trimmed = [];
  for (const fragment of fragments) {
    if (!fragment || !fragment.text) continue;
    if (remaining >= fragment.text.length) {
      remaining -= fragment.text.length;
      continue;
    }
    if (remaining > 0) {
      trimmed.push({ ...fragment, text: fragment.text.slice(remaining) });
      remaining = 0;
      continue;
    }
    trimmed.push(fragment);
  }
  return trimmed;
}

function trimTrailingUrlPunctuation(urlText) {
  let end = urlText.length;
  while (end > 0 && /[.,!?;:)\]}>]$/.test(urlText.slice(end - 1, end))) {
    end--;
  }
  return {
    url: urlText.slice(0, end),
    trailing: urlText.slice(end),
  };
}

function appendStyledText(container, text, style) {
  if (!text) return;
  const node = styleToElement(text, style || {});
  if (node) container.appendChild(node);
}

function createChatImagePreviewButton(url) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chat-image-preview-trigger image-preview-trigger';
  button.title = 'Open image preview';
  button.textContent = imagePreviewActionLabel(url);
  button.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    openImagePreviewPane(url, { title: imagePreviewLabel(url) });
  });
  return button;
}

function normalizeImagePreviewText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRenderedImageLabelOnly(text, renderedImages) {
  if (!renderedImages || !renderedImages.labels.size) return false;
  const value = normalizeImagePreviewText(text);
  return value ? renderedImages.labels.has(value) : false;
}

function appendFragmentWithImagePreviews(container, text, style, href = null, renderedImages = null) {
  if (href && isImageFileUrl(href)) {
    const label = imagePreviewLabel(href);
    if (!renderedImages || (!renderedImages.urls.has(href) && !renderedImages.labels.has(label))) {
      container.appendChild(createChatImagePreviewButton(href));
      if (renderedImages) {
        renderedImages.urls.add(href);
        renderedImages.labels.add(label);
      }
    }
    return;
  }

  const value = String(text || '');
  if (isRenderedImageLabelOnly(value, renderedImages)) return;
  let lastIndex = 0;
  let match;

  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(value)) !== null) {
    const matched = match[0];
    const start = match.index;
    const trimmed = trimTrailingUrlPunctuation(matched);

    if (!trimmed.url) continue;
    if (start > lastIndex) {
      appendStyledText(container, value.slice(lastIndex, start), style);
    }

    if (isImageFileUrl(trimmed.url)) {
      const label = imagePreviewLabel(trimmed.url);
      if (!renderedImages || (!renderedImages.urls.has(trimmed.url) && !renderedImages.labels.has(label))) {
        container.appendChild(createChatImagePreviewButton(trimmed.url));
        if (renderedImages) {
          renderedImages.urls.add(trimmed.url);
          renderedImages.labels.add(label);
        }
      }
    } else {
      appendStyledText(container, trimmed.url, style);
    }
    if (trimmed.trailing) {
      appendStyledText(container, trimmed.trailing, style);
    }

    lastIndex = start + matched.length;
  }

  if (lastIndex < value.length) {
    appendStyledText(container, value.slice(lastIndex), style);
  }
}

function skyBoundarySeconds(value, scale) {
  if (Array.isArray(value)) {
    return (Number(value[0]) || 0) * scale.hour + (Number(value[1]) || 0) * scale.minute;
  }
  if (value && typeof value === 'object') {
    return (Number(value.hour) || 0) * scale.hour + (Number(value.minute) || 0) * scale.minute;
  }
  return 0;
}

function skyStageForSecond(daySecond, almanac, scale) {
  const sunrise = skyBoundarySeconds(almanac && almanac.sunrise, scale);
  const morning = skyBoundarySeconds(almanac && almanac.morning, scale);
  const twilight = skyBoundarySeconds(almanac && almanac.twilight, scale);
  const sunset = skyBoundarySeconds(almanac && almanac.sunset, scale);

  if (daySecond >= sunrise && daySecond < morning) return 'dawn';
  if (daySecond >= morning && daySecond < twilight) return 'day';
  if (daySecond >= twilight && daySecond < sunset) return 'twilight';
  return 'night';
}

function skyCurrentState(data) {
  const scale = {
    second: Number(data && data.scale && data.scale.second) || 1,
    minute: Number(data && data.scale && data.scale.minute) || 20,
    hour: Number(data && data.scale && data.scale.hour) || 1200,
    day: Number(data && data.scale && data.scale.day) || 24000,
  };
  const receivedAt = Number(data && data._receivedAt) || Date.now();
  const elapsed = Math.max(0, Math.floor((Date.now() - receivedAt) / 1000));
  const gameNow = Math.max(0, (Number(data && data.game_now) || 0) + elapsed);
  const daySecond = ((gameNow % scale.day) + scale.day) % scale.day;
  const hour = Math.floor(daySecond / scale.hour);
  const minute = Math.floor((daySecond % scale.hour) / scale.minute);
  const second = Math.floor((daySecond % scale.minute) / scale.second);
  const stage = skyStageForSecond(daySecond, data && data.almanac, scale);
  const daySinceBeginning = Math.floor(gameNow / scale.day) + 1;

  return { scale, gameNow, daySecond, hour, minute, second, stage, daySinceBeginning };
}

function skyClockLabel(sky) {
  return String(sky.hour).padStart(2, '0') + ':' + String(sky.minute).padStart(2, '0');
}

function skyRecomputeMoon(moon, daySinceBeginning) {
  const cycle = Number(moon && moon.cycle_days) || 1;
  const phase = (Math.trunc(daySinceBeginning / cycle) % 8) + 1;
  const names = ['new', 'waxing crescent', 'half', 'waxing gibbous', 'full', 'waning gibbous', 'half', 'waning crescent'];
  return {
    ...moon,
    phase,
    phase_name: names[phase - 1],
  };
}

function skyMoonColor(moon) {
  const id = String(moon && moon.id || '').toLowerCase();
  if (id === 'dailos') return '#d46cff';
  if (id === 'markas') return '#ff5f57';
  if (id === 'tekal') return '#7ee787';
  return '#c9d1d9';
}

function skySurfaceBody(data) {
  const body = data && data.surface_body;
  if (!body || !body.id) return null;
  return {
    id: String(body.id || ''),
    name: body.name || body.id || 'World',
    description: body.description || '',
    color: body.color || '#d8dee9',
  };
}

export function channelColor(channel) {
  let hash = 0;
  for (let i = 0; i < channel.length; i++) hash = ((hash << 5) - hash + channel.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return 'hsl(' + hue + ', 60%, 65%)';
}

export function vitalBarColor(pct) {
  if (pct > 60) return '#3fb950';
  if (pct > 30) return '#d29922';
  return '#f85149';
}

function inverseVitalBarColor(pct) {
  if (pct > 60) return '#f85149';
  if (pct > 30) return '#d29922';
  return '#3fb950';
}

function divineGodLabel(god) {
  switch (String(god || '').toLowerCase()) {
    case 'mitra': return 'Mitra';
    case 'gaea': return 'Gaea';
    case 'set': return 'Set';
    default: return 'None';
  }
}

function divineModifierLabel(value) {
  const n = Number(value) || 0;
  if (n > 0) return '+' + n + '% charge';
  if (n < 0) return n + '% charge';
  return 'No charge modifier';
}

function divinePressureLabel(god, pct, leader) {
  const normalizedGod = String(god || '').toLowerCase();
  const normalizedLeader = String(leader || '').toLowerCase();

  if (pct <= 0) return 'silent';
  if (normalizedGod && normalizedGod === normalizedLeader) return 'ascendant';
  if (pct >= 85) return 'dominant';
  if (pct >= 60) return 'surging';
  if (pct >= 35) return 'rising';
  return 'stirring';
}

function closeRoomImageModal() {
  if (!roomImageModal) return;
  if (roomImageModalKeyHandler) {
    document.removeEventListener('keydown', roomImageModalKeyHandler);
    roomImageModalKeyHandler = null;
  }
  roomImageModal.remove();
  roomImageModal = null;
}

function openRoomImageModal(src, altText) {
  closeRoomImageModal();

  const overlay = document.createElement('div');
  overlay.className = 'dw-modal-overlay room-image-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'dw-modal room-image-modal';

  const header = document.createElement('div');
  header.className = 'dw-modal-header';

  const title = document.createElement('span');
  title.className = 'dw-modal-title';
  title.textContent = altText || 'Room Image';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'dw-modal-close';
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.addEventListener('click', closeRoomImageModal);

  const body = document.createElement('div');
  body.className = 'dw-modal-body room-image-modal-body';

  const img = document.createElement('img');
  img.className = 'room-image-modal-img';
  img.src = src;
  img.alt = altText || 'Room Image';
  img.draggable = false;

  header.appendChild(title);
  header.appendChild(closeBtn);
  body.appendChild(img);
  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);

  overlay.addEventListener('click', function(event) {
    if (event.target === overlay) {
      closeRoomImageModal();
    }
  });

  roomImageModalKeyHandler = function(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeRoomImageModal();
    }
  };
  document.addEventListener('keydown', roomImageModalKeyHandler);

  document.body.appendChild(overlay);
  roomImageModal = overlay;
}

function vitalBarClass(value) {
  const suffix = String(value || 'bar').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'bar';
  return 'vitals-' + suffix;
}

export function renderVitalBar(bodyEl, label, cur, max, opts = {}) {
  const rowClass = vitalBarClass(opts.id || label);
  let row = bodyEl.querySelector('.' + rowClass);
  const rawPct = max > 0 ? Math.round((cur / max) * 100) : 0;
  const pct = Math.max(0, Math.min(100, rawPct));
  if (!row) {
    row = document.createElement('div');
    row.className = 'vitals-row ' + rowClass;
    row.innerHTML =
      '<div class="vitals-label"><span class="vitals-label-name"></span><span class="vitals-val"></span></div>' +
      '<div class="vitals-bar"><div class="vitals-bar-fill"></div></div>';
    bodyEl.appendChild(row);
  }
  if (opts.guild) row.classList.add('vitals-guild');
  Array.from(row.classList).forEach((className) => {
    if (className.indexOf('vitals-kind-') === 0) row.classList.remove(className);
  });
  if (opts.kind) row.classList.add('vitals-kind-' + opts.kind);
  row.querySelector('.vitals-label-name').textContent = label;
  row.querySelector('.vitals-val').textContent = opts.display || (cur + ' / ' + max);
  if (opts.title) row.title = opts.title;
  else row.removeAttribute('title');
  const fill = row.querySelector('.vitals-bar-fill');
  fill.style.width = pct + '%';
  fill.style.backgroundColor = opts.colorMode === 'inverse'
    ? inverseVitalBarColor(pct)
    : vitalBarColor(pct);
}

function removeVitalBar(bodyEl, label, opts = {}) {
  const row = bodyEl.querySelector('.' + vitalBarClass(opts.id || label));
  if (row) row.remove();
}

function renderGuildVitalBars(bodyEl, bars) {
  const seen = {};
  if (Array.isArray(bars)) {
    bars.forEach((bar) => {
      if (!bar || !bar.id || !bar.label) return;
      const cur = Number(bar.cur);
      const max = Number(bar.max);
      if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) return;
      const id = 'guild-' + bar.id;
      const rowClass = vitalBarClass(id);
      const guild = bar.guild ? String(bar.guild) : '';
      const title = guild ? guild + ': ' + bar.label : String(bar.label);
      renderVitalBar(bodyEl, String(bar.label), cur, max, {
        id,
        guild: true,
        kind: bar.kind ? String(bar.kind) : '',
        title,
      });
      seen[rowClass] = true;
    });
  }

  bodyEl.querySelectorAll('.vitals-guild').forEach((row) => {
    const known = Array.from(row.classList).some((className) => seen[className]);
    if (!known) row.remove();
  });
}

export const panelRenderers = {
  fishing(bodyEl) {
    fishingManager.render(bodyEl);
  },

  sky(bodyEl, data) {
    if (!data || data.game_now === undefined || data.game_now === null) {
      bodyEl.innerHTML = '<div class="placeholder">Waiting for sky...</div>';
      return;
    }

    const sky = skyCurrentState(data);
    const almanac = data.almanac || {};
    const sunrise = skyBoundarySeconds(almanac.sunrise, sky.scale);
    const sunset = skyBoundarySeconds(almanac.sunset, sky.scale);
    const daylight = Math.max(1, sunset - sunrise);
    const sunProgress = Math.max(0, Math.min(1, (sky.daySecond - sunrise) / daylight));
    const sunVisible = sky.stage !== 'night';
    const sunX = 8 + sunProgress * 84;
    const sunY = 78 - Math.sin(sunProgress * Math.PI) * 62;
    const moons = Array.isArray(data.moons) ? data.moons.map((moon) => skyRecomputeMoon(moon, sky.daySinceBeginning)) : [];
    const surfaceBody = skySurfaceBody(data);
    const showMoons = sky.stage === 'night' || sky.stage === 'twilight';
    let html = '<div class="sky-panel sky-stage-' + escHtml(sky.stage) + '">';
    html += '<div class="sky-canvas">';
    html += '<div class="sky-stars"></div>';
    if (surfaceBody) {
      const bodyVisible = sky.stage === 'night' || sky.stage === 'twilight';
      const bodyTop = bodyVisible ? 17 : 28;
      const bodyOpacity = bodyVisible ? 0.88 : 0.38;
      const bodyTitle = surfaceBody.name + (surfaceBody.description ? ': ' + surfaceBody.description : '');
      html += '<div class="sky-world-body" title="' + escHtml(bodyTitle) + '" style="top:' + bodyTop + '%;opacity:' + bodyOpacity + ';--world-color:' + escHtml(surfaceBody.color) + '">' +
        '<span></span></div>';
    }
    if (sunVisible) {
      html += '<div class="sky-sun" style="left:' + sunX.toFixed(2) + '%;top:' + sunY.toFixed(2) + '%"></div>';
    }
    if (showMoons && moons.length) {
      html += '<div class="sky-moons">';
      moons.forEach((moon, index) => {
        const phase = Math.max(1, Math.min(8, Number(moon.phase) || 1));
        const color = skyMoonColor(moon);
        const left = 18 + index * 28;
        const top = 20 + (index % 2) * 13;
        const label = (moon.name || moon.id || 'Moon') + ': ' + (moon.phase_name || '');
        html += '<div class="sky-moon sky-moon-phase-' + phase + '" title="' + escHtml(label) + '" style="left:' + left + '%;top:' + top + '%;--moon-color:' + escHtml(color) + '">' +
          '<span></span></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="sky-footer"><span>' + escHtml(sky.stage.toUpperCase()) + '</span><span>' + skyClockLabel(sky) + '</span></div>';
    if (surfaceBody || moons.length) {
      html += '<div class="sky-moon-strip">';
      if (surfaceBody) {
        html += '<span><i style="background:' + escHtml(surfaceBody.color) + '"></i>' +
          escHtml(surfaceBody.name) + '</span>';
      }
      moons.forEach((moon) => {
        html += '<span><i style="background:' + escHtml(skyMoonColor(moon)) + '"></i>' +
          escHtml(moon.name || moon.id || 'Moon') + ' ' + escHtml(moon.phase_name || '') + '</span>';
      });
      html += '</div>';
    }
    html += '</div>';
    bodyEl.innerHTML = html;
  },

  avatar(bodyEl, data) {
    const hasAvatar = !!(data && data.url);
    const src = hasAvatar ? data.url : '/assets/avatar-ghost.svg';
    const alt = (data && data.name) ? data.name : 'Avatar';
    const defaultClass = hasAvatar ? '' : ' avatar-default';
    const loadingClass = (data && data.loading) ? ' avatar-loading' : '';
    const zoomableClass = hasAvatar ? ' avatar-panel-image-zoomable' : '';
    let html = '<div class="avatar-panel-wrap">';
    html += '<img class="avatar-panel-image' + defaultClass + loadingClass + zoomableClass + '" src="' + escHtml(src) + '" alt="' + escHtml(alt) + '" draggable="false">';
    if (data && data.name) {
      html += '<div class="avatar-panel-name">' + escHtml(data.name) + '</div>';
    }
    html += '</div>';
    bodyEl.innerHTML = html;

    if (hasAvatar) {
      const img = bodyEl.querySelector('.avatar-panel-image');
      if (img) {
        img.addEventListener('click', function() {
          openRoomImageModal(data.url, alt);
        });
      }
    }
  },

  roomImage(bodyEl, data) {
    let alt;
    let loadingClass;
    let img;

    if (!data || !data.url) {
      bodyEl.innerHTML = '<div class="room-image-placeholder">Generating room image...</div>';
      return;
    }

    loadingClass = data.loading ? ' room-image-loading' : '';
    alt = data.name ? escHtml(data.name) : 'Room';
    bodyEl.innerHTML =
      '<div class="room-image-wrap">' +
        '<img class="room-image-img' + loadingClass + '" src="' + escHtml(data.url) + '" alt="' + alt + '" draggable="false">' +
      '</div>';

    img = bodyEl.querySelector('.room-image-img');
    if (!img) return;

    img.addEventListener('click', function() {
      openRoomImageModal(data.url, data.name || 'Room');
    });
  },

  vitals(bodyEl, data) {
    if (!data) return;
    if (bodyEl.querySelector('.placeholder')) bodyEl.innerHTML = '';
    renderVitalBar(bodyEl, 'HP', data.hp, data.maxhp);
    const hasSpellpoints = Object.prototype.hasOwnProperty.call(data, 'sp') &&
      Object.prototype.hasOwnProperty.call(data, 'maxsp');
    if (hasSpellpoints) renderVitalBar(bodyEl, 'SP', data.sp, data.maxsp);
    else removeVitalBar(bodyEl, 'SP');
    const hasMove = Object.prototype.hasOwnProperty.call(data, 'fp') &&
      Object.prototype.hasOwnProperty.call(data, 'maxfp');
    if (hasMove) renderVitalBar(bodyEl, 'Move', data.fp, data.maxfp);
    else removeVitalBar(bodyEl, 'Move');
    if (Object.prototype.hasOwnProperty.call(data, 'level_pct')) {
      const pct = Math.max(0, Math.min(100, Number(data.level_pct) || 0));
      renderVitalBar(bodyEl, 'Level', pct, 100, { display: pct + '%' });
    } else {
      removeVitalBar(bodyEl, 'Level');
    }
    const hasCarry = Object.prototype.hasOwnProperty.call(data, 'carry') &&
      Object.prototype.hasOwnProperty.call(data, 'maxcarry');
    if (hasCarry) {
      const label = data.encumberance_label ? String(data.encumberance_label) : '';
      const title = label ? 'Encumberance: ' + label : '';
      renderVitalBar(bodyEl, 'Carry', data.carry, data.maxcarry, {
        title,
        colorMode: 'inverse',
      });
    } else {
      removeVitalBar(bodyEl, 'Carry');
    }
    bodyEl.querySelectorAll('.vitals-guild').forEach((row) => row.remove());
  },

  guildVitals(bodyEl, data) {
    const bars = data && Array.isArray(data.bars) ? data.bars : [];
    if (!bars.length) {
      bodyEl.innerHTML = '<div class="placeholder">No guild vitals</div>';
      return;
    }
    if (bodyEl.querySelector('.placeholder')) bodyEl.innerHTML = '';
    renderGuildVitalBars(bodyEl, bars);
  },

  omens(bodyEl, data) {
    if (!data) {
      bodyEl.innerHTML = '<div class="placeholder">Waiting for omens...</div>';
      return;
    }

    const scale = data.pressure_scale || {};
    const holy = data.holy_hour || {};
    const eclipse = data.eclipse || {};
    const patron = data.patron ? divineGodLabel(data.patron) : 'None';
    const leader = data.leader ? divineGodLabel(data.leader) : 'No ascendant';
    const rank = data.rank_label || 'None';
    const summary = data.summary || 'The omens are quiet.';
    const gods = ['mitra', 'gaea', 'set'];
    let html = '<div class="omens-panel">';

    html += '<div class="omens-summary">' + escHtml(summary) + '</div>';
    html += '<div class="omens-status-grid">';
    html += '<div><span>Patron</span><strong class="omens-god-' + escHtml(String(data.patron || 'none').toLowerCase()) + '">' + escHtml(patron) + '</strong></div>';
    html += '<div><span>Standing</span><strong>' + escHtml(rank) + '</strong></div>';
    html += '<div><span>Charge</span><strong>' + escHtml(divineModifierLabel(data.modifier_pct)) + '</strong></div>';
    html += '<div><span>Ascendant</span><strong class="omens-god-' + escHtml(String(data.leader || 'none').toLowerCase()) + '">' + escHtml(leader) + '</strong></div>';
    html += '</div>';

    html += '<div class="omens-pressure">';
    for (const god of gods) {
      const pct = Math.max(0, Math.min(100, Number(scale[god]) || 0));
      const pressureLabel = divinePressureLabel(god, pct, data.leader);
      html += '<div class="omens-pressure-row omens-god-' + god + '">' +
        '<div class="omens-pressure-label"><span>' + divineGodLabel(god) + '</span><span>' + pressureLabel + '</span></div>' +
        '<div class="omens-pressure-bar"><div style="width:' + pct + '%"></div></div>' +
        '</div>';
    }
    html += '</div>';

    html += '<div class="omens-flags">';
    if (holy && holy.god) {
      html += '<span class="omens-chip omens-god-' + escHtml(String(holy.god).toLowerCase()) + '">Holy Hour: ' +
        escHtml(divineGodLabel(holy.god)) + '</span>';
    }
    if (eclipse && eclipse.active) {
      html += '<span class="omens-chip omens-eclipse">Set Eclipse: ' +
        escHtml(formatDuration(eclipse.seconds_left)) + '</span>';
    }
    if (!holy.god && !(eclipse && eclipse.active)) {
      html += '<span class="omens-muted">No active divine event.</span>';
    }
    html += '</div>';
    html += '</div>';
    bodyEl.innerHTML = html;
  },

  stats(bodyEl, data) {
    if (!data || !data.current) return;
    const cur = data.current;
    const base = data.base || {};
    const statNames = [
      ['STR', 'str', 'realstr'],
      ['INT', 'int', 'realint'],
      ['WIS', 'wis', 'realwis'],
      ['DEX', 'dex', 'realdex'],
      ['CON', 'con', 'realcon'],
      ['CHR', 'chr', 'realchr'],
    ];
    let html = '<table class="stats-table">';
    for (const [label, key, baseKey] of statNames) {
      const c = cur[key] || 0;
      const b = base[baseKey] !== undefined ? base[baseKey] : c;
      let cls = '';
      if (c > b) cls = ' class="stat-up"';
      else if (c < b) cls = ' class="stat-down"';
      html += '<tr><td>' + label + '</td><td' + cls + '>' + c + '</td><td style="color:#484f58">' + b + '</td></tr>';
    }
    html += '</table>';
    bodyEl.innerHTML = html;
  },

  status(bodyEl, data) {
    if (!data) return;
    const displayName = data.fullname || data.name;
    const fields = [
      ['Name', displayName],
      ['Race', data.race],
      ['Class', data.class],
      ['Level', data.level],
      ['XP', typeof data.xp === 'number'
        ? formatInt(data.xp) + (typeof data.nl === 'number' && data.nl > 0
          ? ' (' + formatInt(data.nl) + ' to next)'
          : '')
        : data.xp],
      ['Align', data.align],
      ['Title', formatStatusTitle(data.title, displayName)],
      ['Gender', data.gender],
    ];
    let html = '';
    for (const [k, v] of fields) {
      if (v !== undefined && v !== null && v !== '' && v !== 'None') {
        html += '<div class="status-row"><span class="status-key">' + escHtml(k) + '</span><span>' + escHtml(v) + '</span></div>';
      }
    }
    const badges = [];
    if (data.dead === 'Yes') badges.push('<span class="status-badge badge-dead">Dead</span>');
    if (data.drunk && data.drunk !== 'Sober' && data.drunk !== 'None') badges.push('<span class="status-badge badge-drunk">Drunk</span>');
    if (data.invis === 'Yes') badges.push('<span class="status-badge badge-invis">Invis</span>');
    if (data.sit === 'Yes') badges.push('<span class="status-badge badge-sitting">Sitting</span>');
    if (data.viking === 'Yes') badges.push('<span class="status-badge badge-viking">Viking</span>');
    if (badges.length) html += '<div class="status-badges">' + badges.join('') + '</div>';
    bodyEl.innerHTML = html;
  },

  worth(bodyEl, data) {
    if (!data) return;
    const gold = formatInt(data.gold || 0);
    const bank = formatInt(data.bank || 0);
    bodyEl.innerHTML =
      '<div class="status-row"><span class="status-key">Gold</span><span>' + gold + '</span></div>' +
      '<div class="status-row"><span class="status-key">Bank</span><span>' + bank + '</span></div>';
  },

  xpmon(bodyEl, data) {
    const active = !!(data && data.active);
    const button = (command, label, kind) =>
      '<button type="button" class="xpmon-btn xpmon-btn-' + kind + '" data-command="' +
      escHtml(command) + '">' + escHtml(label) + '</button>';

    if (!active) {
      bodyEl.innerHTML = '<div class="xpmon-panel xpmon-panel-off">' +
        '<div class="placeholder">XP monitor is off</div>' +
        '<div class="xpmon-actions">' + button('xpmon on', 'On', 'primary') + '</div>' +
        '</div>';
    } else {
      const xp = formatInt(Number(data.xp) || 0);
      const gold = formatInt(Number(data.gold) || 0);
      const elapsedSeconds = Number(data.elapsed_seconds) || 0;
      const xpPerHour = formatInt(Number(data.xp_per_hour) || 0);
      const goldPerHour = formatInt(Number(data.gold_per_hour) || 0);

      bodyEl.innerHTML = '<div class="xpmon-panel">' +
        '<div class="xpmon-total xpmon-xp"><span>' + xp + '</span><small>XP gained</small></div>' +
        '<div class="xpmon-total xpmon-gold"><span>' + gold + '</span><small>Gold gained</small></div>' +
        '<div class="status-row"><span class="status-key">Elapsed</span><span>' +
          escHtml(formatDuration(elapsedSeconds)) + '</span></div>' +
        '<div class="status-row"><span class="status-key">XP/hour</span><span>' +
          escHtml(xpPerHour) + '</span></div>' +
        '<div class="status-row"><span class="status-key">Gold/hour</span><span>' +
          escHtml(goldPerHour) + '</span></div>' +
        '<div class="xpmon-actions">' +
          button('xpmon reset', 'Reset', 'secondary') +
          button('xpmon off', 'Off', 'danger') +
        '</div>' +
        '</div>';
    }

    if (typeof bodyEl.querySelectorAll === 'function') {
      bodyEl.querySelectorAll('.xpmon-btn').forEach((btn) => {
        btn.addEventListener('click', () => sendCommandText(btn.dataset.command));
      });
    }
  },

  buffs(bodyEl, data) {
    if (!Array.isArray(data) || data.length === 0) {
      bodyEl.innerHTML = '<div class="placeholder">No active buffs</div>';
      return;
    }

    let html = '<div class="buff-list">';
    for (const item of data) {
      const kind = item.kind === 'debuff' ? 'debuff' : (item.kind === 'unknown' ? 'unknown' : 'buff');
      const duration = Number(item.duration) || 0;
      const expiresAt = Number(item.expiresAt) || 0;
      const remaining = duration > 0 && expiresAt > 0
        ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
        : (Number(item.remaining) || 0);
      const pct = duration > 0
        ? Math.max(0, Math.min(100, Math.round((remaining / duration) * 100)))
        : 100;
      const titleParts = [];
      if (item.desc) titleParts.push(item.desc);
      if (duration > 0) titleParts.push(formatDuration(remaining) + ' remaining');
      const desc = titleParts.length ? ' title="' + escHtml(titleParts.join(' - ')) + '"' : '';
      html += '<div class="buff-entry buff-entry-' + kind + '" style="--buff-pct:' + pct + '%"' + desc + '>';
      html += '<span class="buff-entry-fill"></span>';
      html += '<span class="buff-entry-name">' + escHtml(item.name) + '</span>';
      if (duration > 0) {
        html += '<span class="buff-entry-time">' + escHtml(formatDuration(remaining)) + '</span>';
      }
      if (kind === 'debuff') {
        html += '<span class="buff-entry-kind">Debuff</span>';
      }
      html += '</div>';
    }
    html += '</div>';
    bodyEl.innerHTML = html;
  },

  room(bodyEl, data) {
    if (!data || !data.name) return;
    let html = '<div class="room-name">' + escHtml(data.name) + '</div>';
    if (data.area) html += '<div class="room-area">' + escHtml(data.area) + '</div>';
    if (data.environment) html += '<div class="room-env">' + escHtml(data.environment) + '</div>';

    const exits = (data.exits && typeof data.exits === 'object') ? data.exits : {};
    const exitStates = (data.exit_states && typeof data.exit_states === 'object') ? data.exit_states : {};
    const compassDirs = ['northwest','north','northeast','west',null,'east','southwest','south','southeast'];
    const dirLabels = { northwest:'NW', north:'N', northeast:'NE', west:'W', east:'E', southwest:'SW', south:'S', southeast:'SE', up:'U', down:'D' };

    html += '<div class="exit-compass">';
    for (const dir of compassDirs) {
      if (dir === null) {
        html += '<div class="exit-rose-center" aria-hidden="true">' +
          '<span class="exit-rose-ring"></span>' +
          '<span class="exit-rose-needle exit-rose-needle-ns"></span>' +
          '<span class="exit-rose-needle exit-rose-needle-ew"></span>' +
          '<span class="exit-rose-dot"></span>' +
          '</div>';
      } else if (exitStates[dir]) {
        html += '<div class="exit-btn inactive" title="' + escHtml(dir + ': ' + exitStates[dir]) + '">' + dirLabels[dir] + '</div>';
      } else if (exits[dir] !== undefined) {
        html += '<button class="exit-btn exit-dir-' + dir + '" data-dir="' + dir + '" title="' + escHtml(dir) + '">' + dirLabels[dir] + '</button>';
      } else {
        html += '<div class="exit-btn inactive"></div>';
      }
    }
    html += '</div>';

    if (exits.up !== undefined || exits.down !== undefined) {
      html += '<div class="exit-ud">';
      html += exitStates.up
        ? '<div class="exit-btn inactive" title="' + escHtml('up: ' + exitStates.up) + '">U</div>'
        : exits.up !== undefined
        ? '<button class="exit-btn" data-dir="up">U</button>'
        : '<div class="exit-btn inactive"></div>';
      html += exitStates.down
        ? '<div class="exit-btn inactive" title="' + escHtml('down: ' + exitStates.down) + '">D</div>'
        : exits.down !== undefined
        ? '<button class="exit-btn" data-dir="down">D</button>'
        : '<div class="exit-btn inactive"></div>';
      html += '</div>';
    }

    if (Array.isArray(data.players) && data.players.length) {
      html += '<div class="room-players">Players: ';
      html += data.players.map(p => '<span>' + escHtml(p.fullname || p.name) + '</span>').join(', ');
      html += '</div>';
    }

    bodyEl.innerHTML = html;

    bodyEl.querySelectorAll('.exit-btn[data-dir]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        sendCommandText(btn.dataset.dir);
      });
    });
  },

  inventory(bodyEl, data) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      bodyEl.innerHTML = '<div class="placeholder">Empty</div>';
      return;
    }

    // Preserve active tab
    const activeTab = bodyEl.querySelector('.inv-tab.active');
    const currentTab = activeTab ? activeTab.dataset.tab : 'all';

    // Parse slot from item name parenthetical
    const slotPattern = /\(([^)]+)\)\s*$/;
    const slotMap = {
      'worn on head': 'Head', 'worn around the neck': 'Neck',
      'worn over the shoulders': 'Shoulders', 'worn on body': 'Body',
      'worn on body and legs': 'Body+Legs', 'worn as a full suit of armour': 'FullSuit',
      'worn on hands': 'Hands', 'worn on legs': 'Legs', 'worn on feet': 'Feet',
      'worn on finger': 'Finger', 'used as shield': 'Shield',
      'main weapon': 'Main Weapon', 'secondary weapon': 'Off-hand',
      'used as light': 'Light',
    };

    function cleanName(name) {
      let n = name.replace(/^\*/, '').replace(slotPattern, '').trim();
      return n.charAt(0).toUpperCase() + n.slice(1);
    }

    function getSlot(name) {
      const m = name.match(slotPattern);
      return m ? (slotMap[m[1]] || null) : null;
    }

    // Categorize items
    const wielded = [], worn = [], containers = [], carried = [];
    const slots = {};

    for (const item of data) {
      const clean = cleanName(item.name);
      const slot = getSlot(item.name);
      const entry = { id: item.id, name: clean, attrib: item.attrib, slot: slot, raw: item.name };

      const isWielded = item.attrib && item.attrib.includes('l');
      const isWorn = item.attrib && item.attrib.includes('w');
      const isContainer = item.attrib && item.attrib.includes('c');
      if (isWielded) { wielded.push(entry); if (slot) slots[slot] = entry; }
      if (isWorn) { worn.push(entry); if (slot) slots[slot] = entry; }
      if (isContainer) containers.push(entry);
      if (!isWielded && !isWorn && !isContainer) carried.push(entry);

      // Handle multi-slot items
      if (slot === 'Body+Legs') { slots['Body'] = entry; slots['Legs'] = entry; }
      if (slot === 'FullSuit') { ['Body','Legs','Head','Hands','Feet'].forEach(s => slots[s] = entry); }
    }

    wielded.sort((a, b) => a.name.localeCompare(b.name));
    worn.sort((a, b) => a.name.localeCompare(b.name));
    containers.sort((a, b) => a.name.localeCompare(b.name));
    carried.sort((a, b) => a.name.localeCompare(b.name));

    // Build tabs
    let html = '<div class="inv-tabs">';
    const tabs = [['all','All'],['worn','Worn'],['wielded','Wielded'],['carried','Carried']];
    for (const [id, label] of tabs) {
      html += '<button class="inv-tab' + (currentTab === id ? ' active' : '') + '" data-tab="' + id + '">' + label + '</button>';
    }
    html += '</div>';

    // All tab
    html += '<div class="inv-tab-content' + (currentTab === 'all' ? ' active' : '') + '" data-tab="all"><div class="inv-list">';
    if (wielded.length) {
      html += '<div class="inv-group-header">WIELDED</div>';
      for (const e of wielded) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (worn.length) {
      html += '<div class="inv-group-header">WORN</div>';
      for (const e of worn) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (containers.length) {
      html += '<div class="inv-group-header">CONTAINERS</div>';
      for (const e of containers) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (carried.length) {
      html += '<div class="inv-group-header">CARRIED</div>';
      for (const e of carried) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    html += '</div></div>';

    // Worn tab - paper doll
    html += '<div class="inv-tab-content' + (currentTab === 'worn' ? ' active' : '') + '" data-tab="worn">';
    html += '<div class="inv-paperdoll">';
    const dollSlots = [
      ['Head',null,'Head'],
      ['Neck',null,'Neck'],
      ['Shoulders',null,'Shoulders'],
      ['Body',null,'Body'],
      ['Hands','Shield','Hands / Shield'],
      ['Legs',null,'Legs'],
      ['Feet',null,'Feet'],
      ['Finger',null,'Finger'],
    ];
    for (const [left, right] of dollSlots) {
      if (right) {
        // Two-column row
        html += '<div class="inv-doll-row inv-doll-row-split">';
        html += renderSlot(left, slots[left]);
        html += renderSlot(right, slots[right]);
        html += '</div>';
      } else {
        html += '<div class="inv-doll-row">';
        html += renderSlot(left, slots[left]);
        html += '</div>';
      }
    }
    html += '</div></div>';

    // Wielded tab
    html += '<div class="inv-tab-content' + (currentTab === 'wielded' ? ' active' : '') + '" data-tab="wielded">';
    html += '<div class="inv-wield-list">';
    const wieldSlots = ['Main Weapon', 'Off-hand', 'Shield', 'Light'];
    for (const ws of wieldSlots) {
      const item = slots[ws];
      html += '<div class="inv-wield-slot">';
      html += '<span class="inv-wield-label">' + ws + '</span>';
      html += '<span class="' + (item ? 'inv-wield-item' : 'inv-wield-empty') + '">' + (item ? escHtml(item.name) : 'empty') + '</span>';
      html += '</div>';
    }
    html += '</div></div>';

    // Carried tab
    html += '<div class="inv-tab-content' + (currentTab === 'carried' ? ' active' : '') + '" data-tab="carried"><div class="inv-list">';
    if (containers.length) {
      html += '<div class="inv-group-header">CONTAINERS</div>';
      for (const e of containers) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    const carriedAll = carried;
    if (carriedAll.length) {
      if (containers.length) html += '<div class="inv-group-header">ITEMS</div>';
      for (const e of carriedAll) html += '<div class="inv-item">' + escHtml(e.name) + '</div>';
    }
    if (!containers.length && !carriedAll.length) {
      html += '<div class="placeholder">Nothing carried</div>';
    }
    html += '</div></div>';

    bodyEl.innerHTML = html;

    // Tab click handlers
    bodyEl.querySelectorAll('.inv-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        bodyEl.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
        bodyEl.querySelectorAll('.inv-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const content = bodyEl.querySelector('.inv-tab-content[data-tab="' + tab.dataset.tab + '"]');
        if (content) content.classList.add('active');
      });
    });

    function renderSlot(label, item) {
      if (item) {
        return '<div class="inv-doll-slot inv-doll-filled"><div class="inv-doll-slot-label">' + label + '</div><div class="inv-doll-slot-item">' + escHtml(item.name) + '</div></div>';
      }
      return '<div class="inv-doll-slot inv-doll-empty"><div class="inv-doll-slot-label">' + label + '</div><div class="inv-doll-slot-item">empty</div></div>';
    }
  },

  enemy(bodyEl, data) {
    if (!data || !data.enemy_name || data.enemy_name === 'None' || data.enemy_name === '') {
      bodyEl.innerHTML = '<div class="panel-inactive placeholder">No target</div>';
      bodyEl._enemyState = null;
      return;
    }

    const prev = bodyEl._enemyState || {};
    const sameEnemy = prev.name === data.enemy_name;
    const sameImage = prev.image === (data.enemy_image || '');

    // Fast path: same enemy + same image — just update bars in place
    if (sameEnemy && sameImage) {
      renderVitalBar(bodyEl, 'HP', data.enemy_curhp, data.enemy_maxhp || 100);
      if (data.enemy_maxsp > 0) {
        renderVitalBar(bodyEl, 'SP', data.enemy_cursp, data.enemy_maxsp);
      }
      const hpStr = bodyEl.querySelector('.enemy-hp-string');
      if (hpStr && data.enemy_hp_string && data.enemy_hp_string !== 'None') {
        hpStr.textContent = data.enemy_hp_string;
      }
      return;
    }

    // Full rebuild
    bodyEl.innerHTML = '';
    bodyEl._enemyState = { name: data.enemy_name, image: data.enemy_image || '' };

    const row = document.createElement('div');
    row.className = 'enemy-row';

    // Left: image
    if (data.enemy_image) {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'enemy-image';
      const img = document.createElement('img');
      img.src = data.enemy_image;
      img.alt = data.enemy_name;
      img.draggable = false;
      img.addEventListener('load', () => imgWrap.classList.add('enemy-image-loaded'));
      img.addEventListener('error', () => imgWrap.classList.add('enemy-image-error'));
      imgWrap.appendChild(img);
      row.appendChild(imgWrap);
    }

    // Right: name, hp string, vitals
    const info = document.createElement('div');
    info.className = 'enemy-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'enemy-name';
    nameDiv.textContent = data.enemy_name;
    info.appendChild(nameDiv);

    if (data.enemy_hp_string && data.enemy_hp_string !== 'None') {
      const hpStr = document.createElement('div');
      hpStr.className = 'enemy-hp-string';
      hpStr.textContent = data.enemy_hp_string;
      info.appendChild(hpStr);
    }

    renderVitalBar(info, 'HP', data.enemy_curhp, data.enemy_maxhp || 100);
    if (data.enemy_maxsp > 0) {
      renderVitalBar(info, 'SP', data.enemy_cursp, data.enemy_maxsp);
    }

    row.appendChild(info);
    bodyEl.appendChild(row);
  },

  group(bodyEl, data) {
    if (!data || data === '' || (typeof data === 'object' && (!data.members || data.members.length === 0))) {
      bodyEl.innerHTML = '<div class="placeholder">Not in a group</div>';
      return;
    }
    let html = '<div class="group-header">';
    html += '<strong>' + escHtml(data.groupname || 'Group') + '</strong>';
    if (data.leader) html += ' &middot; Leader: ' + escHtml(data.leader);
    if (data.count) html += ' &middot; ' + data.count + ' members';
    html += '</div>';

    if (Array.isArray(data.members)) {
      for (const m of data.members) {
        const info = m.info || {};
        const here = info.here === 'Yes';
        html += '<div class="group-member' + (here ? '' : ' group-member-away') + '">';
        html += '<span class="group-member-name">' + escHtml(m.name) + '</span>';
        html += ' <span style="color:#484f58">Lv' + (info.lvl || '?') + '</span>';
        const hpPct = info.maxhp > 0 ? Math.round((info.hp / info.maxhp) * 100) : 0;
        html += '<div class="group-mini-bar"><div class="group-mini-bar-fill" style="width:' + hpPct + '%;background:' + vitalBarColor(hpPct) + '"></div></div>';
        html += '</div>';
      }
    }
    bodyEl.innerHTML = html;
  },

  chat(bodyEl, data) {
    const messages = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.messages) ? data.messages : []);
    const channels = data && !Array.isArray(data) && Array.isArray(data.channels) ? data.channels : [];
    const players = data && !Array.isArray(data) && Array.isArray(data.players) ? data.players : [];
    const activeChannels = data && !Array.isArray(data) && Array.isArray(data.activeChannels)
      ? data.activeChannels
      : [];

    if (!data || (messages.length === 0 && channels.length === 0 && players.length === 0 && activeChannels.length === 0)) {
      bodyEl.innerHTML = '<div class="placeholder">No messages</div>';
      return;
    }

    const placeholder = bodyEl.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    let meta = bodyEl.querySelector('.chat-meta');
    if (channels.length || players.length || activeChannels.length) {
      if (!meta) {
        meta = document.createElement('div');
        meta.className = 'chat-meta';
        bodyEl.insertBefore(meta, bodyEl.firstChild);
      }
      const channelChips = channels.slice(0, 12).map((channel) => {
        const name = channel.caption || channel.name || channel.command || '';
        if (!name) return '';
        return '<span class="chat-chip">' + escHtml(name) + '</span>';
      }).filter(Boolean).join('');
      const activeChips = activeChannels.map((channel) =>
        '<span class="chat-chip chat-chip-active">' + escHtml(channel) + '</span>'
      ).join('');
      const playerCount = players.length
        ? '<span class="chat-chip">' + players.length + ' online</span>'
        : '';
      meta.innerHTML = channelChips + activeChips + playerCount;
    } else if (meta) {
      meta.remove();
    }

    let log = bodyEl.querySelector('.chat-log');
    const wasAtBottom = log ? (log.scrollHeight - log.scrollTop - log.clientHeight) < 5 : true;

    if (!log) {
      log = document.createElement('div');
      log.className = 'chat-log';
      if (!meta) bodyEl.innerHTML = '';
      bodyEl.appendChild(log);
    }

    if (messages.length >= 200 && log.childNodes.length >= messages.length) {
      log.innerHTML = '';
    }

    const existing = log.childNodes.length;
    const toRender = messages.slice(existing);

    for (const msg of toRender) {
      const entry = document.createElement('div');
      entry.className = 'chat-entry';
      const ch = channelColor(msg.channel || '');
      const talker = msg.talker ? msg.talker.charAt(0).toUpperCase() + msg.talker.slice(1) : '';
      // Strip redundant prefix from text — the panel already shows channel and talker
      let fragments = parseAnsiText(msg.text || '');
      let text = fragments.map((fragment) => fragment.text).join('');
      // Patterns: "[Channel] Name: text", "[Channel] (Role) Name: text", "Name shouts: text"
      const talkerEsc = (msg.talker || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (talkerEsc) {
        // Strip everything up to and including "TalkerName: " or "TalkerName shouts: "
        const re = new RegExp('^(\\[\\S+\\]\\s+)?(\\(\\w+\\)\\s+)?' + talkerEsc + '(\\s+\\w+)?:\\s*', 'i');
        const match = text.match(re);
        if (match) {
          fragments = trimLeadingFragments(fragments, match[0].length);
          text = text.slice(match[0].length);
        }
      }
      const channelEl = document.createElement('span');
      channelEl.className = 'chat-channel';
      channelEl.style.color = ch;
      channelEl.textContent = '[' + (msg.channel || '') + ']';
      entry.appendChild(channelEl);
      entry.appendChild(document.createTextNode(' '));

      const talkerEl = document.createElement('span');
      talkerEl.className = 'chat-talker';
      talkerEl.textContent = talker + ':';
      entry.appendChild(talkerEl);
      entry.appendChild(document.createTextNode(' '));

      const renderedImages = {
        urls: new Set(),
        labels: new Set(),
      };
      for (let i = 0; i < fragments.length; i++) {
        const fragment = fragments[i];
        if (fragment.href && isImageFileUrl(fragment.href)) {
          while (i + 1 < fragments.length && fragments[i + 1].href === fragment.href) i++;
          appendFragmentWithImagePreviews(entry, fragment.text, fragment.style || {}, fragment.href, renderedImages);
          continue;
        }
        appendFragmentWithImagePreviews(entry, fragment.text, fragment.style || {}, fragment.href, renderedImages);
      }
      log.appendChild(entry);
    }

    while (log.childNodes.length > messages.length) log.removeChild(log.lastChild);
    while (log.childNodes.length > 200) log.removeChild(log.firstChild);

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
  },

  map(bodyEl, _data) {
    renderMap(bodyEl, getLiveMapSource());
    wireSpeedwalk(bodyEl);
  },

  areaMap(bodyEl, _data) {
    renderMap(bodyEl, browseSource);
  },

  quests(bodyEl, data) {
    if (!data) {
      bodyEl.innerHTML = '<div class="placeholder">No quest data</div>';
      return;
    }

    var html = '';
    var list = Array.isArray(data.list)
      ? data.list.filter(function(q) { return !isCompletedQuest(q); })
      : data.list;

    // Quest list
    if (Array.isArray(list) && list.length > 0) {
      html += '<div class="quest-list">';
      html += '<div class="quest-list-header">Accepted Quests</div>';
      for (var j = 0; j < list.length; j++) {
        var q = list[j];
        var cls = 'quest-list-item';
        var qPct = q.total > 0 ? Math.round((q.current / q.total) * 100) : 0;
        if (qPct > 100) qPct = 100;
        html += '<div class="' + cls + '">';
        html += '<div class="quest-list-name">' + escHtml(q.name) + '</div>';
        html += '<div class="quest-list-info">';
        html += '<span class="quest-list-status">' + escHtml(q.status) + '</span>';
        html += '<div class="quest-bar quest-bar-sm"><div class="quest-bar-fill" style="width:' + qPct + '%"></div></div>';
        html += '</div></div>';
        if (q.readyToTurnIn) {
          var giver = q.giverName || q.giverArea || 'the area waysteward';
          html += '<div class="quest-turnin">Ready to turn in at ' +
            escHtml(giver) + ' waysteward</div>';
        }
        if (Array.isArray(q.objectives) && q.objectives.length > 0) {
          html += '<div class="quest-objectives">';
          for (var k = 0; k < q.objectives.length; k++) {
            var obj = q.objectives[k];
            var pct = obj.required > 0 ? Math.round((obj.current / obj.required) * 100) : 0;
            if (pct > 100) pct = 100;
            var done = obj.status === 'finished';
            html += '<div class="quest-obj">';
            html += '<div class="quest-obj-name">' + (done ? '&#10003; ' : '') + escHtml(obj.name) + '</div>';
            html += '<div class="quest-obj-progress">';
            html += '<div class="quest-bar"><div class="quest-bar-fill' + (done ? ' quest-bar-done' : '') + '" style="width:' + pct + '%"></div></div>';
            html += '<span class="quest-obj-count">' + obj.current + '/' + obj.required + '</span>';
            html += '</div></div>';
          }
          html += '</div>';
        }
      }
      html += '</div>';
    } else {
      html += '<div class="placeholder">No active quests</div>';
    }

    bodyEl.innerHTML = html;
  },

  achievements(bodyEl, data) {
    var html;
    var summary;
    var families;
    var nextUps;

    if (!data) {
      bodyEl.innerHTML = '<div class="placeholder">No achievement data</div>';
      return;
    }

    summary = data.summary || {};
    families = Array.isArray(data.families) ? data.families : [];
    nextUps = families
      .filter(family => family && family.nextTierThreshold)
      .map(family => {
        var currentValue = Number(family.currentValue) || 0;
        var nextThreshold = Number(family.nextTierThreshold) || 0;
        var progressPct = nextThreshold > 0 ? Math.round((currentValue / nextThreshold) * 100) : 0;
        if (progressPct > 100) progressPct = 100;
        if (progressPct < 0) progressPct = 0;
        return { family, progressPct, remaining: Math.max(nextThreshold - currentValue, 0) };
      })
      .sort((a, b) => {
        if (b.progressPct !== a.progressPct) return b.progressPct - a.progressPct;
        return a.remaining - b.remaining;
      })
      .slice(0, 3);

    html = '<div class="ach-summary">';
    html += '<div class="ach-summary-grid">';
    html += '<div class="ach-summary-item"><span class="ach-summary-label">Unlocked</span><span class="ach-summary-value">'
      + (summary.unlockedTierCount || 0) + '/' + (summary.totalTierCount || 0) + '</span></div>';
    html += '<div class="ach-summary-item"><span class="ach-summary-label">Completed</span><span class="ach-summary-value">'
      + (summary.completedFamilyCount || 0) + '/' + (summary.totalFamilyCount || 0) + '</span></div>';
    html += '<div class="ach-summary-item"><span class="ach-summary-label">Rank</span><span class="ach-summary-value">'
      + (summary.leaderboardRank || 'Unranked') + '</span></div>';
    html += '</div>';
    html += '<div class="ach-equipped">Equipped: '
      + escHtml(summary.equippedTitle && summary.equippedTitle.title
        ? summary.equippedTitle.title
        : 'None')
      + '</div>';
    html += '<div class="ach-panel-note">Use <code>achievements</code> to open the full journal.</div>';
    html += '</div>';

    if (!nextUps.length) {
      html += '<div class="placeholder">No achievement milestones in progress.</div>';
      bodyEl.innerHTML = html;
      return;
    }

    html += '<div class="ach-section">';
    html += '<div class="ach-section-title">Closest Milestones</div>';

    for (var i = 0; i < nextUps.length; i++) {
      var item = nextUps[i];
      var fam = item.family;
      var currentValue = Number(fam.currentValue) || 0;
      var nextThreshold = Number(fam.nextTierThreshold) || 0;

      html += '<div class="ach-compact-item">';
      html += '<div class="ach-compact-head">';
      html += '<div class="ach-family-name">' + escHtml(fam.name) + '</div>';
      html += '<div class="ach-family-value">' + currentValue.toLocaleString() + '</div>';
      html += '</div>';
      html += '<div class="ach-compact-next">Next: ' + escHtml(fam.nextTierKey || '')
        + ' · ' + currentValue.toLocaleString() + '/' + nextThreshold.toLocaleString() + '</div>';
      html += '<div class="quest-bar"><div class="quest-bar-fill" style="width:' + item.progressPct + '%"></div></div>';
      html += '</div>';
    }
    html += '</div>';

    bodyEl.innerHTML = html;
  },

  connection(bodyEl, data) {
    if (!data || !data.diagnosis) {
      bodyEl.innerHTML = '<div class="placeholder">Collecting connection samples...</div>';
      return;
    }

    const d = data.diagnosis;
    const inputs = data.inputs || {};
    const mud = inputs.mud;
    const http = inputs.http;
    const server = inputs.server;
    const local = inputs.local;

    const axisRow = (label, axis, stat) => {
      const reason = axis.reasons && axis.reasons.length ? axis.reasons[0] : '';
      return '<div class="lag-axis">'
        + '<span class="lag-dot lag-dot-' + escHtml(axis.status) + '"></span>'
        + '<span class="lag-axis-name">' + escHtml(label) + '</span>'
        + '<span class="lag-axis-stat">' + escHtml(stat) + '</span>'
        + (reason ? '<div class="lag-axis-reason">' + escHtml(reason) + '</div>' : '')
        + '</div>';
    };

    const networkStat = mud
      ? mud.median + 'ms game / ' + (http ? http.median + 'ms web' : '-- web')
        + (mud.lossPct ? ' / ' + mud.lossPct + '% loss' : '')
      : 'collecting...';
    const serverStat = server && (server.window_s || 0) > 0
      ? 'drift ' + server.hb_drift_avg_ms + 'ms avg, ' + server.hb_drift_max_ms + 'ms max'
      : (inputs.serverSupported ? 'collecting...' : 'not reported');
    const localStat = local
      ? 'tab drift ' + local.driftP90 + 'ms'
        + ((inputs.reconnectsRecent || 0) ? ' / ' + inputs.reconnectsRecent + ' reconnect(s)' : '')
      : 'collecting...';

    let html = '<div class="lag-panel">';
    html += '<div class="lag-verdict lag-verdict-' + escHtml(d.verdict) + '">' + escHtml(d.headline) + '</div>';
    html += axisRow('Network', d.network, networkStat);
    html += axisRow('Game server', d.server, serverStat);
    html += axisRow('Your device', d.local, localStat);

    // Dual sparkline: game RTT (accent) vs web RTT (muted), last 60s.
    const t = data.t || 0;
    const W = 280;
    const H = 46;
    const mudLine = sparklinePoints(data.mudSamples || [], t, { width: W, height: H });
    const httpLine = sparklinePoints(data.httpSamples || [], t,
      { width: W, height: H, floorMax: mudLine.maxRtt });
    const poly = (line, cls) => line.segments
      .filter((seg) => seg.length > 1)
      .map((seg) => '<polyline class="' + cls + '" points="'
        + seg.map((p) => p.x + ',' + p.y).join(' ') + '"/>')
      .join('');
    html += '<div class="lag-spark-wrap">'
      + '<svg class="lag-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
      + poly(httpLine, 'lag-spark-http') + poly(mudLine, 'lag-spark-mud')
      + '</svg>'
      + '<div class="lag-spark-legend">'
      + '<span><i class="lag-leg-mud"></i>game</span>'
      + '<span><i class="lag-leg-http"></i>web</span>'
      + '<span class="lag-spark-max">max ' + Math.round(mudLine.maxRtt) + 'ms</span>'
      + '</div></div>';

    // Full check controls + result.
    const fc = data.fullCheck;
    html += '<div class="lag-check-row">';
    html += '<button type="button" class="lag-check-btn"' + (fc && fc.running ? ' disabled' : '') + '>'
      + (fc && fc.running ? 'Checking...' : 'Run full check') + '</button>';
    if (fc && !fc.running) {
      if (fc.internetRtt !== null) {
        html += '<span class="lag-check-result">internet ' + fc.internetRtt + 'ms</span>';
      } else if (fc.internetError) {
        html += '<span class="lag-check-result lag-check-warn">internet check failed</span>';
      }
    }
    html += '</div>';
    html += '</div>';

    bodyEl.innerHTML = html;
    const checkBtn = bodyEl.querySelector('.lag-check-btn');
    if (checkBtn) {
      checkBtn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('dw:lag-run-check'));
      });
    }
  },
};
