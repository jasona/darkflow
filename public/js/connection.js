import { state, dom } from './state.js';
import { gmcp, gmcpTextDecoder } from './gmcp.js';
import { appendOutput, appendSystemMessage, closeOpenOutputLine } from './output.js';
import { panelManager } from './panel-manager.js';
import { windowManager } from './window-manager.js';
import { fishingManager } from './fishing-manager.js';
import { combatVisualManager } from './combat-visual-manager.js';
import { RECONNECT_BASE_MS, RECONNECT_MAX_MS } from './constants.js';
import { settingsManager } from './settings-manager.js';
import { timerManager } from './timer-manager.js';
import { PRODUCT_NAME } from './brand.js';
import {
  isSocketClosingOrClosed,
  isSocketConnecting,
  isSocketOpen,
  socketReadyStateName,
} from './socket-state.js';

const WS_DIAG_LIMIT = 100;
const WS_HEALTH_INTERVAL_MS = 5000;
const WS_STALL_WINDOW_MS = 8000;
const WS_STALL_COMMAND_BURST_MS = 4000;
const WS_STALL_COMMAND_BURST_COUNT = 3;
const WS_STALLED_BUFFERED_THRESHOLD = 64 * 1024;
const WS_FORCE_RECONNECT_DELAY_MS = 250;
const LOST_TRANSMISSION_PATTERN = /\*\*\* Text lost in transmission \*\*\*/;
const LOST_TRANSMISSION_RECOVERY_DELAY_MS = 750;
const LOST_TRANSMISSION_RECOVERY_COOLDOWN_MS = 30000;

// Transport fallback ladder, in priority order. A connect attempt that
// fails before ever opening advances to the next rung; a successful open
// resets to the top so we always prefer the best transport next time.
const TRANSPORT_LADDER = ['wss', 'ws', 'telnets', 'telnet'];
const TRANSPORT_SHORT = { wss: 'wss', ws: 'ws', telnets: 'ts', telnet: 't' };
const UPGRADE_PROBE_DELAY_MS = 4000;
const UPGRADE_PROBE_RETRY_MS = 15000;
const HANDSHAKE_RESEND_DELAY_MS = 3000;

let watchdogTimer = null;
let lostTransmissionRecoveryTimer = null;
let lastLostTransmissionRecoveryAt = 0;
let transportIndex = 0;
let activeLadder = null;
let ladderSelection = null;
let inboundExpectTimer = null;
let cycleRungsTried = 0;
let upgradeProbeTimer = null;
let upgradeProbeSocket = null;
let handshakeResendTimer = null;

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

function emitConnectionState(connState) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent('dw:connectionstate', {
    detail: {
      state: connState,
      readyState: state.ws ? state.ws.readyState : WebSocket.CLOSED,
      readyStateName: socketReadyStateName(state.ws),
      reconnectAttempts: state.reconnectAttempts,
    },
  }));
}

// Reconnect lifecycle events for the connection overlay and the auth
// modal's connection strip. status: 'connecting' | 'scheduled' |
// 'connected' | 'idle' (no automatic retry pending).
function emitReconnectStatus(detail) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent('dw:reconnectstatus', {
    detail: {
      attempt: state.reconnectAttempts,
      transport: currentTransport(),
      ...detail,
    },
  }));
}

export function buildTransportLadder(selected) {
  // Pages served over https cannot open plain ws:// (mixed content);
  // skip that rung so the ladder never wastes an attempt on it.
  let ladder = TRANSPORT_LADDER.filter(
    (t) => !(location.protocol === 'https:' && t === 'ws')
  );
  if (ladder.includes(selected)) {
    ladder = [selected].concat(ladder.filter((t) => t !== selected));
  }
  return ladder;
}

function currentTransport() {
  if (!activeLadder || !activeLadder.length) return null;
  return activeLadder[transportIndex % activeLadder.length];
}

// A "cycle" is one walk down the ladder: every scheduled reconnect
// attempt starts back at the top (wss) and only falls through the rungs
// when that specific rung fails before opening. This way a server
// outage -- where every rung fails -- never strands the client on a
// telnet rung once the server comes back.
function nextTransport(selected) {
  if (!activeLadder || ladderSelection !== selected || cycleRungsTried === 0) {
    activeLadder = buildTransportLadder(selected);
    ladderSelection = selected;
    if (cycleRungsTried === 0) transportIndex = 0;
  }
  return activeLadder[transportIndex % activeLadder.length];
}

function advanceTransport(reason) {
  if (!activeLadder || activeLadder.length < 2) return;
  const from = currentTransport();
  transportIndex = (transportIndex + 1) % activeLadder.length;
  pushWsEvent('transport-fallback', { from, to: currentTransport(), reason });
}

function resetTransportLadder() {
  transportIndex = 0;
  cycleRungsTried = 0;
}

function cancelUpgradeProbe() {
  if (upgradeProbeTimer) {
    clearTimeout(upgradeProbeTimer);
    upgradeProbeTimer = null;
  }
  if (upgradeProbeSocket) {
    try { upgradeProbeSocket.close(1000, 'probe-cancel'); } catch (error) {}
    upgradeProbeSocket = null;
  }
}

function loggedIntoCharacter() {
  // Char.Vitals only flows once a character body is loaded; login,
  // charselect, and newchar screens never send it.
  return !!(panelManager.gmcpData && panelManager.gmcpData.vitals);
}

// Connected on a rung below the top (usually because the server was
// mid-restart when the sweep reached a lower rung). Probe the preferred
// transport in the background and, if it answers, reconnect through it
// -- but never yank a session that has already logged into a character.
// connectedVia is the rung this session actually opened on; it must be
// captured by the caller BEFORE the ladder is reset.
function scheduleUpgradeProbe(forWs, delayMs, connectedVia) {
  cancelUpgradeProbe();
  upgradeProbeTimer = setTimeout(function() {
    upgradeProbeTimer = null;
    if (state.ws !== forWs || !isSocketOpen(state.ws)) return;
    if (loggedIntoCharacter()) return;

    const selected = dom.protocolSelect.value || 'wss';
    const ladder = buildTransportLadder(selected);
    const top = ladder[0];
    if (!top || top === connectedVia) return;
    if (top !== 'ws' && top !== 'wss') return;

    const host = dom.host.value || 'localhost';
    const port = dom.port.value || '4242';
    let probe;
    try {
      probe = new WebSocket(top + '://' + host + ':' + port + '/');
    } catch (error) {
      scheduleUpgradeProbe(forWs, UPGRADE_PROBE_RETRY_MS, connectedVia);
      return;
    }
    upgradeProbeSocket = probe;

    probe.onopen = function() {
      try { probe.close(1000, 'upgrade-probe'); } catch (error) {}
      if (upgradeProbeSocket === probe) upgradeProbeSocket = null;
      if (state.ws !== forWs || !isSocketOpen(state.ws)) return;
      if (loggedIntoCharacter()) return;
      pushWsEvent('transport-upgrade', { from: connectedVia, to: top });
      appendSystemMessage('Preferred transport is back; reconnecting via ' + top + '...');
      resetTransportLadder();
      forceReconnect('upgrading to ' + top);
    };
    probe.onerror = function() {
      if (upgradeProbeSocket === probe) upgradeProbeSocket = null;
      if (state.ws === forWs && isSocketOpen(state.ws) && !loggedIntoCharacter()) {
        scheduleUpgradeProbe(forWs, UPGRADE_PROBE_RETRY_MS, connectedVia);
      }
    };
  }, delayMs || UPGRADE_PROBE_DELAY_MS);
}

// If text is flowing but not a single GMCP frame arrived after the
// handshake, the handshake very likely raced the server-side login
// object (fresh server boot) and was dropped -- the server then treats
// us as a plain telnet-ish client and text-prompts the login. Re-send
// the handshake once; the server tolerates a repeated Core.Hello.
function scheduleHandshakeGuard(forWs) {
  if (handshakeResendTimer) clearTimeout(handshakeResendTimer);
  handshakeResendTimer = setTimeout(function() {
    handshakeResendTimer = null;
    if (state.ws !== forWs || !isSocketOpen(state.ws)) return;
    const health = getHealth();
    const openAt = health.lastOpenAt || 0;
    const gmcpAt = health.lastInboundGmcpAt || 0;
    if (gmcpAt >= openAt) return;
    pushWsEvent('handshake-resend', {
      msSinceOpen: Date.now() - openAt,
      hadText: (health.lastInboundTextAt || 0) >= openAt,
    });
    gmcp.sendHandshake();
    gmcp.sendSubscriptions({
      reason: 'handshake-retry',
      full: true,
      panels: panelManager.getSubscriptionPanels(),
      features: {
        visualEffects: settingsManager.get('visualEffectsEnabled'),
      },
    });
  }, HANDSHAKE_RESEND_DELAY_MS);
}

// A rung failed before opening. Fall through to the next rung almost
// immediately while there are untried rungs in this cycle; once the
// whole ladder has failed, hand control back to the caller so the
// normal backoff applies between cycles.
function handleRungFailure(reason) {
  cycleRungsTried++;
  if (activeLadder && cycleRungsTried < activeLadder.length) {
    advanceTransport(reason);
    emitReconnectStatus({
      status: 'scheduled',
      delayMs: WS_FORCE_RECONNECT_DELAY_MS,
      nextAttemptAt: Date.now() + WS_FORCE_RECONNECT_DELAY_MS,
      reason,
    });
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(function() {
      state.reconnectTimer = null;
      connect();
    }, WS_FORCE_RECONNECT_DELAY_MS);
    return true;
  }
  cycleRungsTried = 0;
  return false;
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
  if (lostTransmissionRecoveryTimer) {
    clearTimeout(lostTransmissionRecoveryTimer);
    lostTransmissionRecoveryTimer = null;
  }
  if (handshakeResendTimer) {
    clearTimeout(handshakeResendTimer);
    handshakeResendTimer = null;
  }
  cancelUpgradeProbe();
  state.ws = null;
  state.connectTime = null;
  state.activeTransport = null;
  health.currentUrl = null;
  health.stalledAt = null;
  health.recentCommandTimes = [];
  stopWatchdog();
}

function finalizeDisconnect() {
  resetSocketState();
  gmcp.reset();
  state.tabObservability.lastSentState = null;
  combatVisualManager.handleDisconnect();
  panelManager.resetData();
  fishingManager.handleDisconnect();
  // Keep auth windows (login/charselect/newchar) alive across a drop:
  // their connection strip shows the reconnect progress, and the fresh
  // login window from the next connection replaces them in place
  // instead of yanking a half-filled form away.
  windowManager.resetAll({ keepAuth: true });
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

export function forceReconnect(reason) {
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
  emitReconnectStatus({
    status: 'scheduled',
    delayMs: WS_FORCE_RECONNECT_DELAY_MS,
    nextAttemptAt: Date.now() + WS_FORCE_RECONNECT_DELAY_MS,
    reason,
  });
  state.reconnectTimer = setTimeout(function() {
    state.reconnectTimer = null;
    connect();
  }, WS_FORCE_RECONNECT_DELAY_MS);
}

// Watch for a server response after a send that must be answered (an
// auth-window submit). A half-dead TCP connection keeps readyState OPEN
// for minutes, so sends "succeed" into the void and none of the other
// stall detectors fire (auth submits are not command bursts). If nothing
// inbound arrives within the window, treat the socket as dead.
export function expectInboundWithin(ms, reason) {
  const health = getHealth();
  const since = health.lastInboundAt || 0;

  if (inboundExpectTimer) clearTimeout(inboundExpectTimer);
  inboundExpectTimer = setTimeout(function() {
    inboundExpectTimer = null;
    if (!isSocketOpen(state.ws)) return;
    if ((getHealth().lastInboundAt || 0) > since) return;
    forceReconnect(reason || 'no response to client request');
  }, ms);
}

// Make sure a connection attempt is in flight: used by the auth modal
// and the reconnect overlay so a dead session always works its way back
// to connected without the player touching the toolbar.
export function ensureConnected() {
  if (state.userDisconnected) state.userDisconnected = false;
  if (isSocketOpen(state.ws) || isSocketConnecting(state.ws)) return;
  if (state.connectionPending || state.reconnectTimer) return;
  connect();
}

// Skip the backoff and try again right now.
export function retryNow() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.userDisconnected = false;
  if (isSocketOpen(state.ws) || isSocketConnecting(state.ws)) return;
  connect();
}

function evaluateSocketHealth() {
  if (!isSocketOpen(state.ws)) return;

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

function scheduleLostTransmissionRecovery(text) {
  if (!LOST_TRANSMISSION_PATTERN.test(String(text || ''))) return;
  if (!isSocketOpen(state.ws)) return;

  const now = Date.now();
  if (lostTransmissionRecoveryTimer ||
    (now - lastLostTransmissionRecoveryAt) < LOST_TRANSMISSION_RECOVERY_COOLDOWN_MS) {
    return;
  }

  appendSystemMessage('Output backlog detected; refreshing GMCP state...');
  pushWsEvent('lost-transmission-detected', {
    msSinceLastRecovery: lastLostTransmissionRecoveryAt ?
      now - lastLostTransmissionRecoveryAt : null,
  });

  lostTransmissionRecoveryTimer = setTimeout(() => {
    lostTransmissionRecoveryTimer = null;
    lastLostTransmissionRecoveryAt = Date.now();

    if (!isSocketOpen(state.ws)) return;
    panelManager.resetData({ preservePanels: ['chat', 'roomPlaylist'] });
    if (gmcp.restartHandshake({
      reason: 'lost-transmission',
      panels: panelManager.getSubscriptionPanels(),
    })) {
      panelManager.refreshMediaPanels();
      pushWsEvent('lost-transmission-recovery', {});
    }
  }, LOST_TRANSMISSION_RECOVERY_DELAY_MS);
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
  if (!isSocketOpen(state.ws)) return false;

  const kind = metadata && metadata.kind ? metadata.kind : 'generic';

  try {
    noteOutboundActivity(kind, metadata);
    state.ws.send(payload);
    recordBufferedAmount();
    // The fragmented-output merge logic in output.js keeps a partial
    // line open across frames. Any send to the server is a barrier:
    // the previous server prompt is "done" for merge purposes, and a
    // subsequent response should land on a fresh line.
    if (!metadata || metadata.closeOpenLine !== false) {
      closeOpenOutputLine();
    }
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
    readyStateName: socketReadyStateName(state.ws),
    connectionPending: state.connectionPending,
    reconnectAttempts: state.reconnectAttempts,
    openWindows: Object.keys(windowManager.windows || {}),
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
  const showConnectFields = !state.zorkOnlyMode && connState !== 'connected';

  if (connState === 'connecting') {
    dom.connectBtn.textContent = 'Connecting...';
    dom.connectBtn.disabled = true;
    dom.connectFields.style.display = showConnectFields ? 'flex' : 'none';
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
    dom.connectFields.style.display = showConnectFields ? 'flex' : 'none';
    dom.toolbarStatus.style.display = 'none';
    dom.commandInput.disabled = false;
    dom.sendBtn.disabled = false;
  }

  emitConnectionState(connState);
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectAttempts++;
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, state.reconnectAttempts - 1), RECONNECT_MAX_MS);
  emitReconnectStatus({
    status: 'scheduled',
    delayMs: delay,
    nextAttemptAt: Date.now() + delay,
  });
  state.reconnectTimer = setTimeout(function() {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

export async function connect() {
  if (state.ws && isSocketClosingOrClosed(state.ws)) {
    state.ws = null;
  }
  if (state.ws || state.connectionPending) return;

  state.connectionPending = true;

  try {
    if (state.clientVersionPromise) {
      await state.clientVersionPromise;
    }

    if (state.ws && isSocketClosingOrClosed(state.ws)) {
      state.ws = null;
    }
    if (state.ws) {
      if (isSocketConnecting(state.ws) || isSocketOpen(state.ws)) return;
      return;
    }

    state.userDisconnected = false;
    const selected = dom.protocolSelect.value || 'wss';
    const sel = nextTransport(selected);
    const host = dom.host.value || 'localhost';
    const port = dom.port.value || '4242';

    let url;
    if (sel === 'ws' || sel === 'wss') {
      // Direct connection: the target itself speaks WebSocket (e.g. Darkwind).
      url = sel + '://' + host + ':' + port + '/';
    } else {
      // Bridge through our own server's /proxy endpoint to a raw telnet/telnets MUD.
      const proxyScheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const tls = sel === 'telnets' ? '1' : '0';
      url = proxyScheme + '://' + location.host + '/proxy' +
        '?host=' + encodeURIComponent(host) +
        '&port=' + encodeURIComponent(port) +
        '&tls=' + tls;
    }
    const health = getHealth();
    const connectionLabel = state.zorkOnlyMode ? 'Darkwind' : url;

    setConnectionState('connecting');
    emitReconnectStatus({ status: 'connecting', transport: sel, url });

    let ws;
    let attemptOpened = false;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      pushWsEvent('connect-error', {
        url,
        message: error && error.message ? error.message : String(error),
      });
      setConnectionState('disconnected');
      if (handleRungFailure('constructor failure')) return;
      if (!state.userDisconnected && settingsManager.get('autoReconnect')) {
        scheduleReconnect();
      } else {
        emitReconnectStatus({ status: 'idle' });
      }
      return;
    }
    state.ws = ws;
    health.currentUrl = url;
    pushWsEvent('connect-attempt', { url, transport: sel });
    state.connectionPending = false;
    ws.binaryType = 'arraybuffer';

    ws.onopen = function() {
      if (state.ws !== ws) return;
      attemptOpened = true;
      const wasReconnect = state.reconnectAttempts > 0;
      setConnectionState('connected');
      state.connectTime = Date.now();
      state.everConnected = true;
      state.bytesSent = 0;
      state.bytesReceived = 0;
      state.reconnectAttempts = 0;
      resetTransportLadder();
      health.lastOpenAt = Date.now();
      health.stalledAt = null;
      recordBufferedAmount();
      state.activeTransport = TRANSPORT_SHORT[sel] || sel;
      pushWsEvent('open', { url, transport: sel });
      emitReconnectStatus({ status: 'connected', transport: sel, url });
      appendSystemMessage('Connected to ' + connectionLabel + ' [' + state.activeTransport + ']');
      // A socket accepted during server startup can open and then never
      // speak (the game is not driving logins yet). Every healthy
      // connection produces traffic immediately; if nothing at all
      // arrives, tear down and let the cycle try again.
      expectInboundWithin(10000, 'no server traffic after connect');
      scheduleHandshakeGuard(ws);
      // sel is the rung this socket opened on -- checked against the
      // ladder top BEFORE resetTransportLadder() zeroed the index.
      if (sel !== buildTransportLadder(selected)[0]) {
        scheduleUpgradeProbe(ws, UPGRADE_PROBE_DELAY_MS, sel);
      }
      dom.statusConnection.textContent = 'Connected [' + state.activeTransport + ']: 0s';
      dom.commandInput.focus();
      startWatchdog();
      panelManager.resetData();
      gmcp.sendHandshake();
      gmcp.sendSubscriptions({
        reason: wasReconnect ? 'reconnect' : 'login',
        full: true,
        panels: panelManager.getSubscriptionPanels(),
        features: {
          visualEffects: settingsManager.get('visualEffectsEnabled'),
        },
      });
      timerManager.startAutoTimers();
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
          scheduleLostTransmissionRecovery(event.data);
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

      // Failed before ever opening: this rung is unreachable right now.
      // Fall through the remaining rungs quickly; only when the whole
      // ladder has failed does the normal backoff apply.
      if (!attemptOpened && !state.userDisconnected &&
        settingsManager.get('autoReconnect') &&
        handleRungFailure('failed before open (code ' + event.code + ')')) {
        timerManager.stopAllTimers();
        return;
      }

      let msg;
      if (event.code === 1000) msg = 'Disconnected';
      else if (event.code === 1001) msg = 'Server closed connection';
      else if (event.code === 1006) msg = 'Connection lost';
      else msg = 'Closed (code ' + event.code + (event.reason ? ': ' + event.reason : '') + ')';

      appendSystemMessage(msg);
      timerManager.stopAllTimers();

      if (!state.userDisconnected && settingsManager.get('autoReconnect')) {
        scheduleReconnect();
      } else {
        emitReconnectStatus({ status: 'idle' });
      }
    };
  } finally {
    state.connectionPending = false;
  }
}

// When the browser regains network, do not sit out the rest of a long
// backoff window; try immediately.
if (typeof window !== 'undefined' &&
  typeof window.addEventListener === 'function') {
  window.addEventListener('online', function() {
    if (state.userDisconnected) return;
    if (isSocketOpen(state.ws) || isSocketConnecting(state.ws)) return;
    if (!settingsManager.get('autoReconnect') && !state.reconnectTimer) return;
    retryNow();
  });
}

export function disconnect() {
  state.userDisconnected = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  emitReconnectStatus({ status: 'idle', userDisconnected: true });
  if (state.ws) {
    state.ws.close(1000, 'User disconnect');
  }
}
