import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const fixturesDir = path.join(repoRoot, "test", "fixtures", "session-migration");

/** Loads a JSON fixture from the session-migration directory. */
function loadFixture(name) {
  const filePath = path.join(fixturesDir, `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/** In-memory Web Storage mock for repository and migration tests. */
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

/** Populates legacy storage keys from a fixture without touching Phase 1 keys. */
function populateLegacyStorage(storage, legacyKeys, fixture) {
  const entries = [
    [legacyKeys.LEGACY_ALIAS_STORAGE_KEY, fixture.aliases],
    [legacyKeys.LEGACY_HIGHLIGHT_STORAGE_KEY, fixture.highlights],
    [legacyKeys.LEGACY_TRIGGER_STORAGE_KEY, fixture.triggers],
    [legacyKeys.LEGACY_TIMER_STORAGE_KEY, fixture.timers],
    [legacyKeys.LEGACY_FUNCTION_STORAGE_KEY, fixture.functions],
    [legacyKeys.LEGACY_HISTORY_STORAGE_KEY, fixture.history],
    [legacyKeys.LEGACY_PANEL_STORAGE_KEY, fixture.panels],
    [legacyKeys.LEGACY_SOUND_STORAGE_KEY, fixture.sound],
    [legacyKeys.LEGACY_SETTINGS_STORAGE_KEY, fixture.settings],
  ];

  for (const [key, value] of entries) {
    if (value === undefined) {
      continue;
    }
    storage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
}

/** Asserts every stored legacy key is byte-for-byte unchanged after migration. */
function assertLegacyKeysUnchanged(before, after, legacyKeyList) {
  for (const key of legacyKeyList) {
    assert.equal(after.get(key) ?? null, before.get(key) ?? null, key);
  }
}

/** Finds the character profile whose server scope matches the active scope key. */
function findActiveCharacter(state, activeScopeKey) {
  for (const character of Object.values(state.characterProfiles)) {
    const server = state.serverProfiles[character.serverProfileId];
    const scopeKey = `${server.protocol === "wss" ? "wss" : "ws"}://${server.host}:${server.port}`;
    if (scopeKey === activeScopeKey) {
      return character;
    }
  }
  return undefined;
}

test("Phase 1 session storage executes through Vite SSR", async (t) => {
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

  const schema = await ssr.runner.import("/storage/schema.ts");
  const legacyKeys = await ssr.runner.import("/storage/legacy-keys.ts");
  const configValidator = await ssr.runner.import("/storage/config-validator.ts");
  const repository = await ssr.runner.import("/storage/repository.ts");
  const migration = await ssr.runner.import("/storage/legacy-migration.ts");
  const ids = await ssr.runner.import("/model/ids.ts");

  const uuidFactory = ids.createSequentialUuidFactory("10000000-0000-4000-8000-");
  const legacyKeyList = [...legacyKeys.LEGACY_STORAGE_KEYS];

  const scopeCases = [
    {
      name: "URL type wins over config",
      params: "?type=telnet&host=alpha.test&port=5000",
      config: { host: "beta.test", port: 4242, wss: true, gameName: "", hiddenPanels: [] },
      expected: "ws://alpha.test:5000",
    },
    {
      name: "URL wss=0 back-compat",
      params: "?wss=0&host=gamma.test",
      config: { host: "", port: 4242, wss: true, gameName: "", hiddenPanels: [] },
      expected: "ws://gamma.test:4242",
    },
    {
      name: "protocol override from storage",
      params: "",
      protocolOverride: "telnets",
      config: { host: "delta.test", port: 4242, wss: false, gameName: "", hiddenPanels: [] },
      expected: "wss://delta.test:4242",
    },
    {
      name: "config host/port defaults",
      params: "",
      config: { host: "epsilon.test", port: 7777, wss: true, gameName: "", hiddenPanels: [] },
      expected: "wss://epsilon.test:7777",
    },
    {
      name: "empty host collapses to default",
      params: "",
      config: { host: "", port: 4242, wss: true, gameName: "", hiddenPanels: [] },
      expected: "wss://default:4242",
    },
  ];

  for (const scopeCase of scopeCases) {
    const scopeKey = configValidator.computeActiveScopeKey({
      urlSearchParams: new URLSearchParams(scopeCase.params),
      protocolOverride: scopeCase.protocolOverride,
      config: scopeCase.config,
    });
    assert.equal(scopeKey, scopeCase.expected, scopeCase.name);
  }

  const malformedConfig = configValidator.validateConfigJsonInput({ host: 5 });
  assert.equal(malformedConfig.success, false);

  await t.test("single-scope legacy install migrates deterministically", async () => {
    const fixture = loadFixture("single-scope");
    const storage = createMemoryStorage();
    populateLegacyStorage(storage, legacyKeys, fixture);
    const before = storage.snapshot();

    const result = migration.migrateLegacyData(
      storage,
      fixture.config,
      new URLSearchParams(fixture.urlSearchParams),
      uuidFactory,
    );

    assert.equal(result.success, true);
    assert.equal(result.skipped, false);
    assert.equal(repository.hasValidState(storage), true);

    const state = repository.readState(storage).data;
    assert.equal(state.defaults.themeKey, "dracula");
    assert.equal(
      state.serverProfiles[Object.keys(state.serverProfiles)[0]].worldKey,
      schema.LEGACY_MIGRATION_WORLD_KEY,
    );

    const activeCharacter = findActiveCharacter(state, "wss://mud.example.com:4242");
    assert.ok(activeCharacter);
    assert.deepEqual(activeCharacter.commandHistory, ["look", "score"]);
    assert.equal(activeCharacter.localDefinitions.aliases.length, 1);
    assert.equal(activeCharacter.localDefinitions.keyMappings.length, 1);
    assert.equal(activeCharacter.audio.combat.enabled, false);
    assert.equal(activeCharacter.audio.ambient.volume, 0.5);

    assertLegacyKeysUnchanged(before, storage.snapshot(), legacyKeyList);
  });

  await t.test("multi-scope install attaches globals only to active character", async () => {
    const fixture = loadFixture("multi-scope");
    const storage = createMemoryStorage();
    populateLegacyStorage(storage, legacyKeys, fixture);
    const before = storage.snapshot();

    const result = migration.migrateLegacyData(
      storage,
      fixture.config,
      new URLSearchParams(fixture.urlSearchParams),
      uuidFactory,
    );
    assert.equal(result.success, true);

    const state = repository.readState(storage).data;
    const active = findActiveCharacter(state, "wss://active.example.com:4242");
    const other = findActiveCharacter(state, "ws://other.example.com:5000");
    assert.ok(active);
    assert.ok(other);

    assert.deepEqual(active.commandHistory, ["active-history"]);
    assert.notEqual(active.workspace.payload.layout, undefined);
    assert.equal(active.audio.combat.enabled, true);
    assert.equal(other.commandHistory.length, 0);
    assert.deepEqual(other.workspace.payload, {});
    assert.equal(other.audio.notification.enabled, true);

    assertLegacyKeysUnchanged(before, storage.snapshot(), legacyKeyList);
  });

  await t.test("fresh install still creates an active character profile", async () => {
    const fixture = loadFixture("fresh-install");
    const storage = createMemoryStorage();

    const result = migration.migrateLegacyData(
      storage,
      fixture.config,
      new URLSearchParams(fixture.urlSearchParams),
      uuidFactory,
    );
    assert.equal(result.success, true);
    assert.equal(repository.hasValidState(storage), true);

    const state = repository.readState(storage).data;
    assert.equal(Object.keys(state.characterProfiles).length, 1);
    assert.equal(Object.keys(state.serverProfiles).length, 1);
  });

  await t.test("corrupted legacy key is recorded in provenance", async () => {
    const fixture = loadFixture("corrupted-key");
    const storage = createMemoryStorage();
    populateLegacyStorage(storage, legacyKeys, fixture);

    const result = migration.migrateLegacyData(
      storage,
      fixture.config,
      new URLSearchParams(fixture.urlSearchParams),
      uuidFactory,
    );
    assert.equal(result.success, true);

    const provenanceRaw = storage.getItem(schema.SESSION_MIGRATION_PROVENANCE_KEY);
    assert.ok(provenanceRaw);
    const provenance = JSON.parse(provenanceRaw);
    assert.ok(
      provenance.skippedLegacyKeys.some(
        (entry) => entry.key === legacyKeys.LEGACY_ALIAS_STORAGE_KEY,
      ),
    );

    const state = repository.readState(storage).data;
    assert.equal(
      state.characterProfiles[Object.keys(state.characterProfiles)[0]]
        .localDefinitions.triggers.length,
      1,
    );
  });

  await t.test("partial legacy install still migrates available scopes", async () => {
    const fixture = loadFixture("partial-scope");
    const storage = createMemoryStorage();
    populateLegacyStorage(storage, legacyKeys, fixture);

    const result = migration.migrateLegacyData(
      storage,
      fixture.config,
      new URLSearchParams(fixture.urlSearchParams),
      uuidFactory,
    );
    assert.equal(result.success, true);

    const state = repository.readState(storage).data;
    const active = findActiveCharacter(state, "wss://partial.example.com:4242");
    assert.ok(active);
    assert.equal(active.localDefinitions.aliases.length, 1);
    assert.equal(active.localDefinitions.timers.length, 0);
  });

  await t.test("existing valid Phase 1 state is an idempotent no-op", async () => {
    const fixture = loadFixture("single-scope");
    const storage = createMemoryStorage();
    populateLegacyStorage(storage, legacyKeys, fixture);

    const first = migration.migrateLegacyData(
      storage,
      fixture.config,
      new URLSearchParams(fixture.urlSearchParams),
      uuidFactory,
    );
    assert.equal(first.success, true);

    const legacyReads = [];
    const originalGetItem = storage.getItem.bind(storage);
    storage.getItem = (key) => {
      if (legacyKeyList.includes(key)) {
        legacyReads.push(key);
      }
      return originalGetItem(key);
    };

    const second = migration.migrateLegacyData(
      storage,
      fixture.config,
      new URLSearchParams(fixture.urlSearchParams),
      uuidFactory,
    );
    assert.equal(second.success, true);
    assert.equal(second.skipped, true);
    assert.equal(legacyReads.length, 0);
  });

  await t.test("quota failure leaves no committed Phase 1 graph", async () => {
    const fixture = loadFixture("single-scope");
    const storage = createMemoryStorage();
    populateLegacyStorage(storage, legacyKeys, fixture);

    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === schema.SESSION_CORE_STORAGE_KEY) {
        throw new Error("QuotaExceededError");
      }
      originalSetItem(key, value);
    };

    const result = migration.migrateLegacyData(
      storage,
      fixture.config,
      new URLSearchParams(fixture.urlSearchParams),
      uuidFactory,
    );
    assert.equal(result.success, false);
    assert.equal(result.code, "commit-failed");
    assert.equal(storage.getItem(schema.SESSION_CORE_STORAGE_KEY), null);
  });

  await t.test("repository commit rejects invalid graphs and provenance failures are swallowed", async () => {
    const storage = createMemoryStorage();
    const invalidCommit = repository.commit(storage, {
      schemaVersion: 2,
      defaults: { themeKey: "darkflow-default" },
      serverProfiles: {},
      characterProfiles: {},
      configurationSets: {},
    });
    assert.equal(invalidCommit.success, false);
    assert.equal(invalidCommit.code, "validation-failed");

    const failingStorage = createMemoryStorage();
    failingStorage.setItem = () => {
      throw new Error("blocked");
    };

    repository.writeProvenance(failingStorage, {
      schemaVersion: 1,
      migratedAt: new Date().toISOString(),
      sourceScopeKeys: [],
      activeScopeKey: "wss://default:4242",
      skippedLegacyKeys: [],
    });
    assert.equal(
      failingStorage.getItem(schema.SESSION_MIGRATION_PROVENANCE_KEY),
      null,
    );
  });
});
