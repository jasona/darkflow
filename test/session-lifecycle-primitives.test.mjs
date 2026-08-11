import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Vite SSR fixture shared by every session lifecycle primitive test. */
async function loadRuntimeModules(t) {
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

  const [ids, diagnosticsModule, resourceScopeModule, eventBusModule] = await Promise.all([
    ssr.runner.import("/model/ids.ts"),
    ssr.runner.import("/runtime/diagnostics.ts"),
    ssr.runner.import("/runtime/resource-scope.ts"),
    ssr.runner.import("/runtime/event-bus.ts"),
  ]);

  const factory = ids.createSequentialUuidFactory();
  const sessionId = ids.createSessionId(factory);
  const otherSessionId = ids.createSessionId(factory);

  return {
    ids,
    sessionId,
    otherSessionId,
    SessionDiagnostics: diagnosticsModule.SessionDiagnostics,
    createResourceScope: resourceScopeModule.createResourceScope,
    createSessionEventBus: eventBusModule.createSessionEventBus,
  };
}

test("SessionDiagnostics tracks all resource kinds and event counters independently", async (t) => {
  const { sessionId, SessionDiagnostics } = await loadRuntimeModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);

  const kinds = [
    "timer",
    "animationFrame",
    "subscription",
    "observer",
    "listener",
    "childScope",
    "socket",
    "teardown",
  ];

  for (const kind of kinds) {
    diagnostics.trackAcquire(kind);
  }

  let snapshot = diagnostics.snapshot();
  assert.equal(snapshot.sessionId, sessionId);
  assert.equal(snapshot.liveTimers, 1);
  assert.equal(snapshot.liveAnimationFrames, 1);
  assert.equal(snapshot.liveSubscriptions, 1);
  assert.equal(snapshot.liveObservers, 1);
  assert.equal(snapshot.liveListeners, 1);
  assert.equal(snapshot.liveChildScopes, 1);
  assert.equal(snapshot.liveSockets, 1);
  assert.equal(snapshot.liveTeardowns, 1);
  assert.equal(snapshot.duplicateDisposals, 0);
  assert.equal(snapshot.rejectedResources, 0);
  assert.equal(snapshot.handlerFailures, 0);
  assert.equal(snapshot.suppressedEvents, 0);
  assert.equal(snapshot.misroutedEvents, 0);

  for (const kind of [...kinds].reverse()) {
    diagnostics.trackRelease(kind);
  }

  snapshot = diagnostics.snapshot();
  assert.equal(snapshot.liveTimers, 0);
  assert.equal(snapshot.liveAnimationFrames, 0);
  assert.equal(snapshot.liveSubscriptions, 0);
  assert.equal(snapshot.liveObservers, 0);
  assert.equal(snapshot.liveListeners, 0);
  assert.equal(snapshot.liveChildScopes, 0);
  assert.equal(snapshot.liveSockets, 0);
  assert.equal(snapshot.liveTeardowns, 0);

  diagnostics.recordDuplicateDisposal();
  diagnostics.recordRejectedResource();
  diagnostics.recordHandlerFailure();
  diagnostics.recordSuppressedEvent();
  diagnostics.recordMisroutedEvent();

  snapshot = diagnostics.snapshot();
  assert.equal(snapshot.duplicateDisposals, 1);
  assert.equal(snapshot.rejectedResources, 1);
  assert.equal(snapshot.handlerFailures, 1);
  assert.equal(snapshot.suppressedEvents, 1);
  assert.equal(snapshot.misroutedEvents, 1);
});

test("ResourceScope disposes resources in reverse registration order", async (t) => {
  const { sessionId, SessionDiagnostics, createResourceScope } = await loadRuntimeModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const scope = createResourceScope(sessionId, diagnostics);
  const order = [];

  scope.setTimeout(() => order.push("timer-fired"), 10);
  scope.own("listener", () => order.push("listener"));
  scope.own("socket", () => order.push("socket"));
  const child = scope.createChildScope();
  child.own("teardown", () => order.push("child-teardown"));
  scope.own("teardown", () => order.push("teardown"));

  scope.dispose();

  assert.deepEqual(order, ["teardown", "child-teardown", "socket", "listener"]);
  assert.equal(diagnostics.snapshot().liveTimers, 0);
  assert.equal(diagnostics.snapshot().duplicateDisposals, 0);

  scope.dispose();
  assert.equal(diagnostics.snapshot().duplicateDisposals, 1);
});

test("ResourceScope isolates throwing disposers and rejects post-dispose registrations", async (t) => {
  const { sessionId, SessionDiagnostics, createResourceScope } = await loadRuntimeModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const scope = createResourceScope(sessionId, diagnostics);
  const order = [];

  scope.own("teardown", () => {
    order.push("first");
    throw new Error("teardown failed");
  });
  scope.own("listener", () => order.push("second"));

  scope.dispose();
  assert.deepEqual(order, ["second", "first"]);
  assert.equal(diagnostics.snapshot().handlerFailures, 1);

  let ownedAfterDispose = 0;
  scope.own("subscription", () => {
    ownedAfterDispose += 1;
  });
  scope.setTimeout(() => {}, 10);
  scope.setInterval(() => {}, 10);
  scope.requestAnimationFrame(() => {});

  const snapshot = diagnostics.snapshot();
  assert.equal(ownedAfterDispose, 1);
  assert.equal(snapshot.rejectedResources, 4);
  assert.equal(snapshot.liveSubscriptions, 0);
  assert.equal(snapshot.liveTimers, 0);
  assert.equal(snapshot.liveAnimationFrames, 0);
});

test("ResourceScope cancels pending timers and RAF callbacks before they fire", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });

  const { sessionId, SessionDiagnostics, createResourceScope } = await loadRuntimeModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const scope = createResourceScope(sessionId, diagnostics);
  let timerFired = 0;
  let rafFired = 0;

  scope.setTimeout(() => {
    timerFired += 1;
  }, 50);
  scope.requestAnimationFrame(() => {
    rafFired += 1;
  });

  scope.dispose();
  t.mock.timers.tick(100);

  assert.equal(timerFired, 0);
  assert.equal(rafFired, 0);
  assert.equal(diagnostics.snapshot().liveTimers, 0);
  assert.equal(diagnostics.snapshot().liveAnimationFrames, 0);
});

test("ResourceScope child scopes keep parent diagnostics accurate over time", async (t) => {
  const { sessionId, SessionDiagnostics, createResourceScope } = await loadRuntimeModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const parent = createResourceScope(sessionId, diagnostics);

  const childA = parent.createChildScope();
  assert.equal(diagnostics.snapshot().liveChildScopes, 1);

  childA.dispose();
  assert.equal(diagnostics.snapshot().liveChildScopes, 0);

  const childB = parent.createChildScope();
  assert.equal(diagnostics.snapshot().liveChildScopes, 1);

  parent.dispose();
  assert.equal(childB.disposed, true);
  assert.equal(diagnostics.snapshot().liveChildScopes, 0);

  const childC = parent.createChildScope();
  assert.equal(childC.disposed, true);
  assert.equal(diagnostics.snapshot().rejectedResources, 1);
});

test("SessionEventBus stamps publish envelopes and rejects misrouted dispatch", async (t) => {
  const { sessionId, otherSessionId, SessionDiagnostics, createSessionEventBus } =
    await loadRuntimeModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const bus = createSessionEventBus(sessionId, diagnostics);
  const received = [];

  bus.subscribe("connection.open", (event) => {
    received.push(event);
  });

  bus.publish("connection.open", { transport: "wss" });
  assert.equal(received.length, 1);
  assert.equal(received[0].sessionId, sessionId);
  assert.equal(received[0].type, "connection.open");
  assert.deepEqual(received[0].payload, { transport: "wss" });

  bus.dispatch({
    sessionId: otherSessionId,
    type: "connection.open",
    payload: { transport: "ws" },
  });
  assert.equal(received.length, 1);
  assert.equal(diagnostics.snapshot().misroutedEvents, 1);
});

test("SessionEventBus isolates handler failures and snapshot delivery", async (t) => {
  const { sessionId, SessionDiagnostics, createSessionEventBus } = await loadRuntimeModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const bus = createSessionEventBus(sessionId, diagnostics);
  const order = [];
  let unsubscribeB = () => {};

  const unsubscribeA = bus.subscribe("gmcp.frame", () => {
    order.push("a");
    unsubscribeB();
  });
  unsubscribeB = bus.subscribe("gmcp.frame", () => {
    order.push("b");
    throw new Error("handler failed");
  });
  bus.subscribe("gmcp.frame", () => {
    order.push("c");
  });
  void unsubscribeA;

  bus.publish("gmcp.frame", { packageName: "Core.Ping" });
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.equal(diagnostics.snapshot().handlerFailures, 1);

  order.length = 0;
  bus.publish("gmcp.frame", { packageName: "Core.Pong" });
  assert.deepEqual(order, ["a", "c"]);
});

test("SessionEventBus is idempotent and silent after dispose", async (t) => {
  const { sessionId, SessionDiagnostics, createSessionEventBus } = await loadRuntimeModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const bus = createSessionEventBus(sessionId, diagnostics);
  let deliveries = 0;

  bus.subscribe("session.end", () => {
    deliveries += 1;
  });

  bus.dispose();
  bus.dispose();
  assert.equal(diagnostics.snapshot().duplicateDisposals, 1);

  bus.subscribe("session.end", () => {
    deliveries += 1;
  });
  bus.publish("session.end", {});
  bus.dispatch({ sessionId, type: "session.end", payload: {} });

  assert.equal(deliveries, 0);
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.rejectedResources, 1);
  assert.equal(snapshot.suppressedEvents, 2);
});
