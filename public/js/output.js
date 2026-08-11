import { state, dom } from './state.js';
import { parseAnsi, styleToElement } from './ansi.js';
import { highlightManager } from './highlight-manager.js';
import { triggerManager } from './trigger-manager.js';
import { giphyManager } from './giphy-manager.js';
import { sendSocketPayload } from './connection.js';
import { executeTriggerMatches } from './automation-executor.js';
import {
  findFirstImageUrlFromFragments,
  imagePreviewActionLabel,
  imagePreviewLabel,
  isImageFileUrl,
  openFirstImagePreviewFromText,
  openImagePreviewPane,
} from './image-preview.js';
import {
  DEFAULT_OUTPUT_SCROLLBACK_PRESET,
  OUTPUT_OVERSCAN_LINES,
  OUTPUT_SCROLLBACK_PRESETS,
} from './constants.js';
import { createControllerLifecycle } from './session-compat/controllers.js';

const BOTTOM_THRESHOLD_PX = 5;
const DEFAULT_LINE_HEIGHT_PX = 23;
const DEFAULT_CHARACTER_WIDTH_PX = 10;
const MIN_TERMINAL_COLUMNS = 40;
const MIN_TERMINAL_ROWS = 8;
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
const GMCP_TERMINAL_SIZE_PACKAGE = 'Darkwind.Client.NAWS';
const SCREEN_READER_ANNOUNCE_DELAY_MS = 180;
const SCREEN_READER_ANNOUNCE_MAX_LINES = 6;
const DUPLICATE_IMAGE_LINE_SUPPRESSION_MS = 5000;
const IMAGE_PREVIEW_DEBUG_STORAGE_KEY = 'darkflow-debug-image-preview';
const terminalGeometryTextEncoder = new TextEncoder();

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
let estimatedCharacterWidth = DEFAULT_CHARACTER_WIDTH_PX;
let resizeObserver = null;
let suppressAutoPause = false;
let splitRatio = DEFAULT_SPLIT_RATIO;
let activeDividerPointerId = null;
let userScrollIntentUntil = 0;
let highlightedLineId = null;
let highlightTimer = null;
let escapeReturnAvailable = false;
let screenReaderAnnounceTimer = null;
let screenReaderAnnounceQueue = [];
const screenReaderAnnouncedLines = new Map();
const lineObservers = new Set();
const recentImageOnlyOutputLines = new Map();
const recentImageOutputLabels = new Map();
let outputLifecycle = null;

try {
  if (typeof window !== 'undefined') {
    window.__darkflowImagePreviewDiagnosticsLoaded = '2026-06-30-image-preview-debug-v2';
  }
} catch (error) {
  // Ignore diagnostics marker failures in embedded browsers.
}

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
    stickToBottomOnNextRender: false,
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

function shouldDebugImagePreview(text) {
  try {
    if (typeof localStorage === 'undefined' || localStorage.getItem(IMAGE_PREVIEW_DEBUG_STORAGE_KEY) !== '1') {
      return false;
    }
  } catch (error) {
    return false;
  }
  const value = String(text || '').toLowerCase();
  return value.includes('image.png') || value.includes('discordapp.net') || value.includes('format=webp');
}

function debugOsc8Output(stage, payload) {
  try {
    // eslint-disable-next-line no-console
    console.debug('[osc8-gossip-debug]', stage, payload);
  } catch (error) {
    // Ignore console failures in embedded browsers.
  }
}

function debugImagePreviewOutput(stage, payload) {
  try {
    const entry = {
      at: new Date().toISOString(),
      stage,
      payload,
    };
    if (typeof window !== 'undefined') {
      if (!Array.isArray(window.__darkflowImagePreviewDebug)) {
        window.__darkflowImagePreviewDebug = [];
      }
      window.__darkflowImagePreviewDebug.push(entry);
      if (window.__darkflowImagePreviewDebug.length > 80) {
        window.__darkflowImagePreviewDebug.splice(0, window.__darkflowImagePreviewDebug.length - 80);
      }
    }
    // eslint-disable-next-line no-console
    console.warn('[image-preview-debug]', stage, payload);
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
  dom.outputShell.classList.toggle('escape-return-available', escapeReturnAvailable);
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
  requestOutputAnimationFrame(() => {
    if (pane.scrollSuppressionToken === token) {
      pane.suppressScrollEvents = false;
    }
  });
}

function snapPaneToBottom(pane) {
  if (!pane.scrollEl) return;
  setPaneScrollTop(pane, pane.scrollEl.scrollHeight);
}

function requestPaneBottomSnap(pane) {
  if (!pane) return;
  pane.stickToBottomOnNextRender = true;
}

function requestLiveBottomSnapIfAtBottom() {
  if (isSplitActive) {
    if (isPaneAtBottom(panes.live)) {
      requestPaneBottomSnap(panes.live);
    }
    return;
  }

  if (!isScrollLocked || isPaneAtBottom(panes.main)) {
    requestPaneBottomSnap(panes.main);
  }
}

export function refreshOutputLayout() {
  const shouldStickToMainBottom = !isSplitActive && (!isScrollLocked || isPaneAtBottom(panes.main));
  const shouldStickToLiveBottom = isSplitActive;

  if (shouldStickToLiveBottom) {
    requestPaneBottomSnap(panes.live);
  } else if (shouldStickToMainBottom) {
    requestPaneBottomSnap(panes.main);
  }

  measureEstimatedLineHeight();
  measureEstimatedCharacterWidth();
  updateTerminalGeometry();
  markAllLineHeightsDirty();
  renderInvalidated = true;
  scheduleFrame();

  requestOutputAnimationFrame(() => {
    if (shouldStickToLiveBottom && isSplitActive) {
      snapPaneToBottom(panes.live);
      return;
    }
    if (shouldStickToMainBottom && !isSplitActive) {
      snapPaneToBottom(panes.main);
      isScrollLocked = false;
    }
  });
}

function releaseAutoPauseSuppression() {
  requestOutputAnimationFrame(() => {
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
  requestPaneBottomSnap(panes.main);

  if (pendingLines.length > 0) {
    lineStore.push(...pendingLines);
    pendingLines = [];
    evictOverflowLines();
    renderInvalidated = true;
    renderActivePanes();
  } else if (renderInvalidated || isSplitActive) {
    renderActivePanes();
  }

  requestPaneBottomSnap(panes.main);
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

function normalizeImageLineText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pruneRecentImageOnlyOutputLines(now) {
  for (const [url, timestamp] of recentImageOnlyOutputLines.entries()) {
    if (now - timestamp > DUPLICATE_IMAGE_LINE_SUPPRESSION_MS) {
      recentImageOnlyOutputLines.delete(url);
    }
  }
  for (const [label, timestamp] of recentImageOutputLabels.entries()) {
    if (now - timestamp > DUPLICATE_IMAGE_LINE_SUPPRESSION_MS) {
      recentImageOutputLabels.delete(label);
    }
  }
}

function getLineImageUrl(line) {
  if (!line) return null;
  return findFirstImageUrlFromFragments(line.fragments, line.text);
}

function getImageFilenameLabel(text) {
  const value = normalizeImageLineText(text);
  const match = value.match(/(?:^|[\s:])([^\s:/\\]+\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp))(?:$|[\s.,!?;:)\]}>])/i);
  return match ? match[1] : null;
}

function isRenderedImageLabelOnly(text, renderedImages) {
  if (!renderedImages || !renderedImages.labels.size) return false;
  const value = normalizeImageLineText(text);
  return value ? renderedImages.labels.has(value) : false;
}

function isImageOnlyLine(line, url) {
  if (!line || !url) return false;
  const text = normalizeImageLineText(line.text);
  return text === imagePreviewLabel(url) || text === url;
}

function isImageHrefContinuationLine(line, url) {
  if (!line || !url || !Array.isArray(line.fragments) || !line.fragments.length) return false;
  let hasText = false;
  for (const fragment of line.fragments) {
    const text = String(fragment && fragment.text || '').trim();
    if (!text) continue;
    hasText = true;
    if (fragment.href !== url) return false;
  }
  return hasText;
}

function shouldSuppressDuplicateImageOnlyLine(line, url) {
  const now = Date.now();
  pruneRecentImageOnlyOutputLines(now);
  const label = getImageFilenameLabel(line && line.text);
  const text = normalizeImageLineText(line && line.text);

  if (label && text !== label) {
    recentImageOutputLabels.set(label, now);
  }

  if (label && text === label) {
    if (recentImageOutputLabels.has(label)) return true;
    recentImageOutputLabels.set(label, now);
  }

  if (!url) {
    if (!text) return false;
    for (const recentUrl of recentImageOnlyOutputLines.keys()) {
      if (text === imagePreviewLabel(recentUrl)) return true;
    }
    return false;
  }
  if (recentImageOnlyOutputLines.has(url) && isImageHrefContinuationLine(line, url)) return true;
  if (!isImageOnlyLine(line, url)) {
    recentImageOnlyOutputLines.set(url, now);
    return false;
  }
  if (recentImageOnlyOutputLines.has(url)) return true;
  recentImageOnlyOutputLines.set(url, now);
  return false;
}

function stylesEqual(a, b) {
  const left = a || {};
  const right = b || {};

  return Boolean(left.bold) === Boolean(right.bold)
    && Boolean(left.italic) === Boolean(right.italic)
    && Boolean(left.fraktur) === Boolean(right.fraktur)
    && Boolean(left.underline) === Boolean(right.underline)
    && Boolean(left.doubleUnderline) === Boolean(right.doubleUnderline)
    && Boolean(left.strikethrough) === Boolean(right.strikethrough)
    && Boolean(left.overline) === Boolean(right.overline)
    && Boolean(left.hidden) === Boolean(right.hidden)
    && Boolean(left.inverse) === Boolean(right.inverse)
    && Boolean(left.blink) === Boolean(right.blink)
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

function createImagePreviewLink(text, style, href) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'output-inline-link terminal-url-link image-preview-trigger';
  button.title = 'Open image preview';
  button.dataset.imageUrl = href;
  applyStyledTextAppearance(button, imagePreviewActionLabel(href || text), style);
  button.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    openImagePreviewPane(href || text, { title: imagePreviewLabel(href || text) });
  });
  return button;
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

function appendFragmentWithLinks(container, text, style, renderedImages = null) {
  const value = String(text || '');
  if (!value) return;
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
        container.appendChild(createImagePreviewLink(trimmed.url, style, trimmed.url));
        if (renderedImages) {
          renderedImages.urls.add(trimmed.url);
          renderedImages.labels.add(label);
        }
      }
    } else {
      container.appendChild(createUrlLink(trimmed.url, style, trimmed.url));
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

function createLineElement(line) {
  const div = document.createElement('div');
  div.className = 'output-line' + (line.cssClass ? ' ' + line.cssClass : '');
  if (line.id === highlightedLineId) {
    div.className += ' output-line-mention-target';
  }
  div.setAttribute('data-line-id', String(line.id));

  if (line.fragments.length === 0 || line.text === '') {
    div.appendChild(document.createTextNode('\u200B'));
    return div;
  }

  const renderedImages = {
    urls: new Set(),
    labels: new Set(),
  };

  if (line.giphyReplay) {
    const { parts, replay } = line.giphyReplay;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.type === 'link') {
        div.appendChild(createReplayLink(part.text, part.style, () => giphyManager.replay(replay)));
        continue;
      }
      if (part.href) {
        if (isImageFileUrl(part.href)) {
          while (i + 1 < parts.length && parts[i + 1].href === part.href) i++;
          const label = imagePreviewLabel(part.href);
          if (!renderedImages.urls.has(part.href) && !renderedImages.labels.has(label)) {
            div.appendChild(createImagePreviewLink(part.text, part.style, part.href));
            renderedImages.urls.add(part.href);
            renderedImages.labels.add(label);
          }
          continue;
        }
        div.appendChild(createUrlLink(part.text, part.style, part.href));
        continue;
      }
      appendFragmentWithLinks(div, part.text, part.style, renderedImages);
    }
    return div;
  }

  for (let i = 0; i < line.fragments.length; i++) {
    const frag = line.fragments[i];
    if (frag.href) {
      if (isImageFileUrl(frag.href)) {
        while (i + 1 < line.fragments.length && line.fragments[i + 1].href === frag.href) i++;
        const label = imagePreviewLabel(frag.href);
        if (!renderedImages.urls.has(frag.href) && !renderedImages.labels.has(label)) {
          div.appendChild(createImagePreviewLink(frag.text, frag.style, frag.href));
          renderedImages.urls.add(frag.href);
          renderedImages.labels.add(label);
        }
        continue;
      }
      div.appendChild(createUrlLink(frag.text, frag.style, frag.href));
      continue;
    }
    appendFragmentWithLinks(div, frag.text, frag.style, renderedImages);
  }

  if (shouldDebugImagePreview(line.text)) {
    debugImagePreviewOutput('createLineElement rendered', {
      id: line.id,
      text: escapeDebugText(line.text),
      childCount: div.childNodes.length,
      renderedImageLabels: Array.from(renderedImages.labels),
      renderedImageUrls: Array.from(renderedImages.urls),
      childText: Array.from(div.childNodes).map((node) => node.textContent || ''),
    });
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
  if (frameScheduled || !outputLifecycle || outputLifecycle.disposed) return;
  frameScheduled = true;
  outputLifecycle.requestAnimationFrame(flushAndRender);
}

function requestOutputAnimationFrame(callback) {
  if (!outputLifecycle || outputLifecycle.disposed) return () => {};
  return outputLifecycle.requestAnimationFrame(callback);
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

function notifyLineObservers(line) {
  announceLineForScreenReader(line);
  if (!line || !lineObservers.size) return;
  const snapshot = {
    id: line.id,
    text: line.text || '',
    cssClass: line.cssClass || '',
  };
  for (const observer of lineObservers) {
    try {
      observer(snapshot);
    } catch (error) {
      console.warn('Output line observer failed', error);
    }
  }
}

function pruneScreenReaderAnnouncements() {
  if (screenReaderAnnouncedLines.size <= scrollbackLimit) return;
  const keepIds = new Set(lineStore.map((line) => line.id).concat(pendingLines.map((line) => line.id)));
  for (const id of screenReaderAnnouncedLines.keys()) {
    if (!keepIds.has(id)) screenReaderAnnouncedLines.delete(id);
  }
}

function flushScreenReaderAnnouncements() {
  screenReaderAnnounceTimer = null;
  if (!dom.screenReaderAnnouncer || !state.settings.screenReaderMode) {
    screenReaderAnnounceQueue = [];
    return;
  }

  const lines = screenReaderAnnounceQueue.splice(0, screenReaderAnnounceQueue.length)
    .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-SCREEN_READER_ANNOUNCE_MAX_LINES);
  if (!lines.length) return;

  dom.screenReaderAnnouncer.textContent = lines.join('\n');
}

function announceLineForScreenReader(line) {
  if (!state.settings.screenReaderMode || !dom.screenReaderAnnouncer || !line) return;
  const text = String(line.text || '').trim();
  if (!text) return;
  if (screenReaderAnnouncedLines.get(line.id) === text) return;

  screenReaderAnnouncedLines.set(line.id, text);
  pruneScreenReaderAnnouncements();
  screenReaderAnnounceQueue.push(text);

  if (!screenReaderAnnounceTimer && outputLifecycle && !outputLifecycle.disposed) {
    screenReaderAnnounceTimer = outputLifecycle.setTimeout(
      flushScreenReaderAnnouncements,
      SCREEN_READER_ANNOUNCE_DELAY_MS
    );
  }
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

function measureEstimatedCharacterWidth() {
  const probeHost = (isSplitActive
    ? panes.history.viewportEl || panes.live.viewportEl || panes.main.viewportEl
    : panes.main.viewportEl || panes.history.viewportEl || panes.live.viewportEl);
  if (!probeHost) return;

  const probe = document.createElement('div');
  probe.className = 'output-line';
  probe.style.visibility = 'hidden';
  probe.style.position = 'absolute';
  probe.style.whiteSpace = 'pre';
  probe.textContent = 'MMMMMMMMMM';
  probeHost.appendChild(probe);

  const measured = probe.getBoundingClientRect().width;
  probe.remove();

  if (measured > 0) {
    estimatedCharacterWidth = measured / 10;
  }
}

function getTerminalGeometry() {
  const host = isSplitActive ? dom.outputLive || dom.output : dom.output || dom.outputLive || dom.outputShell;
  const fallback = state.terminalGeometry && typeof state.terminalGeometry === 'object'
    ? state.terminalGeometry
    : {};
  const geometry = {
    columns: fallback.columns || 75,
    rows: fallback.rows || 24,
  };

  if (!host || typeof window === 'undefined') {
    return geometry;
  }

  const rect = host.getBoundingClientRect();
  const style = window.getComputedStyle(host);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  const availableWidth = Math.max(0, rect.width - paddingLeft - paddingRight);
  const availableHeight = Math.max(0, rect.height - paddingTop - paddingBottom);

  if (estimatedCharacterWidth <= 0) {
    measureEstimatedCharacterWidth();
  }
  if (estimatedLineHeight <= 0) {
    measureEstimatedLineHeight();
  }

  const columns = estimatedCharacterWidth > 0
    ? Math.max(MIN_TERMINAL_COLUMNS, Math.floor(availableWidth / estimatedCharacterWidth))
    : geometry.columns;
  const rows = estimatedLineHeight > 0
    ? Math.max(MIN_TERMINAL_ROWS, Math.floor(availableHeight / estimatedLineHeight))
    : geometry.rows;

  if (Number.isFinite(columns) && columns > 0) {
    geometry.columns = columns;
  }
  if (Number.isFinite(rows) && rows > 0) {
    geometry.rows = rows;
  }

  if (Number.isInteger(state.settings.terminalWidthColumns)) {
    geometry.columns = state.settings.terminalWidthColumns;
  }

  return geometry;
}

function updateTerminalGeometry() {
  const geometry = getTerminalGeometry();
  const current = state.terminalGeometry && typeof state.terminalGeometry === 'object'
    ? state.terminalGeometry
    : {};
  const columnsChanged = geometry.columns !== current.columns;
  const rowsChanged = geometry.rows !== current.rows;

  state.terminalGeometry = geometry;

  return {
    geometry,
    changed: columnsChanged || rowsChanged,
  };
}

export function sendTerminalGeometry(force = false) {
  const result = updateTerminalGeometry();

  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  if (!force && !result.changed) {
    return false;
  }

  const payload = JSON.stringify({
    width: result.geometry.columns,
    height: result.geometry.rows,
  });
  return sendSocketPayload(terminalGeometryTextEncoder.encode(
    GMCP_TERMINAL_SIZE_PACKAGE + ' ' + payload
  ), {
    kind: 'gmcp',
    size: payload.length,
    preview: GMCP_TERMINAL_SIZE_PACKAGE,
    closeOpenLine: false,
  });
}

function renderPane(pane) {
  if (!pane.topSpacer || !pane.viewportEl || !pane.bottomSpacer || !pane.scrollEl) return;

  if (lineStore.length === 0) {
    pane.topSpacer.style.height = '0px';
    pane.bottomSpacer.style.height = '0px';
    pane.viewportEl.textContent = '';
    pane.stickToBottomOnNextRender = false;
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
    if (pane.stickToBottomOnNextRender) {
      snapPaneToBottom(pane);
    } else {
      const anchoredScrollTop = nextPrefix[anchorIndex] + anchorOffset;
      setPaneScrollTop(pane, Math.max(0, anchoredScrollTop));
    }
    renderInvalidated = true;
    scheduleFrame();
    return;
  }

  if (pane.stickToBottomOnNextRender) {
    snapPaneToBottom(pane);
    pane.stickToBottomOnNextRender = false;
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
  requestPaneBottomSnap(panes.live);
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
  requestOutputAnimationFrame(() => {
    requestPaneBottomSnap(panes.main);
    snapPaneToBottom(panes.main);
  });
}

export function exitSplitScrollback() {
  if (!isSplitActive) return false;
  deactivateSplitView();
  return true;
}

export function returnOutputToLive() {
  if (isSplitActive) {
    deactivateSplitView();
    return true;
  }

  if (isOutputPaused) {
    setOutputPaused(false);
    return true;
  }

  if (!isScrollLocked && isPaneAtBottom(panes.main) && highlightedLineId == null) {
    return false;
  }

  highlightedLineId = null;
  escapeReturnAvailable = false;
  if (highlightTimer) {
    highlightTimer();
    highlightTimer = null;
  }
  isScrollLocked = false;
  suppressAutoPause = true;
  syncOutputUi();
  requestPaneBottomSnap(panes.main);
  snapPaneToBottom(panes.main);
  renderInvalidated = true;
  scheduleFrame();
  releaseAutoPauseSuppression();
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
    escapeReturnAvailable = false;
    setOutputPaused(false);
    return;
  }
  if (atBottom && escapeReturnAvailable) {
    escapeReturnAvailable = false;
    syncOutputUi();
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
    requestPaneBottomSnap(panes.live);
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

    if (isSplitActive) {
      requestPaneBottomSnap(panes.live);
    } else if (shouldStickToMainBottom) {
      requestPaneBottomSnap(panes.main);
    }

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

export function initOutput() {
  if (outputLifecycle) return outputLifecycle.dispose;
  const lifecycle = createControllerLifecycle('output', disposeOutputState);
  outputLifecycle = lifecycle;

  try {
    initPane(panes.main, dom.output);
    initPane(panes.history, dom.outputHistory);
    initPane(panes.live, dom.outputLive);
    syncOutputUi();
    measureEstimatedLineHeight();
    measureEstimatedCharacterWidth();
    sendTerminalGeometry(true);

    lifecycle.listen(dom.output, 'wheel', markUserScrollIntent, { passive: true });
    lifecycle.listen(dom.output, 'touchstart', markUserScrollIntent, { passive: true });
    lifecycle.listen(dom.output, 'pointerdown', markScrollbarPointerIntent);
    lifecycle.listen(dom.outputHistory, 'wheel', markUserScrollIntent, { passive: true });
    lifecycle.listen(dom.outputHistory, 'touchstart', markUserScrollIntent, { passive: true });
    lifecycle.listen(dom.outputHistory, 'pointerdown', markScrollbarPointerIntent);

    lifecycle.listen(dom.output, 'scroll', handleMainScroll);
    lifecycle.listen(dom.outputHistory, 'scroll', handleHistoryScroll);
    lifecycle.listen(dom.outputLive, 'scroll', handleLiveScroll);

    if (dom.outputPauseBtn) {
      lifecycle.listen(dom.outputPauseBtn, 'click', function() {
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
      lifecycle.listen(dom.outputLiveBtn, 'click', function() {
        deactivateSplitView();
      });
    }

    if (dom.outputEscapeHint) {
      lifecycle.listen(dom.outputEscapeHint, 'click', function() {
        returnOutputToLive();
      });
    }

    if (dom.outputDivider) {
      lifecycle.listen(dom.outputDivider, 'pointerdown', beginDividerDrag);
      lifecycle.listen(window, 'pointermove', updateDividerDrag);
      lifecycle.listen(window, 'pointerup', endDividerDrag);
      lifecycle.listen(window, 'pointercancel', endDividerDrag);
    }

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        refreshOutputLayout();
      });
      resizeObserver.observe(dom.outputShell);
      resizeObserver.observe(dom.output);
      resizeObserver.observe(dom.outputHistory);
      resizeObserver.observe(dom.outputLive);
      lifecycle.ownObserver(resizeObserver);
    } else {
      lifecycle.listen(window, 'resize', function() {
        refreshOutputLayout();
      });
    }

    lifecycle.listen(window, 'darkflow:output-layout-changed', refreshOutputLayout);
  } catch (error) {
    lifecycle.dispose();
    throw error;
  }
  return lifecycle.dispose;
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

export function onOutputLine(observer) {
  if (typeof observer !== 'function') return () => {};
  lineObservers.add(observer);
  return () => lineObservers.delete(observer);
}

export function isOutputLineAvailable(lineId) {
  const id = Number(lineId);
  if (!Number.isFinite(id)) return false;
  return lineStore.some(line => line.id === id) || pendingLines.some(line => line.id === id);
}

export function scrollToOutputLine(lineId) {
  const id = Number(lineId);
  if (!Number.isFinite(id)) return false;

  let index = lineStore.findIndex(line => line.id === id);
  if (index < 0) {
    const pending = pendingLines.find(line => line.id === id);
    if (pending) {
      lineStore.push(...pendingLines);
      pendingLines = [];
      evictOverflowLines();
      index = lineStore.findIndex(line => line.id === id);
    }
  }
  if (index < 0 || !panes.main.scrollEl) return false;

  if (isSplitActive) {
    deactivateSplitView();
  }

  const prefix = getPrefixHeights();
  const targetTop = Math.max(0, prefix[index] - Math.round((panes.main.scrollEl.clientHeight || 0) * 0.35));
  suppressAutoPause = true;
  isOutputPaused = false;
  isScrollLocked = true;
  setPaneScrollTop(panes.main, targetTop);

  highlightedLineId = id;
  escapeReturnAvailable = true;
  if (highlightTimer) highlightTimer();
  highlightTimer = outputLifecycle.setTimeout(() => {
    highlightTimer = null;
    if (highlightedLineId === id) {
      highlightedLineId = null;
      invalidateRender();
    }
  }, 2400);

  syncOutputUi();
  renderInvalidated = true;
  scheduleFrame();
  releaseAutoPauseSuppression();
  return true;
}

export function flashOutputLine(lineId) {
  const id = Number(lineId);
  if (!Number.isFinite(id) || !isOutputLineAvailable(id)) return false;

  highlightedLineId = id;
  if (highlightTimer) highlightTimer();
  highlightTimer = outputLifecycle.setTimeout(() => {
    highlightTimer = null;
    if (highlightedLineId === id) {
      highlightedLineId = null;
      invalidateRender();
    }
  }, 2400);

  renderInvalidated = true;
  scheduleFrame();
  return true;
}

export function appendOutput(text, cssClass) {
  const debugImagePreview = shouldDebugImagePreview(text);
  if (debugImagePreview) {
    debugImagePreviewOutput('appendOutput raw', {
      cssClass: cssClass || '',
      raw: escapeDebugText(text),
    });
  }
  if (shouldDebugOsc8(text)) {
    debugOsc8Output('appendOutput raw', escapeDebugText(text));
  }
  const fragments = parseAnsi(text);
  if (debugImagePreview) {
    debugImagePreviewOutput('parseAnsi fragments', fragments.map((fragment) => ({
      text: escapeDebugText(fragment.text),
      href: fragment.href || null,
      style: fragment.style || {},
    })));
  }
  if (shouldDebugOsc8(text)) {
    debugOsc8Output('parseAnsi fragments', fragments.map((fragment) => ({
      text: escapeDebugText(fragment.text),
      href: fragment.href || null,
      style: fragment.style || {},
    })));
  }
  const { completedLines, trailingLine } = splitFragmentsIntoLines(fragments);
  if (debugImagePreview) {
    debugImagePreviewOutput('splitFragmentsIntoLines', {
      completedLines: completedLines.map((lineFragments) => ({
        text: escapeDebugText(lineFragments.map((fragment) => fragment.text).join('')),
        fragments: lineFragments.map((fragment) => ({
          text: escapeDebugText(fragment.text),
          href: fragment.href || null,
          style: fragment.style || {},
        })),
      })),
      trailingLine: {
        text: escapeDebugText(trailingLine.map((fragment) => fragment.text).join('')),
        fragments: trailingLine.map((fragment) => ({
          text: escapeDebugText(fragment.text),
          href: fragment.href || null,
          style: fragment.style || {},
        })),
      },
    });
  }
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
      executeTriggerMatches(result.matches, scopeKey, {
        appendMessage: appendSystemMessage,
        sendCommand: sendTriggerCommand,
      });
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

    const imageUrl = getLineImageUrl(line);
    const suppressDuplicateImageLine = shouldSuppressDuplicateImageOnlyLine(line, imageUrl);
    if (debugImagePreview || shouldDebugImagePreview(line.text)) {
      debugImagePreviewOutput('completed line decision', {
        id: line.id,
        text: escapeDebugText(line.text),
        fragments: line.fragments.map((fragment) => ({
          text: escapeDebugText(fragment.text),
          href: fragment.href || null,
          style: fragment.style || {},
        })),
        imageUrl,
        suppressDuplicateImageLine,
        recentImageLabels: Array.from(recentImageOutputLabels.keys()),
        recentImageUrls: Array.from(recentImageOnlyOutputLines.keys()),
      });
    }
    if (suppressDuplicateImageLine) {
      removeLine(line);
      invalidateRender();
      continue;
    }

    if (reusedOpenLine) {
      requestLiveBottomSnapIfAtBottom();
      invalidateRender();
    } else {
      visibleLines.push(line);
    }
    if (!openFirstImagePreviewFromText(line.text)) {
      if (imageUrl) openImagePreviewPane(imageUrl, { title: imagePreviewLabel(imageUrl) });
    }
    notifyLineObservers(line);
  }

  if (trailingLine.length) {
    if (openOutputLine) {
      appendFragmentsToLine(openOutputLine, trailingLine);
      requestLiveBottomSnapIfAtBottom();
      invalidateRender();
      notifyLineObservers(openOutputLine);
    } else {
      openOutputLine = createLineFromFragments(trailingLine, cssClass);
      const imageUrl = getLineImageUrl(openOutputLine);
      const suppressDuplicateImageLine = shouldSuppressDuplicateImageOnlyLine(openOutputLine, imageUrl);
      if (debugImagePreview || shouldDebugImagePreview(openOutputLine.text)) {
        debugImagePreviewOutput('trailing line decision', {
          id: openOutputLine.id,
          text: escapeDebugText(openOutputLine.text),
          fragments: openOutputLine.fragments.map((fragment) => ({
            text: escapeDebugText(fragment.text),
            href: fragment.href || null,
            style: fragment.style || {},
          })),
          imageUrl,
          suppressDuplicateImageLine,
          recentImageLabels: Array.from(recentImageOutputLabels.keys()),
          recentImageUrls: Array.from(recentImageOnlyOutputLines.keys()),
        });
      }
      if (suppressDuplicateImageLine) {
        openOutputLine = null;
      } else {
        visibleLines.push(openOutputLine);
        if (!openFirstImagePreviewFromText(openOutputLine.text)) {
          if (imageUrl) openImagePreviewPane(imageUrl, { title: imagePreviewLabel(imageUrl) });
        }
        notifyLineObservers(openOutputLine);
      }
    }
  }

  if (debugImagePreview) {
    debugImagePreviewOutput('queueLines', visibleLines.map((line) => ({
      id: line.id,
      text: escapeDebugText(line.text),
      fragments: line.fragments.map((fragment) => ({
        text: escapeDebugText(fragment.text),
        href: fragment.href || null,
        style: fragment.style || {},
      })),
    })));
  }
  queueLines(visibleLines);
}

export function appendSystemMessage(text) {
  queueLines([buildSingleTextLine(text, 'system-line')]);
}

export function appendEcho(text) {
  queueLines([buildSingleTextLine('> ' + text, 'echo-line')]);
}

// Called when the client sends anything to the server. The fragmented-
// ANSI/UTF-8 merge mechanism in appendOutput keeps a partial line
// "open" so subsequent frames append to it. That's correct within a
// server burst, but the server's prompt is always a partial line --
// without this barrier, repeated empty Enters merge their prompts
// into one row, and the next command's response sticks onto the stale
// prompt. Closing on every outbound frame finalizes the prompt at
// each user submission.
export function closeOpenOutputLine() {
  openOutputLine = null;
}

export function clearOutput() {
  lineStore = [];
  pendingLines = [];
  openOutputLine = null;
  nextLineId = 1;
  highlightedLineId = null;
  escapeReturnAvailable = false;
  screenReaderAnnounceQueue = [];
  screenReaderAnnouncedLines.clear();
  if (screenReaderAnnounceTimer) {
    screenReaderAnnounceTimer();
    screenReaderAnnounceTimer = null;
  }
  if (dom.screenReaderAnnouncer) {
    dom.screenReaderAnnouncer.textContent = '';
  }
  if (highlightTimer) {
    highlightTimer();
    highlightTimer = null;
  }
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

function disposeOutputState() {
  frameScheduled = false;
  renderInvalidated = false;
  lineStore = [];
  pendingLines = [];
  openOutputLine = null;
  nextLineId = 1;
  resizeObserver = null;
  highlightedLineId = null;
  highlightTimer = null;
  screenReaderAnnounceTimer = null;
  screenReaderAnnounceQueue = [];
  screenReaderAnnouncedLines.clear();
  lineObservers.clear();
  recentImageOnlyOutputLines.clear();
  recentImageOutputLabels.clear();
  activeDividerPointerId = null;
  isScrollLocked = false;
  isOutputPaused = false;
  isSplitActive = false;
  suppressAutoPause = false;
  escapeReturnAvailable = false;
  userScrollIntentUntil = 0;
  if (dom.screenReaderAnnouncer) dom.screenReaderAnnouncer.textContent = '';
  for (const pane of Object.values(panes)) {
    if (pane.scrollEl) pane.scrollEl.textContent = '';
    Object.assign(pane, createPaneState());
  }
  outputLifecycle = null;
}
