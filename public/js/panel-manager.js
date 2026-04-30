import { gmcp } from './gmcp.js';
import { PANEL_DEFS, PANEL_STORAGE_KEY } from './panel-defs.js';
import { panelRenderers } from './panel-renderers.js';
import { processRoomInfo, mergeServerAreaData, mergeServerUpdate, applyRoomCorrection, load as loadMapData } from './map-data.js';

const MOBILE_BREAKPOINT_PX = 700;
const MOBILE_PRIMARY_PANELS = ['room', 'vitals', 'buffs', 'inventory', 'map', 'chat', 'quests', 'achievements'];

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

export const panelManager = {
  state: { docks: { left: false, right: false }, panels: {} },
  panels: {},
  gmcpData: {},
  _saveTimer: null,
  _subscriptionTimer: null,
  _buffTimer: null,
  _avatarMeterTicker: null,
  _avatarActiveEndAt: 0,
  _avatarActiveMaxSec: 0,
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
    this.loadState();
    this.buildPanelsMenu();
    this._ensureMobileSheet();

    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }

    this._applyDockStateToDom();
    loadMapData();
    this.attachDragHandlers();
    this.registerGmcpHandlers();
    this._attachResizeHandler();
    this._syncResponsiveMode(true);
  },

  exportState() {
    return cloneState(this.state);
  },

  applyImportedState(nextState) {
    if (!nextState || typeof nextState !== 'object') return;

    try {
      localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(nextState));
    } catch (error) {
      console.warn('Failed to save imported panel state', error);
    }

    this._resetLivePanels();
    this.loadState();
    this.buildPanelsMenu();

    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id] && this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }

    this._applyDockStateToDom();
    this._renderMobileSheet();
    if (!this._mobile.enabled) {
      this.repositionSnappedPanels();
    }
    this.syncGmcpSubscriptions('visibility-sync', true);
  },

  getSubscriptionPanels() {
    const panels = {};
    for (const id of Object.keys(PANEL_DEFS)) {
      panels[id] = !!(this.state.panels[id] && this.state.panels[id].visible);
    }
    panels.vitals = true;
    if (panels.buffs) panels.status = true;
    return panels;
  },

  syncGmcpSubscriptions(reason = 'visibility-sync', full = false, extraFeatures = {}) {
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

  loadState() {
    let saved = null;
    try {
      const raw = localStorage.getItem(PANEL_STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch(e) { /* ignore */ }

    if (saved && saved.docks) {
      this.state.docks = saved.docks;
    }

    const panels = {};
    for (const [id, def] of Object.entries(PANEL_DEFS)) {
      const s = (saved && saved.panels && saved.panels[id]) || {};
      const hasSavedState = !!(saved && saved.panels && saved.panels[id]);
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
      panels[id] = {
        dock: s.dock || def.defaultDock,
        order: s.order !== undefined ? s.order : def.defaultOrder,
        collapsed: !!s.collapsed,
        visible: s.visible !== undefined ? s.visible : (def.defaultVisible !== undefined ? def.defaultVisible : true),
        floatX: s.floatX !== undefined ? s.floatX : defX,
        floatY: s.floatY !== undefined ? s.floatY : defY,
        floatW: s.floatW || defW,
        floatH: s.floatH || defH,
        snapLeft: s.snapLeft !== undefined ? !!s.snapLeft : defaultSnapLeft,
        snapTop: s.snapTop !== undefined ? !!s.snapTop : defaultSnapTop,
        snapRight: s.snapRight !== undefined ? !!s.snapRight : defaultSnapRight,
        snapBottom: s.snapBottom !== undefined ? !!s.snapBottom : defaultSnapBottom,
      };
    }
    this.state.panels = panels;
  },

  saveState() {
    if (this._mobile.enabled) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(this.state)); }
      catch(e) { /* ignore */ }
    }, 500);
  },

  buildPanelsMenu() {
    const menu = document.getElementById('panels-menu');
    menu.innerHTML = '';
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
    if (this._mobile.enabled) return;
    this.state.docks[side] = collapsed;
    this._applyDockStateToDom();
    this.saveState();
  },

  toggleMobileSheet() {
    if (!this._mobile.enabled) return;
    if (this._mobile.sheetOpen) this.closeMobileSheet();
    else this.openMobileSheet();
  },

  openMobileSheet() {
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

  createPanel(id) {
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

    if (this.gmcpData[id]) {
      this._renderPanel(id);
    }
    this._renderMobileSheet();
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
    this._applyFloatPosition(el, st);

    const id = el.dataset.panelId;
    const ro = new ResizeObserver(() => {
      const s = this.state.panels[id];
      if (s && s.dock === 'float' && !this._mobile.enabled) {
        s.floatW = el.offsetWidth;
        s.floatH = el.offsetHeight;
        this.saveState();
      }
    });
    ro.observe(el);
  },

  _getSnapBounds() {
    const toolbar = document.getElementById('toolbar');
    const statusBar = document.getElementById('status-bar');
    const inputBar = document.getElementById('input-bar');
    const leftDock = document.getElementById('left-dock');
    const rightDock = document.getElementById('right-dock');
    const top = toolbar ? toolbar.offsetHeight : 0;
    const bottom = (statusBar ? statusBar.offsetHeight : 0)
      + (inputBar ? inputBar.offsetHeight : 0);
    const leftEdge = leftDock ? leftDock.getBoundingClientRect().right : 0;
    let rightEdge = rightDock ? rightDock.getBoundingClientRect().left : window.innerWidth;
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

  repositionSnappedPanels() {
    if (this._mobile.enabled) return;
    for (const [id, st] of Object.entries(this.state.panels)) {
      if (st.dock !== 'float') continue;
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

    for (const id of Object.keys(PANEL_DEFS)) {
      if (this.state.panels[id] && this.state.panels[id].visible) {
        this.createPanel(id);
      }
    }
    this._applyDockStateToDom();
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
    const leftCollapsed = this._mobile.enabled ? true : !!this.state.docks.left;
    const rightCollapsed = this._mobile.enabled ? true : !!this.state.docks.right;

    leftDock.classList.toggle('collapsed', leftCollapsed);
    rightDock.classList.toggle('collapsed', rightCollapsed);

    document.getElementById('left-dock-toggle').classList.toggle('active', !leftCollapsed);
    document.getElementById('right-dock-toggle').classList.toggle('active', !rightCollapsed);
  },

  dockPanel(id, side, order) {
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
  },

  floatPanel(id, x, y) {
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

    const SNAP = 30;
    const w = st.floatW || p.el.offsetWidth || 280;
    const h = st.floatH || p.el.offsetHeight || 200;
    const bounds = this._getSnapBounds();

    st.snapLeft = x < (bounds.left + SNAP);
    st.snapTop = y < (bounds.top + SNAP);
    st.snapRight = (x + w) > (bounds.right - SNAP);
    st.snapBottom = (y + h) > (bounds.bottom - SNAP);

    if (st.snapLeft) st.floatX = bounds.left;
    if (st.snapTop) st.floatY = bounds.top;
    if (st.snapRight) st.floatX = bounds.right - w;
    if (st.snapBottom) st.floatY = bounds.bottom - h;

    this._makeFloat(p.el, st);

    const fb = p.el.querySelector('.panel-float');
    if (fb) { fb.title = 'Dock'; fb.innerHTML = '&#x25A3;'; }

    this.saveState();
  },

  collapsePanel(id, collapsed) {
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
    const st = this.state.panels[id];
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
    this.saveState();
    this.syncGmcpSubscriptions('panel-close', false);
  },

  openPanel(id) {
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
    this.saveState();
    this.syncGmcpSubscriptions('panel-open', false);
  },

  createDynamicPanel(id, title, dock, order, onClose) {
    if (this.panels[id]) return this.panels[id].bodyEl;

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

    controls.appendChild(collapseBtn);
    controls.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(controls);

    const body = document.createElement('div');
    body.className = 'panel-body';

    el.appendChild(header);
    el.appendChild(body);

    this.panels[id] = { el, headerEl: header, bodyEl: body, dynamic: true, title };
    this.state.panels[id] = { dock, order, collapsed: false, visible: true };

    if (this._mobile.enabled) {
      this._placePanelElement(id, el, this.state.panels[id]);
      this._mobile.activePanelId = id;
      this.openMobileSheet();
    } else {
      this._insertIntoDock(id, el, dock, order);
    }

    this._renderMobileSheet();
    return body;
  },

  removeDynamicPanel(id) {
    const p = this.panels[id];
    if (!p) return;
    p.el.remove();
    delete this.panels[id];
    delete this.state.panels[id];
    if (this._mobile.activePanelId === id) {
      this._mobile.activePanelId = this._getDefaultMobileActivePanelId();
    }
    this._renderMobileSheet();
  },

  resetData(options = {}) {
    const preservePanels = new Set(Array.isArray(options.preservePanels) ? options.preservePanels : []);
    const preservedData = {};

    for (const id of preservePanels) {
      if (this.gmcpData[id] !== undefined) preservedData[id] = this.gmcpData[id];
    }

    this.gmcpData = preservedData;
    this._pendingPanelRenders.clear();
    if (this._panelRenderFrame) {
      cancelAnimationFrame(this._panelRenderFrame);
      this._panelRenderFrame = null;
    }
    for (const [id, p] of Object.entries(this.panels)) {
      if (preservePanels.has(id) && this.gmcpData[id] !== undefined) {
        this._renderPanel(id);
      } else {
        p.bodyEl.innerHTML = '<div class="placeholder">Waiting for data...</div>';
      }
    }
    this._renderPanel('avatar');
    this._hideAvatarMeter();
  },

  _hideAvatarMeter() {
    const meter = document.getElementById('avatar-meter');
    if (!meter) return;
    meter.classList.remove('visible', 'full', 'active');
    meter.removeAttribute('data-avatar-meter-present');
    this._stopAvatarMeterTicker();
    this._avatarActiveEndAt = 0;
    this._avatarActiveMaxSec = 0;
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
    if (!meter || !this._avatarActiveEndAt) {
      this._stopAvatarMeterTicker();
      return;
    }
    const remaining = Math.max(0, Math.ceil((this._avatarActiveEndAt - Date.now()) / 1000));
    if (remaining <= 0) {
      this._stopAvatarMeterTicker();
      this._avatarActiveEndAt = 0;
      meter.classList.remove('active');
      const fill = meter.querySelector('.avatar-meter-fill');
      const label = meter.querySelector('.avatar-meter-label');
      if (fill) fill.style.width = '0%';
      if (label) label.textContent = 'Wrathful Avatar 0:00';
      return;
    }
    this._renderAvatarActive(remaining);
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

  _updateAvatarMeter(data) {
    const meter = document.getElementById('avatar-meter');
    if (!meter || !data || typeof data !== 'object') return;

    const hasCharge = Object.prototype.hasOwnProperty.call(data, 'avatar_charge_pct');
    if (!hasCharge) {
      const looksFullRefresh = ['hp', 'maxhp', 'sp', 'maxsp', 'string']
        .every(key => Object.prototype.hasOwnProperty.call(data, key));
      if (looksFullRefresh) {
        this._hideAvatarMeter();
      }
      return;
    }

    const pct = Math.max(0, Math.min(100, Number(data.avatar_charge_pct) || 0));
    const activeRemaining = Number(data.avatar_active_remaining) || 0;
    const active = activeRemaining > 0;
    const fill = meter.querySelector('.avatar-meter-fill');
    const label = meter.querySelector('.avatar-meter-label');

    meter.setAttribute('data-avatar-meter-present', '1');
    meter.classList.add('visible');
    meter.classList.toggle('full', pct >= 100 && !active);
    meter.classList.toggle('active', active);

    if (active) {
      this._avatarActiveEndAt = Date.now() + activeRemaining * 1000;
      if (activeRemaining > this._avatarActiveMaxSec) {
        this._avatarActiveMaxSec = activeRemaining;
      }
      this._renderAvatarActive(activeRemaining);
      this._startAvatarMeterTicker();
    } else {
      this._stopAvatarMeterTicker();
      this._avatarActiveEndAt = 0;
      this._avatarActiveMaxSec = 0;
      if (fill) fill.style.width = pct + '%';
      if (label) label.textContent = 'Wrathful Avatar ' + pct + '%';
    }
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
    for (const p of Object.values(this.panels)) {
      p.el.remove();
    }
    this.panels = {};
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
      snapEdges,
    };

    drag.indicator = document.createElement('div');
    drag.indicator.className = 'dock-drop-indicator';
    document.body.appendChild(drag.indicator);

    const THRESHOLD = 5;
    let pointerStarted = false;

    document.addEventListener('pointerdown', (e) => {
      if (this._mobile.enabled) return;
      const header = e.target.closest('.panel-header');
      if (!header) return;
      if (e.target.closest('.panel-btn')) return;

      const panelId = header.dataset.panelId;
      if (!panelId || !this.panels[panelId]) return;

      drag.panelId = panelId;
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

      const snL = gx < (bounds.left + SNAP);
      const snT = gy < (bounds.top + SNAP);
      const snR = (gx + gw) > (bounds.right - SNAP);
      const snB = (gy + gh) > (bounds.bottom - SNAP);

      if (snL) gx = bounds.left;
      if (snT) gy = bounds.top;
      if (snR) gx = bounds.right - gw;
      if (snB) gy = bounds.bottom - gh;

      drag.ghostEl.style.left = gx + 'px';
      drag.ghostEl.style.top = gy + 'px';

      this._showSnapEdges(snL, snT, snR, snB, bounds, drag);
      this._updateDropZone(e.clientX, e.clientY, drag);
    });

    document.addEventListener('pointerup', (e) => {
      if (!pointerStarted) return;
      pointerStarted = false;

      if (!drag.active) {
        drag.panelId = null;
        return;
      }

      drag.active = false;
      const panelId = drag.panelId;
      const el = this.panels[panelId].el;

      if (drag.ghostEl) { drag.ghostEl.remove(); drag.ghostEl = null; }
      el.style.opacity = '';

      drag.indicator.style.display = 'none';
      this._showSnapEdges(false, false, false, false, null, drag);

      document.getElementById('left-dock').classList.remove('drag-over');
      document.getElementById('right-dock').classList.remove('drag-over');

      const drop = this._getDropTarget(e.clientX, e.clientY, panelId);
      if (drop.target === 'float') {
        this.floatPanel(panelId, e.clientX - drag.offsetX, e.clientY - drag.offsetY);
      } else {
        this.dockPanel(panelId, drop.target, drop.order);
      }

      drag.panelId = null;
    });
  },

  _updateDropZone(x, y, drag) {
    const leftDock = document.getElementById('left-dock');
    const rightDock = document.getElementById('right-dock');

    leftDock.classList.remove('drag-over');
    rightDock.classList.remove('drag-over');
    drag.indicator.style.display = 'none';

    const drop = this._getDropTarget(x, y, drag.panelId);
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
    if (x < leftRect.right + margin && !leftDock.classList.contains('collapsed')) {
      side = 'left';
    } else if (x > rightRect.left - margin && !rightDock.classList.contains('collapsed')) {
      side = 'right';
    }

    if (!side) return { target: 'float' };

    const dock = document.getElementById(side + '-dock');
    const panels = Array.from(dock.querySelectorAll('.gmcp-panel-widget'))
      .filter(el => el.dataset.panelId !== panelId);

    let order = panels.length;
    for (let i = 0; i < panels.length; i++) {
      const rect = panels[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        order = this.state.panels[panels[i].dataset.panelId].order;
        break;
      }
    }

    return { target: side, order };
  },

  registerGmcpHandlers() {
    gmcp.on('Char.Vitals', (data) => {
      const fullVitals = data && ['hp', 'maxhp', 'sp', 'maxsp', 'string']
        .every(key => Object.prototype.hasOwnProperty.call(data, key));
      this.gmcpData.vitals = fullVitals ? data : Object.assign({}, this.gmcpData.vitals || {}, data || {});
      this._updateAvatarMeter(data);
      this._renderPanel('vitals');
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

    gmcp.on('Char.Status', (data) => {
      this.gmcpData.status = data;
      this._renderPanel('status');
      if (!this.gmcpData.worth || !this.gmcpData.worth._dedicated) {
        this.gmcpData.worth = { gold: data.gold, bank: data.bank };
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

    gmcp.on('Room.Info', (data) => {
      const prevRoomNum = this.gmcpData.room ? this.gmcpData.room.num : null;
      if (!this.gmcpData.room) this.gmcpData.room = {};
      Object.assign(this.gmcpData.room, data);
      if (data && data.num !== undefined && data.num !== prevRoomNum) {
        this.gmcpData.roomImage = null;
        this._renderPanel('roomImage');
      }
      this._renderPanel('room');
      processRoomInfo(data);
      this._queuePanelRender('map');
    });

    gmcp.on('Darkwind.MapData.Area', (data) => {
      const merged = mergeServerAreaData(data);
      if (merged) this._queuePanelRender('map');
    });

    gmcp.on('Darkwind.MapData.Update', (data) => {
      const merged = mergeServerUpdate(data);
      if (merged) this._queuePanelRender('map');
    });

    gmcp.on('Darkwind.MapData.RoomCoords', (data) => {
      const merged = applyRoomCorrection(data);
      if (merged) this._queuePanelRender('map');
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
      this.gmcpData.enemy = data;
      const inCombat = data && data.enemy_name && data.enemy_name !== 'None' && data.enemy_name !== '';
      if (inCombat && !this.panels.enemy) {
        this.openPanel('enemy');
      }
      if (this.panels.enemy) {
        this.panels.enemy.el.style.display = inCombat ? '' : 'none';
      }
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

    gmcp.on('Comm.Channel.Text', (data) => {
      if (!this.gmcpData.chat) this.gmcpData.chat = [];
      this.gmcpData.chat.push(data);
      if (this.gmcpData.chat.length > 200) this.gmcpData.chat.shift();
      this._renderPanel('chat');
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
      if (this.gmcpData.quests.active && Array.isArray(this.gmcpData.quests.active.objectives)) {
        for (let i = 0; i < this.gmcpData.quests.active.objectives.length; i++) {
          if (this.gmcpData.quests.active.objectives[i].name === data.objective) {
            this.gmcpData.quests.active.objectives[i].current = data.current;
            this.gmcpData.quests.active.objectives[i].required = data.required;
            this.gmcpData.quests.active.objectives[i].status = data.current >= data.required ? 'finished' : 'started';
            break;
          }
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
