import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Vite SSR fixture shared by every session GMCP Darkwind test. */
async function loadDarkwindModules(t) {
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
    validatorsModule,
    diagnosticsModule,
    busModule,
    idsModule,
    darkwindClientModule,
  ] = await Promise.all([
    ssr.runner.import("/gmcp/contracts/validators.ts"),
    ssr.runner.import("/runtime/diagnostics.ts"),
    ssr.runner.import("/gmcp/bus.ts"),
    ssr.runner.import("/model/ids.ts"),
    ssr.runner.import("/gmcp/contracts/darkwind-client.ts"),
  ]);

  const factory = idsModule.createSequentialUuidFactory();
  const sessionId = idsModule.createSessionId(factory);
  const otherSessionId = idsModule.createSessionId(factory);

  return {
    ...validatorsModule,
    SessionDiagnostics: diagnosticsModule.SessionDiagnostics,
    ...busModule,
    ...darkwindClientModule,
    sessionId,
    otherSessionId,
  };
}

test("Darkwind.Window Open/Update/Close validate documented envelopes", async (t) => {
  const { lookupGmcpValidator } = await loadDarkwindModules(t);

  const openValidator = lookupGmcpValidator("Darkwind.Window.Open");
  assert.ok(openValidator);
  assert.equal(
    openValidator({
      id: "login",
      type: "modal",
      title: "Login",
      closable: true,
      width: 420,
      height: "60vh",
      layout: { type: "vertical", children: [] },
    }).success,
    true,
  );
  assert.equal(
    openValidator({
      id: "who",
      layout: {
        type: "vertical",
        children: [{ type: "player_row", id: "row-1", name: "Gandalf" }],
      },
    }).success,
    true,
  );
  assert.equal(openValidator({ id: "missing-layout" }).success, false);

  const updateValidator = lookupGmcpValidator("Darkwind.Window.Update");
  assert.ok(updateValidator);
  assert.equal(
    updateValidator({
      id: "login",
      updates: [{ id: "error", text: "Invalid password", style: { color: "red" } }],
    }).success,
    true,
  );

  const closeValidator = lookupGmcpValidator("Darkwind.Window.Close");
  assert.ok(closeValidator);
  assert.equal(closeValidator({}).success, false);
});

test("Darkwind.Window.Open accepts numeric closable from MUD payloads", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId } = await loadDarkwindModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const bus = createSessionGmcpBus(sessionId, () => true, diagnostics);
  const seen = [];

  bus.on("Darkwind.Window.Open", (data) => seen.push(data));
  bus.dispatch("Darkwind.Window.Open", {
    id: "login",
    type: "modal",
    title: "Login",
    closable: 0,
    layout: { type: "vertical", children: [] },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].closable, 0);
  assert.equal(diagnostics.snapshot().suppressedEvents, 0);
});

test("Char.Status accepts MUD lifestyle strings without coercion", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId, lookupGmcpValidator } =
    await loadDarkwindModules(t);
  const validator = lookupGmcpValidator("Char.Status");
  assert.ok(validator);

  const payload = {
    name: "Tamjr",
    level: 42,
    dead: "No",
    drunk: "Sober",
    invis: "No",
    sit: "No",
    viking: "No",
  };
  assert.equal(validator(payload).success, true);

  const diagnostics = new SessionDiagnostics(sessionId);
  const bus = createSessionGmcpBus(sessionId, () => true, diagnostics);
  const seen = [];
  bus.on("Char.Status", (data) => seen.push(data));
  bus.dispatch("Char.Status", payload);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].drunk, "Sober");
  assert.equal(diagnostics.snapshot().suppressedEvents, 0);
});

test("server-native room and MapData2 wire values validate without coercion", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId, lookupGmcpValidator } =
    await loadDarkwindModules(t);
  const roomId = 2599838393621098;
  const room = {
    id: roomId,
    name: "Temple Yard",
    area: "Darkwind",
    observed: 1,
    positioned: 1,
    x: 0,
    y: 0,
    z: 0,
    layoutState: "verified",
    version: 25,
    exits: { north: roomId + 1 },
  };
  const payloads = [
    ["Darkwind.MapData2.Current", { ...room, liveExits: { north: roomId + 1 } }],
    [
      "Room.Info",
      {
        num: roomId,
        name: "Temple Yard",
        environment: "inside",
        terrain: "inside",
        coords: "",
        exits: "",
        details: "",
      },
    ],
    ["Room.Players", ""],
    [
      "Darkwind.MapData2.Update",
      {
        area: "Darkwind",
        rooms: [room],
        complete: 1,
        replace: 0,
        cursor: roomId,
        snapshotVersion: 25,
      },
    ],
  ];

  const diagnostics = new SessionDiagnostics(sessionId);
  const bus = createSessionGmcpBus(sessionId, () => true, diagnostics);
  const errorSpy = t.mock.method(console, "error", () => {});
  const seen = [];
  bus.on("*", (packageName, data) => seen.push([packageName, data]));

  for (const [packageName, payload] of payloads) {
    const validator = lookupGmcpValidator(packageName);
    assert.ok(validator);
    assert.equal(validator(payload).success, true, `${packageName} rejected server payload`);
    bus.dispatch(packageName, payload);
  }

  assert.equal(errorSpy.mock.callCount(), 0);
  assert.equal(seen.length, payloads.length);
  assert.equal(seen[0][1].id, roomId);
  assert.equal(seen[0][1].observed, 1);
  assert.equal(seen[1][1].coords, "");
  assert.equal(seen[2][1], "");
  assert.equal(seen[3][1].replace, 0);

  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Current")({ ...room, observed: 2 }).success,
    false,
  );
  assert.equal(lookupGmcpValidator("Room.Players")({}).success, false);
});

test("Darkwind.Window layout accepts unrecognized node types", async (t) => {
  const { lookupGmcpValidator } = await loadDarkwindModules(t);
  const validator = lookupGmcpValidator("Darkwind.Window.Open");
  assert.ok(validator);
  assert.equal(
    validator({
      id: "future",
      layout: {
        type: "vertical",
        children: [{ type: "future_node_type", id: "n1", customField: true }],
      },
    }).success,
    true,
  );
});

test("Darkwind.IDE inbound messages validate documented examples", async (t) => {
  const { lookupGmcpValidator } = await loadDarkwindModules(t);

  assert.equal(
    lookupGmcpValidator("Darkwind.IDE.Open")({
      path: "/domains/darkwind/rooms/tavern.c",
      content: "// file content here...",
      language: "lpc",
      readOnly: false,
    }).success,
    true,
  );

  assert.equal(
    lookupGmcpValidator("Darkwind.IDE.OpenStart")({
      session: "transfer-id",
      path: "/domains/darkwind/rooms/tavern.c",
      content: "",
      language: "c",
      readOnly: false,
      chunks: 12,
      totalLength: 384000,
      hash: "sha1...",
    }).success,
    true,
  );
  assert.equal(
    lookupGmcpValidator("Darkwind.IDE.OpenStart")({
      session: "transfer-id",
      path: "/path",
      content: "",
      chunks: "12",
      totalLength: 384000,
    }).success,
    false,
  );

  assert.equal(
    lookupGmcpValidator("Darkwind.IDE.OpenChunk")({
      session: "transfer-id",
      index: 0,
      content: "chunk content...",
    }).success,
    true,
  );

  assert.equal(
    lookupGmcpValidator("Darkwind.IDE.OpenFinish")({
      session: "transfer-id",
    }).success,
    true,
  );

  assert.equal(
    lookupGmcpValidator("Darkwind.IDE.SaveResult")({
      path: "/domains/darkwind/rooms/tavern.c",
      success: false,
      message: "Compilation failed.",
      errors: [{ line: 15, column: 0, message: "Missing ';' before end of line" }],
    }).success,
    true,
  );
  assert.equal(
    lookupGmcpValidator("Darkwind.IDE.SaveResult")({
      success: false,
      errors: [{ line: "15", message: "bad" }],
    }).success,
    false,
  );
});

test("Darkwind.MapData2 accepts v1 and v2 wire shapes", async (t) => {
  const { lookupGmcpValidator } = await loadDarkwindModules(t);

  const room = { id: "450359962737049", name: "Temple Yard", area: "Darkwind" };

  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Current")({
      ...room,
      protocol: 2,
      mapEpoch: "1783612800-123456",
      areaGeneration: 3,
      liveExits: { north: "450359962737050" },
    }).success,
    true,
  );
  assert.equal(lookupGmcpValidator("Darkwind.MapData2.Current")({ name: "no-id" }).success, false);

  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Area")({
      area: "Darkwind",
      rooms: [room],
      version: 40,
      more: true,
    }).success,
    true,
  );
  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Area")({
      area: "Darkwind",
      rooms: [room],
      mapEpoch: "1783612800-123456",
      areaGeneration: 3,
      replace: false,
    }).success,
    true,
  );
  assert.equal(lookupGmcpValidator("Darkwind.MapData2.Area")({ rooms: [room] }).success, false);

  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Update")({
      area: "Darkwind",
      version: 40,
      offset: 100,
      more: true,
      rooms: [room],
    }).success,
    true,
  );
  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Update")({
      protocol: 2,
      mapEpoch: "1783612800-123456",
      area: "Darkwind",
      areaGeneration: 3,
      since: 40,
      snapshotVersion: 91,
      latestVersion: 93,
      cursor: "450359962737099",
      complete: false,
      replace: false,
      rooms: [],
    }).success,
    true,
  );
  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Update")({
      protocol: 2,
      mapEpoch: "1783612800-123456",
      rooms: [],
    }).success,
    false,
  );

  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Error")({
      restart: true,
      retryAfterMs: 500,
    }).success,
    true,
  );

  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.BrowseArea")({
      catalog: "darkwind-overview",
      name: "Darkwind",
      center: 2599838393621098,
      rooms: [room],
      more: 0,
      replace: 1,
    }).success,
    true,
  );

  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Reset")({
      scope: "area",
      area: "Darkwind",
      areaGeneration: 4,
      mapEpoch: "1783612800-999999",
    }).success,
    true,
  );
  assert.equal(
    lookupGmcpValidator("Darkwind.MapData2.Reset")({
      scope: "area",
      areaGeneration: 4,
    }).success,
    true,
  );
});

test("Darkwind.Client.NAWS and Session.Recovered contracts", async (t) => {
  const { lookupGmcpValidator, validateDarkwindClientNaws, validateDarkwindSessionRecovered } =
    await loadDarkwindModules(t);

  assert.equal(validateDarkwindClientNaws({ width: 120, height: 34 }).success, true);
  assert.equal(validateDarkwindClientNaws({ width: "120", height: 34 }).success, false);
  assert.equal(lookupGmcpValidator("Darkwind.Client.NAWS"), undefined);

  assert.equal(
    validateDarkwindSessionRecovered({
      mode: "switch",
      playerName: "Gandalf",
      recoveredAt: 1783612800,
      previousCharacter: "Bilbo",
    }).success,
    true,
  );
  assert.equal(
    validateDarkwindSessionRecovered({
      mode: "linkdead",
      playerName: "Gandalf",
      recoveredAt: 1783612800,
    }).success,
    true,
  );
  assert.equal(
    validateDarkwindSessionRecovered({
      mode: "takeover",
      playerName: "Gandalf",
      recoveredAt: 1783612800,
    }).success,
    true,
  );
  assert.equal(
    validateDarkwindSessionRecovered({
      mode: "linkdead",
      recoveredAt: "not-a-number",
    }).success,
    false,
  );
  assert.equal(lookupGmcpValidator("Darkwind.Session.Recovered"), validateDarkwindSessionRecovered);
});

test("unmodeled packages never overlap modeled validators", async (t) => {
  const { lookupGmcpValidator, modeledGmcpPackageNames, unmodeledGmcpPackageNames } =
    await loadDarkwindModules(t);

  const modeledSet = new Set(modeledGmcpPackageNames);
  for (const packageName of unmodeledGmcpPackageNames) {
    assert.equal(lookupGmcpValidator(packageName), undefined, `${packageName} should be unmodeled`);
    assert.equal(modeledSet.has(packageName), false, `${packageName} must not appear in modeled set`);
  }
});

test("two SessionGmcpBus instances isolate IDE OpenChunk by session bus", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId, otherSessionId } =
    await loadDarkwindModules(t);
  const diagnosticsA = new SessionDiagnostics(sessionId);
  const diagnosticsB = new SessionDiagnostics(otherSessionId);
  const busA = createSessionGmcpBus(sessionId, () => true, diagnosticsA);
  const busB = createSessionGmcpBus(otherSessionId, () => true, diagnosticsB);

  const seenA = [];
  const seenB = [];

  busA.on("Darkwind.IDE.OpenChunk", (data) => seenA.push(data));
  busB.on("Darkwind.IDE.OpenChunk", (data) => seenB.push(data));

  const chunk = { session: "shared-transfer-id", index: 0, content: "chunk" };
  busA.dispatch("Darkwind.IDE.OpenChunk", chunk);
  assert.equal(seenA.length, 1);
  assert.equal(seenB.length, 0);

  busB.dispatch("Darkwind.IDE.OpenChunk", {
    session: "shared-transfer-id",
    index: 1,
    content: "other-chunk",
  });
  assert.equal(seenA.length, 1);
  assert.equal(seenB.length, 1);
  assert.equal(seenA[0].index, 0);
  assert.equal(seenB[0].index, 1);
});

test("malformed modeled Darkwind frames still reach typed handlers", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId } = await loadDarkwindModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const bus = createSessionGmcpBus(sessionId, () => true, diagnostics);
  const errorSpy = t.mock.method(console, "error", () => {});
  const seen = [];

  bus.on("Darkwind.Window.Open", (data) => seen.push(data));
  bus.dispatch("Darkwind.Window.Open", { id: "bad", layout: "not-an-object" });
  assert.equal(seen.length, 1);
  assert.equal(diagnostics.snapshot().suppressedEvents, 0);
  assert.equal(errorSpy.mock.callCount(), 1);
  assert.match(String(errorSpy.mock.calls[0].arguments[0]), /GMCP validation failed for Darkwind\.Window\.Open/);
});
