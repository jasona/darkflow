import { gmcp } from './gmcp.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';
import {
  detectChannelCommand,
  findMentionToken,
  getMentionContext as getMentionContextForChannels,
  getMentionSuggestions,
  normalizeChannelList,
  normalizeRoster,
} from './mention-utils.js';

let inputEl = null;
let pickerEl = null;
let activeToken = null;
let activeSuggestions = [];
let activeIndex = 0;
const DEFAULT_CHANNEL_NAMES = [
  'al',
  'arena',
  'auction',
  'awiz',
  'balance',
  'bard',
  'dragon',
  'druid',
  'elitepk',
  'faq',
  'fighter',
  'garou',
  'gossip',
  'imp',
  'kingdom',
  'mage',
  'mentor',
  'monk',
  'newbie',
  'ninja',
  'paladin',
  'party',
  'pk',
  'ranger',
  'rogue',
  'samurai',
  'shout',
  'super',
  'thief',
  'wiz',
  'wtp',
];
let channelNames = new Set(DEFAULT_CHANNEL_NAMES);
let roster = [];
let lastRosterRequestAt = 0;
let rosterRequestPending = false;
let rosterRequestTimer = null;
let lastContext = null;
let lastRosterResponseAt = 0;
let lastRosterResponseSize = null;
let lastRosterTimeoutAt = 0;
let rosterRequestCount = 0;
let rosterResponseCount = 0;
let rosterTimeoutCount = 0;
let lastRosterRequestSent = false;
const mentionController = {};

function ensurePicker() {
  if (pickerEl) return pickerEl;

  pickerEl = document.createElement('div');
  pickerEl.id = 'mention-picker';
  pickerEl.setAttribute('role', 'listbox');
  pickerEl.setAttribute('aria-label', 'Player mention suggestions');
  pickerEl.hidden = true;
  document.body.appendChild(pickerEl);
  return pickerEl;
}

function closeMentionPicker() {
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

function setInputValue(value, cursor) {
  inputEl.value = value;
  inputEl.setSelectionRange(cursor, cursor);
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderPicker() {
  const picker = ensurePicker();
  picker.textContent = '';

  if (rosterRequestPending && activeSuggestions.length === 0) {
    const item = document.createElement('div');

    item.className = 'mention-picker-item mention-picker-status';
    item.textContent = 'Loading players...';
    picker.appendChild(item);
    picker.hidden = false;
    return;
  }

  activeSuggestions.forEach((entry, index) => {
    const item = document.createElement('button');
    const name = document.createElement('span');
    const channel = document.createElement('span');

    item.type = 'button';
    item.className = 'mention-picker-item' + (index === activeIndex ? ' is-active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
    name.className = 'mention-picker-name';
    channel.className = 'mention-picker-channel';
    name.textContent = '@' + entry.displayName;
    channel.textContent = entry.channel;

    item.appendChild(name);
    item.appendChild(channel);
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectMention(index);
    });
    picker.appendChild(item);
  });

  picker.hidden = activeSuggestions.length === 0;
}

function getKnownChannels() {
  const names = new Set(channelNames);
  for (const entry of roster) {
    for (const channel of entry.channels) names.add(channel);
  }
  return names;
}

function getMentionContext(value, cursor, knownChannels = getKnownChannels()) {
  return getMentionContextForChannels(value, cursor, knownChannels);
}

function requestRosterRefresh() {
  const now = Date.now();

  if (now - lastRosterRequestAt < 1000) return;
  lastRosterRequestAt = now;
  rosterRequestCount += 1;
  rosterRequestPending = gmcp.requestChannelPlayers();
  lastRosterRequestSent = rosterRequestPending;
  if (rosterRequestTimer) rosterRequestTimer();
  if (rosterRequestPending) {
    rosterRequestTimer = mentionController._controllerLifecycle.setTimeout(() => {
      rosterRequestTimer = null;
      rosterRequestPending = false;
      lastRosterTimeoutAt = Date.now();
      rosterTimeoutCount += 1;
      updateMentionPicker({ refreshRoster: false });
    }, 2500);
  }
}

function updateMentionPicker(options = {}) {
  const value = inputEl.value;
  const cursor = inputEl.selectionStart == null ? value.length : inputEl.selectionStart;
  const context = getMentionContext(value, cursor);

  if (!context) {
    lastContext = null;
    closeMentionPicker();
    return;
  }

  lastContext = {
    channel: context.channel,
    query: context.token.query,
  };
  if (options.refreshRoster !== false) requestRosterRefresh();
  activeToken = context.token;
  activeSuggestions = getMentionSuggestions(roster, context.channel, context.token.query);
  activeIndex = 0;

  if (!activeSuggestions.length && !rosterRequestPending) {
    closeMentionPicker();
    return;
  }

  positionPicker();
  renderPicker();
}

function selectMention(index = activeIndex) {
  const entry = activeSuggestions[index];
  const value = inputEl.value;
  let nextValue;
  let nextCursor;

  if (!entry || !activeToken) return false;
  nextValue = value.slice(0, activeToken.start) + '@' + entry.displayName + ' ' + value.slice(activeToken.end);
  nextCursor = activeToken.start + entry.displayName.length + 2;
  setInputValue(nextValue, nextCursor);
  closeMentionPicker();
  inputEl.focus();
  return true;
}

export function handleMentionPickerKeydown(event) {
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
    return selectMention();
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeMentionPicker();
    return true;
  }

  return false;
}

export function initMentionPicker(input) {
  return installControllerLifecycle(mentionController, 'mention-picker', gmcp, (scopedGmcp, lifecycle) => {
    inputEl = input;
    ensurePicker();

    scopedGmcp.on('Comm.Channel.List', (data) => {
      channelNames = new Set(DEFAULT_CHANNEL_NAMES);
      for (const channel of normalizeChannelList(data)) channelNames.add(channel);
      updateMentionPicker({ refreshRoster: false });
    });
    scopedGmcp.on('Comm.Channel.Players', (data) => {
      rosterRequestPending = false;
      lastRosterResponseAt = Date.now();
      lastRosterResponseSize = Array.isArray(data) ? data.length : null;
      rosterResponseCount += 1;
      if (rosterRequestTimer) {
        rosterRequestTimer();
        rosterRequestTimer = null;
      }
      roster = normalizeRoster(data);
      updateMentionPicker({ refreshRoster: false });
    });

    lifecycle.listen(inputEl, 'input', updateMentionPicker);
    lifecycle.listen(inputEl, 'blur', () => lifecycle.setTimeout(closeMentionPicker, 120));
    lifecycle.listen(window, 'resize', () => {
      if (pickerEl && !pickerEl.hidden) positionPicker();
    });

    window.darkflowMentionDebug = () => ({
    channels: [...channelNames],
    roster,
    lastContext,
    activeSuggestions,
    activeToken,
    rosterRequestPending,
    lastRosterRequestAt,
    lastRosterRequestSent,
    lastRosterResponseAt,
    lastRosterResponseSize,
    lastRosterTimeoutAt,
    rosterRequestCount,
    rosterResponseCount,
    rosterTimeoutCount,
    pickerOpen: !!pickerEl && !pickerEl.hidden,
    testLine(value, cursor) {
      const text = String(value || '');
      const pos = cursor == null ? text.length : cursor;
      const context = getMentionContext(text, pos);
      return {
        context,
        suggestions: context
          ? getMentionSuggestions(roster, context.channel, context.token.query)
          : [],
      };
    },
    });
  }, () => {
    if (rosterRequestTimer) rosterRequestTimer();
    rosterRequestTimer = null;
    rosterRequestPending = false;
    closeMentionPicker();
    if (pickerEl) pickerEl.remove();
    pickerEl = null;
    inputEl = null;
    delete window.darkflowMentionDebug;
  });
}

export function disposeMentionPicker() {
  disposeControllerLifecycle(mentionController);
}

export { closeMentionPicker, updateMentionPicker };
export { detectChannelCommand, findMentionToken, getMentionContext, getMentionSuggestions };
