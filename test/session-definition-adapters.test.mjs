import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compatModulePath = path.join(repoRoot, "public/js/session-compat/configuration.js");

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
const { highlightManager } = await import("../public/js/highlight-manager.js");
const { functionManager } = await import("../public/js/function-manager.js");
const { settingsManager } = await import("../public/js/settings-manager.js");
const compat = await import("../public/js/session-compat/configuration.js");

const ALIAS_STORAGE_KEY = "darkwind-client-aliases-v1";
const HIGHLIGHT_STORAGE_KEY = "darkwind-client-highlights-v1";
const FUNCTION_STORAGE_KEY = "darkwind-client-functions-v1";
const SETTINGS_STORAGE_KEY = "darkwind-client-settings";
const LEGACY_SCOPE_KEY = "ws://test:4242";

function resetManagersForFallback(scopeKey = LEGACY_SCOPE_KEY) {
  compat.resetConfigurationCompatBridgeForTests();
  localStorage.clear();
  dispatchedEvents.length = 0;
  dom.host = createLegacyDom().host;
  dom.port = createLegacyDom().port;
  dom.protocolSelect = createLegacyDom().protocolSelect;
  aliasManager._data = { scopes: {} };
  highlightManager._data = { scopes: {} };
  functionManager._data = { scopes: {} };
  settingsManager._settings = { ...settingsManager._defaults };
  settingsManager._draftSettings = {};
  return scopeKey;
}

function installFakeBridge(overrides = {}) {
  const calls = [];
  const bridge = {
    activeCharacterProfileId: overrides.activeCharacterProfileId || "character-a",
    definitionsByKind: overrides.definitionsByKind || {
      aliases: [],
      highlights: [],
      functions: [],
      keyMappings: [],
    },
    localDefinitionsByKind: {
      aliases: [],
      highlights: [],
      functions: [],
      keyMappings: [],
    },
    getActiveCharacterProfileId() {
      return bridge.activeCharacterProfileId;
    },
    getEffectiveDefinitions(kind) {
      return bridge.definitionsByKind[kind] || [];
    },
    replaceLocalDefinitions(kind, definitions) {
      calls.push(["replaceLocalDefinitions", kind, structuredClone(definitions)]);
      bridge.localDefinitionsByKind[kind] = structuredClone(definitions);
    },
    upsertLocalDefinitionByIdentity(kind, definition) {
      calls.push(["upsertLocalDefinitionByIdentity", kind, structuredClone(definition)]);
      const list = [...(bridge.localDefinitionsByKind[kind] || [])];
      const identityKey = overrides.identityKeyFor?.(kind, definition)
        ?? String(definition.trigger || definition.patternSource || definition.name || definition.code || "")
          .trim()
          .toLowerCase();
      const index = list.findIndex((item) => {
        const itemKey = overrides.identityKeyFor?.(kind, item)
          ?? String(item.trigger || item.patternSource || item.name || item.code || "")
            .trim()
            .toLowerCase();
        return itemKey === identityKey;
      });
      if (index >= 0) list[index] = structuredClone(definition);
      else list.push(structuredClone(definition));
      bridge.localDefinitionsByKind[kind] = list;
    },
    removeLocalDefinitionByIdentity(kind, identityKey) {
      calls.push(["removeLocalDefinitionByIdentity", kind, identityKey]);
      const before = bridge.localDefinitionsByKind[kind] || [];
      const after = before.filter((item) => {
        const itemKey = overrides.identityKeyFor?.(kind, item)
          ?? String(item.trigger || item.patternSource || item.name || item.code || "")
            .trim()
            .toLowerCase();
        return itemKey !== identityKey;
      });
      bridge.localDefinitionsByKind[kind] = after;
      return after.length !== before.length;
    },
    setLocalDefinitionEnabledByIdentity(kind, identityKey, enabled) {
      calls.push(["setLocalDefinitionEnabledByIdentity", kind, identityKey, enabled]);
      const list = structuredClone(bridge.localDefinitionsByKind[kind] || []);
      const item = list.find((entry) => {
        const itemKey = overrides.identityKeyFor?.(kind, entry)
          ?? String(entry.trigger || entry.patternSource || entry.name || entry.code || "")
            .trim()
            .toLowerCase();
        return itemKey === identityKey;
      });
      if (!item) return false;
      item.enabled = enabled !== false;
      bridge.localDefinitionsByKind[kind] = list;
      return true;
    },
    subscribe(listener) {
      calls.push(["subscribe", listener]);
      return () => {};
    },
    ...overrides,
  };
  compat.installConfigurationCompatBridge(bridge);
  return { bridge, calls };
}

test("compat module has zero static client/** imports", () => {
  const source = fs.readFileSync(compatModulePath, "utf8");
  assert.doesNotMatch(source, /\bfrom\s+['"][^'"]*client\//);
  assert.doesNotMatch(source, /\bimport\s+['"][^'"]*client\//);
});

test("compat bridge install, reset, and uninstalled errors", () => {
  compat.resetConfigurationCompatBridgeForTests();
  assert.equal(compat.isConfigurationCompatActive(), false);

  const { bridge } = installFakeBridge({
    definitionsByKind: { aliases: [{ definition: { id: "a1", trigger: "look" }, source: { kind: "local" } }] },
  });
  assert.equal(compat.isConfigurationCompatActive(), true);
  assert.equal(compat.getActiveCharacterProfileId(), "character-a");
  assert.equal(compat.getEffectiveDefinitions("aliases").length, 1);

  compat.resetConfigurationCompatBridgeForTests();
  assert.equal(compat.isConfigurationCompatActive(), false);
  assert.throws(() => compat.getEffectiveDefinitions("aliases"), (error) => (
    error.name === "ConfigurationCompatBridgeNotInstalledError"
  ));

  compat.installConfigurationCompatBridge(bridge);
  compat.replaceLocalDefinitions("aliases", [{ id: "bulk", trigger: "score" }]);
  assert.equal(bridge.localDefinitionsByKind.aliases[0].trigger, "score");
});

test("fallback alias manager behavior matches legacy localStorage writes", () => {
  const scopeKey = resetManagersForFallback();

  aliasManager.upsertSimpleAlias("look", "look north", scopeKey);
  const snapshot = aliasManager.getScopeSnapshot(scopeKey);
  assert.equal(snapshot.aliases.length, 1);
  assert.equal(aliasManager.matchAlias("look", scopeKey)?.alias.trigger, "look");

  aliasManager.setEnabledByTarget("look", false, scopeKey);
  assert.equal(aliasManager.findAliasByTrigger("look", scopeKey).enabled, false);

  const stored = JSON.parse(localStorage.getItem(ALIAS_STORAGE_KEY));
  assert.deepEqual(Object.keys(stored.scopes), [scopeKey]);
  assert.equal(stored.scopes[scopeKey].aliases[0].steps[0].template, "look north");
  assert.deepEqual(stored.scopes[scopeKey].variables, {});

  aliasManager.setVariable("target", "orc", scopeKey);
  assert.equal(aliasManager.getVariable("target", scopeKey), "orc");
  const storedWithVariable = JSON.parse(localStorage.getItem(ALIAS_STORAGE_KEY));
  assert.equal(storedWithVariable.scopes[scopeKey].variables.target, "orc");
});

test("fallback highlight and function managers preserve legacy scope storage", () => {
  const scopeKey = resetManagersForFallback();

  highlightManager.upsertSimpleRule("^You see", "yellow", scopeKey);
  assert.equal(highlightManager.getScopeSnapshot(scopeKey).rules.length, 1);
  assert.equal(highlightManager.findRuleByPattern("^You see", scopeKey).patternSource, "^You see");

  functionManager.saveScope(scopeKey, {
    functions: [{
      id: "fn-heal",
      enabled: true,
      name: "heal",
      description: "",
      group: "",
      script: "send heal",
    }],
  });
  assert.equal(functionManager.findFunctionByName("heal", scopeKey).script, "send heal");

  const highlightStored = JSON.parse(localStorage.getItem(HIGHLIGHT_STORAGE_KEY));
  const functionStored = JSON.parse(localStorage.getItem(FUNCTION_STORAGE_KEY));
  assert.equal(highlightStored.scopes[scopeKey].rules.length, 1);
  assert.equal(functionStored.scopes[scopeKey].functions[0].name, "heal");
});

test("installed bridge avoids dom reads across adapted manager entry points", () => {
  resetManagersForFallback();
  dom.host = createThrowingDom().host;
  dom.port = createThrowingDom().port;
  dom.protocolSelect = createThrowingDom().protocolSelect;

  const aliasEntry = {
    definition: {
      id: "alias-1",
      enabled: true,
      trigger: "score",
      description: "",
      group: "",
      isRegex: false,
      ignoreCase: true,
      steps: [{ type: "send_command", template: "score" }],
    },
    source: { kind: "shared-set", configSetId: "set-a", revision: 1 },
  };
  const highlightEntry = {
    definition: {
      id: "rule-1",
      enabled: true,
      patternSource: "^prompt",
      description: "",
      group: "",
      ignoreCase: false,
      style: { fg: "yellow", bg: "black", bold: false },
    },
    source: { kind: "local" },
  };
  const functionEntry = {
    definition: {
      id: "fn-1",
      enabled: true,
      name: "heal",
      description: "",
      group: "",
      script: "send heal",
    },
    source: { kind: "local" },
  };

  installFakeBridge({
    activeCharacterProfileId: "char-profile-a",
    definitionsByKind: {
      aliases: [aliasEntry],
      highlights: [highlightEntry],
      functions: [functionEntry],
      keyMappings: [{
        definition: {
          id: "keymap-1",
          enabled: true,
          code: "F1",
          label: "F1",
          legacyKey: "",
          command: "look",
        },
        source: { kind: "local" },
      }],
    },
    identityKeyFor(kind, definition) {
      if (kind === "aliases") return String(definition.trigger).trim().toLowerCase();
      if (kind === "highlights") return String(definition.patternSource).trim();
      if (kind === "functions") return String(definition.name).trim().toLowerCase();
      if (kind === "keyMappings") return String(definition.code).trim();
      return "";
    },
  });

  assert.equal(aliasManager.getActiveScopeKey(), "char-profile-a");
  assert.equal(aliasManager.findAliasByTrigger("score").trigger, "score");
  assert.equal(aliasManager.matchAlias("score")?.alias.id, "alias-1");
  assert.equal(aliasManager.findAliasByTriggerWithSource("score").source.kind, "shared-set");

  assert.equal(highlightManager.findRuleByPattern("^prompt").id, "rule-1");
  assert.equal(highlightManager.getCompiledRules().length, 1);
  assert.equal(highlightManager.applyHighlightsToLines([{ text: "prompt", fragments: [] }]).length, 1);

  assert.equal(functionManager.findFunctionByName("heal").id, "fn-1");
  assert.equal(functionManager.findFunctionByNameWithSource("heal").source.kind, "local");

  assert.deepEqual(settingsManager.get("keyMappings"), [{
    code: "F1",
    label: "F1",
    legacyKey: "",
    command: "look",
  }]);
});

test("mutating a shared-set-sourced definition by identity reports no change instead of a false success", () => {
  resetManagersForFallback();

  const sharedAlias = {
    id: "alias-shared",
    enabled: true,
    trigger: "score",
    description: "",
    group: "",
    isRegex: false,
    ignoreCase: true,
    steps: [{ type: "send_command", template: "score" }],
  };
  const sharedRule = {
    id: "rule-shared",
    enabled: true,
    patternSource: "^prompt",
    description: "",
    group: "",
    ignoreCase: false,
    style: { fg: "yellow", bg: "black", bold: false },
  };
  const sharedFunction = {
    id: "fn-shared",
    enabled: true,
    name: "heal",
    description: "",
    group: "",
    script: "send heal",
  };

  installFakeBridge({
    definitionsByKind: {
      aliases: [{ definition: sharedAlias, source: { kind: "shared-set", configSetId: "set-a", revision: 1 } }],
      highlights: [{ definition: sharedRule, source: { kind: "shared-set", configSetId: "set-a", revision: 1 } }],
      functions: [{ definition: sharedFunction, source: { kind: "shared-set", configSetId: "set-a", revision: 1 } }],
      keyMappings: [],
    },
    // localDefinitionsByKind stays at its default empty state: none of the
    // entries above have a local override backing them.
  });

  assert.equal(aliasManager.removeAliasByTrigger("score"), false);
  const aliasResult = aliasManager.setEnabledByTarget("score", false);
  assert.equal(aliasResult.enabled, true, "unchanged shared alias stays reported as still enabled");

  assert.equal(highlightManager.removeRuleByPattern("^prompt"), false);

  const functionResult = functionManager.setEnabledByTarget("heal", false);
  assert.equal(functionResult.enabled, true, "unchanged shared function stays reported as still enabled");

  assert.equal(dispatchedEvents.length, 0, "no data-changed event fires when nothing local actually changed");
});

test("bridge-active local mutations dispatch the legacy data-changed events", () => {
  resetManagersForFallback();

  const localAlias = {
    id: "alias-local",
    enabled: true,
    trigger: "north",
    description: "",
    group: "",
    isRegex: false,
    ignoreCase: true,
    steps: [{ type: "send_command", template: "go north" }],
  };
  const localRule = {
    id: "rule-local",
    enabled: true,
    patternSource: "^prompt",
    description: "",
    group: "",
    ignoreCase: false,
    style: { fg: "yellow", bg: "black", bold: false },
  };

  const { bridge } = installFakeBridge({
    definitionsByKind: {
      aliases: [{ definition: localAlias, source: { kind: "local" } }],
      highlights: [{ definition: localRule, source: { kind: "local" } }],
      functions: [],
      keyMappings: [],
    },
  });
  bridge.localDefinitionsByKind.aliases = [localAlias];
  bridge.localDefinitionsByKind.highlights = [localRule];

  aliasManager.setEnabledByTarget("north", false);
  assert.equal(dispatchedEvents.at(-1).type, "darkwind:alias-data-changed");

  dispatchedEvents.length = 0;
  aliasManager.upsertSimpleAlias("south", "go south");
  assert.equal(dispatchedEvents.at(-1).type, "darkwind:alias-data-changed");

  dispatchedEvents.length = 0;
  highlightManager.upsertSimpleRule("^welcome", "green");
  assert.equal(dispatchedEvents.at(-1).type, "darkwind:highlight-data-changed");

  dispatchedEvents.length = 0;
  highlightManager.removeRuleByPattern("^prompt");
  assert.equal(dispatchedEvents.at(-1).type, "darkwind:highlight-data-changed");

  dispatchedEvents.length = 0;
  functionManager.saveScope(undefined, {
    functions: [{ id: "fn-1", enabled: true, name: "heal", description: "", group: "", script: "send heal" }],
  });
  assert.equal(dispatchedEvents.at(-1).type, "darkwind:function-data-changed");
});

test("_resolveKeyMappings filters out disabled key-mapping definitions", () => {
  resetManagersForFallback();

  installFakeBridge({
    definitionsByKind: {
      aliases: [],
      highlights: [],
      functions: [],
      keyMappings: [
        {
          definition: { id: "km-1", enabled: true, code: "F1", label: "F1", legacyKey: "", command: "look" },
          source: { kind: "local" },
        },
        {
          definition: { id: "km-2", enabled: false, code: "F2", label: "F2", legacyKey: "", command: "score" },
          source: { kind: "local" },
        },
      ],
    },
  });

  assert.deepEqual(settingsManager.get("keyMappings"), [
    { code: "F1", label: "F1", legacyKey: "", command: "look" },
  ]);
});

test("Effective configuration adapters execute through Vite SSR", async (t) => {
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

  const identity = await ssr.runner.import("/configuration/identity.ts");
  const resolve = await ssr.runner.import("/configuration/resolve.ts");
  const service = await ssr.runner.import("/configuration/service.ts");
  const schema = await ssr.runner.import("/storage/schema.ts");
  const repository = await ssr.runner.import("/storage/repository.ts");
  const ids = await ssr.runner.import("/model/ids.ts");

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

  function createSequentialUuidFactory(prefix = "00000000-0000-4000-8000-") {
    let counter = 0;
    return () => {
      counter += 1;
      return `${prefix}${counter.toString(16).padStart(12, "0")}`;
    };
  }

  function buildGraph() {
    const factory = createSequentialUuidFactory();
    const serverId = ids.createServerProfileId(factory);
    const characterAId = ids.createCharacterProfileId(factory);
    const characterBId = ids.createCharacterProfileId(factory);
    const aliasSetId = ids.createConfigSetId(factory);
    const keySetId = ids.createConfigSetId(factory);

    return {
      schemaVersion: 1,
      defaults: { themeKey: "darkwind-default", defaultCharacterProfileId: characterAId },
      serverProfiles: {
        [serverId]: {
          id: serverId,
          protocol: "wss",
          host: "mud.example.com",
          port: 4242,
          label: "Example MUD",
          capabilities: {},
          worldKey: "shared-world-key",
        },
      },
      characterProfiles: {
        [characterAId]: {
          id: characterAId,
          serverProfileId: serverId,
          label: "Main",
          configSetRefs: {
            aliases: [aliasSetId],
            triggers: [],
            highlights: [],
            functions: [],
            keyMappings: [keySetId],
            timers: [],
          },
          localDefinitions: {
            aliases: [{
              id: "alias-local-a",
              enabled: true,
              trigger: "score",
              description: "",
              group: "",
              isRegex: false,
              ignoreCase: true,
              steps: [{ type: "send_command", template: "score local-a" }],
            }],
            triggers: [],
            highlights: [],
            functions: [],
            keyMappings: [],
            timers: [],
          },
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
          configSetRefs: {
            aliases: [aliasSetId],
            triggers: [],
            highlights: [],
            functions: [],
            keyMappings: [],
            timers: [],
          },
          localDefinitions: {
            aliases: [],
            triggers: [],
            highlights: [],
            functions: [],
            keyMappings: [],
            timers: [],
          },
          commandHistory: [],
          workspace: { version: 1, payload: {} },
          audio: {
            ambient: { enabled: true, volume: 1 },
            combat: { enabled: true, volume: 1 },
            notification: { enabled: true, volume: 1 },
          },
        },
      },
      configurationSets: {
        [aliasSetId]: {
          id: aliasSetId,
          kind: "aliases",
          label: "Shared aliases",
          revision: 1,
          definitions: [{
            id: "alias-shared",
            enabled: true,
            trigger: "score",
            description: "",
            group: "",
            isRegex: false,
            ignoreCase: true,
            steps: [{ type: "send_command", template: "score shared" }],
          }],
        },
        [keySetId]: {
          id: keySetId,
          kind: "keyMappings",
          label: "Shared keys",
          revision: 1,
          definitions: [{
            id: "keymap-shared",
            enabled: true,
            code: "F2",
            label: "F2",
            legacyKey: "",
            command: "inventory",
          }],
        },
      },
      ids: { serverId, characterAId, characterBId, aliasSetId, keySetId },
    };
  }

  function createServiceBridge(storage, initialCharacterProfileId) {
    let activeCharacterProfileId = initialCharacterProfileId;

    function readSnapshot() {
      const state = repository.readState(storage);
      assert.equal(state.success, true);
      const resolved = resolve.resolveEffectiveConfiguration(state.data, activeCharacterProfileId);
      assert.equal(resolved.success, true);
      return resolved.data;
    }

    function readLocalDefinitions(kind) {
      const state = repository.readState(storage);
      assert.equal(state.success, true);
      return state.data.characterProfiles[activeCharacterProfileId].localDefinitions[kind];
    }

    const bridge = {
      getActiveCharacterProfileId() {
        return activeCharacterProfileId;
      },
      setActiveCharacterProfileId(nextId) {
        activeCharacterProfileId = nextId;
      },
      getEffectiveDefinitions(kind) {
        return readSnapshot()[kind];
      },
      replaceLocalDefinitions(kind, definitions) {
        const result = service.replaceLocalDefinitions(
          storage,
          activeCharacterProfileId,
          kind,
          definitions,
        );
        if (!result.success) {
          throw new Error(`${result.code}: ${result.message}`);
        }
      },
      upsertLocalDefinitionByIdentity(kind, definition) {
        const locals = structuredClone(readLocalDefinitions(kind));
        const key = identity.identityKeyFor(kind, definition);
        const index = locals.findIndex((item) => identity.identityKeyFor(kind, item) === key);
        if (index >= 0) locals[index] = structuredClone(definition);
        else locals.push(structuredClone(definition));
        bridge.replaceLocalDefinitions(kind, locals);
      },
      removeLocalDefinitionByIdentity(kind, identityKey) {
        const before = readLocalDefinitions(kind);
        const locals = before.filter((item) => identity.identityKeyFor(kind, item) !== identityKey);
        if (locals.length === before.length) return false;
        bridge.replaceLocalDefinitions(kind, locals);
        return true;
      },
      setLocalDefinitionEnabledByIdentity(kind, identityKey, enabled) {
        const locals = structuredClone(readLocalDefinitions(kind));
        const item = locals.find((entry) => identity.identityKeyFor(kind, entry) === identityKey);
        if (!item) return false;
        item.enabled = enabled !== false;
        bridge.replaceLocalDefinitions(kind, locals);
        return true;
      },
      subscribe(listener) {
        return service.subscribe(activeCharacterProfileId, listener);
      },
    };

    return bridge;
  }

  t.after(() => {
    service.resetConfigurationSubscriptionsForTests();
    compat.resetConfigurationCompatBridgeForTests();
  });

  await t.test("local override and shared provenance surface through manager readers", () => {
    resetManagersForFallback();
    dom.host = createThrowingDom().host;
    dom.port = createThrowingDom().port;
    dom.protocolSelect = createThrowingDom().protocolSelect;

    const graph = buildGraph();
    const storage = createMemoryStorage();
    repository.commit(storage, graph);
    compat.installConfigurationCompatBridge(createServiceBridge(storage, graph.ids.characterAId));

    const withSource = aliasManager.findAliasByTriggerWithSource("score");
    assert.equal(withSource.steps[0].template, "score local-a");
    assert.equal(withSource.source.kind, "local");

    graph.characterProfiles[graph.ids.characterAId].localDefinitions.aliases = [];
    repository.commit(storage, graph);
    compat.installConfigurationCompatBridge(createServiceBridge(storage, graph.ids.characterAId));

    const sharedOnly = aliasManager.findAliasByTriggerWithSource("score");
    assert.equal(sharedOnly.steps[0].template, "score shared");
    assert.equal(sharedOnly.source.kind, "shared-set");
    assert.equal(sharedOnly.source.configSetId, graph.ids.aliasSetId);
  });

  await t.test("character isolation holds for local alias writes on the same server", () => {
    resetManagersForFallback();
    dom.host = createThrowingDom().host;
    dom.port = createThrowingDom().port;
    dom.protocolSelect = createThrowingDom().protocolSelect;

    const graph = buildGraph();
    const storage = createMemoryStorage();
    repository.commit(storage, graph);

    const bridge = createServiceBridge(storage, graph.ids.characterAId);
    compat.installConfigurationCompatBridge(bridge);

    aliasManager.upsertSimpleAlias("north", "go north");
    assert.equal(aliasManager.matchAlias("north")?.alias.steps[0].template, "go north");

    bridge.setActiveCharacterProfileId(graph.ids.characterBId);
    assert.equal(aliasManager.matchAlias("north"), null);
    assert.equal(aliasManager.getScopeSnapshot().aliases[0].steps[0].template, "score shared");
  });

  await t.test("removing or disabling a shared-only alias through the real service reports no change", () => {
    resetManagersForFallback();
    dom.host = createThrowingDom().host;
    dom.port = createThrowingDom().port;
    dom.protocolSelect = createThrowingDom().protocolSelect;

    const graph = buildGraph();
    graph.characterProfiles[graph.ids.characterAId].localDefinitions.aliases = [];
    const storage = createMemoryStorage();
    repository.commit(storage, graph);
    compat.installConfigurationCompatBridge(createServiceBridge(storage, graph.ids.characterAId));

    assert.equal(aliasManager.findAliasByTriggerWithSource("score").source.kind, "shared-set");
    assert.equal(aliasManager.removeAliasByTrigger("score"), false);

    const setResult = aliasManager.setEnabledByTarget("score", false);
    assert.equal(setResult.enabled, true, "shared-only alias stays reported as still enabled");

    const persisted = JSON.parse(storage.getItem(schema.SESSION_CORE_STORAGE_KEY));
    assert.deepEqual(persisted.characterProfiles[graph.ids.characterAId].localDefinitions.aliases, []);
    assert.equal(
      persisted.configurationSets[graph.ids.aliasSetId].definitions[0].id,
      "alias-shared",
      "the shared set itself is untouched",
    );
  });

  await t.test("key mapping ids remain stable across consecutive bridge saves", () => {
    resetManagersForFallback();
    dom.host = createThrowingDom().host;
    dom.port = createThrowingDom().port;
    dom.protocolSelect = createThrowingDom().protocolSelect;

    const graph = buildGraph();
    graph.characterProfiles[graph.ids.characterAId].localDefinitions.keyMappings = [{
      id: "keymap-1",
      enabled: true,
      code: "F1",
      label: "F1",
      legacyKey: "",
      command: "look",
    }];
    const storage = createMemoryStorage();
    repository.commit(storage, graph);
    compat.installConfigurationCompatBridge(createServiceBridge(storage, graph.ids.characterAId));

    settingsManager._draftSettings = {
      ...settingsManager._settings,
      keyMappings: [{ code: "F1", label: "F1", legacyKey: "", command: "look north" }],
    };
    settingsManager._applyDraftChanges(false);

    const firstPersisted = JSON.parse(storage.getItem(schema.SESSION_CORE_STORAGE_KEY));
    const firstId = firstPersisted.characterProfiles[graph.ids.characterAId].localDefinitions.keyMappings[0].id;
    assert.equal(firstId, "keymap-1");

    settingsManager._draftSettings.keyMappings[0].command = "look south";
    settingsManager._applyDraftChanges(false);

    const secondPersisted = JSON.parse(storage.getItem(schema.SESSION_CORE_STORAGE_KEY));
    const secondId = secondPersisted.characterProfiles[graph.ids.characterAId].localDefinitions.keyMappings[0].id;
    assert.equal(secondId, "keymap-1");
    assert.equal(
      secondPersisted.characterProfiles[graph.ids.characterAId].localDefinitions.keyMappings[0].command,
      "look south",
    );
  });

  await t.test("key mapping ids never collide across a row deletion combined with a code edit", () => {
    resetManagersForFallback();
    dom.host = createThrowingDom().host;
    dom.port = createThrowingDom().port;
    dom.protocolSelect = createThrowingDom().protocolSelect;

    const graph = buildGraph();
    graph.characterProfiles[graph.ids.characterAId].localDefinitions.keyMappings = [
      { id: "keymap-a", enabled: true, code: "F1", label: "F1", legacyKey: "", command: "look" },
      { id: "keymap-b", enabled: true, code: "F3", label: "F3", legacyKey: "", command: "score" },
      { id: "keymap-c", enabled: true, code: "F4", label: "F4", legacyKey: "", command: "inventory" },
    ];
    const storage = createMemoryStorage();
    repository.commit(storage, graph);
    compat.installConfigurationCompatBridge(createServiceBridge(storage, graph.ids.characterAId));

    // Delete the F1 row and, in the same save, change the F4 row's code to
    // F5 - a row shift plus a code edit in one save, which previously let
    // the F5 row silently inherit F3's id by array position.
    settingsManager._draftSettings = {
      ...settingsManager._settings,
      keyMappings: [
        { code: "F3", label: "F3", legacyKey: "", command: "score" },
        { code: "F5", label: "F5", legacyKey: "", command: "inventory" },
      ],
    };
    settingsManager._applyDraftChanges(false);

    const persisted = JSON.parse(storage.getItem(schema.SESSION_CORE_STORAGE_KEY));
    const savedMappings = persisted.characterProfiles[graph.ids.characterAId].localDefinitions.keyMappings;
    const ids = savedMappings.map((mapping) => mapping.id);
    assert.equal(new Set(ids).size, ids.length, "every saved key mapping keeps a distinct id");
    assert.equal(savedMappings.find((mapping) => mapping.code === "F3").id, "keymap-b");
    assert.notEqual(savedMappings.find((mapping) => mapping.code === "F5").id, "keymap-b");
  });
});
