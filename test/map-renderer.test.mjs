// Tests for map-renderer "never blank a known area" behavior (audit fix 1a).
// Drives the real MapData2 model + renderer with minimal DOM stubs.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- Minimal browser globals so the client modules import under Node ---------
const noop = () => {};
const stubEl = () => ({
  style: {}, classList: { add: noop, remove: noop, toggle: noop },
  appendChild: noop, addEventListener: noop, setAttribute: noop,
  querySelector: () => null, querySelectorAll: () => [], remove: noop,
});
globalThis.document = {
  hidden: false, visibilityState: 'visible',
  addEventListener: noop, removeEventListener: noop,
  createElement: stubEl, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  body: stubEl(), documentElement: stubEl(),
};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.WebSocket = class { addEventListener() {} send() {} close() {} };
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.Audio = class { play() { return Promise.resolve(); } addEventListener() {} };

const { renderMap } = await import('../public/js/map-renderer.js');
const v2 = await import('../public/js/map-data-v2.js');
const { gmcp } = await import('../public/js/gmcp.js');
// The model now sends sync requests on its own (login/baseline reconciliation);
// stub the transport so tests never touch the real socket plumbing.
gmcp.send = () => {};

function makeBody() {
  let html = '';
  return {
    clientWidth: 320, clientHeight: 240,
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    querySelector: () => null,
  };
}

// A small positioned area: center room A with a neighbor B to its north.
function seedArea(area) {
  v2.mergeServerAreaData({
    area, version: 1, replace: true,
    rooms: [
      { id: area + ':A', name: 'Town Square', area, env: 'city',
        positioned: true, x: 0, y: 0, z: 0, exits: { north: area + ':B' } },
      { id: area + ':B', name: 'North Road', area, env: 'road',
        positioned: true, x: 0, y: -1, z: 0, exits: { south: area + ':A' } },
    ],
  });
}

test('unpositioned current room does NOT blank a known area', () => {
  const area = 'Knownland';
  seedArea(area);
  // Player steps into a room the server has not laid out yet.
  v2.processCurrent({
    id: area + ':cellar', name: 'Dark Cellar', area,
    positioned: false, areaVersion: 1, exits: {},
  });

  const body = makeBody();
  renderMap(body);
  const out = body.innerHTML;

  assert.ok(!out.includes('map-empty'), 'must not show the empty placeholder');
  assert.ok(out.includes('map-grid'), 'must render the tile grid');
  assert.ok(out.includes('map-tile-'), 'must render terrain tiles for the area');
  assert.ok(out.includes('map-pending'), 'must show the "locating" indicator');
  assert.ok(out.includes('Dark Cellar'), 'must name the room the player is in');
  assert.ok(out.includes('map-tile-lastpos'), 'must mark the parked position');
  assert.ok(!out.includes('map-tile-player'), 'no player icon while unpositioned');

  const dbg = window.mapRenderDebug();
  assert.equal(dbg.pending, true);
  assert.equal(dbg.currentRoom.positioned, false);
});

test('positioned current room renders the player tile normally', () => {
  const area = 'Playerland';
  seedArea(area);
  v2.processCurrent({
    id: area + ':A', name: 'Town Square', area, env: 'city', areaName: 'Player Land',
    positioned: true, x: 0, y: 0, z: 0, areaVersion: 1, exits: { north: area + ':B' },
  });

  const body = makeBody();
  renderMap(body);
  const out = body.innerHTML;

  assert.ok(out.includes('map-tile-player'), 'player tile present');
  // Closing-quote discriminator: 'map-conn-n' alone would also match the
  // diagonal classes map-conn-ne / map-conn-nw.
  assert.ok(out.includes('map-conn-n"'), 'connector drawn to adjacent mapped room to the north');
  assert.ok(out.includes('map-areaname'), 'area name label present');
  assert.ok(out.includes('Player Land'), 'shows the human area name from the payload');
  assert.ok(out.includes('Town Square'), 'still shows the current room name');
  assert.ok(!out.includes('map-pending'), 'no pending indicator when positioned');
  assert.ok(!out.includes('map-empty'), 'not the empty placeholder');

  const dbg = window.mapRenderDebug();
  assert.equal(dbg.pending, false);
});

test('exits to unmapped rooms render as stubs', () => {
  const area = 'Stubland';
  // One positioned room with an east exit to a room we do not have/position.
  v2.mergeServerAreaData({
    area, version: 1, replace: true,
    rooms: [
      { id: area + ':A', name: 'Edge Room', area, env: 'city',
        positioned: true, x: 0, y: 0, z: 0, exits: { east: area + ':unknown' } },
    ],
  });
  v2.processCurrent({
    id: area + ':A', name: 'Edge Room', area, env: 'city',
    positioned: true, x: 0, y: 0, z: 0, areaVersion: 1, exits: { east: area + ':unknown' },
  });

  const body = makeBody();
  renderMap(body);
  assert.ok(body.innerHTML.includes('map-stub-e"'), 'unmapped east exit -> east stub');
});

test('exits to a different zone render as stubs, not connectors', () => {
  const area = 'ZoneA';
  // Current room is positioned; its east exit leads to a room positioned in a
  // DIFFERENT zone (ZoneB) -- must be a boundary stub, never a connector.
  v2.mergeServerAreaData({
    area, version: 1, replace: true,
    rooms: [
      { id: 'ZoneA:edge', name: 'Border Gate', area, env: 'city',
        positioned: true, x: 0, y: 0, z: 0, exits: { east: 'ZoneB:gate' } },
      { id: 'ZoneB:gate', name: 'Other Gate', area: 'ZoneB', env: 'city',
        positioned: true, x: 1, y: 0, z: 0, exits: { west: 'ZoneA:edge' } },
    ],
  });
  v2.processCurrent({
    id: 'ZoneA:edge', name: 'Border Gate', area, env: 'city',
    positioned: true, x: 0, y: 0, z: 0, areaVersion: 1, exits: { east: 'ZoneB:gate' },
  });

  const body = makeBody();
  renderMap(body);
  const out = body.innerHTML;
  assert.ok(out.includes('map-stub-e map-stub-area"'),
    'cross-zone east exit -> area-boundary stub');
  assert.ok(!out.includes('map-conn-e"'), 'cross-zone exit must not be a connector');
  assert.ok(out.includes('east -&gt; ZoneB'), 'tooltip names the destination zone');
});

// ── Diagonal exits + per-tile indicators ─────────────────────────────────────

// Render `room` (with optional neighbours) as the positioned current room at
// the origin of a fresh area and return the produced HTML.
function renderWithRooms(area, rooms, currentOverrides = {}) {
  v2.mergeServerAreaData({ area, version: 1, replace: true, rooms });
  v2.processCurrent(Object.assign({}, rooms[0], { areaVersion: 1 }, currentOverrides));
  const body = makeBody();
  renderMap(body);
  return body.innerHTML;
}

test('reciprocal diagonal exits render corner connectors both ways', () => {
  const area = 'DiagLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Crossroads', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':B' } },
    { id: area + ':B', name: 'Hilltop', area, env: 'hills',
      positioned: true, x: 1, y: -1, z: 0, exits: { southwest: area + ':A' } },
  ]);
  assert.ok(out.includes('map-conn-ne"'), 'A draws its northeast connector');
  assert.ok(out.includes('map-conn-sw"'), 'B draws its southwest connector');
  assert.ok(!out.includes('map-stub-ne"'), 'mapped adjacent diagonal is not a stub');
});

test('one-way diagonal exit draws a dashed connector with an arrowhead', () => {
  const area = 'OneWayDiag';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Ledge', area, env: 'mountain',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':B' } },
    { id: area + ':B', name: 'Slope', area, env: 'mountain',
      positioned: true, x: 1, y: -1, z: 0, exits: {} },
  ]);
  assert.ok(out.includes('map-conn-ne map-conn-oneway"'),
    'exit owner draws the one-way connector');
  assert.ok(out.includes('map-arrow-ne"'), 'arrowhead toward the destination');
  assert.ok(!out.includes('map-conn-sw'), 'no return exit -> no southwest span');
});

test('one-way cardinal exit is marked; reciprocal is not', () => {
  const area = 'OneWayCard';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Chute Top', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0,
      exits: { east: area + ':B', north: area + ':N' } },
    { id: area + ':B', name: 'Chute Bottom', area, env: 'city',
      positioned: true, x: 1, y: 0, z: 0, exits: {} },
    { id: area + ':N', name: 'Two Way', area, env: 'city',
      positioned: true, x: 0, y: -1, z: 0, exits: { south: area + ':A' } },
  ]);
  assert.ok(out.includes('map-conn-e map-conn-oneway"'), 'east is one-way');
  assert.ok(out.includes('map-arrow-e"'), 'east arrowhead present');
  assert.ok(out.includes('map-conn-n"'), 'reciprocal north is a plain connector');
  assert.ok(!out.includes('map-conn-n map-conn-oneway'), 'north not marked one-way');
  assert.ok(!out.includes('map-arrow-n"'), 'no arrowhead on the reciprocal exit');
});

test('diagonal exit to an unmapped room renders a diagonal stub', () => {
  const area = 'DiagStub';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Fork', area, env: 'forest',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':unknown' } },
  ]);
  assert.ok(out.includes('map-stub-ne"'), 'unmapped diagonal -> corner stub');
  assert.ok(!out.includes('map-conn-ne"'), 'and no connector');
});

test('cross-zone diagonal exit renders a stub, not a connector', () => {
  const area = 'DiagZoneA';
  const out = renderWithRooms(area, [
    { id: area + ':edge', name: 'Border Rock', area, env: 'hills',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: 'DiagZoneB:gate' } },
    { id: 'DiagZoneB:gate', name: 'Far Gate', area: 'DiagZoneB', env: 'city',
      positioned: true, x: 1, y: -1, z: 0, exits: { southwest: area + ':edge' } },
  ]);
  assert.ok(out.includes('map-stub-ne map-stub-area"'),
    'cross-zone diagonal -> area-boundary stub');
  assert.ok(!out.includes('map-conn-ne'), 'never a connector across zones');
});

test('mapped but non-adjacent diagonal renders an adjusted-layout stub', () => {
  const area = 'FarDiag';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Start', area, env: 'plains',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':B' } },
    { id: area + ':B', name: 'Distant', area, env: 'plains',
      positioned: true, x: 3, y: -3, z: 0, exits: { southwest: area + ':A' } },
  ]);
  assert.ok(!out.includes('map-conn-ne"'), 'non-adjacent room -> no drawable line');
  assert.ok(out.includes('map-stub-ne map-stub-adjusted"'),
    'known non-adjacent edge remains visible as adjusted');
});

test('diagonal to a different z-level renders nothing (pins existing skip)', () => {
  const area = 'ZDiag';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Base', area, env: 'underground',
      positioned: true, x: 0, y: 0, z: 0, exits: { northeast: area + ':B' } },
    { id: area + ':B', name: 'Upper', area, env: 'underground',
      positioned: true, x: 1, y: -1, z: 1, exits: { southwest: area + ':A' } },
  ]);
  assert.ok(!out.includes('map-conn-ne"'), 'z-mismatched dest -> no connector');
  assert.ok(!out.includes('map-stub-ne"'), 'z-mismatched dest -> no stub');
});

test('all four diagonal rotations render from one center room', () => {
  const area = 'FourDiag';
  const mk = (suffix, x, y, back) => ({
    id: area + ':' + suffix, name: suffix, area, env: 'city',
    positioned: true, x, y, z: 0, exits: { [back]: area + ':C' },
  });
  const out = renderWithRooms(area, [
    { id: area + ':C', name: 'Center', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0,
      exits: {
        northeast: area + ':NE', northwest: area + ':NW',
        southeast: area + ':SE', southwest: area + ':SW',
      } },
    mk('NE', 1, -1, 'southwest'), mk('NW', -1, -1, 'southeast'),
    mk('SE', 1, 1, 'northwest'), mk('SW', -1, 1, 'northeast'),
  ]);
  for (const abbr of ['ne', 'nw', 'se', 'sw']) {
    assert.ok(out.includes('map-conn-' + abbr + '"'), 'connector ' + abbr + ' present');
  }
});

test('rooms with up/down exits get per-tile vertical glyphs', () => {
  const area = 'VertLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Stairwell', area, env: 'inside',
      positioned: true, x: 0, y: 0, z: 0,
      exits: { up: area + ':up1', down: area + ':down1', east: area + ':B' } },
    { id: area + ':B', name: 'Flat Room', area, env: 'inside',
      positioned: true, x: 1, y: 0, z: 0, exits: { west: area + ':A' } },
  ]);
  assert.ok(out.includes('map-vert-up'), 'up exit -> up glyph on the tile');
  assert.ok(out.includes('map-vert-down'), 'down exit -> down glyph on the tile');
  // Exactly one tile has them (the neighbour has no vertical exits).
  assert.equal(out.split('map-vert-up').length - 1, 1, 'only the stairwell shows up glyph');
});

test('enter/in exits get the inward glyph, out/leave the outward glyph', () => {
  const area = 'InOutLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Shopfront', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0,
      exits: { enter: area + ':shop', east: area + ':B' },
      exitKinds: { enter: 'special', east: 'spatial' } },
    { id: area + ':B', name: 'Shop Interior', area, env: 'inside',
      positioned: true, x: 1, y: 0, z: 0,
      exits: { west: area + ':A', out: area + ':A' },
      exitKinds: { west: 'spatial', out: 'special' } },
  ]);
  assert.ok(out.includes('map-exit-in'), 'enter exit -> inward glyph');
  assert.ok(out.includes('map-exit-out'), 'out exit -> outward glyph');
  assert.ok(!out.includes('map-exit-special'),
    'in/out exits do not also render the generic dot');
});

test('other special (portal/custom verb) exits keep the generic dot', () => {
  const area = 'PortalLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Portal Chamber', area, env: 'inside',
      positioned: true, x: 0, y: 0, z: 0,
      exits: { portal: area + ':far', enter: area + ':shop' },
      exitKinds: { portal: 'special', enter: 'special' } },
  ]);
  assert.ok(out.includes('map-exit-in'), 'enter still renders the in glyph');
  assert.ok(out.includes('map-exit-special map-exit-special-shifted"'),
    'portal renders the dot, shifted off the in/out corner');
});

test('overlapping rooms get the conflict class and stack-count badge', () => {
  const area = 'OverlapLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'Front Room', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0, exits: {} },
    { id: area + ':B', name: 'Squatter', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0, exits: {} },
  ]);
  assert.ok(out.includes('map-tile-conflict'), 'shared cell -> conflict class');
  assert.ok(out.includes('data-stack="2"'), 'badge carries the stack count');
});

test('doors render state-colored ticks, even with no exit behind them', () => {
  const area = 'DoorLand';
  const out = renderWithRooms(area, [
    // Open east door with a real exit; locked south door whose exit the
    // server stripped (closed doors remove their exit); closed up door
    // with no up exit -> glyph still renders, tinted.
    { id: area + ':A', name: 'Gatehouse', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0,
      exits: { east: area + ':B' },
      exitDoors: { east: 1, south: 3, up: 2 } },
    { id: area + ':B', name: 'Courtyard', area, env: 'city',
      positioned: true, x: 1, y: 0, z: 0, exits: { west: area + ':A' } },
  ]);
  assert.ok(out.includes('map-door-e map-door-state-open"'),
    'open east door tick');
  assert.ok(out.includes('map-door-s map-door-state-locked"'),
    'locked south door tick renders without an exit entry');
  assert.ok(!out.includes('map-stub-s"'), 'no stub invented for the doored dir');
  assert.ok(out.includes('map-vert-up map-vert-door-closed"'),
    'closed up-door renders a tinted up glyph despite no up exit');
});

test('room details render a feature badge and tooltip list', () => {
  const area = 'DetailLand';
  const out = renderWithRooms(area, [
    { id: area + ':A', name: 'General Store', area, env: 'city',
      positioned: true, x: 0, y: 0, z: 0, exits: {},
      details: ['shop', 'bank'] },
  ]);
  assert.ok(out.includes('map-detail">$<'), 'shop badge is the $ glyph');
  assert.ok(out.includes('[shop, bank]'), 'tooltip lists every detail');
});

test('browse mode renders a catalog area with no player marker', () => {
  // Live current room is elsewhere; the browse pane must be independent of it.
  seedArea('LiveLand');
  v2.processCurrent({
    id: 'LiveLand:A', name: 'Town Square', area: 'LiveLand',
    positioned: true, x: 0, y: 0, z: 0, areaVersion: 1, exits: {},
  });

  v2.mergeBrowseArea({
    catalog: 'darkwind.maincity', name: 'Darkwind City', replace: true,
    center: 'mc:1', more: false, offset: 0,
    rooms: [
      { id: 'mc:1', name: 'Temple Yard', area: 'Darkwind', env: 'city',
        positioned: true, x: 0, y: 0, z: 0, exits: { east: 'mc:2' } },
      { id: 'mc:2', name: 'Market', area: 'Darkwind', env: 'city',
        positioned: true, x: 1, y: 0, z: 0, exits: { west: 'mc:1' } },
    ],
  });

  const body = makeBody();
  renderMap(body, v2.browseSource);
  const out = body.innerHTML;

  assert.ok(!out.includes('map-empty'), 'browse area renders, not blank');
  assert.ok(out.includes('map-grid'), 'renders the tile grid');
  assert.ok(out.includes('Darkwind City'), 'titled with the catalog area name');
  assert.ok(out.includes('map-conn-e"'), 'connector between the two browse rooms');
  assert.ok(!out.includes('map-tile-player'), 'no player marker in browse mode');
  assert.ok(!out.includes('map-resync-btn'), 'no resync button in browse mode');

  v2.exitBrowse();
  // Live render is unaffected after browsing.
  const body2 = makeBody();
  renderMap(body2);
  assert.ok(body2.innerHTML.includes('map-tile-player'), 'live map still has the player');
});

test('genuinely empty area still shows the explore placeholder', () => {
  v2.processCurrent({
    id: 'Voidland:x', name: 'Featureless Void', area: 'Voidland',
    positioned: false, areaVersion: 0, exits: {},
  });

  const body = makeBody();
  renderMap(body);
  assert.ok(body.innerHTML.includes('map-empty'), 'no data for area -> placeholder');
});

// ── Sync protocol semantics (chunk continuation + baseline reconciliation) ───

function withGmcpSpy(fn) {
  const sent = [];
  const orig = gmcp.send;
  gmcp.send = (pkg, data) => { sent.push({ pkg, data }); };
  try { fn(sent); } finally { gmcp.send = orig; }
}

test('chunked area sync continues with the server cursor, not a version mark', () => {
  v2.clearMapData();
  withGmcpSpy((sent) => {
    v2.mergeServerUpdate({
      area: 'ChunkLand', version: 90, since: 0, offset: 50, more: 1, replace: 1,
      rooms: [{ id: 'c1', name: 'C1', positioned: 1, x: 0, y: 0, z: 0, version: 90, exits: {} }],
    });
    assert.equal(sent.length, 1, 'continuation Sync sent while more=1');
    assert.equal(sent[0].pkg, 'Darkwind.MapData2.Sync');
    assert.equal(sent[0].data.version, 0, 'continuation re-sends the ORIGINAL since');
    assert.equal(sent[0].data.offset, 50, 'continuation carries the cursor');
  });

  // Baseline is not established until the final chunk arrives.
  withGmcpSpy(() => {
    v2.processCurrent({
      id: 'c1', name: 'C1', area: 'ChunkLand', positioned: 1,
      x: 0, y: 0, z: 0, areaVersion: 90, exits: {},
    });
  });

  withGmcpSpy((sent) => {
    v2.mergeServerUpdate({
      area: 'ChunkLand', version: 90, since: 0, offset: 70, more: 0,
      rooms: [{ id: 'c2', name: 'C2', positioned: 1, x: 1, y: 0, z: 0, version: 88, exits: {} }],
    });
    assert.equal(sent.length, 0, 'no continuation after the final chunk');
  });

  // Now the baseline is 90: a Current at the same version requests nothing.
  withGmcpSpy((sent) => {
    v2.processCurrent({
      id: 'c2', name: 'C2', area: 'ChunkLand', positioned: 1,
      x: 1, y: 0, z: 0, areaVersion: 90, exits: {},
    });
    assert.equal(sent.length, 0, 'baseline up to date -> no sync request');
  });
});

test('server version regression triggers a full resync (frame reset)', () => {
  v2.clearMapData();
  // Complete a sync at version 200.
  v2.mergeServerAreaData({
    area: 'ResetLand', version: 200, more: 0, replace: 1,
    rooms: [{ id: 'r1', name: 'R1', positioned: 1, x: 0, y: 0, z: 0, version: 200, exits: {} }],
  });

  withGmcpSpy((sent) => {
    v2.processCurrent({
      id: 'r1', name: 'R1', area: 'ResetLand', positioned: 1,
      x: 0, y: 0, z: 0, areaVersion: 5, exits: {},
    });
    assert.equal(sent.length, 1, 'regressed server version -> resync requested');
    assert.equal(sent[0].data.version, 0, 'and it is a FULL sync');
  });
});

test('first Current for an unsynced area requests a full sync (login path)', () => {
  v2.clearMapData();
  withGmcpSpy((sent) => {
    v2.processCurrent({
      id: 'f1', name: 'F1', area: 'FreshLand', positioned: 1,
      x: 0, y: 0, z: 0, areaVersion: 42, exits: {},
    });
    assert.equal(sent.length, 1, 'no baseline -> full sync requested');
    assert.equal(sent[0].data.area, 'FreshLand');
    assert.equal(sent[0].data.version, 0);
  });
});

test('v2 replacement snapshots are applied atomically on completion', () => {
  v2.clearMapData();
  v2.mergeServerAreaData({
    area: 'AtomicLand', version: 4, more: 0, replace: 1,
    rooms: [{ id: 'old', name: 'Old', area: 'AtomicLand', positioned: 1,
      x: 0, y: 0, z: 0, exits: {} }],
  });
  withGmcpSpy((sent) => {
    v2.mergeServerUpdate({
      protocol: 2, mapEpoch: 'epoch-a', area: 'AtomicLand', areaGeneration: 2,
      since: 0, snapshotVersion: 8, latestVersion: 8, cursor: 10,
      complete: 0, replace: 1,
      rooms: [{ id: 'new-a', name: 'New A', area: 'AtomicLand', positioned: 1,
        x: 1, y: 0, z: 0, exits: {} }],
    });
    assert.ok(v2.getRoom('old'), 'old complete snapshot remains visible mid-sync');
    assert.equal(v2.getRoom('new-a'), undefined, 'partial room is staged');
    assert.equal(sent.length, 1, 'continuation requested');

    v2.mergeServerUpdate({
      protocol: 2, mapEpoch: 'epoch-a', area: 'AtomicLand', areaGeneration: 2,
      since: 0, snapshotVersion: 8, latestVersion: 8, cursor: 20,
      complete: 1, replace: 1,
      rooms: [{ id: 'new-b', name: 'New B', area: 'AtomicLand', positioned: 1,
        x: 2, y: 0, z: 0, exits: {} }],
    });
    assert.equal(v2.getRoom('old'), undefined, 'old snapshot removed at commit');
    assert.ok(v2.getRoom('new-a'));
    assert.ok(v2.getRoom('new-b'));
  });
});

test('v2 epoch changes discard stale areas and request a full snapshot', () => {
  v2.clearMapData();
  v2.mergeServerUpdate({
    protocol: 2, mapEpoch: 'old-epoch', area: 'OldLand', areaGeneration: 1,
    since: 0, snapshotVersion: 1, latestVersion: 1, complete: 1, replace: 1,
    cursor: 'old', rooms: [{ id: 'old-room', name: 'Old', area: 'OldLand',
      positioned: 1, x: 0, y: 0, z: 0, exits: {} }],
  });
  assert.ok(v2.getRoom('old-room'));

  withGmcpSpy((sent) => {
    v2.processCurrent({
      protocol: 2, mapEpoch: 'new-epoch', areaGeneration: 1,
      id: 'new-room', name: 'New', area: 'NewLand', positioned: 1,
      x: 0, y: 0, z: 0, areaVersion: 1, exits: {}, liveExits: {},
    });
    assert.equal(v2.getRoom('old-room'), undefined, 'old epoch cache removed');
    assert.equal(v2.getMapEpoch(), 'new-epoch');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].data.since, 0, 'new epoch starts with a full sync');
  });
});

test('v2 generation errors restart only the affected area', () => {
  v2.clearMapData();
  v2.mergeServerUpdate({
    protocol: 2, mapEpoch: 'stable-epoch', area: 'RepairLand', areaGeneration: 1,
    since: 0, snapshotVersion: 5, latestVersion: 5, complete: 1, replace: 1,
    cursor: 'r1', rooms: [{ id: 'r1', name: 'Room', area: 'RepairLand',
      positioned: 1, x: 0, y: 0, z: 0, exits: {} }],
  });
  withGmcpSpy((sent) => {
    v2.processSyncError({
      code: 'generation_changed', area: 'RepairLand', restart: 1,
      mapEpoch: 'stable-epoch', areaGeneration: 2,
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].data.generation, 2);
    assert.equal(sent[0].data.since, 0);
  });
});
