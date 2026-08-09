/** Shared MapData2 room record (docs/gmcp-darkwind-mapdata-v2.md:33-53). */
export interface MapData2RoomRecord {
  id: string;
  name?: string;
  area?: string;
  env?: string;
  observed?: boolean;
  observedAt?: number;
  layoutState?: string;
  positioned?: boolean;
  x?: number;
  y?: number;
  z?: number;
  coordSource?: string;
  version?: number;
  exits?: Record<string, string>;
  exitKinds?: Record<string, string>;
  exitDoors?: Record<string, number>;
  walkSafe?: Record<string, boolean>;
  details?: string[];
  [key: string]: unknown;
}

/** Darkwind.MapData2.Current inbound payload (docs/gmcp-darkwind-mapdata-v2.md:64-76). */
export interface MapData2Current extends MapData2RoomRecord {
  protocol?: number;
  mapEpoch?: string;
  areaGeneration?: number;
  areaVersion?: number;
  areaName?: string;
  liveExits?: Record<string, string>;
  liveDoors?: Record<string, number>;
}

/** Darkwind.MapData2.Area inbound payload (docs/gmcp-darkwind-mapdata-v2.md:128-131). */
export interface MapData2Area {
  area: string;
  rooms: MapData2RoomRecord[];
  version?: number;
  more?: boolean;
  replace?: boolean;
  areaGeneration?: number;
  mapEpoch?: string;
  [key: string]: unknown;
}

/** Darkwind.MapData2.Update inbound payload (docs/gmcp-darkwind-mapdata-v2.md:100-114,133-141). */
export interface MapData2Update {
  area: string;
  protocol?: number;
  mapEpoch?: string;
  areaGeneration?: number;
  since?: number;
  snapshotVersion?: number;
  latestVersion?: number;
  cursor?: string | number;
  complete?: boolean;
  replace?: boolean;
  rooms?: MapData2RoomRecord[];
  version?: number;
  offset?: number;
  more?: boolean;
  [key: string]: unknown;
}

/** Darkwind.MapData2.Error inbound payload (docs/gmcp-darkwind-mapdata-v2.md:122-124). */
export interface MapData2Error {
  restart?: boolean;
  retryAfterMs?: number;
  [key: string]: unknown;
}

/** Darkwind.MapData2.BrowseArea inbound payload (docs/gmcp-darkwind-mapdata-v2.md:150-152). */
export interface MapData2BrowseArea {
  catalog: string;
  name?: string;
  center?: MapData2RoomRecord;
  rooms?: MapData2RoomRecord[];
  more?: boolean;
  offset?: number;
  [key: string]: unknown;
}

/** Darkwind.MapData2.Reset inbound payload (docs/gmcp-darkwind-mapdata-v2.md:154-158). */
export interface MapData2Reset {
  scope?: string;
  area?: string;
  areaGeneration?: number;
  mapEpoch?: string;
  [key: string]: unknown;
}

/** Darkwind.MapData2.Sync outbound payload (docs/gmcp-darkwind-mapdata-v2.md:86-95). */
export interface MapData2Sync {
  area: string;
  mapEpoch?: string;
  generation?: number;
  since?: number;
  snapshotVersion?: number;
  cursor?: string | number;
  version?: number;
  offset?: number;
  [key: string]: unknown;
}

/** Darkwind.MapData2.Browse outbound payload (docs/gmcp-darkwind-mapdata-v2.md:149). */
export interface MapData2Browse {
  catalog: string;
  [key: string]: unknown;
}
