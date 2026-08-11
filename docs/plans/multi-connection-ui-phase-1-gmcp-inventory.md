# Phase 1 GMCP Package Inventory

This document lists every GMCP package name currently registered by a
`public/js/*` consumer. Status is derived from
`client/gmcp/contracts/validators.ts` exports `modeledGmcpPackageNames` and
`unmodeledGmcpPackageNames` so the table cannot drift from the validator
registrations.

**Modeled** packages have an inbound `lookupGmcpValidator()` entry (Step 7
Core/Char/Room/Comm families plus Step 8 Darkwind Window/IDE/MapData2/Session
families). **Unmodeled** packages pass through the legacy wildcard handler
until their owning Phase 2 panel port adds a typed contract. Modeled validation
is advisory for the Phase 1 compatibility path: invalid payloads are diagnosed
and still delivered to existing wildcard and package-specific handlers.

Outbound-only packages typed in Step 8 contract files
(`Darkwind.Window.Submit`, `Darkwind.IDE.Save`, `Darkwind.Client.NAWS`, etc.)
are not registered for inbound dispatch validation per Assumption 3 in the Step 8
plan; callers construct typed objects at send sites in later steps.

## Modeled packages

| Package                        | Direction        | Consumer                                                                                        | Status  |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------- | ------- |
| `Core.Supports.Set`            | Server -> Client | `sound-panel.js`, bus internals                                                                 | modeled |
| `Core.Supports.Add`            | Server -> Client | `sound-panel.js`, bus internals                                                                 | modeled |
| `Core.Supports.Remove`         | Server -> Client | `sound-panel.js`, bus internals                                                                 | modeled |
| `Char.Vitals`                  | Server -> Client | `panel-manager.js`, `visual-effects-manager.js`, `login-theme-manager.js`                       | modeled |
| `Char.Status`                  | Server -> Client | `panel-manager.js`, `notification-manager.js`, `login-theme-manager.js`                         | modeled |
| `Char.StatusVars`              | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Stats`                   | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.RealStats`               | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Worth`                   | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Enemy`                   | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Items.List`              | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Items.Add`               | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Items.Remove`            | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Items.Update`            | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Defences.List`           | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Defences.Add`            | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Char.Defences.Remove`         | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Room.Info`                    | Server -> Client | `panel-manager.js`, `map-speedwalk.js`, `room-playlist-manager.js`, `visual-effects-manager.js` | modeled |
| `Room.Players`                 | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Room.AddPlayer`               | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Room.RemovePlayer`            | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Comm.Channel`                 | Server -> Client | `panel-manager.js`, `notification-manager.js`                                                   | modeled |
| `Comm.Channel.Text`            | Server -> Client | `panel-manager.js`, `notification-manager.js`                                                   | modeled |
| `Comm.Channel.List`            | Server -> Client | `panel-manager.js`, `mention-picker.js`                                                         | modeled |
| `Comm.Channel.Players`         | Server -> Client | `panel-manager.js`, `mention-picker.js`                                                         | modeled |
| `Comm.Channel.Start`           | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Comm.Channel.End`             | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Darkwind.Window.Open`         | Server -> Client | `window-manager.js`                                                                             | modeled |
| `Darkwind.Window.Update`       | Server -> Client | `window-manager.js`                                                                             | modeled |
| `Darkwind.Window.Close`        | Server -> Client | `window-manager.js`                                                                             | modeled |
| `Darkwind.IDE.Open`            | Server -> Client | `ide-manager.js`                                                                                | modeled |
| `Darkwind.IDE.OpenStart`       | Server -> Client | `ide-manager.js`                                                                                | modeled |
| `Darkwind.IDE.OpenChunk`       | Server -> Client | `ide-manager.js`                                                                                | modeled |
| `Darkwind.IDE.OpenFinish`      | Server -> Client | `ide-manager.js`                                                                                | modeled |
| `Darkwind.IDE.SaveResult`      | Server -> Client | `ide-manager.js`                                                                                | modeled |
| `Darkwind.MapData2.Current`    | Server -> Client | `panel-manager.js`, `map-speedwalk.js`                                                          | modeled |
| `Darkwind.MapData2.Area`       | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Darkwind.MapData2.Update`     | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Darkwind.MapData2.Error`      | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Darkwind.MapData2.BrowseArea` | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Darkwind.MapData2.Reset`      | Server -> Client | `panel-manager.js`                                                                              | modeled |
| `Darkwind.Session.Recovered`   | Server -> Client | `tutorial-manager.js`, `visual-effects-manager.js`, `login-theme-manager.js`                    | modeled |

## Unmodeled packages

| Package                           | Direction        | Consumer                              | Status    |
| --------------------------------- | ---------------- | ------------------------------------- | --------- |
| `Core.Hello`                      | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Core.Ping`                       | Server -> Client | `lag-monitor.js`                      | unmodeled |
| `Game`                            | Server -> Client | `app.js`                              | unmodeled |
| `Group`                           | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Char.Avatar`            | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Combat.State`           | Server -> Client | `combat-visual-manager.js`            | unmodeled |
| `Darkwind.Combat.Events`          | Server -> Client | `combat-visual-manager.js`            | unmodeled |
| `Darkwind.Combat.Event`           | Server -> Client | `combat-visual-manager.js`            | unmodeled |
| `Darkwind.Tutorial.State`         | Server -> Client | `tutorial-manager.js`                 | unmodeled |
| `Darkwind.Tutorial.Control`       | Server -> Client | `tutorial-manager.js`                 | unmodeled |
| `Darkwind.Tutorial.Action`        | Server -> Client | `tutorial-manager.js`                 | unmodeled |
| `Darkwind.Tutorial.Resync`        | Server -> Client | `tutorial-manager.js`                 | unmodeled |
| `Darkwind.Visual.State`           | Server -> Client | `visual-effects-manager.js`           | unmodeled |
| `Darkwind.Visual.Events`          | Server -> Client | `visual-effects-manager.js`           | unmodeled |
| `Darkwind.Visual.Event`           | Server -> Client | `visual-effects-manager.js`           | unmodeled |
| `Darkwind.Visual.Preview`         | Server -> Client | `visual-effects-manager.js`           | unmodeled |
| `Darkwind.Room.Image`             | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Divine`                 | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Sky`                    | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.GuildVitals`            | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.XPMon`                  | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Snoop.Open`             | Server -> Client | `snoop-manager.js`                    | unmodeled |
| `Darkwind.Snoop.Append`           | Server -> Client | `snoop-manager.js`                    | unmodeled |
| `Darkwind.Snoop.Status`           | Server -> Client | `snoop-manager.js`                    | unmodeled |
| `Darkwind.Snoop.Close`            | Server -> Client | `snoop-manager.js`                    | unmodeled |
| `Darkwind.Snoop.Command`          | Client -> Server | `snoop-manager.js`                    | unmodeled |
| `Darkwind.Snoop.Stop`             | Client -> Server | `snoop-manager.js`                    | unmodeled |
| `Darkwind.Snoop.Closed`           | Client -> Server | `snoop-manager.js`                    | unmodeled |
| `Darkwind.Completion.Request`     | Client -> Server | `completion.js`                       | unmodeled |
| `Darkwind.Completion.Result`      | Server -> Client | `completion.js`                       | unmodeled |
| `Darkwind.Quests.List`            | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Quests.Active`          | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Quests.Update`          | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Quests.Complete`        | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Achievements.List`      | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Achievements.Update`    | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Announcements.List`     | Server -> Client | `announcements-manager.js`            | unmodeled |
| `Darkwind.Announcements.New`      | Server -> Client | `announcements-manager.js`            | unmodeled |
| `Darkwind.Announcements.Update`   | Server -> Client | `announcements-manager.js`            | unmodeled |
| `Darkwind.Announcements.State`    | Server -> Client | `announcements-manager.js`            | unmodeled |
| `Darkwind.Announcements.MarkRead` | Client -> Server | `announcements-manager.js`            | unmodeled |
| `Darkwind.Giphy.Show`             | Server -> Client | `giphy-manager.js`                    | unmodeled |
| `Darkwind.Sound`                  | Server -> Client | `sound-panel.js`                      | unmodeled |
| `Darkwind.Broadcast.Show`         | Server -> Client | `broadcast-manager.js`                | unmodeled |
| `Darkwind.LinuxRescue.Open`       | Server -> Client | `linux-rescue-manager.js`             | unmodeled |
| `Darkwind.Lag.Get`                | Client -> Server | (support only)                        | unmodeled |
| `Darkwind.Lag.Status`             | Server -> Client | `lag-monitor.js`                      | unmodeled |
| `Darkwind.Fishing.Open`           | Server -> Client | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.Cast`           | Client -> Server | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.Bite`           | Server -> Client | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.Hook`           | Client -> Server | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.Fight`          | Server -> Client | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.Result`         | Server -> Client | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.Caught`         | Server -> Client | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.Escaped`        | Server -> Client | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.Art`            | Server -> Client | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.Cancel`         | Client -> Server | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Fishing.End`            | Server -> Client | `fishing-manager.js`                  | unmodeled |
| `Darkwind.Cyberware.List`         | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Cyberware.Details`      | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.Cyberware.Image`        | Server -> Client | `panel-manager.js`                    | unmodeled |
| `Darkwind.StreetSamurai`          | Server -> Client | `street-samurai-dashboard-manager.js` | unmodeled |
| `Darkwind.Room.Playlist.State`    | Server -> Client | `room-playlist-manager.js`            | unmodeled |
| `Darkwind.Room.Playlist.Open`     | Server -> Client | `room-playlist-manager.js`            | unmodeled |
| `Darkwind.Room.Playlist.Action`   | Client -> Server | `room-playlist-manager.js`            | unmodeled |
| `Darkwind.Room.Playlist.Report`   | Client -> Server | `room-playlist-manager.js`            | unmodeled |

## Counts

- Modeled: see `modeledGmcpPackageNames.length` in `validators.ts` (Step 7 + Step 8 inbound registrations).
- Unmodeled: `unmodeledGmcpPackageNames.length` entries (includes deferred `Group` and `Game` from Step 7).

## Deferred owner ledger

Every package below remains a legacy pass-through until the named consumer port
owns its ingress contract. The direction is intentional: outbound-only entries
are constructed at their send site and do not imply inbound validation work.
Every row has the same Phase 4 deletion gate: remove the corresponding
`public/js` registration and compatibility adapter only after its named Phase 2
port is the production consumer.

| Packages                                                                                                                                                                                                                                                                                  | Direction                                           | Phase 2 owner                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `Core.Hello`                                                                                                                                                                                                                                                                              | Server -> Client                                    | Client-shell and character-summary data port (`panel-manager.js`)     |
| `Core.Ping`, `Darkwind.Lag.Get`, `Darkwind.Lag.Status`                                                                                                                                                                                                                                    | Both; `Darkwind.Lag.Get` outbound-only              | Transport diagnostics and lag-monitor port (`lag-monitor.js`)         |
| `Game`                                                                                                                                                                                                                                                                                    | Server -> Client                                    | Svelte application-shell port (`app.js`)                              |
| `Group`                                                                                                                                                                                                                                                                                   | Server -> Client                                    | Character/group panel data port (`panel-manager.js`)                  |
| `Darkwind.Char.Avatar`, `Darkwind.Room.Image`                                                                                                                                                                                                                                             | Server -> Client                                    | Character and room media panel data port (`panel-manager.js`)         |
| `Darkwind.Combat.State`, `Darkwind.Combat.Events`, `Darkwind.Combat.Event`                                                                                                                                                                                                                | Server -> Client                                    | Combat visual panel port (`combat-visual-manager.js`)                 |
| `Darkwind.Tutorial.State`, `Darkwind.Tutorial.Control`, `Darkwind.Tutorial.Action`, `Darkwind.Tutorial.Resync`                                                                                                                                                                            | Server -> Client                                    | Tutorial panel port (`tutorial-manager.js`)                           |
| `Darkwind.Visual.State`, `Darkwind.Visual.Events`, `Darkwind.Visual.Event`, `Darkwind.Visual.Preview`                                                                                                                                                                                     | Server -> Client                                    | Visual-effects panel port (`visual-effects-manager.js`)               |
| `Darkwind.Divine`, `Darkwind.Sky`, `Darkwind.GuildVitals`, `Darkwind.XPMon`                                                                                                                                                                                                               | Server -> Client                                    | Character-status panel data port (`panel-manager.js`)                 |
| `Darkwind.Snoop.Open`, `Darkwind.Snoop.Append`, `Darkwind.Snoop.Status`, `Darkwind.Snoop.Close`, `Darkwind.Snoop.Command`, `Darkwind.Snoop.Stop`, `Darkwind.Snoop.Closed`                                                                                                                 | Both; `Command`, `Stop`, and `Closed` outbound-only | Snoop window port (`snoop-manager.js`)                                |
| `Darkwind.Completion.Request`, `Darkwind.Completion.Result`                                                                                                                                                                                                                               | Both; `Request` outbound-only                       | Terminal completion port (`completion.js`)                            |
| `Darkwind.Quests.List`, `Darkwind.Quests.Active`, `Darkwind.Quests.Update`, `Darkwind.Quests.Complete`                                                                                                                                                                                    | Server -> Client                                    | Quest panel data port (`panel-manager.js`)                            |
| `Darkwind.Achievements.List`, `Darkwind.Achievements.Update`                                                                                                                                                                                                                              | Server -> Client                                    | Achievement panel data port (`panel-manager.js`)                      |
| `Darkwind.Announcements.List`, `Darkwind.Announcements.New`, `Darkwind.Announcements.Update`, `Darkwind.Announcements.State`, `Darkwind.Announcements.MarkRead`                                                                                                                           | Both; `MarkRead` outbound-only                      | Announcements panel port (`announcements-manager.js`)                 |
| `Darkwind.Giphy.Show`                                                                                                                                                                                                                                                                     | Server -> Client                                    | Giphy panel port (`giphy-manager.js`)                                 |
| `Darkwind.Sound`                                                                                                                                                                                                                                                                          | Server -> Client                                    | Sound-controls port (`sound-panel.js`)                                |
| `Darkwind.Broadcast.Show`                                                                                                                                                                                                                                                                 | Server -> Client                                    | Broadcast panel port (`broadcast-manager.js`)                         |
| `Darkwind.LinuxRescue.Open`                                                                                                                                                                                                                                                               | Server -> Client                                    | Linux-rescue window port (`linux-rescue-manager.js`)                  |
| `Darkwind.Fishing.Open`, `Darkwind.Fishing.Cast`, `Darkwind.Fishing.Bite`, `Darkwind.Fishing.Hook`, `Darkwind.Fishing.Fight`, `Darkwind.Fishing.Result`, `Darkwind.Fishing.Caught`, `Darkwind.Fishing.Escaped`, `Darkwind.Fishing.Art`, `Darkwind.Fishing.Cancel`, `Darkwind.Fishing.End` | Both; `Cast`, `Hook`, and `Cancel` outbound-only    | Fishing panel port (`fishing-manager.js`)                             |
| `Darkwind.Cyberware.List`, `Darkwind.Cyberware.Details`, `Darkwind.Cyberware.Image`                                                                                                                                                                                                       | Server -> Client                                    | Cyberware panel data port (`panel-manager.js`)                        |
| `Darkwind.StreetSamurai`                                                                                                                                                                                                                                                                  | Server -> Client                                    | Street Samurai dashboard port (`street-samurai-dashboard-manager.js`) |
| `Darkwind.Room.Playlist.State`, `Darkwind.Room.Playlist.Open`, `Darkwind.Room.Playlist.Action`, `Darkwind.Room.Playlist.Report`                                                                                                                                                           | Both; `Action` and `Report` outbound-only           | Room-playlist panel port (`room-playlist-manager.js`)                 |
