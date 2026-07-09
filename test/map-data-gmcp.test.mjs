import test from 'node:test';
import assert from 'node:assert/strict';

global.localStorage = {
  _data: new Map(),
  get length() { return this._data.size; },
  key(index) { return Array.from(this._data.keys())[index] || null; },
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; },
  setItem(key, value) { this._data.set(key, String(value)); },
  removeItem(key) { this._data.delete(key); },
  clear() { this._data.clear(); },
};

const gmcpMap = await import('../public/js/map-data-gmcp.js');
const mapStorage = await import('../public/js/map-storage.js');

function reset(name = 'test-world') {
  localStorage.clear();
  gmcpMap.configureWorld({ name, host: 'example.test', port: '4242' });
  gmcpMap.clearMapData();
}

test('generic Room.Info mapper rejects repeated placeholder coordinates and infers layout', () => {
  reset('nukefire');

  gmcpMap.processRoomInfo({
    num: 3001,
    name: 'The Temple of Technology',
    area: 'Tek Angeles',
    zone: 29,
    terrain: 'Inside',
    exits: { north: 3004, east: 3010, south: 3002, west: 3252, up: 3128, down: 3175 },
    coords: { x: 0, y: 0, z: 0 },
  });
  gmcpMap.processRoomInfo({
    num: 3004,
    name: 'The reading room',
    area: 'Tek Angeles',
    exits: { south: 3001 },
    coords: { x: 0, y: 0, z: 0 },
  });
  gmcpMap.processRoomInfo({
    num: 3001,
    name: 'The Temple of Technology',
    area: 'Tek Angeles',
    exits: { north: 3004, east: 3010, south: 3002, west: 3252, up: 3128, down: 3175 },
    coords: { x: 0, y: 0, z: 0 },
  });
  gmcpMap.processRoomInfo({
    num: 3010,
    name: 'Technology Square',
    area: 'Tek Angeles',
    exits: { north: 3007, east: 3011, south: 3014, west: 3001 },
    coords: { x: 0, y: 0, z: 0 },
  });

  assert.deepEqual(
    { x: gmcpMap.getRoom('3004').x, y: gmcpMap.getRoom('3004').y, z: gmcpMap.getRoom('3004').z },
    { x: 0, y: -1, z: 0 }
  );
  assert.deepEqual(
    { x: gmcpMap.getRoom('3010').x, y: gmcpMap.getRoom('3010').y, z: gmcpMap.getRoom('3010').z },
    { x: 1, y: 0, z: 0 }
  );
  assert.equal(gmcpMap.getRoom('3010').coordSource, 'inferred');
});

test('generic Room.Info mapper records closed exits as door markers and not routable exits', () => {
  reset('nukefire-doors');

  gmcpMap.processRoomInfo({
    num: 3001,
    name: 'The Temple of Technology',
    area: 'Tek Angeles',
    exits: { west: 3252 },
  });
  gmcpMap.processRoomInfo({
    num: 3252,
    name: 'A quiet room',
    area: 'Tek Angeles',
    exits: { east: 3001, west: 'closed', up: 3254 },
    exit_states: { west: 'closed' },
  });

  const room = gmcpMap.getRoom('3252');
  assert.equal(room.exits.west, undefined);
  assert.equal(room.exitDoors.west, 2);
  assert.equal(room.exits.east, '3001');
});

test('generic Room.Info mapper promotes coherent coordinates once they are trustworthy', () => {
  reset('coherent-coords');

  for (const room of [
    { num: 1, name: 'A', area: 'Grid', exits: { east: 2 }, coords: { x: 10, y: 10, z: 0 } },
    { num: 2, name: 'B', area: 'Grid', exits: { west: 1, east: 3 }, coords: { x: 11, y: 10, z: 0 } },
    { num: 3, name: 'C', area: 'Grid', exits: { west: 2, south: 4 }, coords: { x: 12, y: 10, z: 0 } },
    { num: 4, name: 'D', area: 'Grid', exits: { north: 3 }, coords: { x: 12, y: 11, z: 0 } },
  ]) {
    gmcpMap.processRoomInfo(room);
  }

  assert.equal(gmcpMap.getRoom('1').coordSource, 'gmcp');
  assert.deepEqual(
    { x: gmcpMap.getRoom('1').x, y: gmcpMap.getRoom('1').y, z: gmcpMap.getRoom('1').z },
    { x: 10, y: 10, z: 0 }
  );
  assert.equal(gmcpMap.getRoom('4').coordSource, 'gmcp');
});

test('generic world identity is anchored to endpoint, not mutable hello name', () => {
  gmcpMap.configureWorld({ host: 'same.example', port: '4242' });
  const endpointKey = gmcpMap.getWorldKey();
  gmcpMap.configureWorld({ name: 'Renamed MUD', host: 'same.example', port: '4242' });
  assert.equal(gmcpMap.getWorldKey(), endpointKey);
});

test('generic mapper does not trust unique but geometrically incoherent coordinates', () => {
  reset('incoherent-coords');
  for (const room of [
    { num: 1, name: 'A', area: 'BrokenGrid', exits: { east: 2 }, coords: { x: 10, y: 10, z: 0 } },
    { num: 2, name: 'B', area: 'BrokenGrid', exits: { west: 1, east: 3 }, coords: { x: 50, y: 90, z: 0 } },
    { num: 3, name: 'C', area: 'BrokenGrid', exits: { west: 2, east: 4 }, coords: { x: -20, y: 3, z: 0 } },
    { num: 4, name: 'D', area: 'BrokenGrid', exits: { west: 3 }, coords: { x: 999, y: 2, z: 0 } },
  ]) gmcpMap.processRoomInfo(room);
  assert.notEqual(gmcpMap.getRoom('1').coordSource, 'gmcp');
  assert.notEqual(gmcpMap.getRoom('4').coordSource, 'gmcp');
});

test('generic hydration keeps cached areas when live Room.Info arrives first', async () => {
  reset('hydrate-race');
  const world = gmcpMap.getWorldKey();
  await mapStorage.saveMapArea('room-info', world, 'Remembered', {
    schemaVersion: 2,
    rooms: [{
      id: 'cached', name: 'Cached Room', area: 'Remembered', exits: {},
      x: 4, y: 5, z: 0, positioned: true, walkSafe: {},
    }],
  });

  const loading = gmcpMap.load();
  gmcpMap.processRoomInfo({
    num: 'live', name: 'Live Room', area: 'Current', exits: { north: 'next' },
  });
  await loading;

  assert.equal(gmcpMap.getRoom('cached').name, 'Cached Room');
  assert.equal(gmcpMap.getRoom('live').name, 'Live Room');
});
