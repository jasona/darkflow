import {
  EMOJI_ALIASES,
  findEmojiToken,
  getEmojiSuggestions,
  replaceEmojiAliases,
  replaceEmojiToken,
} from './emoji-manager.js';

let inputEl = null;
let pickerEl = null;
let activeToken = null;
let activeSuggestions = [];
let activeIndex = 0;
let isEnabled = () => true;
let activeDisposer = null;

function ensurePicker() {
  if (pickerEl) return pickerEl;

  pickerEl = document.createElement('div');
  pickerEl.id = 'emoji-picker';
  pickerEl.setAttribute('role', 'listbox');
  pickerEl.setAttribute('aria-label', 'Emoji suggestions');
  pickerEl.hidden = true;
  document.body.appendChild(pickerEl);
  return pickerEl;
}

function closeEmojiPicker() {
  activeToken = null;
  activeSuggestions = [];
  activeIndex = 0;
  if (pickerEl) pickerEl.hidden = true;
}

function positionPicker() {
  const rect = inputEl.getBoundingClientRect();
  const picker = ensurePicker();

  picker.style.left = Math.max(8, rect.left) + 'px';
  picker.style.bottom = Math.max(8, window.innerHeight - rect.top + 6) + 'px';
  picker.style.width = Math.min(Math.max(280, rect.width), 420) + 'px';
}

function renderPicker() {
  const picker = ensurePicker();
  picker.textContent = '';

  activeSuggestions.forEach((entry, index) => {
    const item = document.createElement('button');
    const emoji = document.createElement('span');
    const label = document.createElement('span');

    item.type = 'button';
    item.className = 'emoji-picker-item' + (index === activeIndex ? ' is-active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
    emoji.className = 'emoji-picker-symbol';
    label.className = 'emoji-picker-label';
    emoji.textContent = entry.emoji;
    label.textContent = entry.label;

    item.appendChild(emoji);
    item.appendChild(label);
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectEmoji(index);
    });
    picker.appendChild(item);
  });

  picker.hidden = activeSuggestions.length === 0;
}

function setInputValue(value, cursor) {
  inputEl.value = value;
  inputEl.setSelectionRange(cursor, cursor);
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceCompletedAliases() {
  const value = inputEl.value;
  const nextValue = replaceEmojiAliases(value);
  const cursor = inputEl.selectionStart == null ? value.length : inputEl.selectionStart;
  const delta = nextValue.length - value.length;

  if (nextValue === value) return false;
  inputEl.value = nextValue;
  inputEl.setSelectionRange(Math.max(0, cursor + delta), Math.max(0, cursor + delta));
  return true;
}

function updateEmojiPicker() {
  if (!isEnabled()) {
    closeEmojiPicker();
    return;
  }

  const value = inputEl.value;
  const cursor = inputEl.selectionStart == null ? value.length : inputEl.selectionStart;
  const token = findEmojiToken(value, cursor);

  if (replaceCompletedAliases()) {
    closeEmojiPicker();
    return;
  }

  if (!token) {
    closeEmojiPicker();
    return;
  }

  activeToken = token;
  activeSuggestions = getEmojiSuggestions(token.query);
  activeIndex = 0;

  if (!activeSuggestions.length) {
    closeEmojiPicker();
    return;
  }

  positionPicker();
  renderPicker();
}

function selectEmoji(index = activeIndex) {
  const entry = activeSuggestions[index];
  let nextValue;
  let nextCursor;

  if (!entry || !activeToken) return false;
  nextValue = replaceEmojiToken(inputEl.value, activeToken, entry.emoji, true);
  nextCursor = activeToken.start + entry.emoji.length + 1;
  setInputValue(nextValue, nextCursor);
  closeEmojiPicker();
  inputEl.focus();
  return true;
}

export function handleEmojiPickerKeydown(event) {
  if (!isEnabled()) {
    closeEmojiPicker();
    return false;
  }

  if (!pickerEl || pickerEl.hidden) return false;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndex = (activeIndex + 1) % activeSuggestions.length;
    renderPicker();
    return true;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex = (activeIndex - 1 + activeSuggestions.length) % activeSuggestions.length;
    renderPicker();
    return true;
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    return selectEmoji();
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeEmojiPicker();
    return true;
  }

  return false;
}

export function initEmojiPicker(input, options = {}, lifecycle = null) {
  if (activeDisposer) return activeDisposer;

  inputEl = input;
  isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;
  ensurePicker();

  const releases = [];
  let releaseBlurTimer = null;
  const listen = (target, type, listener) => {
    if (lifecycle) return lifecycle.listen(target, type, listener);
    target.addEventListener(type, listener);
    return () => target.removeEventListener(type, listener);
  };

  releases.push(listen(inputEl, 'input', updateEmojiPicker));
  releases.push(listen(inputEl, 'blur', () => {
    if (releaseBlurTimer) releaseBlurTimer();
    if (lifecycle) {
      releaseBlurTimer = lifecycle.setTimeout(() => {
        releaseBlurTimer = null;
        closeEmojiPicker();
      }, 120);
    } else {
      const timer = setTimeout(() => {
        releaseBlurTimer = null;
        closeEmojiPicker();
      }, 120);
      releaseBlurTimer = () => clearTimeout(timer);
    }
  }));
  releases.push(listen(window, 'resize', () => {
    if (pickerEl && !pickerEl.hidden) positionPicker();
  }));

  activeDisposer = () => {
    if (!activeDisposer) return;
    activeDisposer = null;
    if (releaseBlurTimer) releaseBlurTimer();
    releaseBlurTimer = null;
    for (const release of releases.toReversed()) release();
    closeEmojiPicker();
    if (pickerEl) pickerEl.remove();
    pickerEl = null;
    inputEl = null;
    isEnabled = () => true;
  };
  return activeDisposer;
}

export function disposeEmojiPicker() {
  if (activeDisposer) activeDisposer();
}

export { EMOJI_ALIASES, closeEmojiPicker, updateEmojiPicker };
