import * as darkwindMap from './map-data-v2.js';
import * as gmcpMap from './map-data-gmcp.js';
import { dom } from './state.js';

let mode = 'auto';
let endpointKey = '';
let reconnectFallbackTimer = null;
let reconnectFallbackToken = 0;
const RECONNECT_FALLBACK_MS = 5000;

function connectionKey(identity = {}) {
  return [identity.host || '', identity.port || ''].join('@');
}

function clearReconnectFallback() {
  reconnectFallbackToken++;
  if (reconnectFallbackTimer) clearTimeout(reconnectFallbackTimer);
  reconnectFallbackTimer = null;
}

function notifySourceChanged() {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  document.dispatchEvent(new CustomEvent('darkflow:map-source-changed'));
}

function armReconnectFallback() {
  clearReconnectFallback();
  if (mode !== 'darkwind' || !darkwindMap.hasCurrentRoom()) return;
  const fallbackToken = ++reconnectFallbackToken;
  reconnectFallbackTimer = setTimeout(() => {
    if (fallbackToken !== reconnectFallbackToken) return;
    reconnectFallbackTimer = null;
    if (mode !== 'darkwind' || darkwindMap.hasLiveCurrent()) return;
    mode = 'auto';
    notifySourceChanged();
  }, RECONNECT_FALLBACK_MS);
  if (reconnectFallbackTimer && typeof reconnectFallbackTimer.unref === 'function') {
    reconnectFallbackTimer.unref();
  }
}

export function getLiveMapSource() {
  // Keep rendering the last authoritative Current during a reconnect. Its
  // observation is marked stale by resetForConnection(), but its coordinates
  // are still a much better presentation than a blank generic map. An explicit
  // non-transient current_unavailable response switches mode back to the
  // learned source.
  return mode === 'darkwind' && darkwindMap.hasCurrentRoom() ? darkwindMap : gmcpMap;
}

export function resetLiveMapModeForConnection() {
  const identity = {
    host: dom.host && dom.host.value,
    port: dom.port && dom.port.value,
  };
  const nextEndpointKey = connectionKey(identity);
  const endpointChanged = !!endpointKey && endpointKey !== nextEndpointKey;
  endpointKey = nextEndpointKey;
  clearReconnectFallback();
  if (endpointChanged) mode = 'auto';

  const darkwindLoad = darkwindMap.configureWorld(identity);
  const genericLoad = gmcpMap.configureWorld(identity);
  darkwindMap.resetForConnection();
  gmcpMap.resetForConnection();
  if (!endpointChanged) armReconnectFallback();
  return Promise.all([Promise.resolve(darkwindLoad), Promise.resolve(genericLoad)]);
}

/** Cancels the reconnect fallback owned by the active session. */
export function disposeLiveMapSourceLifecycle() {
  clearReconnectFallback();
  mode = 'auto';
}

export function markMapData2Active() {
  if (!darkwindMap.hasLiveCurrent()) return;
  clearReconnectFallback();
  mode = 'darkwind';
}

export function markMapData2Unavailable(data = {}) {
  // During an atomic server grid reflow the last authoritative snapshot is
  // intentionally still the best presentation. Current is stale (and cannot
  // speedwalk), but switching sources here makes the map appear to disappear.
  if (data.code === 'current_unavailable' && data.reason === 'grid_reflow') {
    return false;
  }
  clearReconnectFallback();
  mode = 'auto';
  notifySourceChanged();
  return true;
}

export function processGenericHello(data) {
  gmcpMap.processHello(data, {
    host: dom.host && dom.host.value,
    port: dom.port && dom.port.value,
  });
}

export function processGenericRoomInfo(data) {
  // Keep the learned source warm even while MapData2 is authoritative. It is a
  // ready fallback if the server cannot provide a Current context, and avoids
  // a second blank-map window while Room.Info rebuilds from scratch.
  return gmcpMap.processRoomInfo(data);
}

export function notifyLiveRoomChange(roomId) {
  return roomId;
}
