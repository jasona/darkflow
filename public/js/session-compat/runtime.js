/**
 * Runtime-installed bridge between legacy public/js connection and GMCP modules
 * and the Phase 1 session transport/bus. Never statically imports client/** -
 * Step 13 installs a real bridge object at boot time; until then bridge stays null.
 *
 * @typedef {Object} WebSocketProxy
 * @property {number} readyState
 * @property {number} bufferedAmount
 * @property {(data: string | ArrayBuffer | ArrayBufferView) => void} send
 * @property {(code?: number, reason?: string) => void} close
 *
 * @typedef {Object} SessionRuntimeCompatBridge
 * @property {() => void} connect
 * @property {() => void} disconnect
 * @property {() => void} retryNow
 * @property {(reason: string) => void} forceReconnect
 * @property {() => void} ensureConnected
 * @property {(ms: number, reason?: string) => void} expectInboundWithin
 * @property {(payload: string | Uint8Array, metadata?: Object) => boolean} sendPayload
 * @property {() => WebSocketProxy} getWebSocketProxy
 * @property {() => Object} getHealthSnapshot
 * @property {() => string} getConnectionState
 * @property {() => string} getSessionId
 * @property {(listener: Function) => () => void} subscribeReconnectStatus
 * @property {(listener: Function) => () => void} subscribeConnectionState
 * @property {(packageName: string, callback: Function) => void} gmcpOn
 * @property {(packageName: string, callback: Function) => void} gmcpOff
 * @property {(packageName: string, data: *) => void} gmcpDispatch
 * @property {(packageName: string, data?: *) => boolean} gmcpSend
 * @property {(packageName: string) => boolean} gmcpServerSupportsPackage
 * @property {() => boolean} gmcpSendHandshake
 * @property {() => void} gmcpReset
 * @property {(payload?: Object) => boolean} gmcpSendSubscriptions
 * @property {() => boolean} gmcpRequestMediaRefresh
 * @property {() => boolean} gmcpRequestChannelPlayers
 * @property {(channel: string) => boolean} gmcpEnableChannel
 * @property {(payload?: Object) => boolean} gmcpRestartHandshake
 * @property {() => void} startFacadeSync
 * @property {() => void} stopFacadeSync
 * @property {() => void} markLegacyUiReady
 * @property {((appendOutput: (text: string) => void) => void)=} bindTextOutput
 * @property {() => boolean} gmcpIsEnabled
 */

const BRIDGE_UNINSTALLED_ERROR = 'SessionRuntimeBridgeNotInstalledError';
const RUNTIME_BRIDGE_SLOT = '__darkflowPhase1RuntimeBridge';

/** @type {SessionRuntimeCompatBridge | null} */
let bridge = null;

/** Returns the bridge installed in this module or on the window-owned runtime slot. */
function getInstalledBridge() {
  if (bridge !== null) {
    return bridge;
  }
  if (typeof window !== 'undefined') {
    const windowBridge = window[RUNTIME_BRIDGE_SLOT];
    if (windowBridge) {
      return windowBridge;
    }
  }
  return null;
}

/** Persists or clears the installed bridge on the window-owned runtime slot. */
function setInstalledBridge(nextBridge) {
  bridge = nextBridge;
  if (typeof window === 'undefined') {
    return;
  }
  if (nextBridge === null) {
    delete window[RUNTIME_BRIDGE_SLOT];
    return;
  }
  window[RUNTIME_BRIDGE_SLOT] = nextBridge;
}

/** Installs or replaces the active session runtime compatibility bridge. */
export function installSessionRuntimeBridge(nextBridge) {
  const previous = getInstalledBridge();
  if (previous && typeof previous.stopFacadeSync === 'function') {
    previous.stopFacadeSync();
  }
  setInstalledBridge(nextBridge);
  if (nextBridge && typeof nextBridge.startFacadeSync === 'function') {
    nextBridge.startFacadeSync();
  }
}

/** Clears the bridge; intended for isolated test fixtures only. */
export function resetSessionRuntimeBridgeForTests() {
  const previous = getInstalledBridge();
  if (previous && typeof previous.stopFacadeSync === 'function') {
    previous.stopFacadeSync();
  }
  setInstalledBridge(null);
}

/** Returns true when a session runtime bridge is installed. */
export function isSessionRuntimeActive() {
  return getInstalledBridge() !== null;
}

function requireBridge() {
  const activeBridge = getInstalledBridge();
  if (activeBridge === null) {
    const error = new Error('Session runtime compatibility bridge is not installed.');
    error.name = BRIDGE_UNINSTALLED_ERROR;
    throw error;
  }
  return activeBridge;
}

/** Binds the canonical legacy state/dom objects after initDom runs in app.js. */
export function bindLegacyUiTargets(state, dom) {
  const activeBridge = getInstalledBridge();
  if (activeBridge !== null && typeof activeBridge.bindLegacyUiTargets === 'function') {
    activeBridge.bindLegacyUiTargets(state, dom);
  }
}

/** Applies the current transport state once legacy DOM references exist. */
export function markLegacyUiReady() {
  const activeBridge = getInstalledBridge();
  if (activeBridge !== null && typeof activeBridge.markLegacyUiReady === 'function') {
    activeBridge.markLegacyUiReady();
  }
}

/** Binds the live appendOutput function after legacy initOutput runs. */
export function bindSessionTextOutput(appendOutput) {
  const activeBridge = getInstalledBridge();
  if (activeBridge !== null && typeof activeBridge.bindTextOutput === 'function') {
    activeBridge.bindTextOutput(appendOutput);
  }
}

/** Returns whether the session GMCP bus reports enabled state. */
export function gmcpIsEnabled() {
  return requireBridge().gmcpIsEnabled();
}

/** Starts a session transport connect through the installed bridge. */
export function connect() {
  requireBridge().connect();
}

/** Disconnects the session transport through the installed bridge. */
export function disconnect() {
  requireBridge().disconnect();
}

/** Retries connection immediately through the installed bridge. */
export function retryNow() {
  requireBridge().retryNow();
}

/** Forces a session reconnect through the installed bridge. */
export function forceReconnect(reason) {
  requireBridge().forceReconnect(reason);
}

/** Ensures a connect attempt is in flight through the installed bridge. */
export function ensureConnected() {
  requireBridge().ensureConnected();
}

/** Schedules a stall check when no inbound traffic arrives within the window. */
export function expectInboundWithin(ms, reason) {
  requireBridge().expectInboundWithin(ms, reason);
}

/** Sends one payload through the session transport. */
export function sendPayload(payload, metadata) {
  return requireBridge().sendPayload(payload, metadata);
}

/** Returns the WebSocket-shaped proxy backed by the session transport. */
export function getWebSocketProxy() {
  return requireBridge().getWebSocketProxy();
}

/** Returns the transport health snapshot from the installed bridge. */
export function getHealthSnapshot() {
  return requireBridge().getHealthSnapshot();
}

/** Returns the transport connection state from the installed bridge. */
export function getConnectionState() {
  return requireBridge().getConnectionState();
}

/** Returns the active session id from the installed bridge. */
export function getSessionId() {
  return requireBridge().getSessionId();
}

/** Registers a reconnect-status listener on the installed bridge. */
export function subscribeReconnectStatus(listener) {
  return requireBridge().subscribeReconnectStatus(listener);
}

/** Registers a connection-state listener on the installed bridge. */
export function subscribeConnectionState(listener) {
  return requireBridge().subscribeConnectionState(listener);
}

/** Registers a GMCP handler on the session bus. */
export function gmcpOn(packageName, callback) {
  requireBridge().gmcpOn(packageName, callback);
}

/** Removes a GMCP handler from the session bus. */
export function gmcpOff(packageName, callback) {
  requireBridge().gmcpOff(packageName, callback);
}

/** Dispatches one GMCP frame through the session bus. */
export function gmcpDispatch(packageName, data) {
  requireBridge().gmcpDispatch(packageName, data);
}

/** Sends one GMCP package through the session transport. */
export function gmcpSend(packageName, data) {
  return requireBridge().gmcpSend(packageName, data);
}

/** Returns whether the session bus reports server support for one package. */
export function gmcpServerSupportsPackage(packageName) {
  return requireBridge().gmcpServerSupportsPackage(packageName);
}

/** Sends the GMCP handshake through the session bus. */
export function gmcpSendHandshake() {
  return requireBridge().gmcpSendHandshake();
}

/** Resets GMCP session state through the session bus. */
export function gmcpReset() {
  requireBridge().gmcpReset();
}

/** Sends GMCP subscriptions through the session bus. */
export function gmcpSendSubscriptions(payload) {
  return requireBridge().gmcpSendSubscriptions(payload);
}

/** Requests a GMCP media refresh through the session bus. */
export function gmcpRequestMediaRefresh() {
  return requireBridge().gmcpRequestMediaRefresh();
}

/** Requests GMCP channel players through the session bus. */
export function gmcpRequestChannelPlayers() {
  return requireBridge().gmcpRequestChannelPlayers();
}

/** Enables one GMCP comm channel through the session bus. */
export function gmcpEnableChannel(channel) {
  return requireBridge().gmcpEnableChannel(channel);
}

/** Restarts the GMCP handshake through the session bus. */
export function gmcpRestartHandshake(payload) {
  return requireBridge().gmcpRestartHandshake(payload);
}

export { BRIDGE_UNINSTALLED_ERROR };
