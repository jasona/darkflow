# Darkwind.MapData2 GMCP Protocol

`Darkwind.MapData2` is Darkwind's server-authoritative collaborative map. The
server owns room identity, topology, layout, cache generations, and sync
boundaries. Clients render completed snapshots and must not infer Darkwind
coordinates from typed movement commands.

## Negotiation

```json
["Darkwind.MapData2 2"]
```

Version 2 adds map epochs, area generations, stable snapshot cursors, explicit
completion, trust metadata, and live-exit validation. The server retains the
version 1 offset/version response path for clients advertising version 1.

## Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.MapData2.Current` | Server -> Client | Current room plus live movement truth |
| `Darkwind.MapData2.Update` | Server -> Client | Full or incremental snapshot page |
| `Darkwind.MapData2.Sync` | Client -> Server | Start or continue a snapshot |
| `Darkwind.MapData2.Error` | Server -> Client | Restart or retry instruction |
| `Darkwind.MapData2.Browse` | Client -> Server | Request a catalog map |
| `Darkwind.MapData2.BrowseArea` | Server -> Client | Catalog map page |
| `Darkwind.MapData2.Reset` | Server -> Client | Global epoch changed |

## Room Record

```json
{
  "id": "450359962737049",
  "name": "Temple Yard",
  "area": "Darkwind",
  "env": "outside, city",
  "observed": true,
  "observedAt": 1783612800,
  "layoutState": "verified",
  "positioned": true,
  "x": 0,
  "y": 0,
  "z": 0,
  "coordSource": "room | grid | solver",
  "version": 12,
  "exits": { "north": "450359962737050" },
  "exitKinds": { "north": "spatial" },
  "exitDoors": { "north": 1 },
  "walkSafe": { "north": true },
  "details": ["shop"]
}
```

`layoutState` is `frontier`, `pending`, `verified`, `adjusted`, or
`identity_conflict`. Frontier records are destination stubs that have not been
visited. Adjusted rooms are positioned away from their natural cell to preserve
both rooms after a collision. Clients must display these states without
inventing adjacency.

## Current

`Current` contains the room record plus:

```json
{
  "protocol": 2,
  "mapEpoch": "1783612800-123456",
  "areaGeneration": 3,
  "areaVersion": 91,
  "areaName": "Darkwind",
  "liveExits": { "north": "450359962737050" },
  "liveDoors": { "north": 1 }
}
```

`liveExits` and `liveDoors` are the current observation, not durable shared
topology. A speedwalk must verify the next direction and destination against
these fields before sending the command.

## Version 2 Sync

Initial or incremental request:

```json
{
  "area": "Darkwind",
  "mapEpoch": "1783612800-123456",
  "generation": 3,
  "since": 40,
  "snapshotVersion": 0,
  "cursor": 0
}
```

The first response freezes `snapshotVersion`. Continuations repeat it and use
the returned room-id cursor:

```json
{
  "protocol": 2,
  "mapEpoch": "1783612800-123456",
  "area": "Darkwind",
  "areaGeneration": 3,
  "since": 40,
  "snapshotVersion": 91,
  "latestVersion": 93,
  "cursor": "450359962737099",
  "complete": false,
  "replace": false,
  "rooms": []
}
```

Clients stage every page and commit only when `complete` is true. `replace`
means the committed snapshot replaces that area's cached membership. When
`latestVersion` is greater than `snapshotVersion`, request an incremental sync
immediately after commit. Empty areas still produce a completed response.

An epoch mismatch invalidates the whole MapData2 cache. An area-generation
mismatch invalidates only that area. `Error.restart` instructs the client to
discard the staged transfer and request a full area snapshot. Rate-limit errors
carry `retryAfterMs`.

## Speedwalk Safety

Canonical compass, diagonal, up/down, and in/out exits are safe by default.
Other exit verbs require the room's `query_map_speedwalk_safe(direction)` hook.
Every step is sent separately and verified against the next authoritative room
id. Disconnects, map epoch changes, missing live exits, closed doors, send
failures, timeouts, and unexpected rooms cancel the walk.
