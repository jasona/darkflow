import { gmcp } from './gmcp.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

const PKG_SHOW = 'Darkwind.Giphy.Show';
const DEFAULT_DURATION_MS = 10000;
const MAX_RECENT_REPLAYS = 100;

function normalizeReplayKey(channel, talker, phrase) {
  const safeChannel = typeof channel === 'string' ? channel.trim().toLowerCase() : '';
  const safeTalker = typeof talker === 'string' ? talker.trim().toLowerCase() : '';
  const safePhrase = typeof phrase === 'string' ? phrase.trim().toLowerCase() : '';
  if (!safeChannel || !safeTalker || !safePhrase) return '';
  return safeChannel + '|' + safeTalker + '|' + safePhrase;
}

export const giphyManager = {
  els: {
    overlay: null,
    close: null,
    channel: null,
    talker: null,
    phrase: null,
    image: null,
  },

  hideTimer: null,
  renderToken: 0,
  recentReplays: new Map(),

  init() {
    return installControllerLifecycle(this, 'giphy', gmcp, (scopedGmcp) => {
      this.mount();
      scopedGmcp.on(PKG_SHOW, (data) => this.show(data));
    }, () => this.hide());
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  mount() {
    if (this.els.overlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'giphy-overlay';

    const card = document.createElement('div');
    card.className = 'giphy-card';

    const close = document.createElement('button');
    close.className = 'giphy-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close GIF');
    close.textContent = '×';
    close.addEventListener('click', () => this.hide());

    const meta = document.createElement('div');
    meta.className = 'giphy-meta';

    const channel = document.createElement('div');
    channel.className = 'giphy-channel';

    const talker = document.createElement('div');
    talker.className = 'giphy-talker';

    const phrase = document.createElement('div');
    phrase.className = 'giphy-phrase';

    const imageWrap = document.createElement('div');
    imageWrap.className = 'giphy-image-wrap';

    const image = document.createElement('img');
    image.className = 'giphy-image';
    image.alt = '';
    image.loading = 'eager';
    image.decoding = 'async';

    imageWrap.appendChild(image);
    card.appendChild(close);
    meta.appendChild(channel);
    meta.appendChild(talker);
    meta.appendChild(phrase);
    card.appendChild(meta);
    card.appendChild(imageWrap);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    this.els = {
      overlay,
      close,
      channel,
      talker,
      phrase,
      image,
    };
  },

  clearHideTimer() {
    if (!this.hideTimer) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  },

  rememberReplay(data) {
    const key = normalizeReplayKey(
      data && data.caption ? data.caption : data && data.channel,
      data && data.talker,
      data && data.phrase
    );
    if (!key) return;

    if (this.recentReplays.has(key)) {
      this.recentReplays.delete(key);
    }

    this.recentReplays.set(key, {
      channel: data && data.channel ? data.channel : '',
      caption: data && data.caption ? data.caption : '',
      talker: data && data.talker ? data.talker : '',
      phrase: data && data.phrase ? data.phrase : '',
      gifUrl: data && data.gifUrl ? data.gifUrl : '',
      durationMs: Math.max(1000, Number(data && data.durationMs) || DEFAULT_DURATION_MS),
    });

    while (this.recentReplays.size > MAX_RECENT_REPLAYS) {
      const oldestKey = this.recentReplays.keys().next().value;
      if (!oldestKey) break;
      this.recentReplays.delete(oldestKey);
    }
  },

  findReplayForLine(text) {
    if (typeof text !== 'string' || !text.length) return null;

    const match = text.match(/^\[([^\]]+)\] (.+) shared a GIF for "([^"]+)"\.$/);
    if (!match) return null;

    const [, channel, talker, phrase] = match;
    const key = normalizeReplayKey(channel, talker, phrase);
    if (!key || !this.recentReplays.has(key)) return null;
    return this.recentReplays.get(key);
  },

  replay(data) {
    if (!data || !data.gifUrl) return;
    this.show(data);
  },

  hide() {
    this.clearHideTimer();
    this.renderToken += 1;

    if (!this.els.overlay) return;

    this.els.overlay.classList.remove('open');
    this.els.image.removeAttribute('src');
    this.els.image.alt = '';
  },

  show(data) {
    const gifUrl = data && typeof data.gifUrl === 'string' ? data.gifUrl.trim() : '';
    if (!gifUrl) {
      this.hide();
      return;
    }

    this.rememberReplay(data);

    const durationMs = Math.max(
      1000,
      Number(data && data.durationMs) || DEFAULT_DURATION_MS
    );
    const token = ++this.renderToken;

    this.clearHideTimer();

    this.els.channel.textContent = data && data.channel ? data.channel : 'GIF';
    this.els.talker.textContent = data && data.talker ? data.talker : 'Someone';
    this.els.phrase.textContent = data && data.phrase
      ? '"' + data.phrase + '"'
      : '';

    this.els.image.alt = (this.els.talker.textContent || 'Someone')
      + ' shared a GIF'
      + (data && data.phrase ? ' for "' + data.phrase + '"' : '');

    this.els.image.onerror = () => {
      if (token !== this.renderToken) return;
      this.hide();
    };

    this.els.image.src = gifUrl;
    this.els.overlay.classList.add('open');

    this.hideTimer = setTimeout(() => {
      if (token !== this.renderToken) return;
      this.hide();
    }, durationMs);
  },
};
