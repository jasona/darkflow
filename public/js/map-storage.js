const DB_NAME = 'darkflow-maps';
const DB_VERSION = 1;
const STORE = 'areas';
const FALLBACK_PREFIX = 'darkflow-map-area:';

function recordKey(source, world, area) {
  return [source, world, area].join('|');
}

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function fallbackRecords(source, world) {
  const out = [];
  if (typeof localStorage === 'undefined') return out;
  const prefix = FALLBACK_PREFIX + source + '|' + world + '|';
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (value && value.key === recordKey(source, world, value.area)
        && value.source === source && value.world === world
        && typeof value.area === 'string' && value.area) out.push(value);
      else localStorage.removeItem(key);
    } catch (e) {
      localStorage.removeItem(key);
    }
  }
  return out;
}

function saveFallback(record) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(FALLBACK_PREFIX + record.key, JSON.stringify(record));
}

export async function loadMapAreas(source, world) {
  const db = await openDb().catch(() => null);
  if (!db) return fallbackRecords(source, world);
  return new Promise((resolve) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => {
      const records = new Map();
      for (const entry of request.result || []) {
        if (entry.source === source && entry.world === world)
          records.set(entry.key, entry);
      }
      // A previous IndexedDB transaction may have fallen back locally. Prefer
      // that record when it is newer than the durable IndexedDB copy.
      for (const entry of fallbackRecords(source, world)) {
        const prior = records.get(entry.key);
        if (!prior || (entry.updatedAt || 0) >= (prior.updatedAt || 0))
          records.set(entry.key, entry);
      }
      resolve(Array.from(records.values()));
    };
    request.onerror = () => resolve(fallbackRecords(source, world));
  });
}

export async function saveMapArea(source, world, area, value) {
  const record = Object.assign({}, value, {
    key: recordKey(source, world, area), source, world, area, updatedAt: Date.now(),
  });
  const db = await openDb().catch(() => null);
  if (!db) {
    saveFallback(record);
    return;
  }
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(record);
    request.onsuccess = resolve;
    request.onerror = () => {
      try {
        saveFallback(record);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
  });
}

export async function deleteMapArea(source, world, area) {
  const key = recordKey(source, world, area);
  const db = await openDb().catch(() => null);
  if (!db) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(FALLBACK_PREFIX + key);
    return;
  }
  await new Promise((resolve) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
    request.onsuccess = resolve;
    request.onerror = resolve;
  });
}

export async function clearMapSource(source, world) {
  const records = await loadMapAreas(source, world);
  await Promise.all(records.map((entry) => deleteMapArea(source, world, entry.area)));
}

export async function pruneMapAreas(source, world, maxRooms = 25000, keepArea = '') {
  const records = await loadMapAreas(source, world);
  records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  let kept = 0;
  for (const record of records) {
    const count = Array.isArray(record.rooms) ? record.rooms.length : 0;
    if (record.area === keepArea || kept + count <= maxRooms) {
      kept += count;
      continue;
    }
    await deleteMapArea(source, world, record.area);
  }
}
