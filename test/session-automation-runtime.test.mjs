import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const automationCompatPath = path.join(repoRoot, "public/js/session-compat/automation.js");

class CustomEventMock {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
    snapshot() {
      return new Map(values);
    },
  };
}

function createThrowingDom() {
  const throwOnRead = () => {
    throw new Error("dom must not be read when bridge is active");
  };
  return {
    host: { get value() { throwOnRead(); } },
    port: { get value() { throwOnRead(); } },
    protocolSelect: { get value() { throwOnRead(); } },
  };
}

function createLegacyDom(scope = { host: "test", port: "4242", protocol: "ws" }) {
  return {
    host: { value: scope.host },
    port: { value: scope.port },
    protocolSelect: { value: scope.protocol },
  };
}

const dispatchedEvents = [];
globalThis.CustomEvent = CustomEventMock;
globalThis.window = {
  dispatchEvent(event) {
    dispatchedEvents.push(event);
  },
};
globalThis.requestAnimationFrame = (callback) => {
  callback(0);
  return 0;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  createElement() {
    return {
      className: "",
      style: {},
      dataset: {},
      appendChild() {},
      addEventListener() {},
    };
  },
  createTextNode(text) {
    return { textContent: String(text || "") };
  },
};

const localStorage = createLocalStorage();
globalThis.localStorage = localStorage;

const { dom } = await import("../public/js/state.js");
const { aliasManager } = await import("../public/js/alias-manager.js");
const { triggerManager } = await import("../public/js/trigger-manager.js");
const { timerManager } = await import("../public/js/timer-manager.js");
const configCompat = await import("../public/js/session-compat/configuration.js");
const automationCompat = await import("../public/js/session-compat/automation.js");
const {
  getGmcpVariables,
  registerGmcpVariables,
  resetGmcpVariables,
} = await import("../public/js/gmcp-variables.js");
const {
  executeAutomationSteps,
  executeTriggerMatches,
} = await import("../public/js/automation-executor.js");

const ALIAS_STORAGE_KEY = "darkwind-client-aliases-v1";
const TRIGGER_STORAGE_KEY = "darkwind-client-triggers-v1";
const TIMER_STORAGE_KEY = "darkwind-client-timers-v1";
const LEGACY_SCOPE_KEY = "ws://test:4242";
const PROFILE_SCOPE_KEY = "character-a";

function resetAllManagers(scopeKey = LEGACY_SCOPE_KEY) {
  configCompat.resetConfigurationCompatBridgeForTests();
  automationCompat.resetAutomationCompatBridgeForTests();
  localStorage.clear();
  dispatchedEvents.length = 0;
  dom.host = createLegacyDom().host;
  dom.port = createLegacyDom().port;
  dom.protocolSelect = createLegacyDom().protocolSelect;
  aliasManager._data = { scopes: {} };
  triggerManager._data = { scopes: {} };
  timerManager._data = { scopes: {} };
  timerManager._runtime = new Map();
  timerManager._reconciliationUnsubscribe = null;
  resetGmcpVariables();
  return scopeKey;
}

function installFakeConfigBridge(overrides = {}) {
  const listeners = [];
  const bridge = {
    activeCharacterProfileId: overrides.activeCharacterProfileId || PROFILE_SCOPE_KEY,
    definitionsByKind: overrides.definitionsByKind || {
      aliases: [],
      highlights: [],
      functions: [],
      keyMappings: [],
      triggers: [],
      timers: [],
    },
    localDefinitionsByKind: {
      aliases: [],
      highlights: [],
      functions: [],
      keyMappings: [],
      triggers: [],
      timers: [],
    },
    getActiveCharacterProfileId() {
      return bridge.activeCharacterProfileId;
    },
    getEffectiveDefinitions(kind) {
      return bridge.definitionsByKind[kind] || [];
    },
    replaceLocalDefinitions(kind, definitions) {
      bridge.localDefinitionsByKind[kind] = structuredClone(definitions);
      bridge.definitionsByKind[kind] = definitions.map((definition) => ({
        definition: structuredClone(definition),
        source: { kind: "local" },
      }));
      listeners.forEach((listener) => listener());
    },
    upsertLocalDefinitionByIdentity(kind, definition) {
      const identityKey = overrides.identityKeyFor?.(kind, definition)
        ?? String(definition.pattern || definition.name || "").trim().toLowerCase();
      const list = [...(bridge.localDefinitionsByKind[kind] || [])];
      const index = list.findIndex((item) => {
        const itemKey = overrides.identityKeyFor?.(kind, item)
          ?? String(item.pattern || item.name || "").trim().toLowerCase();
        return itemKey === identityKey;
      });
      if (index >= 0) list[index] = structuredClone(definition);
      else list.push(structuredClone(definition));
      bridge.replaceLocalDefinitions(kind, list);
    },
    removeLocalDefinitionByIdentity(kind, identityKey) {
      const before = bridge.localDefinitionsByKind[kind] || [];
      const after = before.filter((item) => {
        const itemKey = overrides.identityKeyFor?.(kind, item)
          ?? String(item.pattern || item.name || "").trim().toLowerCase();
        return itemKey !== identityKey;
      });
      if (after.length === before.length) return false;
      bridge.replaceLocalDefinitions(kind, after);
      return true;
    },
    setLocalDefinitionEnabledByIdentity(kind, identityKey, enabled) {
      const list = structuredClone(bridge.localDefinitionsByKind[kind] || []);
      const item = list.find((entry) => {
        const itemKey = overrides.identityKeyFor?.(kind, entry)
          ?? String(entry.pattern || entry.name || "").trim().toLowerCase();
        return itemKey === identityKey;
      });
      if (!item) return false;
      item.enabled = enabled !== false;
      bridge.replaceLocalDefinitions(kind, list);
      return true;
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    notifyListeners() {
      listeners.forEach((listener) => listener());
    },
    ...overrides,
  };
  configCompat.installConfigurationCompatBridge(bridge);
  return { bridge, listeners };
}

function installFakeAutomationBridgeFromRuntime(runtime) {
  automationCompat.installAutomationCompatBridge({
    getVariable: (name) => runtime.getVariable(name),
    setVariable: (name, value) => runtime.setVariable(name, value),
    removeVariable: (name) => runtime.removeVariable(name),
    listVariableNames: () => runtime.listVariableNames(),
    getAutomationVariables: () => runtime.getAutomationVariables(),
    setGmcpVariable: (packageName, data) => runtime.setGmcpVariable(packageName, data),
    resetGmcpVariables: () => runtime.resetGmcpVariables(),
    getGmcpVariables: () => runtime.getGmcpVariables(),
    listGmcpVariables: () => runtime.listGmcpVariables(),
    scheduleTimer: (timerId, durationMs, onFire) => runtime.scheduleTimer(timerId, durationMs, onFire),
    clearTimer: (timerId) => runtime.clearTimer(timerId),
    getTimerRuntimeState: (timerId) => runtime.getTimerRuntimeState(timerId),
    scheduleWait: (delayMs) => runtime.scheduleWait(delayMs),
    reconcileTimers: (effectiveTimers, onStart) => runtime.reconcileTimers(effectiveTimers, onStart),
  });
}

async function loadAutomationRuntimeModules(t) {
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

  const [ids, diagnosticsModule, resourceScopeModule, automationRuntimeModule] = await Promise.all([
    ssr.runner.import("/model/ids.ts"),
    ssr.runner.import("/runtime/diagnostics.ts"),
    ssr.runner.import("/runtime/resource-scope.ts"),
    ssr.runner.import("/runtime/automation-runtime.ts"),
  ]);

  const factory = ids.createSequentialUuidFactory();
  const sessionId = ids.createSessionId(factory);
  const otherSessionId = ids.createSessionId(factory);

  return {
    sessionId,
    otherSessionId,
    SessionDiagnostics: diagnosticsModule.SessionDiagnostics,
    createResourceScope: resourceScopeModule.createResourceScope,
    createAutomationRuntimeState: automationRuntimeModule.createAutomationRuntimeState,
  };
}

test("automation compat module has zero static client/** imports", () => {
  const source = fs.readFileSync(automationCompatPath, "utf8");
  assert.doesNotMatch(source, /\bfrom\s+['"][^'"]*client\//);
  assert.doesNotMatch(source, /\bimport\s+['"][^'"]*client\//);
});

test("automation compat bridge install, reset, and uninstalled errors", () => {
  automationCompat.resetAutomationCompatBridgeForTests();
  assert.equal(automationCompat.isAutomationCompatActive(), false);

  const fakeBridge = {
    getVariable() {},
    setVariable() { return true; },
    removeVariable() {},
    listVariableNames() { return []; },
    getAutomationVariables() { return {}; },
    setGmcpVariable() {},
    resetGmcpVariables() {},
    getGmcpVariables() { return {}; },
    listGmcpVariables() { return []; },
    scheduleTimer() {},
    clearTimer() {},
    getTimerRuntimeState() { return null; },
    scheduleWait() { return Promise.resolve(); },
    reconcileTimers() {},
  };

  automationCompat.installAutomationCompatBridge(fakeBridge);
  assert.equal(automationCompat.isAutomationCompatActive(), true);

  automationCompat.resetAutomationCompatBridgeForTests();
  assert.equal(automationCompat.isAutomationCompatActive(), false);
  assert.throws(() => automationCompat.getVariable("hp"), (error) => (
    error.name === "AutomationCompatBridgeNotInstalledError"
  ));
});

test("GMCP variable naming matches between bridge-active and fallback paths", async (t) => {
  resetAllManagers();
  registerGmcpVariables("Char.Vitals", { hp: 42, opponent: { name: "target" } });
  const fallbackVariables = { ...getGmcpVariables() };

  resetAllManagers();
  const {
    sessionId,
    SessionDiagnostics,
    createResourceScope,
    createAutomationRuntimeState,
  } = await loadAutomationRuntimeModules(t);
  const scope = createResourceScope(sessionId, new SessionDiagnostics(sessionId));
  const runtime = createAutomationRuntimeState(scope);
  installFakeAutomationBridgeFromRuntime(runtime);

  automationCompat.setGmcpVariable("Char.Vitals", { hp: 42, opponent: { name: "target" } });
  assert.deepEqual(automationCompat.getGmcpVariables(), fallbackVariables);
});

test("bridge-active user variables stay in memory and never touch alias storage", () => {
  resetAllManagers();
  const runtime = {
    variables: {},
    getVariable(name) { return this.variables[name]; },
    setVariable(name, value) {
      this.variables[name] = String(value ?? "");
      return true;
    },
    removeVariable(name) { delete this.variables[name]; },
    listVariableNames() { return Object.keys(this.variables).sort(); },
    getAutomationVariables() { return { ...this.variables }; },
    setGmcpVariable() {},
    resetGmcpVariables() {},
    getGmcpVariables() { return {}; },
    listGmcpVariables() { return []; },
    scheduleTimer() {},
    clearTimer() {},
    getTimerRuntimeState() { return null; },
    scheduleWait() { return Promise.resolve(); },
    reconcileTimers() {},
  };
  installFakeAutomationBridgeFromRuntime(runtime);

  aliasManager.setVariable("target", "orc", LEGACY_SCOPE_KEY);
  assert.equal(aliasManager.getVariable("target", LEGACY_SCOPE_KEY), "orc");
  assert.equal(aliasManager.getAutomationVariables(LEGACY_SCOPE_KEY).target, "orc");
  assert.equal(localStorage.getItem(ALIAS_STORAGE_KEY), null);

  aliasManager.removeVariable("target", LEGACY_SCOPE_KEY);
  assert.equal(aliasManager.listVariableNames(LEGACY_SCOPE_KEY).length, 0);
  assert.equal(localStorage.getItem(ALIAS_STORAGE_KEY), null);
});

test("fallback user variables persist across reload simulation", () => {
  const scopeKey = resetAllManagers();
  aliasManager.setVariable("target", "orc", scopeKey);
  const stored = JSON.parse(localStorage.getItem(ALIAS_STORAGE_KEY));
  assert.equal(stored.scopes[scopeKey].variables.target, "orc");

  aliasManager._data = { scopes: {} };
  aliasManager.init();
  assert.equal(aliasManager.getVariable("target", scopeKey), "orc");
});

test("fallback trigger and timer managers preserve legacy localStorage behavior", () => {
  const scopeKey = resetAllManagers();

  triggerManager.upsertSimpleTrigger("You feel*", "shiver", scopeKey);
  assert.equal(triggerManager.findTriggerByPattern("You feel*", scopeKey).steps[0].template, "shiver");
  const triggerStored = JSON.parse(localStorage.getItem(TRIGGER_STORAGE_KEY));
  assert.equal(triggerStored.scopes[scopeKey].triggers[0].pattern, "You feel*");

  timerManager.saveScope(scopeKey, {
    timers: [{
      id: "timer-1",
      enabled: true,
      name: "Heartbeat",
      description: "",
      group: "",
      durationMs: 1000,
      recurring: false,
      autoStart: false,
      steps: [{ type: "send_command", template: "pulse" }],
    }],
  });
  assert.equal(timerManager.findTimerByName("Heartbeat", scopeKey).durationMs, 1000);
  const timerStored = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY));
  assert.equal(timerStored.scopes[scopeKey].timers[0].name, "Heartbeat");
});

test("bridge-active trigger and timer reads avoid dom and reflect effective definitions", () => {
  resetAllManagers();
  dom.host = createThrowingDom().host;
  dom.port = createThrowingDom().port;
  dom.protocolSelect = createThrowingDom().protocolSelect;

  installFakeConfigBridge({
    definitionsByKind: {
      aliases: [],
      highlights: [],
      functions: [],
      keyMappings: [],
      triggers: [{
        definition: {
          id: "trigger-1",
          enabled: true,
          pattern: "score",
          isRegex: false,
          ignoreCase: false,
          description: "",
          group: "",
          gag: false,
          steps: [{ type: "send_command", template: "score" }],
        },
        source: { kind: "local" },
      }],
      timers: [{
        definition: {
          id: "timer-1",
          enabled: true,
          name: "Heartbeat",
          description: "",
          group: "",
          durationMs: 5000,
          recurring: false,
          autoStart: true,
          steps: [{ type: "send_command", template: "pulse" }],
        },
        source: { kind: "shared-set", configSetId: "set-1" },
      }],
    },
    identityKeyFor(kind, definition) {
      if (kind === "triggers") return String(definition.pattern || "").trim();
      if (kind === "timers") return String(definition.name || "").trim().toLowerCase();
      return String(definition.name || definition.pattern || "").trim().toLowerCase();
    },
  });

  assert.equal(triggerManager.getActiveScopeKey(), PROFILE_SCOPE_KEY);
  assert.equal(triggerManager.getScopeSnapshot().triggers[0].pattern, "score");
  assert.equal(triggerManager.findTriggerByPattern("score").pattern, "score");
  assert.equal(timerManager.findTimerByName("Heartbeat").durationMs, 5000);
  assert.equal(triggerManager.getCompiledTriggers()[0].pattern, "score");
});

test("partial bridge activation keeps timer reconciliation dormant", () => {
  resetAllManagers();
  let subscribeCount = 0;

  const { bridge: configOnlyBridge } = installFakeConfigBridge();
  configOnlyBridge.subscribe = () => {
    subscribeCount += 1;
    return () => {};
  };
  timerManager.syncReconciliationSubscription();
  assert.equal(subscribeCount, 0);

  automationCompat.resetAutomationCompatBridgeForTests();
  configCompat.resetConfigurationCompatBridgeForTests();
  resetAllManagers();

  installFakeAutomationBridgeFromRuntime({
    getVariable() {},
    setVariable() { return true; },
    removeVariable() {},
    listVariableNames() { return []; },
    getAutomationVariables() { return {}; },
    setGmcpVariable() {},
    resetGmcpVariables() {},
    getGmcpVariables() { return {}; },
    listGmcpVariables() { return []; },
    scheduleTimer() {},
    clearTimer() {},
    getTimerRuntimeState() { return null; },
    scheduleWait() { return Promise.resolve(); },
    reconcileTimers() {},
  });
  timerManager.syncReconciliationSubscription();
  assert.equal(subscribeCount, 0);

  const { bridge: bothBridge } = installFakeConfigBridge();
  bothBridge.subscribe = () => {
    subscribeCount += 1;
    return () => {};
  };
  timerManager.syncReconciliationSubscription();
  assert.equal(subscribeCount, 1);
});

test("reinstalling both bridges leaves one reconciliation subscription", () => {
  resetAllManagers();
  const first = installFakeConfigBridge();
  let subscribeCount = 0;
  first.bridge.subscribe = (listener) => {
    subscribeCount += 1;
    return first.listeners.includes(listener)
      ? () => {}
      : (() => {
        const index = first.listeners.indexOf(listener);
        if (index >= 0) first.listeners.splice(index, 1);
      })();
  };

  const runtime = {
    getVariable() {},
    setVariable() { return true; },
    removeVariable() {},
    listVariableNames() { return []; },
    getAutomationVariables() { return {}; },
    setGmcpVariable() {},
    resetGmcpVariables() {},
    getGmcpVariables() { return {}; },
    listGmcpVariables() { return []; },
    scheduleTimer() {},
    clearTimer() {},
    getTimerRuntimeState() { return null; },
    scheduleWait() { return Promise.resolve(); },
    reconcileTimers() {},
  };
  installFakeAutomationBridgeFromRuntime(runtime);

  timerManager.syncReconciliationSubscription();
  assert.equal(subscribeCount, 1);

  configCompat.resetConfigurationCompatBridgeForTests();
  automationCompat.resetAutomationCompatBridgeForTests();
  timerManager._reconciliationUnsubscribe = null;

  const second = installFakeConfigBridge();
  second.bridge.subscribe = first.bridge.subscribe;
  installFakeAutomationBridgeFromRuntime(runtime);
  timerManager.syncReconciliationSubscription();
  assert.equal(subscribeCount, 2);
});

test("waitResult uses scheduleWait when supplied", async () => {
  resetAllManagers();
  let scheduledDelay = null;
  const result = executeAutomationSteps([
    { type: "wait", seconds: 0.05 },
    { type: "show_message", template: "done" },
  ], {
    appendMessage() {},
    scopeKey: LEGACY_SCOPE_KEY,
    templateContext: { args: [], remainder: "", variables: {} },
    source: { prefix: "Test", description: "wait test" },
    aliasContext: { depth: 0, trail: [] },
    scheduleWait(delayMs) {
      scheduledDelay = delayMs;
      return Promise.resolve();
    },
  });

  assert.equal(scheduledDelay, 50);
  assert.equal(result.pending, true);
  await result.completion;
});

test("automation runtime instances are isolated from each other", async (t) => {
  const {
    sessionId,
    otherSessionId,
    SessionDiagnostics,
    createResourceScope,
    createAutomationRuntimeState,
  } = await loadAutomationRuntimeModules(t);

  const diagnosticsA = new SessionDiagnostics(sessionId);
  const diagnosticsB = new SessionDiagnostics(otherSessionId);
  const scopeA = createResourceScope(sessionId, diagnosticsA);
  const scopeB = createResourceScope(otherSessionId, diagnosticsB);
  const runtimeA = createAutomationRuntimeState(scopeA);
  const runtimeB = createAutomationRuntimeState(scopeB);

  runtimeA.setVariable("target", "orc");
  runtimeA.setGmcpVariable("Char.Vitals", { hp: 1 });
  runtimeA.scheduleTimer("timer-a", 1000, () => {});

  assert.equal(runtimeB.getVariable("target"), undefined);
  assert.deepEqual(runtimeB.getGmcpVariables(), {});
  assert.equal(runtimeB.getTimerRuntimeState("timer-a"), null);
});

test("reconcileTimers keeps running timers, stops removed ones, and starts new auto timers once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const {
    sessionId,
    SessionDiagnostics,
    createResourceScope,
    createAutomationRuntimeState,
  } = await loadAutomationRuntimeModules(t);

  const scope = createResourceScope(sessionId, new SessionDiagnostics(sessionId));
  const runtime = createAutomationRuntimeState(scope);
  const started = [];

  runtime.scheduleTimer("running", 5000, () => {});
  const before = runtime.getTimerRuntimeState("running");
  assert.ok(before);

  runtime.reconcileTimers([
    { id: "running", enabled: true, autoStart: true },
    { id: "fresh", enabled: true, autoStart: true },
  ], (timer) => {
    started.push(timer.id);
    runtime.scheduleTimer(timer.id, 1000, () => {});
  });

  assert.deepEqual(started, ["fresh"]);
  const after = runtime.getTimerRuntimeState("running");
  assert.equal(after.startedAt, before.startedAt);
  assert.equal(after.fireAt, before.fireAt);

  runtime.reconcileTimers([
    { id: "running", enabled: true, autoStart: true },
    { id: "fresh", enabled: true, autoStart: true },
  ], (timer) => {
    started.push(timer.id);
  });
  assert.deepEqual(started, ["fresh"]);

  runtime.reconcileTimers([
    { id: "running", enabled: false, autoStart: true },
  ], () => {});
  assert.equal(runtime.getTimerRuntimeState("running"), null);
  assert.equal(runtime.getTimerRuntimeState("fresh"), null);
});

test("disposing automation runtime cancels timers and waits under a fake clock", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const {
    sessionId,
    SessionDiagnostics,
    createResourceScope,
    createAutomationRuntimeState,
  } = await loadAutomationRuntimeModules(t);

  const scope = createResourceScope(sessionId, new SessionDiagnostics(sessionId));
  const runtime = createAutomationRuntimeState(scope);
  let timerFired = 0;
  let waitResolved = false;

  runtime.scheduleTimer("timer-a", 1000, () => {
    timerFired += 1;
  });
  const waitPromise = runtime.scheduleWait(1000).then(() => {
    waitResolved = true;
  });

  scope.dispose();
  runtime.dispose();
  t.mock.timers.tick(2000);
  await Promise.resolve();

  assert.equal(timerFired, 0);
  assert.equal(waitResolved, false);
  void waitPromise;
});

test("timer manager reconciles through both bridges without restarting an unchanged running timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  resetAllManagers();
  const { bridge } = installFakeConfigBridge({
    identityKeyFor(kind, definition) {
      if (kind === "timers") return String(definition.name || "").trim().toLowerCase();
      return String(definition.pattern || definition.name || "").trim();
    },
    definitionsByKind: {
      aliases: [],
      highlights: [],
      functions: [],
      keyMappings: [],
      triggers: [],
      timers: [{
        definition: {
          id: "timer-running",
          enabled: true,
          name: "Heartbeat",
          description: "",
          group: "",
          durationMs: 5000,
          recurring: false,
          autoStart: true,
          steps: [{ type: "send_command", template: "pulse" }],
        },
        source: { kind: "local" },
      }, {
        definition: {
          id: "timer-new",
          enabled: true,
          name: "Fresh",
          description: "",
          group: "",
          durationMs: 2000,
          recurring: false,
          autoStart: true,
          steps: [{ type: "send_command", template: "fresh" }],
        },
        source: { kind: "local" },
      }],
    },
  });

  const {
    sessionId,
    SessionDiagnostics,
    createResourceScope,
    createAutomationRuntimeState,
  } = await loadAutomationRuntimeModules(t);
  const scope = createResourceScope(sessionId, new SessionDiagnostics(sessionId));
  const runtime = createAutomationRuntimeState(scope);
  installFakeAutomationBridgeFromRuntime(runtime);

  timerManager.syncReconciliationSubscription();
  timerManager.startTimerById("timer-running", PROFILE_SCOPE_KEY);
  const before = runtime.getTimerRuntimeState("timer-running");
  assert.ok(before);

  bridge.definitionsByKind.timers = bridge.definitionsByKind.timers.map((entry) => (
    entry.definition.id === "timer-new"
      ? entry
      : {
        ...entry,
        definition: {
          ...entry.definition,
          durationMs: 999,
        },
      }
  ));
  bridge.notifyListeners();

  const after = runtime.getTimerRuntimeState("timer-running");
  assert.equal(after.startedAt, before.startedAt);
  assert.equal(after.fireAt, before.fireAt);
  assert.ok(runtime.getTimerRuntimeState("timer-new"));

  bridge.replaceLocalDefinitions("timers", [{
    id: "timer-running",
    enabled: false,
    name: "Heartbeat",
    description: "",
    group: "",
    durationMs: 5000,
    recurring: false,
    autoStart: true,
    steps: [{ type: "send_command", template: "pulse" }],
  }]);
  assert.equal(runtime.getTimerRuntimeState("timer-running"), null);
});

test("trigger executeMatches uses bridge scheduleWait when automation bridge is active", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const {
    sessionId,
    SessionDiagnostics,
    createResourceScope,
    createAutomationRuntimeState,
  } = await loadAutomationRuntimeModules(t);
  const scope = createResourceScope(sessionId, new SessionDiagnostics(sessionId));
  const runtime = createAutomationRuntimeState(scope);
  installFakeAutomationBridgeFromRuntime(runtime);

  let continued = false;
  const matches = [{
    trigger: {
      pattern: "wait*",
      steps: [
        { type: "wait", seconds: 1 },
        { type: "show_message", template: "done" },
      ],
    },
    fullMatch: "wait",
    captures: [],
  }];

  triggerManager.executeMatches(matches, PROFILE_SCOPE_KEY, {
    appendMessage() {
      continued = true;
    },
  });

  scope.dispose();
  runtime.dispose();
  t.mock.timers.tick(2000);
  await Promise.resolve();
  assert.equal(continued, false);
});
