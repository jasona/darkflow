import * as mapData from './map-data-v2.js';

const TILE_SIZE = 32;
// Gap between room boxes. Rooms are drawn as separate boxes spaced apart, with
// connector lines bridging the gap between connected neighbours.
const TILE_GAP = 8;
const MAP_DIRECTIONS = new Set([
  'north', 'south', 'east', 'west',
  'northeast', 'northwest', 'southeast', 'southwest',
  'up', 'down',
]);
let lastRenderDebug = null;

const COMPASS_DIRS = [
  ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'],
  ['northeast', 'ne'], ['northwest', 'nw'],
  ['southeast', 'se'], ['southwest', 'sw'],
];

const REVERSE_DIR = {
  north: 'south', south: 'north', east: 'west', west: 'east',
  northeast: 'southwest', southwest: 'northeast',
  northwest: 'southeast', southeast: 'northwest',
  up: 'down', down: 'up',
};

// Remember the last room the player occupied that had a coordinate, per area.
// When the player steps into a room the server has not positioned yet, we keep
// the view parked on this spot instead of blanking the whole panel.
const lastCenterByArea = new Map();

// Pick a coordinate to center the grid on when the player's own room has no
// coordinate. Prefer the last positioned room we centered on for this area;
// otherwise fall back to the area room nearest the centroid so the view is
// stable rather than jumping to an arbitrary edge room.
function pickCenterRoom(area, areaRooms, source, skipLast) {
  if (!skipLast) {
    const lastId = lastCenterByArea.get(area);
    if (lastId) {
      const last = source.getRoom(lastId);
      if (last && last.area === area && last.x !== null) return last;
    }
  }

  let sumX = 0;
  let sumY = 0;
  for (const room of areaRooms) {
    sumX += room.x;
    sumY += room.y;
  }
  const cx = sumX / areaRooms.length;
  const cy = sumY / areaRooms.length;

  let best = areaRooms[0];
  let bestDist = Infinity;
  for (const room of areaRooms) {
    const dx = room.x - cx;
    const dy = room.y - cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      best = room;
      bestDist = dist;
    }
  }
  return best;
}

// Child spans drawn in the gap outside a room box for each compass exit
// (cardinals and diagonals):
//  - a CONNECTOR line bridging to an adjacent mapped neighbour, or
//  - a shorter STUB tick toward an exit whose destination is not mapped yet
//    (so the player can see where there is still more to explore -- the map
//    grows visibly as you walk, mirroring Mudlet's exit stubs).
// Each side draws the full gap-bridging line, so a one-way exit still renders
// a full connector and reciprocal neighbours' lines coincide exactly.
// Also emits per-tile up/down glyphs and a special-exit (enter/portal) dot so
// every exit a room has is visible on the map, not just planar compass ones.
function buildExitSpans(room, cz, source) {
  if (!room || !room.exits) return '';
  let spans = '';
  for (const [dir, abbr] of COMPASS_DIRS) {
    const destId = room.exits[dir];
    if (!destId) continue;
    const dest = source.getRoom(destId);
    // Stub if the destination isn't positioned, OR lives in a different zone --
    // a cross-zone exit's coordinates are in another area's space and must not
    // be drawn as an adjacent connector. A KNOWN other-zone destination is an
    // area boundary ("this leads somewhere else"), rendered distinctly from an
    // unexplored stub ("more to explore"); the tooltip names the zone.
    if (!dest || dest.x === null || dest.area !== room.area) {
      const areaMod = dest && dest.area && dest.area !== room.area
        ? ' map-stub-area' : '';
      spans += '<span class="map-stub map-stub-' + abbr + areaMod + '"></span>';
      continue;
    }
    if (dest.z !== cz) continue;
    const offset = source.DIR_OFFSETS[dir];
    if (dest.x === room.x + offset.dx && dest.y === room.y + offset.dy) {
      // One-way when the destination has no exit pointing back at us
      // (Mudlet's convention: dashed line + arrowhead toward the dest).
      const oneWay = !dest.exits || dest.exits[REVERSE_DIR[dir]] !== room.id;
      spans += '<span class="map-conn map-conn-' + abbr
        + (oneWay ? ' map-conn-oneway' : '') + '"></span>';
      if (oneWay) {
        spans += '<span class="map-arrow map-arrow-' + abbr + '"></span>';
      }
    } else {
      // The graph edge is authoritative but collision repair placed the room
      // somewhere non-adjacent. Show an adjusted stub rather than hiding a
      // known exit or drawing a false straight connection.
      spans += '<span class="map-stub map-stub-' + abbr
        + ' map-stub-adjusted"></span>';
    }
  }
  // Door ticks: a small state-colored marker mid-gap. A door may exist on a
  // direction with NO exit entry (the server strips exits behind closed
  // doors), so this runs independently of the connector/stub loop above.
  const doors = room.exitDoors;
  if (doors) {
    for (const [dir, abbr] of COMPASS_DIRS) {
      if (doors[dir]) {
        spans += '<span class="map-door map-door-' + abbr
          + ' map-door-state-' + doorStateName(doors[dir]) + '"></span>';
      }
    }
  }
  // Vertical glyphs render from either an exit or a door (a closed up-door
  // means there IS a way up, just shut right now); door state tints them.
  if (room.exits.up !== undefined || (doors && doors.up)) {
    spans += '<span class="map-vert map-vert-up' + vertDoorClass(doors, 'up')
      + '">&#x25B2;</span>';
  }
  if (room.exits.down !== undefined || (doors && doors.down)) {
    spans += '<span class="map-vert map-vert-down' + vertDoorClass(doors, 'down')
      + '">&#x25BC;</span>';
  }
  spans += specialExitSpans(room);
  if (room.details && room.details.length) {
    spans += '<span class="map-detail">' + detailGlyph(room.details[0])
      + '</span>';
  }
  return spans;
}

// Room feature badge (top edge): first detail only; the tooltip lists all.
const DETAIL_GLYPHS = {
  shop: '$', bank: 'B', guild: 'G', pub: 'P', post: 'M',
};

function detailGlyph(detail) {
  if (DETAIL_GLYPHS[detail]) return DETAIL_GLYPHS[detail];
  return String(detail).charAt(0).toUpperCase() || '?';
}

function doorStateName(state) {
  return state === 3 ? 'locked' : state === 2 ? 'closed' : 'open';
}

function vertDoorClass(doors, dir) {
  if (!doors || !doors[dir]) return '';
  return ' map-vert-door-' + doorStateName(doors[dir]);
}

// Indicators for non-compass exits. "in"-like and "out"-like exits get
// directional chevron glyphs (Mudlet draws inward/outward triangle pairs);
// any other special exit (portal, custom verb) keeps the generic dot, shifted
// left when it shares the corner with an in/out glyph. exitKinds may be
// absent on neighbour stubs that have only been seen from an adjacent room.
const IN_EXIT_NAMES = new Set(['in', 'enter']);
const OUT_EXIT_NAMES = new Set(['out', 'exit', 'leave']);

function specialExitSpans(room) {
  if (!room.exitKinds) return '';
  let hasIn = false;
  let hasOut = false;
  let hasOther = false;
  for (const [dir, kind] of Object.entries(room.exitKinds)) {
    if (kind === 'spatial' || kind === 'vertical') continue;
    if (IN_EXIT_NAMES.has(dir)) hasIn = true;
    else if (OUT_EXIT_NAMES.has(dir)) hasOut = true;
    else hasOther = true;
  }
  let spans = '';
  if (hasIn) spans += '<span class="map-inout map-exit-in">&#x203A;&#x2039;</span>';
  if (hasOut) spans += '<span class="map-inout map-exit-out">&#x2039;&#x203A;</span>';
  if (hasOther) {
    spans += '<span class="map-exit-special'
      + (hasIn || hasOut ? ' map-exit-special-shifted' : '') + '"></span>';
  }
  return spans;
}

// Priority order: more specific terrains first
const TERRAIN_PRIORITY = [
  'city', 'road', 'path', 'forest', 'jungle', 'canopy',
  'plains', 'farm', 'hills', 'mountain', 'desert',
  'sea', 'lake', 'river', 'beach', 'swamp', 'arctic',
  'underground', 'inside', 'barren', 'underwater', 'sky', 'outside',
];

function getTerrainName(environment) {
  if (!environment) return 'outside';
  const terrains = environment.toLowerCase().split(/,\s*| and /);
  for (const t of TERRAIN_PRIORITY) {
    if (terrains.includes(t)) return t;
  }
  return 'outside';
}

export function renderMap(bodyEl, source = mapData) {
  // Browse mode renders an arbitrary catalog area (opened in the Area Map pane)
  // with no player marker; the live map is the default source.
  const browse = !!source.isBrowse;
  const currentId = source.getCurrentRoomId();
  const currentRoom = currentId ? source.getRoom(currentId) : null;

  // The player's room is only a usable render center when it has a coordinate
  // (and only in live mode -- a browse view has no player).
  const playerRoom = !browse && currentRoom && currentRoom.x !== null ? currentRoom : null;
  const playerId = playerRoom ? playerRoom.id : null;

  let centerRoom = playerRoom;
  let pending = false;

  if (browse) {
    // Center on the server-suggested room, else the area centroid.
    const areaRooms = source.getRoomsByArea(currentRoom ? currentRoom.area : null);
    if (areaRooms.length === 0) {
      bodyEl.innerHTML = '<div class="map-grid map-empty">'
        + '<div class="map-empty-msg">No rooms mapped for this area yet.</div></div>';
      return;
    }
    centerRoom = currentRoom && currentRoom.x !== null
      ? currentRoom
      : pickCenterRoom(areaRooms[0].area, areaRooms, source, true);
  } else if (!centerRoom) {
    // Live mode: the player's room is not positioned yet. Do NOT blank the map;
    // keep showing the surrounding area parked on the last known position with a
    // "locating" indicator, so a single unpositioned room never wipes the map.
    const area = currentRoom ? currentRoom.area : null;
    const areaRooms = area ? source.getRoomsByArea(area) : [];
    if (!area || areaRooms.length === 0) {
      const message = currentRoom
        ? 'Locating you...<br>Keep exploring this area.'
        : 'No map data yet.<br>Explore to build the map.';
      bodyEl.innerHTML = '<div class="map-grid map-empty">'
        + '<div class="map-empty-msg">' + message + '</div></div>';
      return;
    }
    centerRoom = pickCenterRoom(area, areaRooms, source);
    pending = true;
  } else if (centerRoom.area) {
    // Remember where we are so we can park here if the next room is unpositioned.
    lastCenterByArea.set(centerRoom.area, centerRoom.id);
  }

  const bodyWidth = bodyEl.clientWidth || 320;
  const bodyHeight = bodyEl.clientHeight || 240;

  // How many tiles fit in the panel (each cell is a tile plus the gap to the next)
  const pitch = TILE_SIZE + TILE_GAP;
  const tilesX = Math.max(3, Math.floor((bodyWidth + TILE_GAP) / pitch));
  const tilesY = Math.max(3, Math.floor((bodyHeight + TILE_GAP) / pitch));

  // Ensure odd numbers so player is centered
  const gridW = tilesX % 2 === 0 ? tilesX - 1 : tilesX;
  const gridH = tilesY % 2 === 0 ? tilesY - 1 : tilesY;
  const radiusX = (gridW - 1) / 2;
  const radiusY = (gridH - 1) / 2;

  const cx = centerRoom.x;
  const cy = centerRoom.y;
  const cz = centerRoom.z;

  const areaRooms = source.getRoomsByArea(centerRoom.area);
  const distances = buildConnectedDistances(centerRoom, Math.max(gridW, gridH) + 8, source);
  const buckets = new Map();
  const visibleBounds = {
    minX: cx - radiusX,
    maxX: cx + radiusX,
    minY: cy - radiusY,
    maxY: cy + radiusY,
  };
  const connectedVisibleCount = countVisibleConnectedRooms(areaRooms, distances, cz, visibleBounds);

  for (const room of areaRooms) {
    if (room.z === cz) {
      const key = room.x + ',' + room.y;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(room);
    }
  }

  // Build grid HTML
  let html = '<div class="map-grid" style="'
    + 'gap:' + TILE_GAP + 'px;'
    + 'grid-template-columns:repeat(' + gridW + ',' + TILE_SIZE + 'px);'
    + 'grid-template-rows:repeat(' + gridH + ',' + TILE_SIZE + 'px)">';

  for (let ry = 0; ry < gridH; ry++) {
    for (let rx = 0; rx < gridW; rx++) {
      const worldX = cx - radiusX + rx;
      const worldY = cy - radiusY + ry;
      const bucket = buckets.get(worldX + ',' + worldY) || [];
      const room = chooseRoomForTile(bucket, playerId, distances, connectedVisibleCount);

      if (!room) {
        html += '<div class="map-tile"></div>';
      } else if (room.id === playerId) {
        const terrain = getTerrainName(room.environment);
        const trustClass = room.layoutState ? ' map-layout-' + room.layoutState : '';
        html += '<div class="map-tile map-tile-room map-tile-' + terrain
          + ' map-tile-player' + trustClass + conflictClass(bucket)
          + '" title="' + escAttr(tileTitle(room, bucket, source)) + '"'
          + ' data-room-id="' + escAttr(room.id) + '"'
          + conflictAttr(bucket) + '>'
          + buildExitSpans(room, cz, source) + '</div>';
      } else {
        const terrain = getTerrainName(room.environment);
        const lastPos = pending && room.id === centerRoom.id ? ' map-tile-lastpos' : '';
        const trustClass = room.layoutState ? ' map-layout-' + room.layoutState : '';
        html += '<div class="map-tile map-tile-room map-tile-' + terrain
          + trustClass + conflictClass(bucket) + lastPos
          + '" title="' + escAttr(tileTitle(room, bucket, source)) + '"'
          + ' data-room-id="' + escAttr(room.id) + '"'
          + conflictAttr(bucket) + '>'
          + buildExitSpans(room, cz, source) + '</div>';
      }
    }
  }

  html += '</div>';

  // Z-level indicator overlay. Reflects the room the player is in when known,
  // otherwise the parked center room.
  const zRoom = playerRoom || centerRoom;
  const hasUp = zRoom.exits && zRoom.exits.up !== undefined;
  const hasDown = zRoom.exits && zRoom.exits.down !== undefined;
  if (hasUp || hasDown || cz !== 0) {
    html += '<div class="map-zlevel">';
    if (hasUp) html += '<span class="map-zlevel-arrow">&#x25B2;</span> ';
    html += 'Z:' + cz;
    if (hasDown) html += ' <span class="map-zlevel-arrow">&#x25BC;</span>';
    html += '</div>';
  }

  // Area name on top (updates as you cross areas); the raw area key is the
  // tooltip to aid map-data troubleshooting. Below it, in live mode, the name of
  // the room you are actually in.
  const titleRoom = currentRoom || centerRoom;
  const areaKey = titleRoom.area || '';
  const areaName = (source.getAreaName && source.getAreaName()) || areaKey;
  if (areaName) {
    html += '<div class="map-areaname" title="' + escAttr(areaKey) + '">'
      + escAttr(areaName) + '</div>';
  }
  if (!browse && source.getAuthority) {
    const authority = source.getAuthority();
    html += '<div class="map-authority map-authority-' + escAttr(authority)
      + '" title="' + (authority === 'authoritative'
        ? 'Server-authoritative map data' : 'Locally learned map data') + '">'
      + (authority === 'authoritative' ? 'Server' : 'Learned') + '</div>';
  }
  if (!browse) {
    html += '<div class="map-roomname">' + escAttr(titleRoom.name) + '</div>';
  }
  html += '<div class="map-compass">N&#x2191;</div>';
  if (browse) {
    // No player marker, pending banner, or Resync for a read-only browse view.
  } else if (pending) {
    html += '<div class="map-pending">&#x25C9; Locating you...</div>';
  } else {
    const status = source.getMapStatus();
    if (status) html += '<div class="map-status">' + escAttr(status) + '</div>';
  }
  if (!browse) {
    const clearLabel = source.getClearMapActionLabel ? source.getClearMapActionLabel() : 'Resync';
    const clearTitle = source.getClearMapActionTitle
      ? source.getClearMapActionTitle()
      : 'Clear and resync map for this area';
    html += '<button class="map-resync-btn" title="' + escAttr(clearTitle) + '">'
      + escAttr(clearLabel) + '</button>';
  }

  bodyEl.innerHTML = html;

  const resyncBtn = bodyEl.querySelector('.map-resync-btn');
  if (resyncBtn) {
    resyncBtn.addEventListener('click', () => {
      const area = (currentRoom || centerRoom).area;
      if (area) source.clearMapDataForArea(area);
    });
  }

  lastRenderDebug = {
    pending,
    currentRoom: currentRoom ? {
      id: currentRoom.id.slice(0, 8),
      name: currentRoom.name,
      area: currentRoom.area,
      positioned: currentRoom.x !== null,
      exits: currentRoom.exits ? Object.keys(currentRoom.exits) : [],
    } : null,
    centerRoom: {
      id: centerRoom.id.slice(0, 8),
      name: centerRoom.name,
      coords: cx + ',' + cy + ',' + cz,
    },
    areaRoomCount: areaRooms.length,
    connectedRoomCount: distances.size,
    connectedVisibleCount,
    visibleBucketCount: countVisibleBuckets(buckets, visibleBounds),
    grid: { width: gridW, height: gridH },
  };
}

function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildConnectedDistances(startRoom, maxDistance, source) {
  const distances = new Map();
  const queue = [startRoom.id];
  let head = 0;

  distances.set(startRoom.id, 0);

  while (head < queue.length) {
    const id = queue[head++];
    const room = source.getRoom(id);
    const distance = distances.get(id);

    if (!room || distance >= maxDistance || !room.exits) continue;

    for (const [dir, destId] of Object.entries(room.exits)) {
      if (!MAP_DIRECTIONS.has(dir) || !destId || distances.has(destId)) continue;

      const dest = source.getRoom(destId);
      if (!dest || dest.area !== startRoom.area) continue;

      distances.set(destId, distance + 1);
      queue.push(destId);
    }
  }

  return distances;
}

function chooseRoomForTile(bucket, currentId, distances, connectedVisibleCount) {
  let best = null;
  let bestDistance = Infinity;

  for (const room of bucket) {
    if (room.id === currentId) return room;

    const distance = distances.get(room.id);
    if (distance === undefined) continue;
    if (distance < bestDistance) {
      best = room;
      bestDistance = distance;
    }
  }

  if (best) return best;

  if (bucket.length === 1) return bucket[0];
  if (!bucket.length) return null;
  // Conflicts remain visible, but selection is stable and confidence-aware.
  // Never let mapping iteration order decide what the player sees.
  return bucket.slice().sort((a, b) => {
    const aRank = a.layoutState === 'verified' ? 0 : a.observed ? 1 : 2;
    const bRank = b.layoutState === 'verified' ? 0 : b.observed ? 1 : 2;
    return aRank - bRank || String(a.id).localeCompare(String(b.id));
  })[0];
}

function conflictClass(bucket) {
  return bucket.length > 1 ? ' map-tile-conflict' : '';
}

// Stack count for the conflict corner badge (CSS reads it via attr()).
function conflictAttr(bucket) {
  return bucket.length > 1 ? ' data-stack="' + bucket.length + '"' : '';
}

function tileTitle(room, bucket, source) {
  let title = room.name;
  if (bucket.length > 1) {
    const names = bucket.slice(0, 6).map((entry) => entry.name || 'Unknown');
    const suffix = bucket.length > names.length ? '\n+' + (bucket.length - names.length) + ' more' : '';
    title += '\n' + bucket.length + ' mapped rooms share this coordinate:\n'
      + names.join('\n') + suffix;
  }
  const boundaries = boundaryExitLines(room, source);
  if (boundaries.length) title += '\n' + boundaries.join('\n');
  if (room.details && room.details.length) {
    title += '\n[' + room.details.join(', ') + ']';
  }
  return title;
}

// "east -> darkwind.forest" lines for exits that lead to another zone, so the
// amber boundary stubs are explained on hover.
function boundaryExitLines(room, source) {
  if (!room || !room.exits || !source) return [];
  const lines = [];
  for (const [dir, destId] of Object.entries(room.exits)) {
    if (!MAP_DIRECTIONS.has(dir)) continue;
    const dest = source.getRoom(destId);
    if (dest && dest.area && room.area && dest.area !== room.area) {
      lines.push(dir + ' -> ' + dest.area);
    }
  }
  return lines;
}

function countVisibleConnectedRooms(areaRooms, distances, z, bounds) {
  let count = 0;

  for (const room of areaRooms) {
    if (room.z !== z) continue;
    if (room.x < bounds.minX || room.x > bounds.maxX) continue;
    if (room.y < bounds.minY || room.y > bounds.maxY) continue;
    if (distances.has(room.id)) count++;
  }

  return count;
}

function countVisibleBuckets(buckets, bounds) {
  let count = 0;

  for (const key of buckets.keys()) {
    const parts = key.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (x < bounds.minX || x > bounds.maxX) continue;
    if (y < bounds.minY || y > bounds.maxY) continue;
    count++;
  }

  return count;
}

if (typeof window !== 'undefined') {
  window.mapRenderDebug = function mapRenderDebug() {
    return lastRenderDebug;
  };
}
