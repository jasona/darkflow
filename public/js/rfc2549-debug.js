import { state, dom } from './state.js';
import { createControllerLifecycle } from './session-compat/controllers.js';

const STORAGE_KEY = 'darkflow-rfc2549';
const URL_PARAM = 'rfc2549';
const UPDATE_INTERVAL_MS = 2500;
const RED_EVENT_TYPES = new Set([
  'force-reconnect',
  'send-error',
  'message-handler-error',
  'ws-send-error',
  'ws-gmcp-send-error',
]);

let panelEl = null;
let bodyEl = null;
let timer = null;
let enabled = false;
let qosOverride = null;
let manualRedMarks = [];
let snapshotProvider = null;
let debugLifecycle = null;

function isTruthy(value) {
  if (value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '' || normalized === '1' || normalized === 'true'
    || normalized === 'yes' || normalized === 'on';
}

function getStartupEnabled() {
  const params = new URLSearchParams(window.location.search);
  if (params.has(URL_PARAM)) return isTruthy(params.get(URL_PARAM));
  try {
    return isTruthy(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    return false;
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function getProtocolLabel() {
  const protocol = dom.protocolSelect ? dom.protocolSelect.value : 'unknown';
  const host = dom.host ? dom.host.value || 'localhost' : 'localhost';
  const port = dom.port ? dom.port.value || '4242' : '4242';
  if (protocol === 'telnet' || protocol === 'telnets') {
    return protocol + ' bridge to ' + host + ':' + port;
  }
  return protocol + ' direct to ' + host + ':' + port;
}

function getSnapshot() {
  if (typeof snapshotProvider === 'function') return snapshotProvider();
  return {};
}

function recentEvents(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.events)) return [];
  return snapshot.events.slice(-8);
}

function countRedMarks(snapshot) {
  const events = recentEvents(snapshot);
  let count = 0;
  events.forEach((event) => {
    if (event && RED_EVENT_TYPES.has(event.type)) count++;
  });
  return count + manualRedMarks.length;
}

function computePulse(snapshot) {
  const events = recentEvents(snapshot);
  if (events.length < 2) return 'idle';
  const first = Date.parse(events[0].ts);
  const last = Date.parse(events[events.length - 1].ts);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
    return events.length + ' events';
  }
  const perMinute = events.length / ((last - first) / 60000);
  return perMinute.toFixed(1) + '/min';
}

function computeQoS(snapshot) {
  if (qosOverride) return qosOverride;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return 'Coach';
  if (snapshot.stalledAt || countRedMarks(snapshot) > 0) return 'Coach';
  if ((snapshot.bufferedAmount || 0) > 65536) return 'Business';
  if ((snapshot.recentCommandCount || 0) >= 3) return 'First';
  return 'Concorde';
}

function row(label, value) {
  return '<div class="rfc2549-row"><span>' + escapeHtml(label) +
    '</span><strong>' + escapeHtml(value) + '</strong></div>';
}

function eventLine(event) {
  if (!event) return '';
  const time = event.ts ? new Date(event.ts).toLocaleTimeString() : '--:--:--';
  return '<li><span>' + escapeHtml(time) + '</span>' +
    escapeHtml(event.type || 'event') + '</li>';
}

function render() {
  if (!enabled || !bodyEl) return;
  const snapshot = getSnapshot();
  const qos = computeQoS(snapshot);
  const bytes = formatBytes((state.bytesSent || 0) + (state.bytesReceived || 0));
  const events = recentEvents(snapshot);
  const redMarks = countRedMarks(snapshot);
  const queue = events.length ? events.map(eventLine).join('') :
    '<li><span>--:--:--</span>carrier queue idle</li>';

  panelEl.dataset.qos = qos.toLowerCase();
  bodyEl.innerHTML =
    row('QoS class', qos) +
    row('Route', getProtocolLabel()) +
    row('Frequent flyer miles', bytes) +
    row('Carrier queue', String(events.length)) +
    row('RED-marked packets', String(redMarks)) +
    row('Pulse rate', computePulse(snapshot)) +
    '<ol class="rfc2549-events">' + queue + '</ol>' +
    '<div class="rfc2549-footnote">RFC 2549 debug visualization only. Transport is unchanged.</div>';
}

function createPanel() {
  if (panelEl) return;
  panelEl = document.createElement('section');
  panelEl.className = 'rfc2549-debug-panel';
  panelEl.setAttribute('aria-label', 'RFC 2549 debug panel');
  panelEl.innerHTML =
    '<div class="rfc2549-header">' +
      '<div><span class="rfc2549-kicker">RFC 2549</span><h2>Avian QoS</h2></div>' +
      '<button type="button" class="rfc2549-close" title="Disable RFC 2549 debug">x</button>' +
    '</div>' +
    '<div class="rfc2549-body"></div>';
  bodyEl = panelEl.querySelector('.rfc2549-body');
  debugLifecycle.listen(panelEl.querySelector('.rfc2549-close'), 'click', disable);
  document.body.appendChild(panelEl);
}

function persist(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // Ignore private-mode or quota failures; URL opt-in still works.
  }
}

export function enable() {
  if (enabled) return;
  enabled = true;
  persist(true);
  createPanel();
  panelEl.hidden = false;
  render();
  timer = debugLifecycle.setInterval(render, UPDATE_INTERVAL_MS);
}

export function disable() {
  enabled = false;
  persist(false);
  if (timer) timer();
  timer = null;
  if (panelEl) panelEl.hidden = true;
}

export function toggle() {
  if (enabled) disable();
  else enable();
}

export function snapshot() {
  const socketSnapshot = getSnapshot();
  return {
    enabled,
    qos: computeQoS(socketSnapshot),
    route: getProtocolLabel(),
    bytes: {
      sent: state.bytesSent || 0,
      received: state.bytesReceived || 0,
      total: (state.bytesSent || 0) + (state.bytesReceived || 0),
    },
    redMarks: countRedMarks(socketSnapshot),
    pulseRate: computePulse(socketSnapshot),
    socket: socketSnapshot,
  };
}

export function setQoS(className) {
  const normalized = String(className || '').trim();
  qosOverride = normalized || null;
  render();
}

export function markRed(reason) {
  manualRedMarks.push({
    ts: new Date().toISOString(),
    type: 'manual-red',
    detail: { reason: reason || 'manual mark' },
  });
  manualRedMarks = manualRedMarks.slice(-20);
  render();
}

export function initRfc2549Debug(options) {
  if (debugLifecycle) return debugLifecycle.dispose;
  const lifecycle = createControllerLifecycle('rfc2549-debug', () => {
    timer = null;
    enabled = false;
    if (panelEl) panelEl.remove();
    panelEl = null;
    bodyEl = null;
    snapshotProvider = null;
    delete window.rfc2549Debug;
    debugLifecycle = null;
  });
  debugLifecycle = lifecycle;
  snapshotProvider = options && options.getSnapshot;
  window.rfc2549Debug = {
    enable,
    disable,
    toggle,
    snapshot,
    setQoS,
    markRed,
  };
  if (getStartupEnabled()) enable();
  return lifecycle.dispose;
}
