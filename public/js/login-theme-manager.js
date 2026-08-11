import { soundManager } from './sound-manager.js';
import { gmcp } from './gmcp.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

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
    this.setTimer = timers.setTimeout || setTimeout.bind(globalThis);
    this.clearTimer = timers.clearTimeout || clearTimeout.bind(globalThis);
    this.stopTimer = null;
    this.authActive = false;
    this.themeRequested = false;
    this.initialized = false;
    this.authWindowHandler = null;
    this.characterAttachedHandler = null;
  }

  init() {
    return installControllerLifecycle(this, 'login-theme', this.gmcp, (scopedGmcp, lifecycle) => {
      this.initialized = true;
      this.authWindowHandler = (event) => {
        this.setAuthActive(!!(event.detail && event.detail.open));
      };
      this.characterAttachedHandler = () => this.handleCharacterAttached();
      lifecycle.listen(document, 'dw:authwindowchange', this.authWindowHandler);
      scopedGmcp.on('Char.Vitals', this.characterAttachedHandler);
      scopedGmcp.on('Char.Status', this.characterAttachedHandler);
      scopedGmcp.on('Darkwind.Session.Recovered', this.characterAttachedHandler);
    }, () => {
      this._cancelPendingStop();
      this._stopTheme();
      this.authActive = false;
      this.authWindowHandler = null;
      this.characterAttachedHandler = null;
      this.initialized = false;
    });
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
    disposeControllerLifecycle(this);
  }
}

export const loginThemeManager = new LoginThemeManager();
