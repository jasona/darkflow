import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Vite SSR fixture shared by every session GMCP bus test. */
async function loadGmcpModules(t) {
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

  const [frameModule, validatorsModule, diagnosticsModule, busModule, idsModule] =
    await Promise.all([
      ssr.runner.import("/gmcp/frame.ts"),
      ssr.runner.import("/gmcp/contracts/validators.ts"),
      ssr.runner.import("/runtime/diagnostics.ts"),
      ssr.runner.import("/gmcp/bus.ts"),
      ssr.runner.import("/model/ids.ts"),
    ]);

  const factory = idsModule.createSequentialUuidFactory();
  const sessionId = idsModule.createSessionId(factory);
  const otherSessionId = idsModule.createSessionId(factory);

  return {
    ...frameModule,
    ...validatorsModule,
    SessionDiagnostics: diagnosticsModule.SessionDiagnostics,
    ...busModule,
    sessionId,
    otherSessionId,
  };
}

function createSendSpy() {
  const calls = [];
  const sink = (bytes) => {
    calls.push(new TextDecoder().decode(bytes));
    return true;
  };
  return { calls, sink };
}

test("frame.ts reproduces gmcp-normalizer fixtures", async (t) => {
  const { canonicalPackageName, normalizeGmcpFrame, normalizeSupportsPayload } =
    await loadGmcpModules(t);

  assert.equal(canonicalPackageName("room.info"), "Room.Info");
  assert.equal(canonicalPackageName("CHAR.VITALS"), "Char.Vitals");
  assert.equal(canonicalPackageName("Comm.Channel"), "Comm.Channel");
  assert.equal(canonicalPackageName("darkwind.xpmon"), "Darkwind.XPMon");

  assert.deepEqual(normalizeSupportsPayload(["room.info 1", "COMM.CHANNEL 1"]), [
    "Room.Info 1",
    "Comm.Channel 1",
  ]);
  assert.deepEqual(normalizeSupportsPayload({ "char.vitals": "1" }), {
    "Char.Vitals": "1",
  });

  const vitals = normalizeGmcpFrame("char.vitals", {
    hp: 415,
    mhp: 1479,
    mana: 151,
    mmana: 1121,
    move: 375,
    mmove: 541,
  });
  assert.equal(vitals.packageName, "Char.Vitals");
  assert.equal(vitals.data.maxhp, 1479);
  assert.equal(vitals.data.sp, 151);
  assert.equal(vitals.data.maxsp, 1121);
  assert.equal(vitals.data.fp, 375);
  assert.equal(vitals.data.maxfp, 541);
  assert.equal(vitals.data.string, "HP:415/1479 SP:151/1121 MV:375/541");

  const channel = normalizeGmcpFrame("comm.channel", {
    chan: "gossip",
    player: "Imfat",
    msg: "yep",
  });
  assert.equal(channel.packageName, "Comm.Channel");
  assert.equal(channel.data.channel, "gossip");
  assert.equal(channel.data.talker, "Imfat");
  assert.equal(channel.data.text, "yep");

  const room = normalizeGmcpFrame("ROOM.INFO", {
    num: 17122,
    name: "At the foot of a pile of rocks",
    terrain: "Forest",
    exits: { north: 17121, down: "closed" },
    coords: { x: 0, y: 1, z: -1 },
  });
  assert.equal(room.packageName, "Room.Info");
  assert.equal(room.data.environment, "Forest");
  assert.deepEqual(room.data.exit_states, { down: "closed" });
  assert.equal(room.data.coord_x, 0);
  assert.equal(room.data.coord_y, 1);
  assert.equal(room.data.coord_z, -1);
});

test("documented valid payloads pass their registered validators", async (t) => {
  const { lookupGmcpValidator, modeledGmcpPackageNames } = await loadGmcpModules(t);

  const fixtures = {
    "Core.Supports.Set": ["Char 1", "Room 1"],
    "Char.Vitals": { hp: 420, maxhp: 500, sp: 180, maxsp: 220 },
    "Char.Status": { name: "Nacho", level: 10, gold: 100 },
    "Char.StatusVars": { custom_flag: true },
    "Char.Stats": { str: 10, int: 12, wis: 11, dex: 14, con: 13, chr: 9 },
    "Char.RealStats": {
      realstr: 10,
      realint: 12,
      realwis: 11,
      realdex: 14,
      realcon: 13,
      realchr: 9,
    },
    "Char.Worth": { gold: 1250, bank: 6000 },
    "Char.Enemy": {
      enemy_name: "a training construct",
      enemy_curhp: 75,
      enemy_maxhp: 100,
      enemy_is_npc: 1,
    },
    "Char.Items.List": {
      location: "inv",
      items: [{ id: "sword-1", name: "a steel sword", attrib: "l" }],
    },
    "Char.Items.Add": {
      location: "inv",
      item: { id: "sword-1", name: "a steel sword" },
    },
    "Char.Defences.List": [{ name: "stoneskin", kind: "buff", duration: 120 }],
    "Char.Defences.Add": { name: "stoneskin", kind: "buff" },
    "Char.Defences.Remove": "stoneskin",
    "Room.Info": {
      num: "450359962737049",
      name: "Temple Yard",
      area: "Darkwind",
      environment: "outside, city",
      exits: { north: "450359962737050", south: "closed" },
    },
    "Room.Players": [{ name: "nacho", fullname: "Nacho the Bold" }],
    "Room.AddPlayer": { name: "nacho", fullname: "Nacho the Bold" },
    "Room.RemovePlayer": "nacho",
    "Comm.Channel": { channel: "gossip", talker: "Nacho", text: "Hello there." },
    "Comm.Channel.List": [{ name: "gossip", caption: "Gossip", command: "gossip" }],
    "Comm.Channel.Players": [{ name: "Nacho" }],
    "Comm.Channel.Start": "gossip",
    "Comm.Channel.End": { channel: "gossip" },
  };

  for (const [packageName, payload] of Object.entries(fixtures)) {
    const validator = lookupGmcpValidator(packageName);
    assert.ok(validator, `expected validator for ${packageName}`);
    const result = validator(payload);
    assert.equal(result.success, true, `valid payload rejected for ${packageName}`);
  }

  assert.ok(!lookupGmcpValidator("Darkwind.Window"));
  assert.ok(modeledGmcpPackageNames.length >= Object.keys(fixtures).length);
});

test("malformed known-field frames reach no handler and do not block the next frame", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId } = await loadGmcpModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const { sink } = createSendSpy();
  const bus = createSessionGmcpBus(sessionId, sink, diagnostics);

  const wildcardSeen = [];
  const vitalsSeen = [];
  const roomSeen = [];

  bus.on("*", (_packageName, _data) => {
    wildcardSeen.push(_packageName);
  });
  bus.on("Char.Vitals", (data) => {
    vitalsSeen.push(data);
  });
  bus.on("Room.Info", (data) => {
    roomSeen.push(data);
  });

  bus.dispatch("Char.Vitals", { hp: "not-a-number", maxhp: 500, sp: 180, maxsp: 220 });
  bus.dispatch("Room.Info", { num: 1, name: "Test Room" });

  assert.deepEqual(wildcardSeen, ["Room.Info"]);
  assert.equal(vitalsSeen.length, 0);
  assert.deepEqual(roomSeen, [{ num: 1, name: "Test Room" }]);
  assert.equal(diagnostics.snapshot().suppressedEvents, 1);
});

test("malformed Core.Supports.Set is rejected before mutating supports map", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId } = await loadGmcpModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const { sink } = createSendSpy();
  const bus = createSessionGmcpBus(sessionId, sink, diagnostics);

  bus.dispatch("Core.Supports.Set", { "Char.Vitals": true });
  assert.equal(bus.serverSupportsPackage("Char.Vitals"), false);
  assert.equal(diagnostics.snapshot().suppressedEvents, 1);

  bus.dispatch("Core.Supports.Set", ["Char.Vitals 1"]);
  assert.equal(bus.serverSupportsPackage("Char.Vitals"), true);
});

test("Core.Supports Set/Add/Remove tracking matches legacy semantics", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId } = await loadGmcpModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const { sink } = createSendSpy();
  const bus = createSessionGmcpBus(sessionId, sink, diagnostics);

  bus.dispatch("Core.Supports.Set", ["Char.Vitals 1", "Room.Info 2"]);
  assert.equal(bus.serverSupportsPackage("Char.Vitals"), true);
  assert.equal(bus.serverSupportsPackage("Room.Info"), true);

  bus.dispatch("Core.Supports.Add", { "Comm.Channel": "3" });
  assert.equal(bus.serverSupportsPackage("Comm.Channel"), true);

  bus.dispatch("Core.Supports.Remove", ["Room.Info 1"]);
  assert.equal(bus.serverSupportsPackage("Room.Info"), false);
  assert.equal(bus.serverSupportsPackage("Char.Vitals"), true);
  assert.equal(bus.serverSupportsPackage("Comm.Channel"), true);
});

test("two SessionGmcpBus instances remain fully isolated", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId, otherSessionId } =
    await loadGmcpModules(t);
  const diagnosticsA = new SessionDiagnostics(sessionId);
  const diagnosticsB = new SessionDiagnostics(otherSessionId);
  const spyA = createSendSpy();
  const spyB = createSendSpy();
  const busA = createSessionGmcpBus(sessionId, spyA.sink, diagnosticsA);
  const busB = createSessionGmcpBus(otherSessionId, spyB.sink, diagnosticsB);

  const seenA = [];
  const seenB = [];

  busA.on("Char.Vitals", (data) => seenA.push(data));
  busB.on("Char.Vitals", (data) => seenB.push(data));

  busA.dispatch("Core.Supports.Set", ["Char.Vitals 1"]);
  busB.dispatch("Core.Supports.Set", ["Room.Info 1"]);

  assert.equal(busA.serverSupportsPackage("Char.Vitals"), true);
  assert.equal(busA.serverSupportsPackage("Room.Info"), false);
  assert.equal(busB.serverSupportsPackage("Room.Info"), true);
  assert.equal(busB.serverSupportsPackage("Char.Vitals"), false);

  busA.sendHandshake({
    client: "Darkflow",
    version: "1.0",
    width: 80,
    height: 24,
  });
  busB.sendHandshake({
    client: "Other",
    version: "2.0",
    width: 100,
    height: 40,
  });

  assert.ok(spyA.calls.length > 0);
  assert.ok(spyB.calls.length > 0);
  assert.notDeepEqual(spyA.calls, spyB.calls);
  assert.match(spyA.calls[0], /Core\.Hello/);
  assert.match(spyB.calls[0], /Core\.Hello \{"client":"Other"/);

  busA.dispatch("Char.Vitals", { hp: 1, maxhp: 2 });
  busB.dispatch("Char.Vitals", { hp: 9, maxhp: 8 });

  assert.equal(seenA.length, 1);
  assert.equal(seenB.length, 1);
  assert.equal(seenA[0].hp, 1);
  assert.equal(seenB[0].hp, 9);
  assert.equal(diagnosticsA.snapshot().suppressedEvents, 0);
  assert.equal(diagnosticsB.snapshot().suppressedEvents, 0);
});

test("handshake support list matches legacy 43-entry list", async (t) => {
  const { CLIENT_SUPPORTS_SET, createSessionGmcpBus, SessionDiagnostics, sessionId } =
    await loadGmcpModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const spy = createSendSpy();
  const bus = createSessionGmcpBus(sessionId, spy.sink, diagnostics);

  bus.sendHandshake({
    client: "Darkflow",
    version: "test",
    width: 75,
    height: 24,
  });

  assert.equal(CLIENT_SUPPORTS_SET.length, 43);
  assert.equal(CLIENT_SUPPORTS_SET[0], "Char 1");
  assert.equal(CLIENT_SUPPORTS_SET.at(-1), "Darkwind.Room.Playlist 1");

  const supportsLine = spy.calls.find((line) => line.startsWith("Core.Supports.Set "));
  assert.ok(supportsLine);
  const payload = JSON.parse(supportsLine.slice("Core.Supports.Set ".length));
  assert.deepEqual(payload, [...CLIENT_SUPPORTS_SET]);
});

test("send helpers route through the injected sink only", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId } = await loadGmcpModules(t);
  const diagnosticsA = new SessionDiagnostics(sessionId);
  const diagnosticsB = new SessionDiagnostics(sessionId);
  const spyA = createSendSpy();
  const spyB = createSendSpy();
  const busA = createSessionGmcpBus(sessionId, spyA.sink, diagnosticsA);
  const busB = createSessionGmcpBus(sessionId, spyB.sink, diagnosticsB);

  busA.sendSubscriptions({ reason: "test-a" });
  busB.requestMediaRefresh();

  assert.equal(spyA.calls.length, 1);
  assert.equal(spyB.calls.length, 1);
  assert.match(spyA.calls[0], /Darkwind\.Client\.Subscriptions/);
  assert.equal(spyB.calls[0], "Darkwind.Client.RefreshMedia");
});

test("throwing handlers do not starve remaining handlers on the same frame", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId } = await loadGmcpModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const { sink } = createSendSpy();
  const bus = createSessionGmcpBus(sessionId, sink, diagnostics);
  const order = [];

  bus.on("Char.Vitals", () => {
    order.push("first");
  });
  bus.on("Char.Vitals", () => {
    order.push("second");
    throw new Error("handler failed");
  });
  bus.on("Char.Vitals", () => {
    order.push("third");
  });

  bus.dispatch("Char.Vitals", { hp: 1, maxhp: 2, sp: 3, maxsp: 4 });
  assert.deepEqual(order, ["first", "second", "third"]);
  assert.equal(diagnostics.snapshot().handlerFailures, 1);
});

test("mid-dispatch off() does not change in-flight handler delivery", async (t) => {
  const { createSessionGmcpBus, SessionDiagnostics, sessionId } = await loadGmcpModules(t);
  const diagnostics = new SessionDiagnostics(sessionId);
  const { sink } = createSendSpy();
  const bus = createSessionGmcpBus(sessionId, sink, diagnostics);
  const order = [];
  let offB = () => {};

  const handlerA = () => {
    order.push("a");
    offB();
  };
  const handlerB = () => {
    order.push("b");
    throw new Error("handler failed");
  };
  const handlerC = () => {
    order.push("c");
  };

  bus.on("Char.Vitals", handlerA);
  offB = () => bus.off("Char.Vitals", handlerB);
  bus.on("Char.Vitals", handlerB);
  bus.on("Char.Vitals", handlerC);

  bus.dispatch("Char.Vitals", { hp: 1, maxhp: 2, sp: 3, maxsp: 4 });
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.equal(diagnostics.snapshot().handlerFailures, 1);

  order.length = 0;
  bus.dispatch("Char.Vitals", { hp: 5, maxhp: 6, sp: 7, maxsp: 8 });
  assert.deepEqual(order, ["a", "c"]);
});

test("wrong runtime types fail validation for modeled packages", async (t) => {
  const { lookupGmcpValidator } = await loadGmcpModules(t);

  const validator = lookupGmcpValidator("Char.Items.List");
  assert.ok(validator);
  assert.equal(
    validator({
      location: "inv",
      items: [{ id: 123, name: "bad" }],
    }).success,
    false,
  );
});
