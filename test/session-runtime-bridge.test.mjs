import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

import {
  BRIDGE_UNINSTALLED_ERROR,
  connect,
  disconnect,
  expectInboundWithin,
  forceReconnect,
  getHealthSnapshot,
  getSessionId,
  getWebSocketProxy,
  gmcpDispatch,
  gmcpOn,
  gmcpSend,
  installSessionRuntimeBridge,
  isSessionRuntimeActive,
  resetSessionRuntimeBridgeForTests,
  retryNow,
  sendPayload,
} from "../public/js/session-compat/runtime.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSED = 3;

class FakeWebSocket {
  static CONNECTING = WS_CONNECTING;
  static OPEN = WS_OPEN;
  static CLOSED = WS_CLOSED;
  static instances = [];

  readyState = WS_CONNECTING;
  bufferedAmount = 0;
  binaryType = "arraybuffer";
  url;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;

  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static reset() {
    FakeWebSocket.instances = [];
  }

  send() {}

  open() {
    this.readyState = WS_OPEN;
    this.onopen?.({ type: "open" });
  }

  emitMessage(data) {
    this.onmessage?.({ data });
  }

  close(code = 1000, reason = "") {
    this.readyState = WS_CLOSED;
    this.onclose?.({ code, reason, wasClean: true });
  }
}

async function loadBridgeIntegrationModules(t) {
  const server = await createServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    hmr: false,
    watch: null,
  });
  t.after(async () => {
    await server.close();
  });

  const ssr = server.environments.ssr;
  assert.ok(isRunnableDevEnvironment(ssr));

  const [bridgeWiring, sessionFactory, profiles, ids] = await Promise.all([
    ssr.runner.import("/app/session-bridge-wiring.ts"),
    ssr.runner.import("/runtime/session-factory.ts"),
    ssr.runner.import("/model/profiles.ts"),
    ssr.runner.import("/model/ids.ts"),
  ]);

  return {
    buildSessionRuntimeCompatBridge: bridgeWiring.buildSessionRuntimeCompatBridge,
    createSessionFromState: sessionFactory.createSessionFromState,
    createSessionRegistry: (await ssr.runner.import("/runtime/session-registry.ts")).createSessionRegistry,
    createEmptyLocalDefinitions: profiles.createEmptyLocalDefinitions,
    createEmptyConfigurationSetRefs: profiles.createEmptyConfigurationSetRefs,
    createServerProfileId: ids.createServerProfileId,
    createCharacterProfileId: ids.createCharacterProfileId,
  };
}

function buildGraph(modules) {
  let counter = 0;
  const uuidFactory = () => {
    counter += 1;
    return `10000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
  };
  const serverId = modules.createServerProfileId(uuidFactory);
  const characterId = modules.createCharacterProfileId(uuidFactory);
  return {
    serverId,
    characterId,
    state: {
      schemaVersion: 1,
      defaults: { themeKey: "darkwind-default", defaultCharacterProfileId: characterId },
      serverProfiles: {
        [serverId]: {
          id: serverId,
          protocol: "wss",
          host: "127.0.0.1",
          port: 4242,
          label: "Test",
          capabilities: {},
          worldKey: "test",
        },
      },
      characterProfiles: {
        [characterId]: {
          id: characterId,
          serverProfileId: serverId,
          label: "Main",
          configSetRefs: modules.createEmptyConfigurationSetRefs(),
          localDefinitions: modules.createEmptyLocalDefinitions(),
          commandHistory: [],
          workspace: { version: 1, payload: {} },
          audio: {
            ambient: { enabled: true, volume: 1 },
            combat: { enabled: true, volume: 1 },
            notification: { enabled: true, volume: 1 },
          },
        },
      },
      configurationSets: {},
    },
  };
}

function createBridgeHarness(modules, t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildGraph(modules);
  const registry = modules.createSessionRegistry();
  const texts = [];
  let forceReconnectReason = null;
  const legacyState = {
    ws: null,
    connectionPending: false,
    connectTime: null,
    bytesSent: 0,
    bytesReceived: 0,
    reconnectAttempts: 0,
    reconnectTimer: null,
    userDisconnected: false,
    wsHealth: {},
  };
  const connectionUi = {
    setConnectionState: () => {},
    emitReconnectStatus: () => {},
  };

  const result = modules.createSessionFromState(graph.state, graph.serverId, graph.characterId, {
    uuidFactory: () => "10000000-0000-4000-8000-000000000001",
    registry,
    getAutoReconnect: () => true,
    getClientInfo: () => ({ client: "Darkflow", version: "test", width: 80, height: 24 }),
    appOrigin: "http://localhost:3000",
    webSocketFactory: (url) => new FakeWebSocket(url),
    onlineTarget: { addEventListener() {} },
    onText: (text) => texts.push(text),
  });
  assert.equal(result.success, true);

  const bridge = modules.buildSessionRuntimeCompatBridge(
    result.data,
    result.handles,
    legacyState,
    connectionUi,
    () => ({ client: "Darkflow", version: "test", width: 80, height: 24 }),
  );

  t.after(() => {
    bridge.stopFacadeSync();
    resetSessionRuntimeBridgeForTests();
    if (!result.data.disposed) {
      result.data.dispose();
    }
  });

  installSessionRuntimeBridge(bridge);
  bridge.markLegacyUiReady();

  return {
    session: result.data,
    bridge,
    legacyState,
    texts,
    setForceReconnectSpy() {
      const original = result.handles.transport.forceReconnect.bind(result.handles.transport);
      result.handles.transport.forceReconnect = (reason) => {
        forceReconnectReason = reason;
        return original(reason);
      };
    },
    get forceReconnectReason() {
      return forceReconnectReason;
    },
    latestSocket() {
      return FakeWebSocket.instances.at(-1) ?? null;
    },
    tick(ms) {
      t.mock.timers.tick(ms);
    },
  };
}

test("runtime bridge install toggles active state", () => {
  resetSessionRuntimeBridgeForTests();
  assert.equal(isSessionRuntimeActive(), false);

  installSessionRuntimeBridge({
    connect: () => {},
    disconnect: () => {},
    retryNow: () => {},
    forceReconnect: () => {},
    ensureConnected: () => {},
    expectInboundWithin: () => {},
    sendPayload: () => true,
    getWebSocketProxy: () => ({
      readyState: 1,
      bufferedAmount: 0,
      send: () => {},
      close: () => {},
    }),
    getHealthSnapshot: () => ({ readyStateName: "open" }),
    getConnectionState: () => "connected",
    getSessionId: () => "session-test",
    subscribeReconnectStatus: () => () => {},
    subscribeConnectionState: () => () => {},
    gmcpOn: () => {},
    gmcpOff: () => {},
    gmcpDispatch: () => {},
    gmcpSend: () => true,
    gmcpServerSupportsPackage: () => true,
    gmcpSendHandshake: () => true,
    gmcpReset: () => {},
    gmcpSendSubscriptions: () => true,
    gmcpRequestMediaRefresh: () => true,
    gmcpRequestChannelPlayers: () => true,
    gmcpEnableChannel: () => true,
    gmcpRestartHandshake: () => true,
    startFacadeSync: () => {},
    stopFacadeSync: () => {},
    markLegacyUiReady: () => {},
    gmcpIsEnabled: () => false,
  });

  assert.equal(isSessionRuntimeActive(), true);
  resetSessionRuntimeBridgeForTests();
  assert.equal(isSessionRuntimeActive(), false);
});

test("runtime bridge forwarders pass arguments through", () => {
  resetSessionRuntimeBridgeForTests();
  const calls = [];

  installSessionRuntimeBridge({
    connect: () => calls.push(["connect"]),
    disconnect: () => calls.push(["disconnect"]),
    retryNow: () => calls.push(["retryNow"]),
    forceReconnect: (reason) => calls.push(["forceReconnect", reason]),
    ensureConnected: () => calls.push(["ensureConnected"]),
    expectInboundWithin: (ms, reason) => calls.push(["expectInboundWithin", ms, reason]),
    sendPayload: (payload, metadata) => {
      calls.push(["sendPayload", payload, metadata]);
      return true;
    },
    getWebSocketProxy: () => ({
      readyState: 3,
      bufferedAmount: 12,
      send: (data) => calls.push(["proxy.send", data]),
      close: (code, reason) => calls.push(["proxy.close", code, reason]),
    }),
    getHealthSnapshot: () => ({ readyStateName: "closed", events: [] }),
    getConnectionState: () => "disconnected",
    getSessionId: () => "00000000-0000-4000-8000-000000000001",
    subscribeReconnectStatus: () => () => {},
    subscribeConnectionState: () => () => {},
    gmcpOn: (packageName, callback) => calls.push(["gmcpOn", packageName, callback]),
    gmcpOff: (packageName, callback) => calls.push(["gmcpOff", packageName, callback]),
    gmcpDispatch: (packageName, data) => calls.push(["gmcpDispatch", packageName, data]),
    gmcpSend: (packageName, data) => {
      calls.push(["gmcpSend", packageName, data]);
      return true;
    },
    gmcpServerSupportsPackage: () => true,
    gmcpSendHandshake: () => true,
    gmcpReset: () => {},
    gmcpSendSubscriptions: () => true,
    gmcpRequestMediaRefresh: () => true,
    gmcpRequestChannelPlayers: () => true,
    gmcpEnableChannel: () => true,
    gmcpRestartHandshake: () => true,
    startFacadeSync: () => {},
    stopFacadeSync: () => {},
    markLegacyUiReady: () => {},
    gmcpIsEnabled: () => false,
  });

  connect();
  disconnect();
  retryNow();
  forceReconnect("stall");
  sendPayload("look", { kind: "command" });
  gmcpOn("Char.Vitals", () => {});
  gmcpDispatch("Room.Info", { name: "Town Square" });
  gmcpSend("Core.Hello", { client: "Darkflow" });

  const proxy = getWebSocketProxy();
  proxy.send("north");
  proxy.close(1000, "done");

  assert.equal(getSessionId(), "00000000-0000-4000-8000-000000000001");
  assert.deepEqual(getHealthSnapshot(), { readyStateName: "closed", events: [] });
  assert.deepEqual(calls.slice(0, 5), [
    ["connect"],
    ["disconnect"],
    ["retryNow"],
    ["forceReconnect", "stall"],
    ["sendPayload", "look", { kind: "command" }],
  ]);
  assert.equal(calls[5][0], "gmcpOn");
  assert.equal(calls[5][1], "Char.Vitals");
  assert.deepEqual(calls.slice(6), [
    ["gmcpDispatch", "Room.Info", { name: "Town Square" }],
    ["gmcpSend", "Core.Hello", { client: "Darkflow" }],
    ["proxy.send", "north"],
    ["proxy.close", 1000, "done"],
  ]);

  resetSessionRuntimeBridgeForTests();
});

test("runtime bridge throws a distinct error when uninstalled", () => {
  resetSessionRuntimeBridgeForTests();
  assert.throws(
    () => connect(),
    (error) => error.name === BRIDGE_UNINSTALLED_ERROR,
  );
});

test("CMH4 CMH8 inbound text and bytes mirror once per frame", async (t) => {
  const modules = await loadBridgeIntegrationModules(t);
  const harness = createBridgeHarness(modules, t);

  harness.session.connect();
  const socket = harness.latestSocket();
  assert.ok(socket);
  socket.open();
  harness.tick(1);

  socket.emitMessage("Hello world");
  assert.deepEqual(harness.texts, ["Hello world"]);
  assert.equal(harness.legacyState.bytesReceived, "Hello world".length);

  const gmcpBytes = new TextEncoder().encode('Char.Vitals {"hp":1}');
  socket.emitMessage(gmcpBytes.buffer);
  assert.equal(
    harness.legacyState.bytesReceived,
    "Hello world".length + gmcpBytes.byteLength,
  );

  const beforeSend = harness.legacyState.bytesSent;
  sendPayload("look", { kind: "command" });
  harness.legacyState.bytesSent += "look".length;
  assert.equal(harness.legacyState.bytesSent, beforeSend + "look".length);
});

test("CMH5 expectInboundWithin force-reconnects when inbound is stale", async (t) => {
  const modules = await loadBridgeIntegrationModules(t);
  const harness = createBridgeHarness(modules, t);
  harness.setForceReconnectSpy();

  harness.session.connect();
  const socket = harness.latestSocket();
  socket.open();
  harness.tick(1);

  expectInboundWithin(1000, "no server traffic after connect");
  harness.tick(1000);
  assert.equal(harness.forceReconnectReason, "no server traffic after connect");
});

test("CMH7 gmcpIsEnabled reflects session bus enabled state", async (t) => {
  const modules = await loadBridgeIntegrationModules(t);
  const harness = createBridgeHarness(modules, t);

  assert.equal(harness.bridge.gmcpIsEnabled(), false);
  harness.session.connect();
  harness.latestSocket()?.open();
  harness.tick(1);
  assert.equal(harness.bridge.gmcpIsEnabled(), true);
});
