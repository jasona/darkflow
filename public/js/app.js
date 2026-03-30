import { state, dom, initDom } from './state.js';
import { gmcp } from './gmcp.js';
import { initOutput } from './output.js';
import { panelManager } from './panel-manager.js';
import { connect, disconnect } from './connection.js';
import { loadHistory, saveHistory, saveHistoryNow, initInput } from './input.js';
import { windowManager } from './window-manager.js';

// ── Initialize DOM refs ─────────────────────────────────────────────
initDom();
initOutput();

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
dom.gmcpToggle.addEventListener('click', function() {
  const visible = dom.gmcpPanel.classList.toggle('open');
  dom.gmcpToggle.style.color = visible ? '#58a6ff' : '#8b949e';
});

gmcp.on('*', function(packageName, data) {
  console.log('[GMCP]', packageName, data);
  const entry = document.createElement('div');
  entry.textContent = '[' + new Date().toLocaleTimeString() + '] '
    + packageName + ' ' + JSON.stringify(data);
  dom.gmcpPanel.appendChild(entry);
  while (dom.gmcpPanel.childNodes.length > 200) {
    dom.gmcpPanel.removeChild(dom.gmcpPanel.firstChild);
  }
  if (dom.gmcpPanel.classList.contains('open')) {
    dom.gmcpPanel.scrollTop = dom.gmcpPanel.scrollHeight;
  }
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

function updateVersionDisplay() {
  const parts = [];
  if (clientVersion) parts.push('Client v' + clientVersion);
  if (serverVersion) parts.push('Server v' + serverVersion);
  dom.statusVersions.textContent = parts.join(' | ');
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
  dom.toolbarBrand.textContent = name;
  document.title = name;
}

// ── Connect Button ──────────────────────────────────────────────────
dom.connectBtn.addEventListener('click', function() {
  connect();
});

// ── Gear Menu ───────────────────────────────────────────────────────
document.getElementById('gear-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  dom.gearMenu.classList.toggle('open');
});

dom.gearDisconnectBtn.addEventListener('click', function() {
  disconnect();
  dom.gearMenu.classList.remove('open');
});

// ── Sidebar Toggles ─────────────────────────────────────────────────
document.getElementById('left-dock-toggle').addEventListener('click', function() {
  const dock = document.getElementById('left-dock');
  const collapsed = !dock.classList.contains('collapsed');
  dock.classList.toggle('collapsed', collapsed);
  this.classList.toggle('active', !collapsed);
  panelManager.state.docks.left = collapsed;
  panelManager.saveState();
});

document.getElementById('right-dock-toggle').addEventListener('click', function() {
  const dock = document.getElementById('right-dock');
  const collapsed = !dock.classList.contains('collapsed');
  dock.classList.toggle('collapsed', collapsed);
  this.classList.toggle('active', !collapsed);
  panelManager.state.docks.right = collapsed;
  panelManager.saveState();
});

// ── Panels Menu ─────────────────────────────────────────────────────
document.getElementById('panels-menu-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('panels-menu').classList.toggle('open');
});

// Close dropdowns on outside click
document.addEventListener('click', function(e) {
  if (!e.target.closest('.panels-menu-wrap')) {
    document.getElementById('panels-menu').classList.remove('open');
  }
  if (!e.target.closest('.gear-menu-wrap')) {
    dom.gearMenu.classList.remove('open');
  }
});

// ── Init ────────────────────────────────────────────────────────────
// Load server config, then apply URL param overrides
fetch('/config.json').then(r => r.json()).catch(() => ({})).then(config => {
  const urlParams = new URLSearchParams(window.location.search);
  dom.host.value = urlParams.get('host') || config.host || '';
  dom.port.value = urlParams.get('port') || config.port || '4242';
  dom.wssToggle.checked = urlParams.has('wss') ? urlParams.get('wss') !== '0'
    : config.wss !== undefined ? config.wss : true;
  dom.autoReconnect.checked = true;
  if (config.gameName) {
    updateBranding(config.gameName);
  }
  // Auto-connect if a host is configured
  if (dom.host.value) {
    connect();
  }
});
loadHistory();
panelManager.init();
windowManager.init();
initInput();
dom.commandInput.focus();

window.addEventListener('beforeunload', function() {
  saveHistoryNow();
  if (state.ws) state.ws.close(1000, 'Page unload');
});

// ── Client Version & Update Detection ──────────────────────────────
function fetchClientVersion() {
  return fetch('/api/version', { cache: 'no-store' })
    .then(r => r.json())
    .then(data => data.version || null)
    .catch(() => null);
}

fetchClientVersion().then(v => {
  clientVersion = v;
  updateVersionDisplay();
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
