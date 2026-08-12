import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  let writes = 0;

  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      writes += 1;
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
    writes() {
      return writes;
    },
  };
}

function buildGraph(characterAId, characterBId, serverId) {
  const emptyDefinitions = {
    aliases: [],
    triggers: [],
    highlights: [],
    functions: [],
    keyMappings: [],
    timers: [],
  };
  const emptyRefs = structuredClone(emptyDefinitions);
  const audio = {
    ambient: { enabled: true, volume: 1 },
    combat: { enabled: true, volume: 0.8 },
    notification: { enabled: false, volume: 0.4 },
  };

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
        capabilities: { future: "unchanged" },
        worldKey: "shared-world",
      },
    },
    characterProfiles: {
      [characterAId]: {
        id: characterAId,
        serverProfileId: serverId,
        label: "Main",
        configSetRefs: structuredClone(emptyRefs),
        localDefinitions: structuredClone(emptyDefinitions),
        commandHistory: ["look"],
        workspace: { version: 1, payload: { layout: "classic", left: 17 } },
        audio: structuredClone(audio),
      },
      [characterBId]: {
        id: characterBId,
        serverProfileId: serverId,
        label: "Alt",
        configSetRefs: structuredClone(emptyRefs),
        localDefinitions: structuredClone(emptyDefinitions),
        commandHistory: ["score"],
        workspace: { version: 1, payload: { layout: "floating", top: 23 } },
        audio: structuredClone(audio),
      },
    },
    configurationSets: {},
  };
}

test("character workspace persistence executes through Vite SSR", async (t) => {
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

  const ids = await ssr.runner.import("/model/ids.ts");
  const schema = await ssr.runner.import("/storage/schema.ts");
  const legacyKeys = await ssr.runner.import("/storage/legacy-keys.ts");
  const repository = await ssr.runner.import("/storage/repository.ts");
  const persistence = await ssr.runner.import("/workspace/persistence.ts");
  const uuidFactory = ids.createSequentialUuidFactory("20000000-0000-4000-8000-");
  const serverId = ids.createServerProfileId(uuidFactory);
  const characterAId = ids.createCharacterProfileId(uuidFactory);
  const characterBId = ids.createCharacterProfileId(uuidFactory);
  const originalGraph = buildGraph(characterAId, characterBId, serverId);
  const legacyBytes = '{"layout":"classic", "spacing": 2}';
  const dockviewA = { version: 1, layout: { grid: { root: "terminal" }, panels: ["terminal"] } };
  const dockviewB = { version: 1, layout: { grid: { root: "placeholder" }, width: 640 } };

  function createGraphStorage(graph = originalGraph) {
    return createMemoryStorage({
      [schema.SESSION_CORE_STORAGE_KEY]: JSON.stringify(graph),
      [legacyKeys.LEGACY_PANEL_STORAGE_KEY]: legacyBytes,
      unrelated: "keep-me",
    });
  }

  await t.test("migrated version 1 recovers and saves only the selected character", () => {
    const storage = createGraphStorage();
    const before = repository.readState(storage).data;

    assert.deepEqual(persistence.loadCharacterWorkspace(storage, characterAId), {
      success: true,
      snapshot: null,
      recovered: true,
      message: "Saved workspace is incompatible; using the default layout.",
    });
    assert.deepEqual(persistence.saveCharacterWorkspace(storage, characterAId, dockviewA), {
      success: true,
    });

    const after = repository.readState(storage).data;
    assert.deepEqual(after.characterProfiles[characterAId].workspace, {
      version: 2,
      payload: {
        dockview: dockviewA,
        legacy: before.characterProfiles[characterAId].workspace,
      },
    });
    assert.deepEqual(after.characterProfiles[characterBId], before.characterProfiles[characterBId]);
    assert.deepEqual(after.defaults, before.defaults);
    assert.deepEqual(after.serverProfiles, before.serverProfiles);
    assert.deepEqual(after.configurationSets, before.configurationSets);
    assert.equal(storage.getItem(legacyKeys.LEGACY_PANEL_STORAGE_KEY), legacyBytes);
    assert.equal(storage.getItem("unrelated"), "keep-me");
    assert.equal(storage.writes(), 1);
  });

  await t.test("valid version 2 loads and repeated saves retain one legacy fallback", () => {
    const graph = structuredClone(originalGraph);
    const legacy = graph.characterProfiles[characterAId].workspace;
    graph.characterProfiles[characterAId].workspace = {
      version: 2,
      payload: { dockview: dockviewA, legacy },
    };
    const storage = createGraphStorage(graph);

    assert.deepEqual(persistence.loadCharacterWorkspace(storage, characterAId), {
      success: true,
      snapshot: dockviewA,
      recovered: false,
    });
    assert.equal(persistence.saveCharacterWorkspace(storage, characterAId, dockviewB).success, true);
    assert.equal(persistence.saveCharacterWorkspace(storage, characterAId, dockviewA).success, true);

    const saved = repository.readState(storage).data.characterProfiles[characterAId].workspace;
    assert.deepEqual(saved, { version: 2, payload: { dockview: dockviewA, legacy } });
    assert.equal(saved.payload.legacy.version, 1);
    assert.equal(storage.writes(), 2);
  });

  await t.test("malformed and incompatible layouts recover without writing", () => {
    const cases = [
      { version: 2, payload: { dockview: { version: 1, layout: [] }, legacy: { version: 1, payload: {} } } },
      { version: 2, payload: { dockview: { version: 3, layout: {} }, legacy: { version: 1, payload: {} } } },
      { version: 9, payload: { future: true } },
    ];

    for (const workspace of cases) {
      const graph = structuredClone(originalGraph);
      graph.characterProfiles[characterAId].workspace = workspace;
      const storage = createGraphStorage(graph);
      const result = persistence.loadCharacterWorkspace(storage, characterAId);
      assert.equal(result.success, true);
      assert.equal(result.recovered, true);
      assert.equal(result.snapshot, null);
      assert.equal(storage.writes(), 0);
      assert.deepEqual(repository.readState(storage).data.characterProfiles[characterAId].workspace, workspace);
    }
  });

  await t.test("saving after malformed version 2 nests the rejected value only once", () => {
    const graph = structuredClone(originalGraph);
    const malformed = {
      version: 2,
      payload: {
        dockview: { version: 1, layout: [] },
        legacy: graph.characterProfiles[characterAId].workspace,
      },
    };
    graph.characterProfiles[characterAId].workspace = malformed;
    const storage = createGraphStorage(graph);

    assert.equal(persistence.saveCharacterWorkspace(storage, characterAId, dockviewA).success, true);
    assert.equal(persistence.saveCharacterWorkspace(storage, characterAId, dockviewB).success, true);

    const saved = repository.readState(storage).data.characterProfiles[characterAId].workspace;
    assert.deepEqual(saved, { version: 2, payload: { dockview: dockviewB, legacy: malformed } });
  });

  await t.test("unknown characters and invalid snapshots do not write", () => {
    const storage = createGraphStorage();
    const unknownId = ids.createCharacterProfileId(uuidFactory);

    assert.equal(persistence.loadCharacterWorkspace(storage, unknownId).code, "unknown-character");
    assert.equal(
      persistence.saveCharacterWorkspace(storage, unknownId, dockviewA).code,
      "unknown-character",
    );
    assert.equal(
      persistence.saveCharacterWorkspace(storage, characterAId, { version: 1, layout: [] }).code,
      "validation-failed",
    );
    assert.equal(storage.writes(), 0);
  });

  await t.test("graph validation and storage failures leave persisted bytes unchanged", () => {
    const validationStorage = createGraphStorage();
    const invalidSnapshot = { version: 1, layout: { unsupported: 1n } };
    const beforeValidation = validationStorage.getItem(schema.SESSION_CORE_STORAGE_KEY);
    const validationResult = persistence.saveCharacterWorkspace(
      validationStorage,
      characterAId,
      invalidSnapshot,
    );
    assert.equal(validationResult.code, "validation-failed");
    assert.equal(validationStorage.getItem(schema.SESSION_CORE_STORAGE_KEY), beforeValidation);

    const storageFailure = createGraphStorage();
    const beforeFailure = storageFailure.getItem(schema.SESSION_CORE_STORAGE_KEY);
    storageFailure.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const failureResult = persistence.saveCharacterWorkspace(
      storageFailure,
      characterAId,
      dockviewA,
    );
    assert.equal(failureResult.code, "storage-failed");
    assert.equal(storageFailure.getItem(schema.SESSION_CORE_STORAGE_KEY), beforeFailure);
    assert.equal(storageFailure.getItem(legacyKeys.LEGACY_PANEL_STORAGE_KEY), legacyBytes);
  });

  await t.test("missing or invalid application state reports missing-state", () => {
    const missing = createMemoryStorage();
    const invalid = createMemoryStorage({ [schema.SESSION_CORE_STORAGE_KEY]: "{}" });

    assert.equal(persistence.loadCharacterWorkspace(missing, characterAId).code, "missing-state");
    assert.equal(
      persistence.saveCharacterWorkspace(invalid, characterAId, dockviewA).code,
      "missing-state",
    );
    assert.equal(invalid.writes(), 0);
  });
});
