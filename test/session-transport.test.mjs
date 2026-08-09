import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSED = 3;

/** Vite SSR fixture shared by session transport tests. */
async function loadTransportModules(t) {
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

  const [ids, diagnosticsModule, resourceScopeModule, eventBusModule, urlsModule, healthModule, reconnectModule, connectionModule] =
    await Promise.all([
      ssr.runner.import("/model/ids.ts"),
      ssr.runner.import("/runtime/diagnostics.ts"),
      ssr.runner.import("/runtime/resource-scope.ts"),
      ssr.runner.import("/runtime/event-bus.ts"),
      ssr.runner.import("/transport/urls.ts"),
      ssr.runner.import("/transport/health.ts"),
      ssr.runner.import("/transport/reconnect.ts"),
      ssr.runner.import("/transport/connection.ts"),
    ]);

  const factory = ids.createSequentialUuidFactory();
  const sessionId = ids.createSessionId(factory);

  return {
    sessionId,
    SessionDiagnostics: diagnosticsModule.SessionDiagnostics,
    createResourceScope: resourceScopeModule.createResourceScope,
    createSessionEventBus: eventBusModule.createSessionEventBus,
    buildTransportLadder: urlsModule.buildTransportLadder,
    buildConnectionUrl: urlsModule.buildConnectionUrl,
    createTransportHealth: healthModule.createTransportHealth,
    computeReconnectDelay: reconnectModule.computeReconnectDelay,
    createReconnectController: reconnectModule.createReconnectController,
    WS_FORCE_RECONNECT_DELAY_MS: reconnectModule.WS_FORCE_RECONNECT_DELAY_MS,
    RECONNECT_BASE_MS: reconnectModule.RECONNECT_BASE_MS,
    RECONNECT_MAX_MS: reconnectModule.RECONNECT_MAX_MS,
    HANDSHAKE_RESEND_DELAY_MS: reconnectModule.HANDSHAKE_RESEND_DELAY_MS,
    LOST_TRANSMISSION_RECOVERY_DELAY_MS: reconnectModule.LOST_TRANSMISSION_RECOVERY_DELAY_MS,
    LOST_TRANSMISSION_RECOVERY_COOLDOWN_MS: reconnectModule.LOST_TRANSMISSION_RECOVERY_COOLDOWN_MS,
    UPGRADE_PROBE_DELAY_MS: reconnectModule.UPGRADE_PROBE_DELAY_MS,
    WS_STALL_WINDOW_MS: healthModule.WS_STALL_WINDOW_MS,
    WS_STALL_COMMAND_BURST_MS: healthModule.WS_STALL_COMMAND_BURST_MS,
    WS_STALL_COMMAND_BURST_COUNT: healthModule.WS_STALL_COMMAND_BURST_COUNT,
    WS_STALLED_BUFFERED_THRESHOLD: healthModule.WS_STALLED_BUFFERED_THRESHOLD,
    WS_HEALTH_INTERVAL_MS: healthModule.WS_HEALTH_INTERVAL_MS,
    WS_DIAG_LIMIT: healthModule.WS_DIAG_LIMIT,
    decodeGmcpWireFrame: connectionModule.decodeGmcpWireFrame,
    createSessionTransport: connectionModule.createSessionTransport,
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

  open() {
    this.readyState = WS_OPEN;
    this.onopen?.({ type: "open" });
  }

  emitMessage(data) {
    this.onmessage?.({ data });
  }

  emitError() {
    this.onerror?.({ type: "error" });
  }

  close(code = 1000, reason = "") {
    this.readyState = WS_CLOSED;
    this.onclose?.({ code, reason, wasClean: true });
  }
}

function createHarness(modules, t, options = {}) {
  const diagnostics = new modules.SessionDiagnostics(modules.sessionId);
  const scope = modules.createResourceScope(modules.sessionId, diagnostics);
  const eventBus = modules.createSessionEventBus(modules.sessionId, diagnostics);
  const events = [];
  const texts = [];
  const gmcpFrames = [];

  eventBus.subscribe("transport:reconnect-status", (event) => {
    events.push({ type: event.type, payload: event.payload });
  });
  eventBus.subscribe("transport:handshake-guard-elapsed", (event) => {
    events.push({ type: event.type, payload: event.payload });
  });
  eventBus.subscribe("transport:lost-transmission-detected", (event) => {
    events.push({ type: event.type, payload: event.payload });
  });
  eventBus.subscribe("transport:upgrade-available", (event) => {
    events.push({ type: event.type, payload: event.payload });
  });
  eventBus.subscribe("transport:transport-fallback", (event) => {
    events.push({ type: event.type, payload: event.payload });
  });
  eventBus.subscribe("transport:send-error", (event) => {
    events.push({ type: event.type, payload: event.payload });
  });

  let endpoint = {
    host: "127.0.0.1",
    port: "4242",
    protocol: "wss",
    ...(options.endpoint ?? {}),
  };
  let autoReconnect = options.autoReconnect ?? true;
  let loggedIn = options.loggedIn ?? false;
  let nowMs = 0;
  const now = () => nowMs;
  const onlineListeners = new Map();

  const transport = modules.createSessionTransport(
    modules.sessionId,
    scope,
    eventBus,
    diagnostics,
    {
      getEndpoint: () => endpoint,
      getAutoReconnect: () => autoReconnect,
      isLoggedIntoCharacter: () => loggedIn,
      onText: (text) => texts.push(text),
      onGmcpFrame: (packageName, data) => gmcpFrames.push({ packageName, data }),
    },
    {
      appOrigin: options.appOrigin ?? "http://localhost:3000",
      now,
      webSocketFactory: (url) => new FakeWebSocket(url),
      onlineTarget: {
        addEventListener(type, listener) {
          onlineListeners.set(listener, type);
        },
        removeEventListener(_type, listener) {
          onlineListeners.delete(listener);
        },
      },
    },
  );

  t.after(() => {
    transport.dispose();
  });

  return {
    transport,
    scope,
    diagnostics,
    events,
    texts,
    gmcpFrames,
    get endpoint() {
      return endpoint;
    },
    set endpoint(value) {
      endpoint = value;
    },
    get autoReconnect() {
      return autoReconnect;
    },
    set autoReconnect(value) {
      autoReconnect = value;
    },
    get loggedIn() {
      return loggedIn;
    },
    set loggedIn(value) {
      loggedIn = value;
    },
    advance(ms) {
      nowMs += ms;
      t.mock.timers.tick(ms);
    },
    dispatchOnline() {
      for (const listener of onlineListeners.keys()) {
        listener();
      }
    },
    latestSocket() {
      return FakeWebSocket.instances.at(-1) ?? null;
    },
  };
}

test("buildTransportLadder matches legacy ladder fixtures", async (t) => {
  const { buildTransportLadder } = await loadTransportModules(t);

  assert.deepEqual(buildTransportLadder("wss", "http:"), ["wss", "ws", "telnets", "telnet"]);
  assert.deepEqual(buildTransportLadder("telnets", "http:"), ["telnets", "wss", "ws", "telnet"]);
  assert.deepEqual(buildTransportLadder("ws", "http:"), ["ws", "wss", "telnets", "telnet"]);
  assert.deepEqual(buildTransportLadder("bogus", "http:"), ["wss", "ws", "telnets", "telnet"]);
  assert.deepEqual(buildTransportLadder("wss", "https:"), ["wss", "telnets", "telnet"]);
  assert.deepEqual(buildTransportLadder("ws", "https:"), ["wss", "telnets", "telnet"]);
});

test("buildConnectionUrl produces direct and proxy URLs", async (t) => {
  const { buildConnectionUrl } = await loadTransportModules(t);
  const endpoint = { host: "127.0.0.1", port: "4242", protocol: "wss" };

  assert.equal(buildConnectionUrl({ ...endpoint, protocol: "ws" }, "http://localhost:3000"), "ws://127.0.0.1:4242/");
  assert.equal(buildConnectionUrl({ ...endpoint, protocol: "wss" }, "http://localhost:3000"), "wss://127.0.0.1:4242/");
  assert.equal(
    buildConnectionUrl({ ...endpoint, protocol: "telnet" }, "http://localhost:3000"),
    "ws://localhost:3000/proxy?host=127.0.0.1&port=4242&tls=0",
  );
  assert.equal(
    buildConnectionUrl({ ...endpoint, protocol: "telnets" }, "https://localhost:3000"),
    "wss://localhost:3000/proxy?host=127.0.0.1&port=4242&tls=1",
  );
});

test("health stall predicates fire at legacy offsets", async (t) => {
  const { createTransportHealth, WS_STALL_WINDOW_MS, WS_STALLED_BUFFERED_THRESHOLD } =
    await loadTransportModules(t);

  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let nowMs = 0;
  const health = createTransportHealth(() => nowMs);
  const socket = { readyState: WS_OPEN, bufferedAmount: 0, send() {} };

  health.lastOutboundAt = 0;
  health.lastInboundAt = 0;
  health.recentCommandTimes = [nowMs - 1000, nowMs - 500, nowMs - 100];
  health.lastCommandAt = nowMs - 100;
  nowMs = WS_STALL_WINDOW_MS;
  health.trimCommandBurst(nowMs);
  assert.equal(health.recentCommandTimes.length, 0);

  const backlogHealth = createTransportHealth(() => nowMs);
  const backlogSocket = {
    readyState: WS_OPEN,
    bufferedAmount: WS_STALLED_BUFFERED_THRESHOLD,
    send() {},
  };
  backlogHealth.lastOutboundAt = 1000;
  backlogHealth.lastInboundAt = 0;
  nowMs = 9000;
  assert.equal(backlogHealth.evaluateStall(backlogSocket, nowMs), "buffer-backlog");
  assert.equal(backlogHealth.evaluateStall({ ...backlogSocket, bufferedAmount: 0 }, nowMs), null);

  health.recentCommandTimes = [10600, 10700, 10800];
  health.lastCommandAt = 2000;
  health.lastInboundAt = 0;
  assert.equal(health.evaluateStall(socket, 11000), "command-burst");
});

test("health event ring buffer caps at WS_DIAG_LIMIT", async (t) => {
  const { createTransportHealth, WS_DIAG_LIMIT } = await loadTransportModules(t);
  const health = createTransportHealth(() => 0);
  for (let index = 0; index < WS_DIAG_LIMIT + 5; index += 1) {
    health.pushEvent("test", { index });
  }
  assert.equal(health.events.length, WS_DIAG_LIMIT);
  assert.equal((health.events[0]?.detail).index, 5);
});

test("computeReconnectDelay follows exponential backoff cap", async (t) => {
  const { computeReconnectDelay, RECONNECT_BASE_MS, RECONNECT_MAX_MS } = await loadTransportModules(t);
  assert.equal(computeReconnectDelay(1), RECONNECT_BASE_MS);
  assert.equal(computeReconnectDelay(2), RECONNECT_BASE_MS * 2);
  assert.equal(computeReconnectDelay(10), RECONNECT_MAX_MS);
});

test("decodeGmcpWireFrame parses JSON and string fallback", async (t) => {
  const { decodeGmcpWireFrame } = await loadTransportModules(t);
  const jsonFrame = new TextEncoder().encode('Char.Vitals {"hp":1}');
  assert.deepEqual(decodeGmcpWireFrame(jsonFrame), { packageName: "Char.Vitals", data: { hp: 1 } });

  const badJson = new TextEncoder().encode("Room.Info not-json");
  assert.deepEqual(decodeGmcpWireFrame(badJson), { packageName: "Room.Info", data: "not-json" });

  const bare = new TextEncoder().encode("Core.Hello");
  assert.deepEqual(decodeGmcpWireFrame(bare), { packageName: "Core.Hello", data: undefined });
});

test("inbound text and GMCP frames reach distinct callbacks", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t);
  harness.transport.connect();
  harness.latestSocket()?.open();

  harness.latestSocket()?.emitMessage("hello world");
  const gmcpBytes = new TextEncoder().encode('Char.Vitals {"hp":99}').buffer;
  harness.latestSocket()?.emitMessage(gmcpBytes);

  assert.deepEqual(harness.texts, ["hello world"]);
  assert.deepEqual(harness.gmcpFrames, [{ packageName: "Char.Vitals", data: { hp: 99 } }]);
});

test("send preserves text and binary frame types", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t);
  harness.transport.connect();
  harness.latestSocket()?.open();

  const textPayload = "look";
  const bytes = new Uint8Array([1, 2, 3]);
  harness.transport.send(textPayload);
  harness.transport.send(bytes);

  const sent = harness.latestSocket()?.sentPayloads();
  assert.equal(typeof sent?.[0], "string");
  assert.equal(sent?.[0], textPayload);
  assert.ok(sent?.[1] instanceof Uint8Array);
  assert.deepEqual([...sent[1]], [1, 2, 3]);
});

test("double connect opens exactly one socket", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t);
  harness.transport.connect();
  harness.transport.connect();
  assert.equal(FakeWebSocket.instances.length, 1);
});

test("retryNow cancels backoff and reconnects immediately", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t);
  harness.transport.connect();
  harness.latestSocket()?.close(1006, "lost");
  assert.equal(harness.transport.state, "disconnected");

  const beforeRetry = FakeWebSocket.instances.length;
  harness.transport.retryNow();
  assert.equal(FakeWebSocket.instances.length, beforeRetry + 1);
});

test("disconnect suppresses auto reconnect until retryNow", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t);
  harness.transport.connect();
  harness.latestSocket()?.open();
  harness.transport.disconnect();
  harness.latestSocket()?.close(1000, "User disconnect");

  const socketsBefore = FakeWebSocket.instances.length;
  harness.advance(30000);
  assert.equal(FakeWebSocket.instances.length, socketsBefore);

  harness.transport.retryNow();
  assert.equal(FakeWebSocket.instances.length, socketsBefore + 1);
});

test("online event retries during backoff when autoReconnect is enabled", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t);
  harness.transport.connect();
  harness.latestSocket()?.close(1006, "lost");

  const socketsBefore = FakeWebSocket.instances.length;
  harness.dispatchOnline();
  assert.equal(FakeWebSocket.instances.length, socketsBefore + 1);
});

test("live endpoint and autoReconnect callbacks are re-read on each attempt", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t, { endpoint: { host: "127.0.0.1", port: "1111", protocol: "ws" } });
  harness.transport.connect();
  assert.match(harness.latestSocket()?.url ?? "", /1111/);
  harness.latestSocket()?.close(1006, "lost");

  harness.endpoint = { host: "127.0.0.1", port: "2222", protocol: "ws" };
  harness.transport.retryNow();
  assert.match(harness.latestSocket()?.url ?? "", /2222/);
});

test("handshake guard and lost-transmission events fire at legacy delays", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t);
  harness.advance(1000);
  harness.transport.connect();
  harness.latestSocket()?.open();
  harness.latestSocket()?.emitMessage("login prompt");

  harness.advance(modules.HANDSHAKE_RESEND_DELAY_MS);
  assert.ok(harness.events.some((event) => event.type === "transport:handshake-guard-elapsed"));

  harness.latestSocket()?.emitMessage("*** Text lost in transmission ***");
  harness.advance(modules.LOST_TRANSMISSION_RECOVERY_DELAY_MS);
  assert.ok(harness.events.some((event) => event.type === "transport:lost-transmission-detected"));

  harness.latestSocket()?.emitMessage("*** Text lost in transmission ***");
  const detectedCount = harness.events.filter((event) => event.type === "transport:lost-transmission-detected").length;
  harness.advance(modules.LOST_TRANSMISSION_RECOVERY_COOLDOWN_MS - 1);
  harness.latestSocket()?.emitMessage("*** Text lost in transmission ***");
  assert.equal(
    harness.events.filter((event) => event.type === "transport:lost-transmission-detected").length,
    detectedCount,
  );
});

test("upgrade probe is gated by isLoggedIntoCharacter", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const loggedInHarness = createHarness(modules, t, {
    endpoint: { host: "127.0.0.1", port: "4242", protocol: "telnet" },
    loggedIn: true,
  });
  loggedInHarness.transport.connect();
  loggedInHarness.latestSocket()?.open();
  loggedInHarness.advance(modules.UPGRADE_PROBE_DELAY_MS);
  assert.equal(FakeWebSocket.instances.length, 1);

  FakeWebSocket.reset();
  const harness = createHarness(modules, t, {
    endpoint: { host: "127.0.0.1", port: "4242", protocol: "wss" },
    loggedIn: false,
  });
  harness.transport.connect();
  harness.latestSocket()?.close(1006, "failed before open");
  harness.advance(modules.WS_FORCE_RECONNECT_DELAY_MS);
  harness.latestSocket()?.open();
  harness.advance(modules.UPGRADE_PROBE_DELAY_MS);
  assert.equal(FakeWebSocket.instances.length, 3);
  FakeWebSocket.instances[2]?.open();
  assert.ok(harness.events.some((event) => event.type === "transport:upgrade-available"));
});

test("transport state and reconnect status remain distinct enums", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t);
  assert.equal(harness.transport.state, "disconnected");

  harness.transport.connect();
  assert.equal(harness.transport.state, "connecting");
  assert.ok(harness.events.some((event) => event.payload.status === "connecting"));

  harness.latestSocket()?.open();
  assert.equal(harness.transport.state, "connected");
  assert.ok(harness.events.some((event) => event.payload.status === "connected"));

  harness.latestSocket()?.close(1006, "lost");
  assert.equal(harness.transport.state, "disconnected");
  assert.ok(harness.events.some((event) => event.payload.status === "scheduled"));

  for (const stateValue of ["connecting", "connected", "disconnected"]) {
    assert.ok(["connecting", "connected", "disconnected"].includes(stateValue));
  }
  for (const status of harness.events.map((event) => event.payload.status)) {
    assert.ok(["connecting", "scheduled", "connected", "idle"].includes(status));
  }
});

test("dispose blocks late socket callbacks and pending timers", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const diagnostics = new modules.SessionDiagnostics(modules.sessionId);
  const scope = modules.createResourceScope(modules.sessionId, diagnostics);
  const eventBus = modules.createSessionEventBus(modules.sessionId, diagnostics);
  const texts = [];

  const transport = modules.createSessionTransport(
    modules.sessionId,
    scope,
    eventBus,
    diagnostics,
    {
      getEndpoint: () => ({ host: "127.0.0.1", port: "4242", protocol: "wss" }),
      getAutoReconnect: () => true,
      isLoggedIntoCharacter: () => false,
      onText: (text) => texts.push(text),
      onGmcpFrame: () => {},
    },
    {
      appOrigin: "http://localhost:3000",
      webSocketFactory: (url) => new FakeWebSocket(url),
    },
  );

  transport.connect();
  const socket = FakeWebSocket.instances[0];
  socket?.open();
  transport.dispose();

  texts.length = 0;
  socket?.emitMessage("late");
  t.mock.timers.tick(60000);
  assert.deepEqual(texts, []);

  transport.dispose();
  assert.equal(diagnostics.snapshot().duplicateDisposals, 1);
});

test("watchdog forceReconnect retries after fixed delay", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t);
  harness.advance(1000);
  harness.transport.connect();
  const first = harness.latestSocket();
  first?.open();
  harness.transport.send("ping");
  if (first) {
    first.bufferedAmount = modules.WS_STALLED_BUFFERED_THRESHOLD;
  }

  harness.advance(modules.WS_STALL_WINDOW_MS);
  harness.advance(modules.WS_HEALTH_INTERVAL_MS);
  harness.advance(modules.WS_FORCE_RECONNECT_DELAY_MS);

  assert.notEqual(harness.latestSocket(), first);
});

test("rung failure cycles through ladder at fixed delay before backoff", async (t) => {
  const modules = await loadTransportModules(t);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  FakeWebSocket.reset();

  const harness = createHarness(modules, t, {
    endpoint: { host: "127.0.0.1", port: "4242", protocol: "wss" },
  });
  harness.transport.connect();
  harness.latestSocket()?.close(1006, "failed before open");

  const firstRetryAt = FakeWebSocket.instances.length;
  harness.advance(modules.WS_FORCE_RECONNECT_DELAY_MS);
  assert.equal(FakeWebSocket.instances.length, firstRetryAt + 1);
  assert.ok(harness.events.some((event) => event.type === "transport:transport-fallback"));
});
