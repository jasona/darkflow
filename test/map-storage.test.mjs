import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  _data: new Map(),
  get length() { return this._data.size; },
  key(index) { return Array.from(this._data.keys())[index] || null; },
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; },
  setItem(key, value) { this._data.set(key, String(value)); },
  removeItem(key) { this._data.delete(key); },
  clear() { this._data.clear(); },
};

const storage = await import('../public/js/map-storage.js');

test('map storage isolates sources, worlds, and areas', async () => {
  localStorage.clear();
  await storage.saveMapArea('mapdata2', 'mud-a', 'Area A', { rooms: [{ id: 'a' }] });
  await storage.saveMapArea('mapdata2', 'mud-a', 'Area B', { rooms: [{ id: 'b' }] });
  await storage.saveMapArea('room-info', 'mud-a', 'Area A', { rooms: [{ id: 'learned' }] });
  await storage.saveMapArea('mapdata2', 'mud-b', 'Area A', { rooms: [{ id: 'other' }] });

  const records = await storage.loadMapAreas('mapdata2', 'mud-a');
  assert.deepEqual(records.map((entry) => entry.area).sort(), ['Area A', 'Area B']);
  assert.deepEqual(records.flatMap((entry) => entry.rooms.map((room) => room.id)).sort(), ['a', 'b']);
});

test('map storage deletes one area without disturbing its neighbors', async () => {
  await storage.deleteMapArea('mapdata2', 'mud-a', 'Area A');
  const records = await storage.loadMapAreas('mapdata2', 'mud-a');
  assert.deepEqual(records.map((entry) => entry.area), ['Area B']);
});

test('map storage ignores corrupt fallback records', async () => {
  localStorage.setItem('darkflow-map-area:mapdata2|mud-a|Broken', '{not-json');
  const records = await storage.loadMapAreas('mapdata2', 'mud-a');
  assert.deepEqual(records.map((entry) => entry.area), ['Area B']);
});
