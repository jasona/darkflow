# Darkwind.Professions GMCP Protocol Specification

This document specifies the `Darkwind.Professions` GMCP package, which carries the 11 crafting profession skill levels for the professions panel.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Professions 1"]
```

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Professions.List` | Server -> Client | Replace the full set of profession skill levels |
| `Darkwind.Professions.Update` | Server -> Client | Update a single profession's skill level in place |

Both messages flow server -> client only. There is no companion client -> server request; the server pushes `List` on subscribe/login/pane-open and pushes `Update` the instant a profession point is gained. Neither is tied to the 2-second character cadence.

## Darkwind.Professions.List

Direction: `Server -> Client`

Full snapshot of all 11 profession skill levels (0-1000 each).

### Schema

```json
{
  "professions": [
    { "name": "Blacksmithing", "points": 240, "max": 1000 },
    { "name": "Tailoring", "points": 15, "max": 1000 }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `professions` | array | Yes | Ordered list of all professions; the client renders them in the order received |
| `professions[].name` | string | Yes | Display name; also used as the merge key for `Update` payloads |
| `professions[].points` | number | Yes | Current skill points |
| `professions[].max` | number | No | Skill cap; the client defaults to `1000` if omitted |

### Client Behavior

- Replaces `gmcpData.professions` wholesale and re-renders every bar in the `professions` panel.
- Rendered via the shared vitals meter component with a flat (always-green) fill, since partial progress on a profession isn't a warning state the way vitals/guild bars are.

### Server Behavior

- Sent on character login/subscription and when the professions panel is opened.
- Gated by `query_gmcp_panel_subscription(who, "professions")`.

## Darkwind.Professions.Update

Direction: `Server -> Client`

Incremental delta for a single profession, sent directly to the acting player the instant `add_profession_point()` awards a point.

### Schema

```json
{ "name": "Blacksmithing", "value": 241, "valueWas": 240, "valueMax": 1000 }
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | Profession name; merge key against the cached list |
| `value` | number | Yes | New skill point total |
| `valueWas` | number | No | Prior skill point total; not currently used by the client |
| `valueMax` | number | No | Skill cap; the client defaults to `1000` if omitted |

### Client Behavior

- Merges into `gmcpData.professions` using `name` as the key: when it matches an existing entry, the entry is replaced and only that profession's bar is re-rendered in place; when `name` is new, the entry is appended and the full panel re-renders once to lay out the new row.

### Server Behavior

- Sent from `add_profession_point()` the instant a point is gained; not batched with the periodic character-stat cadence.

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Example:

```text
Darkwind.Professions.Update {"name":"Blacksmithing","value":241,"valueWas":240,"valueMax":1000}
```
