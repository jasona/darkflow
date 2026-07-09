import { gmcp } from './gmcp.js';
import { state as appState } from './state.js';
import { PANEL_DEFS, PANEL_STORAGE_KEY } from './panel-defs.js';
import { openPaneFontSettings } from './pane-settings.js';
import { panelRenderers } from './panel-renderers.js';
import { parseAnsiText } from './ansi.js';
import {
  findFirstImageUrlFromFragments,
  imagePreviewLabel,
  openFirstImagePreviewFromText,
  openImagePreviewPane,
} from './image-preview.js';
import {
  processCurrent as processMapData2Current,
  mergeServerAreaData as mergeMapData2Area,
  mergeServerUpdate as mergeMapData2Update,
  mergeBrowseArea as mergeMapData2Browse,
  exitBrowse as exitMapData2Browse,
  clearMapData as clearMapData2,
  clearMapDataForArea as clearMapData2ForArea,
  load as loadMapData2,
  processSyncError as processMapData2Error,
} from './map-data-v2.js';
import { load as loadGenericMapData } from './map-data-gmcp.js';
import {
  markMapData2Active,
  processGenericHello,
  processGenericRoomInfo,
  resetLiveMapModeForConnection,
} from './live-map-source.js';

const MOBILE_BREAKPOINT_PX = 700;
const MOBILE_PRIMARY_PANELS = ['room', 'vitals', 'guildVitals', 'xpmon', 'sky', 'omens', 'buffs', 'inventory', 'map', 'chat', 'quests', 'achievements'];
const AVATAR_CHARGE_TICK_MS = 2000;
const PANEL_STORAGE_VERSION = 2;
const TERMINAL_PANEL_ID = 'terminal';
const FLOAT_GRID_SIZE = 16;
const FLOAT_PANEL_MIN_W = 200;
const FLOAT_PANEL_MIN_H = 80;
const TERMINAL_PANEL_MIN_W = 420;
const TERMINAL_PANEL_MIN_H = 260;

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeDefenceKind(kind) {
  return kind === 'debuff' ? 'debuff' : (kind === 'unknown' ? 'unknown' : 'buff');
}

function normalizeDefenceEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = entry.name !== undefined && entry.name !== null ? String(entry.name) : '';
  if (!name) return null;
  const duration = Number(entry.duration) || 0;
  const remaining = Number(entry.remaining) || 0;
  return {
    name,
    desc: entry.desc !== undefined && entry.desc !== null ? String(entry.desc) : '',
    kind: normalizeDefenceKind(entry.kind),
    duration,
    remaining,
    expiresAt: remaining > 0 ? Date.now() + (remaining * 1000) : 0,
  };
}

function findDefenceIndex(entries, entry) {
  return entries.findIndex((current) =>
    current.name === entry.name || (!!entry.desc && current.desc === entry.desc)
  );
}

function normalizeChannelName(data) {
  if (typeof data === 'string') return data.trim();
  if (data && typeof data === 'object') {
    if (typeof data.channel === 'string') return data.channel.trim();
    if (typeof data.name === 'string') return data.name.trim();
  }
  return '';
}

function isFullVitalsPayload(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(data, 'hp')) return false;
  if (!Object.prototype.hasOwnProperty.call(data, 'maxhp')) return false;
  const hasSp = Object.prototype.hasOwnProperty.call(data, 'sp');
  const hasMaxSp = Object.prototype.hasOwnProperty.call(data, 'maxsp');
  return hasSp === hasMaxSp;
}

function chatMessageKey(message) {
  const channel = String(message.channel || message.chan || '').toLowerCase();
  const talker = String(message.talker || message.player || '').toLowerCase();
  const text = String(message.text || message.msg || '');
  return channel + '\n' + talker + '\n' + text;
}

export const panelManager = {
  state: { docks: { left: false, right: false }, panels: {} },
  panels: {},
  gmcpData: {},
  _initialized: false,
  _workspaceLayout: 'classic',
  _storedProfiles: null,
  _hiddenByDefault: new Set(),
  _hadSavedEntry: new Set(),
  _terminalAnchors: null,
  _topFloatZ: 1000,
  _flushHandlersAttached: false,
  _saveTimer: null,
  _subscriptionTimer: null,
  _characterSubscriptionSyncSent: false,
  _commChannelPlayersRequested: false,
  _panelCloseHandlers: {},
  _buffTimer: null,
  _skyTimer: null,
  _avatarMeterTicker: null,
  _avatarActiveEndAt: 0,
  // Server-provided full active duration, with old-server fallback in _updateAvatarMeter.
  _avatarActiveMaxSec: 0,
  _avatarChargeSync: null,
  _draggingEnemyPanel: false,
  _syncEnemyPanelAfterDrag: false,
  _pendingPanelRenders: new Set(),
  _panelRenderFrame: null,
  _mobile: {
    enabled: false,
    sheetOpen: false,
    activePanelId: null,
    desktopSnapshot: null,
    overlayEl: null,
    tabsEl: null,
    extraSelectEl: null,
    contentEl: null,
    emptyEl: null,
  },

  init() {
    if (appState.zorkOnlyMode) {
      this.disableForZorkOnlyMode();
      loadMapData2();
      loadGenericMapData();
      this.registerGmcpHandlers();
      return;
    }

    this._workspaceLayout = this._getRequestedWorkspaceLayout();
    this.loadState();
    this.buildPanelsMenu();
    this._ensureMobileSheet();

    this._syncWorkspaceClass();
    if (this._isFloatingWorkspace()) {
      this.createTerminalPanel();
    } else {
      this._restoreTerminalToClassic();
    }

    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }

    this._applyDockStateToDom();
    this.repositionAnchoredPanels();
    loadMapData2();
    loadGenericMapData();
    this.attachDragHandlers();
    this._attachPersistenceFlushHandlers();
    this.registerGmcpHandlers();
    this._attachResizeHandler();
    this._syncResponsiveMode(true);
    this._applyPaneFont(TERMINAL_PANEL_ID);
    document.addEventListener('dw:connectionstate', (event) => {
      const connected = event.detail && event.detail.state === 'connected';
      if (connected) this._armSubscriptionSyncFallback();
      else this._clearSubscriptionSyncFallback();
    });
    this._initialized = true;
    this._notifyWorkspaceLayoutChanged();
  },

  setHiddenByDefault(ids) {
    if (appState.zorkOnlyMode) return;
    this._hiddenByDefault = new Set(Array.isArray(ids) ? ids : []);
    for (const id of this._hiddenByDefault) {
      if (!PANEL_DEFS[id]) continue;
      if (this._hasSavedPanelState(id)) continue;
      const st = this.state.panels[id];
      if (st && st.visible) this.closePanel(id);
    }
  },

  exportState() {
    this._storeActiveProfile();
    return cloneState(this._storedProfiles || this._createPanelStorageEnvelope(null));
  },

  applyImportedState(nextState) {
    if (appState.zorkOnlyMode) return;
    if (!nextState || typeof nextState !== 'object') return;

    try {
      localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(nextState));
    } catch (error) {
      console.warn('Failed to save imported panel state', error);
    }

    this._resetLivePanels();
    this.loadState();
    this.buildPanelsMenu();
    this._syncWorkspaceClass();
    if (this._isFloatingWorkspace()) {
      this.createTerminalPanel();
    } else {
      this._restoreTerminalToClassic();
    }

    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id] && this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }

    this._applyDockStateToDom();
    this._renderMobileSheet();
    if (!this._mobile.enabled) {
      this.repositionAnchoredPanels();
      this.repositionSnappedPanels();
    }
    this.syncGmcpSubscriptions('visibility-sync', true);
  },

  resetLayoutState() {
    if (appState.zorkOnlyMode) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    try {
      localStorage.removeItem(PANEL_STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to reset panel layout state', error);
    }

    this._storedProfiles = null;
    this._hadSavedEntry.clear();
    this._resetLivePanels();
    this.loadState();
    this.buildPanelsMenu();
    this._syncWorkspaceClass();
    if (this._isFloatingWorkspace()) {
      this.createTerminalPanel();
    } else {
      this._restoreTerminalToClassic();
    }

    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id] && this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }

    this._applyDockStateToDom();
    this._renderMobileSheet();
    if (!this._mobile.enabled) {
      this.repositionAnchoredPanels();
      this.repositionSnappedPanels();
    }
    this.saveState();
    this.syncGmcpSubscriptions('layout-reset', true);
    this._notifyOutputLayoutChanged();
  },

  getSubscriptionPanels() {
    if (appState.zorkOnlyMode) return {};
    const panels = {};
    for (const id of Object.keys(PANEL_DEFS)) {
      panels[id] = !!(this.state.panels[id] && this.state.panels[id].visible);
    }
    panels.vitals = true;
    if (panels.buffs) panels.status = true;
    return panels;
  },

  syncGmcpSubscriptions(reason = 'visibility-sync', full = false, extraFeatures = {}) {
    if (appState.zorkOnlyMode) return;
    if (this._subscriptionTimer) clearTimeout(this._subscriptionTimer);
    this._subscriptionTimer = setTimeout(() => {
      this._subscriptionTimer = null;
      gmcp.sendSubscriptions({
        reason,
        full,
        panels: this.getSubscriptionPanels(),
        features: extraFeatures,
      });
    }, 150);
  },

  _getRequestedWorkspaceLayout() {
    return appState.settings && appState.settings.workspaceLayout === 'floating'
      ? 'floating'
      : 'classic';
  },

  _isFloatingWorkspace() {
    return this._workspaceLayout === 'floating';
  },

  isFloatingWorkspace() {
    return this._isFloatingWorkspace();
  },

  _isPaneGridSnapEnabled() {
    return !!(appState.settings && appState.settings.paneGridSnapEnabled);
  },

  _snapToFloatGrid(value) {
    return Math.round(Number(value || 0) / FLOAT_GRID_SIZE) * FLOAT_GRID_SIZE;
  },

  _getFloatMinSize(id) {
    return id === TERMINAL_PANEL_ID
      ? { width: TERMINAL_PANEL_MIN_W, height: TERMINAL_PANEL_MIN_H }
      : { width: FLOAT_PANEL_MIN_W, height: FLOAT_PANEL_MIN_H };
  },

  _snapFloatSizeToGrid(id, width, height) {
    const min = this._getFloatMinSize(id);
    return {
      width: Math.max(min.width, this._snapToFloatGrid(width)),
      height: Math.max(min.height, this._snapToFloatGrid(height)),
    };
  },

  _measureFloatPanel(el) {
    if (!el || el.style.display === 'none') return null;
    let width = 0;
    let height = 0;
    if (typeof window.getComputedStyle === 'function') {
      const cs = window.getComputedStyle(el);
      width = parseFloat(cs.width) || 0;
      height = parseFloat(cs.height) || 0;
    }
    if ((!width || !height) && el.getBoundingClientRect) {
      const rect = el.getBoundingClientRect();
      width = width || rect.width || 0;
      height = height || rect.height || 0;
    }
    width = width || el.offsetWidth || el.clientWidth || 0;
    height = height || el.offsetHeight || el.clientHeight || 0;
    if (width <= 0 || height <= 0) return null;
    return {
      width: Math.round(width),
      height: Math.round(height),
    };
  },

  _clampGridPosition(x, y, width, height) {
    const bounds = this._getSnapBounds();
    const maxX = Math.max(bounds.left, bounds.right - width);
    const maxY = Math.max(bounds.top, bounds.bottom - height);
    return {
      x: Math.max(bounds.left, Math.min(maxX, x)),
      y: Math.max(bounds.top, Math.min(maxY, y)),
    };
  },

  _getGridSnappedFloatPosition(x, y, width, height, edges = {}) {
    if (!this._isPaneGridSnapEnabled()) return { x, y };

    let nextX = x;
    let nextY = y;
    if (!edges.left && !edges.right) {
      nextX = this._snapToFloatGrid(nextX);
    }
    if (!edges.top && !edges.bottom) {
      nextY = this._snapToFloatGrid(nextY);
    }

    return this._clampGridPosition(nextX, nextY, width, height);
  },

  _snapPanelStateToGrid(id, st) {
    if (!st || st.dock !== 'float' || !this._isPaneGridSnapEnabled()) return false;

    const size = this._snapFloatSizeToGrid(id, st.floatW || 280, st.floatH || 200);
    if (st.panelAnchor) {
      const changed = st.floatW !== size.width || st.floatH !== size.height;
      st.floatW = size.width;
      st.floatH = size.height;
      return changed;
    }

    const pos = this._getGridSnappedFloatPosition(st.floatX || 0, st.floatY || 0,
      size.width, size.height, {
        left: st.snapLeft,
        top: st.snapTop,
        right: st.snapRight,
        bottom: st.snapBottom,
      });
    const changed = st.floatW !== size.width || st.floatH !== size.height ||
      (!st.snapLeft && !st.snapRight && st.floatX !== pos.x) ||
      (!st.snapTop && !st.snapBottom && st.floatY !== pos.y);

    st.floatW = size.width;
    st.floatH = size.height;
    if (!st.snapLeft && !st.snapRight) st.floatX = pos.x;
    if (!st.snapTop && !st.snapBottom) st.floatY = pos.y;

    return changed;
  },

  snapFloatingPanesToGrid() {
    if (this._mobile.enabled || !this._isPaneGridSnapEnabled()) return;
    let changed = false;

    for (const [id, st] of Object.entries(this.state.panels)) {
      if (!st || st.dock !== 'float') continue;
      changed = this._snapPanelStateToGrid(id, st) || changed;
      const panel = this.panels[id];
      if (panel && panel.el) {
        this._applyFloatPosition(panel.el, st);
      }
    }

    if (changed) {
      this.saveState();
      this._notifyOutputLayoutChanged();
    }
  },

  setPaneGridSnapEnabled(enabled, options = {}) {
    if (!enabled || appState.zorkOnlyMode) return;
    // Never re-sweep saved positions during startup: the layout/CSS may not
    // have settled yet, and the sweep clamps every floating pane and SAVES the
    // result. Saved positions were already snapped when the user placed them.
    if (options.initializing) return;
    this.snapFloatingPanesToGrid();
  },

  _syncWorkspaceClass() {
    document.body.classList.toggle('floating-workspace-mode', this._isFloatingWorkspace());
  },

  _createPanelStorageEnvelope(saved) {
    const classicProfile = this._normalizeSavedProfile(saved && saved.version === PANEL_STORAGE_VERSION
      ? saved.profiles && saved.profiles.classic
      : saved);
    const floatingProfile = this._normalizeSavedProfile(saved && saved.version === PANEL_STORAGE_VERSION
      ? saved.profiles && saved.profiles.floating
      : null);

    if (!floatingProfile.panels[TERMINAL_PANEL_ID]) {
      floatingProfile.panels[TERMINAL_PANEL_ID] = this._defaultTerminalPanelState();
    }

    if (saved && saved.version === PANEL_STORAGE_VERSION && saved.profiles) {
      return {
        version: PANEL_STORAGE_VERSION,
        profiles: {
          classic: classicProfile,
          floating: floatingProfile,
        },
      };
    }

    return {
      version: PANEL_STORAGE_VERSION,
      profiles: {
        classic: classicProfile,
        floating: this._createInitialFloatingProfile(classicProfile, floatingProfile),
      },
    };
  },

  _normalizeSavedProfile(profile) {
    const next = profile && typeof profile === 'object' ? profile : {};
    return {
      docks: {
        left: !!(next.docks && next.docks.left),
        right: !!(next.docks && next.docks.right),
      },
      panels: next.panels && typeof next.panels === 'object'
        ? cloneState(next.panels)
        : {},
    };
  },

  _createInitialFloatingProfile(classicProfile, floatingProfile) {
    const profile = this._normalizeSavedProfile(floatingProfile);
    const sourcePanels = classicProfile && classicProfile.panels ? classicProfile.panels : {};
    profile.docks = { left: true, right: true };
    profile.panels[TERMINAL_PANEL_ID] = this._defaultTerminalPanelState();

    let leftCount = 0;
    let rightCount = 0;
    for (const [id, def] of Object.entries(PANEL_DEFS)) {
      if (profile.panels[id]) continue;
      const source = sourcePanels[id] || {};
      const fromLeft = def.defaultDock === 'left';
      const index = fromLeft ? leftCount++ : rightCount++;
      const width = source.floatW || def.defaultFloatW || 280;
      const height = source.floatH || def.defaultFloatH || 200;
      const zLayer = this._normalizePaneLayer(source.zLayer, id);
      const hasFloatSource = source.dock === 'float';
      let snapLeft = hasFloatSource ? !!source.snapLeft : !!def.defaultSnapLeft;
      let snapTop = hasFloatSource ? !!source.snapTop : !!def.defaultSnapTop;
      let snapRight = hasFloatSource ? !!source.snapRight : !!def.defaultSnapRight;
      let snapBottom = hasFloatSource ? !!source.snapBottom : !!def.defaultSnapBottom;
      let x;
      let y;

      if (hasFloatSource && source.floatX !== undefined) {
        x = source.floatX;
      } else if (def.defaultFloatX !== undefined) {
        x = def.defaultFloatX < 0 ? window.innerWidth + def.defaultFloatX : def.defaultFloatX;
      } else if (def.defaultDock === 'float') {
        x = Math.round((window.innerWidth - width) / 2);
      } else {
        x = fromLeft ? 18 : Math.max(18, window.innerWidth - width - 18);
        if (!snapLeft && !snapRight) {
          snapLeft = fromLeft;
          snapRight = !fromLeft;
        }
      }

      if (hasFloatSource && source.floatY !== undefined) {
        y = source.floatY;
      } else if (def.defaultFloatY !== undefined) {
        y = def.defaultFloatY < 0 ? window.innerHeight + def.defaultFloatY : def.defaultFloatY;
      } else if (def.defaultDock === 'float') {
        y = Math.round((window.innerHeight - height) / 2);
      } else {
        y = 58 + (index * 34);
      }

      if (!hasFloatSource && def.defaultBelowPanel && profile.panels[def.defaultBelowPanel]) {
        const refPanel = profile.panels[def.defaultBelowPanel];
        x = refPanel.floatX;
        y = refPanel.floatY + refPanel.floatH + 8;
        snapLeft = !!refPanel.snapLeft;
        snapRight = !!refPanel.snapRight;
        snapTop = false;
        snapBottom = false;
      }

      profile.panels[id] = {
        dock: source.dock === 'float' ? 'float' : 'float',
        order: source.order !== undefined ? source.order : def.defaultOrder,
        collapsed: !!source.collapsed,
        visible: source.visible !== undefined
          ? source.visible
          : (def.defaultVisible !== undefined ? def.defaultVisible : true),
        floatX: x,
        floatY: y,
        floatW: width,
        floatH: height,
        floatZ: this._getEffectivePaneZIndex(id, { zLayer }),
        zLayer,
        snapLeft,
        snapTop,
        snapRight,
        snapBottom,
        font: source.font,
      };
    }

    return profile;
  },

  _storeActiveProfile() {
    if (!this._storedProfiles) {
      this._storedProfiles = this._createPanelStorageEnvelope(null);
    }
    this._storedProfiles.profiles[this._workspaceLayout] = cloneState(this.state);
  },

  _hasSavedPanelState(id) {
    if (this._hadSavedEntry.has(id)) return true;
    const activeProfile = this._storedProfiles &&
      this._storedProfiles.profiles &&
      this._storedProfiles.profiles[this._workspaceLayout];
    return !!(activeProfile && activeProfile.panels && activeProfile.panels[id]);
  },

  _getSavedPanelState(id) {
    const activeProfile = this._storedProfiles &&
      this._storedProfiles.profiles &&
      this._storedProfiles.profiles[this._workspaceLayout];
    const panelState = activeProfile && activeProfile.panels && activeProfile.panels[id];
    return panelState ? cloneState(panelState) : null;
  },

  _flushStoredProfiles() {
    if (!this._storedProfiles) return;
    try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(this._storedProfiles)); }
    catch(e) { /* ignore */ }
  },

  _flushPendingStateSave() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._mobile.enabled) return;
    this._storeActiveProfile();
    this._flushStoredProfiles();
  },

  _attachPersistenceFlushHandlers() {
    if (this._flushHandlersAttached) return;
    this._flushHandlersAttached = true;
    window.addEventListener('pagehide', () => this._flushPendingStateSave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this._flushPendingStateSave();
      }
    });
  },

  _defaultTerminalPanelState() {
    const toolbar = document.getElementById('toolbar');
    const inputBar = document.getElementById('input-bar');
    const statusBar = document.getElementById('status-bar');
    const top = (toolbar ? toolbar.offsetHeight : 42) + 10;
    const reservedBottom = (statusBar ? statusBar.offsetHeight : 0) + 12;
    const width = Math.max(520, Math.round(window.innerWidth * 0.58));
    const height = Math.max(360, window.innerHeight - top - reservedBottom - 80 + (inputBar ? inputBar.offsetHeight : 0));

    return {
      dock: 'float',
      order: 0,
      collapsed: false,
      visible: true,
      floatX: Math.max(12, Math.round((window.innerWidth - width) / 2)),
      floatY: top,
      floatW: Math.min(width, window.innerWidth - 24),
      floatH: Math.min(height, window.innerHeight - top - reservedBottom),
      floatZ: 1100,
      zLayer: this._defaultPaneLayer(TERMINAL_PANEL_ID),
      snapLeft: false,
      snapTop: true,
      snapRight: false,
      snapBottom: false,
    };
  },

  _normalizeTerminalPanelState(state) {
    const normalized = {
      ...this._defaultTerminalPanelState(),
      ...(state && typeof state === 'object' ? state : {}),
      visible: true,
      collapsed: false,
    };
    normalized.zLayer = this._normalizePaneLayer(normalized.zLayer, TERMINAL_PANEL_ID);
    normalized.floatZ = this._getEffectivePaneZIndex(TERMINAL_PANEL_ID, normalized);
    return normalized;
  },

  _defaultPaneZIndex(id) {
    return 1000 + (this._defaultPaneLayer(id) * 10);
  },

  _defaultPaneLayer(id) {
    const def = PANEL_DEFS[id];
    if (def && def.defaultLayer !== undefined) return Number(def.defaultLayer) || 0;
    return id === TERMINAL_PANEL_ID ? 10 : 0;
  },

  _normalizePaneLayer(value, id) {
    const fallback = this._defaultPaneLayer(id);
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    // Values at or above 1000 are legacy/internal CSS z-index values, not the
    // user-facing layer preference. Treat them as unsaved so old state does not
    // surface as odd defaults like 1447.
    if (next >= 1000) return fallback;
    return Math.max(0, Math.min(999, Math.round(next)));
  },

  _getEffectivePaneZIndex(id, st) {
    return 1000 + (this._normalizePaneLayer(st && st.zLayer, id) * 10);
  },

  _getFocusedPaneZIndex(id, st) {
    return this._getEffectivePaneZIndex(id, st) + 9;
  },

  setWorkspaceLayout(layout, options = {}) {
    const nextLayout = layout === 'floating' ? 'floating' : 'classic';
    if (this._workspaceLayout === nextLayout && !options.initializing) return;

    if (!this._initialized || appState.zorkOnlyMode) return;

    this._storeActiveProfile();
    this._flushStoredProfiles();
    this._workspaceLayout = nextLayout;
    this._syncWorkspaceClass();
    this._resetLivePanels();
    this.loadState();
    this.buildPanelsMenu();
    if (this._isFloatingWorkspace()) {
      this.createTerminalPanel();
    } else {
      this._restoreTerminalToClassic();
    }
    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id] && this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }
    this._applyDockStateToDom();
    this._renderMobileSheet();
    if (!this._mobile.enabled) {
      this.repositionAnchoredPanels();
      this.repositionSnappedPanels();
    }
    this.saveState();
    this._notifyOutputLayoutChanged();
    this._notifyWorkspaceLayoutChanged();
  },

  loadState() {
    let saved = null;
    try {
      const raw = localStorage.getItem(PANEL_STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch(e) { /* ignore */ }

    this._storedProfiles = this._createPanelStorageEnvelope(saved);
    this._workspaceLayout = this._getRequestedWorkspaceLayout();

    const activeProfile = this._storedProfiles.profiles[this._workspaceLayout] || {};
    if (activeProfile && activeProfile.docks) {
      this.state.docks = activeProfile.docks;
    } else {
      this.state.docks = { left: false, right: false };
    }

    const panels = {};
    this._hadSavedEntry.clear();
    if (activeProfile && activeProfile.panels && activeProfile.panels[TERMINAL_PANEL_ID]) {
      this._hadSavedEntry.add(TERMINAL_PANEL_ID);
      panels[TERMINAL_PANEL_ID] = this._normalizeTerminalPanelState(activeProfile.panels[TERMINAL_PANEL_ID]);
    } else if (this._isFloatingWorkspace()) {
      panels[TERMINAL_PANEL_ID] = this._defaultTerminalPanelState();
    }

    for (const [id, def] of Object.entries(PANEL_DEFS)) {
      const s = (activeProfile && activeProfile.panels && activeProfile.panels[id]) || {};
      const hasSavedState = !!(activeProfile && activeProfile.panels && activeProfile.panels[id]);
      if (hasSavedState) this._hadSavedEntry.add(id);
      const defW = def.defaultFloatW || 280;
      const defH = def.defaultFloatH || 200;
      let defaultSnapLeft = !!def.defaultSnapLeft;
      let defaultSnapTop = !!def.defaultSnapTop;
      let defaultSnapRight = !!def.defaultSnapRight;
      let defaultSnapBottom = !!def.defaultSnapBottom;
      let defX;
      let defY;
      if (def.defaultFloatX !== undefined) {
        defX = def.defaultFloatX;
        if (defX < 0) defX = window.innerWidth + defX;
      } else {
        defX = Math.round((window.innerWidth - defW) / 2);
      }
      if (def.defaultFloatY !== undefined) {
        defY = def.defaultFloatY;
        if (defY < 0) defY = window.innerHeight + defY;
      } else {
        defY = Math.round((window.innerHeight - defH) / 2);
      }
      if (!hasSavedState && def.defaultBelowPanel && panels[def.defaultBelowPanel]) {
        const refPanel = panels[def.defaultBelowPanel];
        defX = refPanel.floatX;
        defY = refPanel.floatY + refPanel.floatH + 8;
        defaultSnapLeft = !!refPanel.snapLeft;
        defaultSnapRight = !!refPanel.snapRight;
        defaultSnapBottom = false;
        defaultSnapTop = false;
      }
      const builtInDefaultVisible = def.defaultVisible !== undefined ? def.defaultVisible : true;
      const effectiveDefaultVisible = this._hiddenByDefault.has(id) ? false : builtInDefaultVisible;
      const zLayer = this._normalizePaneLayer(s.zLayer, id);
      let defaultDock = def.defaultDock;
      if (this._isFloatingWorkspace() && !hasSavedState) {
        defaultDock = 'float';
      }
      panels[id] = {
        dock: s.dock || defaultDock,
        order: s.order !== undefined ? s.order : def.defaultOrder,
        collapsed: !!s.collapsed,
        visible: s.visible !== undefined ? s.visible : effectiveDefaultVisible,
        floatX: s.floatX !== undefined ? s.floatX : defX,
        floatY: s.floatY !== undefined ? s.floatY : defY,
        floatW: s.floatW || defW,
        floatH: s.floatH || defH,
        floatZ: this._getEffectivePaneZIndex(id, { zLayer }),
        zLayer,
        snapLeft: s.snapLeft !== undefined ? !!s.snapLeft : defaultSnapLeft,
        snapTop: s.snapTop !== undefined ? !!s.snapTop : defaultSnapTop,
        snapRight: s.snapRight !== undefined ? !!s.snapRight : defaultSnapRight,
        snapBottom: s.snapBottom !== undefined ? !!s.snapBottom : defaultSnapBottom,
        // panelAnchor intentionally dropped: legacy saved anchors caused
        // positions to be re-derived (and re-saved) from live DOM rects on
        // every load, drifting panes across refreshes. Positions are
        // absolute floatX/floatY only.
        font: (s.font && typeof s.font === 'object') ? s.font : undefined,
      };
    }
    this.state.panels = panels;
    if (this._isPaneGridSnapEnabled()) {
      for (const [id, st] of Object.entries(this.state.panels)) {
        this._snapPanelStateToGrid(id, st);
      }
    }
    this._topFloatZ = Object.values(panels).reduce((max, panel) => {
      const z = Number(panel && panel.floatZ);
      return Number.isFinite(z) ? Math.max(max, z) : max;
    }, 1000);
  },

  saveState() {
    if (this._mobile.enabled) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._storeActiveProfile();
    this._flushStoredProfiles();
  },

  disableForZorkOnlyMode() {
    this._resetLivePanels();
    this.panels = {};
    this.state = { docks: { left: true, right: true }, panels: {} };
    this.gmcpData = {};
    this._characterSubscriptionSyncSent = false;
    this._commChannelPlayersRequested = false;
    this.buildPanelsMenu();
    this.closeMobileSheet();
    this._applyDockStateToDom();
  },

  buildPanelsMenu() {
    const menu = document.getElementById('panels-menu');
    if (!menu) return;
    menu.innerHTML = '';
    if (appState.zorkOnlyMode) return;
    for (const [id, def] of Object.entries(PANEL_DEFS)) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.state.panels[id].visible;
      cb.dataset.panelId = id;
      cb.addEventListener('change', () => {
        if (cb.checked) this.openPanel(id);
        else this.closePanel(id);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + def.title));
      menu.appendChild(label);
    }
  },

  setDockCollapsed(side, collapsed) {
    if (appState.zorkOnlyMode) return;
    if (this._mobile.enabled) return;
    this.state.docks[side] = collapsed;
    this._applyDockStateToDom();
    this.saveState();
  },

  toggleMobileSheet() {
    if (appState.zorkOnlyMode) return;
    if (!this._mobile.enabled) return;
    if (this._mobile.sheetOpen) this.closeMobileSheet();
    else this.openMobileSheet();
  },

  openMobileSheet() {
    if (appState.zorkOnlyMode) return;
    if (!this._mobile.enabled || !this._mobile.overlayEl) return;
    this._mobile.sheetOpen = true;
    this._mobile.overlayEl.classList.add('open');
    this._renderMobileSheet();
  },

  closeMobileSheet() {
    if (!this._mobile.overlayEl) return;
    this._mobile.sheetOpen = false;
    this._mobile.overlayEl.classList.remove('open');
  },

  _ensureTerminalAnchors() {
    if (this._terminalAnchors) return this._terminalAnchors;
    const outputShell = document.getElementById('output-shell');
    const inputBar = document.getElementById('input-bar');
    if (!outputShell || !inputBar) return null;
    this._terminalAnchors = {
      outputParent: outputShell.parentNode,
      outputNext: outputShell.nextSibling,
      inputParent: inputBar.parentNode,
      inputNext: inputBar.nextSibling,
    };
    return this._terminalAnchors;
  },

  createTerminalPanel() {
    if (appState.zorkOnlyMode) return;
    if (!this._isFloatingWorkspace()) return;
    if (this._mobile.enabled) return;
    if (this.panels[TERMINAL_PANEL_ID]) return;

    const anchors = this._ensureTerminalAnchors();
    const outputShell = document.getElementById('output-shell');
    const inputBar = document.getElementById('input-bar');
    if (!anchors || !outputShell || !inputBar) return;

    const st = this.state.panels[TERMINAL_PANEL_ID] || this._defaultTerminalPanelState();
    this.state.panels[TERMINAL_PANEL_ID] = this._normalizeTerminalPanelState(st);

    const el = document.createElement('div');
    el.className = 'gmcp-panel-widget terminal-panel-widget';
    el.dataset.panelId = TERMINAL_PANEL_ID;

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.dataset.panelId = TERMINAL_PANEL_ID;

    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = 'Terminal';

    const controls = document.createElement('span');
    controls.className = 'panel-controls';

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'panel-btn panel-settings';
    settingsBtn.title = 'Pane settings';
    settingsBtn.innerHTML = '&#x2699;';
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openPaneSettings(TERMINAL_PANEL_ID);
    });

    const floatBtn = document.createElement('button');
    floatBtn.className = 'panel-btn panel-float';
    floatBtn.title = st.dock === 'float' ? 'Dock' : 'Float';
    floatBtn.innerHTML = st.dock === 'float' ? '&#x25A3;' : '&#x25A1;';
    floatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._mobile.enabled) return;
      if (this.state.panels[TERMINAL_PANEL_ID].dock === 'float') {
        this.dockPanel(TERMINAL_PANEL_ID, 'right');
      } else {
        const rect = el.getBoundingClientRect();
        this.floatPanel(TERMINAL_PANEL_ID, rect.left, rect.top);
      }
    });

    controls.appendChild(settingsBtn);
    controls.appendChild(floatBtn);
    header.appendChild(title);
    header.appendChild(controls);

    const body = document.createElement('div');
    body.className = 'panel-body terminal-panel-body';
    body.appendChild(outputShell);
    body.appendChild(inputBar);

    el.appendChild(header);
    el.appendChild(body);

    this.panels[TERMINAL_PANEL_ID] = {
      el,
      headerEl: header,
      bodyEl: body,
      title: 'Terminal',
      terminal: true,
    };
    this._placePanelElement(TERMINAL_PANEL_ID, el, this.state.panels[TERMINAL_PANEL_ID]);
    this._notifyOutputLayoutChanged();
  },

  _restoreTerminalToClassic() {
    const anchors = this._ensureTerminalAnchors();
    const outputShell = document.getElementById('output-shell');
    const inputBar = document.getElementById('input-bar');
    if (!anchors || !outputShell || !inputBar) return;

    const terminalPanel = this.panels[TERMINAL_PANEL_ID];
    if (anchors.outputParent) {
      anchors.outputParent.insertBefore(outputShell, anchors.outputNext);
    }
    if (anchors.inputParent) {
      anchors.inputParent.insertBefore(inputBar, anchors.inputNext);
    }
    if (terminalPanel && terminalPanel.el) {
      terminalPanel.el.remove();
      delete this.panels[TERMINAL_PANEL_ID];
    }
    this._notifyOutputLayoutChanged();
  },

  _notifyOutputLayoutChanged() {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('darkflow:output-layout-changed'));
    });
  },

  _notifyWorkspaceLayoutChanged() {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('darkflow:workspace-layout-changed', {
        detail: { layout: this._workspaceLayout },
      }));
    });
  },

  createPanel(id) {
    if (appState.zorkOnlyMode) return;
    if (this.panels[id]) return;

    const def = PANEL_DEFS[id];
    const st = this.state.panels[id];

    const el = document.createElement('div');
    el.className = 'gmcp-panel-widget';
    el.dataset.panelId = id;

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.dataset.panelId = id;

    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = def.title;

    const controls = document.createElement('span');
    controls.className = 'panel-controls';

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'panel-btn panel-settings';
    settingsBtn.title = 'Pane settings';
    settingsBtn.innerHTML = '&#x2699;';
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openPaneSettings(id);
    });

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'panel-btn panel-collapse';
    collapseBtn.title = 'Collapse';
    collapseBtn.innerHTML = st.collapsed ? '&#x25BC;' : '&#x25B2;';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.collapsePanel(id, !this.state.panels[id].collapsed);
    });

    const floatBtn = document.createElement('button');
    floatBtn.className = 'panel-btn panel-float';
    floatBtn.title = st.dock === 'float' ? 'Dock' : 'Float';
    floatBtn.innerHTML = st.dock === 'float' ? '&#x25A3;' : '&#x25A1;';
    floatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._mobile.enabled) return;
      if (this.state.panels[id].dock === 'float') {
        this.dockPanel(id, PANEL_DEFS[id].defaultDock);
      } else {
        const rect = el.getBoundingClientRect();
        this.floatPanel(id, rect.left, rect.top);
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-btn panel-close';
    closeBtn.title = 'Close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePanel(id);
    });

    controls.appendChild(settingsBtn);
    controls.appendChild(collapseBtn);
    controls.appendChild(floatBtn);
    controls.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(controls);

    const body = document.createElement('div');
    body.className = 'panel-body' + (st.collapsed ? ' collapsed' : '');
    body.id = 'panel-body-' + id;
    body.innerHTML = '<div class="placeholder">Waiting for data...</div>';

    el.appendChild(header);
    el.appendChild(body);

    this.panels[id] = { el, headerEl: header, bodyEl: body, title: def.title };
    this._placePanelElement(id, el, st);
    this._applyPaneFont(id);

    if (this.gmcpData[id]) {
      this._renderPanel(id);
    }
    if (id === 'sky') this._syncSkyTimer();
    this._renderMobileSheet();
  },

  // --- Per-pane font -------------------------------------------------------

  openPaneSettings(id) {
    const def = PANEL_DEFS[id];
    const st = this.state.panels[id];
    const title = id === TERMINAL_PANEL_ID
      ? 'Terminal'
      : ((def && def.title) || (this.panels[id] && this.panels[id].title) || id);
    const defaultLayer = this._defaultPaneLayer(id);
    openPaneFontSettings({
      title,
      font: (st && st.font) || {},
      zLayer: this._normalizePaneLayer(st && st.zLayer, id),
      defaultLayer,
      onChange: (font) => this.setPaneFont(id, font),
      onLayerChange: (zLayer) => this.setPaneLayer(id, zLayer),
      onReset: () => {
        this.setPaneFont(id, null);
        this.setPaneLayer(id, defaultLayer);
      },
    });
  },

  // Persist + apply a pane's font. `font` may be { family?, size?, weight? };
  // null/empty clears the overrides back to the pane default.
  setPaneFont(id, font) {
    let st = this.state.panels[id];
    // The terminal's state entry may not exist in classic layout; create it so
    // the font persists regardless of layout.
    if (!st && id === TERMINAL_PANEL_ID) {
      st = this.state.panels[id] = this._normalizeTerminalPanelState({});
    }
    if (!st) return;
    const clean = {};
    if (font) {
      if (font.family) clean.family = String(font.family);
      if (font.size) clean.size = String(font.size);
      if (font.weight) clean.weight = String(font.weight);
    }
    if (Object.keys(clean).length) st.font = clean;
    else delete st.font;
    this._applyPaneFont(id);
    this.saveState();
  },

  setPaneLayer(id, zLayer) {
    let st = this.state.panels[id];
    if (!st && id === TERMINAL_PANEL_ID) {
      st = this.state.panels[id] = this._normalizeTerminalPanelState({});
    }
    if (!st) return;

    st.zLayer = this._normalizePaneLayer(zLayer, id);
    st.floatZ = this._getEffectivePaneZIndex(id, st);
    this._topFloatZ = Math.max(this._topFloatZ, st.floatZ);

    const panel = this.panels[id];
    if (panel && panel.el && st.dock === 'float' && !this._mobile.enabled) {
      panel.el.style.zIndex = String(st.floatZ);
    }

    this.saveState();
  },

  // Apply a pane's saved font.
  //
  // GMCP info panes: applied to the pane body. Family is set directly (for
  // inherited text) and via --df-font-mono/--df-font-ui (for content using those
  // vars). Size is a scale on --pane-font-scale so the panel's size hierarchy
  // scales proportionally (panel font-sizes are calc(Npx * var(--pane-font-scale,1))).
  //
  // Terminal pane: applied to #output-shell (present in both classic and floating
  // layouts). Its text is uniform (no size hierarchy), so size is a direct px
  // value. Only the FONT changes here; terminal/game colors stay fixed.
  _applyPaneFont(id) {
    const f = (this.state.panels[id] && this.state.panels[id].font) || {};

    if (id === TERMINAL_PANEL_ID) {
      const shell = document.getElementById('output-shell');
      if (!shell) return;
      if (f.family) {
        shell.style.setProperty('--df-font-mono', f.family);
        shell.style.setProperty('--df-font-ui', f.family);
      } else {
        shell.style.removeProperty('--df-font-mono');
        shell.style.removeProperty('--df-font-ui');
      }
      shell.style.fontSize = (f.size && Number(f.size) > 0) ? (Number(f.size) + 'px') : '';
      shell.style.fontWeight = f.weight ? String(f.weight) : '';
      return;
    }

    const p = this.panels[id];
    if (!p || !p.bodyEl) return;
    const body = p.bodyEl;

    if (f.family) {
      body.style.fontFamily = f.family;
      body.style.setProperty('--df-font-mono', f.family);
      body.style.setProperty('--df-font-ui', f.family);
    } else {
      body.style.fontFamily = '';
      body.style.removeProperty('--df-font-mono');
      body.style.removeProperty('--df-font-ui');
    }

    if (f.size && Number(f.size) > 0) {
      body.style.setProperty('--pane-font-scale', (Number(f.size) / 12).toString());
    } else {
      body.style.removeProperty('--pane-font-scale');
    }

    body.style.fontWeight = f.weight ? String(f.weight) : '';
  },

  _placePanelElement(id, el, st) {
    if (this._mobile.enabled) {
      if (!this._mobile.contentEl) return;
      el.classList.add('mobile-panel');
      el.classList.remove('floating');
      el.style.cssText = '';
      this._mobile.contentEl.appendChild(el);
      if (!this._mobile.activePanelId || !this.state.panels[this._mobile.activePanelId] || !this.state.panels[this._mobile.activePanelId].visible) {
        this._mobile.activePanelId = this._getDefaultMobileActivePanelId();
      }
      this._syncMobilePanelVisibility();
      return;
    }

    el.classList.remove('mobile-panel');
    if (st.dock === 'float') {
      this._makeFloat(el, st);
    } else {
      this._insertIntoDock(id, el, st.dock, st.order);
    }
  },

  _insertIntoDock(id, el, side, order) {
    const dock = document.getElementById(side + '-dock');
    const children = Array.from(dock.querySelectorAll('.gmcp-panel-widget'));
    let inserted = false;
    for (const child of children) {
      const childId = child.dataset.panelId;
      const childOrder = this.state.panels[childId] ? this.state.panels[childId].order : 999;
      if (order < childOrder) {
        dock.insertBefore(el, child);
        inserted = true;
        break;
      }
    }
    if (!inserted) dock.appendChild(el);
    el.classList.remove('floating');
    el.style.cssText = '';
  },

  _makeFloat(el, st) {
    document.body.appendChild(el);
    el.classList.add('floating');
    el.style.zIndex = String(this._getEffectivePaneZIndex(el.dataset.panelId, st));
    this._snapPanelStateToGrid(el.dataset.panelId, st);
    this._applyFloatPosition(el, st);

    const id = el.dataset.panelId;
    const ro = new ResizeObserver(() => {
      const s = this.state.panels[id];
      if (s && s.dock === 'float' && !this._mobile.enabled) {
        const measured = this._measureFloatPanel(el);
        if (!measured) return;
        if (this._isPaneGridSnapEnabled()) {
          const size = this._snapFloatSizeToGrid(id, measured.width, measured.height);
          s.floatW = size.width;
          s.floatH = size.height;
          if (measured.width !== size.width) el.style.width = size.width + 'px';
          if (measured.height !== size.height) el.style.height = size.height + 'px';
        } else {
          s.floatW = measured.width;
          s.floatH = measured.height;
        }
        this.saveState();
        if (id === TERMINAL_PANEL_ID) {
          this._notifyOutputLayoutChanged();
        }
      }
    });
    ro.observe(el);
  },

  _bringPanelToFront(id) {
    const st = this.state.panels[id];
    const panel = this.panels[id];
    if (!st || !panel || st.dock !== 'float' || this._mobile.enabled) return;
    panel.el.style.zIndex = String(this._getFocusedPaneZIndex(id, st));
    if (id !== 'enemy') this._keepEnemyPanelAbove();
  },

  _hasActiveEnemy() {
    const enemy = this.gmcpData.enemy;
    return this._isActiveEnemyData(enemy);
  },

  _isActiveEnemyData(enemy) {
    return !!(enemy && enemy.enemy_name && enemy.enemy_name !== 'None' && enemy.enemy_name !== '');
  },

  _normalizeEnemyData(data) {
    if (!data || typeof data !== 'object') return data;
    if (Object.prototype.hasOwnProperty.call(data, 'enemy_name')) return data;
    if (!Object.prototype.hasOwnProperty.call(data, 'name')) return data;

    return {
      enemy_name: data.name || '',
      enemy_curhp: data.hp,
      enemy_maxhp: data.mhp || data.maxhp || 100,
      enemy_cursp: data.mn || data.mana || data.sp || 0,
      enemy_maxsp: data.mmn || data.maxmana || data.maxsp || 0,
      enemy_level: data.level,
      enemy_image: data.image || data.avatar || '',
      enemy_hp_string: data.hp_string || '',
    };
  },

  _syncEnemyPanelVisibility() {
    if (this._draggingEnemyPanel) {
      this._syncEnemyPanelAfterDrag = true;
      return;
    }

    const inCombat = this._hasActiveEnemy();
    const st = this.state.panels.enemy;
    if (!st) return;

    if (inCombat) {
      this._showEnemyPanel();
      return;
    }

    this._hideEnemyPanel();
  },

  _captureFloatPanelGeometry(id) {
    const st = this.state.panels[id];
    const panel = this.panels[id];
    if (!st || !panel || !panel.el || st.dock !== 'float' || this._mobile.enabled) return;
    const rect = panel.el.getBoundingClientRect();
    const measured = this._measureFloatPanel(panel.el);
    if (measured) {
      st.floatW = measured.width;
      st.floatH = measured.height;
    }
    if (!st.snapLeft && !st.snapRight && Number.isFinite(rect.left)) {
      st.floatX = Math.round(rect.left);
    }
    if (!st.snapTop && !st.snapBottom && Number.isFinite(rect.top)) {
      st.floatY = Math.round(rect.top);
    }
  },

  _showEnemyPanel() {
    const st = this.state.panels.enemy;
    if (!st) return;
    const wasHidden = !st.visible
      || !this.panels.enemy
      || (this.panels.enemy.el && this.panels.enemy.el.style.display === 'none');

    st.visible = true;
    if (!this.panels.enemy) {
      this.createPanel('enemy');
    }
    if (this.panels.enemy && this.panels.enemy.el) {
      this.panels.enemy.el.style.display = '';
      if (wasHidden) this._bringPanelToFront('enemy');
      else this._keepEnemyPanelAbove();
    }
    const cb = document.querySelector('#panels-menu input[data-panel-id="enemy"]');
    if (cb) cb.checked = true;
    this._renderMobileSheet();
    this.saveState();
  },

  _hideEnemyPanel() {
    const st = this.state.panels.enemy;
    if (!st) return;
    this._captureFloatPanelGeometry('enemy');
    st.visible = false;
    if (this.panels.enemy && this.panels.enemy.el) {
      this.panels.enemy.el.style.display = 'none';
    }
    const cb = document.querySelector('#panels-menu input[data-panel-id="enemy"]');
    if (cb) cb.checked = false;
    if (this._mobile.activePanelId === 'enemy') {
      this._mobile.activePanelId = this._getDefaultMobileActivePanelId();
    }
    this._renderMobileSheet();
    this.saveState();
  },

  _keepEnemyPanelAbove() {
    if (!this._hasActiveEnemy()) return;
    const st = this.state.panels.enemy;
    const panel = this.panels.enemy;
    if (!st || !panel || st.dock !== 'float' || this._mobile.enabled) return;
    if (panel.el.style.display === 'none') return;
    const highest = Object.entries(this.state.panels).reduce((max, [id, state]) => {
      const current = this.panels[id];
      if (!state || !current || state.dock !== 'float') return max;
      if (current.el.style.display === 'none') return max;
      return Math.max(max, Number(current.el.style.zIndex) || this._getEffectivePaneZIndex(id, state));
    }, 0);
    if ((Number(panel.el.style.zIndex) || this._getEffectivePaneZIndex('enemy', st)) >= highest) return;
    panel.el.style.zIndex = String(Math.max(highest + 1, this._getFocusedPaneZIndex('enemy', st)));
  },

  _getSnapBounds() {
    const toolbar = document.getElementById('toolbar');
    const statusBar = document.getElementById('status-bar');
    const inputBar = document.getElementById('input-bar');
    const top = toolbar ? toolbar.offsetHeight : 0;
    const bottom = (statusBar ? statusBar.offsetHeight : 0)
      + (!this._isFloatingWorkspace() && inputBar ? inputBar.offsetHeight : 0);
    // In the floating workspace the docks are not layout boundaries. Never
    // derive the float area from their DOM geometry there: mid-load (hard
    // refresh, CSS not yet applied) the dock elements can still report a
    // width, and clamping saved pane positions against that transient box
    // shifted every pane inward -- and then SAVED the corrupted layout.
    let leftEdge = 0;
    let rightEdge = window.innerWidth;
    if (!this._isFloatingWorkspace()) {
      const leftDock = document.getElementById('left-dock');
      const rightDock = document.getElementById('right-dock');
      leftEdge = leftDock ? leftDock.getBoundingClientRect().right : 0;
      rightEdge = rightDock ? rightDock.getBoundingClientRect().left : window.innerWidth;
    }
    rightEdge -= 8;
    return {
      left: leftEdge,
      top: top,
      right: rightEdge,
      bottom: window.innerHeight - bottom,
    };
  },

  _applyFloatPosition(el, st) {
    el.style.width = st.floatW + 'px';
    el.style.height = st.floatH + 'px';
    const bounds = this._getSnapBounds();

    if (st.snapRight) {
      el.style.left = 'auto';
      el.style.right = (window.innerWidth - bounds.right) + 'px';
    } else if (st.snapLeft) {
      el.style.left = bounds.left + 'px';
      el.style.right = 'auto';
    } else {
      el.style.left = st.floatX + 'px';
      el.style.right = 'auto';
    }

    if (st.snapBottom) {
      el.style.top = 'auto';
      el.style.bottom = (window.innerHeight - bounds.bottom) + 'px';
    } else if (st.snapTop) {
      el.style.top = bounds.top + 'px';
      el.style.bottom = 'auto';
    } else {
      el.style.top = st.floatY + 'px';
      el.style.bottom = 'auto';
    }
  },

  _normalizePanelAnchor(anchor) {
    if (!anchor || typeof anchor !== 'object') return undefined;
    const relation = ['leftOf', 'rightOf', 'above', 'below'].includes(anchor.relation)
      ? anchor.relation
      : '';
    const targetId = typeof anchor.targetId === 'string' ? anchor.targetId : '';
    if (!targetId || !relation) return undefined;
    return {
      targetId,
      relation,
      offsetX: Number(anchor.offsetX) || 0,
      offsetY: Number(anchor.offsetY) || 0,
      gap: Number(anchor.gap) || 6,
    };
  },

  _getAnchoredPosition(st, targetRect) {
    const anchor = this._normalizePanelAnchor(st && st.panelAnchor);
    if (!anchor || !targetRect) return null;

    const width = st.floatW || 280;
    const height = st.floatH || 200;
    const gap = anchor.gap;
    let x = st.floatX || 0;
    let y = st.floatY || 0;

    if (anchor.relation === 'leftOf') {
      x = targetRect.left - width - gap;
      y = targetRect.top + anchor.offsetY;
    } else if (anchor.relation === 'rightOf') {
      x = targetRect.right + gap;
      y = targetRect.top + anchor.offsetY;
    } else if (anchor.relation === 'above') {
      x = targetRect.left + anchor.offsetX;
      y = targetRect.top - height - gap;
    } else if (anchor.relation === 'below') {
      x = targetRect.left + anchor.offsetX;
      y = targetRect.bottom + gap;
    }

    return this._clampGridPosition(x, y, width, height);
  },

  _resolvePanelAnchor(id) {
    const st = this.state.panels[id];
    const panel = this.panels[id];
    const anchor = st && this._normalizePanelAnchor(st.panelAnchor);
    if (!st || !panel || st.dock !== 'float' || !anchor || this._mobile.enabled) return false;

    const targetPanel = this.panels[anchor.targetId];
    if (!targetPanel || !targetPanel.el) return false;

    const targetRect = targetPanel.el.getBoundingClientRect();
    const pos = this._getAnchoredPosition(st, targetRect);
    if (!pos) return false;

    const changed = st.floatX !== pos.x || st.floatY !== pos.y;
    st.floatX = pos.x;
    st.floatY = pos.y;
    panel.el.style.left = st.floatX + 'px';
    panel.el.style.right = 'auto';
    panel.el.style.top = st.floatY + 'px';
    panel.el.style.bottom = 'auto';
    panel.el.style.width = st.floatW + 'px';
    panel.el.style.height = st.floatH + 'px';
    return changed;
  },

  repositionAnchoredPanels() {
    if (this._mobile.enabled) return;
    let changed = false;
    for (const id of Object.keys(this.state.panels)) {
      changed = this._resolvePanelAnchor(id) || changed;
    }
    if (changed) this.saveState();
  },

  repositionSnappedPanels() {
    if (this._mobile.enabled) return;
    for (const [id, st] of Object.entries(this.state.panels)) {
      if (st.dock !== 'float') continue;
      if (st.panelAnchor) {
        this._resolvePanelAnchor(id);
        continue;
      }
      if (!st.snapRight && !st.snapBottom && !st.snapLeft && !st.snapTop) continue;
      const p = this.panels[id];
      if (!p || !p.el) continue;
      this._applyFloatPosition(p.el, st);
    }
  },

  _attachResizeHandler() {
    window.addEventListener('resize', () => {
      this._syncResponsiveMode();
      if (!this._mobile.enabled) {
        this.repositionSnappedPanels();
      }
    });
  },

  _syncResponsiveMode(force) {
    const shouldEnable = window.innerWidth <= MOBILE_BREAKPOINT_PX;
    if (shouldEnable === this._mobile.enabled && !force) return;
    if (shouldEnable) this._enterMobileMode();
    else this._exitMobileMode();
  },

  _enterMobileMode() {
    if (this._mobile.enabled) return;
    this._mobile.desktopSnapshot = cloneState(this.state);
    this._mobile.enabled = true;
    this._mobile.sheetOpen = false;
    this._mobile.activePanelId = null;

    document.body.classList.add('mobile-panel-mode');
    this.closeMobileSheet();
    this._normalizeStateForMobile();
    this._resetLivePanels();
    this.buildPanelsMenu();

    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id] && this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }

    this._applyDockStateToDom();
    this._renderMobileSheet();
  },

  _exitMobileMode() {
    if (!this._mobile.enabled) return;
    this._mobile.enabled = false;
    this._mobile.sheetOpen = false;
    this.closeMobileSheet();
    document.body.classList.remove('mobile-panel-mode');

    this._resetLivePanels();
    if (this._mobile.desktopSnapshot) {
      this.state = cloneState(this._mobile.desktopSnapshot);
    }
    this._mobile.desktopSnapshot = null;
    this._mobile.activePanelId = null;
    this.buildPanelsMenu();

    if (this._isFloatingWorkspace()) {
      this.createTerminalPanel();
    }
    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id] && this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }
    this._applyDockStateToDom();
    this.repositionAnchoredPanels();
  },

  _normalizeStateForMobile() {
    this.state.docks.left = true;
    this.state.docks.right = true;

    for (const [id, st] of Object.entries(this.state.panels)) {
      const def = PANEL_DEFS[id];
      if (!def) continue;
      if (!st.visible) continue;
      st.collapsed = false;
      if (st.dock === 'float') {
        st.dock = def.defaultDock === 'float' ? 'right' : def.defaultDock;
      }
    }

    this._mobile.activePanelId = this._getDefaultMobileActivePanelId();
  },

  _getDefaultMobileActivePanelId() {
    const visibleIds = this._getMobileVisiblePanelIds();
    if (this._mobile.activePanelId && visibleIds.includes(this._mobile.activePanelId)) {
      return this._mobile.activePanelId;
    }
    for (const id of MOBILE_PRIMARY_PANELS) {
      if (visibleIds.includes(id)) return id;
    }
    return visibleIds[0] || null;
  },

  _applyDockStateToDom() {
    const leftDock = document.getElementById('left-dock');
    const rightDock = document.getElementById('right-dock');
    if (!leftDock || !rightDock) return;
    const leftCollapsed = appState.zorkOnlyMode || this._mobile.enabled ? true : !!this.state.docks.left;
    const rightCollapsed = appState.zorkOnlyMode || this._mobile.enabled ? true : !!this.state.docks.right;

    leftDock.classList.toggle('collapsed', leftCollapsed);
    rightDock.classList.toggle('collapsed', rightCollapsed);

    const leftToggle = document.getElementById('left-dock-toggle');
    const rightToggle = document.getElementById('right-dock-toggle');
    if (leftToggle) leftToggle.classList.toggle('active', !leftCollapsed);
    if (rightToggle) rightToggle.classList.toggle('active', !rightCollapsed);
  },

  dockPanel(id, side, order) {
    if (appState.zorkOnlyMode) return;
    const st = this.state.panels[id];
    const p = this.panels[id];
    if (!p) return;

    if (this._mobile.enabled) {
      st.dock = side;
      st.order = order !== undefined ? order : st.order;
      this._placePanelElement(id, p.el, st);
      this._renderMobileSheet();
      return;
    }

    if (order === undefined) {
      const existing = Object.entries(this.state.panels)
        .filter(([pid, ps]) => ps.dock === side && pid !== id && this.panels[pid]);
      order = existing.length;
    }

    st.dock = side;
    st.order = order;
    delete st.panelAnchor;
    this.state.docks[side] = false;
    this._applyDockStateToDom();
    this._insertIntoDock(id, p.el, side, order);

    const dock = document.getElementById(side + '-dock');
    const children = Array.from(dock.querySelectorAll('.gmcp-panel-widget'));
    children.forEach((child, i) => {
      const cid = child.dataset.panelId;
      if (this.state.panels[cid]) this.state.panels[cid].order = i;
    });

    const fb = p.el.querySelector('.panel-float');
    if (fb) { fb.title = 'Float'; fb.innerHTML = '&#x25A1;'; }

    this.saveState();
    if (id === TERMINAL_PANEL_ID) this._notifyOutputLayoutChanged();
  },

  floatPanel(id, x, y, options = {}) {
    if (appState.zorkOnlyMode) return;
    const st = this.state.panels[id];
    const p = this.panels[id];
    if (!p) return;
    if (this._mobile.enabled) {
      this.dockPanel(id, PANEL_DEFS[id].defaultDock === 'float' ? 'right' : PANEL_DEFS[id].defaultDock);
      return;
    }

    st.dock = 'float';
    st.floatX = x;
    st.floatY = y;
    st.floatZ = this._getEffectivePaneZIndex(id, st);

    const SNAP = 30;
    const w = st.floatW || p.el.offsetWidth || 280;
    const h = st.floatH || p.el.offsetHeight || 200;
    const bounds = this._getSnapBounds();

    if (options.panelAnchor) {
      st.panelAnchor = this._normalizePanelAnchor(options.panelAnchor);
      st.snapLeft = false;
      st.snapTop = false;
      st.snapRight = false;
      st.snapBottom = false;
    } else {
      delete st.panelAnchor;
      st.snapLeft = x < (bounds.left + SNAP);
      st.snapTop = y < (bounds.top + SNAP);
      st.snapRight = (x + w) > (bounds.right - SNAP);
      st.snapBottom = (y + h) > (bounds.bottom - SNAP);
    }

    if (st.snapLeft) st.floatX = bounds.left;
    if (st.snapTop) st.floatY = bounds.top;
    if (st.snapRight) st.floatX = bounds.right - w;
    if (st.snapBottom) st.floatY = bounds.bottom - h;
    if ((!st.snapLeft && !st.snapRight) || (!st.snapTop && !st.snapBottom)) {
      const grid = this._getGridSnappedFloatPosition(st.floatX, st.floatY, w, h, {
        left: st.snapLeft,
        top: st.snapTop,
        right: st.snapRight,
        bottom: st.snapBottom,
      });
      if (!st.snapLeft && !st.snapRight) st.floatX = grid.x;
      if (!st.snapTop && !st.snapBottom) st.floatY = grid.y;
    }

    this._makeFloat(p.el, st);

    const fb = p.el.querySelector('.panel-float');
    if (fb) { fb.title = 'Dock'; fb.innerHTML = '&#x25A3;'; }

    this.saveState();
    if (id === TERMINAL_PANEL_ID) this._notifyOutputLayoutChanged();
  },

  collapsePanel(id, collapsed) {
    if (appState.zorkOnlyMode) return;
    const st = this.state.panels[id];
    const p = this.panels[id];
    if (!p) return;
    if (this._mobile.enabled) return;
    st.collapsed = collapsed;
    p.bodyEl.classList.toggle('collapsed', collapsed);
    const cb = p.el.querySelector('.panel-collapse');
    if (cb) cb.innerHTML = collapsed ? '&#x25BC;' : '&#x25B2;';
    this.saveState();
  },

  closePanel(id) {
    if (appState.zorkOnlyMode) return;
    const closeHandler = this._panelCloseHandlers[id];
    if (closeHandler && closeHandler() === false) return;
    this._closePanelNow(id);
  },

  _closePanelNow(id) {
    const st = this.state.panels[id];
    if (!st) return;
    st.visible = false;
    const p = this.panels[id];
    if (p) {
      p.el.remove();
      delete this.panels[id];
    }
    const cb = document.querySelector('#panels-menu input[data-panel-id="' + id + '"]');
    if (cb) cb.checked = false;
    if (this._mobile.activePanelId === id) {
      this._mobile.activePanelId = this._getDefaultMobileActivePanelId();
    }
    this._renderMobileSheet();
    if (id === 'buffs') this._syncBuffTimer();
    if (id === 'sky') this._syncSkyTimer();
    if (id === 'areaMap') exitMapData2Browse();
    this.saveState();
    this.syncGmcpSubscriptions('panel-close', false);
  },

  registerPanelCloseHandler(id, handler) {
    if (!id || typeof handler !== 'function') return;
    this._panelCloseHandlers[id] = handler;
  },

  unregisterPanelCloseHandler(id, handler) {
    if (!id) return;
    if (handler && this._panelCloseHandlers[id] !== handler) return;
    delete this._panelCloseHandlers[id];
  },

  openPanel(id) {
    if (appState.zorkOnlyMode) return;
    const st = this.state.panels[id];
    st.visible = true;
    this.createPanel(id);
    const cb = document.querySelector('#panels-menu input[data-panel-id="' + id + '"]');
    if (cb) cb.checked = true;
    if (this._mobile.enabled) {
      this._mobile.activePanelId = id;
      this._renderMobileSheet();
    }
    if (id === 'buffs') this._syncBuffTimer();
    if (id === 'sky') this._syncSkyTimer();
    if (id === 'enemy') this._bringPanelToFront(id);
    this.saveState();
    this.syncGmcpSubscriptions('panel-open', false);
  },

  createDynamicPanel(id, title, dock, order, onClose, options = {}) {
    if (appState.zorkOnlyMode) return null;
    if (this.panels[id]) return this.panels[id].bodyEl;
    const allowPaneSettings = !!options.paneSettings;

    const el = document.createElement('div');
    el.className = 'gmcp-panel-widget';
    el.dataset.panelId = id;

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.dataset.panelId = id;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'panel-title';
    titleSpan.textContent = title;

    const controls = document.createElement('span');
    controls.className = 'panel-controls';

    let settingsBtn = null;
    if (allowPaneSettings) {
      settingsBtn = document.createElement('button');
      settingsBtn.className = 'panel-btn panel-settings';
      settingsBtn.title = 'Pane settings';
      settingsBtn.innerHTML = '&#x2699;';
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openPaneSettings(id);
      });
    }

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'panel-btn panel-collapse';
    collapseBtn.innerHTML = '&#x25B2;';
    let collapsed = false;
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._mobile.enabled) return;
      collapsed = !collapsed;
      body.classList.toggle('collapsed', collapsed);
      collapseBtn.innerHTML = collapsed ? '&#x25BC;' : '&#x25B2;';
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-btn panel-close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onClose) onClose();
      else this.removeDynamicPanel(id);
    });

    if (settingsBtn) controls.appendChild(settingsBtn);
    controls.appendChild(collapseBtn);
    controls.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(controls);

    const body = document.createElement('div');
    body.className = 'panel-body';

    el.appendChild(header);
    el.appendChild(body);

    this.panels[id] = { el, headerEl: header, bodyEl: body, dynamic: true, title };
    const savedState = allowPaneSettings
      ? (this.state.panels[id] || this._getSavedPanelState(id) || {})
      : {};
    const zLayer = this._normalizePaneLayer(savedState.zLayer, id);
    this.state.panels[id] = {
      dock,
      order,
      collapsed: false,
      visible: true,
      floatZ: this._getEffectivePaneZIndex(id, { zLayer }),
      zLayer,
      font: savedState.font,
    };

    if (this._mobile.enabled) {
      this._placePanelElement(id, el, this.state.panels[id]);
      this._mobile.activePanelId = id;
      this.openMobileSheet();
    } else {
      if (dock === 'float') {
        const belowPanelId = options.defaultBelowPanel;
        const belowState = belowPanelId && this.state.panels[belowPanelId];
        const belowPanel = belowPanelId && this.panels[belowPanelId];
        let x = options.defaultFloatX;
        let y = options.defaultFloatY;
        if (belowState && belowPanel) {
          const rect = belowPanel.el.getBoundingClientRect();
          x = belowState.floatX !== undefined ? belowState.floatX : rect.left;
          y = belowState.floatY !== undefined ? belowState.floatY :
            (rect.top + (belowState.floatH || rect.height) + 8);
          if (options.defaultFloatW && belowState.floatW) {
            x = Math.min(x, window.innerWidth - options.defaultFloatW - 16);
          }
        }
        if (x === undefined) x = Math.round((window.innerWidth - (options.defaultFloatW || 280)) / 2);
        if (y === undefined) y = Math.round((window.innerHeight - (options.defaultFloatH || 200)) / 2);
        this.state.panels[id].floatX = savedState.floatX !== undefined ? savedState.floatX : x;
        this.state.panels[id].floatY = savedState.floatY !== undefined ? savedState.floatY : y;
        this.state.panels[id].floatW = savedState.floatW || options.defaultFloatW || el.offsetWidth || 280;
        this.state.panels[id].floatH = savedState.floatH || options.defaultFloatH || el.offsetHeight || 200;
        this.state.panels[id].snapLeft = savedState.snapLeft !== undefined ? !!savedState.snapLeft : !!options.defaultSnapLeft;
        this.state.panels[id].snapTop = savedState.snapTop !== undefined ? !!savedState.snapTop : !!options.defaultSnapTop;
        this.state.panels[id].snapRight = savedState.snapRight !== undefined ? !!savedState.snapRight : !!options.defaultSnapRight;
        this.state.panels[id].snapBottom = savedState.snapBottom !== undefined ? !!savedState.snapBottom : !!options.defaultSnapBottom;
        this._makeFloat(el, {
          floatX: this.state.panels[id].floatX,
          floatY: this.state.panels[id].floatY,
          floatW: this.state.panels[id].floatW,
          floatH: this.state.panels[id].floatH,
          floatZ: this.state.panels[id].floatZ,
          snapLeft: this.state.panels[id].snapLeft,
          snapTop: this.state.panels[id].snapTop,
          snapRight: this.state.panels[id].snapRight,
          snapBottom: this.state.panels[id].snapBottom,
        });
      } else {
        this._insertIntoDock(id, el, dock, order);
      }
    }

    this._renderMobileSheet();
    if (allowPaneSettings) this._applyPaneFont(id);
    if (allowPaneSettings) this.saveState();
    return body;
  },

  removeDynamicPanel(id, options = {}) {
    const p = this.panels[id];
    if (!p) return;
    p.el.remove();
    delete this.panels[id];
    if (options.preserveState && this.state.panels[id]) {
      this.state.panels[id].visible = false;
    } else {
      delete this.state.panels[id];
    }
    if (this._mobile.activePanelId === id) {
      this._mobile.activePanelId = this._getDefaultMobileActivePanelId();
    }
    this._renderMobileSheet();
    if (options.preserveState) this.saveState();
  },

  resetData(options = {}) {
    resetLiveMapModeForConnection();
    const preservePanels = new Set(Array.isArray(options.preservePanels) ? options.preservePanels : []);
    const preservedData = {};

    for (const id of preservePanels) {
      if (this.gmcpData[id] !== undefined) preservedData[id] = this.gmcpData[id];
    }

    this.gmcpData = preservedData;
    this._characterSubscriptionSyncSent = false;
    this._commChannelPlayersRequested = false;
    this._pendingPanelRenders.clear();
    if (this._panelRenderFrame) {
      cancelAnimationFrame(this._panelRenderFrame);
      this._panelRenderFrame = null;
    }
    for (const [id, p] of Object.entries(this.panels)) {
      if (id === TERMINAL_PANEL_ID || p.terminal) continue;
      if (preservePanels.has(id) && this.gmcpData[id] !== undefined) {
        this._renderPanel(id);
      } else {
        p.bodyEl.innerHTML = '<div class="placeholder">Waiting for data...</div>';
      }
    }
    this._renderPanel('avatar');
    this._hideAvatarMeter();
    this._syncSkyTimer();
  },

  _hideAvatarMeter() {
    const meter = document.getElementById('avatar-meter');
    if (!meter) return;
    const wasVisible = meter.classList.contains('visible');
    meter.classList.remove('visible', 'full', 'active', 'patron-mitra', 'patron-gaea', 'patron-set');
    meter.removeAttribute('data-avatar-meter-present');
    this._stopAvatarMeterTicker();
    this._avatarActiveEndAt = 0;
    this._avatarActiveMaxSec = 0;
    this._avatarChargeSync = null;
    this._notifyAvatarMeterLayoutIfChanged(meter, wasVisible);
  },

  _notifyAvatarMeterLayoutIfChanged(meter, wasVisible) {
    if (!meter || wasVisible === meter.classList.contains('visible')) return;
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('darkflow:output-layout-changed'));
    });
  },

  _syncSubscriptionsAfterCharacterData() {
    if (this._characterSubscriptionSyncSent) return;
    this._characterSubscriptionSyncSent = true;
    this._clearSubscriptionSyncFallback();
    gmcp.sendSubscriptions({
      reason: 'character-login',
      full: true,
      panels: this.getSubscriptionPanels(),
    });
    this._requestCommChannelPlayers();
  },

  // The character-login sync above normally triggers off the first
  // Char.Vitals/Char.Status/GuildVitals/XPMon frame. If none of those
  // arrive (login race, unusual character state), fall back to syncing
  // a few seconds after the connection comes up so panels are never
  // left unsubscribed for the whole session.
  _armSubscriptionSyncFallback() {
    this._clearSubscriptionSyncFallback();
    this._subscriptionSyncFallbackTimer = setTimeout(() => {
      this._subscriptionSyncFallbackTimer = null;
      if (this._characterSubscriptionSyncSent) return;
      this._syncSubscriptionsAfterCharacterData();
    }, 6000);
  },

  _clearSubscriptionSyncFallback() {
    if (this._subscriptionSyncFallbackTimer) {
      clearTimeout(this._subscriptionSyncFallbackTimer);
      this._subscriptionSyncFallbackTimer = null;
    }
  },

  _requestCommChannelPlayers() {
    if (this._commChannelPlayersRequested) return;
    this._commChannelPlayersRequested = true;
    gmcp.requestChannelPlayers();
  },

  _ensureChatData() {
    if (!this.gmcpData.chat || Array.isArray(this.gmcpData.chat)) {
      this.gmcpData.chat = {
        messages: Array.isArray(this.gmcpData.chat) ? this.gmcpData.chat : [],
        channels: [],
        players: [],
        activeChannels: [],
      };
    } else {
      if (!Array.isArray(this.gmcpData.chat.messages)) this.gmcpData.chat.messages = [];
      if (!Array.isArray(this.gmcpData.chat.channels)) this.gmcpData.chat.channels = [];
      if (!Array.isArray(this.gmcpData.chat.players)) this.gmcpData.chat.players = [];
      if (!Array.isArray(this.gmcpData.chat.activeChannels)) this.gmcpData.chat.activeChannels = [];
    }
    return this.gmcpData.chat;
  },

  _appendChatMessage(data) {
    const chat = this._ensureChatData();
    const message = data && typeof data === 'object' ? data : { text: String(data || '') };
    const key = chatMessageKey(message);
    const last = chat.messages.length ? chat.messages[chat.messages.length - 1] : null;
    if (!last || chatMessageKey(last) !== key) {
      chat.messages.push(message);
      if (chat.messages.length > 200) chat.messages.shift();
      if (!openFirstImagePreviewFromText(message.text || '')) {
        const href = findFirstImageUrlFromFragments(parseAnsiText(message.text || ''), message.text || '');
        if (href) openImagePreviewPane(href, { title: imagePreviewLabel(href) });
      }
    }
    this._renderPanel('chat');
  },

  _setAvatarMeterPatron(patron) {
    const meter = document.getElementById('avatar-meter');
    if (!meter) return;

    const key = patron ? String(patron).toLowerCase() : '';
    meter.classList.remove('patron-mitra', 'patron-gaea', 'patron-set');
    if (key === 'mitra' || key === 'gaea' || key === 'set') {
      meter.classList.add('patron-' + key);
    }
  },

  _startAvatarMeterTicker() {
    if (this._avatarMeterTicker) return;
    this._avatarMeterTicker = setInterval(() => this._tickAvatarMeter(), 1000);
  },

  _stopAvatarMeterTicker() {
    if (this._avatarMeterTicker) {
      clearInterval(this._avatarMeterTicker);
      this._avatarMeterTicker = null;
    }
  },

  _tickAvatarMeter() {
    const meter = document.getElementById('avatar-meter');
    if (!meter) {
      this._stopAvatarMeterTicker();
      return;
    }

    if (this._avatarActiveEndAt) {
      const remaining = Math.max(0, Math.ceil((this._avatarActiveEndAt - Date.now()) / 1000));
      if (remaining <= 0) {
        this._avatarActiveEndAt = 0;
        meter.classList.remove('active');
        this._renderAvatarCharge();
        if (!this._avatarChargeSync) this._stopAvatarMeterTicker();
        return;
      }
      this._renderAvatarActive(remaining);
      return;
    }

    if (this._avatarChargeSync) {
      this._renderAvatarCharge();
      return;
    }

    this._stopAvatarMeterTicker();
  },

  _renderAvatarActive(remaining) {
    const meter = document.getElementById('avatar-meter');
    if (!meter) return;
    const fill = meter.querySelector('.avatar-meter-fill');
    const label = meter.querySelector('.avatar-meter-label');
    const max = Math.max(this._avatarActiveMaxSec, remaining, 1);
    const pct = Math.max(0, Math.min(100, (remaining / max) * 100));
    if (fill) fill.style.width = pct + '%';
    if (label) {
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      label.textContent = 'Wrathful Avatar ACTIVE ' + minutes + ':' + String(seconds).padStart(2, '0');
    }
  },

  _predictAvatarCharge() {
    if (!this._avatarChargeSync) return null;

    const sync = this._avatarChargeSync;
    const elapsedMs = Math.max(0, Date.now() - sync.syncedAt);
    const gained = (elapsedMs / AVATAR_CHARGE_TICK_MS) * (sync.ratePct / 100);
    return Math.max(0, Math.min(sync.max, sync.charge + gained));
  },

  _renderAvatarCharge() {
    const meter = document.getElementById('avatar-meter');
    const charge = this._predictAvatarCharge();
    if (!meter || charge === null || !this._avatarChargeSync) return;
    const wasVisible = meter.classList.contains('visible');

    const fill = meter.querySelector('.avatar-meter-fill');
    const label = meter.querySelector('.avatar-meter-label');
    const max = this._avatarChargeSync.max;
    const pct = Math.max(0, Math.min(100, (charge / max) * 100));
    const displayPct = Math.floor(pct);

    meter.classList.add('visible');
    meter.classList.toggle('full', displayPct >= 100);
    meter.classList.remove('active');
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = 'Wrathful Avatar ' + displayPct + '%';
    this._notifyAvatarMeterLayoutIfChanged(meter, wasVisible);

    if (displayPct >= 100) this._stopAvatarMeterTicker();
  },

  _updateAvatarMeter(data) {
    const meter = document.getElementById('avatar-meter');
    if (!meter || !data || typeof data !== 'object') return;

    const hasCharge = ['avatar_charge', 'avatar_charge_max', 'avatar_charge_display',
      'avatar_charge_pct', 'avatar_active_remaining', 'avatar_active_max']
      .some(key => Object.prototype.hasOwnProperty.call(data, key));
    if (!hasCharge) {
      const looksFullRefresh = isFullVitalsPayload(data);
      if (looksFullRefresh) {
        this._hideAvatarMeter();
      }
      return;
    }

    const rawCharge = Number(data.avatar_charge);
    const rawMax = Number(data.avatar_charge_max);
    const hasRawCharge = Number.isFinite(rawCharge) && Number.isFinite(rawMax) && rawMax > 0;
    const pct = hasRawCharge
      ? Math.max(0, Math.min(100, (rawCharge / rawMax) * 100))
      : Math.max(0, Math.min(100, Number(data.avatar_charge_pct) || 0));
    const activeRemaining = Number(data.avatar_active_remaining) || 0;
    const active = activeRemaining > 0;
    const hasActiveMax = Object.prototype.hasOwnProperty.call(data, 'avatar_active_max');
    const activeMax = Number(data.avatar_active_max) || 0;
    const patron = data.divine_patron || data.patron ||
      (this.gmcpData.omens && this.gmcpData.omens.patron);
    const wasVisible = meter.classList.contains('visible');

    meter.setAttribute('data-avatar-meter-present', '1');
    meter.classList.add('visible');
    meter.classList.toggle('full', pct >= 100 && !active);
    meter.classList.toggle('active', active);
    this._setAvatarMeterPatron(patron);

    if (active) {
      this._avatarChargeSync = null;
      this._avatarActiveEndAt = Date.now() + activeRemaining * 1000;
      if (hasActiveMax && activeMax > 0) {
        this._avatarActiveMaxSec = activeMax;
      } else if (!this._avatarActiveMaxSec) {
        this._avatarActiveMaxSec = activeRemaining;
      }
      this._renderAvatarActive(activeRemaining);
      this._startAvatarMeterTicker();
    } else {
      this._avatarActiveEndAt = 0;
      this._avatarActiveMaxSec = 0;
      if (hasRawCharge) {
        const ratePct = Number(data.avatar_charge_rate_pct);
        this._avatarChargeSync = {
          charge: Math.max(0, Math.min(rawMax, rawCharge)),
          max: rawMax,
          ratePct: Number.isFinite(ratePct) ? ratePct : 100,
          syncedAt: Date.now(),
        };
        this._renderAvatarCharge();
        if (rawCharge < rawMax) this._startAvatarMeterTicker();
        else this._stopAvatarMeterTicker();
      } else {
        this._avatarChargeSync = null;
        const fill = meter.querySelector('.avatar-meter-fill');
        const label = meter.querySelector('.avatar-meter-label');
        if (fill) fill.style.width = pct + '%';
        if (label) label.textContent = 'Wrathful Avatar ' + Math.floor(pct) + '%';
      }
    }
    this._notifyAvatarMeterLayoutIfChanged(meter, wasVisible);
  },

  refreshMediaPanels() {
    const buildRefreshUrl = (url) => {
      const separator = url.includes('?') ? '&' : '?';
      return url + separator + 'gmcpRefresh=' + Date.now();
    };

    const refreshImage = (panelId, key) => {
      const current = this.gmcpData[key];
      if (!current || !current.url) return;

      const refreshedUrl = buildRefreshUrl(current.url);
      this.gmcpData[key] = {
        ...current,
        loading: true,
      };
      this._renderPanel(panelId);

      const probe = new Image();
      probe.onload = () => {
        this.gmcpData[key] = {
          ...current,
          url: refreshedUrl,
          loading: false,
        };
        this._renderPanel(panelId);
      };
      probe.onerror = () => {
        this.gmcpData[key] = {
          ...current,
          loading: false,
        };
        this._renderPanel(panelId);
      };
      probe.src = refreshedUrl;
    };

    refreshImage('avatar', 'avatar');
    refreshImage('roomImage', 'roomImage');
  },

  _renderPanel(id) {
    const p = this.panels[id];
    if (!p) return;
    const renderer = panelRenderers[id];
    if (renderer) renderer(p.bodyEl, this.gmcpData[id]);
  },

  _syncBuffTimer() {
    const visible = !!(this.state.panels.buffs && this.state.panels.buffs.visible && this.panels.buffs);
    const hasTimedBuffs = Array.isArray(this.gmcpData.buffs) &&
      this.gmcpData.buffs.some((entry) => entry.duration > 0 && entry.expiresAt > 0);

    if (!visible || !hasTimedBuffs) {
      if (this._buffTimer) {
        clearInterval(this._buffTimer);
        this._buffTimer = null;
      }
      return;
    }

    if (this._buffTimer) return;
    this._buffTimer = setInterval(() => {
      if (!this.state.panels.buffs || !this.state.panels.buffs.visible || !this.panels.buffs) {
        this._syncBuffTimer();
        return;
      }
      this._renderPanel('buffs');
    }, 1000);
  },

  _syncSkyTimer() {
    const visible = !!(this.state.panels.sky && this.state.panels.sky.visible && this.panels.sky);
    const hasData = !!this.gmcpData.sky;

    if (!visible || !hasData) {
      if (this._skyTimer) {
        clearInterval(this._skyTimer);
        this._skyTimer = null;
      }
      return;
    }

    if (this._skyTimer) return;
    this._skyTimer = setInterval(() => {
      if (!this.state.panels.sky || !this.state.panels.sky.visible || !this.panels.sky) {
        this._syncSkyTimer();
        return;
      }
      this._renderPanel('sky');
    }, 1000);
  },

  _queuePanelRender(id) {
    this._pendingPanelRenders.add(id);
    if (this._panelRenderFrame) return;
    this._panelRenderFrame = requestAnimationFrame(() => {
      this._panelRenderFrame = null;
      const ids = Array.from(this._pendingPanelRenders);
      this._pendingPanelRenders.clear();
      for (const panelId of ids) {
        this._renderPanel(panelId);
      }
    });
  },

  _resetLivePanels() {
    this._restoreTerminalToClassic();
    for (const p of Object.values(this.panels)) {
      p.el.remove();
    }
    this.panels = {};
    this._syncSkyTimer();
    if (this._mobile.contentEl) {
      this._mobile.contentEl.textContent = '';
    }
  },

  _ensureMobileSheet() {
    if (this._mobile.overlayEl) return;

    const overlay = document.createElement('div');
    overlay.className = 'mobile-panels-overlay';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.closeMobileSheet();
    });

    const sheet = document.createElement('div');
    sheet.className = 'mobile-panels-sheet';

    const header = document.createElement('div');
    header.className = 'mobile-panels-header';

    const title = document.createElement('div');
    title.className = 'mobile-panels-title';
    title.textContent = 'Panels';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mobile-panels-close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', () => this.closeMobileSheet());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const tabs = document.createElement('div');
    tabs.className = 'mobile-panels-tabs';

    const extraSelect = document.createElement('select');
    extraSelect.className = 'mobile-panels-select';
    extraSelect.style.display = 'none';
    extraSelect.addEventListener('change', () => {
      if (!extraSelect.value) return;
      this._mobile.activePanelId = extraSelect.value;
      this._syncMobilePanelVisibility();
      this._renderMobileSheet();
    });

    const content = document.createElement('div');
    content.className = 'mobile-panels-content';

    const empty = document.createElement('div');
    empty.className = 'mobile-panels-empty';
    empty.textContent = 'No mobile panels are open.';
    content.appendChild(empty);

    sheet.appendChild(header);
    sheet.appendChild(tabs);
    sheet.appendChild(extraSelect);
    sheet.appendChild(content);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    this._mobile.overlayEl = overlay;
    this._mobile.tabsEl = tabs;
    this._mobile.extraSelectEl = extraSelect;
    this._mobile.contentEl = content;
    this._mobile.emptyEl = empty;
  },

  _getMobileVisiblePanelIds() {
    return Object.keys(this.state.panels).filter((id) => this.state.panels[id] && this.state.panels[id].visible && this.panels[id]);
  },

  _getPanelTitle(id) {
    if (PANEL_DEFS[id]) return PANEL_DEFS[id].title;
    const panel = this.panels[id];
    return panel && panel.title ? panel.title : id;
  },

  _renderMobileSheet() {
    if (!this._mobile.overlayEl) return;

    const visibleIds = this._getMobileVisiblePanelIds();
    const primaryIds = MOBILE_PRIMARY_PANELS.filter((id) => visibleIds.includes(id));
    const extraIds = visibleIds.filter((id) => !primaryIds.includes(id));
    this._mobile.tabsEl.textContent = '';

    if (!visibleIds.includes(this._mobile.activePanelId)) {
      this._mobile.activePanelId = this._getDefaultMobileActivePanelId();
    }

    for (const id of primaryIds) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mobile-panels-tab' + (id === this._mobile.activePanelId ? ' active' : '');
      btn.textContent = this._getPanelTitle(id);
      btn.addEventListener('click', () => {
        this._mobile.activePanelId = id;
        this._syncMobilePanelVisibility();
        this._renderMobileSheet();
      });
      this._mobile.tabsEl.appendChild(btn);
    }

    this._mobile.extraSelectEl.textContent = '';
    if (extraIds.length > 0) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'More panels';
      this._mobile.extraSelectEl.appendChild(placeholder);

      for (const id of extraIds) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = this._getPanelTitle(id);
        option.selected = id === this._mobile.activePanelId;
        this._mobile.extraSelectEl.appendChild(option);
      }

      if (!extraIds.includes(this._mobile.activePanelId)) {
        this._mobile.extraSelectEl.value = '';
      }
      this._mobile.extraSelectEl.style.display = 'block';
    } else {
      this._mobile.extraSelectEl.style.display = 'none';
    }

    this._syncMobilePanelVisibility();
  },

  _syncMobilePanelVisibility() {
    if (!this._mobile.contentEl) return;
    const activeId = this._mobile.activePanelId;
    let hasVisible = false;
    for (const [id, panel] of Object.entries(this.panels)) {
      panel.el.classList.toggle('mobile-panel-active', id === activeId);
      panel.el.classList.toggle('mobile-panel-hidden', id !== activeId);
      if (this.state.panels[id] && this.state.panels[id].visible) {
        hasVisible = true;
      }
    }
    if (this._mobile.emptyEl) {
      this._mobile.emptyEl.style.display = hasVisible ? 'none' : 'flex';
    }
  },

  attachDragHandlers() {
    const snapEdges = {};
    ['left', 'top', 'right', 'bottom'].forEach(side => {
      const el = document.createElement('div');
      el.className = 'snap-edge snap-edge-' + side;
      document.body.appendChild(el);
      snapEdges[side] = el;
    });

    const drag = {
      active: false,
      panelId: null,
      ghostEl: null,
      startX: 0, startY: 0,
      offsetX: 0, offsetY: 0,
      indicator: null,
      snapTargetId: null,
      panelAnchor: null,
      lastFloatX: 0,
      lastFloatY: 0,
      snapEdges,
    };

    drag.indicator = document.createElement('div');
    drag.indicator.className = 'dock-drop-indicator';
    document.body.appendChild(drag.indicator);

    const THRESHOLD = 5;
    let pointerStarted = false;

    document.addEventListener('pointerdown', (e) => {
      if (this._mobile.enabled) return;
      const panel = e.target.closest('.gmcp-panel-widget.floating');
      if (panel && panel.dataset.panelId) {
        this._bringPanelToFront(panel.dataset.panelId);
      }
      const header = e.target.closest('.panel-header');
      if (!header) return;
      if (e.target.closest('.panel-btn')) return;

      const panelId = header.dataset.panelId;
      if (!panelId || !this.panels[panelId]) return;

      drag.panelId = panelId;
      if (panelId === 'enemy') {
        this._draggingEnemyPanel = true;
        this._syncEnemyPanelAfterDrag = false;
      }
      drag.startX = e.clientX;
      drag.startY = e.clientY;

      const rect = this.panels[panelId].el.getBoundingClientRect();
      drag.offsetX = e.clientX - rect.left;
      drag.offsetY = e.clientY - rect.top;
      pointerStarted = true;

      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
      if (!pointerStarted || this._mobile.enabled) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (!drag.active) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        drag.active = true;

        const el = this.panels[drag.panelId].el;
        drag.ghostEl = el.cloneNode(true);
        drag.ghostEl.className = 'gmcp-panel-widget drag-ghost';
        drag.ghostEl.style.width = el.offsetWidth + 'px';
        document.body.appendChild(drag.ghostEl);

        el.style.opacity = '0.3';
      }

      let gx = e.clientX - drag.offsetX;
      let gy = e.clientY - drag.offsetY;
      const gw = drag.ghostEl.offsetWidth;
      const gh = drag.ghostEl.offsetHeight;
      const SNAP = 30;
      const bounds = this._getSnapBounds();
      const drop = this._getDropTarget(e.clientX, e.clientY, drag.panelId);

      let snL = gx < (bounds.left + SNAP);
      const snT = gy < (bounds.top + SNAP);
      let snR = (gx + gw) > (bounds.right - SNAP);
      const snB = (gy + gh) > (bounds.bottom - SNAP);
      const dockingToSidebar = drop.target === 'left' || drop.target === 'right';

      if (dockingToSidebar) {
        snL = false;
        snR = false;
      }

      if (snL) gx = bounds.left;
      if (snT) gy = bounds.top;
      if (snR) gx = bounds.right - gw;
      if (snB) gy = bounds.bottom - gh;

      const gridSnap = this._getGridSnappedFloatPosition(gx, gy, gw, gh, {
        left: snL,
        top: snT,
        right: snR,
        bottom: snB,
      });
      gx = gridSnap.x;
      gy = gridSnap.y;

      const panelSnap = this._getPanelSnapPosition(gx, gy, gw, gh, drag.panelId);
      gx = panelSnap.x;
      gy = panelSnap.y;
      this._setPanelSnapTarget(drag, panelSnap.targetId);
      drag.lastFloatX = gx;
      drag.lastFloatY = gy;

      drag.ghostEl.style.left = gx + 'px';
      drag.ghostEl.style.top = gy + 'px';

      this._showSnapEdges(snL, snT, snR, snB, bounds, drag);
      this._updateDropZone(drop, drag);
    });

    document.addEventListener('pointerup', (e) => {
      if (!pointerStarted) return;
      pointerStarted = false;

      if (!drag.active) {
        if (drag.panelId === 'enemy') {
          this._draggingEnemyPanel = false;
          if (this._syncEnemyPanelAfterDrag) {
            this._syncEnemyPanelAfterDrag = false;
            this._syncEnemyPanelVisibility();
          }
        }
        drag.panelId = null;
        this._clearPanelSnapTarget(drag);
        return;
      }

      drag.active = false;
      const panelId = drag.panelId;
      const el = this.panels[panelId].el;

      if (drag.ghostEl) { drag.ghostEl.remove(); drag.ghostEl = null; }
      el.style.opacity = '';

      drag.indicator.style.display = 'none';
      this._showSnapEdges(false, false, false, false, null, drag);
      this._clearPanelSnapTarget(drag);

      document.getElementById('left-dock').classList.remove('drag-over');
      document.getElementById('right-dock').classList.remove('drag-over');

      const drop = this._getDropTarget(e.clientX, e.clientY, panelId);
      if (drop.target === 'float') {
        // NOTE: pane-to-pane edge snapping adjusts the drop POSITION only.
        // It must never persist an anchor relationship: saved anchors were
        // re-resolved against live DOM rects on every load (including
        // hidden/mid-restore targets), rewriting and saving drifted
        // positions - panes inched across the screen on each refresh.
        this.floatPanel(
          panelId,
          drag.lastFloatX !== undefined ? drag.lastFloatX : e.clientX - drag.offsetX,
          drag.lastFloatY !== undefined ? drag.lastFloatY : e.clientY - drag.offsetY
        );
      } else {
        this.dockPanel(panelId, drop.target, drop.order);
      }

      drag.panelId = null;
      if (panelId === 'enemy') {
        this._draggingEnemyPanel = false;
        if (this._syncEnemyPanelAfterDrag) {
          this._syncEnemyPanelAfterDrag = false;
          this._syncEnemyPanelVisibility();
        }
      }
    });
  },

  _clearPanelSnapTarget(drag) {
    if (!drag || !drag.snapTargetId) return;
    const panel = this.panels[drag.snapTargetId];
    if (panel && panel.el) {
      panel.el.classList.remove('panel-snap-target');
    }
    drag.snapTargetId = null;
  },

  _setPanelSnapTarget(drag, panelId) {
    if (!drag) return;
    if (drag.snapTargetId === panelId) return;
    this._clearPanelSnapTarget(drag);
    if (!panelId) return;
    const panel = this.panels[panelId];
    if (panel && panel.el) {
      panel.el.classList.add('panel-snap-target');
      drag.snapTargetId = panelId;
    }
  },

  _getPanelSnapPosition(x, y, width, height, panelId) {
    const SNAP = 24;
    const GAP = 6;
    const right = x + width;
    const bottom = y + height;
    const overlaps = (aStart, aEnd, bStart, bEnd) =>
      aEnd >= bStart - SNAP && bEnd >= aStart - SNAP;
    let snapX = x;
    let snapY = y;
    let bestX = SNAP + 1;
    let bestY = SNAP + 1;
    let targetId = null;
    let panelAnchor = null;

    for (const [id, panel] of Object.entries(this.panels)) {
      if (id === panelId || !panel || !panel.el) continue;
      const st = this.state.panels[id];
      if (!st || st.dock !== 'float') continue;

      const rect = panel.el.getBoundingClientRect();
      const candidatesX = [
        {
          value: rect.right + GAP,
          distance: Math.abs(x - (rect.right + GAP)),
          anchor: { targetId: id, relation: 'rightOf', offsetY: y - rect.top, gap: GAP },
        },
        {
          value: rect.left - width - GAP,
          distance: Math.abs(right - (rect.left - GAP)),
          anchor: { targetId: id, relation: 'leftOf', offsetY: y - rect.top, gap: GAP },
        },
        { value: rect.left, distance: Math.abs(x - rect.left), adjacent: false },
        { value: rect.right - width, distance: Math.abs(right - rect.right), adjacent: false },
      ];
      const candidatesY = [
        {
          value: rect.bottom + GAP,
          distance: Math.abs(y - (rect.bottom + GAP)),
          anchor: { targetId: id, relation: 'below', offsetX: x - rect.left, gap: GAP },
        },
        {
          value: rect.top - height - GAP,
          distance: Math.abs(bottom - (rect.top - GAP)),
          anchor: { targetId: id, relation: 'above', offsetX: x - rect.left, gap: GAP },
        },
        { value: rect.top, distance: Math.abs(y - rect.top), adjacent: false },
        { value: rect.bottom - height, distance: Math.abs(bottom - rect.bottom), adjacent: false },
      ];

      if (overlaps(y, bottom, rect.top, rect.bottom)) {
        for (const candidate of candidatesX) {
          if (candidate.distance < bestX && candidate.distance <= SNAP) {
            bestX = candidate.distance;
            snapX = candidate.value;
            targetId = id;
            if (candidate.anchor) panelAnchor = candidate.anchor;
          }
        }
      }

      if (overlaps(x, right, rect.left, rect.right)) {
        for (const candidate of candidatesY) {
          if (candidate.distance < bestY && candidate.distance <= SNAP) {
            bestY = candidate.distance;
            snapY = candidate.value;
            targetId = id;
            if (candidate.anchor) panelAnchor = candidate.anchor;
          }
        }
      }
    }

    return { x: snapX, y: snapY, targetId, panelAnchor };
  },

  _updateDropZone(drop, drag) {
    const leftDock = document.getElementById('left-dock');
    const rightDock = document.getElementById('right-dock');

    leftDock.classList.remove('drag-over');
    rightDock.classList.remove('drag-over');
    drag.indicator.style.display = 'none';

    if (drop.target === 'left' || drop.target === 'right') {
      const dock = document.getElementById(drop.target + '-dock');
      dock.classList.add('drag-over');

      const panels = Array.from(dock.querySelectorAll('.gmcp-panel-widget'))
        .filter(el => el.dataset.panelId !== drag.panelId);

      if (panels.length === 0) {
        drag.indicator.style.display = 'block';
        const dockRect = dock.getBoundingClientRect();
        drag.indicator.style.left = dockRect.left + 'px';
        drag.indicator.style.top = (dockRect.top + 4) + 'px';
        drag.indicator.style.width = (dockRect.width - 8) + 'px';
        drag.indicator.style.position = 'fixed';
      } else if (drop.order <= 0) {
        const first = panels[0].getBoundingClientRect();
        drag.indicator.style.display = 'block';
        drag.indicator.style.left = first.left + 'px';
        drag.indicator.style.top = (first.top - 2) + 'px';
        drag.indicator.style.width = first.width + 'px';
        drag.indicator.style.position = 'fixed';
      } else if (drop.beforeId) {
        const before = panels.find(el => el.dataset.panelId === drop.beforeId);
        const rect = before ? before.getBoundingClientRect() : null;
        if (rect) {
          drag.indicator.style.display = 'block';
          drag.indicator.style.left = rect.left + 'px';
          drag.indicator.style.top = (rect.top - 2) + 'px';
          drag.indicator.style.width = rect.width + 'px';
          drag.indicator.style.position = 'fixed';
        }
      } else {
        const idx = Math.min(drop.order - 1, panels.length - 1);
        const after = panels[idx].getBoundingClientRect();
        drag.indicator.style.display = 'block';
        drag.indicator.style.left = after.left + 'px';
        drag.indicator.style.top = (after.bottom + 1) + 'px';
        drag.indicator.style.width = after.width + 'px';
        drag.indicator.style.position = 'fixed';
      }
    }
  },

  _showSnapEdges(left, top, right, bottom, bounds, drag) {
    const edges = drag.snapEdges;
    if (!bounds) {
      edges.left.style.display = 'none';
      edges.top.style.display = 'none';
      edges.right.style.display = 'none';
      edges.bottom.style.display = 'none';
      return;
    }
    edges.left.style.display = left ? 'block' : 'none';
    edges.left.style.left = bounds.left + 'px';
    edges.left.style.top = bounds.top + 'px';
    edges.left.style.height = (bounds.bottom - bounds.top) + 'px';

    edges.top.style.display = top ? 'block' : 'none';
    edges.top.style.left = bounds.left + 'px';
    edges.top.style.top = bounds.top + 'px';
    edges.top.style.width = (bounds.right - bounds.left) + 'px';

    edges.right.style.display = right ? 'block' : 'none';
    edges.right.style.left = (bounds.right - 2) + 'px';
    edges.right.style.top = bounds.top + 'px';
    edges.right.style.height = (bounds.bottom - bounds.top) + 'px';

    edges.bottom.style.display = bottom ? 'block' : 'none';
    edges.bottom.style.left = bounds.left + 'px';
    edges.bottom.style.top = (bounds.bottom - 2) + 'px';
    edges.bottom.style.width = (bounds.right - bounds.left) + 'px';
  },

  _getDropTarget(x, y, panelId) {
    const leftDock = document.getElementById('left-dock');
    const rightDock = document.getElementById('right-dock');
    const leftRect = leftDock.getBoundingClientRect();
    const rightRect = rightDock.getBoundingClientRect();
    const margin = 30;

    let side = null;
    if (this._isFloatingWorkspace() && x < margin) {
      side = 'left';
    } else if (this._isFloatingWorkspace() && x > window.innerWidth - margin) {
      side = 'right';
    } else if (x < leftRect.right + margin && !leftDock.classList.contains('collapsed')) {
      side = 'left';
    } else if (x > rightRect.left - margin && !rightDock.classList.contains('collapsed')) {
      side = 'right';
    }

    if (!side) return { target: 'float' };

    const dock = document.getElementById(side + '-dock');
    const panels = Array.from(dock.querySelectorAll('.gmcp-panel-widget'))
      .filter(el => el.dataset.panelId !== panelId);

    let order = panels.length;
    let beforeId = null;
    for (let i = 0; i < panels.length; i++) {
      const rect = panels[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        order = this.state.panels[panels[i].dataset.panelId].order;
        beforeId = panels[i].dataset.panelId;
        break;
      }
    }

    return { target: side, order, beforeId };
  },

  registerGmcpHandlers() {
    // Connection Health panel: fed by lag-monitor via document events (not
    // GMCP) so the renderer and monitor stay decoupled.
    document.addEventListener('dw:lag-update', (event) => {
      this.gmcpData.connection = event.detail;
      this._renderPanel('connection');
    });
    document.addEventListener('dw:lag-open-panel', () => {
      this.openPanel('connection');
    });

    gmcp.on('Char.Vitals', (data) => {
      this._syncSubscriptionsAfterCharacterData();
      const fullVitals = isFullVitalsPayload(data);
      this.gmcpData.vitals = fullVitals ? data : Object.assign({}, this.gmcpData.vitals || {}, data || {});
      if (data && Object.prototype.hasOwnProperty.call(data, 'opponent')) {
        this.gmcpData.enemy = this._normalizeEnemyData(data.opponent);
        this._syncEnemyPanelVisibility();
        this._renderPanel('enemy');
      }
      this._updateAvatarMeter(this.gmcpData.vitals);
      this._renderPanel('vitals');
    });

    gmcp.on('Darkwind.GuildVitals', (data) => {
      this._syncSubscriptionsAfterCharacterData();
      this.gmcpData.guildVitals = data || {};
      this._renderPanel('guildVitals');
    });

    gmcp.on('Darkwind.XPMon', (data) => {
      this._syncSubscriptionsAfterCharacterData();
      this.gmcpData.xpmon = data || {};
      this._renderPanel('xpmon');
    });

    gmcp.on('Darkwind.Divine', (data) => {
      this.gmcpData.omens = data || {};
      if (this.gmcpData.vitals) {
        this.gmcpData.vitals.divine_patron = this.gmcpData.omens.patron || '';
        this._updateAvatarMeter(this.gmcpData.vitals);
      } else {
        this._setAvatarMeterPatron(this.gmcpData.omens.patron);
      }
      this._renderPanel('omens');
    });

    gmcp.on('Darkwind.Sky', (data) => {
      this.gmcpData.sky = data || {};
      this.gmcpData.sky._receivedAt = Date.now();
      this._renderPanel('sky');
      this._syncSkyTimer();
    });

    gmcp.on('Char.Stats', (data) => {
      if (!this.gmcpData.stats) this.gmcpData.stats = {};
      this.gmcpData.stats.current = data;
      this._renderPanel('stats');
    });

    gmcp.on('Char.RealStats', (data) => {
      if (!this.gmcpData.stats) this.gmcpData.stats = {};
      this.gmcpData.stats.base = data;
      this._renderPanel('stats');
    });

    gmcp.on('Char.StatusVars', (data) => {
      this.gmcpData.statusVars = data && typeof data === 'object' ? { ...data } : {};
      this._renderPanel('status');
    });

    gmcp.on('Char.Status', (data) => {
      this._syncSubscriptionsAfterCharacterData();
      this.gmcpData.status = Object.assign({}, this.gmcpData.status || {}, data || {});
      this._renderPanel('status');
      if (!this.gmcpData.worth || !this.gmcpData.worth._dedicated) {
        this.gmcpData.worth = {
          gold: this.gmcpData.status.gold,
          bank: this.gmcpData.status.bank,
        };
        this._renderPanel('worth');
      }
    });

    gmcp.on('Char.Defences.List', (data) => {
      this.gmcpData.buffs = Array.isArray(data)
        ? data.map(normalizeDefenceEntry).filter(Boolean)
        : [];
      this._renderPanel('buffs');
      this._syncBuffTimer();
    });

    gmcp.on('Char.Defences.Add', (data) => {
      const entry = normalizeDefenceEntry(data);
      if (!entry) return;
      if (!Array.isArray(this.gmcpData.buffs)) this.gmcpData.buffs = [];
      const idx = findDefenceIndex(this.gmcpData.buffs, entry);
      if (idx >= 0) this.gmcpData.buffs[idx] = entry;
      else this.gmcpData.buffs.push(entry);
      this._renderPanel('buffs');
      this._syncBuffTimer();
    });

    gmcp.on('Char.Defences.Remove', (data) => {
      const name = data && typeof data === 'object' ? data.name : data;
      if (!name || !Array.isArray(this.gmcpData.buffs)) return;
      const key = String(name);
      this.gmcpData.buffs = this.gmcpData.buffs.filter((entry) =>
        entry.name !== key && entry.desc !== key
      );
      this._renderPanel('buffs');
      this._syncBuffTimer();
    });

    gmcp.on('Char.Worth', (data) => {
      this.gmcpData.worth = Object.assign({}, data, { _dedicated: true });
      this._renderPanel('worth');
    });

    gmcp.on('Core.Hello', (data) => {
      processGenericHello(data);
    });

    gmcp.on('Room.Info', (data) => {
      const prevRoomNum = this.gmcpData.room ? this.gmcpData.room.num : null;
      if (!this.gmcpData.room) this.gmcpData.room = {};
      Object.assign(this.gmcpData.room, data);
      processGenericRoomInfo(data);
      if (data && data.num !== undefined && data.num !== prevRoomNum) {
        this.gmcpData.roomImage = null;
        this._renderPanel('roomImage');
      }
      this._renderPanel('room');
      this._queuePanelRender('map');
    });

    gmcp.on('Darkwind.MapData2.Current', (data) => {
      markMapData2Active();
      processMapData2Current(data);
      this._queuePanelRender('map');
    });

    gmcp.on('Darkwind.MapData2.Area', (data) => {
      markMapData2Active();
      mergeMapData2Area(data);
      this._queuePanelRender('map');
    });

    gmcp.on('Darkwind.MapData2.Update', (data) => {
      markMapData2Active();
      mergeMapData2Update(data);
      this._queuePanelRender('map');
    });

    gmcp.on('Darkwind.MapData2.Error', (data) => {
      markMapData2Active();
      processMapData2Error(data);
      this._queuePanelRender('map');
    });

    // Browse: a catalog area's map, opened in its own pane (areas map <id>).
    gmcp.on('Darkwind.MapData2.BrowseArea', (data) => {
      mergeMapData2Browse(data);
      this.openPanel('areaMap');
      this._renderPanel('areaMap');
    });

    // Area resets preserve maps for every other area. Legacy/unscoped resets
    // still mean the shared map was wiped (map2d clearall).
    gmcp.on('Darkwind.MapData2.Reset', (data) => {
      markMapData2Active();
      if (data && data.scope === 'area' && typeof data.area === 'string' && data.area) {
        clearMapData2ForArea(data.area, data);
      } else {
        clearMapData2();
        exitMapData2Browse();
        if (this.panels['areaMap']) this.closePanel('areaMap');
      }
      this._queuePanelRender('map');
    });

    gmcp.on('Room.Players', (data) => {
      if (!this.gmcpData.room) this.gmcpData.room = {};
      this.gmcpData.room.players = data;
      this._renderPanel('room');
    });

    gmcp.on('Room.AddPlayer', (data) => {
      if (!this.gmcpData.room) this.gmcpData.room = {};
      if (!Array.isArray(this.gmcpData.room.players)) this.gmcpData.room.players = [];
      this.gmcpData.room.players.push(data);
      this._renderPanel('room');
    });

    gmcp.on('Room.RemovePlayer', (data) => {
      if (!this.gmcpData.room || !Array.isArray(this.gmcpData.room.players)) return;
      const name = typeof data === 'string' ? data : data.name;
      this.gmcpData.room.players = this.gmcpData.room.players.filter(p => p.name !== name);
      this._renderPanel('room');
    });

    gmcp.on('Char.Items.List', (data) => {
      if (data && data.location === 'inv') {
        this.gmcpData.inventory = Array.isArray(data.items) ? data.items : [];
        this._renderPanel('inventory');
      }
    });

    gmcp.on('Char.Items.Add', (data) => {
      if (data && data.location === 'inv' && data.item) {
        if (!this.gmcpData.inventory) this.gmcpData.inventory = [];
        this.gmcpData.inventory.push(data.item);
        this._renderPanel('inventory');
      }
    });

    gmcp.on('Char.Items.Remove', (data) => {
      if (data && data.location === 'inv' && data.item && this.gmcpData.inventory) {
        this.gmcpData.inventory = this.gmcpData.inventory.filter(i => i.id !== data.item.id);
        this._renderPanel('inventory');
      }
    });

    gmcp.on('Char.Items.Update', (data) => {
      if (data && data.location === 'inv' && data.item && this.gmcpData.inventory) {
        const idx = this.gmcpData.inventory.findIndex(i => i.id === data.item.id);
        if (idx >= 0) this.gmcpData.inventory[idx] = data.item;
        this._renderPanel('inventory');
      }
    });

    gmcp.on('Char.Enemy', (data) => {
      this.gmcpData.enemy = this._normalizeEnemyData(data);
      this._syncEnemyPanelVisibility();
      this._renderPanel('enemy');
    });

    gmcp.on('Darkwind.Char.Avatar', (data) => {
      if (!data || !data.url) return;

      this.gmcpData.avatar = {
        url: data.url,
        name: data.name || 'Avatar',
        loading: false,
      };
      this._renderPanel('avatar');
    });

    gmcp.on('Darkwind.Room.Image', (data) => {
      let prev;
      let probe;

      if (!data || !data.url) return;

      prev = this.gmcpData.roomImage;
      this.gmcpData.roomImage = {
        url: prev ? prev.url : null,
        name: data.name,
        loading: true,
      };
      this._renderPanel('roomImage');

      probe = new Image();
      probe.onload = () => {
        this.gmcpData.roomImage = {
          url: data.url,
          name: data.name,
          loading: false,
        };
        this._renderPanel('roomImage');
      };
      probe.onerror = () => {
        this.gmcpData.roomImage = {
          url: prev ? prev.url : null,
          name: data.name,
          loading: false,
        };
        this._renderPanel('roomImage');
      };
      probe.src = data.url;
    });

    gmcp.on('Group', (data) => {
      this.gmcpData.group = data;
      this._renderPanel('group');
    });

    gmcp.on('Comm.Channel.List', (data) => {
      const chat = this._ensureChatData();
      chat.channels = Array.isArray(data)
        ? data.filter((entry) => entry && typeof entry === 'object')
        : [];
      this._renderPanel('chat');
    });

    gmcp.on('Comm.Channel.Players', (data) => {
      const chat = this._ensureChatData();
      chat.players = Array.isArray(data)
        ? data.filter((entry) => entry && typeof entry === 'object')
        : [];
      this._renderPanel('chat');
    });

    gmcp.on('Comm.Channel.Start', (data) => {
      const channel = normalizeChannelName(data);
      if (!channel) return;
      const chat = this._ensureChatData();
      if (!chat.activeChannels.includes(channel)) chat.activeChannels.push(channel);
      this._renderPanel('chat');
    });

    gmcp.on('Comm.Channel.End', (data) => {
      const channel = normalizeChannelName(data);
      if (!channel) return;
      const chat = this._ensureChatData();
      chat.activeChannels = chat.activeChannels.filter((entry) => entry !== channel);
      this._renderPanel('chat');
    });

    gmcp.on('Comm.Channel', (data) => {
      this._appendChatMessage(data);
    });

    gmcp.on('Comm.Channel.Text', (data) => {
      this._appendChatMessage(data);
    });

    gmcp.on('Darkwind.Quests.List', (data) => {
      if (!this.gmcpData.quests) this.gmcpData.quests = {};
      this.gmcpData.quests.list = data;
      this._renderPanel('quests');
    });

    gmcp.on('Darkwind.Quests.Active', (data) => {
      if (!this.gmcpData.quests) this.gmcpData.quests = {};
      this.gmcpData.quests.active = data;
      this._renderPanel('quests');
    });

    gmcp.on('Darkwind.Quests.Update', (data) => {
      if (!this.gmcpData.quests) this.gmcpData.quests = {};
      this.gmcpData.quests.lastUpdate = data;
      if (Array.isArray(this.gmcpData.quests.list)) {
        for (let q = 0; q < this.gmcpData.quests.list.length; q++) {
          const quest = this.gmcpData.quests.list[q];
          if (data.questId && quest.id !== data.questId && quest.questPath !== data.questId) continue;
          if (Array.isArray(quest.objectives)) {
            for (let i = 0; i < quest.objectives.length; i++) {
              if (quest.objectives[i].name === data.objective) {
                quest.objectives[i].current = data.current;
                quest.objectives[i].required = data.required;
                quest.objectives[i].status = data.current >= data.required ? 'finished' : 'started';
                break;
              }
            }
          }
          if (typeof quest.current === 'number' && typeof data.current === 'number') {
            let totalCurrent = 0;
            if (Array.isArray(quest.objectives)) {
              for (let i = 0; i < quest.objectives.length; i++) {
                totalCurrent += Number(quest.objectives[i].current || 0);
              }
              quest.current = totalCurrent;
            }
          }
          if (typeof data.status === 'string' && data.status) {
            quest.status = data.status;
          }
          if (data.readyToTurnIn !== undefined) {
            quest.readyToTurnIn = !!data.readyToTurnIn;
            if (quest.readyToTurnIn) quest.status = 'Ready to Turn In';
          }
          if (data.giverArea) quest.giverArea = data.giverArea;
          break;
        }
      }
      this._renderPanel('quests');
    });

    gmcp.on('Darkwind.Quests.Complete', (data) => {
      if (!this.gmcpData.quests) this.gmcpData.quests = {};
      this.gmcpData.quests.lastComplete = data;
      this._renderPanel('quests');
    });

    gmcp.on('Darkwind.Achievements.List', (data) => {
      this.gmcpData.achievements = data || {};
      this._renderPanel('achievements');
    });

    gmcp.on('Darkwind.Achievements.Update', (data) => {
      let existing;
      let index;
      let family;

      if (!this.gmcpData.achievements) this.gmcpData.achievements = { summary: {}, families: [] };

      if (data && data.summary) {
        this.gmcpData.achievements.summary = data.summary;
      }

      if (Array.isArray(data && data.families)) {
        existing = Array.isArray(this.gmcpData.achievements.families)
          ? this.gmcpData.achievements.families.slice()
          : [];

        for (family of data.families) {
          index = existing.findIndex(item => item && item.id === family.id);
          if (index >= 0) existing[index] = family;
          else existing.push(family);
        }

        existing.sort((a, b) => {
          const aName = a && a.name ? a.name : '';
          const bName = b && b.name ? b.name : '';
          return aName.localeCompare(bName);
        });

        this.gmcpData.achievements.families = existing;
      }

      if (Array.isArray(data && data.newlyUnlocked)) {
        this.gmcpData.achievements.newlyUnlocked = data.newlyUnlocked;
      }

      this._renderPanel('achievements');
    });
  },
};
