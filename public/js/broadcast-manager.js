import { gmcp } from './gmcp.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

const PKG_SHOW = 'Darkwind.Broadcast.Show';
const DEFAULT_DURATION_MS = 10000;

export const broadcastManager = {
  els: {
    overlay: null,
    close: null,
    title: null,
    sender: null,
    message: null,
  },

  hideTimer: null,
  renderToken: 0,

  init() {
    return installControllerLifecycle(this, 'broadcast', gmcp, (scopedGmcp) => {
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
    overlay.className = 'broadcast-overlay';

    const card = document.createElement('div');
    card.className = 'broadcast-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'assertive');

    const close = document.createElement('button');
    close.className = 'broadcast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close broadcast');
    close.textContent = '×';
    close.addEventListener('click', () => this.hide());

    const header = document.createElement('div');
    header.className = 'broadcast-header';

    const title = document.createElement('div');
    title.className = 'broadcast-title';

    const sender = document.createElement('div');
    sender.className = 'broadcast-sender';

    const message = document.createElement('div');
    message.className = 'broadcast-message';

    header.appendChild(title);
    header.appendChild(sender);
    card.appendChild(close);
    card.appendChild(header);
    card.appendChild(message);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    this.els = {
      overlay,
      close,
      title,
      sender,
      message,
    };
  },

  clearHideTimer() {
    if (!this.hideTimer) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  },

  hide() {
    this.clearHideTimer();
    this.renderToken += 1;

    if (!this.els.overlay) return;
    this.els.overlay.classList.remove('open');
  },

  show(data) {
    const message = data && typeof data.message === 'string'
      ? data.message.trim()
      : '';
    if (!message) {
      this.hide();
      return;
    }

    const durationMs = Math.max(
      1000,
      Number(data && data.durationMs) || DEFAULT_DURATION_MS
    );
    const token = ++this.renderToken;

    this.clearHideTimer();

    this.els.title.textContent = data && data.title ? data.title : 'Broadcast';
    this.els.sender.textContent = data && data.sender ? data.sender : 'Darkwind';
    this.els.message.textContent = message;
    this.els.overlay.classList.add('open');

    this.hideTimer = setTimeout(() => {
      if (token !== this.renderToken) return;
      this.hide();
    }, durationMs);
  },
};
