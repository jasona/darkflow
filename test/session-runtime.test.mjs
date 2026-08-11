import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSED = 3;

/** Deterministic UUID factory matching other session tests. */
function createSequentialUuidFactory(prefix = "00000000-0000-4000-8000-") {
  let counter = 0;
  return () => {
    counter += 1;
    const suffix = counter.toString(16).padStart(12, "0");
    return `${prefix}${suffix}`;
  };
}

/** Vite SSR fixture shared by session runtime tests. */
async function loadSessionRuntimeModules(t) {
  globalThis.requestAnimationFrame = (callback) => globalThis.setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = (frameId) => globalThis.clearTimeout(frameId);

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

  const [
    idsModule,
    profilesModule,
    diagnosticsModule,
    resourceScopeModule,
    eventBusModule,
    runtimeStateModule,
    sessionRegistryModule,
    sessionModule,
    sessionFactoryModule,
    connectionModule,
    reconnectModule,
    busModule,
    resolveModule,
    serviceModule,
    snapshotModule,
    repositoryModule,
    schemaModule,
  ] = await Promise.all([
    ssr.runner.import("/model/ids.ts"),
    ssr.runner.import("/model/profiles.ts"),
    ssr.runner.import("/runtime/diagnostics.ts"),
    ssr.runner.import("/runtime/resource-scope.ts"),
    ssr.runner.import("/runtime/event-bus.ts"),
    ssr.runner.import("/runtime/runtime-state.ts"),
    ssr.runner.import("/runtime/session-registry.ts"),
    ssr.runner.import("/runtime/session.ts"),
    ssr.runner.import("/runtime/session-factory.ts"),
    ssr.runner.import("/transport/connection.ts"),
    ssr.runner.import("/transport/reconnect.ts"),
    ssr.runner.import("/gmcp/bus.ts"),
    ssr.runner.import("/configuration/resolve.ts"),
    ssr.runner.import("/configuration/service.ts"),
    ssr.runner.import("/configuration/snapshot.ts"),
    ssr.runner.import("/storage/repository.ts"),
    ssr.runner.import("/storage/schema.ts"),
  ]);

  return {
    ...idsModule,
    ...profilesModule,
    SessionDiagnostics: diagnosticsModule.SessionDiagnostics,
    createResourceScope: resourceScopeModule.createResourceScope,
    createSessionEventBus: eventBusModule.createSessionEventBus,
    createSessionRuntimeState: runtimeStateModule.createSessionRuntimeState,
    createSessionRegistry: sessionRegistryModule.createSessionRegistry,
    createSession: sessionModule.createSession,
    createSessionFromState: sessionFactoryModule.createSessionFromState,
    decodeGmcpWireFrame: connectionModule.decodeGmcpWireFrame,
    HANDSHAKE_RESEND_DELAY_MS: reconnectModule.HANDSHAKE_RESEND_DELAY_MS,
    LOST_TRANSMISSION_RECOVERY_DELAY_MS: reconnectModule.LOST_TRANSMISSION_RECOVERY_DELAY_MS,
    createSessionGmcpBus: busModule.createSessionGmcpBus,
    resolveEffectiveConfiguration: resolveModule.resolveEffectiveConfiguration,
    subscribe: serviceModule.subscribe,
    resetConfigurationSubscriptionsForTests: serviceModule.resetConfigurationSubscriptionsForTests,
    publishConfigurationSet: serviceModule.publishConfigurationSet,
    freezeSnapshot: snapshotModule.freezeSnapshot,
    repositoryCommit: repositoryModule.commit,
    SESSION_CORE_STORAGE_KEY: schemaModule.SESSION_CORE_STORAGE_KEY,
  };
}

/** Minimal fake WebSocket matching WebSocketLike assignment style. */
class FakeWebSocket {
  static CONNECTING = WS_CONNECTING;
  static OPEN = WS_OPEN;
  static CLOSED = WS_CLOSED;

  readyState = WS_CONNECTING;
  bufferedAmount = 0;
  binaryType = "arraybuffer";
  url;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  #sent = [];

  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static instances = [];

  static reset() {
    FakeWebSocket.instances = [];
  }

  send(data) {
    this.#sent.push(data);
  }

  sentPayloads() {
    return [...this.#sent];
  }

  clearSent() {
    this.#sent = [];
  }

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

function decodeSentGmcpPackages(sentPayloads, decodeGmcpWireFrame) {
  return sentPayloads.map((payload) => {
    if (typeof payload === "string") {
      const spaceIdx = payload.indexOf(" ");
      if (spaceIdx === -1) {
        return { packageName: payload, data: undefined };
      }
      const packageName = payload.substring(0, spaceIdx);
      const remainder = payload.substring(spaceIdx + 1);
      try {
        return { packageName, data: JSON.parse(remainder) };
      } catch {
        return { packageName, data: remainder };
      }
    }
    return decodeGmcpWireFrame(new Uint8Array(payload));
  });
}

function buildMinimalGraph(modules) {
  const factory = createSequentialUuidFactory();
  const serverId = modules.createServerProfileId(factory);
  const characterAId = modules.createCharacterProfileId(factory);
  const characterBId = modules.createCharacterProfileId(factory);

  return {
    serverId,
    characterAId,
    characterBId,
    state: {
      schemaVersion: 1,
      defaults: {
        themeKey: "darkwind-default",
        defaultCharacterProfileId: characterAId,
      },
      serverProfiles: {
        [serverId]: {
          id: serverId,
          protocol: "wss",
          host: "127.0.0.1",
          port: 4242,
          label: "Test MUD",
          capabilities: {},
          worldKey: "test-world",
        },
      },
      characterProfiles: {
        [characterAId]: {
          id: characterAId,
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
        [characterBId]: {
          id: characterBId,
          serverProfileId: serverId,
          label: "Alt",
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

function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function createSessionHarness(modules, t, graph, characterProfileId, options = {}) {
  const registry = options.registry ?? modules.createSessionRegistry();
  let nowMs = options.nowMs ?? 0;
  const onlineListeners = new Map();

  const result = modules.createSessionFromState(
    graph.state,
    graph.serverId,
    characterProfileId,
    {
      uuidFactory: options.uuidFactory ?? createSequentialUuidFactory("10000000-0000-4000-8000-"),
      registry,
      getAutoReconnect: () => options.autoReconnect ?? true,
      getClientInfo: () => ({
        client: "Darkflow",
        version: "test",
        width: 80,
        height: 24,
      }),
      appOrigin: "http://localhost:3000",
      webSocketFactory: (url) => new FakeWebSocket(url),
      onlineTarget: {
        addEventListener(type, listener) {
          onlineListeners.set(listener, type);
        },
        removeEventListener(_type, listener) {
          onlineListeners.delete(listener);
        },
      },
      now: () => nowMs,
      onText: options.onText ?? (() => {}),
    },
  );

  assert.equal(result.success, true);
  assert.ok(result.handles);
  assert.ok(result.handles.transport);
  assert.ok(result.handles.gmcp);
  assert.ok(result.handles.scope);
  assert.ok(result.handles.automationRuntime);
  const session = result.data;

  t.after(() => {
    if (!session.disposed) {
      session.dispose();
    }
    modules.resetConfigurationSubscriptionsForTests();
  });

  return {
    session,
    registry,
    advance(ms) {
      nowMs += ms;
      t.mock.timers.tick(ms);
    },
    latestSocket() {
      return FakeWebSocket.instances.at(-1) ?? null;
    },
  };
}

test("runtime state tracks login reason and vitals receipt", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  const graph = buildMinimalGraph(modules);
  const resolved = modules.resolveEffectiveConfiguration(graph.state, graph.characterAId);
  assert.equal(resolved.success, true);

  const runtimeState = modules.createSessionRuntimeState(resolved.data);
  assert.equal(runtimeState.isLoggedIntoCharacter(), false);
  assert.deepEqual(runtimeState.markConnected(), { reason: "login" });
  assert.deepEqual(runtimeState.markConnected(), { reason: "reconnect" });

  runtimeState.markCharacterVitalsReceived();
  assert.equal(runtimeState.isLoggedIntoCharacter(), true);
  runtimeState.resetCharacterVitals();
  assert.equal(runtimeState.isLoggedIntoCharacter(), false);
});

test("registry enforces one live session per character", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  const registry = modules.createSessionRegistry();
  const factory = createSequentialUuidFactory();
  const serverId = modules.createServerProfileId(factory);
  const characterId = modules.createCharacterProfileId(factory);
  const sessionA = modules.createSessionId(factory);
  const sessionB = modules.createSessionId(factory);

  registry.claim({ sessionId: sessionA, serverProfileId: serverId, characterProfileId: characterId });
  assert.throws(
    () => registry.claim({ sessionId: sessionB, serverProfileId: serverId, characterProfileId: characterId }),
    (error) => error.name === "DuplicateLiveSessionError",
  );

  assert.equal(registry.release(sessionB, characterId), false);
  assert.equal(registry.release(sessionA, characterId), true);
  assert.equal(registry.lookupByCharacter(characterId), undefined);

  registry.claim({ sessionId: sessionB, serverProfileId: serverId, characterProfileId: characterId });
  assert.equal(registry.lookupByCharacter(characterId)?.sessionId, sessionB);
});

test("factory rejects unknown or mismatched profiles before claiming", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  const graph = buildMinimalGraph(modules);
  const registry = modules.createSessionRegistry();
  const factory = createSequentialUuidFactory("20000000-0000-4000-8000-");
  const deps = {
    uuidFactory: factory,
    registry,
    getAutoReconnect: () => true,
    getClientInfo: () => ({ client: "Darkflow", version: "test", width: 80, height: 24 }),
    appOrigin: "http://localhost:3000",
    webSocketFactory: (url) => new FakeWebSocket(url),
    onlineTarget: { addEventListener() {} },
    onText: () => {},
  };

  const unknownServer = modules.createSessionFromState(
    graph.state,
    modules.createServerProfileId(factory),
    graph.characterAId,
    deps,
  );
  assert.equal(unknownServer.success, false);
  assert.equal(unknownServer.code, "unknown-server-profile");

  const unknownCharacter = modules.createSessionFromState(
    graph.state,
    graph.serverId,
    modules.createCharacterProfileId(factory),
    deps,
  );
  assert.equal(unknownCharacter.success, false);
  assert.equal(unknownCharacter.code, "unknown-character-profile");

  const otherServerId = modules.createServerProfileId(factory);
  graph.state.serverProfiles[otherServerId] = {
    ...graph.state.serverProfiles[graph.serverId],
    id: otherServerId,
    label: "Other",
  };

  const mismatch = modules.createSessionFromState(
    graph.state,
    otherServerId,
    graph.characterAId,
    deps,
  );
  assert.equal(mismatch.success, false);
  assert.equal(mismatch.code, "character-server-mismatch");
  assert.equal(registry.lookupByCharacter(graph.characterAId), undefined);
});

test("duplicate live session throws without constructing resources", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);
  const harnessA = createSessionHarness(modules, t, graph, graph.characterAId);
  harnessA.session.connect();

  assert.throws(
    () =>
      modules.createSessionFromState(graph.state, graph.serverId, graph.characterAId, {
        uuidFactory: createSequentialUuidFactory("30000000-0000-4000-8000-"),
        registry: harnessA.registry,
        getAutoReconnect: () => true,
        getClientInfo: () => ({ client: "Darkflow", version: "test", width: 80, height: 24 }),
        appOrigin: "http://localhost:3000",
        webSocketFactory: (url) => new FakeWebSocket(url),
        onlineTarget: { addEventListener() {} },
        onText: () => {},
      }),
    (error) => error.name === "DuplicateLiveSessionError",
  );
});

test("two characters on one server run concurrently", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);
  const sharedFactory = createSequentialUuidFactory("10000000-0000-4000-8000-");
  const harnessA = createSessionHarness(modules, t, graph, graph.characterAId, { uuidFactory: sharedFactory });
  const harnessB = createSessionHarness(modules, t, graph, graph.characterBId, { uuidFactory: sharedFactory });

  harnessA.session.connect();
  harnessB.session.connect();
  FakeWebSocket.instances[0]?.open();
  FakeWebSocket.instances[1]?.open();

  assert.equal(harnessA.session.getHealthSnapshot().readyStateName, "open");
  assert.equal(harnessB.session.getHealthSnapshot().readyStateName, "open");
  assert.notEqual(harnessA.session.sessionId, harnessB.session.sessionId);
});

test("public connection snapshots own endpoint, lifecycle, subscriptions, and disposal", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);
  const harnessA = createSessionHarness(modules, t, graph, graph.characterAId);
  const harnessB = createSessionHarness(modules, t, graph, graph.characterBId);
  const snapshotsA = [];
  const snapshotsB = [];
  let disposeCalls = 0;
  const unsubscribeA = harnessA.session.subscribeConnection((snapshot) => snapshotsA.push(snapshot));
  harnessB.session.subscribeConnection((snapshot) => snapshotsB.push(snapshot));
  harnessA.session.onDispose(() => {
    disposeCalls += 1;
  });

  const initial = harnessA.session.getConnectionSnapshot();
  assert.deepEqual(initial, {
    endpoint: { host: "127.0.0.1", port: "4242", protocol: "wss" },
    state: "disconnected",
    reconnect: null,
  });
  initial.endpoint.host = "mutated";
  assert.equal(harnessA.session.getConnectionSnapshot().endpoint.host, "127.0.0.1");

  harnessA.session.setConnectionEndpoint({ host: "mud.example", port: "8443", protocol: "ws" });
  harnessA.session.connect();
  assert.equal(harnessA.latestSocket()?.url, "ws://mud.example:8443/");
  assert.equal(graph.state.serverProfiles[graph.serverId].host, "127.0.0.1");
  assert.equal(snapshotsA.at(-1)?.state, "connecting");
  assert.equal(snapshotsB.length, 1);

  harnessA.latestSocket()?.open();
  assert.equal(snapshotsA.at(-1)?.state, "connected");
  harnessA.latestSocket()?.close(1006, "lost");
  assert.equal(snapshotsA.at(-1)?.reconnect?.status, "scheduled");
  assert.equal(snapshotsA.at(-1)?.state, "disconnected");

  harnessA.session.disconnect();
  assert.equal(snapshotsA.at(-1)?.reconnect?.userDisconnected, true);
  harnessA.session.retryConnection();
  assert.equal(snapshotsA.at(-1)?.state, "connecting");
  assert.deepEqual(
    snapshotsA.map((snapshot) => [snapshot.state, snapshot.reconnect?.status ?? null]),
    [
      ["disconnected", null],
      ["connecting", "connecting"],
      ["connected", "connected"],
      ["disconnected", "scheduled"],
      ["disconnected", "idle"],
      ["connecting", "connecting"],
    ],
  );

  unsubscribeA();
  const beforeUnsubscribe = snapshotsA.length;
  harnessA.session.disconnect();
  assert.equal(snapshotsA.length, beforeUnsubscribe);
  harnessA.session.dispose();
  harnessA.session.dispose();
  assert.equal(disposeCalls, 1);
  harnessA.session.retryConnection();
  assert.equal(snapshotsA.length, beforeUnsubscribe);
});

test("connect sends handshake packages with login then reconnect reason", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);
  const harness = createSessionHarness(modules, t, graph, graph.characterAId);

  harness.session.connect();
  const socket = harness.latestSocket();
  socket?.open();

  let packages = decodeSentGmcpPackages(socket.sentPayloads(), modules.decodeGmcpWireFrame);
  assert.deepEqual(
    packages.map((item) => item.packageName),
    ["Core.Hello", "Core.Supports.Set", "Darkwind.Client.Subscriptions"],
  );
  assert.equal(packages[2]?.data?.reason, "login");

  socket.clearSent();
  socket.close(1006, "lost");
  harness.advance(1000);
  harness.session.connect();
  harness.latestSocket()?.open();

  packages = decodeSentGmcpPackages(harness.latestSocket().sentPayloads(), modules.decodeGmcpWireFrame);
  assert.deepEqual(
    packages.map((item) => item.packageName),
    ["Core.Hello", "Core.Supports.Set", "Darkwind.Client.Subscriptions"],
  );
  assert.equal(packages[2]?.data?.reason, "reconnect");
});

test("handshake guard resends handshake packages", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);
  const harness = createSessionHarness(modules, t, graph, graph.characterAId);

  harness.advance(1000);
  harness.session.connect();
  const socket = harness.latestSocket();
  socket?.open();
  socket?.emitMessage("login prompt");
  socket.clearSent();

  harness.advance(modules.HANDSHAKE_RESEND_DELAY_MS);

  const packages = decodeSentGmcpPackages(socket.sentPayloads(), modules.decodeGmcpWireFrame);
  assert.deepEqual(
    packages.map((item) => item.packageName),
    ["Core.Hello", "Core.Supports.Set", "Darkwind.Client.Subscriptions"],
  );
});

test("lost-transmission recovery restarts handshake after delay and cancels on dispose", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);
  const harness = createSessionHarness(modules, t, graph, graph.characterAId);

  harness.session.connect();
  const socket = harness.latestSocket();
  socket?.open();
  socket.clearSent();

  socket.emitMessage("*** Text lost in transmission ***");
  harness.advance(modules.LOST_TRANSMISSION_RECOVERY_DELAY_MS - 1);
  assert.equal(socket.sentPayloads().length, 0);

  harness.advance(1);
  const packages = decodeSentGmcpPackages(socket.sentPayloads(), modules.decodeGmcpWireFrame);
  assert.ok(packages.some((item) => item.packageName === "Core.Hello"));
  assert.ok(packages.some((item) => item.data?.reason === "lost-transmission"));

  FakeWebSocket.reset();
  const cancelHarness = createSessionHarness(modules, t, graph, graph.characterBId);
  cancelHarness.session.connect();
  const cancelSocket = cancelHarness.latestSocket();
  cancelSocket?.open();
  cancelSocket?.emitMessage("*** Text lost in transmission ***");
  cancelHarness.session.dispose();
  cancelSocket.clearSent();
  harness.advance(modules.LOST_TRANSMISSION_RECOVERY_DELAY_MS);
  assert.equal(cancelSocket.sentPayloads().length, 0);
});

test("Char.Vitals receipt drives isLoggedIntoCharacter through composition", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);
  const harness = createSessionHarness(modules, t, graph, graph.characterAId, { autoReconnect: false });

  harness.session.connect();
  const socket = harness.latestSocket();
  socket?.open();

  assert.equal(harness.session.getRuntimeSnapshot().isLoggedIntoCharacter, false);

  const encoder = new TextEncoder();
  socket.emitMessage(
    encoder.encode('Char.Vitals {"hp":100,"mhp":100,"mana":50,"mmana":50,"move":100,"mmove":100}'),
  );
  assert.equal(harness.session.getRuntimeSnapshot().isLoggedIntoCharacter, true);

  socket.close(1000, "reset");
  harness.session.connect();
  harness.latestSocket()?.open();
  assert.equal(harness.session.getRuntimeSnapshot().isLoggedIntoCharacter, false);
});

test("effective configuration updates live without cross-session leakage", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  const graph = buildMinimalGraph(modules);
  const factory = createSequentialUuidFactory("40000000-0000-4000-8000-");
  const aliasSetId = modules.createConfigSetId(factory);

  graph.state.configurationSets[aliasSetId] = {
    id: aliasSetId,
    kind: "aliases",
    label: "Shared aliases",
    revision: 1,
    definitions: [
      {
        id: "alias-shared",
        enabled: true,
        trigger: "score",
        description: "Shared alias",
        group: "",
        isRegex: false,
        ignoreCase: true,
        steps: [{ type: "send_command", template: "score v1" }],
      },
    ],
  };
  graph.state.characterProfiles[graph.characterAId].configSetRefs.aliases = [aliasSetId];

  const harnessA = createSessionHarness(modules, t, graph, graph.characterAId);
  const harnessB = createSessionHarness(modules, t, graph, graph.characterBId);

  assert.equal(harnessA.session.getEffectiveConfiguration().aliases[0]?.definition.steps[0].template, "score v1");
  assert.equal(harnessB.session.getEffectiveConfiguration().aliases.length, 0);

  const storage = createMemoryStorage();
  modules.repositoryCommit(storage, graph.state);

  const published = modules.publishConfigurationSet(storage, {
    configSetId: aliasSetId,
    expectedRevision: 1,
    definitions: [
      {
        id: "alias-shared",
        enabled: true,
        trigger: "score",
        description: "Shared alias",
        group: "",
        isRegex: false,
        ignoreCase: true,
        steps: [{ type: "send_command", template: "score v2" }],
      },
    ],
  });
  assert.equal(published.success, true);
  assert.equal(
    harnessA.session.getEffectiveConfiguration().aliases[0]?.definition.steps[0].template,
    "score v2",
  );
  assert.equal(harnessB.session.getEffectiveConfiguration().aliases.length, 0);

  harnessA.session.dispose();
  const afterDispose = modules.publishConfigurationSet(storage, {
    configSetId: aliasSetId,
    expectedRevision: 2,
    definitions: [
      {
        id: "alias-shared",
        enabled: true,
        trigger: "score",
        description: "Shared alias",
        group: "",
        isRegex: false,
        ignoreCase: true,
        steps: [{ type: "send_command", template: "score v3" }],
      },
    ],
  });
  assert.equal(afterDispose.success, true);
});

test("dispose is idempotent across lifecycle states", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);

  const neverConnected = createSessionHarness(modules, t, graph, graph.characterAId);
  neverConnected.session.dispose();
  neverConnected.session.dispose();

  const connecting = createSessionHarness(modules, t, graph, graph.characterBId);
  connecting.session.connect();
  connecting.session.dispose();
  connecting.session.dispose();

  const connected = createSessionHarness(modules, t, graph, graph.characterAId);
  connected.session.connect();
  connected.latestSocket()?.open();
  connected.session.dispose();
  connected.session.dispose();

  const disconnected = createSessionHarness(modules, t, graph, graph.characterBId);
  disconnected.session.connect();
  disconnected.latestSocket()?.open();
  disconnected.session.disconnect();
  disconnected.session.dispose();
  disconnected.session.dispose();
});

test("disconnect leaves session reusable for a later connect", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);
  const harness = createSessionHarness(modules, t, graph, graph.characterAId);

  harness.session.connect();
  harness.latestSocket()?.open();
  harness.session.disconnect();
  assert.equal(harness.session.disposed, false);

  harness.session.connect();
  harness.latestSocket()?.open();
  assert.equal(harness.session.getHealthSnapshot().readyStateName, "open");
});

test("gmcp frame dispatch works immediately after socket open", async (t) => {
  const modules = await loadSessionRuntimeModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const graph = buildMinimalGraph(modules);
  const harness = createSessionHarness(modules, t, graph, graph.characterAId);

  harness.session.connect();
  const socket = harness.latestSocket();
  socket?.open();

  const encoder = new TextEncoder();
  socket.emitMessage(
    encoder.encode('Char.Vitals {"hp":1,"mhp":1,"mana":1,"mmana":1,"move":1,"mmove":1}'),
  );
  assert.equal(harness.session.getRuntimeSnapshot().isLoggedIntoCharacter, true);
});
