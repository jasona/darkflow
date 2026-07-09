// Tests for click-to-walk speedwalk (map-speedwalk.js): BFS pathfinding over
// the MapData2 graph and the verified step-by-step walk driver.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- Minimal browser globals so the client modules import under Node -------
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

const v2 = await import('../public/js/map-data-v2.js');
const gmcpMap = await import('../public/js/map-data-gmcp.js');
const sw = await import('../public/js/map-speedwalk.js');
const { gmcp } = await import('../public/js/gmcp.js');
gmcp.send = () => {};

// A small walkable area:
//   A --e--> B --n--> C     B --enter--> D (special exit)
//   A --n--> LockedRoom (behind a locked door: not routable)
//   E lives in another area.
function seedWalkArea() {
  const area = 'WalkLand';
  v2.clearMapData();
  v2.mergeServerAreaData({
    area, version: 1, replace: true,
    rooms: [
      { id: 'A', name: 'Start', area, env: 'city', positioned: true,
        x: 0, y: 0, z: 0,
        exits: { east: 'B', north: 'L' },
        exitDoors: { north: 3 } },
      { id: 'B', name: 'Middle', area, env: 'city', positioned: true,
        x: 1, y: 0, z: 0,
        exits: { west: 'A', north: 'C', enter: 'D' },
        exitKinds: { west: 'spatial', north: 'spatial', enter: 'special' } },
      { id: 'C', name: 'North End', area, env: 'city', positioned: true,
        x: 1, y: -1, z: 0, exits: { south: 'B' } },
      { id: 'D', name: 'Hidden Shrine', area, env: 'inside', positioned: true,
        x: 2, y: 1, z: 0, exits: { out: 'B' } },
      { id: 'L', name: 'Vault', area, env: 'inside', positioned: true,
        x: 0, y: -1, z: 0, exits: { south: 'A' } },
      { id: 'E', name: 'Elsewhere', area: 'OtherLand', env: 'city',
        positioned: true, x: 5, y: 5, z: 0, exits: {} },
    ],
  });
  v2.processCurrent({
    id: 'A', name: 'Start', area, positioned: true, x: 0, y: 0, z: 0,
    areaVersion: 1, exits: { east: 'B', north: 'L' },
    exitDoors: { north: 3 },
  });
  return area;
}

test('findPath routes canonical movement and rejects unsafe special exits', () => {
  seedWalkArea();
  assert.deepEqual(
    sw.findPath('A', 'C').map((s) => s.dir), ['east', 'north']);
  assert.equal(sw.findPath('A', 'D'), null, 'arbitrary enter is not auto-executed');
  assert.deepEqual(sw.findPath('A', 'A'), []);
});

test('findPath refuses closed/locked doors and cross-area targets', () => {
  seedWalkArea();
  assert.equal(sw.findPath('A', 'L'), null, 'locked door is not routable');
  assert.equal(sw.findPath('A', 'E'), null, 'cross-area target unreachable');
  assert.equal(sw.findPath('A', 'nosuch'), null, 'unknown room unreachable');
});

test('speedwalk refuses a route missing from the current live exit snapshot', () => {
  seedWalkArea();
  v2.processCurrent({
    protocol: 2, mapEpoch: 'trust-epoch', areaGeneration: 1,
    id: 'A', name: 'Start', area: 'WalkLand', positioned: true,
    x: 0, y: 0, z: 0, areaVersion: 1,
    exits: { east: 'B' }, liveExits: {}, liveDoors: {},
  });
  sw.initSpeedwalk({ send: noop, rerender: noop, stepTimeoutMs: 5000 });
  assert.equal(sw.startSpeedwalk('C'), false);
  assert.ok(v2.getMapStatus().includes('No known path'));
});

test('identity-conflicted current rooms are never speedwalkable', () => {
  seedWalkArea();
  v2.processCurrent({
    protocol: 2, mapEpoch: 'trust-epoch', areaGeneration: 1,
    id: 'A', name: 'Conflicted Start', area: 'WalkLand', positioned: false,
    layoutState: 'identity_conflict', areaVersion: 1,
    liveExits: { east: 'B' }, liveDoors: {},
  });
  assert.equal(v2.canWalkExit(v2.getRoom('A'), 'east', 'B'), false);
});

test('speedwalk sends steps one at a time and verifies each arrival', () => {
  seedWalkArea();
  const sent = [];
  sw.initSpeedwalk({ send: (cmd) => sent.push(cmd), rerender: noop,
    stepTimeoutMs: 5000 });

  assert.equal(sw.startSpeedwalk('C'), true);
  assert.deepEqual(sent, ['east'], 'first step sent immediately');
  assert.ok(sw.isSpeedwalking());
  assert.ok(v2.getMapStatus().includes('Walking to North End'));

  v2.processCurrent({
    id: 'B', name: 'Middle', area: 'WalkLand', positioned: true,
    x: 1, y: 0, z: 0, areaVersion: 1,
    exits: { west: 'A', north: 'C', enter: 'D' },
  });
  sw.notifyRoomChange('B');
  assert.deepEqual(sent, ['east', 'north'], 'verified arrival sends next step');

  sw.notifyRoomChange('C');
  assert.equal(sw.isSpeedwalking(), false, 'walk completes on arrival');
  assert.ok(v2.getMapStatus().includes('Arrived'), 'arrival status shown');
});

test('speedwalk aborts when a step lands somewhere unexpected', () => {
  seedWalkArea();
  const sent = [];
  sw.initSpeedwalk({ send: (cmd) => sent.push(cmd), rerender: noop,
    stepTimeoutMs: 5000 });

  sw.startSpeedwalk('C');
  sw.notifyRoomChange('L');
  assert.equal(sw.isSpeedwalking(), false, 'unexpected room aborts the walk');
  assert.deepEqual(sent, ['east'], 'no further steps after the abort');
  assert.ok(v2.getMapStatus().includes('stopped'), 'abort status shown');
});

test('speedwalk aborts after the per-step timeout', async () => {
  seedWalkArea();
  sw.initSpeedwalk({ send: noop, rerender: noop, stepTimeoutMs: 20 });

  sw.startSpeedwalk('C');
  assert.ok(sw.isSpeedwalking());
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(sw.isSpeedwalking(), false, 'timeout cancels the walk');
});

test('no known path reports without sending anything', () => {
  seedWalkArea();
  const sent = [];
  sw.initSpeedwalk({ send: (cmd) => sent.push(cmd), rerender: noop,
    stepTimeoutMs: 5000 });

  assert.equal(sw.startSpeedwalk('E'), false);
  assert.deepEqual(sent, []);
  assert.ok(v2.getMapStatus().includes('No known path'));
});

test('Darkwind.MapData2.Current frames drive the walk via the gmcp bus', () => {
  seedWalkArea();
  const sent = [];
  sw.initSpeedwalk({ send: (cmd) => sent.push(cmd), rerender: noop,
    stepTimeoutMs: 5000 });

  sw.startSpeedwalk('C');
  v2.processCurrent({
    id: 'B', name: 'Middle', area: 'WalkLand', positioned: true,
    x: 1, y: 0, z: 0, areaVersion: 1,
    exits: { west: 'A', north: 'C' },
  });
  gmcp.dispatch('Darkwind.MapData2.Current', { id: 'B' });
  assert.deepEqual(sent, ['east', 'north'], 'bus-delivered arrival advances');
  sw.cancelSpeedwalk();
  assert.equal(sw.isSpeedwalking(), false);
});

test('generic Room.Info frames verify external speedwalks', () => {
  gmcpMap.configureWorld({ name: 'speedwalk-external', host: 'external.test', port: '4242' });
  gmcpMap.clearMapData();
  gmcpMap.processRoomInfo({ num: 10, name: 'Outside Start', area: 'Elsewhere', exits: { east: 11 } });
  gmcpMap.processRoomInfo({ num: 11, name: 'Outside Middle', area: 'Elsewhere', exits: { west: 10, north: 12 } });
  gmcpMap.processRoomInfo({ num: 10, name: 'Outside Start', area: 'Elsewhere', exits: { east: 11 } });
  gmcpMap.processRoomInfo({ num: 11, name: 'Outside Middle', area: 'Elsewhere', exits: { west: 10, north: 12 } });
  gmcpMap.processRoomInfo({ num: 12, name: 'Outside Goal', area: 'Elsewhere', exits: { south: 11 } });
  gmcpMap.processRoomInfo({ num: 10, name: 'Outside Start', area: 'Elsewhere', exits: { east: 11 } });

  const sent = [];
  sw.initSpeedwalk({
    send: (cmd) => sent.push(cmd),
    rerender: noop,
    stepTimeoutMs: 5000,
    source: () => gmcpMap,
  });

  assert.equal(sw.startSpeedwalk('12', gmcpMap), true);
  assert.deepEqual(sent, ['east']);
  gmcpMap.processRoomInfo({ num: 11, name: 'Outside Middle', area: 'Elsewhere',
    exits: { west: 10, north: 12 } });
  gmcp.dispatch('Room.Info', { num: 11 });
  assert.deepEqual(sent, ['east', 'north']);
  gmcp.dispatch('Room.Info', { num: 12 });
  assert.equal(sw.isSpeedwalking(), false);
  assert.ok(gmcpMap.getMapStatus().includes('Arrived'));
});
