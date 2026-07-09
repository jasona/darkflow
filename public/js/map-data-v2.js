import { gmcp } from './gmcp.js';
import { loadMapAreas, saveMapArea, deleteMapArea, clearMapSource, pruneMapAreas } from './map-storage.js';

const STORAGE_KEY = 'darkwind-map-data-v2';
const LEGACY_STORAGE_KEY = 'darkwind-map-data-v3';
const MIGRATION_KEY = 'darkwind-map-data-v2-migration-complete';
// Bumped to 4 to flush browser caches after the server widened room ids from
// the colliding 17-bit crc to 52-bit md5-derived ints (every cached id and
// exit target changed identity).
const SCHEMA_VERSION = 5;
const STORAGE_SOURCE = 'mapdata2';

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

let rooms = new Map();
let currentRoomId = null;
let currentAreaName = '';
let areaVersions = new Map();
let areaGenerations = new Map();
let mapEpoch = '';
let worldKey = 'darkwind';
let active = false;
let mapStatusMessage = '';
let mapStatusAt = 0;
let saveTimer = null;
let forceFullSyncOnNextCurrent = false;
let lastSyncRequestByArea = new Map();
let stagedSyncs = new Map();
let dirtyAreas = new Set();
let storageError = '';
let loadToken = 0;

const MAP_STATUS_TTL_MS = 6000;
const SAVE_DEBOUNCE_MS = 200;
const SYNC_THROTTLE_MS = 4000;

function normalizeRoomId(id) {
  return id === null || id === undefined ? null : String(id);
}

function safeSlug(value) {
  return String(value || 'darkwind').toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'darkwind';
}

export function configureWorld(identity = {}) {
  const next = safeSlug([identity.host || 'darkwind', identity.port || ''].filter(Boolean).join('@'));
  if (next === worldKey) return;
  flushPendingMapSave();
  worldKey = next;
  loadToken++;
  resetInMemoryState();
  load();
}

export function setMapStatus(msg) {
  mapStatusMessage = msg;
  mapStatusAt = Date.now();
}

export function isActive() {
  return active;
}

export function hasCurrentRoom() {
  return !!currentRoomId;
}

export function hasPositionedCurrentRoom() {
  const room = currentRoomId ? rooms.get(currentRoomId) : null;
  return !!(room && room.x !== null);
}

export function getCurrentRoomId() {
  return currentRoomId;
}

export function getRoom(id) {
  return rooms.get(normalizeRoomId(id));
}

export function getMapStatus() {
  if (!mapStatusMessage || Date.now() - mapStatusAt > MAP_STATUS_TTL_MS) return '';
  return mapStatusMessage;
}

// Human-readable name of the area the player is currently in (updates on each
// Darkwind.MapData2.Current as they cross areas).
export function getAreaName() {
  return currentAreaName;
}

export function getAuthority() { return 'authoritative'; }
export function getMapEpoch() { return mapEpoch; }

export function canWalkExit(room, dir, destId) {
  if (!room || !dir || !destId) return false;
  if (room.layoutState === 'identity_conflict') return false;
  const defaultSafe = !!DIR_OFFSETS[dir] || dir === 'in' || dir === 'out';
  const safe = room.walkSafe && Object.prototype.hasOwnProperty.call(room.walkSafe, dir)
    ? !!room.walkSafe[dir] : defaultSafe;
  if (!safe) return false;
  const doors = room.id === currentRoomId && room.hasLiveObservation
    ? room.liveDoors : room.exitDoors;
  if (doors && doors[dir] >= 2) return false;
  if (room.id === currentRoomId && room.hasLiveObservation) {
    return room.liveExits && room.liveExits[dir] === normalizeRoomId(destId);
  }
  return room.exits && room.exits[dir] === normalizeRoomId(destId);
}

export function getRoomsByArea(area) {
  const result = [];
  for (const room of rooms.values()) {
    if (room.area === area && room.x !== null) result.push(room);
  }
  return result;
}

function normalizeRoomPayload(data, fallbackArea) {
  if (!data || data.id === null || data.id === undefined) return null;
  const positioned = !!data.positioned
    && Number.isFinite(Number(data.x)) && Number.isFinite(Number(data.y))
    && Number.isFinite(Number(data.z));
  const room = {
    id: normalizeRoomId(data.id),
    name: data.name || '',
    area: data.area || fallbackArea || '',
    environment: data.env || data.environment || '',
    exits: {},
    exitKinds: {},
    exitDoors: {},
    x: positioned ? Number(data.x) : null,
    y: positioned ? Number(data.y) : null,
    z: positioned ? Number(data.z) : null,
    coordSource: data.coordSource || '',
    positioned,
    version: data.version || 0,
    observed: data.observed === undefined ? true : !!data.observed,
    observedAt: Number(data.observedAt) || 0,
    layoutState: data.layoutState || (data.positioned ? 'verified' : 'pending'),
    walkSafe: {},
    liveExits: {},
    liveDoors: {},
    hasLiveObservation: data.liveExits !== undefined,
  };

  if (data.exits && typeof data.exits === 'object') {
    for (const [dir, destId] of Object.entries(data.exits)) {
      room.exits[dir] = normalizeRoomId(destId);
    }
  }
  if (data.exitKinds && typeof data.exitKinds === 'object') {
    room.exitKinds = Object.assign({}, data.exitKinds);
  }
  // Door states per direction: 1=open 2=closed 3=locked. May cover
  // directions with no exit entry -- a closed door removes its exit on the
  // server, so the door marker is the only trace of the passage.
  if (data.exitDoors && typeof data.exitDoors === 'object') {
    room.exitDoors = Object.assign({}, data.exitDoors);
  }
  if (data.walkSafe && typeof data.walkSafe === 'object') {
    room.walkSafe = Object.assign({}, data.walkSafe);
  }
  if (data.liveExits && typeof data.liveExits === 'object') {
    for (const [dir, destId] of Object.entries(data.liveExits)) {
      room.liveExits[dir] = normalizeRoomId(destId);
    }
  }
  if (data.liveDoors && typeof data.liveDoors === 'object') {
    room.liveDoors = Object.assign({}, data.liveDoors);
  }
  // Room feature tags for map icons (IRE-style details: shop, bank, ...).
  room.details = Array.isArray(data.details) ? data.details.slice(0, 4) : [];

  return room;
}

function mergeRoom(data, fallbackArea) {
  const next = normalizeRoomPayload(data, fallbackArea);
  if (!next) return 0;

  const old = rooms.get(next.id);
  rooms.set(next.id, old ? Object.assign(old, next) : next);
  return 1;
}

function removeAreaRooms(area) {
  for (const [id, room] of rooms) {
    if (id === currentRoomId) continue;
    if (room.area === area) rooms.delete(id);
  }
}

function save(area) {
  if (area) dirtyAreas.add(area);
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushPendingMapSave();
  }, SAVE_DEBOUNCE_MS);
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
      mapEpoch,
      generation: areaGenerations.get(area) || 0,
      version: areaVersions.get(area) || 0,
      rooms: areaRooms,
    }).then(() => pruneMapAreas(STORAGE_SOURCE, worldKey, 25000, area)).catch((error) => {
      storageError = error && error.message ? error.message : 'Map cache unavailable';
    });
  }
}

function resetInMemoryState() {
  rooms.clear();
  areaVersions.clear();
  areaGenerations.clear();
  stagedSyncs.clear();
  dirtyAreas.clear();
  currentRoomId = null;
  currentAreaName = '';
  active = false;
  mapEpoch = '';
}

function runStorageMigration() {
  try {
    const migrated = localStorage.getItem(MIGRATION_KEY) === String(SCHEMA_VERSION);
    if (!migrated) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(MIGRATION_KEY, String(SCHEMA_VERSION));
      forceFullSyncOnNextCurrent = true;
      setMapStatus('Updating map data...');
      return;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);
    if (data.schemaVersion !== SCHEMA_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      forceFullSyncOnNextCurrent = true;
      setMapStatus('Updating map data...');
    }
  } catch (e) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (ignored) {
      // Ignore localStorage failures; the in-memory map will resync live.
    }
    forceFullSyncOnNextCurrent = true;
  }
}

export async function load() {
  const token = ++loadToken;
  const loadingWorld = worldKey;
  runStorageMigration();
  try {
    const records = await loadMapAreas(STORAGE_SOURCE, loadingWorld);
    if (token !== loadToken || loadingWorld !== worldKey || !records.length) return;
    let loadedEpoch = mapEpoch;
    for (const record of records) {
      if (!record || record.schemaVersion !== SCHEMA_VERSION
        || typeof record.area !== 'string' || !record.area
        || typeof record.mapEpoch !== 'string' || !record.mapEpoch
        || !Array.isArray(record.rooms)) {
        await deleteMapArea(STORAGE_SOURCE, worldKey, record && record.area);
        continue;
      }
      if (loadedEpoch && loadedEpoch !== record.mapEpoch) continue;
      loadedEpoch = record.mapEpoch || loadedEpoch;
      if (!areaVersions.has(record.area))
        areaVersions.set(record.area, Number(record.version) || 0);
      if (!areaGenerations.has(record.area))
        areaGenerations.set(record.area, Number(record.generation) || 0);
      for (const raw of record.rooms) {
        const id = raw && normalizeRoomId(raw.id);
        if (id && !rooms.has(id)) mergeRoom(raw, record.area);
      }
    }
    mapEpoch = loadedEpoch;
    active = rooms.size > 0;
  } catch (e) {
    resetInMemoryState();
    storageError = e && e.message ? e.message : 'Map cache unavailable';
  }
}

// Reconcile our synced baseline for an area against the version the server
// just reported. Three cases:
//  - we have no completed sync for the area  -> full sync (covers login/reload,
//    where the server only pushes area data on zone *changes*)
//  - server version went BACKWARD            -> the server map for this area was
//    rebuilt/cleared; our cached rooms are from another coordinate generation
//    and must be replaced wholesale, or stale tiles mix with new ones
//  - server version is ahead                  -> incremental catch-up (rooms other
//    players mapped since our last sync)
function reconcileAreaVersion(area, serverVersion) {
  if (!area || serverVersion === undefined) return;
  const known = areaVersions.get(area);
  const full = known === undefined || serverVersion < known;
  if (!full && serverVersion <= known) return;

  const now = Date.now();
  if (now - (lastSyncRequestByArea.get(area) || 0) < SYNC_THROTTLE_MS) return;
  lastSyncRequestByArea.set(area, now);
  if (full) setMapStatus('Syncing map...');
  requestAreaSync(area, full);
}

function resetForEpoch(epoch) {
  resetInMemoryState();
  mapEpoch = epoch || '';
  forceFullSyncOnNextCurrent = true;
  clearMapSource(STORAGE_SOURCE, worldKey).catch(() => {});
  setMapStatus('Refreshing authoritative map...');
}

export function processCurrent(data) {
  if (!data || data.id === null || data.id === undefined) return 0;
  if (data.protocol >= 2 && data.mapEpoch && mapEpoch && data.mapEpoch !== mapEpoch) {
    resetForEpoch(data.mapEpoch);
  } else if (data.mapEpoch && !mapEpoch) {
    mapEpoch = data.mapEpoch;
  }
  active = true;
  mergeRoom(data, data.area);
  currentRoomId = normalizeRoomId(data.id);
  currentAreaName = data.areaName || data.area || '';
  if (data.area && data.areaGeneration !== undefined) {
    const knownGeneration = areaGenerations.get(data.area);
    if (knownGeneration !== undefined && knownGeneration !== data.areaGeneration) {
      removeAreaRooms(data.area);
      areaVersions.delete(data.area);
      stagedSyncs.delete(data.area);
      forceFullSyncOnNextCurrent = true;
    }
    areaGenerations.set(data.area, data.areaGeneration);
  }
  // NOTE: do NOT store data.areaVersion as our baseline here. The baseline
  // means "we hold every room up to version V"; Current carries only ONE room,
  // and storing its area version made incremental syncs skip everything other
  // players mapped in between. Instead, compare and resync when behind.
  if (forceFullSyncOnNextCurrent && data.area) {
    forceFullSyncOnNextCurrent = false;
    setMapStatus('Updating map data...');
    lastSyncRequestByArea.set(data.area, Date.now());
    requestAreaSync(data.area, true);
  } else if (data.area) {
    reconcileAreaVersion(data.area, data.areaVersion);
  }
  if (!data.positioned) {
    setMapStatus('Map layout pending for ' + (data.name || 'current room'));
  }
  save(data.area);
  return 1;
}

export function mergeServerAreaData(data) {
  if (!data || !data.area || !Array.isArray(data.rooms)) return 0;
  active = true;
  if (data.replace || data.version === undefined) removeAreaRooms(data.area);

  let merged = 0;
  for (const room of data.rooms) {
    merged += mergeRoom(room, data.area);
  }
  // Only a COMPLETED sync establishes the baseline; storing it mid-chunking
  // would mark rooms we never received as already-held.
  if (data.version !== undefined && !data.more) {
    areaVersions.set(data.area, data.version);
  }
  if (data.areaGeneration !== undefined) areaGenerations.set(data.area, data.areaGeneration);
  if (data.mapEpoch) mapEpoch = data.mapEpoch;
  if (merged || data.replace || data.version !== undefined) save(data.area);
  return merged;
}

export function mergeServerUpdate(data) {
  if (data && data.protocol >= 2) return mergeServerUpdateV2(data);
  const merged = mergeServerAreaData(data);
  if (data && data.area && data.more) {
    // Continue THIS sync with the server's cursor. The old version-high-water
    // continuation permanently dropped every room that missed the first chunk.
    gmcp.send('Darkwind.MapData2.Sync', {
      area: data.area,
      version: data.since || 0,
      offset: data.offset || 0,
    });
  }
  return merged;
}

function mergeServerUpdateV2(data) {
  if (!data || !data.area || !Array.isArray(data.rooms)) return 0;
  if (data.mapEpoch && mapEpoch && data.mapEpoch !== mapEpoch) resetForEpoch(data.mapEpoch);
  if (data.mapEpoch) mapEpoch = data.mapEpoch;

  let stage = stagedSyncs.get(data.area);
  if (!stage || stage.snapshotVersion !== data.snapshotVersion
    || stage.generation !== data.areaGeneration || stage.since !== data.since) {
    stage = {
      rooms: new Map(),
      snapshotVersion: Number(data.snapshotVersion) || 0,
      generation: Number(data.areaGeneration) || 0,
      since: Number(data.since) || 0,
      replace: !!data.replace,
    };
    stagedSyncs.set(data.area, stage);
  }
  let merged = 0;
  for (const raw of data.rooms) {
    const room = normalizeRoomPayload(raw, data.area);
    if (!room) continue;
    stage.rooms.set(room.id, room);
    merged++;
  }

  if (!data.complete) {
    gmcp.send('Darkwind.MapData2.Sync', {
      area: data.area,
      mapEpoch,
      generation: stage.generation,
      since: stage.since,
      snapshotVersion: stage.snapshotVersion,
      cursor: data.cursor,
    });
    return merged;
  }

  if (stage.replace) removeAreaRooms(data.area);
  for (const room of stage.rooms.values()) rooms.set(room.id, room);
  areaVersions.set(data.area, stage.snapshotVersion);
  areaGenerations.set(data.area, stage.generation);
  stagedSyncs.delete(data.area);
  save(data.area);

  if (Number(data.latestVersion) > stage.snapshotVersion) requestAreaSync(data.area, false);
  return merged;
}

export function requestAreaSync(area, forceFull) {
  if (!area) return;
  const since = forceFull ? 0 : (areaVersions.get(area) || 0);
  gmcp.send('Darkwind.MapData2.Sync', {
    area,
    mapEpoch,
    generation: areaGenerations.get(area) || 0,
    since,
    version: since,
    snapshotVersion: 0,
    cursor: 0,
  });
}

export function processSyncError(data) {
  if (!data || !data.area) return;
  if (data.mapEpoch && data.mapEpoch !== mapEpoch) resetForEpoch(data.mapEpoch);
  if (data.areaGeneration !== undefined) areaGenerations.set(data.area, data.areaGeneration);
  stagedSyncs.delete(data.area);
  if (data.code === 'rate_limited') {
    setTimeout(() => requestAreaSync(data.area, false), Number(data.retryAfterMs) || 1000);
    return;
  }
  if (data.restart) {
    areaVersions.delete(data.area);
    requestAreaSync(data.area, true);
  }
}

export function clearMapDataForArea(area) {
  if (!area) return;
  removeAreaRooms(area);
  areaVersions.delete(area);
  lastSyncRequestByArea.delete(area);
  save(area);
  setMapStatus('Cleared ' + area + ', resyncing...');
  requestAreaSync(area, true);
}

export function clearMapData() {
  const oldWorld = worldKey;
  resetInMemoryState();
  clearMapSource(STORAGE_SOURCE, oldWorld).catch(() => {});
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

// ── Browse mode: view an arbitrary catalog area in the Area Map pane ─────────
// Kept entirely separate from the live `rooms` store so the live you-are-here
// map is never disturbed.

let browseRooms = new Map();
let browseCatalog = '';
let browseName = '';
let browseCenterId = null;

export function requestBrowse(catalogId) {
  if (!catalogId) return;
  browseCatalog = catalogId;
  gmcp.send('Darkwind.MapData2.Browse', { catalog: catalogId });
}

export function mergeBrowseArea(data) {
  if (!data || !data.catalog) return 0;
  if (data.replace || data.catalog !== browseCatalog) browseRooms.clear();
  browseCatalog = data.catalog;
  browseName = data.name || data.catalog;
  if (data.center !== undefined && data.center !== null) {
    browseCenterId = normalizeRoomId(data.center);
  }

  let merged = 0;
  if (Array.isArray(data.rooms)) {
    for (const raw of data.rooms) {
      const room = normalizeRoomPayload(raw, data.catalog);
      if (room) { browseRooms.set(room.id, room); merged++; }
    }
  }
  if (data.more && data.offset) {
    gmcp.send('Darkwind.MapData2.Browse', { catalog: data.catalog, offset: data.offset });
  }
  return merged;
}

export function exitBrowse() {
  browseRooms.clear();
  browseCatalog = '';
  browseName = '';
  browseCenterId = null;
}

export function getBrowseName() {
  return browseName;
}

// A read-only source adapter exposing the same interface the renderer uses, so
// the Area Map pane reuses renderMap() unchanged.
export const browseSource = {
  isBrowse: true,
  DIR_OFFSETS,
  isActive() { return true; },
  hasCurrentRoom() { return !!browseCenterId; },
  getCurrentRoomId() { return browseCenterId; },
  getRoom(id) { return browseRooms.get(normalizeRoomId(id)); },
  getRoomsByArea() {
    const out = [];
    for (const room of browseRooms.values()) {
      if (room.x !== null) out.push(room);
    }
    return out;
  },
  getMapStatus() { return browseName; },
  getAreaName() { return browseName; },
  clearMapDataForArea() {},
};

// ── Debug tools (exposed on window.mapDebug for the browser console) ─────────

function shortId(id) {
  return id === null || id === undefined ? null : String(id).slice(0, 8);
}

function debugSummary() {
  let positioned = 0;
  let unpositioned = 0;
  const byArea = {};
  const pending = [];
  for (const room of rooms.values()) {
    if (room.x !== null) {
      positioned++;
      byArea[room.area] = (byArea[room.area] || 0) + 1;
    } else {
      unpositioned++;
      if (room.name) pending.push(room.name);
    }
  }
  const cur = currentRoomId ? rooms.get(currentRoomId) : null;
  return {
    active,
    totalRooms: rooms.size,
    positioned,
    unpositioned,
    currentRoom: cur
      ? { id: shortId(cur.id), name: cur.name, area: cur.area, positioned: cur.x !== null }
      : null,
    roomsByArea: byArea,
    pendingRooms: pending.slice(0, 25),
    areaVersions: Object.fromEntries(areaVersions),
    areaGenerations: Object.fromEntries(areaGenerations),
    mapEpoch,
    authority: 'authoritative',
    stagedSyncs: Array.from(stagedSyncs.keys()),
    storageError,
  };
}

function debugRooms(area) {
  const out = [];
  for (const room of rooms.values()) {
    if (area && room.area !== area) continue;
    out.push({
      id: shortId(room.id),
      name: room.name,
      area: room.area,
      coords: room.x !== null ? room.x + ',' + room.y + ',' + room.z : 'NONE',
      exits: Object.keys(room.exits || {}),
    });
  }
  return out;
}

if (typeof window !== 'undefined') {
  window.mapDebug = {
    summary: debugSummary,
    rooms: debugRooms,
    clearData: clearMapData,
    resync: (area) => requestAreaSync(area, true),
  };
}
