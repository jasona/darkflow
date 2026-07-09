import * as darkwindMap from './map-data-v2.js';
import * as gmcpMap from './map-data-gmcp.js';
import { dom } from './state.js';

let mode = 'auto';

export function getLiveMapSource() {
  return mode === 'darkwind' ? darkwindMap : gmcpMap;
}

export function resetLiveMapModeForConnection() {
  mode = 'auto';
  const identity = {
    host: dom.host && dom.host.value,
    port: dom.port && dom.port.value,
  };
  darkwindMap.configureWorld(identity);
  gmcpMap.configureWorld(identity);
  gmcpMap.resetForConnection();
}

export function markMapData2Active() {
  mode = 'darkwind';
}

export function processGenericHello(data) {
  gmcpMap.processHello(data, {
    host: dom.host && dom.host.value,
    port: dom.port && dom.port.value,
  });
}

export function processGenericRoomInfo(data) {
  if (mode === 'darkwind') return 0;
  return gmcpMap.processRoomInfo(data);
}

export function notifyLiveRoomChange(roomId) {
  return roomId;
}
