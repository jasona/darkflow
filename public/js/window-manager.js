import { gmcp } from './gmcp.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';
import { dom, state } from './state.js';
import { panelManager } from './panel-manager.js';
import { renderLayout, collectFormData, updateElements } from './window-renderer.js';
import { socketReadyStateName, isSocketOpen, isSocketConnecting } from './socket-state.js';
import { ensureConnected, expectInboundWithin } from './connection.js';
import {
  DW_WINDOW_OPEN, DW_WINDOW_UPDATE, DW_WINDOW_CLOSE,
  DW_WINDOW_SUBMIT, DW_WINDOW_ACTION, DW_WINDOW_CLOSED,
  ACTION_SUBMIT, ACTION_CLOSE,
} from './window-types.js';

const AUTH_WINDOW_IDS = new Set(['login', 'newchar', 'charselect']);
const SHARED_VIDEO_GEOMETRY_KEY = 'darkwind-shared-video-window-geometry';
const AUTH_RESPONSE_TIMEOUT_MS = 8000;
let videoWindowCounter = 0;

export const windowManager = {
  windows: {},  // id -> { id, type, el, containerEl }

  init() {
    return installControllerLifecycle(this, 'windows', gmcp, (scopedGmcp, lifecycle) => {
      scopedGmcp.on(DW_WINDOW_OPEN, (data) => this.openWindow(data));
      scopedGmcp.on(DW_WINDOW_UPDATE, (data) => this.updateWindow(data));
      scopedGmcp.on(DW_WINDOW_CLOSE, (data) => this.closeWindow(data.id));
      lifecycle.listen(document, 'dw:avatarZoom', (event) => this._openAvatarZoom(event.detail));
      lifecycle.listen(document, 'dw:connectionstate', () => this._syncAuthWindowConnectionState());
    }, () => {
      if (this._avatarZoomRelease) this._avatarZoomRelease();
      for (const id of Object.keys(this.windows)) this.closeWindow(id, true);
    });
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  openWindow(data) {
    if (!data || !data.id || !data.layout) return;
    if (state.zorkOnlyMode && this._isZorkOnlySuppressedWindow(data.id)) return;
    data = this._instanceSharedVideoWindow(data);

    // A reconnect replaces an auth window that may hold a half-typed
    // form; carry the values into the replacement so the player does
    // not start over.
    let preservedForm = null;
    if (this.windows[data.id] && AUTH_WINDOW_IDS.has(data.id)) {
      const existing = this.windows[data.id];
      if (existing.containerEl) {
        preservedForm = collectFormData(existing.containerEl);
      }
    }

    // Close existing window with same id
    if (this.windows[data.id]) {
      this.closeWindow(data.id, true);
    }

    const buttonHandler = (buttonId, action) => {
      this._handleButton(data.id, buttonId, action);
    };

    const content = renderLayout(data.layout, buttonHandler, { windowId: data.id });

    if (data.type === 'npc_dialogue') {
      this._openNpcDialogue(data, content);
    } else if (data.type === 'panel') {
      this._openPanel(data, content);
    } else {
      this._openModal(data, content);
    }

    if (preservedForm) {
      this._restoreFormValues(data.id, preservedForm);
    }
    if (AUTH_WINDOW_IDS.has(data.id)) {
      this._emitAuthWindowChange();
    }
  },

  hasAuthWindow() {
    for (const id of Object.keys(this.windows)) {
      if (AUTH_WINDOW_IDS.has(id) && this.windows[id].type === 'modal') return true;
    }
    return false;
  },

  _emitAuthWindowChange() {
    document.dispatchEvent(new CustomEvent('dw:authwindowchange', {
      detail: { open: this.hasAuthWindow() },
    }));
  },

  _restoreFormValues(id, saved) {
    const win = this.windows[id];
    if (!win || !win.containerEl || !saved) return;
    for (const [fieldId, value] of Object.entries(saved)) {
      if (value === '' || value === null || value === undefined) continue;
      const input = win.containerEl.querySelector('[data-dw-input="' + fieldId + '"]');
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = value;
    }
  },

  _instanceSharedVideoWindow(data) {
    if (!this._hasYoutubeEmbed(data.layout)) return data;

    const sourceId = String(data.id);
    const safeSourceId = sourceId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'video';
    const geometry = this._loadSharedVideoGeometry();
    return {
      ...data,
      id: safeSourceId + '-video-' + Date.now() + '-' + (++videoWindowCounter),
      sourceId,
      ...(geometry ? {
        dock: 'float',
        defaultFloatX: geometry.x,
        defaultFloatY: geometry.y,
        defaultFloatW: geometry.w,
        defaultFloatH: geometry.h,
        defaultSnapLeft: false,
        defaultSnapTop: false,
        defaultSnapRight: false,
        defaultSnapBottom: false,
      } : {}),
    };
  },

  _hasYoutubeEmbed(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'youtube_embed') return true;
    if (!Array.isArray(node.children)) return false;
    return node.children.some((child) => this._hasYoutubeEmbed(child));
  },

  _loadSharedVideoGeometry() {
    try {
      const raw = localStorage.getItem(SHARED_VIDEO_GEOMETRY_KEY);
      const geometry = raw ? JSON.parse(raw) : null;
      if (!geometry || typeof geometry !== 'object') return null;
      const x = Number(geometry.x);
      const y = Number(geometry.y);
      const w = Number(geometry.w);
      const h = Number(geometry.h);
      if (![x, y, w, h].every(Number.isFinite)) return null;
      return {
        x: Math.max(0, Math.min(x, Math.max(0, window.innerWidth - 80))),
        y: Math.max(0, Math.min(y, Math.max(0, window.innerHeight - 80))),
        w: Math.max(260, Math.min(w, Math.max(260, window.innerWidth - 24))),
        h: Math.max(180, Math.min(h, Math.max(180, window.innerHeight - 80))),
      };
    } catch (error) {
      return null;
    }
  },

  _saveSharedVideoGeometry(win) {
    if (!win || !win.sourceId || win.sourceId === win.id || win.type !== 'panel' || !win.panelId) return;
    const panel = panelManager.panels && panelManager.panels[win.panelId];
    const el = panel && panel.el;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const geometry = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };

    try {
      localStorage.setItem(SHARED_VIDEO_GEOMETRY_KEY, JSON.stringify(geometry));
    } catch (error) {
      // Ignore storage failures; video windows can still open normally.
    }
  },

  _isZorkOnlySuppressedWindow(id) {
    return id === 'login' || id === 'newchar' || id === 'charselect';
  },

  _openModal(data, content) {
    const isLogin = data.id === 'login';

    const overlay = document.createElement('div');
    overlay.className = 'dw-modal-overlay';
    if (isLogin) overlay.classList.add('dw-login-overlay');
    overlay.setAttribute('data-dw-window', data.id);

    const modal = document.createElement('div');
    modal.className = isLogin ? 'dw-modal dw-login-modal' : 'dw-modal';
    if (!isLogin) {
      if (data.width) modal.style.width = data.width + (typeof data.width === 'number' ? 'px' : '');
      if (data.height) modal.style.height = data.height + (typeof data.height === 'number' ? 'px' : '');
    }

    if (isLogin) {
      // Game-launcher two-panel layout: art left, form right
      const artPanel = document.createElement('div');
      artPanel.className = 'dw-login-art';
      const img = document.createElement('img');
      img.src = 'assets/login-background.jpg';
      img.alt = '';
      img.draggable = false;
      artPanel.appendChild(img);

      const formPanel = document.createElement('div');
      formPanel.className = 'dw-login-form';

      const brand = document.createElement('div');
      brand.className = 'dw-login-brand';
      brand.textContent = 'Darkwind';

      const tagline = document.createElement('div');
      tagline.className = 'dw-login-tagline';
      tagline.textContent = 'Enter the Realm';

      const body = document.createElement('div');
      body.className = 'dw-modal-body dw-login-body';
      body.appendChild(content);

      formPanel.appendChild(brand);
      formPanel.appendChild(tagline);
      formPanel.appendChild(body);

      modal.appendChild(artPanel);
      modal.appendChild(formPanel);
      overlay.appendChild(modal);
    } else {
      // Standard modal layout
      const titleBar = document.createElement('div');
      titleBar.className = 'dw-modal-header';
      const titleText = document.createElement('span');
      titleText.className = 'dw-modal-title';
      titleText.textContent = data.title || '';
      titleBar.appendChild(titleText);

      if (data.closable !== false) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'dw-modal-close';
        closeBtn.innerHTML = '&#x2715;';
        closeBtn.addEventListener('click', () => this._userClose(data.id));
        titleBar.appendChild(closeBtn);
      }

      const body = document.createElement('div');
      body.className = 'dw-modal-body';
      body.appendChild(content);

      modal.appendChild(titleBar);
      modal.appendChild(body);
      overlay.appendChild(modal);
    }

    // Resolve the body container for form data collection
    const bodyContainer = isLogin
      ? modal.querySelector('.dw-login-body')
      : modal.querySelector('.dw-modal-body');

    // Close on backdrop click
    if (data.closable !== false) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this._userClose(data.id);
      });
    }

    // Close on Escape, submit on Enter
    const escHandler = (e) => {
      if (e.key === 'Escape' && data.closable !== false) {
        this._userClose(data.id);
      }
      if (e.key === 'Enter') {
        const active = document.activeElement;
        // Don't submit if typing in a textarea or explicitly focused on a non-submit button
        if (active && active.tagName === 'TEXTAREA') return;
        if (active && active.tagName === 'BUTTON' && !active.classList.contains('dw-button-primary')) return;
        const submitBtn = modal.querySelector('.dw-button-primary');
        if (submitBtn) {
          e.preventDefault();
          submitBtn.click();
        }
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);

    // Auto-focus first input for login modal
    if (isLogin) {
      const firstInput = modal.querySelector('.dw-input');
      if (firstInput) firstInput.focus();
    }

    this.windows[data.id] = {
      id: data.id,
      sourceId: data.sourceId || data.id,
      type: 'modal',
      el: overlay,
      containerEl: bodyContainer,
      escHandler,
    };

    // Auth windows carry a live connection strip so the player can see
    // whether the modal is actually backed by a working connection.
    if (AUTH_WINDOW_IDS.has(data.id) && bodyContainer) {
      const strip = document.createElement('div');
      strip.className = 'dw-conn-strip';

      const stripDot = document.createElement('span');
      stripDot.className = 'dw-conn-strip-dot';
      const stripSpinner = document.createElement('span');
      stripSpinner.className = 'dw-spinner dw-spinner-small';
      const stripLabel = document.createElement('span');
      stripLabel.className = 'dw-conn-strip-label';

      strip.appendChild(stripDot);
      strip.appendChild(stripSpinner);
      strip.appendChild(stripLabel);
      bodyContainer.prepend(strip);
      this.windows[data.id].connStripEl = strip;
      this.windows[data.id].connStripLabelEl = stripLabel;
    }

    this._syncWindowConnectionState(data.id);
  },

  _openPanel(data, content) {
    const dock = data.dock || 'right';
    const order = data.order !== undefined ? data.order : 99;

    const bodyEl = panelManager.createDynamicPanel(
      'dw-' + data.id,
      data.title || data.id,
      dock,
      order,
      () => this._userClose(data.id),
      data
    );

    if (!bodyEl) return;
    bodyEl.appendChild(content);

    this.windows[data.id] = {
      id: data.id,
      sourceId: data.sourceId || data.id,
      type: 'panel',
      el: null,
      containerEl: bodyEl,
      panelId: 'dw-' + data.id,
    };
  },

  _openNpcDialogue(data, content) {
    const boundsHost = document.getElementById('main-content') ||
      dom.outputShell || document.body;
    const host = document.body;
    const overlay = document.createElement('div');
    overlay.className = 'dw-npc-dialogue-overlay';
    overlay.setAttribute('data-dw-window', data.id);

    const frame = document.createElement('div');
    frame.className = 'dw-npc-dialogue-frame';

    const body = document.createElement('div');
    body.className = 'dw-npc-dialogue-body';
    body.appendChild(content);

    if (data.closable !== false) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'dw-npc-dialogue-close';
      closeBtn.innerHTML = '&#x2715;';
      closeBtn.setAttribute('aria-label', 'Close dialogue');
      closeBtn.addEventListener('click', () => this._userClose(data.id));
      frame.appendChild(closeBtn);
    }

    const escHandler = (event) => {
      if (event.key !== 'Escape' || data.closable === false) return;
      event.preventDefault();
      event.stopPropagation();
      this._userClose(data.id);
    };

    frame.appendChild(body);
    overlay.appendChild(frame);
    host.appendChild(overlay);

    const syncBounds = () => {
      const rect = boundsHost.getBoundingClientRect();
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
    };
    const resizeHandler = () => syncBounds();
    let boundsObserver = null;
    syncBounds();
    window.addEventListener('resize', resizeHandler);
    if (typeof ResizeObserver === 'function') {
      boundsObserver = new ResizeObserver(syncBounds);
      boundsObserver.observe(boundsHost);
    }
    document.addEventListener('keydown', escHandler, true);

    this.windows[data.id] = {
      id: data.id,
      sourceId: data.sourceId || data.id,
      type: 'npc_dialogue',
      el: overlay,
      containerEl: body,
      escHandler,
      boundsObserver,
      resizeHandler,
    };
  },

  updateWindow(data) {
    if (!data || !data.id) return;
    const win = this.windows[data.id];
    if (!win) return;
    if (Array.isArray(data.updates)) {
      updateElements(win.containerEl, data.updates);
    }
  },

  closeWindow(id, silent) {
    const win = this.windows[id];
    if (!win) return;
    this._saveSharedVideoGeometry(win);

    if (win.revalidateTimer) {
      clearTimeout(win.revalidateTimer);
      win.revalidateTimer = null;
    }

    if (win.type === 'modal') {
      if (win.escHandler) document.removeEventListener('keydown', win.escHandler);
      if (win.el) win.el.remove();
    } else if (win.type === 'npc_dialogue') {
      if (win.escHandler) document.removeEventListener('keydown', win.escHandler, true);
      if (win.boundsObserver) win.boundsObserver.disconnect();
      if (win.resizeHandler) window.removeEventListener('resize', win.resizeHandler);
      if (win.el) win.el.remove();
    } else if (win.type === 'panel' && win.panelId) {
      panelManager.removeDynamicPanel(win.panelId);
    }

    delete this.windows[id];
    if (AUTH_WINDOW_IDS.has(id)) {
      this._emitAuthWindowChange();
    }
  },

  _userClose(id) {
    if (!gmcp.send(DW_WINDOW_CLOSED, { id })) {
      if (AUTH_WINDOW_IDS.has(id)) {
        this._showConnectionMessage(id);
        return;
      }
      this.closeWindow(id, true);
      return;
    }
    this.closeWindow(id, true);
  },

  _handleButton(windowId, buttonId, action) {
    if (action === ACTION_CLOSE) {
      this._userClose(windowId);
      return;
    }

    if (!isSocketOpen(state.ws)) {
      this._showConnectionMessage(windowId);
      this._syncWindowConnectionState(windowId);
      return;
    }

    if (action === ACTION_SUBMIT) {
      const win = this.windows[windowId];
      if (!win) return;
      const data = collectFormData(win.containerEl);
      if (!gmcp.send(DW_WINDOW_SUBMIT, { id: windowId, button: buttonId, data })) {
        this._showConnectionMessage(windowId);
        this._syncWindowConnectionState(windowId);
      } else if (AUTH_WINDOW_IDS.has(windowId)) {
        // A login/charselect submit must produce a server response. If
        // none arrives the socket is dead even though it looks open;
        // force the reconnect instead of leaving a frozen modal.
        expectInboundWithin(AUTH_RESPONSE_TIMEOUT_MS, 'auth window got no response');
      }
    } else {
      if (!gmcp.send(DW_WINDOW_ACTION, { id: windowId, button: buttonId })) {
        this._showConnectionMessage(windowId);
        this._syncWindowConnectionState(windowId);
      } else if (AUTH_WINDOW_IDS.has(windowId)) {
        expectInboundWithin(AUTH_RESPONSE_TIMEOUT_MS, 'auth window got no response');
      }
    }
  },

  _syncAuthWindowConnectionState() {
    for (const id of Object.keys(this.windows)) {
      this._syncWindowConnectionState(id);
    }
  },

  _syncWindowConnectionState(id) {
    const win = this.windows[id];
    if (!win || win.type !== 'modal' || !AUTH_WINDOW_IDS.has(id)) return;

    const connected = isSocketOpen(state.ws);
    const connecting = isSocketConnecting(state.ws)
      || !!state.reconnectTimer || !!state.connectionPending;
    const buttons = win.containerEl ? win.containerEl.querySelectorAll('button') : [];
    for (const button of buttons) {
      button.disabled = !connected;
    }

    // A kept modal is only trustworthy if the new connection re-opens
    // it (same id, replacing this record). If that has not happened
    // shortly after reconnect, the server is running a different login
    // flow and this window is a zombie -- close it so the player sees
    // what the server is actually doing instead of a dead form.
    if (connected && win.keptFromPreviousConnection && !win.revalidateTimer) {
      win.revalidateTimer = setTimeout(() => {
        if (this.windows[id] === win) {
          this.closeWindow(id, true);
        }
      }, 8000);
    }

    if (win.connStripEl) {
      win.connStripEl.classList.toggle('is-connected', connected);
      win.connStripEl.classList.toggle('is-reconnecting', !connected && connecting);
      win.connStripEl.classList.toggle('is-disconnected', !connected && !connecting);
      if (win.connStripLabelEl) {
        win.connStripLabelEl.textContent = connected
          ? 'Connected'
          : (connecting ? 'Reconnecting...' : 'Disconnected');
      }
    }

    // The modal does the work: if it is visible while the session is
    // down and nothing is retrying, kick a reconnect rather than
    // waiting for the player to find the toolbar Connect button.
    if (!connected && !connecting && !state.userDisconnected) {
      ensureConnected();
    }
  },

  _showConnectionMessage(id) {
    const win = this.windows[id];
    if (!win || !win.containerEl) return;

    if (AUTH_WINDOW_IDS.has(id) && !state.userDisconnected) {
      ensureConnected();
    }

    const errorEl = win.containerEl.querySelector('[data-dw-id="error"]');
    const readyStateName = socketReadyStateName(state.ws);
    const reconnecting = state.reconnectTimer || state.connectionPending || readyStateName === 'connecting';
    const message = reconnecting
      ? 'Connection lost. Reconnecting...'
      : 'Connection lost. Retrying...';

    if (errorEl) {
      errorEl.textContent = message;
      return;
    }

    const existing = win.containerEl.querySelector('[data-dw-id="connection-error"]');
    if (existing) {
      existing.textContent = message;
      return;
    }

    const fallback = document.createElement('p');
    fallback.className = 'dw-paragraph';
    fallback.setAttribute('data-dw-id', 'connection-error');
    fallback.style.color = '#f85149';
    fallback.style.textAlign = 'center';
    fallback.textContent = message;
    win.containerEl.prepend(fallback);
  },

  _openAvatarZoom(detail) {
    if (!detail || !detail.src) return;

    if (this._avatarZoomRelease) this._avatarZoomRelease();
    const existing = document.querySelector('.dw-avatar-lightbox-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'dw-avatar-lightbox-overlay';

    const frame = document.createElement('div');
    frame.className = 'dw-avatar-lightbox-frame';
    frame.setAttribute('role', 'dialog');
    frame.setAttribute('aria-modal', 'true');
    frame.setAttribute('aria-label', detail.name ? detail.name + ' avatar' : 'Player avatar');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dw-avatar-lightbox-close';
    closeBtn.innerHTML = '&#x2715;';

    const img = document.createElement('img');
    img.className = 'dw-avatar-lightbox-image';
    img.src = detail.src;
    img.alt = detail.alt || '';
    img.draggable = false;
    img.addEventListener('error', () => {
      if (detail.fallback && img.src !== detail.fallback) img.src = detail.fallback;
    });

    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
    };
    const release = this._controllerLifecycle
      ? this._controllerLifecycle.own('teardown', cleanup)
      : cleanup;
    const close = () => {
      release();
      if (this._avatarZoomRelease === close) this._avatarZoomRelease = null;
    };
    const keyHandler = (event) => {
      if (event.key === 'Escape') close();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', keyHandler);

    frame.appendChild(closeBtn);
    frame.appendChild(img);
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    this._avatarZoomRelease = close;
    closeBtn.focus();
  },

  resetAll(options = {}) {
    for (const id of Object.keys(this.windows)) {
      if (options.keepAuth && AUTH_WINDOW_IDS.has(id) &&
        this.windows[id].type === 'modal') {
        // Keep the auth modal alive across a drop; its connection strip
        // reports the reconnect and the next login window replaces it.
        // Mark it stale: if the next connection does not re-open it,
        // it is a zombie (the server is not listening to that window)
        // and must not sit there swallowing the player's credentials.
        this.windows[id].keptFromPreviousConnection = true;
        this._syncWindowConnectionState(id);
        continue;
      }
      this.closeWindow(id, true);
    }
  },
};
