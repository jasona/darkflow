import { state, dom } from './state.js';
import { gmcp, gmcpTextDecoder } from './gmcp.js';
import { appendConnectionSeparator, appendOutput, appendSystemMessage } from './output.js';
import { panelManager } from './panel-manager.js';
import { windowManager } from './window-manager.js';
import { RECONNECT_BASE_MS, RECONNECT_MAX_MS } from './constants.js';
import { settingsManager } from './settings-manager.js';
import { PRODUCT_NAME } from './brand.js';

const WS_DIAG_LIMIT = 100;
const WS_HEALTH_INTERVAL_MS = 5000;
const WS_STALL_WINDOW_MS = 8000;
const WS_STALL_COMMAND_BURST_MS = 4000;
const WS_STALL_COMMAND_BURST_COUNT = 3;
const WS_STALLED_BUFFERED_THRESHOLD = 64 * 1024;
const WS_FORCE_RECONNECT_DELAY_MS = 250;

let watchdogTimer = null;

function getHealth() {
  return state.wsHealth;
}

function trimCommandBurst(now) {
  const health = getHealth();
  health.recentCommandTimes = health.recentCommandTimes.filter((ts) => (now - ts) <= WS_STALL_COMMAND_BURST_MS);
}

function pushWsEvent(type, detail) {
  const health = getHealth();
  health.events.push({
    ts: new Date().toISOString(),
    type,
    detail,
  });
  if (health.events.length > WS_DIAG_LIMIT) {
    health.events = health.events.slice(-WS_DIAG_LIMIT);
  }
}

function recordBufferedAmount() {
  const health = getHealth();
  const bufferedAmount = state.ws ? state.ws.bufferedAmount || 0 : 0;
  health.lastBufferedAmount = bufferedAmount;
  health.maxBufferedAmount = Math.max(health.maxBufferedAmount || 0, bufferedAmount);
  return bufferedAmount;
}

function stopWatchdog() {
  if (!watchdogTimer) return;
  clearInterval(watchdogTimer);
  watchdogTimer = null;
}

function resetSocketState() {
  const health = getHealth();
  state.ws = null;
  state.connectTime = null;
  health.currentUrl = null;
  health.stalledAt = null;
  health.recentCommandTimes = [];
  stopWatchdog();
}

function finalizeDisconnect() {
  resetSocketState();
  gmcp.reset();
  state.tabObservability.lastSentState = null;
  panelManager.resetData();
  windowManager.resetAll();
  setConnectionState('disconnected');
  const brandText = dom.toolbarBrand ? dom.toolbarBrand.querySelector('span') : null;
  if (brandText) {
    brandText.textContent = PRODUCT_NAME;
  } else if (dom.toolbarBrand) {
    dom.toolbarBrand.textContent = PRODUCT_NAME;
  }
  document.title = PRODUCT_NAME;
  dom.statusConnection.textContent = 'Not connected';
  dom.statusConnection.title = '';
  dom.statusUptime.textContent = '';
}

function forceReconnect(reason) {
  const ws = state.ws;
  const health = getHealth();

  pushWsEvent('force-reconnect', { reason });
  health.forcedReconnects++;
  appendSystemMessage('Connection stalled; reconnecting (' + reason + ')...');

  finalizeDisconnect();

  if (ws) {
    try {
      ws.close(4000, 'client-reconnect');
    } catch (error) {
      pushWsEvent('force-reconnect-close-error', { message: error && error.message ? error.message : String(error) });
    }
  }

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
  }
  state.reconnectTimer = setTimeout(function() {
    state.reconnectTimer = null;
    connect();
  }, WS_FORCE_RECONNECT_DELAY_MS);
}

function evaluateSocketHealth() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  const now = Date.now();
  const health = getHealth();
  trimCommandBurst(now);

  const bufferedAmount = recordBufferedAmount();
  const inboundAt = health.lastInboundAt || 0;
  const commandBurstActive = health.recentCommandTimes.length >= WS_STALL_COMMAND_BURST_COUNT;
  const latestCommandAt = health.lastCommandAt || 0;
  const noInboundSinceLatestCommand = latestCommandAt > 0 && inboundAt < latestCommandAt;
  const stalledByCommandBurst = commandBurstActive
    && noInboundSinceLatestCommand
    && (now - latestCommandAt) >= WS_STALL_WINDOW_MS;
  const stalledByBufferedBacklog = bufferedAmount >= WS_STALLED_BUFFERED_THRESHOLD
    && (now - (health.lastOutboundAt || now)) >= WS_STALL_WINDOW_MS
    && (now - inboundAt) >= WS_STALL_WINDOW_MS;

  if (stalledByCommandBurst || stalledByBufferedBacklog) {
    if (!health.stalledAt) {
      health.stalledAt = now;
      pushWsEvent('stalled', {
        bufferedAmount,
        commandBurstCount: health.recentCommandTimes.length,
        msSinceLastInbound: inboundAt ? (now - inboundAt) : null,
        msSinceLastCommand: latestCommandAt ? (now - latestCommandAt) : null,
      });
    }
    forceReconnect(stalledByBufferedBacklog ? 'buffer backlog' : 'no inbound traffic');
    return;
  }

  health.stalledAt = null;
}

function startWatchdog() {
  stopWatchdog();
  watchdogTimer = setInterval(evaluateSocketHealth, WS_HEALTH_INTERVAL_MS);
}

export function noteOutboundActivity(kind, metadata) {
  const now = Date.now();
  const health = getHealth();
  const detail = metadata || {};

  health.lastOutboundAt = now;
  recordBufferedAmount();

  if (kind === 'command') {
    health.lastCommandAt = now;
    health.recentCommandTimes.push(now);
    trimCommandBurst(now);
  }

  pushWsEvent('send-' + kind, {
    size: detail.size || 0,
    preview: detail.preview || '',
    bufferedAmount: health.lastBufferedAmount,
  });
}

export function sendSocketPayload(payload, metadata) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;

  const kind = metadata && metadata.kind ? metadata.kind : 'generic';

  try {
    noteOutboundActivity(kind, metadata);
    state.ws.send(payload);
    recordBufferedAmount();
    return true;
  } catch (error) {
    const health = getHealth();
    health.lastErrorAt = Date.now();
    pushWsEvent('send-error', {
      kind,
      message: error && error.message ? error.message : String(error),
    });
    appendSystemMessage('Socket send failed; reconnecting...');
    forceReconnect('send failure');
    return false;
  }
}

export function getWsDebugSnapshot() {
  const health = getHealth();
  return {
    url: health.currentUrl,
    readyState: state.ws ? state.ws.readyState : WebSocket.CLOSED,
    connectTime: state.connectTime,
    lastOpenAt: health.lastOpenAt,
    lastInboundAt: health.lastInboundAt,
    lastInboundTextAt: health.lastInboundTextAt,
    lastInboundGmcpAt: health.lastInboundGmcpAt,
    lastOutboundAt: health.lastOutboundAt,
    lastCommandAt: health.lastCommandAt,
    lastErrorAt: health.lastErrorAt,
    lastCloseAt: health.lastCloseAt,
    lastHandlerErrorAt: health.lastHandlerErrorAt,
    bufferedAmount: state.ws ? state.ws.bufferedAmount || 0 : 0,
    lastBufferedAmount: health.lastBufferedAmount,
    maxBufferedAmount: health.maxBufferedAmount,
    stalledAt: health.stalledAt,
    forcedReconnects: health.forcedReconnects,
    recentCommandCount: health.recentCommandTimes.length,
    events: health.events.slice(-50),
  };
}

export function setConnectionState(connState) {
  dom.connectionState.textContent = connState.charAt(0).toUpperCase() + connState.slice(1);
  dom.connectionDot.className = 'conn-dot dot-' + connState;

  if (connState === 'connecting') {
    dom.connectBtn.textContent = 'Connecting...';
    dom.connectBtn.disabled = true;
    dom.connectFields.style.display = 'flex';
    dom.toolbarStatus.style.display = 'none';
  } else if (connState === 'connected') {
    dom.connectFields.style.display = 'none';
    dom.toolbarStatus.style.display = 'flex';
    dom.commandInput.disabled = false;
    dom.sendBtn.disabled = false;
  } else {
    // Disconnected
    dom.connectBtn.textContent = 'Connect';
    dom.connectBtn.disabled = false;
    dom.connectFields.style.display = 'flex';
    dom.toolbarStatus.style.display = 'none';
    dom.commandInput.disabled = false;
    dom.sendBtn.disabled = false;
  }
}

function formatConnectionClockTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
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

export async function connect() {
  if (state.ws || state.connectionPending) return;

  state.connectionPending = true;

  try {
    if (state.clientVersionPromise) {
      await state.clientVersionPromise;
    }

    if (state.ws) return;

    state.userDisconnected = false;
    const protocol = dom.wssToggle.checked ? 'wss' : 'ws';
    const host = dom.host.value || 'localhost';
    const port = dom.port.value || '4242';
    const url = protocol + '://' + host + ':' + port + '/';
    const health = getHealth();

    setConnectionState('connecting');
    appendSystemMessage('Connecting to ' + url + '...');

    const ws = new WebSocket(url);
    state.ws = ws;
    health.currentUrl = url;
    pushWsEvent('connect-attempt', { url });
    state.connectionPending = false;
    ws.binaryType = 'arraybuffer';

    ws.onopen = function() {
      if (state.ws !== ws) return;
      const wasReconnect = state.reconnectAttempts > 0;
      setConnectionState('connected');
      state.disconnectedSendWarningShown = false;
      if (wasReconnect) {
        appendConnectionSeparator('reconnected at ' + formatConnectionClockTime(Date.now()));
      }
      state.connectTime = Date.now();
      state.bytesSent = 0;
      state.bytesReceived = 0;
      state.reconnectAttempts = 0;
      health.lastOpenAt = Date.now();
      health.stalledAt = null;
      recordBufferedAmount();
      pushWsEvent('open', { url });
      appendSystemMessage('Connected to ' + url);
      dom.statusConnection.textContent = 'Connected: 0s';
      dom.commandInput.focus();
      startWatchdog();
      panelManager.resetData();
      gmcp.sendHandshake();
      gmcp.sendSubscriptions({
        reason: wasReconnect ? 'reconnect' : 'login',
        full: true,
        panels: panelManager.getSubscriptionPanels(),
      });
    };

    ws.onmessage = function(event) {
      if (state.ws !== ws) return;

      const now = Date.now();
      health.lastInboundAt = now;
      health.stalledAt = null;

      try {
        if (typeof event.data === 'string') {
          health.lastInboundTextAt = now;
          state.bytesReceived += event.data.length;
          appendOutput(event.data);
        } else {
          const arr = new Uint8Array(event.data);
          health.lastInboundGmcpAt = now;
          state.bytesReceived += arr.length;
          const text = gmcpTextDecoder.decode(arr);
          const spaceIdx = text.indexOf(' ');
          let packageName;
          let data;
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
        recordBufferedAmount();
      } catch (error) {
        health.lastHandlerErrorAt = now;
        pushWsEvent('message-handler-error', {
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : null,
        });
        console.error('[ws] message handler failed', error);
        appendSystemMessage('Client message handling failed; see wsDebug for details.');
      }
    };

    ws.onerror = function() {
      if (state.ws !== ws) return;
      health.lastErrorAt = Date.now();
      pushWsEvent('error', {
        readyState: ws.readyState,
        bufferedAmount: ws.bufferedAmount || 0,
      });
      appendSystemMessage('WebSocket error');
    };

    ws.onclose = function(event) {
      health.lastCloseAt = Date.now();
      pushWsEvent('close', {
        code: event.code,
        reason: event.reason || '',
        wasClean: !!event.wasClean,
      });

      if (state.ws !== ws) return;

      finalizeDisconnect();

      let msg;
      if (event.code === 1000) msg = 'Disconnected';
      else if (event.code === 1001) msg = 'Server closed connection';
      else if (event.code === 1006) msg = 'Connection lost';
      else msg = 'Closed (code ' + event.code + (event.reason ? ': ' + event.reason : '') + ')';

      appendSystemMessage(msg);

      if (!state.userDisconnected && settingsManager.get('autoReconnect')) {
        scheduleReconnect();
      }
    };
  } finally {
    if (!state.ws) {
      state.connectionPending = false;
    }
  }
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
