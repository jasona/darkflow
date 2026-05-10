import { gmcp } from './gmcp.js';
import { appendSystemMessage } from './output.js';

const STORAGE_KEY = 'darkwind-map-data-v3';
const MOVEMENT_INTENT_TTL_MS = 2500;
const MAX_MOVEMENT_INTENTS = 25;
const RESYNC_COOLDOWN_MS = 2000;
const SAVE_DEBOUNCE_MS = 200;

const DIR_OFFSETS = {
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

const DIR_ALIASES = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  u: 'up', d: 'down',
  north: 'north', south: 'south', east: 'east', west: 'west',
  northeast: 'northeast', northwest: 'northwest', southeast: 'southeast', southwest: 'southwest',
  up: 'up', down: 'down',
};

// Room graph: roomId → room record
let rooms = new Map();
let currentRoomId = null;
let previousRoomId = null;
let movementIntents = [];
let nextMovementSeq = 1;

// Coordinate occupancy per area: "area:x,y,z" → roomId
let coordIndex = new Map();

// Server area versions for incremental sync
let areaVersions = new Map();
let lastResyncByArea = new Map();
let saveTimer = null;

// Debug transition log — captures every Room.Info event with context
const debugLog = [];

function normalizeRoomId(id) {
  return id === null || id === undefined ? null : String(id);
}

function shortRoomId(id) {
  return id === null || id === undefined ? null : String(id).slice(0, 8);
}

export function getCurrentRoomId() { return currentRoomId; }

export function getRoom(id) { return rooms.get(normalizeRoomId(id)); }

export function getRoomsByArea(area) {
  const result = [];
  for (const room of rooms.values()) {
    if (room.area === area && room.x !== null) result.push(room);
  }
  return result;
}

function isSameCoords(room, x, y, z) {
  return room && room.x === x && room.y === y && room.z === z;
}

function pruneMovementIntents(now) {
  const cutoff = now - MOVEMENT_INTENT_TTL_MS;
  movementIntents = movementIntents.filter((intent) => intent.ts >= cutoff);
}

function consumeMovementIntent() {
  pruneMovementIntents(Date.now());
  return movementIntents.shift() || null;
}

function queueMovementIntent(direction, command) {
  const now = Date.now();
  pruneMovementIntents(now);
  movementIntents.push({
    seq: nextMovementSeq++,
    direction,
    command,
    ts: now,
  });
  if (movementIntents.length > MAX_MOVEMENT_INTENTS) {
    movementIntents = movementIntents.slice(-MAX_MOVEMENT_INTENTS);
  }
}

function updateRoomCoords(room, x, y, z, source) {
  if (room.x !== null) {
    const oldKey = room.area + ':' + room.x + ',' + room.y + ',' + room.z;
    if (coordIndex.get(oldKey) === room.id) coordIndex.delete(oldKey);
  }
  room.x = x;
  room.y = y;
  room.z = z;
  room.coordSource = source;
  coordIndex.set(room.area + ':' + x + ',' + y + ',' + z, room.id);
}

function maybeNotifyCorrection(room, oldCoords, sourceLabel) {
  if (!room || room.id !== currentRoomId || !oldCoords) return;
  if (oldCoords.x === room.x && oldCoords.y === room.y && oldCoords.z === room.z) return;
  appendSystemMessage(
    'Map sync: corrected current room position from '
    + oldCoords.x + ',' + oldCoords.y + ',' + oldCoords.z
    + ' to ' + room.x + ',' + room.y + ',' + room.z
    + ' (' + sourceLabel + ').'
  );
}

function triggerAreaResync(area, reason) {
  if (!area) return;
  const now = Date.now();
  const last = lastResyncByArea.get(area) || 0;
  if ((now - last) < RESYNC_COOLDOWN_MS) return;
  lastResyncByArea.set(area, now);
  appendSystemMessage('Map sync: resyncing ' + area + ' (' + reason + ').');
  requestAreaSync(area, true);
}

export function trackCommand(cmd) {
  const normalized = cmd.trim().toLowerCase().split(/\s+/)[0];
  const dir = DIR_ALIASES[normalized];
  if (dir) queueMovementIntent(dir, cmd);
}

export function processRoomInfo(data) {
  if (!data || data.num === null || data.num === undefined) return null;
  pruneMovementIntents(Date.now());

  const roomId = normalizeRoomId(data.num);
  const roomChanged = roomId !== currentRoomId;
  const isNew = !rooms.has(roomId);

  // Capture state BEFORE processing
  // Note: at this point currentRoomId = the room we just LEFT (not yet updated)
  const fromRoomId = currentRoomId;
  const movementIntent = roomChanged ? consumeMovementIntent() : null;
  const pendingDirectionUsed = movementIntent ? movementIntent.direction : null;
  const entry = {
    ts: new Date().toISOString(),
    roomId: shortRoomId(roomId),
    name: data.name || '?',
    area: data.area || '?',
    environment: data.environment || '',
    exits: data.exits && typeof data.exits === 'object' ? Object.keys(data.exits) : [],
    pendingDir: pendingDirectionUsed,
    movementSeq: movementIntent ? movementIntent.seq : null,
    fromRoomId: shortRoomId(fromRoomId),
    fromRoomName: fromRoomId && rooms.get(fromRoomId) ? rooms.get(fromRoomId).name : null,
    isNew,
    roomChanged,
    result: null,  // filled after processing
  };

  // Update or create room record
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      name: data.name || '',
      area: data.area || '',
      environment: data.environment || '',
      exits: {},
      x: null, y: null, z: null,
      coordSource: null,
    };
    rooms.set(roomId, room);
  } else {
    // Update mutable fields
    room.name = data.name || room.name;
    room.area = data.area || room.area;
    room.environment = data.environment || room.environment;
    if (!room.coordSource) room.coordSource = room.x !== null ? 'server' : null;
  }

  // Update exits (server sends "" when no exits, object when exits exist)
  if (data.exits && typeof data.exits === 'object') {
    room.exits = {};
    for (const [dir, destId] of Object.entries(data.exits)) {
      room.exits[dir] = normalizeRoomId(destId);
    }
  } else if (data.exits === '') {
    room.exits = {};
  }

  // Assign coordinates if this room has none and we have movement context
  // fromRoomId = currentRoomId = the room we just LEFT (not yet updated)
  if (room.x === null && roomChanged && pendingDirectionUsed && fromRoomId) {
    const fromRoom = rooms.get(fromRoomId);
    const offset = DIR_OFFSETS[pendingDirectionUsed];
    if (fromRoom && fromRoom.x !== null && offset) {
      const nx = fromRoom.x + offset.dx;
      const ny = fromRoom.y + offset.dy;
      const nz = fromRoom.z + offset.dz;
      const coordKey = room.area + ':' + nx + ',' + ny + ',' + nz;
      if (!coordIndex.has(coordKey)) {
        updateRoomCoords(room, nx, ny, nz, 'inferred');
        entry.result = 'assigned ' + nx + ',' + ny + ',' + nz;
      } else {
        entry.result = 'CONFLICT at ' + nx + ',' + ny + ',' + nz + ' (occupied by ' + shortRoomId(coordIndex.get(coordKey)) + ')';
        triggerAreaResync(room.area, 'coordinate conflict after ' + pendingDirectionUsed);
      }
    } else {
      entry.result = 'no-from-coords';
      if (!fromRoom) entry.result += ' (fromRoom missing)';
      else if (fromRoom.x === null) entry.result += ' (fromRoom unpositioned: ' + fromRoom.name + ')';
      if (!offset) entry.result += ' (bad direction: ' + pendingDirectionUsed + ')';
    }
  } else if (room.x === null) {
    if (!roomChanged) entry.result = 'same-room';
    else if (!pendingDirectionUsed) entry.result = 'no-pending-dir';
    else if (!fromRoomId) entry.result = 'no-from-room';
    else entry.result = 'already-positioned';
  } else {
    entry.result = 'already-has-coords ' + room.x + ',' + room.y + ',' + room.z;
  }

  // Seed origin: when we have a direction and a fromRoom, but nothing in
  // the area is positioned yet, seed the fromRoom at origin and then
  // position this room relative to it.
  if (room.x === null && roomChanged && pendingDirectionUsed && fromRoomId) {
    const fromRoom = rooms.get(fromRoomId);
    if (fromRoom && fromRoom.x === null) {
      const areaRooms = getRoomsByArea(room.area);
      if (areaRooms.length === 0) {
        const coordKey = fromRoom.area + ':0,0,0';
        if (!coordIndex.has(coordKey)) {
          updateRoomCoords(fromRoom, 0, 0, 0, 'inferred');
          // Now position this room relative to the newly seeded fromRoom
          const offset = DIR_OFFSETS[pendingDirectionUsed];
          if (offset) {
            const nx = offset.dx;
            const ny = offset.dy;
            const nz = offset.dz;
            const destKey = room.area + ':' + nx + ',' + ny + ',' + nz;
            if (!coordIndex.has(destKey)) {
              updateRoomCoords(room, nx, ny, nz, 'inferred');
              entry.result = 'seeded-origin+assigned ' + nx + ',' + ny + ',' + nz;
            }
          }
        }
      }
    }
  }

  entry.finalCoords = room.x !== null ? room.x + ',' + room.y + ',' + room.z : 'NONE';
  debugLog.push(entry);
  if (debugLog.length > 500) debugLog.shift();

  // Send authoritative room exits to the server for collaborative mapping.
  // The movement fields are only a fallback when the room's own exits are not
  // enough to connect it yet.
  if (roomChanged) {
    const fromRoom = rooms.get(fromRoomId);
    const offset = DIR_OFFSETS[pendingDirectionUsed];
    if (
      pendingDirectionUsed && fromRoom && offset
      && fromRoom.x !== null && room.x !== null
      && room.coordSource === 'server'
      && !isSameCoords(room, fromRoom.x + offset.dx, fromRoom.y + offset.dy, fromRoom.z + offset.dz)
    ) {
      triggerAreaResync(room.area, 'authoritative mismatch after ' + pendingDirectionUsed);
    }

    gmcp.send('Darkwind.MapData.RoomUpdate', {
      id: roomId,
      from_id: fromRoomId,
      direction: pendingDirectionUsed,
      move_seq: movementIntent ? movementIntent.seq : undefined,
      name: room.name,
      area: room.area,
      environment: room.environment,
      exits: room.exits,
    });
  }

  if (roomChanged) {
    previousRoomId = currentRoomId;
    currentRoomId = roomId;
    if (!movementIntent && movementIntents.length > 0) {
      triggerAreaResync(room.area, 'room changed without trusted movement intent');
    }
  }

  save();
  return room;
}

function rebuildCoordIndex() {
  coordIndex.clear();
  for (const room of rooms.values()) {
    if (room.x !== null) {
      coordIndex.set(room.area + ':' + room.x + ',' + room.y + ',' + room.z, room.id);
    }
  }
}

function removeAreaRooms(area) {
  for (const [id, room] of rooms) {
    if (id === currentRoomId) continue;
    if (room.area === area) rooms.delete(id);
  }
  rebuildCoordIndex();
}

function save() {
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
  try {
    const data = {};
    for (const [id, room] of rooms) {
      data[id] = room;
    }
    const versions = {};
    for (const [area, ver] of areaVersions) {
      versions[area] = ver;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      rooms: data,
      currentRoomId,
      previousRoomId,
      areaVersions: versions,
    }));
  } catch (e) {
    // localStorage full or unavailable — silently ignore
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.rooms) {
      rooms.clear();
      for (const [id, room] of Object.entries(data.rooms)) {
        const normalizedId = normalizeRoomId(id);
        room.id = normalizeRoomId(room.id) || normalizedId;
        if (room.exits && typeof room.exits === 'object') {
          for (const [dir, destId] of Object.entries(room.exits)) {
            room.exits[dir] = normalizeRoomId(destId);
          }
        }
        if (room.x !== null && !room.coordSource) room.coordSource = 'server';
        rooms.set(normalizedId, room);
      }
      rebuildCoordIndex();
    }
    if (data.currentRoomId !== null && data.currentRoomId !== undefined) currentRoomId = normalizeRoomId(data.currentRoomId);
    if (data.previousRoomId !== null && data.previousRoomId !== undefined) previousRoomId = normalizeRoomId(data.previousRoomId);
    if (data.areaVersions) {
      areaVersions.clear();
      for (const [area, ver] of Object.entries(data.areaVersions)) {
        areaVersions.set(area, ver);
      }
    }
  } catch (e) {
    // Corrupt data — start fresh
    rooms.clear();
    coordIndex.clear();
  }
}

// Receive server-resolved area data (Darkwind.MapData.Area)
// Server coords take priority over client-inferred coords
export function mergeServerAreaData(data) {
  if (!data || !data.area || !Array.isArray(data.rooms)) return;

  if (data.replace) {
    removeAreaRooms(data.area);
  }

  let merged = 0;
  let correctedCurrentRoom = false;
  for (const serverRoom of data.rooms) {
    const serverRoomId = normalizeRoomId(serverRoom.id);
    if (!serverRoomId) continue;

    let room = rooms.get(serverRoomId);
    if (!room) {
      room = {
        id: serverRoomId,
        name: serverRoom.name || '',
        area: data.area,
        environment: serverRoom.env || '',
        exits: {},
        x: null, y: null, z: null,
        coordSource: null,
      };
      rooms.set(serverRoomId, room);
    }

    // Server name/env updates
    if (serverRoom.name) room.name = serverRoom.name;
    if (serverRoom.env) room.environment = serverRoom.env;

    // Server exits
    if (serverRoom.exits && typeof serverRoom.exits === 'object') {
      room.exits = {};
      for (const [dir, destId] of Object.entries(serverRoom.exits)) {
        room.exits[dir] = normalizeRoomId(destId);
      }
    }

    if (serverRoom.x !== undefined && serverRoom.y !== undefined && serverRoom.z !== undefined) {
      const oldCoords = room.x !== null ? { x: room.x, y: room.y, z: room.z } : null;
      const changed = !isSameCoords(room, serverRoom.x, serverRoom.y, serverRoom.z) || room.coordSource !== 'server';
      updateRoomCoords(room, serverRoom.x, serverRoom.y, serverRoom.z, 'server');
      if (changed) {
        merged++;
      }
      if (room.id === currentRoomId && oldCoords && changed) {
        correctedCurrentRoom = true;
        maybeNotifyCorrection(room, oldCoords, 'server area data');
      }
    }
  }

  if (data.version !== undefined) {
    areaVersions.set(data.area, data.version);
  }

  if (merged > 0 || data.replace || data.version !== undefined) save();
  if (correctedCurrentRoom) {
    movementIntents = [];
  }
  return merged;
}

// Receive incremental update (Darkwind.MapData.Update)
// Merges rooms, stores version, and auto-requests next chunk if more available
export function mergeServerUpdate(data) {
  const merged = mergeServerAreaData(data);
  if (data && data.area && data.version !== undefined) {
    areaVersions.set(data.area, data.version);
    save();

    // If server indicates more chunks available, request the next one
    if (data.more) {
      gmcp.send('Darkwind.MapData.Sync', {
        area: data.area,
        version: data.version,
      });
    }
  }
  return merged;
}

export function applyRoomCorrection(data) {
  if (!data || data.id === null || data.id === undefined || data.x === undefined || data.y === undefined || data.z === undefined) return 0;

  const roomId = normalizeRoomId(data.id);
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      name: data.name || '',
      area: data.area || '',
      environment: data.environment || '',
      exits: {},
      x: null, y: null, z: null,
      coordSource: null,
    };
    rooms.set(roomId, room);
  } else if (data.area) {
    room.area = data.area;
  }

  const oldCoords = room.x !== null ? { x: room.x, y: room.y, z: room.z } : null;
  const changed = !isSameCoords(room, data.x, data.y, data.z) || room.coordSource !== 'server';
  updateRoomCoords(room, data.x, data.y, data.z, 'server');
  if (changed) {
    maybeNotifyCorrection(room, oldCoords, 'server correction');
    save();
    return 1;
  }
  return 0;
}

// Request a full resync for an area (sends Darkwind.MapData.Sync with version 0)
export function requestAreaSync(area, forceFull) {
  const ver = forceFull ? 0 : area ? (areaVersions.get(area) || 0) : 0;
  gmcp.send('Darkwind.MapData.Sync', { area: area, version: ver });
}

export function clearMapData() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  rooms.clear();
  coordIndex.clear();
  areaVersions.clear();
  currentRoomId = null;
  previousRoomId = null;
  movementIntents = [];
  lastResyncByArea.clear();
  localStorage.removeItem(STORAGE_KEY);
}

export { DIR_OFFSETS };

// ── Debug tools (exposed on window.mapDebug) ──────────────────────────

function debugDumpLog() {
  return JSON.parse(JSON.stringify(debugLog));
}

function debugDumpRooms() {
  const out = [];
  for (const room of rooms.values()) {
    out.push({
      id: shortRoomId(room.id),
      name: room.name,
      area: room.area,
      env: room.environment,
      coords: room.x !== null ? room.x + ',' + room.y + ',' + room.z : 'NONE',
      exits: Object.keys(room.exits),
      exitTargets: Object.fromEntries(
        Object.entries(room.exits).map(([d, id]) => [d, shortRoomId(id)])
      ),
    });
  }
  return out;
}

function debugDumpConflicts() {
  // Find rooms that have no coordinates
  const unpositioned = [];
  for (const room of rooms.values()) {
    if (room.x === null) {
      unpositioned.push({
        id: shortRoomId(room.id),
        name: room.name,
        area: room.area,
        exits: Object.keys(room.exits),
      });
    }
  }
  return unpositioned;
}

function debugDumpCoordIndex() {
  const out = {};
  for (const [key, id] of coordIndex) {
    const room = rooms.get(id);
    out[key] = { id: shortRoomId(id), name: room ? room.name : '?' };
  }
  return out;
}

function debugDumpDuplicateCoords() {
  const buckets = new Map();
  const duplicates = [];

  for (const room of rooms.values()) {
    if (room.x === null) continue;
    const key = room.area + ':' + room.x + ',' + room.y + ',' + room.z;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(room);
  }

  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;
    duplicates.push({
      coord: key,
      rooms: bucket.map((room) => ({
        id: shortRoomId(room.id),
        name: room.name,
        area: room.area,
      })),
    });
  }

  return duplicates;
}

function debugSummary() {
  const total = rooms.size;
  let positioned = 0;
  let unpositioned = 0;
  const areas = {};
  for (const room of rooms.values()) {
    if (room.x !== null) {
      positioned++;
      areas[room.area] = (areas[room.area] || 0) + 1;
    } else {
      unpositioned++;
    }
  }
  return {
    totalRooms: total,
    positioned,
    unpositioned,
    currentRoom: shortRoomId(currentRoomId),
    currentName: currentRoomId && rooms.get(currentRoomId) ? rooms.get(currentRoomId).name : null,
    previousRoom: shortRoomId(previousRoomId),
    movementQueue: movementIntents.map((intent) => ({
      seq: intent.seq,
      direction: intent.direction,
      ageMs: Date.now() - intent.ts,
    })),
    roomsByArea: areas,
    duplicateCoordBuckets: debugDumpDuplicateCoords().length,
    recentLog: debugLog.slice(-10),
  };
}

function debugExportAll() {
  return JSON.stringify({
    summary: debugSummary(),
    rooms: debugDumpRooms(),
    unpositioned: debugDumpConflicts(),
    duplicateCoords: debugDumpDuplicateCoords(),
    coordIndex: debugDumpCoordIndex(),
    log: debugDumpLog(),
  }, null, 2);
}

// Expose on window for browser console access
if (typeof window !== 'undefined') {
  window.mapDebug = {
    summary: debugSummary,
    rooms: debugDumpRooms,
    log: debugDumpLog,
    conflicts: debugDumpConflicts,
    duplicates: debugDumpDuplicateCoords,
    coordIndex: debugDumpCoordIndex,
    exportAll: debugExportAll,
    clearData: clearMapData,
  };
}
