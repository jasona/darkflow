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
let areaHydrationRevisions = new Map();
let mapEpoch = '';
let worldKey = 'darkwind';
let active = false;
let mapStatusMessage = '';
let mapStatusAt = 0;
let saveTimer = null;
let forceFullSyncOnNextCurrent = false;
let lastSyncRequestByArea = new Map();
// Exactly one snapshot transfer may own an area at a time.  The transfer keeps
// its last-good public snapshot untouched until a complete, ordered replacement
// is ready to commit.
let activeSyncs = new Map();
let dirtyAreas = new Set();
let storageError = '';
let loadToken = 0;
let protocol2Known = false;
let syncSequence = 0;
let currentRequestTimer = null;
let currentRequestPending = false;
let currentRequestToken = 0;
let currentRetryTimer = null;
let currentRetryToken = 0;
let currentRetryAttempts = 0;
let connectionGeneration = 0;
let currentSeenGeneration = -1;

const MAP_STATUS_TTL_MS = 6000;
const SAVE_DEBOUNCE_MS = 200;
const CURRENT_REQUEST_THROTTLE_MS = 1000;
const CURRENT_RETRY_DEFAULT_MS = 250;
const CURRENT_RETRY_MAX_ATTEMPTS = 8;
const CURRENT_RETRY_MAX_DELAY_MS = 2000;
const SYNC_RETRY_DEFAULT_MS = 1000;
const SYNC_PAGE_TIMEOUT_MS = 5000;

function normalizeRoomId(id) {
  return id === null || id === undefined ? null : String(id);
}

function cursorKey(cursor) {
  return cursor === null || cursor === undefined || cursor === '' ? '0' : String(cursor);
}

function unrefTimer(timer) {
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

function clearCurrentRequest() {
  currentRequestToken++;
  if (currentRequestTimer) clearTimeout(currentRequestTimer);
  currentRequestTimer = null;
  currentRequestPending = false;
}

function clearCurrentRetry() {
  currentRetryToken++;
  if (currentRetryTimer) clearTimeout(currentRetryTimer);
  currentRetryTimer = null;
  currentRetryAttempts = 0;
}

// A grid frame is unavailable only while the server atomically moves its
// rooms. Keep Current presentation stale-but-visible and probe again with a
// bounded backoff in case the completing area Reset is delayed or the player
// was not yet part of the server's viewer set.
function scheduleCurrentRetry(delayMs) {
  if (hasLiveCurrent() || currentRetryTimer
    || currentRetryAttempts >= CURRENT_RETRY_MAX_ATTEMPTS) return false;
  const requestGeneration = connectionGeneration;
  const retryToken = ++currentRetryToken;
  const baseDelay = Math.max(50, Number(delayMs) || CURRENT_RETRY_DEFAULT_MS);
  const backoffDelay = baseDelay * (2 ** Math.min(currentRetryAttempts, 4));
  const retryDelay = Math.max(baseDelay,
    Math.min(CURRENT_RETRY_MAX_DELAY_MS, backoffDelay));
  currentRetryAttempts++;
  currentRetryTimer = unrefTimer(setTimeout(() => {
    if (retryToken !== currentRetryToken) return;
    currentRetryTimer = null;
    if (requestGeneration !== connectionGeneration || hasLiveCurrent()) return;
    requestCurrentState();
  }, retryDelay));
  return true;
}

function cancelAreaSync(area) {
  const sync = activeSyncs.get(area);
  if (sync) {
    sync.retryToken = (sync.retryToken || 0) + 1;
    sync.pageRequestToken = (sync.pageRequestToken || 0) + 1;
    if (sync.retryTimer) clearTimeout(sync.retryTimer);
    if (sync.pageTimer) clearTimeout(sync.pageTimer);
  }
  activeSyncs.delete(area);
}

function clearSyncPageTimer(sync) {
  if (sync && sync.pageTimer) clearTimeout(sync.pageTimer);
  if (sync) {
    sync.pageTimer = null;
    sync.pageRequestToken = (sync.pageRequestToken || 0) + 1;
  }
}

function clearSyncRetryTimer(sync) {
  if (sync && sync.retryTimer) clearTimeout(sync.retryTimer);
  if (sync) {
    sync.retryTimer = null;
    sync.retryToken = (sync.retryToken || 0) + 1;
  }
}

function cancelAllSyncs() {
  for (const area of Array.from(activeSyncs.keys())) cancelAreaSync(area);
  lastSyncRequestByArea.clear();
}

function bumpAreaHydrationRevision(area) {
  if (!area) return;
  areaHydrationRevisions.set(area, (areaHydrationRevisions.get(area) || 0) + 1);
}

export function hasLiveCurrent() {
  return !!currentRoomId && currentSeenGeneration === connectionGeneration;
}

export function requestCurrentState() {
  if (!protocol2Known || hasLiveCurrent() || currentRequestPending) return false;
  currentRequestPending = true;
  const requestGeneration = connectionGeneration;
  const requestToken = ++currentRequestToken;
  gmcp.send('Darkwind.MapData2.Sync', { protocol: 2, current: 1, mapEpoch });
  currentRequestTimer = unrefTimer(setTimeout(() => {
    if (requestToken !== currentRequestToken) return;
    currentRequestTimer = null;
    currentRequestPending = false;
    // A later v2 packet may retry. Do not run an unbounded background loop when
    // the server has explicitly reported that no current context is available.
    if (requestGeneration !== connectionGeneration) return;
  }, CURRENT_REQUEST_THROTTLE_MS));
  return true;
}

export function resetForConnection() {
  connectionGeneration++;
  currentSeenGeneration = -1;
  protocol2Known = false;
  clearCurrentRequest();
  clearCurrentRetry();
  cancelAllSyncs();
  if (currentRoomId && rooms.has(currentRoomId)) {
    setMapStatus('Reconnecting map context...');
  }
}

/** Cancels session-bound map work without issuing protocol traffic. */
export function disposeMapDataLifecycle() {
  loadToken++;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  dirtyAreas.clear();
  clearCurrentRequest();
  clearCurrentRetry();
  cancelAllSyncs();
  protocol2Known = false;
  active = false;
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
  resetInMemoryState();
  return load();
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
  // A retained reconnect snapshot is presentation-only until this connection
  // has supplied a fresh Current. Never send movement from a prior character,
  // login state, or socket generation just because its old route is visible.
  if (!hasLiveCurrent()) return false;
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

function cancelPendingMapSave(area = '') {
  if (area) dirtyAreas.delete(area);
  else dirtyAreas.clear();
  if (saveTimer && dirtyAreas.size === 0) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

export function flushPendingMapSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const areas = Array.from(dirtyAreas);
  const savingWorld = worldKey;
  dirtyAreas.clear();
  for (const area of areas) {
    const areaRooms = [];
    for (const room of rooms.values()) if (room.area === area) areaRooms.push(room);
    saveMapArea(STORAGE_SOURCE, savingWorld, area, {
      schemaVersion: SCHEMA_VERSION,
      mapEpoch,
      generation: areaGenerations.get(area) || 0,
      version: areaVersions.get(area) || 0,
      rooms: areaRooms,
    }).then(() => pruneMapAreas(STORAGE_SOURCE, savingWorld, 25000, area)).catch((error) => {
      storageError = error && error.message ? error.message : 'Map cache unavailable';
    });
  }
}

function resetInMemoryState() {
  loadToken++;
  connectionGeneration++;
  clearCurrentRequest();
  clearCurrentRetry();
  cancelAllSyncs();
  cancelPendingMapSave();
  rooms.clear();
  areaVersions.clear();
  areaGenerations.clear();
  areaHydrationRevisions.clear();
  currentRoomId = null;
  currentAreaName = '';
  currentSeenGeneration = -1;
  active = false;
  mapEpoch = '';
  protocol2Known = false;
  forceFullSyncOnNextCurrent = false;
  exitBrowse();
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
  const hydrationRevisions = new Map(areaHydrationRevisions);
  runStorageMigration();
  try {
    const records = await loadMapAreas(STORAGE_SOURCE, loadingWorld);
    if (token !== loadToken || loadingWorld !== worldKey || !records.length) return;
    let loadedEpoch = mapEpoch;
    for (const record of records) {
      if (token !== loadToken || loadingWorld !== worldKey) return;
      if (!record || record.schemaVersion !== SCHEMA_VERSION
        || typeof record.area !== 'string' || !record.area
        || typeof record.mapEpoch !== 'string' || !record.mapEpoch
        || !Array.isArray(record.rooms)) {
        await deleteMapArea(STORAGE_SOURCE, loadingWorld, record && record.area);
        continue;
      }
      if (loadedEpoch && loadedEpoch !== record.mapEpoch) continue;
      if ((areaHydrationRevisions.get(record.area) || 0)
        !== (hydrationRevisions.get(record.area) || 0)) continue;
      // A live completed snapshot may commit while IndexedDB hydration is
      // waiting behind queued writes. Once that area has an in-memory baseline,
      // never merge missing IDs from the older cache back into it.
      if (areaVersions.has(record.area)) continue;
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
    if (token === loadToken) {
      storageError = e && e.message ? e.message : 'Map cache unavailable';
    }
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
  if (activeSyncs.has(area)) return;
  if (full) setMapStatus('Syncing map...');
  requestAreaSync(area, full);
}

function resetForEpoch(epoch) {
  loadToken++;
  cancelAllSyncs();
  clearCurrentRequest();
  clearCurrentRetry();
  cancelPendingMapSave();
  currentSeenGeneration = -1;
  areaVersions.clear();
  areaGenerations.clear();
  mapEpoch = epoch || '';
  protocol2Known = true;
  forceFullSyncOnNextCurrent = true;
  clearMapSource(STORAGE_SOURCE, worldKey).catch(() => {});
  setMapStatus('Refreshing authoritative map...');
}

export function processCurrent(data) {
  if (!data || data.id === null || data.id === undefined) return 0;
  if (Number(data.protocol) >= 2 || data.mapEpoch) protocol2Known = true;
  if (data.protocol >= 2 && data.mapEpoch && mapEpoch && data.mapEpoch !== mapEpoch) {
    resetForEpoch(data.mapEpoch);
  } else if (data.mapEpoch && !mapEpoch) {
    mapEpoch = data.mapEpoch;
  }
  active = true;
  mergeRoom(data, data.area);
  currentRoomId = normalizeRoomId(data.id);
  currentAreaName = data.areaName || data.area || '';
  currentSeenGeneration = connectionGeneration;
  clearCurrentRequest();
  clearCurrentRetry();
  if (data.area && data.areaGeneration !== undefined) {
    const knownGeneration = areaGenerations.get(data.area);
    if (knownGeneration !== undefined && knownGeneration !== data.areaGeneration) {
      areaVersions.delete(data.area);
      cancelAreaSync(data.area);
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
    requestAreaSync(data.area, true);
  } else if (data.area) {
    reconcileAreaVersion(data.area, data.areaVersion);
  }
  if (!data.positioned) {
    setMapStatus('Map layout pending for ' + (data.name || 'current room'));
  }
  if (!activeSyncs.has(data.area)) save(data.area);
  return 1;
}

export function mergeServerAreaData(data) {
  if (!data || !data.area || !Array.isArray(data.rooms)) return 0;
  if (Number(data.protocol) >= 2 || data.mapEpoch) {
    protocol2Known = true;
    if (!hasLiveCurrent()) requestCurrentState();
  }
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
    bumpAreaHydrationRevision(data.area);
  }
  if (data.areaGeneration !== undefined) areaGenerations.set(data.area, data.areaGeneration);
  if (data.mapEpoch) mapEpoch = data.mapEpoch;
  if (merged || data.replace || data.version !== undefined) save(data.area);
  return merged;
}

export function mergeServerUpdate(data) {
  if (data && Number(data.protocol) >= 2) {
    protocol2Known = true;
    return mergeServerUpdateV2(data);
  }
  // Once this connection has demonstrated protocol 2, a protocol-less Update
  // is an unsolicited v1 stream. Mixing it into a staged v2 snapshot can wipe
  // the last-good area or restart pagination from the wrong cursor.
  if (protocol2Known) return 0;
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

function nextSyncId() {
  syncSequence++;
  return connectionGeneration + '-' + Date.now().toString(36) + '-' + syncSequence.toString(36);
}

function scheduleAreaSyncRetry(sync, delayMs) {
  if (!sync || activeSyncs.get(sync.area) !== sync || sync.retryTimer) return;
  const requestGeneration = sync.connectionGeneration;
  const retryToken = ++sync.retryToken;
  sync.retryTimer = unrefTimer(setTimeout(() => {
    if (retryToken !== sync.retryToken) return;
    sync.retryTimer = null;
    if (requestGeneration !== connectionGeneration || activeSyncs.get(sync.area) !== sync) return;
    sync.requestOutstanding = false;
    sendAreaSyncRequest(sync, sync.expectedCursor);
  }, Math.max(50, Number(delayMs) || SYNC_RETRY_DEFAULT_MS)));
}

function sendAreaSyncRequest(sync, cursor) {
  if (!sync || activeSyncs.get(sync.area) !== sync || sync.requestOutstanding) return false;
  sync.expectedCursor = cursor === undefined ? 0 : cursor;
  sync.outstandingCursor = cursorKey(sync.expectedCursor);
  const sent = gmcp.send('Darkwind.MapData2.Sync', {
    protocol: 2,
    area: sync.area,
    mapEpoch,
    generation: sync.generation,
    since: sync.since,
    version: sync.since,
    snapshotVersion: sync.snapshotVersion === null ? 0 : sync.snapshotVersion,
    cursor: sync.expectedCursor,
    fromCursor: sync.expectedCursor,
    syncId: sync.syncId,
  });
  if (sent === false) {
    scheduleAreaSyncRetry(sync, SYNC_RETRY_DEFAULT_MS);
    return false;
  }
  sync.requestOutstanding = true;
  clearSyncPageTimer(sync);
  const pageRequestToken = sync.pageRequestToken;
  sync.pageTimer = unrefTimer(setTimeout(() => {
    if (pageRequestToken !== sync.pageRequestToken) return;
    sync.pageTimer = null;
    if (activeSyncs.get(sync.area) !== sync || !sync.requestOutstanding) return;
    sync.requestOutstanding = false;
    scheduleAreaSyncRetry(sync, SYNC_RETRY_DEFAULT_MS);
  }, SYNC_PAGE_TIMEOUT_MS));
  return true;
}

function mergeServerUpdateV2(data) {
  if (!data || !data.area || !Array.isArray(data.rooms)) return 0;
  if (data.mapEpoch && mapEpoch && data.mapEpoch !== mapEpoch) {
    resetForEpoch(data.mapEpoch);
    requestCurrentState();
    return 0;
  }
  if (data.mapEpoch) mapEpoch = data.mapEpoch;
  if (!hasLiveCurrent()) requestCurrentState();
  const stage = activeSyncs.get(data.area);
  if (!stage || !stage.requestOutstanding) {
    requestCurrentState();
    return 0;
  }
  if (data.syncId !== undefined && String(data.syncId) !== stage.syncId) return 0;
  if (data.fromCursor !== undefined
    && cursorKey(data.fromCursor) !== stage.outstandingCursor) return 0;
  if (data.since !== undefined && Number(data.since) !== stage.since) return 0;
  const responseSnapshot = Number(data.snapshotVersion) || 0;
  if (stage.snapshotVersion !== null && responseSnapshot !== stage.snapshotVersion) return 0;
  const responseGeneration = Number(data.areaGeneration) || 0;
  if (stage.generation && responseGeneration && responseGeneration !== stage.generation) return 0;
  if (stage.snapshotVersion === null) stage.snapshotVersion = responseSnapshot;
  if (!stage.generation && responseGeneration) stage.generation = responseGeneration;
  clearSyncRetryTimer(stage);
  clearSyncPageTimer(stage);
  stage.requestOutstanding = false;
  stage.replace = stage.replace || !!data.replace;

  let merged = 0;
  for (const raw of data.rooms) {
    const room = normalizeRoomPayload(raw, data.area);
    if (!room) continue;
    stage.rooms.set(room.id, room);
    merged++;
  }

  if (!data.complete) {
    if (cursorKey(data.cursor) === stage.outstandingCursor) {
      setMapStatus('Map sync paused: server cursor did not advance');
      scheduleAreaSyncRetry(stage, SYNC_RETRY_DEFAULT_MS);
      return merged;
    }
    sendAreaSyncRequest(stage, data.cursor);
    return merged;
  }

  const liveCurrent = currentRoomId ? rooms.get(currentRoomId) : null;
  if (stage.replace) {
    for (const [id, room] of rooms) if (room.area === data.area) rooms.delete(id);
  }
  for (const room of stage.rooms.values()) {
    if (liveCurrent && room.id === liveCurrent.id) {
      rooms.set(room.id, Object.assign(room, {
        liveExits: Object.assign({}, liveCurrent.liveExits || {}),
        liveDoors: Object.assign({}, liveCurrent.liveDoors || {}),
        hasLiveObservation: !!liveCurrent.hasLiveObservation,
        observedAt: liveCurrent.observedAt || room.observedAt,
      }));
    } else {
      rooms.set(room.id, room);
    }
  }
  // A full snapshot should contain the current room. Keep the live Current
  // observation anyway so a malformed or reordered response cannot strand the
  // current pointer or remove live door/exit truth.
  if (liveCurrent && liveCurrent.area === data.area && !rooms.has(liveCurrent.id)) {
    rooms.set(liveCurrent.id, liveCurrent);
  }
  areaVersions.set(data.area, stage.snapshotVersion);
  areaGenerations.set(data.area, stage.generation);
  bumpAreaHydrationRevision(data.area);
  cancelAreaSync(data.area);
  active = rooms.size > 0;
  save(data.area);

  if (Number(data.latestVersion) > stage.snapshotVersion) requestAreaSync(data.area, false);
  if (!hasLiveCurrent()) requestCurrentState();
  return merged;
}

export function requestAreaSync(area, forceFull) {
  if (!area) return false;
  if (activeSyncs.has(area)) return false;
  const since = forceFull ? 0 : (areaVersions.get(area) || 0);
  const sync = {
    area,
    generation: areaGenerations.get(area) || 0,
    since,
    snapshotVersion: null,
    expectedCursor: 0,
    outstandingCursor: '0',
    requestOutstanding: false,
    replace: !!forceFull,
    rooms: new Map(),
    retryTimer: null,
    retryToken: 0,
    pageTimer: null,
    pageRequestToken: 0,
    syncId: nextSyncId(),
    connectionGeneration,
  };
  activeSyncs.set(area, sync);
  lastSyncRequestByArea.set(area, Date.now());
  sendAreaSyncRequest(sync, 0);
  return true;
}

export function processSyncError(data) {
  if (!data) return;
  if (Number(data.protocol) >= 2 || data.mapEpoch) protocol2Known = true;
  if (data.code === 'current_unavailable') {
    clearCurrentRequest();
    currentSeenGeneration = -1;
    if (data.reason === 'grid_reflow') {
      setMapStatus('Repositioning authoritative map...');
      scheduleCurrentRetry(data.retryAfterMs);
    } else {
      clearCurrentRetry();
      setMapStatus('Current map location unavailable; using learned map.');
    }
    return;
  }
  if (!data.area) {
    requestCurrentState();
    return;
  }
  let sync = activeSyncs.get(data.area);
  if (data.syncId !== undefined && (!sync || String(data.syncId) !== sync.syncId)) return;
  if (data.fromCursor !== undefined && sync
    && cursorKey(data.fromCursor) !== sync.outstandingCursor) return;
  if (sync) {
    clearSyncRetryTimer(sync);
    clearSyncPageTimer(sync);
    sync.requestOutstanding = false;
  }
  if (data.mapEpoch && data.mapEpoch !== mapEpoch) {
    resetForEpoch(data.mapEpoch);
    sync = null;
  }
  if (data.areaGeneration !== undefined) areaGenerations.set(data.area, data.areaGeneration);
  if (data.code === 'rate_limited') {
    if (sync) {
      scheduleAreaSyncRetry(sync, data.retryAfterMs);
    }
    return;
  }
  if (data.restart) {
    cancelAreaSync(data.area);
    areaVersions.delete(data.area);
    requestAreaSync(data.area, true);
    return;
  }
  if (sync) {
    sync.requestOutstanding = false;
    scheduleAreaSyncRetry(sync, data.retryAfterMs);
  }
}

export function clearMapDataForArea(area, reset = {}) {
  if (!area) return;
  if (Number(reset.protocol) >= 2 || reset.mapEpoch) protocol2Known = true;
  clearCurrentRequest();
  clearCurrentRetry();
  cancelAreaSync(area);
  bumpAreaHydrationRevision(area);
  cancelPendingMapSave(area);
  areaVersions.delete(area);
  areaGenerations.delete(area);
  if (reset.areaGeneration !== undefined) {
    areaGenerations.set(area, reset.areaGeneration);
  }
  if (reset.mapEpoch) mapEpoch = reset.mapEpoch;
  lastSyncRequestByArea.delete(area);
  deleteMapArea(STORAGE_SOURCE, worldKey, area).catch(() => {});
  setMapStatus('Refreshing ' + area + '...');
  requestAreaSync(area, true);
  if (!hasLiveCurrent()) requestCurrentState();
}

// Authoritative global resets invalidate baselines, not the last successfully
// rendered snapshot. The following Current selects the area to replace; until
// that replacement commits the player keeps a useful stale-but-labelled map.
export function beginGlobalReset(reset = {}) {
  if (Number(reset.protocol) >= 2 || reset.mapEpoch) protocol2Known = true;
  cancelAllSyncs();
  loadToken++;
  clearCurrentRequest();
  clearCurrentRetry();
  cancelPendingMapSave();
  currentSeenGeneration = -1;
  areaVersions.clear();
  areaGenerations.clear();
  if (reset.mapEpoch) mapEpoch = reset.mapEpoch;
  clearMapSource(STORAGE_SOURCE, worldKey).catch(() => {});
  forceFullSyncOnNextCurrent = true;
  setMapStatus('Refreshing authoritative map...');
  if (!hasLiveCurrent()) requestCurrentState();
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
    activeSyncs: Array.from(activeSyncs.values()).map((sync) => ({
      area: sync.area,
      syncId: sync.syncId,
      since: sync.since,
      snapshotVersion: sync.snapshotVersion,
      cursor: sync.expectedCursor,
      stagedRooms: sync.rooms.size,
      requestOutstanding: sync.requestOutstanding,
    })),
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

function debugExportAll() {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    worldKey,
    exportedAt: new Date().toISOString(),
    summary: debugSummary(),
    rooms: Array.from(rooms.values()),
  }, null, 2);
}

if (typeof window !== 'undefined') {
  window.mapDebug = {
    summary: debugSummary,
    rooms: debugRooms,
    exportAll: debugExportAll,
    clearData: clearMapData,
    resync: (area) => requestAreaSync(area, true),
  };
}
