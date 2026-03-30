import { state, dom } from './state.js';
import { gmcp, gmcpTextDecoder } from './gmcp.js';
import { appendOutput, appendSystemMessage } from './output.js';
import { panelManager } from './panel-manager.js';
import { windowManager } from './window-manager.js';
import { RECONNECT_BASE_MS, RECONNECT_MAX_MS } from './constants.js';

// GMCP package names follow PascalCase.PascalCase convention (e.g. Char.Status)
const GMCP_PKG_RE = /^[A-Z][a-zA-Z]*(\.[A-Z][a-zA-Z]*)+$/;

function tryParseGmcp(text) {
  const spaceIdx = text.indexOf(' ');
  let packageName, jsonStr;
  if (spaceIdx === -1) {
    packageName = text.trim();
    jsonStr = undefined;
  } else {
    packageName = text.substring(0, spaceIdx);
    jsonStr = text.substring(spaceIdx + 1);
  }
  if (!GMCP_PKG_RE.test(packageName)) return null;
  if (jsonStr === undefined) return { packageName, data: undefined };
  try {
    return { packageName, data: JSON.parse(jsonStr) };
  } catch (e) {
    return null;
  }
}

export function setConnectionState(connState) {
  dom.connectionState.textContent = connState.charAt(0).toUpperCase() + connState.slice(1);
  dom.connectionDot.className = 'conn-dot dot-' + connState;

  if (connState === 'connecting') {
    dom.connectBtn.textContent = 'Connecting...';
    dom.connectBtn.disabled = true;
    dom.connectFields.style.display = 'flex';
    dom.toolbarStatus.style.display = 'none';
    dom.gearDisconnectBtn.style.display = 'none';
  } else if (connState === 'connected') {
    dom.connectFields.style.display = 'none';
    dom.toolbarStatus.style.display = 'flex';
    dom.commandInput.disabled = false;
    dom.sendBtn.disabled = false;
    dom.gearDisconnectBtn.style.display = '';
    // Show connection info in gear menu
    const proto = dom.wssToggle.checked ? 'wss' : 'ws';
    dom.gearConnInfo.textContent = proto + '://' + (dom.host.value || 'localhost') + ':' + (dom.port.value || '4242');
    dom.gearConnInfo.style.display = '';
  } else {
    // Disconnected
    dom.connectBtn.textContent = 'Connect';
    dom.connectBtn.disabled = false;
    dom.connectFields.style.display = 'flex';
    dom.toolbarStatus.style.display = 'none';
    dom.gearDisconnectBtn.style.display = 'none';
    dom.gearConnInfo.style.display = 'none';
    dom.commandInput.disabled = false;
    dom.sendBtn.disabled = false;
  }
}

function scheduleReconnect() {
  state.reconnectAttempts++;
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, state.reconnectAttempts - 1), RECONNECT_MAX_MS);
  appendSystemMessage('Reconnecting in ' + (delay / 1000).toFixed(0) + 's...');
  state.reconnectTimer = setTimeout(function() {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

export function connect() {
  if (state.ws) return;

  state.userDisconnected = false;
  const protocol = dom.wssToggle.checked ? 'wss' : 'ws';
  const host = dom.host.value || 'localhost';
  const port = dom.port.value || '4242';
  const url = protocol + '://' + host + ':' + port + '/';

  setConnectionState('connecting');
  appendSystemMessage('Connecting to ' + url + '...');

  state.ws = new WebSocket(url);
  state.ws.binaryType = 'arraybuffer';

  state.ws.onopen = function() {
    setConnectionState('connected');
    state.connectTime = Date.now();
    state.bytesSent = 0;
    state.bytesReceived = 0;
    state.reconnectAttempts = 0;
    appendSystemMessage('Connected to ' + url);
    dom.statusConnection.textContent = 'Connected: 0s';
    dom.commandInput.focus();
    gmcp.sendHandshake();
    panelManager.resetData();
  };

  state.ws.onmessage = function(event) {
    if (typeof event.data === 'string') {
      state.bytesReceived += event.data.length;
      const parsed = tryParseGmcp(event.data);
      if (parsed) {
        gmcp.dispatch(parsed.packageName, parsed.data);
      } else {
        appendOutput(event.data);
      }
    } else {
      const arr = new Uint8Array(event.data);
      state.bytesReceived += arr.length;
      const text = gmcpTextDecoder.decode(arr);
      const spaceIdx = text.indexOf(' ');
      let packageName, data;
      if (spaceIdx === -1) {
        packageName = text;
        data = undefined;
      } else {
        packageName = text.substring(0, spaceIdx);
        try {
          data = JSON.parse(text.substring(spaceIdx + 1));
        } catch (e) {
          data = text.substring(spaceIdx + 1);
        }
      }
      gmcp.dispatch(packageName, data);
    }
  };

  state.ws.onerror = function() {
    appendSystemMessage('WebSocket error');
  };

  state.ws.onclose = function(event) {
    state.ws = null;
    state.connectTime = null;
    gmcp.reset();
    panelManager.resetData();
    windowManager.resetAll();
    setConnectionState('disconnected');
    // Reset branding to generic
    dom.toolbarBrand.textContent = 'MUD Client';
    document.title = 'MUD Client';

    let msg;
    if (event.code === 1000) msg = 'Disconnected';
    else if (event.code === 1001) msg = 'Server closed connection';
    else if (event.code === 1006) msg = 'Connection lost';
    else msg = 'Closed (code ' + event.code + (event.reason ? ': ' + event.reason : '') + ')';

    appendSystemMessage(msg);
    dom.statusConnection.textContent = 'Not connected';
    dom.statusConnection.title = '';
    dom.statusUptime.textContent = '';

    if (!state.userDisconnected && dom.autoReconnect.checked) {
      scheduleReconnect();
    }
  };
}

export function disconnect() {
  state.userDisconnected = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.ws) {
    state.ws.close(1000, 'User disconnect');
  }
}
