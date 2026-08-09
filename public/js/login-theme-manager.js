import { soundManager } from './sound-manager.js';
import { gmcp } from './gmcp.js';

export const LOGIN_THEME = Object.freeze({
  category: 'ambient',
  sound: 'darkwind-theme',
  id: 'darkwind-login-theme',
  volume: 0.5,
});

const AUTH_TRANSITION_GRACE_MS = 100;

export class LoginThemeManager {
  constructor(manager = soundManager, timers = {}, gmcpClient = gmcp) {
    this.soundManager = manager;
    this.gmcp = gmcpClient;
    this.setTimer = timers.setTimeout || setTimeout.bind(window);
    this.clearTimer = timers.clearTimeout || clearTimeout.bind(window);
    this.stopTimer = null;
    this.authActive = false;
    this.themeRequested = false;
    this.initialized = false;
    this.authWindowHandler = null;
    this.characterAttachedHandler = null;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.authWindowHandler = (event) => {
      this.setAuthActive(!!(event.detail && event.detail.open));
    };
    this.characterAttachedHandler = () => this.handleCharacterAttached();
    document.addEventListener('dw:authwindowchange', this.authWindowHandler);
    this.gmcp.on('Char.Vitals', this.characterAttachedHandler);
    this.gmcp.on('Char.Status', this.characterAttachedHandler);
    this.gmcp.on('Darkwind.Session.Recovered', this.characterAttachedHandler);
  }

  setAuthActive(active) {
    this.authActive = !!active;

    if (this.authActive) {
      this._cancelPendingStop();
      if (this.themeRequested) return;
      this.themeRequested = true;
      this.soundManager.loop(
        LOGIN_THEME.category,
        LOGIN_THEME.sound,
        LOGIN_THEME.id,
        LOGIN_THEME.volume
      );
      return;
    }

    this._cancelPendingStop();
    this.stopTimer = this.setTimer(() => {
      this.stopTimer = null;
      if (this.authActive || !this.themeRequested) return;
      this._stopTheme();
    }, AUTH_TRANSITION_GRACE_MS);
  }

  handleCharacterAttached() {
    this.authActive = false;
    this._cancelPendingStop();
    this._stopTheme();
  }

  _stopTheme() {
    if (!this.themeRequested) return;
    this.themeRequested = false;
    this.soundManager.stop(LOGIN_THEME.category, LOGIN_THEME.id);
  }

  _cancelPendingStop() {
    if (this.stopTimer === null) return;
    this.clearTimer(this.stopTimer);
    this.stopTimer = null;
  }

  destroy() {
    this._cancelPendingStop();
    if (this.authWindowHandler) {
      document.removeEventListener('dw:authwindowchange', this.authWindowHandler);
      this.authWindowHandler = null;
    }
    if (this.characterAttachedHandler) {
      this.gmcp.off('Char.Vitals', this.characterAttachedHandler);
      this.gmcp.off('Char.Status', this.characterAttachedHandler);
      this.gmcp.off('Darkwind.Session.Recovered', this.characterAttachedHandler);
      this.characterAttachedHandler = null;
    }
    this._stopTheme();
    this.authActive = false;
    this.initialized = false;
  }
}

export const loginThemeManager = new LoginThemeManager();
