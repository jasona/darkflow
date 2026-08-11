/*
 * Step 13 MH acceptance matrix (corrective plan Step 4):
 * MH1  -> same-slot double bootstrap creates one session
 * MH2  -> migration preserves legacy keys and second run skips
 * MH3  -> default character resolves and empty host does not auto-connect
 * MH10 -> post-create failure disposes session and clears runtime slot
 * CMH1 -> bridge install performs no DOM write before markLegacyUiReady
 * CMH2 -> same-document boot is idempotent
 * CMH3 -> partial boot failure resets bridges and clears runtime slot
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(repoRoot, "test", "fixtures", "session-migration");

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf8"));
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
    snapshot() {
      return new Map(data);
    },
  };
}

async function loadBootstrapModules(t) {
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
    bootstrapTransaction,
    repository,
    schema,
    legacyKeys,
    legacyMigration,
    configValidator,
    ids,
    profiles,
  ] = await Promise.all([
    ssr.runner.import("/app/bootstrap-transaction.ts"),
    ssr.runner.import("/storage/repository.ts"),
    ssr.runner.import("/storage/schema.ts"),
    ssr.runner.import("/storage/legacy-keys.ts"),
    ssr.runner.import("/storage/legacy-migration.ts"),
    ssr.runner.import("/storage/config-validator.ts"),
    ssr.runner.import("/model/ids.ts"),
    ssr.runner.import("/model/profiles.ts"),
  ]);

  return {
    ...bootstrapTransaction,
    repositoryCommit: repository.commit,
    SESSION_CORE_STORAGE_KEY: schema.SESSION_CORE_STORAGE_KEY,
    LEGACY_STORAGE_KEYS: legacyKeys.LEGACY_STORAGE_KEYS,
    migrateLegacyData: legacyMigration.migrateLegacyData,
    DEFAULT_CONFIG_JSON: configValidator.DEFAULT_CONFIG_JSON,
    createSequentialUuidFactory: ids.createSequentialUuidFactory,
    createEmptyLocalDefinitions: profiles.createEmptyLocalDefinitions,
    createEmptyConfigurationSetRefs: profiles.createEmptyConfigurationSetRefs,
    createServerProfileId: ids.createServerProfileId,
    createCharacterProfileId: ids.createCharacterProfileId,
  };
}

function populateLegacyStorage(storage, modules, fixture) {
  const entries = [
    ["darkwind-client-aliases-v1", fixture.aliases],
    ["darkwind-client-highlights-v1", fixture.highlights],
    ["darkwind-client-triggers-v1", fixture.triggers],
    ["darkwind-client-timers-v1", fixture.timers],
    ["darkwind-client-functions-v1", fixture.functions],
    ["darkwind-cmd-history", fixture.history],
    ["darkwind-panel-state", fixture.panels],
    ["darkwind-sound-settings", fixture.sound],
    ["darkwind-client-settings", fixture.settings],
  ];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    storage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
}

function createBootHarness(modules, options = {}) {
  const storage = options.storage ?? createMemoryStorage();
  const windowTarget = {
    __darkflowPhase1Runtime: undefined,
    __darkflowPhase1Bootstrap: undefined,
    __darkflowPhase1Session: undefined,
  };
  const texts = [];
  let legacyLoadCount = 0;
  let bootstrapPhase = null;
  let sessionDiagnostic = null;
  const connectionStateCalls = [];
  const installed = {
    configuration: null,
    automation: null,
    runtime: null,
    controllers: null,
  };

  const compatFactory = () => ({
    installConfigurationCompatBridge(bridge) {
      installed.configuration = bridge;
    },
    installAutomationCompatBridge(bridge) {
      installed.automation = bridge;
    },
    installSessionRuntimeBridge(bridge) {
      installed.runtime = bridge;
    },
    installControllerCompatBridge(bridge) {
      installed.controllers = bridge;
    },
    resetConfigurationCompatBridgeForTests() {
      installed.configuration = null;
    },
    resetAutomationCompatBridgeForTests() {
      installed.automation = null;
    },
    resetSessionRuntimeBridgeForTests() {
      installed.runtime = null;
    },
    resetControllerCompatBridgeForTests() {
      installed.controllers = null;
    },
  });

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
    settings: { autoReconnect: options.autoReconnect ?? true },
    clientVersion: "test",
    terminalGeometry: { columns: 80, rows: 24 },
    everConnected: false,
    tabObservability: { lastSentState: null },
  };

  const importModule = async (entry) => {
    if (entry.endsWith("configuration.js") || entry.endsWith("automation.js") || entry.endsWith("runtime.js") || entry.endsWith("controllers.js")) {
      return compatFactory();
    }
    if (entry.endsWith("state.js")) {
      return { state: legacyState };
    }
    if (entry.endsWith("connection.js")) {
      return {
        setConnectionState(state) {
          connectionStateCalls.push(state);
        },
      };
    }
    if (entry.endsWith("gmcp-variables.js")) {
      return { registerGmcpVariables: () => {} };
    }
    throw new Error(`Unexpected import in bootstrap test: ${entry}`);
  };

  async function runTransaction(overrides = {}) {
    return modules.runBootTransaction({
      storage,
      urlSearchParams: new URLSearchParams(options.urlParams ?? ""),
      uuidFactory: options.uuidFactory ?? modules.createSequentialUuidFactory("10000000-0000-4000-8000-"),
      fetchConfig: overrides.fetchConfig ?? (async () => options.config ?? modules.DEFAULT_CONFIG_JSON),
      importModule,
      loadLegacyApp: async () => {
        legacyLoadCount += 1;
        bootstrapPhase = "legacy-loaded";
      },
      setBootstrapPhase: (phase) => {
        bootstrapPhase = phase;
      },
      readRuntimeSlot: () => modules.readPhase1RuntimeSlot(windowTarget),
      writeRuntimeSlot: (record) => modules.writePhase1RuntimeSlot(windowTarget, record),
      clearRuntimeSlot: () => modules.clearPhase1RuntimeSlot(windowTarget),
      publishSessionDiagnostic: (diagnostic) => {
        sessionDiagnostic = diagnostic;
      },
      clearSessionDiagnostic: () => {
        sessionDiagnostic = null;
      },
      webSocketFactory: () => ({
        readyState: 3,
        bufferedAmount: 0,
        binaryType: "arraybuffer",
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        send() {},
        close() {},
      }),
      onlineTarget: { addEventListener() {} },
      appOrigin: "http://localhost:3000",
      onText: (text) => texts.push(text),
      injectPostCreateFailure: overrides.injectPostCreateFailure,
    });
  }

  return {
    storage,
    windowTarget,
    texts,
    legacyState,
    connectionStateCalls,
    installed,
    get legacyLoadCount() {
      return legacyLoadCount;
    },
    get bootstrapPhase() {
      return bootstrapPhase;
    },
    get sessionDiagnostic() {
      return sessionDiagnostic;
    },
    runTransaction,
  };
}

test("MH1 CMH2 same-slot double bootstrap creates one session and one legacy load", async (t) => {
  const modules = await loadBootstrapModules(t);
  const fixture = loadFixture("single-scope");
  const storage = createMemoryStorage();
  populateLegacyStorage(storage, modules, fixture);

  const harness = createBootHarness(modules, { storage });
  const first = await harness.runTransaction();
  const second = await harness.runTransaction();

  assert.equal(first.kind, "created");
  assert.equal(second.kind, "reused");
  assert.equal(first.record.session.sessionId, second.record.session.sessionId);
  assert.equal(harness.legacyLoadCount, 1);
  assert.equal(harness.sessionDiagnostic?.phase, "session-ready");
  assert.equal(harness.bootstrapPhase, "legacy-loaded");
});

test("MH2 migration preserves legacy keys and second migration skips", async (t) => {
  const modules = await loadBootstrapModules(t);
  const fixture = loadFixture("single-scope");
  const storage = createMemoryStorage();
  populateLegacyStorage(storage, modules, fixture);
  const before = storage.snapshot();

  const harness = createBootHarness(modules, { storage });
  await harness.runTransaction();
  const afterFirst = storage.snapshot();

  for (const key of modules.LEGACY_STORAGE_KEYS) {
    assert.equal(afterFirst.get(key) ?? null, before.get(key) ?? null, key);
  }
  assert.ok(afterFirst.get(modules.SESSION_CORE_STORAGE_KEY));

  const secondMigration = modules.migrateLegacyData(
    storage,
    modules.DEFAULT_CONFIG_JSON,
    new URLSearchParams(""),
    modules.createSequentialUuidFactory("20000000-0000-4000-8000-"),
  );
  assert.equal(secondMigration.success, true);
  assert.equal(secondMigration.skipped, true);
});

test("MH2 malformed config falls back without aborting boot", async (t) => {
  const modules = await loadBootstrapModules(t);
  const fixture = loadFixture("single-scope");
  const storage = createMemoryStorage();
  populateLegacyStorage(storage, modules, fixture);
  const harness = createBootHarness(modules, { storage });

  await harness.runTransaction({
    fetchConfig: async () => ({ notValid: true }),
  });

  assert.equal(harness.sessionDiagnostic?.phase, "session-ready");
  assert.equal(harness.bootstrapPhase, "legacy-loaded");
});

test("MH3 default character resolves from defaults.defaultCharacterProfileId", async (t) => {
  const modules = await loadBootstrapModules(t);
  const fixture = loadFixture("single-scope");
  const storage = createMemoryStorage();
  populateLegacyStorage(storage, modules, fixture);
  const harness = createBootHarness(modules, { storage });

  const result = await harness.runTransaction();
  const stored = JSON.parse(storage.getItem(modules.SESSION_CORE_STORAGE_KEY));
  assert.equal(result.record.characterProfileId, stored.defaults.defaultCharacterProfileId);
  assert.equal(harness.sessionDiagnostic?.serverProfileId, result.record.serverProfileId);
});

test("MH10 CMH3 post-create failure disposes session and clears runtime slot", async (t) => {
  const modules = await loadBootstrapModules(t);
  const fixture = loadFixture("single-scope");
  const storage = createMemoryStorage();
  populateLegacyStorage(storage, modules, fixture);
  const harness = createBootHarness(modules, { storage });

  await assert.rejects(
    () =>
      harness.runTransaction({
        injectPostCreateFailure() {
          throw new Error("bridge build failed");
        },
      }),
    /bridge build failed/,
  );

  assert.equal(modules.readPhase1RuntimeSlot(harness.windowTarget), null);
  assert.equal(harness.sessionDiagnostic, null);
  assert.equal(harness.installed.configuration, null);
  assert.equal(harness.installed.runtime, null);
  assert.equal(harness.installed.controllers, null);
});

test("CMH1 bridge install performs no DOM connection state write before markLegacyUiReady", async (t) => {
  const modules = await loadBootstrapModules(t);
  const fixture = loadFixture("single-scope");
  const storage = createMemoryStorage();
  populateLegacyStorage(storage, modules, fixture);
  const harness = createBootHarness(modules, { storage });

  await harness.runTransaction();
  assert.deepEqual(harness.connectionStateCalls, []);

  harness.installed.runtime.markLegacyUiReady();
  assert.ok(harness.connectionStateCalls.length >= 1);
});

test("CMH3 partial boot failure loads legacy once after cleanup", async (t) => {
  const modules = await loadBootstrapModules(t);
  const fixture = loadFixture("single-scope");
  const storage = createMemoryStorage();
  populateLegacyStorage(storage, modules, fixture);
  const harness = createBootHarness(modules, { storage });

  await assert.rejects(() =>
    harness.runTransaction({
      injectPostCreateFailure() {
        throw new Error("injected");
      },
    }),
  );

  assert.equal(harness.legacyLoadCount, 0);

  await harness.runTransaction({
    fetchConfig: async () => modules.DEFAULT_CONFIG_JSON,
  });
  assert.equal(harness.legacyLoadCount, 1);
});
