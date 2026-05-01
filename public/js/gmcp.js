import { state } from './state.js';
import { appendSystemMessage } from './output.js';
import { sendSocketPayload } from './connection.js';
import { PRODUCT_NAME } from './brand.js';

const GMCP_CLIENT_NAME = PRODUCT_NAME;
const GMCP_MEDIA_REFRESH_PACKAGE = 'Darkwind.Client.RefreshMedia';
const GMCP_SUBSCRIPTIONS_PACKAGE = 'Darkwind.Client.Subscriptions';
const gmcpTextEncoder = new TextEncoder();
export const gmcpTextDecoder = new TextDecoder('utf-8');

function normalizeSubscriptionPayload(payload = {}) {
  return {
    reason: payload.reason || 'visibility-sync',
    full: !!payload.full,
    panels: payload.panels && typeof payload.panels === 'object' ? { ...payload.panels } : {},
    features: {
      announcementsBadge: true,
      enemyAutoOpen: true,
      windows: true,
      ide: true,
      completion: true,
      giphy: true,
      ...(payload.features && typeof payload.features === 'object' ? payload.features : {}),
    },
  };
}

export const gmcp = {
  enabled: false,
  handlers: {},
  subscriptions: normalizeSubscriptionPayload(),

  on(packageName, callback) {
    if (!this.handlers[packageName]) this.handlers[packageName] = [];
    this.handlers[packageName].push(callback);
  },

  off(packageName, callback) {
    if (!this.handlers[packageName]) return;
    this.handlers[packageName] = this.handlers[packageName].filter(cb => cb !== callback);
  },

  dispatch(packageName, data) {
    if (this.handlers['*']) {
      this.handlers['*'].forEach(cb => cb(packageName, data));
    }
    if (this.handlers[packageName]) {
      this.handlers[packageName].forEach(cb => cb(data, packageName));
    }
  },

  send(packageName, data) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const payload = data !== undefined
      ? packageName + ' ' + JSON.stringify(data)
      : packageName;
    sendSocketPayload(gmcpTextEncoder.encode(payload), {
      kind: 'gmcp',
      size: payload.length,
      preview: packageName,
    });
  },

  sendHandshake() {
    this.send('Core.Hello', {
      client: GMCP_CLIENT_NAME,
      version: state.clientVersion || 'unknown'
    });
    this.send('Core.Supports.Set', [
      'Char 1',
      'Char.Vitals 1',
      'Char.Items 1',
      'Char.Defences 1',
      'Room 1',
      'Comm 1',
      'Group 1',
      'Game 1',
      'Darkwind.Char.Avatar 1',
      'Darkwind.Room.Image 1',
      'Darkwind.Divine 1',
      'Darkwind.Client.Subscriptions 1',
      'Darkwind.Window 1',
      'Darkwind.IDE 1',
      'Darkwind.MapData 1',
      'Darkwind.Completion 1',
      'Darkwind.Quests 1',
      'Darkwind.Achievements 1',
      'Darkwind.Announcements 1',
      'Darkwind.Giphy 1'
    ]);
    this.enabled = true;
  },

  reset() {
    this.enabled = false;
    this.subscriptions = normalizeSubscriptionPayload();
  },

  sendSubscriptions(payload = {}) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
    this.subscriptions = normalizeSubscriptionPayload({
      ...this.subscriptions,
      ...payload,
      panels: payload.panels || this.subscriptions.panels,
      features: {
        ...this.subscriptions.features,
        ...(payload.features || {}),
      },
    });
    this.send(GMCP_SUBSCRIPTIONS_PACKAGE, this.subscriptions);
    if (payload.features && payload.features.announcementsList) {
      this.subscriptions.features.announcementsList = false;
    }
    return true;
  },

  requestMediaRefresh() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.send(GMCP_MEDIA_REFRESH_PACKAGE);
    return true;
  },

  restartHandshake(payload = {}) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      appendSystemMessage('GMCP restart unavailable: not connected.');
      return false;
    }

    const subscriptions = normalizeSubscriptionPayload({
      ...this.subscriptions,
      ...payload,
      panels: payload.panels || this.subscriptions.panels,
      features: {
        ...this.subscriptions.features,
        ...(payload.features || {}),
      },
    });
    this.reset();
    this.sendHandshake();
    this.sendSubscriptions({
      ...subscriptions,
      reason: 'ctrl-k',
      full: true,
    });
    this.requestMediaRefresh();
    appendSystemMessage('GMCP handshake and full pane sync requested.');
    return true;
  }
};
