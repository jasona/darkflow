# Phase 1 GMCP Package Inventory

This document lists every GMCP package name currently registered by a
`public/js/*` consumer. Status is derived from
`client/gmcp/contracts/validators.ts` exports `modeledGmcpPackageNames` and
`unmodeledGmcpPackageNames` so the table cannot drift from the validator
registrations.

**Modeled** packages have an inbound `lookupGmcpValidator()` entry (Step 7
Core/Char/Room/Comm families plus Step 8 Darkwind Window/IDE/MapData2/Session
families). **Unmodeled** packages pass through the legacy wildcard handler
until their owning Phase 2 panel port adds a typed contract.

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

## Phase 2 owners

Each unmodeled row above becomes a typed contract when its owning panel or
controller is ported in Phase 2. Step 16 will assign explicit owners during the
interface freeze.
