export const state = {
  ws: null,
  connectionPending: false,
  connectTime: null,
  bytesSent: 0,
  bytesReceived: 0,
  reconnectAttempts: 0,
  reconnectTimer: null,
  userDisconnected: false,
  disconnectedSendWarningShown: false,
  wsHealth: {
    currentUrl: null,
    lastOpenAt: null,
    lastInboundAt: null,
    lastInboundTextAt: null,
    lastInboundGmcpAt: null,
    lastOutboundAt: null,
    lastCommandAt: null,
    lastErrorAt: null,
    lastCloseAt: null,
    lastHandlerErrorAt: null,
    lastBufferedAmount: 0,
    maxBufferedAmount: 0,
    stalledAt: null,
    forcedReconnects: 0,
    recentCommandTimes: [],
    events: [],
  },
  clientVersion: 'unknown',
  clientVersionPromise: null,
  settings: {
    autoReconnect: true,
    repeatLastCommand: true,
    keyMapperEnabled: false,
    keyMappings: [],
    historyTabCompletionEnabled: false,
    scrollbackBehavior: 'pause',
    scrollbackSplitRatio: 0.6,
    outputScrollbackPreset: 'normal',
    tabObservabilityEnabled: false,
  },
  tabObservability: {
    currentState: null,
    lastSentState: null,
  },
};

export const dom = {
  host: null,
  port: null,
  wssToggle: null,
  connectBtn: null,
  connectionState: null,
  connectionDot: null,
  connectFields: null,
  toolbarStatus: null,
  outputShell: null,
  output: null,
  outputSplit: null,
  outputHistory: null,
  outputLive: null,
  outputDivider: null,
  outputLiveBtn: null,
  outputPauseBtn: null,
  commandInput: null,
  sendBtn: null,
  statusConnection: null,
  statusUptime: null,
  statusVersions: null,
  updateBanner: null,
  updateRefresh: null,
  toolbarBrand: null,
  gmcpPanel: null,
  gmcpToggle: null,
  notificationsBtn: null,
  mailBtn: null,
  announcementsBtn: null,
  mobilePanelsBtn: null,
};

export function initDom() {
  dom.host = document.getElementById('host');
  dom.port = document.getElementById('port');
  dom.wssToggle = document.getElementById('wss-toggle');
  dom.connectBtn = document.getElementById('connect-btn');
  dom.connectionState = document.getElementById('connection-state');
  dom.connectionDot = document.getElementById('connection-dot');
  dom.connectFields = document.getElementById('toolbar-connect-fields');
  dom.toolbarStatus = document.getElementById('toolbar-status');
  dom.outputShell = document.getElementById('output-shell');
  dom.output = document.getElementById('output');
  dom.outputSplit = document.getElementById('output-split');
  dom.outputHistory = document.getElementById('output-history');
  dom.outputLive = document.getElementById('output-live');
  dom.outputDivider = document.getElementById('output-divider');
  dom.outputLiveBtn = document.getElementById('output-live-btn');
  dom.outputPauseBtn = document.getElementById('output-pause-btn');
  dom.commandInput = document.getElementById('command-input');
  dom.sendBtn = document.getElementById('send-btn');
  dom.statusConnection = document.getElementById('status-connection');
  dom.statusUptime = document.getElementById('status-uptime');
  dom.statusVersions = document.getElementById('status-versions');
  dom.updateBanner = document.getElementById('update-banner');
  dom.updateRefresh = document.getElementById('update-refresh');
  dom.toolbarBrand = document.getElementById('toolbar-brand');
  dom.gmcpPanel = document.getElementById('gmcp-panel');
  dom.gmcpToggle = document.getElementById('gmcp-toggle');
  dom.notificationsBtn = document.getElementById('notifications-btn');
  dom.mailBtn = document.getElementById('mail-btn');
  dom.announcementsBtn = dom.mailBtn;
  dom.mobilePanelsBtn = document.getElementById('mobile-panels-btn');
}
