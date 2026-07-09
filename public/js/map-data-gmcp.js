import { loadMapAreas, saveMapArea, deleteMapArea, clearMapSource, pruneMapAreas } from './map-storage.js';

export const DIR_OFFSETS = {
  north:     { dx:  0, dy: -1, dz: 0 },
  south:     { dx:  0, dy:  1, dz: 0 },
  east:      { dx:  1, dy:  0, dz: 0 },
  west:      { dx: -1, dy:  0, dz: 0 },
  northeast: { dx:  1, dy: -1, dz: 0 },
  northwest: { dx: -1, dy: -1, dz: 0 },
  southeast: { dx:  1, dy:  1, dz: 0 },
  southwest: { dx: -1, dy:  1, dz: 0 },
  up:        { dx:  0, dy:  0, dz: 1 },
  down:      { dx:  0, dy:  0, dz:-1 },
};

const DEFAULT_WORLD_KEY = 'unknown-world';
const LEGACY_STORAGE_PREFIX = 'darkflow-gmcp-map:';
const SCHEMA_VERSION = 2;
const STORAGE_SOURCE = 'room-info';
const MAP_STATUS_TTL_MS = 6000;
const SAVE_DEBOUNCE_MS = 200;
const TRUSTED_COORD_SAMPLE_MIN = 4;

let rooms = new Map();
let currentRoomId = null;
let currentAreaName = '';
let active = false;
let worldKey = DEFAULT_WORLD_KEY;
let mapStatusMessage = '';
let mapStatusAt = 0;
let saveTimer = null;
let lastRoomId = null;
let coordStatsByArea = new Map();
let dirtyAreas = new Set();
let storageError = '';
let loadToken = 0;

function normalizeRoomId(id) {
  return id === null || id === undefined ? null : String(id);
}

function safeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || DEFAULT_WORLD_KEY;
}

function roomIdFrom(data) {
  return normalizeRoomId(data && (data.num !== undefined ? data.num
    : data.id !== undefined ? data.id
    : data.vnum));
}

function areaFrom(data) {
  if (!data) return 'Unknown';
  if (data.area !== undefined && data.area !== null && data.area !== '') return String(data.area);
  if (data.zone !== undefined && data.zone !== null && data.zone !== '') return 'Zone ' + data.zone;
  return 'Unknown';
}

function exitKind(dir) {
  return DIR_OFFSETS[dir] ? (dir === 'up' || dir === 'down' ? 'vertical' : 'spatial') : 'special';
}

function doorStateNumber(state) {
  const text = String(state || '').toLowerCase();
  if (text === 'locked') return 3;
  if (text === 'closed') return 2;
  return 1;
}

function normalizeExits(data) {
  const exits = {};
  const exitKinds = {};
  const exitDoors = {};
  const rawExits = data && data.exits && typeof data.exits === 'object' ? data.exits : {};
  const rawStates = data && data.exit_states && typeof data.exit_states === 'object' ? data.exit_states : {};

  for (const [dir, dest] of Object.entries(rawExits)) {
    exitKinds[dir] = exitKind(dir);
    if (typeof dest === 'string' && !/^-?\d+$/.test(dest)) {
      exitDoors[dir] = doorStateNumber(dest);
      continue;
    }
    if (dest !== null && dest !== undefined && dest !== '') exits[dir] = normalizeRoomId(dest);
  }

  for (const [dir, state] of Object.entries(rawStates)) {
    exitKinds[dir] = exitKind(dir);
    exitDoors[dir] = doorStateNumber(state);
  }

  return { exits, exitKinds, exitDoors };
}

function getRawCoords(data) {
  const x = data && data.coord_x !== undefined ? Number(data.coord_x)
    : data && data.coords && data.coords.x !== undefined ? Number(data.coords.x) : NaN;
  const y = data && data.coord_y !== undefined ? Number(data.coord_y)
    : data && data.coords && data.coords.y !== undefined ? Number(data.coords.y) : NaN;
  const z = data && data.coord_z !== undefined ? Number(data.coord_z)
    : data && data.coords && data.coords.z !== undefined ? Number(data.coords.z) : NaN;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function coordKey(coords) {
  return coords.x + ',' + coords.y + ',' + coords.z;
}

function coordStats(area) {
  let stats = coordStatsByArea.get(area);
  if (!stats) {
    stats = { sample: 0, coords: new Set(), coherent: 0, trusted: false };
    coordStatsByArea.set(area, stats);
  }
  return stats;
}

function noteCoords(area, coords, roomId) {
  if (!coords) return false;
  const stats = coordStats(area);
  stats.sample++;
  stats.coords.add(coordKey(coords));
  const previous = currentRoomId ? rooms.get(currentRoomId) : null;
  if (previous && previous.id !== roomId && previous.area === area && previous.rawCoords) {
    for (const [dir, destId] of Object.entries(previous.exits || {})) {
      const offset = DIR_OFFSETS[dir];
      if (!offset || destId !== roomId) continue;
      if (previous.rawCoords.x + offset.dx === coords.x
        && previous.rawCoords.y + offset.dy === coords.y
        && previous.rawCoords.z + offset.dz === coords.z) stats.coherent++;
    }
  }
  if (stats.sample >= TRUSTED_COORD_SAMPLE_MIN
    && stats.coords.size >= TRUSTED_COORD_SAMPLE_MIN && stats.coherent >= 2) {
    stats.trusted = true;
  }
  return stats.trusted;
}

function rebuildCoordStats() {
  coordStatsByArea.clear();
  for (const room of rooms.values()) {
    if (!room.rawCoords) continue;
    const stats = coordStats(room.area);
    stats.sample++;
    stats.coords.add(coordKey(room.rawCoords));
  }
  for (const room of rooms.values()) {
    if (!room.rawCoords) continue;
    for (const [dir, destId] of Object.entries(room.exits || {})) {
      const offset = DIR_OFFSETS[dir];
      const dest = rooms.get(destId);
      if (!offset || !dest || !dest.rawCoords || dest.area !== room.area) continue;
      if (room.rawCoords.x + offset.dx === dest.rawCoords.x
        && room.rawCoords.y + offset.dy === dest.rawCoords.y
        && room.rawCoords.z + offset.dz === dest.rawCoords.z) coordStats(room.area).coherent++;
    }
  }
  for (const [area, stats] of coordStatsByArea) {
    stats.trusted = stats.sample >= TRUSTED_COORD_SAMPLE_MIN
      && stats.coords.size >= TRUSTED_COORD_SAMPLE_MIN && stats.coherent >= 2;
    if (stats.trusted) applyTrustedCoords(area);
  }
}

function applyTrustedCoords(area) {
  const stats = coordStatsByArea.get(area);
  if (!stats || !stats.trusted) return;
  for (const room of rooms.values()) {
    if (room.area !== area || !room.rawCoords) continue;
    room.x = room.rawCoords.x;
    room.y = room.rawCoords.y;
    room.z = room.rawCoords.z;
    room.coordSource = 'gmcp';
    room.positioned = true;
  }
}

function coordsOccupied(area, x, y, z, exceptId) {
  for (const room of rooms.values()) {
    if (room.id === exceptId || room.area !== area || room.x === null) continue;
    if (room.x === x && room.y === y && room.z === z) return true;
  }
  return false;
}

function inferCoords(roomId, area, exits) {
  const previous = currentRoomId ? rooms.get(currentRoomId) : null;
  if (previous && previous.area === area && previous.x !== null) {
    for (const [dir, destId] of Object.entries(previous.exits || {})) {
      if (destId !== roomId) continue;
      const offset = DIR_OFFSETS[dir];
      if (!offset) continue;
      const x = previous.x + offset.dx;
      const y = previous.y + offset.dy;
      const z = previous.z + offset.dz;
      if (!coordsOccupied(area, x, y, z, roomId)) return { x, y, z, source: 'inferred' };
      setMapStatus('Map layout conflict near ' + (previous.name || 'previous room'));
      return null;
    }
  }

  if (previous && previous.area === area && previous.x !== null) {
    for (const [dir, destId] of Object.entries(exits || {})) {
      if (destId !== previous.id) continue;
      const offset = DIR_OFFSETS[dir];
      if (!offset) continue;
      const x = previous.x - offset.dx;
      const y = previous.y - offset.dy;
      const z = previous.z - offset.dz;
      if (!coordsOccupied(area, x, y, z, roomId)) return { x, y, z, source: 'inferred' };
      setMapStatus('Map layout conflict near ' + (previous.name || 'previous room'));
      return null;
    }
  }

  if (!previous || previous.area !== area) {
    if (!coordsOccupied(area, 0, 0, 0, roomId)) return { x: 0, y: 0, z: 0, source: 'seed' };
  }
  return null;
}

function save(area) {
  if (area) dirtyAreas.add(area);
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushPendingMapSave();
  }, SAVE_DEBOUNCE_MS);
}

export function setMapStatus(msg) {
  mapStatusMessage = msg;
  mapStatusAt = Date.now();
}

export function configureWorld(identity = {}) {
  const nextKey = safeSlug([
    identity.host || identity.name || 'world',
    identity.port || '',
  ].filter(Boolean).join('@'));
  if (nextKey === worldKey) return;
  flushPendingMapSave();
  worldKey = nextKey;
  loadToken++;
  rooms.clear();
  coordStatsByArea.clear();
  load();
}

export function resetForConnection() {
  active = false;
  currentRoomId = null;
  currentAreaName = '';
  lastRoomId = null;
  mapStatusMessage = '';
}

export function processHello(data, connection = {}) {
  configureWorld({
    name: data && data.name,
    host: connection.host,
    port: connection.port,
  });
}

export function processRoomInfo(data) {
  const id = roomIdFrom(data);
  if (!id) return 0;

  const area = areaFrom(data);
  const rawCoords = getRawCoords(data);
  const coordsTrusted = noteCoords(area, rawCoords, id);
  const normalized = normalizeExits(data || {});
  const existing = rooms.get(id) || {};

  const next = {
    id,
    name: (data && data.name) || existing.name || '',
    area,
    environment: (data && (data.environment || data.terrain || data.env)) || existing.environment || '',
    exits: normalized.exits,
    exitKinds: normalized.exitKinds,
    exitDoors: normalized.exitDoors,
    rawCoords: rawCoords || existing.rawCoords || null,
    x: existing.x !== undefined ? existing.x : null,
    y: existing.y !== undefined ? existing.y : null,
    z: existing.z !== undefined ? existing.z : null,
    coordSource: existing.coordSource || '',
    positioned: false,
    version: 0,
    observed: true,
    observedAt: Date.now(),
    layoutState: 'learned',
    walkSafe: {},
    liveExits: normalized.exits,
    liveDoors: normalized.exitDoors,
    hasLiveObservation: true,
  };
  for (const dir of Object.keys(next.exits)) {
    next.walkSafe[dir] = !!DIR_OFFSETS[dir] || dir === 'in' || dir === 'out';
  }

  if (coordsTrusted && rawCoords) {
    next.x = rawCoords.x;
    next.y = rawCoords.y;
    next.z = rawCoords.z;
    next.coordSource = 'gmcp';
  } else if (next.x === null || next.x === undefined) {
    const inferred = inferCoords(id, area, next.exits);
    if (inferred) {
      next.x = inferred.x;
      next.y = inferred.y;
      next.z = inferred.z;
      next.coordSource = inferred.source;
    }
  }
  next.positioned = next.x !== null && next.x !== undefined;

  rooms.set(id, Object.assign(existing, next));
  if (coordsTrusted) applyTrustedCoords(area);
  lastRoomId = currentRoomId;
  currentRoomId = id;
  currentAreaName = area;
  active = true;
  if (!next.positioned) setMapStatus('Locating ' + (next.name || 'current room') + '...');
  save(area);
  return 1;
}

export function flushPendingMapSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const areas = Array.from(dirtyAreas);
  dirtyAreas.clear();
  for (const area of areas) {
    const areaRooms = [];
    for (const room of rooms.values()) if (room.area === area) areaRooms.push(room);
    saveMapArea(STORAGE_SOURCE, worldKey, area, {
      schemaVersion: SCHEMA_VERSION,
      rooms: areaRooms,
    }).then(() => pruneMapAreas(STORAGE_SOURCE, worldKey, 25000, area)).catch((error) => {
      storageError = error && error.message ? error.message : 'Map cache unavailable';
    });
  }
}

export async function load() {
  const token = ++loadToken;
  const loadingWorld = worldKey;
  rooms.clear();
  currentRoomId = null;
  currentAreaName = '';
  active = false;
  lastRoomId = null;
  try {
    if (typeof localStorage !== 'undefined') {
      const legacyKey = LEGACY_STORAGE_PREFIX + loadingWorld;
      const rawLegacy = localStorage.getItem(legacyKey);
      if (rawLegacy) {
        try {
          const legacy = JSON.parse(rawLegacy);
          const byArea = new Map();
          if (legacy && legacy.schemaVersion === 1 && legacy.rooms) {
            for (const room of Object.values(legacy.rooms)) {
              if (!room || typeof room.area !== 'string') continue;
              if (!byArea.has(room.area)) byArea.set(room.area, []);
              byArea.get(room.area).push(room);
            }
            await Promise.all(Array.from(byArea, ([area, areaRooms]) =>
              saveMapArea(STORAGE_SOURCE, loadingWorld, area, {
                schemaVersion: SCHEMA_VERSION, rooms: areaRooms,
              })));
          }
          localStorage.removeItem(legacyKey);
        } catch (e) {
          localStorage.removeItem(legacyKey);
        }
      }
    }
    const records = await loadMapAreas(STORAGE_SOURCE, loadingWorld);
    if (token !== loadToken || loadingWorld !== worldKey) return;
    for (const record of records) {
      if (!record || record.schemaVersion !== SCHEMA_VERSION
        || typeof record.area !== 'string' || !record.area || !Array.isArray(record.rooms)) {
        await deleteMapArea(STORAGE_SOURCE, worldKey, record && record.area);
        continue;
      }
      for (const room of record.rooms) {
        if (!room || typeof room !== 'object' || room.id === undefined
          || typeof room.area !== 'string' || !room.exits || typeof room.exits !== 'object') continue;
        room.id = normalizeRoomId(room.id);
        if (room.x !== null && room.x !== undefined) {
          if (![room.x, room.y, room.z].map(Number).every(Number.isFinite)) continue;
          room.x = Number(room.x);
          room.y = Number(room.y);
          room.z = Number(room.z);
        }
        room.walkSafe = room.walkSafe && typeof room.walkSafe === 'object' ? room.walkSafe : {};
        room.liveExits = {};
        room.liveDoors = {};
        room.hasLiveObservation = false;
        // A live Room.Info can beat IndexedDB hydration. Its observation is
        // newer and must win, while cached rooms from other areas still load.
        if (!rooms.has(room.id)) rooms.set(room.id, room);
      }
    }
    active = rooms.size > 0;
    rebuildCoordStats();
  } catch (e) {
    rooms.clear();
    storageError = e && e.message ? e.message : 'Map cache unavailable';
  }
}

export function clearMapDataForArea(area) {
  if (!area) return;
  for (const [id, room] of rooms) {
    if (room.area === area) rooms.delete(id);
  }
  if (currentRoomId && !rooms.has(currentRoomId)) currentRoomId = null;
  coordStatsByArea.delete(area);
  setMapStatus('Cleared ' + area + '. Explore to rebuild it.');
  dirtyAreas.delete(area);
  deleteMapArea(STORAGE_SOURCE, worldKey, area).catch(() => {});
}

export function clearMapData() {
  rooms.clear();
  currentRoomId = null;
  currentAreaName = '';
  active = false;
  lastRoomId = null;
  coordStatsByArea.clear();
  dirtyAreas.clear();
  clearMapSource(STORAGE_SOURCE, worldKey).catch(() => {});
}

export function isActive() {
  return active;
}

export function hasCurrentRoom() {
  return !!currentRoomId;
}

export function hasPositionedCurrentRoom() {
  const room = currentRoomId ? rooms.get(currentRoomId) : null;
  return !!(room && room.x !== null && room.x !== undefined);
}

export function getCurrentRoomId() {
  return currentRoomId;
}

export function getRoom(id) {
  return rooms.get(normalizeRoomId(id));
}

export function getRoomsByArea(area) {
  const result = [];
  for (const room of rooms.values()) {
    if (room.area === area && room.x !== null && room.x !== undefined) result.push(room);
  }
  return result;
}

export function getAreaName() {
  return currentAreaName;
}

export function getAuthority() { return 'learned'; }

export function canWalkExit(room, dir, destId) {
  if (!room || !room.walkSafe || !room.walkSafe[dir]) return false;
  if (room.exitDoors && room.exitDoors[dir] >= 2) return false;
  if (room.id === currentRoomId) return room.liveExits[dir] === normalizeRoomId(destId);
  return room.exits && room.exits[dir] === normalizeRoomId(destId);
}

export function getMapStatus() {
  if (!mapStatusMessage || Date.now() - mapStatusAt > MAP_STATUS_TTL_MS) return '';
  return mapStatusMessage;
}

export function getWorldKey() {
  return worldKey;
}

export function getStorageError() { return storageError; }

export function getClearMapActionLabel() {
  return 'Clear';
}

export function getClearMapActionTitle() {
  return 'Clear the learned map for this area';
}
