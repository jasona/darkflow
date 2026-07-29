# Darkwind.Client GMCP Protocol Specification

This document specifies the `Darkwind.Client` GMCP package, which carries client-side coordination messages: panel/feature subscriptions, terminal geometry, and on-demand media refresh.

## Package Overview

Support declaration advertised by the client:

```json
["Darkwind.Client.Subscriptions 1", "Darkwind.Client.NAWS 1"]
```

`Darkwind.Client.Subscriptions` and `Darkwind.Client.NAWS` are advertised in the support set. The companion `Darkwind.Client.RefreshMedia` message is gated by other media-bearing packages (`Darkwind.Char.Avatar`, `Darkwind.Room.Image`).

| Message | Direction | Purpose |
|---------|-----------|---------|
| `Darkwind.Client.Subscriptions` | Client -> Server | Declare which panels are visible and which feature streams are wanted |
| `Darkwind.Client.NAWS` | Client -> Server | Report terminal width/height so the server can wrap output to the active pane |
| `Darkwind.Client.RefreshMedia` | Client -> Server | Ask the server to re-push current media (avatar and room image) |

All three messages flow client -> server only; the server does not echo a structured acknowledgement. Subscriptions take effect by gating subsequent server-driven pushes; RefreshMedia takes effect by triggering pushes on packages such as `Darkwind.Char.Avatar` and `Darkwind.Room.Image`; NAWS updates the server's active wrap width for this session.

## Darkwind.Client.Subscriptions

Direction: `Client -> Server`

Tells the server which UI surfaces the client currently cares about so the
server can avoid pushing data the client will not render. Subscriptions are
stored on the player attribute and used to gate downstream pushes including
vitals, guild vitals, XP Monitor, status, room, map, room image, avatar, group,
inventory, cyberware, enemy, chat, omens, sky, quests, achievements, and the
announcement bell.

### Schema

```json
{
  "reason": "panel-open",
  "full": false,
  "panels": {
    "avatar": true,
    "vitals": true,
    "guildVitals": true,
    "status": true,
    "buffs": true,
    "worth": false,
    "stats": false,
    "xpmon": false,
    "room": true,
    "group": false,
    "inventory": true,
    "enemy": true,
    "chat": false,
    "map": true,
    "roomImage": true,
    "omens": false,
    "sky": true,
    "quests": false,
    "achievements": false,
    "cyberware": false
  },
  "features": {
    "announcementsBadge": true,
    "announcementsList": false,
    "combatPane": false,
    "visualEffects": false,
    "enemyAutoOpen": true,
    "windows": true,
    "ide": true,
    "completion": true,
    "giphy": true,
    "broadcast": true
  }
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `reason` | string | Yes | Free-form telemetry tag for why this update was sent. Common values: `login`, `reconnect`, `panel-open`, `panel-close`, `visibility-sync`, `character-login`, `modal-open`, `ctrl-k` |
| `full` | boolean | No | When `true`, the server should re-push the full canonical state for all subscribed surfaces; when `false`, the server may send only deltas relative to the previous subscription mapping |
| `panels` | object | No | Map of panel id -> visibility boolean. See "Panels" below for keys recognized by the current server |
| `features` | object | No | Map of feature flag -> boolean. See "Features" below |

### Panels

The current server recognizes the following panel keys. Unknown keys are stored but have no effect on push gating.

| Panel | Notes |
|-------|-------|
| `avatar` | Drives `Darkwind.Char.Avatar` and is part of the media-subscription gate |
| `vitals` | Driven by `Char.Vitals`. The client always sends `vitals: true` |
| `guildVitals` | Driven by `Darkwind.GuildVitals` |
| `xpmon` | Driven by `Darkwind.XPMon` |
| `status` | Driven by `Char.Status`. The client forces `status: true` whenever the buffs panel is open |
| `buffs` | Client layout key; opening it forces the server-recognized `status` subscription for `Char.Defences.*` hydration |
| `worth` | Driven by `Char.Worth` |
| `stats` | Driven by `Char.Stats` and `Char.RealStats` |
| `room` | Drives `Room.Info` push gate (alongside `map` and `roomImage`) |
| `group` | Driven by `Group` |
| `inventory` | Driven by `Char.Items.*` |
| `enemy` | Driven by `Char.Enemy` and gated together with `enemyAutoOpen` |
| `chat` | Driven by standard `Comm.Channel.*` messages (`List`, `Players`, `Start`, `End`, and `Text`) |
| `map` | Drives `Room.Info` push gate |
| `roomImage` | Drives `Darkwind.Room.Image` and `Room.Info` push gates |
| `omens` | Drives `Darkwind.Divine` |
| `sky` | Drives `Darkwind.Sky`; the client animates between occasional syncs |
| `quests` | Drives `Darkwind.Quests.*` |
| `achievements` | Drives `Darkwind.Achievements.*` |
| `cyberware` | Drives `Darkwind.Cyberware.List` and its detail/image flow |

The client also sends visibility keys for local or self-opening panels such as
`areaMap`, `connection`, `ide`, `fishing`, and `roomPlaylist`. The current
server stores unknown keys but does not use them as push gates.

### `Char.Vitals`

The Vitals panel consumes the standard HP/SP fields and Darkwind-specific
progress fields from `Char.Vitals`.

| Field | Notes |
|-------|-------|
| `hp`, `maxhp` | Current and maximum hit points |
| `sp`, `maxsp` | Current and maximum spell points |
| `level_pct` | Integer percent toward the next player level |
| `carry`, `maxcarry` | Current carried weight and maximum carry capacity |
| `encumberance` | Server-side quadratic encumbrance value |
| `encumberance_pct` | Linear carried-weight percent |
| `encumberance_label` | Human-readable encumbrance state |

### `Darkwind.GuildVitals`

The complete package specification is in
[`gmcp-darkwind-guild-vitals.md`](gmcp-darkwind-guild-vitals.md). The summary
below explains its relationship to panel subscriptions.

The Guild Vitals panel consumes typed guild indicators from
`Darkwind.GuildVitals`. The client advertises `Darkwind.GuildVitals 2` in
`Core.Supports`; servers that understand version 2 reply with an `items`
payload, while version-1 servers (and servers talking to version-1 clients
such as default Mudlet profiles) keep the legacy `bars` payload. The client
accepts both shapes. Mudlet script authors opt into the typed payload by
advertising version `2`.

| Field | Notes |
|-------|-------|
| `items` | Array of typed guild indicators (version 2) |

Every item carries `id` (stable row identity), `guild` (display name, used
for the per-guild section headers), `label`, an optional `kind` (default
`meter`), an optional `severity` (`ok`/`warn`/`danger`, drives color for
non-meter kinds), and an optional `tip` (hover tooltip).

Per-kind fields:

| Kind | Fields | Rendering |
|------|--------|-----------|
| `meter` | `cur`, `max`, `pct` | Left-anchored fill, green-when-full ramp |
| `meter_reverse` | `cur`, `max`, `pct` | Right-anchored fill, red-when-full ramp (heat, intoxication) |
| `boolean` | `on` (0/1) | LED dot, lit color from `severity` |
| `flags` | `flags` array of `{label, on, tip?}` | One row of ordered pips (e.g. firmware flags, blessings) |
| `state` | `value`, `display` | Badge pill showing `display` (falls back to `value`) |
| `counter` | `cur`, `max` (≤ 12) | Filled/empty pip row (stacks, charges) |
| `cooldown` | `remaining` seconds, optional `max` | Countdown text plus a depletion bar when `max` is present; the server re-sends absolute values every tick, the client does not tick locally |

Rows update in place by `id` and stale rows (and their guild headers) are
removed when the server sends a changed list. Headers only appear when items
span more than one guild.

#### Legacy (version 1)

| Field | Notes |
|-------|-------|
| `bars` | Array of guild-specific resource bars |

Each `bars` entry is a mapping with `id`, `guild`, `label`, `cur`, `max`,
`pct`, and optional `kind` (only `warning`, which the client renders as a
reverse meter). This is what version-1 clients receive today, unchanged.

### Features

| Feature | Notes |
|---------|-------|
| `announcementsBadge` | Subscribe to unread-count badge updates (`Darkwind.Announcements.State`/`Update`) |
| `announcementsList` | Request a `Darkwind.Announcements.List` snapshot. The web client sets this to `true` only when the user opens the announcements modal, and clears the flag locally after sending so subsequent subscription messages will not re-request the snapshot |
| `combatPane` | Strict visual-combat readiness. It is `true` only while the initialized Enemy/Combat pane is visible, expanded, and able to present `Darkwind.Combat` events. Unlike legacy panel gates, an absent subscription never implies readiness. |
| `visualEffects` | Subscribe to optional `Darkwind.Visual.State` world ambience and `Darkwind.Visual.Events` combat/spell cues while the local Game visual effects setting is enabled. Low-health presentation is derived from `Char.Vitals`. It never changes terminal-text delivery or `combatPane` readiness. |
| `enemyAutoOpen` | Allow the server to auto-open an enemy panel when combat begins |
| `windows` | Client capability hint for `Darkwind.Window.*` |
| `ide` | Client capability hint for `Darkwind.IDE.*` |
| `completion` | Client capability hint for `Darkwind.Completion.*` |
| `giphy` | Client capability hint for `Darkwind.Giphy.Show` overlays |
| `broadcast` | Client capability hint for `Darkwind.Broadcast.Show` overlays |

The `windows`, `ide`, `completion`, `giphy`, and `broadcast` feature flags are
advertised as `true` by the current client by default; they exist so future
client versions can opt out of these surfaces without dropping the support
declaration. The current Darkwind server stores these hints. It uses
`announcementsBadge`, `announcementsList`, and `enemyAutoOpen` as ordinary
subscription gates. `combatPane` is intentionally stricter: routine combat
prose may be replaced only after the client advertised `Darkwind.Combat 1`
and sent a fresh explicit `combatPane: true` for the current connection. See
[Darkwind.Combat](gmcp-darkwind-combat.md).

### Client Behavior

- The client coalesces panel-visibility changes through a 150 ms debounce timer in `panelManager.syncGmcpSubscriptions` to avoid bursts of subscription messages.
- The client always sends `vitals: true`. When the `buffs` panel is open, the client also forces `status: true`.
- `Char.Status` is treated as sticky state: after the initial full status payload, subsequent delta payloads are merged into the cached status object instead of replacing it.
- The client advertises standard `Comm.Channel 1`, stores `Comm.Channel.List` / `Comm.Channel.Players`, tracks `Comm.Channel.Start` / `Comm.Channel.End` scopes, renders `Comm.Channel.Text`, requests `Comm.Channel.Players` once character data confirms login, and exposes `Comm.Channel.Enable` through the GMCP helper.
- Standard GMCP package names are matched case-insensitively. The client normalizes common cross-MUD aliases before panel rendering, including `mhp`/`mana`/`mmana` vitals, root `Comm.Channel {chan, player, msg}` messages, and `Room.Info.terrain`.
- Darkwind-only features remain under `Darkwind.*`; standard packages should carry broadly useful data and compatibility aliases only.
- Sent automatically on:
  - WebSocket open (`reason: "login"` or `"reconnect"`, `full: true`)
  - Initial panel hydration (`reason: "visibility-sync"`, `full: true`)
  - Each panel open/close (`reason: "panel-open"` / `"panel-close"`, `full: false`)
  - First receipt of `Char.Vitals` or `Char.Status` after login (`reason: "character-login"`, `full: true`), exactly once per session
  - User opening the announcements modal (`reason: "modal-open"`, `features: { announcementsList: true }`)
  - `Ctrl+K` GMCP restart (`reason: "ctrl-k"`, `full: true`)

### Server Behavior

- Stores the latest payload on the player attribute `gmcp_subscriptions`.
- When `full` is truthy, the server re-pushes the full snapshot for every subscribed surface.
- When `full` is falsy, the server diffs the new mapping against the previous mapping and only pushes for surfaces that newly turned on.
- Push helpers (`send_char_vitals`, `send_room_info`, `send_darkwind_divine`, `send_achievements_*`, etc.) consult `query_gmcp_panel_subscription` / `query_gmcp_feature_subscription` before sending.
- A missing panels mapping is treated as "all off"; a missing top-level subscriptions attribute is treated as "all on" so legacy clients remain functional.

## Darkwind.Client.RefreshMedia

Direction: `Client -> Server`

Asks the server to re-push the player's current media payloads (avatar and room image). This is used after the client's WebSocket reconnects, after a `Ctrl+K` handshake reset, and any other moment where the client may have dropped media URLs from local state.

### Schema

The message carries no payload:

```text
Darkwind.Client.RefreshMedia
```

```text
Darkwind.Client.NAWS {"width":120,"height":34}
```

Compliant clients may send an empty JSON object `{}`; the current Darkflow client sends the package name with no payload.

### Server Behavior

- The server re-pushes the current `Darkwind.Char.Avatar` and `Darkwind.Room.Image` payloads through their normal helpers, subject to the corresponding subscription gates.
- Other media surfaces (room images for sub-rooms, etc.) are pushed as part of the same refresh path.

## Darkwind.Client.NAWS

Direction: `Client -> Server`

Reports the active terminal size using NAWS-style width/height semantics. Darkflow measures the visible text pane and sends the current value on connect and whenever the pane resizes. If the player configures a fixed screen width in Darkflow's Terminal settings, Darkflow reports that configured column width while continuing to measure the active pane height.

### Schema

```json
{
  "width": 120,
  "height": 34
}
```

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `width` | integer | Yes | Active terminal columns for wrapping room text, help, inventory, and similar output; measured automatically unless the player configured a fixed Darkflow screen width |
| `height` | integer | Yes | Active terminal rows; tracked for completeness and future pager behavior |

### Server Behavior

- Updates the player/session terminal geometry used by shared output helpers.
- Uses the latest width as the active wrap width for `wrap()`-based output.
- Falls back to the legacy default width if no NAWS data is available.

## Transport

GMCP frames are sent as:

```text
PackageName JSONPayload
```

Or, for messages with no payload:

```text
PackageName
```

Examples:

```text
Darkwind.Client.Subscriptions {"reason":"panel-open","full":false,"panels":{"vitals":true,"status":true,"buffs":false,"omens":true},"features":{"announcementsBadge":true,"enemyAutoOpen":true,"windows":true,"ide":true,"completion":true,"giphy":true}}
```

```text
Darkwind.Client.RefreshMedia
```
