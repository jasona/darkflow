// Connection Health probe engine. Continuously measures three independent
// paths so perceived "lag" can be attributed:
//   - Core.Ping over the game WebSocket (network + driver scheduling)
//   - GET /ping against the web host (network only, no MUD driver)
//   - Darkwind.Lag.Status polls (the server's own heartbeat-drift report)
// plus local signals (event-loop drift, longtask, navigator.onLine, the
// wsHealth bookkeeping socket-state.js already maintains).
//
// UI surfaces consume this module via events only:
//   emits   dw:lag-update      (detail = getSnapshot())
//   listens dw:lag-run-check   (10s burst + one-shot internet probe)
// so panel-renderers never import it and no module cycles appear.

import { state, dom } from './state.js';
import { gmcp } from './gmcp.js';
import { settingsManager } from './settings-manager.js';
import {
  LAG_THRESHOLDS,
  makeRing,
  makePingCorrelator,
  summarizeRtt,
  summarizeLocal,
  diagnose,
  chipStatus,
} from './lag-core.mjs';
import { createControllerLifecycle, disposeControllerLifecycle } from './session-compat/controllers.js';

const PING_INTERVAL_MS = 5000;
const HTTP_INTERVAL_MS = 30000;
const HTTP_INTERVAL_FAST_MS = 10000;
const SERVER_POLL_INTERVAL_MS = 15000;
const LOCAL_TICK_MS = 1000;
const FULL_CHECK_DURATION_MS = 10000;
const INTERNET_PROBE_URL = 'https://www.gstatic.com/generate_204';

const now = () => performance.now();

export const lagMonitor = {
  _mudRing: makeRing(120),
  _httpRing: makeRing(60),
  _localRing: makeRing(120),
  _serverStatus: null,
  _serverPollMisses: 0,
  _correlator: makePingCorrelator({ timeoutMs: LAG_THRESHOLDS.pingTimeoutMs }),
  _connected: false,
  _timers: [],
  _localTimer: null,
  _lastLocalTick: 0,
  _longTaskMs: 0,
  _longTaskObserver: null,
  _lastHttpAt: 0,
  _httpFirstSampleDropped: false,
  _reconnectTimes: [],
  _lastForcedReconnects: 0,
  _fullCheck: null,
  _lastDiagnosis: null,

  init() {
    if (this._controllerLifecycle) return this._controllerLifecycle.dispose;
    const lifecycle = createControllerLifecycle('lag-monitor', () => {
      this._controllerLifecycle = null;
      this._correlator.abort();
      this._stopProbes();
      if (this._localTimer) clearInterval(this._localTimer);
      this._localTimer = null;
      if (this._longTaskObserver) this._longTaskObserver.disconnect();
      this._longTaskObserver = null;
      this._connected = false;
    });
    this._controllerLifecycle = lifecycle;
    const scopedGmcp = lifecycle.bindGmcp(gmcp);

    if (dom.statusLatency) {
      lifecycle.listen(dom.statusLatency, 'click', () => {
        document.dispatchEvent(new CustomEvent('dw:lag-open-panel'));
      });
    }

    lifecycle.listen(document, 'dw:connectionstate', (event) => {
      const wasConnected = this._connected;
      this._connected = event.detail && event.detail.state === 'connected';
      if (this._connected && !wasConnected) {
        if (this._mudRing.size()) this._mudRing.push({ t: now(), gap: true });
        this._reconnectTimes.push(now());
        this._reconnectTimes = this._reconnectTimes.slice(-10);
        this._startProbes();
      } else if (!this._connected && wasConnected) {
        this._correlator.abort();
        this._stopProbes();
        this._publish();
      }
    });

    lifecycle.listen(document, 'dw:lag-run-check', () => this.runFullCheck());
    lifecycle.listen(document, 'visibilitychange', () => {
      if (document.hidden) {
        this._correlator.abort();
        this._stopProbes();
        this._mudRing.push({ t: now(), gap: true });
        this._localRing.push({ t: now(), gap: true });
      } else if (this._connected) {
        this._startProbes();
      }
    });

    scopedGmcp.on('Core.Ping', () => {
      const rtt = this._correlator.onEcho(now());
      if (rtt !== null) {
        this._mudRing.push({ t: now(), rtt: Math.round(rtt) });
        this._publish();
      }
    });

    scopedGmcp.on('Darkwind.Lag.Status', (data) => {
      if (data && typeof data === 'object') {
        this._serverStatus = data;
        this._serverPollMisses = 0;
        this._publish();
      }
    });

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this._longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) this._longTaskMs += entry.duration;
        });
        this._longTaskObserver.observe({ entryTypes: ['longtask'] });
        lifecycle.ownObserver(this._longTaskObserver);
      } catch (e) { /* longtask unsupported (non-Chromium) - drift sensor covers it */ }
    }

    // The 1s local tick always runs: it is the drift sensor, the ping-timeout
    // sweep, and the chip refresher.
    this._lastLocalTick = now();
    this._localTimer = setInterval(() => this._localTick(), LOCAL_TICK_MS);
    lifecycle.own('timer', () => {
      if (this._localTimer) clearInterval(this._localTimer);
      this._localTimer = null;
    });
    return lifecycle.dispose;
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  _enabled() {
    return settingsManager.get('lagMonitorEnabled') !== false;
  },

  _startProbes() {
    this._stopProbes();
    if (!this._enabled()) return;
    this._timers.push(setInterval(() => this._sendPing(), PING_INTERVAL_MS));
    this._timers.push(setInterval(() => this._maybeHttpProbe(), HTTP_INTERVAL_FAST_MS));
    this._timers.push(setInterval(() => this._pollServer(), SERVER_POLL_INTERVAL_MS));
    // prime immediately so the panel is not empty for the first interval
    this._sendPing();
    this._maybeHttpProbe(true);
    this._pollServer();
  },

  _stopProbes() {
    for (const timer of this._timers) clearInterval(timer);
    this._timers = [];
  },

  _sendPing() {
    if (!this._connected || !this._enabled() || document.hidden) return;
    if (!gmcp.enabled) return; // GMCP handshake not agreed yet
    if (!this._correlator.canSend()) return; // timeout sweep will count it
    if (gmcp.send('Core.Ping')) this._correlator.onSend(now());
  },

  // HTTP probes run on a fast timer but skip turns unless degraded, so the
  // effective cadence is 30s healthy / 10s when the game path looks slow.
  _maybeHttpProbe(force) {
    if (!this._enabled() || document.hidden) return;
    const degraded = this._lastDiagnosis
      && (this._lastDiagnosis.network.status === 'warn'
        || this._lastDiagnosis.network.status === 'bad');
    const interval = degraded ? HTTP_INTERVAL_FAST_MS : HTTP_INTERVAL_MS;
    if (!force && now() - this._lastHttpAt < interval - 500) return;
    this._httpProbe();
  },

  async _httpProbe() {
    this._lastHttpAt = now();
    const t0 = now();
    try {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), LAG_THRESHOLDS.pingTimeoutMs);
      await fetch('/ping?t=' + Date.now(), { cache: 'no-store', signal: controller.signal });
      clearTimeout(abortTimer);
      const rtt = Math.round(now() - t0);
      // The first sample pays connection setup; drop it as a baseline cost.
      if (!this._httpFirstSampleDropped) {
        this._httpFirstSampleDropped = true;
        return;
      }
      this._httpRing.push({ t: now(), rtt });
    } catch (e) {
      this._httpRing.push({ t: now(), rtt: null });
    }
    this._publish();
  },

  _pollServer() {
    if (!this._connected || !this._enabled() || document.hidden) return;
    if (!gmcp.enabled) return;
    if (!gmcp.serverSupportsPackage('Darkwind.Lag')) return;
    if (gmcp.send('Darkwind.Lag.Get')) this._serverPollMisses++;
  },

  _localTick() {
    const t = now();
    const drift = Math.max(0, t - this._lastLocalTick - LOCAL_TICK_MS);
    this._lastLocalTick = t;

    const longTaskMs = this._longTaskMs;
    this._longTaskMs = 0;
    this._localRing.push({
      t,
      driftMs: Math.round(drift),
      longTaskMs: Math.round(longTaskMs),
      hidden: document.hidden,
    });

    if (this._correlator.checkTimeout(t)) {
      this._mudRing.push({ t, rtt: null });
    }
    this._publish();
  },

  getSnapshot() {
    const t = now();
    const health = state.wsHealth || {};
    const reconnectsRecent = this._reconnectTimes
      .filter((rt) => t - rt <= LAG_THRESHOLDS.windowMs).length
      // the first connect of a session is not a "reconnect"
      - (this._reconnectTimes.length && t - this._reconnectTimes[0] <= LAG_THRESHOLDS.windowMs ? 1 : 0);

    const mudSamples = this._mudRing.items();
    const mud = summarizeRtt(mudSamples, t);
    const http = summarizeRtt(this._httpRing.items(), t);
    const local = summarizeLocal(this._localRing.items(), t);

    const mudHost = dom.host && dom.host.value ? dom.host.value.trim() : '';
    const sameHost = !mudHost || mudHost === window.location.hostname;

    const inputs = {
      connected: this._connected,
      online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
      mud,
      http,
      server: this._serverStatus,
      serverSupported: gmcp.serverSupportsPackage('Darkwind.Lag'),
      serverPollMisses: Math.max(0, this._serverPollMisses - 1),
      local,
      wsStalled: !!health.stalledAt,
      reconnectsRecent: Math.max(0, reconnectsRecent),
      bufferedBytes: health.lastBufferedAmount || 0,
      sameHost,
    };
    const diagnosis = diagnose(inputs);
    this._lastDiagnosis = diagnosis;

    const latest = [...mudSamples].reverse().find((s) => typeof s.rtt === 'number');
    return {
      t,
      enabled: this._enabled(),
      diagnosis,
      inputs,
      latestRtt: latest ? latest.rtt : null,
      chip: chipStatus(this._connected && latest ? latest.rtt : null, diagnosis.verdict),
      mudSamples,
      httpSamples: this._httpRing.items(),
      fullCheck: this._fullCheck,
    };
  },

  _publish() {
    const snapshot = this.getSnapshot();
    this._updateChip(snapshot);
    document.dispatchEvent(new CustomEvent('dw:lag-update', { detail: snapshot }));
  },

  _updateChip(snapshot) {
    const chip = dom.statusLatency;
    if (!chip) return;
    if (!snapshot.enabled || snapshot.chip === 'off') {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    chip.textContent = snapshot.latestRtt !== null ? snapshot.latestRtt + ' ms' : '--';
    chip.className = 'status-latency lag-' + snapshot.chip;
    chip.title = snapshot.diagnosis.headline + ' (click for details)';
  },

  // 10-second burst: pings every 1s, HTTP probes every 2s, two server polls,
  // plus a one-shot third-party probe to separate "path to the game host"
  // from "my internet generally". Works partially while disconnected.
  async runFullCheck() {
    if (this._fullCheck && this._fullCheck.running) return;
    this._fullCheck = { running: true, startedAt: now(), internetRtt: null, internetError: false };
    this._publish();

    const burstTimers = [];
    if (this._connected && this._enabled()) {
      burstTimers.push(setInterval(() => this._sendPing(), 1000));
      burstTimers.push(setInterval(() => this._httpProbe(), 2000));
      this._pollServer();
      setTimeout(() => this._pollServer(), FULL_CHECK_DURATION_MS - 1000);
    } else {
      burstTimers.push(setInterval(() => this._httpProbe(), 2000));
    }

    // Internet baseline: median of 3 opaque no-cors fetches.
    const internetSamples = [];
    for (let i = 0; i < 3; i++) {
      const t0 = now();
      try {
        await fetch(INTERNET_PROBE_URL + '?t=' + Date.now() + i, { mode: 'no-cors', cache: 'no-store' });
        if (i > 0) internetSamples.push(now() - t0); // first pays connection setup
      } catch (e) {
        this._fullCheck.internetError = true;
        break;
      }
    }
    if (internetSamples.length) {
      internetSamples.sort((a, b) => a - b);
      this._fullCheck.internetRtt = Math.round(internetSamples[Math.floor(internetSamples.length / 2)]);
    }

    await new Promise((resolve) => setTimeout(resolve, FULL_CHECK_DURATION_MS));
    for (const timer of burstTimers) clearInterval(timer);
    this._fullCheck.running = false;
    this._fullCheck.finishedAt = now();
    this._publish();
  },
};
