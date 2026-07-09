import { state } from './state.js';
import { appendSystemMessage } from './output.js';
import { sendSocketPayload } from './connection.js';
import { PRODUCT_NAME } from './brand.js';
import { isSocketOpen } from './socket-state.js';
import { canonicalPackageName, normalizeGmcpFrame, normalizeSupportsPayload } from './gmcp-normalizer.js';
import { registerGmcpVariables, resetGmcpVariables } from './gmcp-variables.js';

const GMCP_CLIENT_NAME = PRODUCT_NAME;
const GMCP_MEDIA_REFRESH_PACKAGE = 'Darkwind.Client.RefreshMedia';
const GMCP_SUBSCRIPTIONS_PACKAGE = 'Darkwind.Client.Subscriptions';
const gmcpTextEncoder = new TextEncoder();
export const gmcpTextDecoder = new TextDecoder('utf-8');

function normalizeSupports(payload) {
  payload = normalizeSupportsPayload(payload);
  const supports = {};
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item !== 'string') continue;
      const parts = item.trim().split(/\s+/);
      if (parts[0]) supports[parts[0]] = parts[1] || '1';
    }
  } else if (payload && typeof payload === 'object') {
    for (const [name, version] of Object.entries(payload)) {
      supports[name] = version || '1';
    }
  }
  return supports;
}

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
      broadcast: true,
      ...(payload.features && typeof payload.features === 'object' ? payload.features : {}),
    },
  };
}

export const gmcp = {
  enabled: false,
  handlers: {},
  subscriptions: normalizeSubscriptionPayload(),
  serverSupports: {},

  on(packageName, callback) {
    packageName = canonicalPackageName(packageName);
    if (!this.handlers[packageName]) this.handlers[packageName] = [];
    this.handlers[packageName].push(callback);
  },

  off(packageName, callback) {
    packageName = canonicalPackageName(packageName);
    if (!this.handlers[packageName]) return;
    this.handlers[packageName] = this.handlers[packageName].filter(cb => cb !== callback);
  },

  dispatch(packageName, data) {
    const normalized = normalizeGmcpFrame(packageName, data);
    packageName = normalized.packageName;
    data = normalized.data;

    if (packageName === 'Core.Supports.Set') {
      this.serverSupports = normalizeSupports(data);
    } else if (packageName === 'Core.Supports.Add') {
      this.serverSupports = {
        ...this.serverSupports,
        ...normalizeSupports(data),
      };
    } else if (packageName === 'Core.Supports.Remove') {
      const removed = normalizeSupports(data);
      for (const name of Object.keys(removed)) delete this.serverSupports[name];
    }

    registerGmcpVariables(packageName, data);

    // Isolate handler failures: one throwing subscriber must not starve
    // later subscribers (notifications, mention roster) of the same frame.
    if (this.handlers['*']) {
      this.handlers['*'].forEach(cb => {
        try {
          cb(packageName, data);
        } catch (err) {
          console.error(`GMCP wildcard handler failed for ${packageName}`, err);
        }
      });
    }
    if (this.handlers[packageName]) {
      this.handlers[packageName].forEach(cb => {
        try {
          cb(data, packageName);
        } catch (err) {
          console.error(`GMCP handler failed for ${packageName}`, err);
        }
      });
    }
  },

  serverSupportsPackage(packageName) {
    return !!this.serverSupports[canonicalPackageName(packageName)];
  },

  send(packageName, data) {
    if (!isSocketOpen(state.ws)) return false;
    const payload = data !== undefined
      ? packageName + ' ' + JSON.stringify(data)
      : packageName;
    return sendSocketPayload(gmcpTextEncoder.encode(payload), {
      kind: 'gmcp',
      size: payload.length,
      preview: packageName,
    });
  },

  sendHandshake() {
    const geometry = state.terminalGeometry || {};
    this.send('Core.Hello', {
      client: GMCP_CLIENT_NAME,
      version: state.clientVersion || 'unknown',
      width: geometry.columns || 75,
      height: geometry.rows || 24,
    });
    this.send('Core.Supports.Set', [
      'Char 1',
      'Char.Vitals 1',
      'Char.Status 1',
      'Char.StatusVars 1',
      'Char.Stats 1',
      'Char.RealStats 1',
      'Char.Worth 1',
      'Char.Enemy 1',
      'Char.Items 1',
      'Char.Defences 1',
      'Room 1',
      'Comm 1',
      'Comm.Channel 1',
      'Group 1',
      'Game 1',
      'Darkwind.Char.Avatar 1',
      'Darkwind.Room.Image 1',
      'Darkwind.Divine 1',
      'Darkwind.Sky 1',
      'Darkwind.GuildVitals 1',
      'Darkwind.XPMon 1',
      'Darkwind.Client.Subscriptions 1',
      'Darkwind.Client.NAWS 1',
      'Darkwind.Window 1',
      'Darkwind.Snoop 1',
      'Darkwind.IDE 2',
      'Darkwind.MapData2 2',
      'Darkwind.Completion 1',
      'Darkwind.Quests 1',
      'Darkwind.Achievements 1',
      'Darkwind.Announcements 1',
      'Darkwind.Giphy 1',
      'Darkwind.Sound 1',
      'Darkwind.Broadcast 1',
      'Darkwind.LinuxRescue 1',
      'Darkwind.Lag 1',
      'Darkwind.Fishing 1'
    ]);
    this.enabled = true;
  },

  reset() {
    this.enabled = false;
    this.serverSupports = {};
    this.subscriptions = normalizeSubscriptionPayload();
    resetGmcpVariables();
    if (this.handlers['Core.Supports.Set']) {
      this.handlers['Core.Supports.Set'].forEach(cb => cb({}, 'Core.Supports.Set'));
    }
  },

  sendSubscriptions(payload = {}) {
    if (!isSocketOpen(state.ws)) return false;
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
    if (!isSocketOpen(state.ws)) {
      return false;
    }

    this.send(GMCP_MEDIA_REFRESH_PACKAGE);
    return true;
  },

  requestChannelPlayers() {
    if (!isSocketOpen(state.ws)) {
      return false;
    }

    this.send('Comm.Channel.Players', {});
    return true;
  },

  enableChannel(channel) {
    const name = typeof channel === 'string' ? channel.trim() : '';
    if (!name || !isSocketOpen(state.ws)) {
      return false;
    }

    this.send('Comm.Channel.Enable', name);
    return true;
  },

  restartHandshake(payload = {}) {
    if (!isSocketOpen(state.ws)) {
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
      reason: payload.reason || 'ctrl-k',
      full: true,
    });
    this.requestMediaRefresh();
    appendSystemMessage('GMCP handshake and full pane sync requested.');
    return true;
  }
};
