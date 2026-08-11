import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** In-memory Web Storage mock for repository and configuration service tests. */
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
    writeCount: 0,
    snapshot() {
      return new Map(data);
    },
  };
}

/** Deterministic UUID factory matching the model test contract. */
function createSequentialUuidFactory(prefix = "00000000-0000-4000-8000-") {
  let counter = 0;
  return () => {
    counter += 1;
    const suffix = counter.toString(16).padStart(12, "0");
    return `${prefix}${suffix}`;
  };
}

function buildMinimalGraph(ids, options = {}) {
  const factory = createSequentialUuidFactory();
  const serverId = ids.createServerProfileId(factory);
  const characterAId = ids.createCharacterProfileId(factory);
  const characterBId = ids.createCharacterProfileId(factory);
  const aliasSetAId = ids.createConfigSetId(factory);
  const aliasSetBId = ids.createConfigSetId(factory);

  const graph = {
    schemaVersion: 1,
    defaults: {
      themeKey: "darkwind-default",
      defaultCharacterProfileId: characterAId,
    },
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
          aliases: [aliasSetAId, aliasSetBId],
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
      [characterBId]: {
        id: characterBId,
        serverProfileId: serverId,
        label: "Alt",
        configSetRefs: {
          aliases: [],
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
      [aliasSetAId]: {
        id: aliasSetAId,
        kind: "aliases",
        label: "Shared A",
        revision: 1,
        definitions: [
          {
            id: "alias-shared-a",
            enabled: true,
            trigger: "score",
            description: "Shared A alias",
            group: "",
            isRegex: false,
            ignoreCase: true,
            steps: [{ type: "send_command", template: "score" }],
          },
        ],
      },
      [aliasSetBId]: {
        id: aliasSetBId,
        kind: "aliases",
        label: "Shared B",
        revision: 1,
        definitions: [
          {
            id: "alias-shared-b",
            enabled: true,
            trigger: "score",
            description: "Shared B alias",
            group: "",
            isRegex: false,
            ignoreCase: true,
            steps: [{ type: "send_command", template: "score shared-b" }],
          },
        ],
      },
    },
    ids: {
      serverId,
      characterAId,
      characterBId,
      aliasSetAId,
      aliasSetBId,
    },
  };

  return { ...graph, ...options, ids: { ...graph.ids, ...(options.ids ?? {}) } };
}

test("Effective configuration executes through Vite SSR", async (t) => {
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
  const snapshot = await ssr.runner.import("/configuration/snapshot.ts");
  const resolve = await ssr.runner.import("/configuration/resolve.ts");
  const service = await ssr.runner.import("/configuration/service.ts");
  const schema = await ssr.runner.import("/storage/schema.ts");
  const repository = await ssr.runner.import("/storage/repository.ts");
  const ids = await ssr.runner.import("/model/ids.ts");

  t.after(() => {
    service.resetConfigurationSubscriptionsForTests();
  });

  await t.test("identity keys match legacy normalization per kind", () => {
    assert.equal(identity.aliasIdentityKey({ trigger: "  Go North " }), "go north");
    assert.equal(identity.triggerIdentityKey({ pattern: "  You see  " }), "You see");
    assert.equal(identity.highlightIdentityKey({ patternSource: " ^You see " }), "^You see");
    assert.equal(identity.functionIdentityKey({ name: "  Heal  " }), "heal");
    assert.equal(identity.keyMappingIdentityKey({ code: "  F1  " }), "F1");
    assert.equal(identity.timerIdentityKey({ name: "  Tick  " }), "tick");
    assert.equal(identity.identityKeyFor("aliases", { trigger: "LOOK" }), "look");
  });

  await t.test("built-in tier is empty and snapshots are deeply immutable", () => {
    for (const kind of [
      "aliases",
      "triggers",
      "highlights",
      "functions",
      "keyMappings",
      "timers",
    ]) {
      assert.equal(snapshot.BUILTIN_DEFINITIONS[kind].length, 0);
    }

    const frozen = snapshot.freezeSnapshot({
      characterProfileId: "00000000-0000-4000-8000-000000000001",
      aliases: [
        {
          definition: {
            id: "alias-1",
            enabled: true,
            trigger: "look",
            description: "",
            group: "",
            isRegex: false,
            ignoreCase: false,
            steps: [{ type: "send_command", template: "look" }],
          },
          source: { kind: "local" },
        },
      ],
      triggers: [],
      highlights: [],
      functions: [],
      keyMappings: [],
      timers: [],
    });

    assert.throws(() => {
      frozen.aliases.push({});
    });
    assert.throws(() => {
      frozen.aliases[0].definition.trigger = "mutated";
    });
    assert.throws(() => {
      frozen.aliases[0].definition.steps[0].template = "mutated";
    });
  });

  await t.test("resolve applies three-tier precedence with first-seen positions", () => {
    const graph = buildMinimalGraph(ids);
    const { characterAId, aliasSetAId, aliasSetBId } = graph.ids;

    graph.characterProfiles[characterAId].localDefinitions.aliases = [
      {
        id: "alias-local",
        enabled: true,
        trigger: "score",
        description: "Local alias",
        group: "",
        isRegex: false,
        ignoreCase: true,
        steps: [{ type: "send_command", template: "score local" }],
      },
    ];

    const resolved = resolve.resolveEffectiveConfiguration(graph, characterAId);
    assert.equal(resolved.success, true);
    assert.equal(resolved.data.aliases.length, 1);
    assert.equal(resolved.data.aliases[0].definition.steps[0].template, "score local");
    assert.equal(resolved.data.aliases[0].source.kind, "local");

    graph.configurationSets[aliasSetAId].definitions[0].steps[0].template = "score shared-a";
    assert.equal(resolved.data.aliases[0].definition.steps[0].template, "score local");

    const sharedOnly = buildMinimalGraph(ids);
    sharedOnly.characterProfiles[sharedOnly.ids.characterAId].localDefinitions.aliases = [];
    const sharedResolved = resolve.resolveEffectiveConfiguration(
      sharedOnly,
      sharedOnly.ids.characterAId,
    );
    assert.equal(sharedResolved.data.aliases[0].definition.steps[0].template, "score shared-b");
    assert.equal(sharedResolved.data.aliases[0].source.kind, "shared-set");
    assert.equal(sharedResolved.data.aliases[0].source.configSetId, aliasSetBId);
    assert.equal(sharedResolved.data.aliases[0].source.revision, 1);

    const firstSetOnly = buildMinimalGraph(ids);
    firstSetOnly.characterProfiles[firstSetOnly.ids.characterAId].configSetRefs.aliases = [
      aliasSetAId,
    ];
    firstSetOnly.characterProfiles[firstSetOnly.ids.characterAId].localDefinitions.aliases = [];
    const firstResolved = resolve.resolveEffectiveConfiguration(
      firstSetOnly,
      firstSetOnly.ids.characterAId,
    );
    assert.equal(firstResolved.data.aliases[0].definition.steps[0].template, "score");
    assert.equal(firstResolved.data.aliases[0].source.configSetId, aliasSetAId);
  });

  await t.test("missing character profile returns typed failure", () => {
    const graph = buildMinimalGraph(ids);
    const missingId = ids.createCharacterProfileId(createSequentialUuidFactory("20000000-0000-4000-8000-"));
    const result = resolve.resolveEffectiveConfiguration(graph, missingId);
    assert.equal(result.success, false);
    assert.match(result.errors[0].code, /missing-character-profile/);
  });

  await t.test("publish rejects stale revisions and unknown sets without writes or notifications", () => {
    const graph = buildMinimalGraph(ids);
    const storage = createMemoryStorage();
    repository.commit(storage, graph);

    const notifications = [];
    service.subscribe(graph.ids.characterAId, (nextSnapshot) => {
      notifications.push(nextSnapshot);
    });

    const stale = service.publishConfigurationSet(storage, {
      configSetId: graph.ids.aliasSetAId,
      expectedRevision: 99,
      definitions: graph.configurationSets[graph.ids.aliasSetAId].definitions,
    });
    assert.equal(stale.success, false);
    assert.equal(stale.code, "stale-revision");
    assert.equal(notifications.length, 0);
    assert.equal(
      JSON.parse(storage.getItem(schema.SESSION_CORE_STORAGE_KEY)).configurationSets[
        graph.ids.aliasSetAId
      ].revision,
      1,
    );

    const unknownSetId = ids.createConfigSetId(createSequentialUuidFactory("30000000-0000-4000-8000-"));
    const unknown = service.publishConfigurationSet(storage, {
      configSetId: unknownSetId,
      expectedRevision: 1,
      definitions: [],
    });
    assert.equal(unknown.success, false);
    assert.equal(unknown.code, "unknown-config-set");
    assert.equal(notifications.length, 0);
  });

  await t.test("successful publish notifies every subscribed character once", () => {
    service.resetConfigurationSubscriptionsForTests();
    const graph = buildMinimalGraph(ids);
    graph.characterProfiles[graph.ids.characterAId].configSetRefs.aliases = [graph.ids.aliasSetAId];
    const storage = createMemoryStorage();
    repository.commit(storage, graph);

    const notificationsByCharacter = new Map();
    service.subscribe(graph.ids.characterAId, (nextSnapshot) => {
      const list = notificationsByCharacter.get(graph.ids.characterAId) ?? [];
      list.push(nextSnapshot);
      notificationsByCharacter.set(graph.ids.characterAId, list);
    });
    service.subscribe(graph.ids.characterBId, (nextSnapshot) => {
      const list = notificationsByCharacter.get(graph.ids.characterBId) ?? [];
      list.push(nextSnapshot);
      notificationsByCharacter.set(graph.ids.characterBId, list);
    });

    const nextDefinitions = [
      {
        id: "alias-shared-a",
        enabled: true,
        trigger: "score",
        description: "Updated alias",
        group: "",
        isRegex: false,
        ignoreCase: true,
        steps: [{ type: "send_command", template: "score updated" }],
      },
    ];

    const published = service.publishConfigurationSet(storage, {
      configSetId: graph.ids.aliasSetAId,
      expectedRevision: 1,
      definitions: nextDefinitions,
      label: "Shared A v2",
    });
    assert.equal(published.success, true);
    assert.equal(notificationsByCharacter.get(graph.ids.characterAId).length, 1);
    assert.equal(notificationsByCharacter.get(graph.ids.characterBId).length, 1);
    assert.equal(
      notificationsByCharacter.get(graph.ids.characterAId)[0].aliases[0].definition.steps[0]
        .template,
      "score updated",
    );
    assert.equal(notificationsByCharacter.get(graph.ids.characterBId)[0].aliases.length, 0);
  });

  await t.test("throwing listener does not block other subscribers", () => {
    service.resetConfigurationSubscriptionsForTests();
    const graph = buildMinimalGraph(ids);
    const storage = createMemoryStorage();
    repository.commit(storage, graph);

    let secondHeard = false;
    service.subscribe(graph.ids.characterAId, () => {
      throw new Error("boom");
    });
    service.subscribe(graph.ids.characterBId, () => {
      secondHeard = true;
    });

    const published = service.publishConfigurationSet(storage, {
      configSetId: graph.ids.aliasSetAId,
      expectedRevision: 1,
      definitions: graph.configurationSets[graph.ids.aliasSetAId].definitions,
    });
    assert.equal(published.success, true);
    assert.equal(secondHeard, true);
  });

  await t.test("replaceLocalDefinitions updates one character and notifies only that character", () => {
    service.resetConfigurationSubscriptionsForTests();
    const graph = buildMinimalGraph(ids);
    const storage = createMemoryStorage();
    repository.commit(storage, graph);

    const notificationsByCharacter = new Map();
    service.subscribe(graph.ids.characterAId, (nextSnapshot) => {
      const list = notificationsByCharacter.get(graph.ids.characterAId) ?? [];
      list.push(nextSnapshot);
      notificationsByCharacter.set(graph.ids.characterAId, list);
    });
    service.subscribe(graph.ids.characterBId, (nextSnapshot) => {
      const list = notificationsByCharacter.get(graph.ids.characterBId) ?? [];
      list.push(nextSnapshot);
      notificationsByCharacter.set(graph.ids.characterBId, list);
    });

    const nextAliases = [
      {
        id: "alias-local-a",
        enabled: true,
        trigger: "look",
        description: "Local alias",
        group: "",
        isRegex: false,
        ignoreCase: true,
        steps: [{ type: "send_command", template: "look local" }],
      },
    ];

    const replaced = service.replaceLocalDefinitions(
      storage,
      graph.ids.characterAId,
      "aliases",
      nextAliases,
    );
    assert.equal(replaced.success, true);
    assert.equal(notificationsByCharacter.get(graph.ids.characterAId)?.length, 1);
    assert.equal(notificationsByCharacter.get(graph.ids.characterBId), undefined);

    const persisted = JSON.parse(storage.getItem(schema.SESSION_CORE_STORAGE_KEY));
    assert.equal(
      persisted.characterProfiles[graph.ids.characterAId].localDefinitions.aliases[0].steps[0]
        .template,
      "look local",
    );
    assert.deepEqual(persisted.characterProfiles[graph.ids.characterBId].localDefinitions.aliases, []);
    assert.equal(
      persisted.configurationSets[graph.ids.aliasSetAId].definitions[0].steps[0].template,
      "score",
    );
  });

  await t.test("replaceLocalDefinitions rejects unknown characters and missing state without writes", () => {
    service.resetConfigurationSubscriptionsForTests();
    const graph = buildMinimalGraph(ids);
    const storage = createMemoryStorage();
    repository.commit(storage, graph);

    const missingId = ids.createCharacterProfileId(createSequentialUuidFactory("40000000-0000-4000-8000-"));
    let notified = false;
    service.subscribe(graph.ids.characterAId, () => {
      notified = true;
    });

    const unknown = service.replaceLocalDefinitions(storage, missingId, "aliases", []);
    assert.equal(unknown.success, false);
    assert.equal(unknown.code, "unknown-character");
    assert.equal(notified, false);

    storage.removeItem(schema.SESSION_CORE_STORAGE_KEY);
    const missingState = service.replaceLocalDefinitions(storage, graph.ids.characterAId, "aliases", []);
    assert.equal(missingState.success, false);
    assert.equal(missingState.code, "missing-state");
  });
});
