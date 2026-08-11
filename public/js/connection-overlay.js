import { state } from './state.js';
import { retryNow, disconnect } from './connection.js';
import { windowManager } from './window-manager.js';
import { createControllerLifecycle, disposeControllerLifecycle } from './session-compat/controllers.js';

// Reconnecting overlay: a small centered modal with a spinner that
// replaces the old "Reconnecting in Ns..." terminal spam. It only
// appears after the session has been connected at least once (initial
// page-load connects keep the toolbar flow), and it stays out of the
// way whenever an auth window (login/charselect/newchar) is open --
// those windows carry their own connection strip.
export const connectionOverlay = {
  el: null,
  statusEl: null,
  detailEl: null,
  spinnerEl: null,
  retryBtn: null,
  stopBtn: null,
  countdownTimer: null,
  lastStatus: null,
  nextAttemptAt: 0,

  init() {
    if (this._controllerLifecycle) return this._controllerLifecycle.dispose;
    const lifecycle = createControllerLifecycle('connection-overlay', () => {
      this._stopCountdown();
      if (this.el) this.el.remove();
      this.el = null;
      this.statusEl = null;
      this.detailEl = null;
      this.spinnerEl = null;
      this.retryBtn = null;
      this.stopBtn = null;
      this.lastStatus = null;
      this.nextAttemptAt = 0;
      this._controllerLifecycle = null;
    });
    this._controllerLifecycle = lifecycle;

    lifecycle.listen(document, 'dw:connectionstate', (event) => {
      const detail = event.detail || {};
      if (detail.state === 'connected') this._onConnected();
      this._render();
    });
    lifecycle.listen(document, 'dw:reconnectstatus', (event) => {
      const detail = event.detail || {};
      this.lastStatus = detail;
      if (detail.status === 'scheduled' && detail.nextAttemptAt) {
        this.nextAttemptAt = detail.nextAttemptAt;
      }
      if (detail.status === 'connected') this._onConnected();
      this._render();
    });
    lifecycle.listen(document, 'dw:authwindowchange', () => this._render());
    return lifecycle.dispose;
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  _ensureDom() {
    if (this.el) return;

    const overlay = document.createElement('div');
    overlay.className = 'dw-conn-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-live', 'polite');

    const card = document.createElement('div');
    card.className = 'dw-conn-card';

    this.spinnerEl = document.createElement('div');
    this.spinnerEl.className = 'dw-spinner';

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'dw-conn-status';

    this.detailEl = document.createElement('div');
    this.detailEl.className = 'dw-conn-detail';

    const buttons = document.createElement('div');
    buttons.className = 'dw-conn-buttons';

    this.retryBtn = document.createElement('button');
    this.retryBtn.type = 'button';
    this.retryBtn.className = 'dw-button dw-button-primary';
    this.retryBtn.textContent = 'Retry now';
    this._controllerLifecycle.listen(this.retryBtn, 'click', () => retryNow());

    this.stopBtn = document.createElement('button');
    this.stopBtn.type = 'button';
    this.stopBtn.className = 'dw-button';
    this.stopBtn.textContent = 'Stop trying';
    this._controllerLifecycle.listen(this.stopBtn, 'click', () => {
      disconnect();
      this._hide();
    });

    buttons.appendChild(this.retryBtn);
    buttons.appendChild(this.stopBtn);

    card.appendChild(this.spinnerEl);
    card.appendChild(this.statusEl);
    card.appendChild(this.detailEl);
    card.appendChild(buttons);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this.el = overlay;
  },

  _onConnected() {
    this.nextAttemptAt = 0;
    this._stopCountdown();
  },

  _shouldShow() {
    if (!state.everConnected) return false;
    if (state.userDisconnected) return false;
    if (windowManager.hasAuthWindow && windowManager.hasAuthWindow()) return false;

    const status = this.lastStatus ? this.lastStatus.status : null;
    return status === 'connecting' || status === 'scheduled' || status === 'idle';
  },

  _render() {
    if (!this._shouldShow()) {
      this._hide();
      return;
    }

    this._ensureDom();
    const status = this.lastStatus ? this.lastStatus.status : null;
    const attempt = this.lastStatus && this.lastStatus.attempt ? this.lastStatus.attempt : 0;
    const transport = this.lastStatus && this.lastStatus.transport ? this.lastStatus.transport : null;

    if (status === 'connecting') {
      this.statusEl.textContent = 'Reconnecting...';
      this.detailEl.textContent = this._detailText(attempt, transport, null);
      this.spinnerEl.style.display = '';
      this.retryBtn.disabled = true;
      this._stopCountdown();
    } else if (status === 'scheduled') {
      this.statusEl.textContent = 'Connection lost';
      this.spinnerEl.style.display = '';
      this.retryBtn.disabled = false;
      this._startCountdown(attempt, transport);
      this._updateCountdown(attempt, transport);
    } else {
      // idle: automatic retries are not running
      this.statusEl.textContent = 'Disconnected';
      this.detailEl.textContent = 'Automatic reconnect is off.';
      this.spinnerEl.style.display = 'none';
      this.retryBtn.disabled = false;
      this._stopCountdown();
    }

    this.el.style.display = 'flex';
  },

  _detailText(attempt, transport, secondsLeft) {
    const parts = [];
    if (secondsLeft !== null && secondsLeft !== undefined) {
      parts.push('next attempt in ' + secondsLeft + 's');
    }
    if (attempt > 0) parts.push('attempt ' + attempt);
    if (transport) parts.push('via ' + transport);
    return parts.join(' · ');
  },

  _startCountdown(attempt, transport) {
    if (this.countdownTimer) return;
    this.countdownTimer = this._controllerLifecycle.setInterval(() => {
      this._updateCountdown(attempt, transport);
    }, 250);
  },

  _updateCountdown(attempt, transport) {
    if (!this.detailEl) return;
    const msLeft = Math.max(0, this.nextAttemptAt - Date.now());
    this.detailEl.textContent =
      this._detailText(attempt, transport, Math.ceil(msLeft / 1000));
  },

  _stopCountdown() {
    if (!this.countdownTimer) return;
    this.countdownTimer();
    this.countdownTimer = null;
  },

  _hide() {
    this._stopCountdown();
    if (this.el) this.el.style.display = 'none';
  },
};
