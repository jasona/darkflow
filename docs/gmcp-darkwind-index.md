# Darkflow GMCP Package Index

This is the canonical documentation index for GMCP support in Darkflow. The
support strings below match the current `Core.Supports.Set` payload in
[`public/js/gmcp.js`](../public/js/gmcp.js). Package-specific pages describe
the messages Darkflow sends, receives, normalizes, and renders.

## Core Protocol

`Core` is part of GMCP negotiation and is not included in the support array.

| Messages | Direction | Documentation |
| --- | --- | --- |
| `Core.Hello`, `Core.Supports.Set`, `Core.Supports.Add`, `Core.Supports.Remove`, `Core.Ping` | Mixed | [Core support](gmcp-core.md) |

## Standard Packages

| Support String | Purpose | Documentation |
| --- | --- | --- |
| `Char 1` | Character namespace support | [Char](gmcp-char.md) |
| `Char.Vitals 1` | Vitals and embedded opponent state | [Char](gmcp-char.md) |
| `Char.Status 1` | Character identity and status deltas | [Char](gmcp-char.md) |
| `Char.StatusVars 1` | Status-variable metadata | [Char](gmcp-char.md) |
| `Char.Stats 1` | Current attributes | [Char](gmcp-char.md) |
| `Char.RealStats 1` | Base attributes | [Char](gmcp-char.md) |
| `Char.Worth 1` | Carried and banked currency | [Char](gmcp-char.md) |
| `Char.Enemy 1` | Current combat target | [Char](gmcp-char.md) |
| `Char.Items 1` | Inventory snapshots and deltas | [Char](gmcp-char.md) |
| `Char.Defences 1` | Buff/debuff snapshots and deltas | [Char](gmcp-char.md) |
| `Room 1` | Room metadata and player presence | [Room](gmcp-room.md) |
| `Comm 1` | Communication namespace support | [Comm](gmcp-comm.md) |
| `Comm.Channel 1` | Channels, messages, and player roster | [Comm](gmcp-comm.md) |
| `Group 1` | Group roster and member vitals | [Group and Game](gmcp-group-game.md) |
| `Game 1` | Game identity, version, and uptime | [Group and Game](gmcp-group-game.md) |

## Darkwind Extensions

The `Darkwind.*` package names remain protocol-stable even though the client is
branded Darkflow.

| Support String | Messages | Direction | Documentation |
| --- | --- | --- | --- |
| `Darkwind.Char.Avatar 1` | `Darkwind.Char.Avatar` | Server -> Client | [Character avatar](gmcp-darkwind-char-avatar.md) |
| `Darkwind.Combat 1` | `State`, `Events`, `Resync` | Mixed | [Visual combat](gmcp-darkwind-combat.md) |
| `Darkwind.Visual 1` | `State`, `Events`, `Preview` | Server -> Client | [Visual effects](gmcp-darkwind-visual.md) |
| `Darkwind.Room.Image 1` | `Darkwind.Room.Image` | Server -> Client | [Room image](gmcp-darkwind-room-image.md) |
| `Darkwind.Divine 1` | `Darkwind.Divine` | Server -> Client | [Divine state](gmcp-darkwind-divine.md) |
| `Darkwind.Sky 1` | `Darkwind.Sky` | Server -> Client | [Sky](gmcp-darkwind-sky.md) |
| `Darkwind.GuildVitals 2` | `Darkwind.GuildVitals` | Server -> Client | [Guild vitals](gmcp-darkwind-guild-vitals.md) |
| `Darkwind.XPMon 1` | `Darkwind.XPMon` | Server -> Client | [XP Monitor](gmcp-darkwind-xpmon.md) |
| `Darkwind.Client.Subscriptions 1` | `Subscriptions`, `RefreshMedia` | Client -> Server | [Client coordination](gmcp-darkwind-client.md) |
| `Darkwind.Client.NAWS 1` | `NAWS` | Client -> Server | [Client coordination](gmcp-darkwind-client.md) |
| `Darkwind.Window 1` | `Open`, `Update`, `Close`, `Submit`, `Action`, `Closed` | Mixed | [Windows](gmcp-darkwind-window.md) |
| `Darkwind.Snoop 1` | `Open`, `Append`, `Status`, `Close`, `Command`, `Stop`, `Closed` | Mixed | [Snoop](gmcp-darkwind-snoop.md) |
| `Darkwind.IDE 2` | Single-frame and chunked open/save messages | Mixed | [IDE](gmcp-darkwind-ide.md) |
| `Darkwind.MapData2 2` | `Current`, `Area`, `Update`, `Sync`, `Browse`, `BrowseArea`, `Reset`, `Error` | Mixed | [MapData2](gmcp-darkwind-mapdata-v2.md) |
| `Darkwind.Completion 1` | `Request`, `Result` | Mixed | [Completion](gmcp-darkwind-completion.md) |
| `Darkwind.Quests 1` | `List`, `Active`, `Update`, `Complete` | Server -> Client | [Quests](gmcp-darkwind-quests.md) |
| `Darkwind.Achievements 1` | `List`, `Update` | Server -> Client | [Achievements](gmcp-darkwind-achievements.md) |
| `Darkwind.Announcements 1` | `List`, `New`, `Update`, `State`, `MarkRead` | Mixed | [Announcements](gmcp-darkwind-announcements.md) |
| `Darkwind.Giphy 1` | `Show` | Server -> Client | [Giphy](gmcp-darkwind-giphy.md) |
| `Darkwind.Sound 1` | Root package | Server -> Client | [Sound](gmcp-darkwind-sound.md) |
| `Darkwind.Broadcast 1` | `Show` | Server -> Client | [Broadcast](gmcp-darkwind-broadcast.md) |
| `Darkwind.LinuxRescue 1` | `Open` | Server -> Client | [Linux Rescue](gmcp-darkwind-linux-rescue.md) |
| `Darkwind.Lag 1` | `Get`, `Status` | Mixed | [Lag](gmcp-darkwind-lag.md) |
| `Darkwind.Fishing 1` | Interactive fishing session messages | Mixed | [Fishing](gmcp-darkwind-fishing.md) |
| `Darkwind.Cyberware 1` | `List`, `Details`, `Image` | Mixed | [Cyberware](gmcp-darkwind-cyberware.md) |
| `Darkwind.StreetSamurai 1` | Root dashboard snapshot | Server -> Client | [Street Samurai](gmcp-darkwind-street-samurai.md) |
| `Darkwind.Room.Playlist 1` | `State`, `Open`, `Action`, `Report` | Mixed | [Room playlist](gmcp-darkwind-room-playlist.md) |

## Historical Packages

`Darkwind.MapData 1` is retired. Darkflow no longer advertises it or registers
its message handlers. Its [historical protocol document](gmcp-darkwind-mapdata.md)
is retained for older clients and migration work; current mapping uses
`Darkwind.MapData2 2`.

## Runtime Inspection

Every received message is available to the wildcard GMCP listener and live
GMCP variable registry, even when no dedicated renderer exists. Use the GMCP
Debug panel for frame inspection. For browser extensions, use the documented
public debug/event surfaces rather than mutating `panelManager.gmcpData`.
