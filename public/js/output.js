import { state, dom } from './state.js';
import { parseAnsi, styleToElement } from './ansi.js';
import { highlightManager } from './highlight-manager.js';
import { triggerManager } from './trigger-manager.js';
import { aliasManager } from './alias-manager.js';
import { giphyManager } from './giphy-manager.js';
import { sendSocketPayload } from './connection.js';
import { trackCommand } from './map-data.js';
import {
  DEFAULT_OUTPUT_SCROLLBACK_PRESET,
  OUTPUT_OVERSCAN_LINES,
  OUTPUT_SCROLLBACK_PRESETS,
} from './constants.js';

const BOTTOM_THRESHOLD_PX = 5;
const DEFAULT_LINE_HEIGHT_PX = 23;
const DEFAULT_SPLIT_RATIO = 0.6;
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;
const INITIAL_SPLIT_HISTORY_OFFSET_RATIO = 0.18;
const MIN_INITIAL_SPLIT_HISTORY_LINES = 3;
const USER_SCROLL_INTENT_MS = 900;
const SETTINGS_STORAGE_KEY = 'darkwind-client-settings';
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const OSC8_DEBUG_URL = 'https://gist.github.com/jasona/a03aa3851dce07b5c701c70e19db28df';
const OSC8_DEBUG_PREFIX = 'https://gist.github.com/jasona/a03aa3851dce07b5c701c70e19db';

let isScrollLocked = false;
let isOutputPaused = false;
let isSplitActive = false;
let lineStore = [];
let nextLineId = 1;
let pendingLines = [];
let openOutputLine = null;
let frameScheduled = false;
let renderInvalidated = false;
let scrollbackLimit = OUTPUT_SCROLLBACK_PRESETS[DEFAULT_OUTPUT_SCROLLBACK_PRESET];
let estimatedLineHeight = DEFAULT_LINE_HEIGHT_PX;
let resizeObserver = null;
let suppressAutoPause = false;
let splitRatio = DEFAULT_SPLIT_RATIO;
let activeDividerPointerId = null;
let userScrollIntentUntil = 0;

const panes = {
  main: createPaneState(),
  history: createPaneState(),
  live: createPaneState(),
};

function createPaneState() {
  return {
    scrollEl: null,
    topSpacer: null,
    viewportEl: null,
    bottomSpacer: null,
    suppressScrollEvents: false,
    scrollSuppressionToken: 0,
  };
}

function escapeDebugText(text) {
  return String(text || '')
    .replace(/\x1b/g, '<ESC>')
    .replace(/\x07/g, '<BEL>')
    .replace(/\r/g, '<CR>')
    .replace(/\n/g, '<LF>\n')
    .replace(/\t/g, '<TAB>');
}

function shouldDebugOsc8(text) {
  const value = String(text || '');
  return value.includes(OSC8_DEBUG_URL) || value.includes(OSC8_DEBUG_PREFIX);
}

function debugOsc8Output(stage, payload) {
  try {
    // eslint-disable-next-line no-console
    console.debug('[osc8-gossip-debug]', stage, payload);
  } catch (error) {
    // Ignore console failures in embedded browsers.
  }
}

function getScrollbackBehavior() {
  return state.settings.scrollbackBehavior === 'split' ? 'split' : 'pause';
}

function isSplitModeEnabled() {
  return getScrollbackBehavior() === 'split';
}

function clampSplitRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, ratio));
}

function persistSplitRatio() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      scrollbackSplitRatio: splitRatio,
    }));
  } catch (error) {
    console.warn('Failed to persist split ratio', error);
  }
}

function syncOutputUi() {
  if (!dom.outputShell || !dom.outputPauseBtn || !dom.outputLiveBtn) return;
  dom.outputShell.classList.toggle('paused', isOutputPaused);
  dom.outputShell.classList.toggle('split-active', isSplitActive);
  dom.outputShell.style.setProperty('--output-split-ratio', String(splitRatio));
  dom.outputPauseBtn.setAttribute('aria-pressed', isOutputPaused ? 'true' : 'false');
  dom.outputPauseBtn.title = isOutputPaused ? 'Resume live terminal' : 'Pause live terminal';
  dom.outputLiveBtn.title = isSplitActive ? 'Return to live terminal' : 'Live terminal';
}

function initPane(pane, scrollEl) {
  pane.scrollEl = scrollEl;
  pane.scrollEl.textContent = '';

  pane.topSpacer = document.createElement('div');
  pane.topSpacer.className = 'output-spacer';

  pane.viewportEl = document.createElement('div');
  pane.viewportEl.className = 'output-viewport';

  pane.bottomSpacer = document.createElement('div');
  pane.bottomSpacer.className = 'output-spacer';

  pane.scrollEl.appendChild(pane.topSpacer);
  pane.scrollEl.appendChild(pane.viewportEl);
  pane.scrollEl.appendChild(pane.bottomSpacer);
}

function setPaneScrollTop(pane, value) {
  if (!pane.scrollEl) return;
  pane.suppressScrollEvents = true;
  pane.scrollSuppressionToken++;
  const token = pane.scrollSuppressionToken;
  pane.scrollEl.scrollTop = value;
  requestAnimationFrame(() => {
    if (pane.scrollSuppressionToken === token) {
      pane.suppressScrollEvents = false;
    }
  });
}

function snapPaneToBottom(pane) {
  if (!pane.scrollEl) return;
  setPaneScrollTop(pane, pane.scrollEl.scrollHeight);
}

function releaseAutoPauseSuppression() {
  requestAnimationFrame(() => {
    suppressAutoPause = false;
  });
}

function getActivePageScrollPane() {
  if (isSplitActive) return panes.history;
  return panes.main;
}

function markUserScrollIntent() {
  userScrollIntentUntil = Date.now() + USER_SCROLL_INTENT_MS;
}

function markScrollbarPointerIntent(event) {
  if (!(event instanceof PointerEvent) || !(event.currentTarget instanceof HTMLElement)) return;

  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const scrollbarWidth = Math.max(0, target.offsetWidth - target.clientWidth);
  const scrollEdgeWidth = Math.max(16, scrollbarWidth + 4);

  if (event.clientX >= rect.right - scrollEdgeWidth) {
    markUserScrollIntent();
  }
}

function hasUserScrollIntent() {
  return Date.now() <= userScrollIntentUntil;
}

function resumeOutputLive() {
  isOutputPaused = false;
  isScrollLocked = false;
  suppressAutoPause = true;
  syncOutputUi();

  if (pendingLines.length > 0) {
    lineStore.push(...pendingLines);
    pendingLines = [];
    evictOverflowLines();
    renderInvalidated = true;
    renderActivePanes();
  } else if (renderInvalidated || isSplitActive) {
    renderActivePanes();
  }

  snapPaneToBottom(panes.main);
  renderInvalidated = true;
  scheduleFrame();
  releaseAutoPauseSuppression();
}

function setOutputPaused(paused) {
  if (isOutputPaused === paused) {
    if (!paused) {
      resumeOutputLive();
    }
    return;
  }
  isOutputPaused = paused;

  if (paused) {
    isScrollLocked = true;
    syncOutputUi();
    return;
  }

  resumeOutputLive();
}

function getPresetLimit(preset) {
  return OUTPUT_SCROLLBACK_PRESETS[preset] || OUTPUT_SCROLLBACK_PRESETS[DEFAULT_OUTPUT_SCROLLBACK_PRESET];
}

function isPaneAtBottom(pane) {
  if (!pane.scrollEl) return true;
  return (pane.scrollEl.scrollHeight - pane.scrollEl.scrollTop - pane.scrollEl.clientHeight) < BOTTOM_THRESHOLD_PX;
}

function getLineHeight(line) {
  return line.height || estimatedLineHeight;
}

function getTotalContentHeight() {
  if (!lineStore.length) return 0;
  let total = 0;
  for (const line of lineStore) {
    total += getLineHeight(line);
  }
  return total;
}

function markAllLineHeightsDirty() {
  for (const line of lineStore) {
    line.height = 0;
  }
}

function createLine(text, cssClass, fragments) {
  return {
    id: nextLineId++,
    cssClass: cssClass || '',
    fragments,
    text,
    height: 0,
  };
}

function stylesEqual(a, b) {
  const left = a || {};
  const right = b || {};

  return left.bold === right.bold
    && left.underline === right.underline
    && left.inverse === right.inverse
    && left.blink === right.blink
    && colorsEqual(left.fg, right.fg)
    && colorsEqual(left.bg, right.bg);
}

function colorsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.type === b.type
    && a.index === b.index
    && a.r === b.r
    && a.g === b.g
    && a.b === b.b;
}

function appendFragment(target, fragment) {
  const text = String(fragment && fragment.text || '');
  if (!text) return;

  const next = {
    text,
    style: fragment.style || {},
  };
  if (fragment.href) next.href = fragment.href;

  const last = target[target.length - 1];
  if (last && last.href === next.href && stylesEqual(last.style, next.style)) {
    last.text += next.text;
    return;
  }

  target.push(next);
}

function createLineFromFragments(fragments, cssClass) {
  const lineFragments = [];
  let text = '';

  for (const fragment of fragments || []) {
    appendFragment(lineFragments, fragment);
    text += String(fragment && fragment.text || '');
  }

  return createLine(text, cssClass, lineFragments);
}

function splitFragmentsIntoLines(fragments) {
  const completedLines = [];
  let trailingLine = [];

  for (const frag of fragments) {
    const parts = String(frag.text || '').replace(/\r/g, '').split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) {
        appendFragment(trailingLine, { text: parts[i], style: frag.style, href: frag.href });
      }
      if (i < parts.length - 1) {
        completedLines.push(trailingLine);
        trailingLine = [];
      }
    }
  }

  return { completedLines, trailingLine };
}

function appendFragmentsToLine(line, fragments) {
  if (!line || !Array.isArray(fragments) || !fragments.length) return;
  for (const fragment of fragments) {
    appendFragment(line.fragments, fragment);
    line.text += String(fragment && fragment.text || '');
  }
  line.height = 0;
}

function syncLine(line, replacement) {
  if (!line || !replacement) return;
  line.text = replacement.text;
  line.cssClass = replacement.cssClass;
  line.fragments = replacement.fragments;
  line.height = 0;
}

function removeLine(line) {
  if (!line) return;
  const pendingIndex = pendingLines.indexOf(line);
  if (pendingIndex !== -1) {
    pendingLines.splice(pendingIndex, 1);
    return;
  }

  const storedIndex = lineStore.indexOf(line);
  if (storedIndex !== -1) {
    lineStore.splice(storedIndex, 1);
  }
}

function buildSingleTextLine(text, cssClass) {
  return createLine(text, cssClass, [{ text, style: {} }]);
}

function applyStyledTextAppearance(element, text, style) {
  const styled = styleToElement(text, style || {});
  if (!styled) return;

  if (styled.nodeType === Node.TEXT_NODE) {
    element.textContent = text;
    return;
  }

  if (styled.className) {
    element.className = element.className
      ? element.className + ' ' + styled.className
      : styled.className;
  }
  const inlineStyle = styled.getAttribute('style');
  if (inlineStyle) element.setAttribute('style', inlineStyle);
  element.textContent = text;
}

function appendStyledText(container, text, style) {
  if (!text) return;
  const el = styleToElement(text, style || {});
  if (el) container.appendChild(el);
}

function createReplayLink(text, style, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'output-inline-link giphy-replay-link';
  button.title = 'Replay this GIF';
  applyStyledTextAppearance(button, text, style);
  button.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function createUrlLink(text, style, href) {
  const link = document.createElement('a');
  link.className = 'output-inline-link terminal-url-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  applyStyledTextAppearance(link, text, style);
  link.addEventListener('click', function(event) {
    event.stopPropagation();
  });
  return link;
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

function appendFragmentWithLinks(container, text, style) {
  const value = String(text || '');
  if (!value) return;

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

    container.appendChild(createUrlLink(trimmed.url, style, trimmed.url));
    if (trimmed.trailing) {
      appendStyledText(container, trimmed.trailing, style);
    }

    lastIndex = start + matched.length;
  }

  if (lastIndex < value.length) {
    appendStyledText(container, value.slice(lastIndex), style);
  }
}

function createLineElement(line) {
  const div = document.createElement('div');
  div.className = 'output-line' + (line.cssClass ? ' ' + line.cssClass : '');
  div.setAttribute('data-line-id', String(line.id));

  if (line.fragments.length === 0 || line.text === '') {
    div.appendChild(document.createTextNode('\u200B'));
    return div;
  }

  if (line.giphyReplay) {
    const { parts, replay } = line.giphyReplay;
    for (const part of parts) {
      if (part.type === 'link') {
        div.appendChild(createReplayLink(part.text, part.style, () => giphyManager.replay(replay)));
        continue;
      }
      if (part.href) {
        div.appendChild(createUrlLink(part.text, part.style, part.href));
        continue;
      }
      appendFragmentWithLinks(div, part.text, part.style);
    }
    return div;
  }

  for (const frag of line.fragments) {
    if (frag.href) {
      div.appendChild(createUrlLink(frag.text, frag.style, frag.href));
      continue;
    }
    appendFragmentWithLinks(div, frag.text, frag.style);
  }

  return div;
}

function attachGiphyReplay(line) {
  let replay;
  let marker;
  let phraseStart;
  let phraseEnd;
  let offset;
  let parts;

  if (!line || !Array.isArray(line.fragments) || !line.fragments.length) return line;

  replay = giphyManager.findReplayForLine(line.text);
  if (!replay) return line;

  marker = '"' + replay.phrase + '"';
  phraseStart = line.text.indexOf(marker);
  if (phraseStart < 0) return line;

  phraseEnd = phraseStart + marker.length;
  offset = 0;
  parts = [];

  for (const fragment of line.fragments) {
    const fragmentText = String(fragment.text || '');
    const fragmentStart = offset;
    const fragmentEnd = fragmentStart + fragmentText.length;
    offset = fragmentEnd;

    if (!fragmentText) continue;

    if (fragmentEnd <= phraseStart || fragmentStart >= phraseEnd) {
      parts.push({
        type: 'text',
        text: fragmentText,
        style: fragment.style || {},
        href: fragment.href,
      });
      continue;
    }

    const localStart = Math.max(0, phraseStart - fragmentStart);
    const localEnd = Math.min(fragmentText.length, phraseEnd - fragmentStart);

    if (localStart > 0) {
      parts.push({
        type: 'text',
        text: fragmentText.slice(0, localStart),
        style: fragment.style || {},
        href: fragment.href,
      });
    }

    if (localEnd > localStart) {
      parts.push({
        type: 'link',
        text: fragmentText.slice(localStart, localEnd),
        style: fragment.style || {},
      });
    }

    if (localEnd < fragmentText.length) {
      parts.push({
        type: 'text',
        text: fragmentText.slice(localEnd),
        style: fragment.style || {},
        href: fragment.href,
      });
    }
  }

  line.giphyReplay = {
    parts,
    replay,
  };
  return line;
}

function scheduleFrame() {
  if (frameScheduled) return;
  frameScheduled = true;
  requestAnimationFrame(flushAndRender);
}

function invalidateRender() {
  renderInvalidated = true;
  scheduleFrame();
}

function evictOverflowLines() {
  if (lineStore.length <= scrollbackLimit) return 0;

  const removeCount = lineStore.length - scrollbackLimit;
  let removedHeight = 0;
  for (let i = 0; i < removeCount; i++) {
    removedHeight += getLineHeight(lineStore[i]);
  }

  lineStore = lineStore.slice(removeCount);
  return removedHeight;
}

function getPrefixHeights() {
  const prefix = new Array(lineStore.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < lineStore.length; i++) {
    prefix[i + 1] = prefix[i] + getLineHeight(lineStore[i]);
  }
  return prefix;
}

function findStartIndex(prefix, scrollTop) {
  let low = 0;
  let high = lineStore.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (prefix[mid + 1] <= scrollTop) low = mid + 1;
    else high = mid;
  }

  return Math.min(low, Math.max(0, lineStore.length - 1));
}

function findEndIndex(prefix, endOffset, startIndex) {
  let endIndex = startIndex;
  while (endIndex < lineStore.length && prefix[endIndex] < endOffset) {
    endIndex++;
  }
  return Math.max(endIndex, startIndex + 1);
}

function measureEstimatedLineHeight() {
  const probeHost = panes.main.viewportEl || panes.history.viewportEl || panes.live.viewportEl;
  if (!probeHost) return;

  const probe = document.createElement('div');
  probe.className = 'output-line';
  probe.style.visibility = 'hidden';
  probe.textContent = 'M';
  probeHost.appendChild(probe);

  const measured = probe.getBoundingClientRect().height;
  probe.remove();

  if (measured > 0) {
    estimatedLineHeight = measured;
  }
}

function renderPane(pane) {
  if (!pane.topSpacer || !pane.viewportEl || !pane.bottomSpacer || !pane.scrollEl) return;

  if (lineStore.length === 0) {
    pane.topSpacer.style.height = '0px';
    pane.bottomSpacer.style.height = '0px';
    pane.viewportEl.textContent = '';
    return;
  }

  const prefix = getPrefixHeights();
  const totalHeight = prefix[prefix.length - 1];
  const scrollTop = pane.scrollEl.scrollTop;
  const viewportHeight = pane.scrollEl.clientHeight || 0;
  const visibleBottom = scrollTop + viewportHeight;

  const visibleStart = findStartIndex(prefix, scrollTop);
  const visibleEnd = findEndIndex(prefix, visibleBottom, visibleStart);
  const renderStart = Math.max(0, visibleStart - OUTPUT_OVERSCAN_LINES);
  const renderEnd = Math.min(lineStore.length, visibleEnd + OUTPUT_OVERSCAN_LINES);
  const anchorIndex = visibleStart;
  const anchorOffset = scrollTop - prefix[anchorIndex];

  pane.topSpacer.style.height = prefix[renderStart] + 'px';
  pane.bottomSpacer.style.height = Math.max(0, totalHeight - prefix[renderEnd]) + 'px';

  const frag = document.createDocumentFragment();
  const mounted = [];

  for (let i = renderStart; i < renderEnd; i++) {
    const line = lineStore[i];
    const el = createLineElement(line);
    mounted.push([line, el]);
    frag.appendChild(el);
  }

  pane.viewportEl.replaceChildren(frag);

  let heightChanged = false;
  for (const [line, el] of mounted) {
    const measured = Math.ceil(el.getBoundingClientRect().height);
    if (measured > 0 && measured !== line.height) {
      line.height = measured;
      heightChanged = true;
    }
  }

  if (heightChanged) {
    const nextPrefix = getPrefixHeights();
    const anchoredScrollTop = nextPrefix[anchorIndex] + anchorOffset;
    setPaneScrollTop(pane, Math.max(0, anchoredScrollTop));
    renderInvalidated = true;
    scheduleFrame();
  }
}

function renderActivePanes() {
  renderInvalidated = false;
  if (isSplitActive) {
    renderPane(panes.history);
    renderPane(panes.live);
    return;
  }
  renderPane(panes.main);
}

function applyRemovedHeightAfterPrune(pane, removedHeight) {
  if (!pane.scrollEl || removedHeight <= 0) return;
  if (isPaneAtBottom(pane)) return;
  setPaneScrollTop(pane, Math.max(0, pane.scrollEl.scrollTop - removedHeight));
}

function getInitialSplitHistoryScrollTop() {
  const totalHeight = getTotalContentHeight();
  if (totalHeight <= 0 || !panes.history.scrollEl) return 0;

  const viewportHeight = panes.history.scrollEl.clientHeight
    || Math.max(0, (dom.outputShell ? dom.outputShell.clientHeight * splitRatio : 0) - 5);
  const initialOffset = Math.max(
    estimatedLineHeight * MIN_INITIAL_SPLIT_HISTORY_LINES,
    viewportHeight * INITIAL_SPLIT_HISTORY_OFFSET_RATIO
  );
  const liveBottomScrollTop = Math.max(0, totalHeight - viewportHeight);
  return Math.max(0, liveBottomScrollTop - initialOffset);
}

function activateSplitView() {
  if (isSplitActive || !isSplitModeEnabled()) return;
  isOutputPaused = false;
  isScrollLocked = false;
  isSplitActive = true;
  syncOutputUi();
  setPaneScrollTop(panes.history, getInitialSplitHistoryScrollTop());
  snapPaneToBottom(panes.live);
  renderInvalidated = true;
  scheduleFrame();
}

function deactivateSplitView() {
  if (!isSplitActive) return;
  isSplitActive = false;
  syncOutputUi();
  renderInvalidated = true;
  scheduleFrame();
  requestAnimationFrame(() => {
    snapPaneToBottom(panes.main);
  });
}

export function exitSplitScrollback() {
  if (!isSplitActive) return false;
  deactivateSplitView();
  return true;
}

export function resumeOutputForManualCommand() {
  if (isOutputPaused && !isSplitActive) {
    setOutputPaused(false);
  }
}

function handleMainScroll() {
  if (panes.main.suppressScrollEvents) return;
  const atBottom = isPaneAtBottom(panes.main);
  isScrollLocked = !atBottom;
  const userScrollIntent = hasUserScrollIntent();

  if (isSplitModeEnabled()) {
    if (!atBottom && !suppressAutoPause && userScrollIntent) {
      activateSplitView();
    } else {
      invalidateRender();
    }
    return;
  }

  if (atBottom && isOutputPaused) {
    setOutputPaused(false);
    return;
  }
  if (!atBottom && !suppressAutoPause && userScrollIntent) {
    setOutputPaused(true);
  }
  invalidateRender();
}

function handleHistoryScroll() {
  if (panes.history.suppressScrollEvents || !isSplitActive) return;
  if (isPaneAtBottom(panes.history)) {
    deactivateSplitView();
    return;
  }
  invalidateRender();
}

function handleLiveScroll() {
  if (panes.live.suppressScrollEvents || !isSplitActive) return;
  if (!isPaneAtBottom(panes.live)) {
    snapPaneToBottom(panes.live);
  }
  invalidateRender();
}

function beginDividerDrag(event) {
  if (!(event instanceof PointerEvent) || !dom.outputDivider) return;
  activeDividerPointerId = event.pointerId;
  dom.outputDivider.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function updateDividerDrag(event) {
  if (activeDividerPointerId == null || event.pointerId !== activeDividerPointerId) return;
  if (!dom.outputShell) return;

  const rect = dom.outputShell.getBoundingClientRect();
  const availableHeight = rect.height - 10;
  if (availableHeight <= 0) return;

  splitRatio = clampSplitRatio((event.clientY - rect.top) / availableHeight);
  state.settings.scrollbackSplitRatio = splitRatio;
  syncOutputUi();
  renderInvalidated = true;
  scheduleFrame();
}

function endDividerDrag(event) {
  if (activeDividerPointerId == null) return;
  if (event && event.pointerId != null && event.pointerId !== activeDividerPointerId) return;
  if (dom.outputDivider) {
    try {
      dom.outputDivider.releasePointerCapture(activeDividerPointerId);
    } catch (error) {
      void error;
    }
  }
  activeDividerPointerId = null;
  persistSplitRatio();
}

function flushAndRender() {
  frameScheduled = false;

  if (isOutputPaused && !isSplitActive) {
    if (renderInvalidated) {
      renderActivePanes();
    }
    return;
  }

  if (pendingLines.length > 0) {
    const shouldStickToMainBottom = !isScrollLocked || isPaneAtBottom(panes.main);
    const historyWasAtBottom = isSplitActive ? isPaneAtBottom(panes.history) : false;

    lineStore.push(...pendingLines);
    pendingLines = [];

    const removedHeight = evictOverflowLines();
    applyRemovedHeightAfterPrune(panes.main, removedHeight);
    applyRemovedHeightAfterPrune(panes.history, removedHeight);
    applyRemovedHeightAfterPrune(panes.live, removedHeight);

    renderInvalidated = true;
    renderActivePanes();

    if (isSplitActive) {
      snapPaneToBottom(panes.live);
      if (historyWasAtBottom) {
        deactivateSplitView();
      }
    } else if (shouldStickToMainBottom) {
      snapPaneToBottom(panes.main);
      isScrollLocked = false;
    }
  } else if (renderInvalidated) {
    renderActivePanes();
  }
}

function queueLines(lines) {
  if (!lines.length) return;
  pendingLines.push(...lines);
  scheduleFrame();
}

function sendTriggerCommand(text) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;

  trackCommand(text);
  if (!sendSocketPayload(text, {
    kind: 'command',
    size: text.length,
    preview: text.slice(0, 80),
  })) {
    return false;
  }
  state.bytesSent += text.length;
  return true;
}

function executeTriggerMatches(matches, scopeKey) {
  if (!Array.isArray(matches) || !matches.length) return;

  for (const match of matches) {
    for (const step of match.trigger.steps || []) {
      const variables = aliasManager.getScopeSnapshot(scopeKey).variables;
      const resolved = aliasManager.resolveTemplate(step.template, {
        args: match.captures,
        remainder: match.fullMatch,
        variables,
      });

      if ((step.type === 'send_command' || step.type === 'set_variable') && resolved.missingVariables.length) {
        appendSystemMessage(
          'Trigger: Missing variable'
          + (resolved.missingVariables.length === 1 ? '' : 's')
          + ' ' + resolved.missingVariables.map((name) => '$' + name).join(', ')
          + ' in pattern "' + match.trigger.pattern + '".'
        );
        continue;
      }

      if (step.type === 'set_variable') {
        aliasManager.setVariable(step.name, resolved.text, scopeKey);
        continue;
      }

      if (step.type === 'show_message') {
        appendSystemMessage(resolved.text);
        continue;
      }

      const command = resolved.text.trim();
      if (!command) continue;
      if (!sendTriggerCommand(command)) {
        appendSystemMessage('Trigger: Unable to send "' + command + '" because you are not connected.');
      }
    }
  }
}

export function initOutput() {
  initPane(panes.main, dom.output);
  initPane(panes.history, dom.outputHistory);
  initPane(panes.live, dom.outputLive);
  syncOutputUi();
  measureEstimatedLineHeight();

  dom.output.addEventListener('wheel', markUserScrollIntent, { passive: true });
  dom.output.addEventListener('touchstart', markUserScrollIntent, { passive: true });
  dom.output.addEventListener('pointerdown', markScrollbarPointerIntent);
  dom.outputHistory.addEventListener('wheel', markUserScrollIntent, { passive: true });
  dom.outputHistory.addEventListener('touchstart', markUserScrollIntent, { passive: true });
  dom.outputHistory.addEventListener('pointerdown', markScrollbarPointerIntent);

  dom.output.addEventListener('scroll', handleMainScroll);
  dom.outputHistory.addEventListener('scroll', handleHistoryScroll);
  dom.outputLive.addEventListener('scroll', handleLiveScroll);

  if (dom.outputPauseBtn) {
    dom.outputPauseBtn.addEventListener('click', function() {
      if (isSplitActive) {
        deactivateSplitView();
        return;
      }
      if (!isOutputPaused) {
        setOutputPaused(true);
        return;
      }
      setOutputPaused(false);
    });
  }

  if (dom.outputLiveBtn) {
    dom.outputLiveBtn.addEventListener('click', function() {
      deactivateSplitView();
    });
  }

  if (dom.outputDivider) {
    dom.outputDivider.addEventListener('pointerdown', beginDividerDrag);
    window.addEventListener('pointermove', updateDividerDrag);
    window.addEventListener('pointerup', endDividerDrag);
    window.addEventListener('pointercancel', endDividerDrag);
  }

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      measureEstimatedLineHeight();
      markAllLineHeightsDirty();
      invalidateRender();
    });
    resizeObserver.observe(dom.outputShell);
  } else {
    window.addEventListener('resize', function() {
      measureEstimatedLineHeight();
      markAllLineHeightsDirty();
      invalidateRender();
    });
  }
}

export function setOutputScrollbackPreset(preset) {
  scrollbackLimit = getPresetLimit(preset);

  if (lineStore.length > scrollbackLimit) {
    const removedHeight = evictOverflowLines();
    applyRemovedHeightAfterPrune(panes.main, removedHeight);
    applyRemovedHeightAfterPrune(panes.history, removedHeight);
    applyRemovedHeightAfterPrune(panes.live, removedHeight);
  }

  invalidateRender();
}

export function setOutputScrollbackBehavior(behavior) {
  state.settings.scrollbackBehavior = behavior === 'split' ? 'split' : 'pause';
  if (!isSplitModeEnabled() && isSplitActive) {
    deactivateSplitView();
  }
  if (isSplitModeEnabled() && isOutputPaused) {
    setOutputPaused(false);
  }
  syncOutputUi();
  invalidateRender();
}

export function setOutputSplitRatio(value) {
  splitRatio = clampSplitRatio(value);
  state.settings.scrollbackSplitRatio = splitRatio;
  syncOutputUi();
  invalidateRender();
}

export function scrollActiveOutputByPage(multiplier) {
  const pane = getActivePageScrollPane();
  if (!pane.scrollEl) return;
  markUserScrollIntent();
  pane.scrollEl.scrollBy(0, pane.scrollEl.clientHeight * multiplier);
}

export function appendOutput(text, cssClass) {
  if (shouldDebugOsc8(text)) {
    debugOsc8Output('appendOutput raw', escapeDebugText(text));
  }
  const fragments = parseAnsi(text);
  if (shouldDebugOsc8(text)) {
    debugOsc8Output('parseAnsi fragments', fragments.map((fragment) => ({
      text: escapeDebugText(fragment.text),
      href: fragment.href || null,
      style: fragment.style || {},
    })));
  }
  const { completedLines, trailingLine } = splitFragmentsIntoLines(fragments);
  if (shouldDebugOsc8(text)) {
    debugOsc8Output('splitFragmentsIntoLines lines', completedLines.map((lineFragments) => ({
      text: escapeDebugText(lineFragments.map((fragment) => fragment.text).join('')),
      fragments: lineFragments.map((fragment) => ({
        text: escapeDebugText(fragment.text),
        href: fragment.href || null,
        style: fragment.style || {},
      })),
    })));
  }
  const scopeKey = triggerManager.getActiveScopeKey();
  const visibleLines = [];

  for (const lineFragments of completedLines) {
    const reusedOpenLine = Boolean(openOutputLine);
    const line = openOutputLine || createLineFromFragments(lineFragments, cssClass);
    if (reusedOpenLine) {
      appendFragmentsToLine(line, lineFragments);
      openOutputLine = null;
    }
    attachGiphyReplay(line);
    const result = triggerManager.evaluateLine(line.text, scopeKey);
    if (result.matches.length) {
      executeTriggerMatches(result.matches, scopeKey);
    }
    if (result.gag) {
      removeLine(line);
      invalidateRender();
      continue;
    }

    const highlightedLine = highlightManager.applyHighlightsToLines([line], scopeKey)[0];
    if (highlightedLine !== line) {
      syncLine(line, highlightedLine);
    }

    if (reusedOpenLine) {
      invalidateRender();
    } else {
      visibleLines.push(line);
    }
  }

  if (trailingLine.length) {
    if (openOutputLine) {
      appendFragmentsToLine(openOutputLine, trailingLine);
      invalidateRender();
    } else {
      openOutputLine = createLineFromFragments(trailingLine, cssClass);
      visibleLines.push(openOutputLine);
    }
  }

  queueLines(visibleLines);
}

export function appendSystemMessage(text) {
  queueLines([buildSingleTextLine(text, 'system-line')]);
}

export function appendEcho(text) {
  queueLines([buildSingleTextLine('> ' + text, 'echo-line')]);
}

export function clearOutput() {
  lineStore = [];
  pendingLines = [];
  openOutputLine = null;
  nextLineId = 1;
  isScrollLocked = false;
  isOutputPaused = false;
  isSplitActive = false;
  syncOutputUi();

  for (const pane of Object.values(panes)) {
    if (pane.topSpacer) pane.topSpacer.style.height = '0px';
    if (pane.bottomSpacer) pane.bottomSpacer.style.height = '0px';
    if (pane.viewportEl) pane.viewportEl.textContent = '';
    if (pane.scrollEl) setPaneScrollTop(pane, 0);
  }
}
