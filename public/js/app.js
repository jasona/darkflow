import { state, dom, initDom } from './state.js';
import { gmcp } from './gmcp.js';
import { initOutput } from './output.js';
import { panelManager } from './panel-manager.js';
import { connect, getWsDebugSnapshot } from './connection.js';
import { loadHistory, saveHistory, saveHistoryNow, initInput } from './input.js';
import { windowManager } from './window-manager.js';
import { ideManager } from './ide-manager.js';
import { announcementsManager } from './announcements-manager.js';
import { giphyManager } from './giphy-manager.js';
import { settingsManager } from './settings-manager.js';
import { flushPendingMapSave } from './map-data.js';
import { aliasManager } from './alias-manager.js';
import { highlightManager } from './highlight-manager.js';
import { triggerManager } from './trigger-manager.js';
import { sendAutomaticCommand } from './input.js';
import { PRODUCT_NAME, gameTitle } from './brand.js';
import { openAboutModal } from './about-modal.js';

// ── Initialize DOM refs ─────────────────────────────────────────────
initDom();
initOutput();

const startupUrlParams = new URLSearchParams(window.location.search);
const wsDebugEnabled = startupUrlParams.get('debugWs') === '1';
const gmcpDebugEnabled = startupUrlParams.get('debugGmcp') === '1';

// ── Status Bar ──────────────────────────────────────────────────────
function formatDuration(ms) {
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000);
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

setInterval(function() {
  if (state.connectTime) {
    dom.statusConnection.textContent = 'Connected: ' + formatDuration(Date.now() - state.connectTime);
    dom.statusConnection.title = 'Sent: ' + formatBytes(state.bytesSent) + ' / Recv: ' + formatBytes(state.bytesReceived);
  }
}, 1000);

// ── GMCP Debug Panel ────────────────────────────────────────────────
const gmcpEntries = [];
const GMCP_ENTRY_LIMIT = 200;

function renderGmcpEntries() {
  gmcpEntriesEl.textContent = '';
  const frag = document.createDocumentFragment();
  for (const line of gmcpEntries) {
    const entry = document.createElement('div');
    entry.className = 'gmcp-entry';
    entry.textContent = line;
    frag.appendChild(entry);
  }
  gmcpEntriesEl.appendChild(frag);
}

function pushGmcpEntry(line) {
  gmcpEntries.push(line);
  if (gmcpEntries.length > GMCP_ENTRY_LIMIT) {
    gmcpEntries.splice(0, gmcpEntries.length - GMCP_ENTRY_LIMIT);
  }

  if (!gmcpDebugEnabled && !dom.gmcpPanel.classList.contains('open')) {
    return;
  }

  renderGmcpEntries();
  dom.gmcpPanel.scrollTop = dom.gmcpPanel.scrollHeight;
}

dom.gmcpToggle.addEventListener('click', function() {
  const visible = dom.gmcpPanel.classList.toggle('open');
  dom.gmcpToggle.style.color = visible ? '#58a6ff' : '#8b949e';
  if (visible) {
    renderGmcpEntries();
    dom.gmcpPanel.scrollTop = dom.gmcpPanel.scrollHeight;
  }
});

const gmcpToolbar = document.createElement('div');
gmcpToolbar.className = 'gmcp-toolbar';
const gmcpEntriesEl = document.createElement('div');
gmcpEntriesEl.className = 'gmcp-entries';

function makeGmcpBtn(label, cls) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.className = 'gmcp-toolbar-btn' + (cls ? ' ' + cls : '');
  return btn;
}

const gmcpCopyBtn = makeGmcpBtn('Copy All');
gmcpCopyBtn.addEventListener('click', function() {
  navigator.clipboard.writeText(gmcpEntries.join('\n')).then(function() {
    gmcpCopyBtn.textContent = 'Copied!';
    setTimeout(function() { gmcpCopyBtn.textContent = 'Copy All'; }, 1500);
  });
});

const mapSummaryBtn = makeGmcpBtn('Map Summary');
mapSummaryBtn.addEventListener('click', function() {
  if (!window.mapDebug) return;
  const summary = window.mapDebug.summary();
  pushGmcpEntry('[' + new Date().toLocaleTimeString() + '] mapDebug.summary ' + JSON.stringify(summary));
});

const mapExportBtn = makeGmcpBtn('Map Export');
mapExportBtn.addEventListener('click', function() {
  if (!window.mapDebug) return;
  const json = window.mapDebug.exportAll();
  navigator.clipboard.writeText(json).then(function() {
    mapExportBtn.textContent = 'Copied!';
    setTimeout(function() { mapExportBtn.textContent = 'Map Export'; }, 1500);
  });
});

const mapClearBtn = makeGmcpBtn('Clear Map', 'danger');
mapClearBtn.addEventListener('click', function() {
  if (!window.mapDebug) return;
  if (!confirm('Clear all map data? This cannot be undone.')) return;
  window.mapDebug.clearData();
  pushGmcpEntry('[' + new Date().toLocaleTimeString() + '] mapDebug.clearData -- Map data cleared');
});

gmcpToolbar.appendChild(mapSummaryBtn);
gmcpToolbar.appendChild(mapExportBtn);
gmcpToolbar.appendChild(mapClearBtn);
gmcpToolbar.appendChild(gmcpCopyBtn);
dom.gmcpPanel.appendChild(gmcpToolbar);
dom.gmcpPanel.appendChild(gmcpEntriesEl);

gmcp.on('*', function(packageName, data) {
  if (wsDebugEnabled) {
    console.log('[GMCP]', packageName, data);
  }
  pushGmcpEntry('[' + new Date().toLocaleTimeString() + '] '
    + packageName + ' ' + JSON.stringify(data));
});

// ── Game Uptime (from GMCP Game package) ────────────────────────────
function formatUptime(totalSeconds) {
  let s = Math.floor(totalSeconds);
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  const parts = [];
  if (d > 0) parts.push(d + 'd');
  if (h > 0) parts.push(h + 'h');
  if (m > 0) parts.push(m + 'm');
  parts.push(s + 's');
  return parts.join(' ');
}

let clientVersion = null;
let serverVersion = null;

function getTabObservabilityState() {
  return document.visibilityState === 'visible' ? 'visible' : 'hidden';
}

function getTabObservabilityCommand(tabState) {
  return tabState === 'hidden' ? 'tab-away' : 'tab-back';
}

function emitTabObservabilityState(tabState) {
  state.tabObservability.currentState = tabState;

  if (!state.settings.tabObservabilityEnabled) return false;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
  if (state.tabObservability.lastSentState === tabState) return false;

  const command = getTabObservabilityCommand(tabState);
  if (!sendAutomaticCommand(command, { echo: true })) return false;
  state.tabObservability.lastSentState = tabState;
  return true;
}

export function emitCurrentTabObservabilityState() {
  return emitTabObservabilityState(getTabObservabilityState());
}

function updateVersionDisplay() {
  const parts = [];
  if (clientVersion) parts.push('Client v' + clientVersion);
  if (serverVersion) parts.push('Server v' + serverVersion);
  dom.statusVersions.textContent = parts.join(' | ');
}

function setClientVersion(version) {
  clientVersion = version || 'unknown';
  state.clientVersion = clientVersion;
  updateVersionDisplay();
}

gmcp.on('Game', function(data) {
  if (data && data.game_uptime !== undefined) {
    dom.statusUptime.textContent = 'Uptime: ' + formatUptime(data.game_uptime);
  }
  if (data && data.game_name) {
    updateBranding(data.game_name);
  }
  if (data && data.game_version) {
    serverVersion = data.game_version;
    updateVersionDisplay();
  }
});

function updateBranding(name) {
  const brandText = dom.toolbarBrand.querySelector('span');
  if (brandText) brandText.textContent = PRODUCT_NAME;
  document.title = gameTitle(name);
}

// ── Connect Button ──────────────────────────────────────────────────
dom.connectBtn.addEventListener('click', function() {
  connect();
});

// ── Settings Modal ──────────────────────────────────────────────────
document.getElementById('gear-btn').addEventListener('click', function() {
  settingsManager.open();
});

const toolbarBrandIcon = dom.toolbarBrand ? dom.toolbarBrand.querySelector('img') : null;
if (toolbarBrandIcon) {
  toolbarBrandIcon.setAttribute('role', 'button');
  toolbarBrandIcon.setAttribute('tabindex', '0');
  toolbarBrandIcon.setAttribute('title', 'About ' + PRODUCT_NAME);
  toolbarBrandIcon.addEventListener('click', openAboutModal);
  toolbarBrandIcon.addEventListener('keydown', function(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAboutModal();
    }
  });
}

// ── Sidebar Toggles ─────────────────────────────────────────────────
document.getElementById('left-dock-toggle').addEventListener('click', function() {
  const dock = document.getElementById('left-dock');
  const collapsed = !dock.classList.contains('collapsed');
  panelManager.setDockCollapsed('left', collapsed);
  setTimeout(() => panelManager.repositionSnappedPanels(), 310);
});

document.getElementById('right-dock-toggle').addEventListener('click', function() {
  const dock = document.getElementById('right-dock');
  const collapsed = !dock.classList.contains('collapsed');
  panelManager.setDockCollapsed('right', collapsed);
  setTimeout(() => panelManager.repositionSnappedPanels(), 310);
});

dom.mobilePanelsBtn.addEventListener('click', function() {
  panelManager.toggleMobileSheet();
});

// ── Panels Menu ─────────────────────────────────────────────────────
document.getElementById('panels-menu-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('panels-menu').classList.toggle('open');
});

// Close dropdowns on outside click
document.addEventListener('click', function() {
  document.getElementById('panels-menu').classList.remove('open');
});

// ── Init ────────────────────────────────────────────────────────────
settingsManager.init();
aliasManager.init();
highlightManager.init();
triggerManager.init();
state.tabObservability.currentState = getTabObservabilityState();

// Load server config, then apply URL param overrides
fetch('/config.json').then(r => r.json()).catch(() => ({})).then(config => {
  const urlParams = new URLSearchParams(window.location.search);
  dom.host.value = urlParams.get('host') || config.host || '';
  dom.port.value = urlParams.get('port') || config.port || '4242';

  // Protocol selector. Precedence: ?type= > ?wss= (back-compat) > localStorage > config.wss > 'wss'.
  let proto = urlParams.get('type');
  if (!proto && urlParams.has('wss')) {
    proto = urlParams.get('wss') !== '0' ? 'wss' : 'ws';
  }
  if (!proto) proto = localStorage.getItem('darkflow-protocol');
  if (!proto) proto = (config.wss !== undefined && !config.wss) ? 'ws' : 'wss';
  if (!['ws', 'wss', 'telnet', 'telnets'].includes(proto)) proto = 'wss';
  dom.protocolSelect.value = proto;

  if (config.gameName) {
    updateBranding(config.gameName);
  }
  if (Array.isArray(config.hiddenPanels)) {
    panelManager.setHiddenByDefault(config.hiddenPanels);
  }
  // Auto-connect if a host is configured
  if (dom.host.value) {
    connect();
  }
});

// Persist last-used protocol so users don't have to re-pick on every visit.
if (dom.protocolSelect) {
  dom.protocolSelect.addEventListener('change', () => {
    try {
      localStorage.setItem('darkflow-protocol', dom.protocolSelect.value);
    } catch (e) { /* private mode / quota — ignore */ }
  });
}
loadHistory();
panelManager.init();
windowManager.init();
ideManager.init();
announcementsManager.init();
giphyManager.init();
initInput();
dom.commandInput.focus();

document.addEventListener('visibilitychange', function() {
  emitCurrentTabObservabilityState();
});

const statusObserver = new MutationObserver(function() {
  if (dom.connectionState && dom.connectionState.textContent === 'Connected') {
    emitCurrentTabObservabilityState();
  }
});

if (dom.connectionState) {
  statusObserver.observe(dom.connectionState, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

window.wsDebug = {
  snapshot: getWsDebugSnapshot,
  exportAll: function() {
    return JSON.stringify(getWsDebugSnapshot(), null, 2);
  },
};

window.aliasDebug = {
  scope: function() {
    return aliasManager.getActiveScopeKey();
  },
  data: function() {
    return aliasManager.getScopeSnapshot();
  },
};

window.highlightDebug = {
  scope: function() {
    return highlightManager.getActiveScopeKey();
  },
  data: function() {
    return highlightManager.getScopeSnapshot();
  },
};

window.triggerDebug = {
  scope: function() {
    return triggerManager.getActiveScopeKey();
  },
  data: function() {
    return triggerManager.getScopeSnapshot();
  },
};

window.addEventListener('beforeunload', function() {
  saveHistoryNow();
  flushPendingMapSave();
  if (state.ws) state.ws.close(1000, 'Page unload');
});

// ── Client Version & Update Detection ──────────────────────────────
function fetchClientVersion() {
  return fetch('/api/version', { cache: 'no-store' })
    .then(r => r.json())
    .then(data => data.version || null)
    .catch(() => null);
}

state.clientVersionPromise = fetchClientVersion().then(version => {
  setClientVersion(version);
  return state.clientVersion;
});

// Poll for updates every 5 minutes; only when tab is visible
const VERSION_POLL_MS = 5 * 60 * 1000;
setInterval(function() {
  if (document.visibilityState !== 'visible') return;
  if (!clientVersion) return;
  fetchClientVersion().then(v => {
    if (v && v !== clientVersion) {
      dom.updateBanner.style.display = 'block';
    }
  });
}, VERSION_POLL_MS);

dom.updateRefresh.addEventListener('click', function(e) {
  e.preventDefault();
  location.reload();
});
