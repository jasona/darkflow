import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Deterministic UUID factory matching the model test contract. */
function createSequentialUuidFactory(prefix = "00000000-0000-4000-8000-") {
  let counter = 0;
  return () => {
    counter += 1;
    const suffix = counter.toString(16).padStart(12, "0");
    return `${prefix}${suffix}`;
  };
}

function buildValidGraph(ids) {
  const factory = createSequentialUuidFactory();
  const serverId = ids.createServerProfileId(factory);
  const characterAId = ids.createCharacterProfileId(factory);
  const characterBId = ids.createCharacterProfileId(factory);
  const aliasSetId = ids.createConfigSetId(factory);
  const triggerSetId = ids.createConfigSetId(factory);
  const highlightSetId = ids.createConfigSetId(factory);
  const functionSetId = ids.createConfigSetId(factory);
  const keyMappingSetId = ids.createConfigSetId(factory);
  const timerSetId = ids.createConfigSetId(factory);

  return {
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
        capabilities: { supportsGmcp: true, extraFutureField: "kept" },
        worldKey: "shared-world-key",
      },
    },
    characterProfiles: {
      [characterAId]: {
        id: characterAId,
        serverProfileId: serverId,
        label: "Main",
        serverIdentity: "Hero",
        configSetRefs: {
          aliases: [aliasSetId],
          triggers: [triggerSetId],
          highlights: [highlightSetId],
          functions: [functionSetId],
          keyMappings: [keyMappingSetId],
          timers: [timerSetId],
        },
        localDefinitions: {
          aliases: [
            {
              id: "alias-local-1",
              enabled: true,
              trigger: "look",
              description: "Local alias",
              group: "",
              isRegex: false,
              ignoreCase: true,
              steps: [{ type: "send_command", template: "look" }],
            },
          ],
          triggers: [],
          highlights: [],
          functions: [],
          keyMappings: [],
          timers: [],
        },
        commandHistory: ["look", "score"],
        workspace: {
          version: 1,
          payload: {
            layout: "classic",
            futurePanelField: true,
          },
        },
        audio: {
          ambient: { enabled: true, volume: 0.7 },
          combat: { enabled: true, volume: 0.5 },
          notification: { enabled: false, volume: 0.3 },
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
        workspace: {
          version: 1,
          payload: { layout: "floating" },
        },
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
        definitions: [
          {
            id: "alias-shared-1",
            enabled: true,
            trigger: "score",
            description: "Shared alias",
            group: "",
            isRegex: false,
            ignoreCase: true,
            steps: [{ type: "send_command", template: "score" }],
          },
        ],
      },
      [triggerSetId]: {
        id: triggerSetId,
        kind: "triggers",
        label: "Shared triggers",
        revision: 1,
        definitions: [
          {
            id: "trigger-shared-1",
            enabled: true,
            pattern: "You gain * experience",
            description: "XP trigger",
            group: "",
            isRegex: false,
            ignoreCase: true,
            gag: false,
            steps: [{ type: "show_message", template: "Level progress" }],
          },
        ],
      },
      [highlightSetId]: {
        id: highlightSetId,
        kind: "highlights",
        label: "Shared highlights",
        revision: 1,
        definitions: [
          {
            id: "highlight-shared-1",
            enabled: true,
            patternSource: "critical hit",
            description: "Crit highlight",
            group: "",
            ignoreCase: true,
            style: { fg: "yellow", bg: "black", bold: true },
          },
        ],
      },
      [functionSetId]: {
        id: functionSetId,
        kind: "functions",
        label: "Shared functions",
        revision: 1,
        definitions: [
          {
            id: "function-shared-1",
            enabled: true,
            name: "heal",
            description: "Heal function",
            group: "",
            script: "return 1",
          },
        ],
      },
      [keyMappingSetId]: {
        id: keyMappingSetId,
        kind: "keyMappings",
        label: "Shared keys",
        revision: 1,
        definitions: [
          {
            id: "key-shared-1",
            enabled: true,
            code: "F1",
            label: "F1",
            legacyKey: "",
            command: "score",
          },
        ],
      },
      [timerSetId]: {
        id: timerSetId,
        kind: "timers",
        label: "Shared timers",
        revision: 1,
        definitions: [
          {
            id: "timer-shared-1",
            enabled: true,
            name: "tick",
            description: "Tick timer",
            group: "",
            durationMs: 1000,
            recurring: true,
            autoStart: false,
            steps: [{ type: "send_command", template: "tick" }],
          },
        ],
      },
    },
    ids: {
      serverId,
      characterAId,
      characterBId,
      aliasSetId,
    },
  };
}

function expectFailure(result, codeFragment) {
  assert.equal(result.success, false, "expected validation failure");
  assert.ok(Array.isArray(result.errors), "expected structured errors");
  assert.ok(
    result.errors.some((issue) => {
      if (issue.code?.includes(codeFragment)) {
        return true;
      }
      if (
        codeFragment === "invalid-schema-version"
        && issue.code === "structural-validation"
        && issue.path.endsWith("schemaVersion")
      ) {
        return true;
      }
      if (
        codeFragment === "invalid-revision"
        && issue.code === "structural-validation"
        && issue.path.endsWith("revision")
      ) {
        return true;
      }
      return false;
    }),
    `expected error code containing ${codeFragment}, got ${JSON.stringify(result.errors)}`,
  );
}

test("Phase 1 session model validators execute through Vite SSR", async (t) => {
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

  const validators = await ssr.runner.import("/model/validators.ts");
  const ids = await ssr.runner.import("/model/ids.ts");
  const sessionContract = await ssr.runner.import("/model/session-contract.ts");

  const factory = createSequentialUuidFactory();
  const graph = buildValidGraph(ids);
  const { ids: graphIds, ...state } = graph;

  const valid = validators.validateApplicationState(state);
  assert.equal(valid.success, true);
  assert.deepEqual(valid.data?.schemaVersion, 1);
  assert.equal(Object.keys(valid.data.serverProfiles).length, 1);
  assert.equal(Object.keys(valid.data.characterProfiles).length, 2);

  const roundTripJson = JSON.stringify(state);
  const parsed = validators.parseApplicationState(roundTripJson);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, valid.data);

  const worldKeyPreserved = validators.validateApplicationState({
    ...state,
    serverProfiles: {
      [graphIds.serverId]: {
        ...state.serverProfiles[graphIds.serverId],
        host: "other.example.com",
        port: 5000,
        worldKey: "shared-world-key",
      },
    },
  });
  assert.equal(worldKeyPreserved.success, true);
  assert.equal(
    worldKeyPreserved.data.serverProfiles[graphIds.serverId].worldKey,
    "shared-world-key",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      schemaVersion: 2,
    }),
    "invalid-schema-version",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      serverProfiles: {
        [graphIds.serverId]: {
          ...state.serverProfiles[graphIds.serverId],
          id: "00000000-0000-4000-8000-000000000099",
        },
      },
    }),
    "collection-key-id-mismatch",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      characterProfiles: {
        ...state.characterProfiles,
        [graphIds.characterAId]: {
          ...state.characterProfiles[graphIds.characterAId],
          serverProfileId: "00000000-0000-4000-8000-000000000099",
        },
      },
    }),
    "dangling-server-reference",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      defaults: {
        ...state.defaults,
        defaultCharacterProfileId: "00000000-0000-4000-8000-000000000099",
      },
    }),
    "dangling-character-reference",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      characterProfiles: {
        ...state.characterProfiles,
        [graphIds.characterAId]: {
          ...state.characterProfiles[graphIds.characterAId],
          configSetRefs: {
            ...state.characterProfiles[graphIds.characterAId].configSetRefs,
            aliases: ["00000000-0000-4000-8000-000000000099"],
          },
        },
      },
    }),
    "dangling-config-reference",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      characterProfiles: {
        ...state.characterProfiles,
        [graphIds.characterAId]: {
          ...state.characterProfiles[graphIds.characterAId],
          configSetRefs: {
            ...state.characterProfiles[graphIds.characterAId].configSetRefs,
            aliases: [graphIds.aliasSetId, graphIds.aliasSetId],
          },
        },
      },
    }),
    "duplicate-config-reference",
  );

  const triggerSetId = state.characterProfiles[graphIds.characterAId]
    .configSetRefs.triggers[0];
  expectFailure(
    validators.validateApplicationState({
      ...state,
      characterProfiles: {
        ...state.characterProfiles,
        [graphIds.characterAId]: {
          ...state.characterProfiles[graphIds.characterAId],
          configSetRefs: {
            ...state.characterProfiles[graphIds.characterAId].configSetRefs,
            aliases: [triggerSetId],
          },
        },
      },
    }),
    "cross-kind-config-reference",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      serverProfiles: {
        [graphIds.serverId]: {
          ...state.serverProfiles[graphIds.serverId],
          protocol: "ssh",
        },
      },
    }),
    "structural-validation",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      serverProfiles: {
        [graphIds.serverId]: {
          ...state.serverProfiles[graphIds.serverId],
          host: "",
        },
      },
    }),
    "structural-validation",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      serverProfiles: {
        [graphIds.serverId]: {
          ...state.serverProfiles[graphIds.serverId],
          port: 70000,
        },
      },
    }),
    "structural-validation",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      serverProfiles: {
        [graphIds.serverId]: {
          ...state.serverProfiles[graphIds.serverId],
          worldKey: "bad world key",
        },
      },
    }),
    "invalid-world-key",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      serverProfiles: {
        [graphIds.serverId]: {
          ...state.serverProfiles[graphIds.serverId],
          id: "not-a-uuid",
        },
      },
    }),
    "structural-validation",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      characterProfiles: {
        [graphIds.characterAId]: {
          ...state.characterProfiles[graphIds.characterAId],
          id: "also-not-a-uuid",
        },
      },
    }),
    "structural-validation",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      configurationSets: {
        [graphIds.aliasSetId]: {
          ...state.configurationSets[graphIds.aliasSetId],
          id: "bad-set-id",
        },
      },
    }),
    "structural-validation",
  );

  expectFailure(
    validators.validateSessionDescriptorInput({
      sessionId: "bad-session-id",
      serverProfileId: graphIds.serverId,
      characterProfileId: graphIds.characterAId,
    }),
    "structural-validation",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      configurationSets: {
        [graphIds.aliasSetId]: {
          ...state.configurationSets[graphIds.aliasSetId],
          revision: 0,
        },
      },
    }),
    "invalid-revision",
  );

  expectFailure(
    validators.validateApplicationState({
      ...state,
      configurationSets: {
        [graphIds.aliasSetId]: {
          ...state.configurationSets[graphIds.aliasSetId],
          kind: "widgets",
        },
      },
    }),
    "structural-validation",
  );

  assert.equal(
    valid.data.serverProfiles[graphIds.serverId].capabilities.extraFutureField,
    "kept",
  );
  assert.equal(
    valid.data.characterProfiles[graphIds.characterAId].workspace.payload
      .futurePanelField,
    true,
  );

  const invalidJson = validators.parseApplicationState("{");
  assert.equal(invalidJson.success, false);
  assert.equal(invalidJson.errors?.[0]?.code, "invalid-json");

  const sessionId = ids.createSessionId(factory);
  const validDescriptor = {
    sessionId,
    serverProfileId: graphIds.serverId,
    characterProfileId: graphIds.characterAId,
  };
  const sessionValid = validators.validateSessionDescriptorAgainstState(
    valid.data,
    validDescriptor,
  );
  assert.equal(sessionValid.success, true);

  expectFailure(
    validators.validateSessionDescriptorAgainstState(valid.data, {
      ...validDescriptor,
      serverProfileId: "00000000-0000-4000-8000-000000000099",
    }),
    "session-server-mismatch",
  );

  expectFailure(
    validators.validateSessionDescriptorAgainstState(valid.data, {
      ...validDescriptor,
      characterProfileId: "00000000-0000-4000-8000-000000000099",
    }),
    "dangling-character-reference",
  );

  const duplicateError = new sessionContract.DuplicateLiveSessionError(
    graphIds.characterAId,
    sessionId,
  );
  assert.equal(duplicateError.code, "duplicate-live-session");
  assert.equal(duplicateError.characterProfileId, graphIds.characterAId);
  assert.equal(duplicateError.existingSessionId, sessionId);

  /** SessionRegistry compile-time contract fixture for Step 10. */
  const registryContract = {
    lookupByCharacter() {
      return undefined;
    },
    claim() {},
    release() {
      return true;
    },
  };
  assert.equal(typeof registryContract.claim, "function");
});

test("scoped IDs are compile-time distinct and factory-driven", async (t) => {
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
  const factory = ids.createSequentialUuidFactory();

  const serverId = ids.createServerProfileId(factory);
  const characterId = ids.createCharacterProfileId(factory);
  const configSetId = ids.createConfigSetId(factory);
  const sessionId = ids.createSessionId(factory);

  assert.match(serverId, /^00000000-0000-4000-8000-/);
  assert.notEqual(serverId, characterId);
  assert.notEqual(configSetId, sessionId);
});
