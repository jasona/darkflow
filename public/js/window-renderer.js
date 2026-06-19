import { LAYOUT_TYPES, INPUT_TYPES, DISPLAY_TYPES, STYLE_ALLOWLIST } from './window-types.js';
import { parseAnsiText, styleToElement } from './ansi.js';

// ── Style helpers ───────────────────────────────────────────────────
export function applyStyle(el, styleObj) {
  if (!styleObj || typeof styleObj !== 'object') return;
  for (const [prop, val] of Object.entries(styleObj)) {
    if (STYLE_ALLOWLIST.has(prop) && val !== undefined && val !== null) {
      el.style[prop] = String(val);
    }
  }
}

function setAttr(el, schema) {
  if (schema.id) el.setAttribute('data-dw-id', schema.id);
  if (schema.style) applyStyle(el, schema.style);
}

// ── Main render entry ───────────────────────────────────────────────
export function renderLayout(schema, buttonHandler) {
  return renderNode(schema, buttonHandler);
}

function renderNode(schema, buttonHandler) {
  if (!schema || !schema.type) {
    const span = document.createElement('span');
    span.textContent = '[unknown]';
    return span;
  }
  if (LAYOUT_TYPES.has(schema.type)) return renderContainer(schema, buttonHandler);
  if (INPUT_TYPES.has(schema.type)) return renderInput(schema, buttonHandler);
  if (DISPLAY_TYPES.has(schema.type)) return renderDisplay(schema);

  const span = document.createElement('span');
  span.textContent = '[' + schema.type + ']';
  return span;
}

// ── Layout containers ───────────────────────────────────────────────
function renderContainer(schema, buttonHandler) {
  const el = document.createElement('div');
  el.className = 'dw-layout dw-layout-' + schema.type;
  setAttr(el, schema);

  if (schema.type === 'grid' && schema.columns) {
    const cols = typeof schema.columns === 'number'
      ? 'repeat(' + schema.columns + ', 1fr)'
      : schema.columns;
    el.style.gridTemplateColumns = cols;
  }

  if (Array.isArray(schema.children)) {
    for (const child of schema.children) {
      el.appendChild(renderNode(child, buttonHandler));
    }
  }
  return el;
}

// ── Display elements ────────────────────────────────────────────────
function renderDisplay(schema) {
  switch (schema.type) {
    case 'player_row':
      return renderPlayerRow(schema);
    case 'finger_profile':
      return renderFingerProfile(schema);
    case 'heading': {
      const el = document.createElement('h3');
      el.className = 'dw-heading';
      el.textContent = schema.text || '';
      setAttr(el, schema);
      return el;
    }
    case 'paragraph': {
      const el = document.createElement('p');
      el.className = 'dw-paragraph';
      el.textContent = schema.text || '';
      setAttr(el, schema);
      return el;
    }
    case 'text': {
      const el = document.createElement('span');
      el.className = 'dw-text';
      el.textContent = schema.text || '';
      setAttr(el, schema);
      return el;
    }
    case 'ansi_text':
      return renderAnsiText(schema);
    case 'divider': {
      const el = document.createElement('hr');
      el.className = 'dw-divider';
      setAttr(el, schema);
      return el;
    }
    case 'progress': {
      const el = document.createElement('div');
      el.className = 'dw-progress';
      setAttr(el, schema);
      const fill = document.createElement('div');
      fill.className = 'dw-progress-fill';
      const pct = Math.min(Math.max(schema.value || 0, 0), 100);
      fill.style.width = pct + '%';
      if (schema.color) fill.style.backgroundColor = schema.color;
      el.appendChild(fill);
      if (schema.label) {
        const lbl = document.createElement('span');
        lbl.className = 'dw-progress-label';
        lbl.textContent = schema.label;
        el.appendChild(lbl);
      }
      return el;
    }
    case 'image': {
      const el = document.createElement('div');
      el.className = 'dw-image';
      setAttr(el, schema);
      if (schema.src) {
        const img = document.createElement('img');
        img.src = schema.src;
        img.alt = schema.alt || '';
        img.draggable = false;
        img.addEventListener('load', () => el.classList.add('dw-image-loaded'));
        img.addEventListener('error', () => {
          el.classList.add('dw-image-error');
          const err = document.createElement('div');
          err.className = 'dw-image-loading';
          err.textContent = 'No image available.\n(likely we hit our rate limit; try again later!)';
          el.appendChild(err);
        });
        el.appendChild(img);
      }
      if (schema.loading) {
        const spinner = document.createElement('div');
        spinner.className = 'dw-image-loading';
        spinner.textContent = schema.loadingText || 'Generating image...';
        el.appendChild(spinner);
      }
      return el;
    }
    case 'youtube_embed': {
      const el = document.createElement('div');
      el.className = 'dw-youtube-embed';
      setAttr(el, schema);

      if (schema.src) {
        const iframe = document.createElement('iframe');
        iframe.src = schema.src;
        iframe.title = schema.title || schema.alt || 'YouTube video';
        iframe.loading = 'lazy';
        iframe.allowFullscreen = true;
        iframe.setAttribute('allow',
          'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
        iframe.setAttribute('referrerpolicy', 'origin-when-cross-origin');
        iframe.setAttribute('sandbox',
          'allow-scripts allow-same-origin allow-presentation allow-popups allow-forms');
        el.appendChild(iframe);
      }

      return el;
    }
    default: {
      const el = document.createElement('span');
      el.textContent = '[' + schema.type + ']';
      return el;
    }
  }
}

function renderAnsiText(schema) {
  const el = document.createElement('pre');
  el.className = 'dw-ansi-text';
  setAttr(el, schema);

  const fragments = parseAnsiText(schema.text || '');
  for (const fragment of fragments) {
    el.appendChild(styleToElement(fragment.text, fragment.style || {}));
  }

  return el;
}

function renderFingerProfile(schema) {
  const fallbackAvatar = schema.fallback_avatar || '/assets/avatar-ghost.svg';
  const el = document.createElement('div');
  el.className = 'dw-finger-profile';
  setAttr(el, schema);

  const avatarButton = document.createElement('button');
  avatarButton.type = 'button';
  avatarButton.className = 'dw-finger-avatar-button';
  avatarButton.title = 'View avatar';
  avatarButton.setAttribute('aria-label', 'View avatar for ' + (schema.name || 'player'));

  const img = document.createElement('img');
  img.className = 'dw-finger-avatar';
  img.src = schema.avatar || fallbackAvatar;
  img.alt = schema.name ? schema.name + ' avatar' : 'Player avatar';
  img.draggable = false;
  img.addEventListener('error', () => {
    if (img.src !== fallbackAvatar) img.src = fallbackAvatar;
  });
  avatarButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.dispatchEvent(new CustomEvent('dw:avatarZoom', {
      detail: {
        src: img.currentSrc || img.src || fallbackAvatar,
        fallback: fallbackAvatar,
        alt: img.alt,
        name: schema.name || 'Player'
      }
    }));
  });
  avatarButton.appendChild(img);

  const details = document.createElement('div');
  details.className = 'dw-finger-details';

  const tagline = document.createElement('div');
  tagline.className = 'dw-finger-tagline';
  tagline.textContent = schema.tagline || '';
  details.appendChild(tagline);

  const badges = Array.isArray(schema.badges) ? schema.badges.filter(Boolean) : [];
  if (badges.length) {
    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'dw-finger-badges';
    for (const badgeText of badges) {
      const badge = document.createElement('span');
      const badgeSlug = String(badgeText).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      badge.className = 'dw-finger-badge' + (badgeSlug ? ' dw-finger-badge-' + badgeSlug : '');
      badge.textContent = String(badgeText);
      badgeWrap.appendChild(badge);
    }
    details.appendChild(badgeWrap);
  }

  const lines = Array.isArray(schema.lines) ? schema.lines : [];
  for (const lineText of lines) {
    const line = document.createElement('div');
    if (!lineText) {
      line.className = 'dw-finger-line dw-finger-line-spacer';
      details.appendChild(line);
      continue;
    }

    const text = String(lineText);
    const colonIndex = text.indexOf(':');
    const isStatus = text.startsWith('Account ') || text.startsWith('[...');
    line.className = isStatus ? 'dw-finger-line dw-finger-line-status' : 'dw-finger-line';

    if (colonIndex > 0 && colonIndex <= 24) {
      const label = document.createElement('span');
      label.className = 'dw-finger-label';
      label.textContent = text.slice(0, colonIndex);
      const value = document.createElement('span');
      value.className = 'dw-finger-value';
      value.textContent = text.slice(colonIndex + 1).trim();
      line.appendChild(label);
      line.appendChild(value);
    } else {
      const value = document.createElement('span');
      value.className = 'dw-finger-value dw-finger-value-full';
      value.textContent = text;
      line.appendChild(value);
    }
    details.appendChild(line);
  }

  el.appendChild(avatarButton);
  el.appendChild(details);
  return el;
}

function renderPlayerRow(schema) {
  const fallbackAvatar = schema.fallback_avatar || '/assets/avatar-ghost.svg';
  const el = document.createElement('div');
  el.className = 'dw-player-row';
  setAttr(el, schema);

  const avatarButton = document.createElement('button');
  avatarButton.type = 'button';
  avatarButton.className = 'dw-player-row-avatar-button';
  avatarButton.title = 'View avatar';
  avatarButton.setAttribute('aria-label', 'View avatar for ' + (schema.name || 'player'));

  const img = document.createElement('img');
  img.className = 'dw-player-row-avatar';
  img.src = schema.avatar || fallbackAvatar;
  img.alt = schema.name ? schema.name + ' avatar' : 'Player avatar';
  img.draggable = false;
  img.addEventListener('error', () => {
    if (img.src !== fallbackAvatar) img.src = fallbackAvatar;
  });
  avatarButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.dispatchEvent(new CustomEvent('dw:avatarZoom', {
      detail: {
        src: img.currentSrc || img.src || fallbackAvatar,
        fallback: fallbackAvatar,
        alt: img.alt,
        name: schema.name || 'Player'
      }
    }));
  });
  avatarButton.appendChild(img);

  const overlay = document.createElement('div');
  overlay.className = 'dw-player-row-avatar-overlay';

  const overlayName = document.createElement('div');
  overlayName.className = 'dw-player-row-avatar-name';
  overlayName.textContent = schema.name || 'A hidden player';
  overlay.appendChild(overlayName);

  const overlayLevel = document.createElement('div');
  overlayLevel.className = 'dw-player-row-avatar-level';
  overlayLevel.textContent = schema.level ? 'Level ' + schema.level : '';
  overlay.appendChild(overlayLevel);

  avatarButton.appendChild(overlay);

  const body = document.createElement('div');
  body.className = 'dw-player-row-body';

  const line1 = document.createElement('div');
  line1.className = 'dw-player-row-line dw-player-row-line1';

  const level = document.createElement('span');
  level.className = 'dw-player-row-level';
  level.textContent = schema.level || '?';
  if (schema.race_color) level.style.borderColor = schema.race_color;
  line1.appendChild(level);

  const name = document.createElement('span');
  name.className = 'dw-player-row-name';
  name.textContent = schema.name || 'A hidden player';
  line1.appendChild(name);

  if (schema.achievement_title) {
    const achievement = document.createElement('span');
    achievement.className = 'dw-player-row-achievement';
    achievement.textContent = schema.achievement_title;
    line1.appendChild(achievement);
  }

  const line2 = document.createElement('div');
  line2.className = 'dw-player-row-line dw-player-row-line2';

  const title = document.createElement('span');
  title.className = 'dw-player-row-title';
  title.textContent = schema.title || '';
  line2.appendChild(title);

  if (schema.designation) {
    const designation = document.createElement('span');
    designation.className = 'dw-player-row-designation';
    designation.textContent = schema.designation;
    line2.appendChild(designation);
  }

  const flags = []
    .concat(Array.isArray(schema.badges) ? schema.badges : [])
    .concat(Array.isArray(schema.staff_notes) ? schema.staff_notes : []);
  if (flags.length) {
    const flagWrap = document.createElement('div');
    flagWrap.className = 'dw-player-row-flags';
    for (const flagText of flags) {
      if (!flagText) continue;
      const flag = document.createElement('span');
      flag.className = 'dw-player-row-flag';
      flag.textContent = String(flagText);
      flagWrap.appendChild(flag);
    }
    line2.appendChild(flagWrap);
  }

  body.appendChild(line1);
  body.appendChild(line2);

  const tooltip = document.createElement('div');
  tooltip.className = 'dw-player-row-tooltip';
  tooltip.setAttribute('role', 'tooltip');

  const tooltipName = document.createElement('div');
  tooltipName.className = 'dw-player-tooltip-name';
  tooltipName.textContent = schema.name || 'A hidden player';
  tooltip.appendChild(tooltipName);

  const detailRows = [
    ['Level', schema.level || '?'],
    ['Race', schema.race || 'unknown'],
    ['Title', schema.title || ''],
    ['Type', schema.designation || '']
  ];
  if (schema.achievement_title) detailRows.push(['Achievement', schema.achievement_title]);

  for (const [labelText, valueText] of detailRows) {
    if (!valueText) continue;
    const detail = document.createElement('div');
    detail.className = 'dw-player-tooltip-detail';
    const label = document.createElement('span');
    label.className = 'dw-player-tooltip-label';
    label.textContent = labelText;
    const value = document.createElement('span');
    value.className = 'dw-player-tooltip-value';
    value.textContent = String(valueText);
    detail.appendChild(label);
    detail.appendChild(value);
    tooltip.appendChild(detail);
  }

  if (flags.length) {
    const flagWrap = document.createElement('div');
    flagWrap.className = 'dw-player-tooltip-flags';
    for (const flagText of flags) {
      if (!flagText) continue;
      const flag = document.createElement('span');
      flag.className = 'dw-player-row-flag';
      flag.textContent = String(flagText);
      flagWrap.appendChild(flag);
    }
    tooltip.appendChild(flagWrap);
  }

  const positionTooltip = () => positionPlayerTooltip(el, tooltip);
  el.addEventListener('mouseenter', positionTooltip);
  avatarButton.addEventListener('focus', positionTooltip);

  el.appendChild(avatarButton);
  el.appendChild(body);
  el.appendChild(tooltip);
  return el;
}

function positionPlayerTooltip(row, tooltip) {
  if (!row || !tooltip) return;

  const boundary = row.closest('.dw-modal-body') || row.closest('.dw-modal') || document.documentElement;
  const boundaryRect = boundary.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const margin = 8;
  const tooltipWidth = tooltip.offsetWidth || 260;
  let left = rowRect.left + (rowRect.width / 2) - (tooltipWidth / 2);
  const minLeft = boundaryRect.left + margin;
  const maxLeft = boundaryRect.right - tooltipWidth - margin;

  if (maxLeft >= minLeft) {
    left = Math.max(minLeft, Math.min(left, maxLeft));
  } else {
    left = minLeft;
  }

  tooltip.style.setProperty('--dw-player-tooltip-left', (left - rowRect.left) + 'px');
}

// ── Input elements ──────────────────────────────────────────────────
function renderInput(schema, buttonHandler) {
  switch (schema.type) {
    case 'text': return renderTextInput(schema);
    case 'password': return renderPasswordInput(schema);
    case 'number': return renderNumberInput(schema);
    case 'select': return renderSelectInput(schema);
    case 'checkbox': return renderCheckboxInput(schema);
    case 'button': return renderButtonInput(schema, buttonHandler);
    case 'hidden': return renderHiddenInput(schema);
    default: {
      const el = document.createElement('span');
      el.textContent = '[' + schema.type + ']';
      return el;
    }
  }
}

function wrapField(label, input, schema) {
  const wrap = document.createElement('div');
  wrap.className = 'dw-field';
  setAttr(wrap, schema);
  if (label) {
    const lbl = document.createElement('label');
    lbl.className = 'dw-label';
    lbl.textContent = label;
    wrap.appendChild(lbl);
  }
  wrap.appendChild(input);
  return wrap;
}

function renderTextInput(schema) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dw-input';
  if (schema.value !== undefined) input.value = String(schema.value);
  if (schema.placeholder) input.placeholder = schema.placeholder;
  if (schema.id) input.setAttribute('data-dw-input', schema.id);
  return wrapField(schema.label, input, schema);
}

function renderPasswordInput(schema) {
  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'dw-input';
  if (schema.value !== undefined) input.value = String(schema.value);
  if (schema.placeholder) input.placeholder = schema.placeholder;
  if (schema.id) input.setAttribute('data-dw-input', schema.id);
  return wrapField(schema.label, input, schema);
}

function renderNumberInput(schema) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'dw-input';
  if (schema.value !== undefined) input.value = String(schema.value);
  if (schema.min !== undefined) input.min = String(schema.min);
  if (schema.max !== undefined) input.max = String(schema.max);
  if (schema.step !== undefined) input.step = String(schema.step);
  if (schema.id) input.setAttribute('data-dw-input', schema.id);
  return wrapField(schema.label, input, schema);
}

function renderSelectInput(schema) {
  const sel = document.createElement('select');
  sel.className = 'dw-select';
  if (Array.isArray(schema.options)) {
    for (const opt of schema.options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label || opt.value;
      if (schema.value !== undefined && String(opt.value) === String(schema.value)) {
        o.selected = true;
      }
      sel.appendChild(o);
    }
  }
  if (schema.id) sel.setAttribute('data-dw-input', schema.id);
  return wrapField(schema.label, sel, schema);
}

function renderCheckboxInput(schema) {
  const wrap = document.createElement('div');
  wrap.className = 'dw-field dw-checkbox-field';
  setAttr(wrap, schema);
  const label = document.createElement('label');
  label.className = 'dw-checkbox-label';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'dw-checkbox';
  if (schema.checked) input.checked = true;
  if (schema.id) input.setAttribute('data-dw-input', schema.id);
  label.appendChild(input);
  label.appendChild(document.createTextNode(' ' + (schema.label || '')));
  wrap.appendChild(label);
  return wrap;
}

function renderButtonInput(schema, buttonHandler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dw-button';
  btn.textContent = schema.text || schema.label || 'Button';
  setAttr(btn, schema);
  if (schema.action === 'submit') btn.classList.add('dw-button-primary');
  else if (schema.action === 'close') btn.classList.add('dw-button-secondary');
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    if (buttonHandler) buttonHandler(schema.id, schema.action || 'action');
  });
  return btn;
}

function renderHiddenInput(schema) {
  const input = document.createElement('input');
  input.type = 'hidden';
  if (schema.value !== undefined) input.value = String(schema.value);
  if (schema.id) input.setAttribute('data-dw-input', schema.id);
  return input;
}

// ── Form data collection ────────────────────────────────────────────
export function collectFormData(container) {
  const data = {};
  const inputs = container.querySelectorAll('[data-dw-input]');
  for (const input of inputs) {
    const id = input.getAttribute('data-dw-input');
    if (input.type === 'checkbox') {
      data[id] = input.checked;
    } else if (input.type === 'number') {
      data[id] = input.valueAsNumber;
    } else {
      data[id] = input.value;
    }
  }
  return data;
}

// ── Element updates ─────────────────────────────────────────────────
export function updateElements(container, updates) {
  if (!Array.isArray(updates)) return;
  for (const upd of updates) {
    if (!upd.id) continue;
    const el = container.querySelector('[data-dw-id="' + upd.id + '"]');
    if (!el) continue;

    // Style updates
    if (upd.style) applyStyle(el, upd.style);

    // Text content (headings, paragraphs, text, buttons)
    if (upd.text !== undefined) {
      el.textContent = upd.text;
    }

    // Progress bar
    if (upd.value !== undefined && el.classList.contains('dw-progress')) {
      const fill = el.querySelector('.dw-progress-fill');
      if (fill) fill.style.width = Math.min(Math.max(upd.value, 0), 100) + '%';
    }
    if (upd.color !== undefined) {
      const fill = el.querySelector('.dw-progress-fill');
      if (fill) fill.style.backgroundColor = upd.color;
    }
    if (upd.label !== undefined) {
      const lbl = el.querySelector('.dw-progress-label');
      if (lbl) lbl.textContent = upd.label;
    }

    // Image updates
    if (upd.src !== undefined && el.classList.contains('dw-image')) {
      let img = el.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.draggable = false;
        img.addEventListener('load', () => el.classList.add('dw-image-loaded'));
        img.addEventListener('error', () => el.classList.add('dw-image-error'));
        el.appendChild(img);
      }
      img.src = upd.src;
      if (upd.alt) img.alt = upd.alt;
      const spinner = el.querySelector('.dw-image-loading');
      if (spinner) spinner.remove();
    }

    if (upd.src !== undefined && el.classList.contains('dw-youtube-embed')) {
      let iframe = el.querySelector('iframe');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.loading = 'lazy';
        iframe.allowFullscreen = true;
        iframe.setAttribute('allow',
          'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
        iframe.setAttribute('referrerpolicy', 'origin-when-cross-origin');
        iframe.setAttribute('sandbox',
          'allow-scripts allow-same-origin allow-presentation allow-popups allow-forms');
        el.insertBefore(iframe, el.firstChild);
      }
      iframe.src = upd.src;
      if (upd.title) iframe.title = upd.title;
    }

    // Input value updates
    const input = el.querySelector('[data-dw-input="' + upd.id + '"]')
                || container.querySelector('[data-dw-input="' + upd.id + '"]');
    if (input) {
      if (upd.value !== undefined) {
        if (input.type === 'checkbox') input.checked = !!upd.value;
        else input.value = String(upd.value);
      }
      if (upd.placeholder !== undefined) input.placeholder = upd.placeholder;
      if (upd.disabled !== undefined) input.disabled = upd.disabled;
    }

    // Select options update
    if (upd.options !== undefined && input && input.tagName === 'SELECT') {
      const curVal = input.value;
      input.innerHTML = '';
      for (const opt of upd.options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label || opt.value;
        input.appendChild(o);
      }
      input.value = curVal;
    }
  }
}
