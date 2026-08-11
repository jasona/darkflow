# Darkflow Client Docs

This directory documents the Darkflow browser and desktop clients, their GMCP
protocol support, and the embedded MCP test harness. The live implementation in
`public/js/` is the source of truth when protocol and historical design notes
disagree.

## GMCP Index

Start with the [Darkflow GMCP Package Index](gmcp-darkwind-index.md). It mirrors
the current `Core.Supports.Set` handshake and links every standard and
Darkwind-specific package to its supporting documentation.

### Standard GMCP

| Document                             | Coverage                                                     |
| ------------------------------------ | ------------------------------------------------------------ |
| [Core](gmcp-core.md)                 | Hello, support negotiation, ping, and reset behavior         |
| [Char](gmcp-char.md)                 | Vitals, status, stats, worth, enemy, inventory, and defences |
| [Room](gmcp-room.md)                 | Room metadata, exits, mapping input, and player presence     |
| [Comm](gmcp-comm.md)                 | Channel messages, channel state, and player roster           |
| [Group and Game](gmcp-group-game.md) | Group member state plus game name/version/uptime             |

### Darkwind GMCP Extensions

| Document                                          | Coverage                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Client](gmcp-darkwind-client.md)                 | Subscriptions, terminal geometry, and media refresh                                                                |
| [Character avatar](gmcp-darkwind-char-avatar.md)  | Character image pushes                                                                                             |
| [Visual effects](gmcp-darkwind-visual.md)         | Optional planet/terrain ambience, combat and spell cues, low-health presentation, and allowlisted builder previews |
| [Room image](gmcp-darkwind-room-image.md)         | Room image pushes and preload behavior                                                                             |
| [Divine](gmcp-darkwind-divine.md)                 | Patron, pressure, omens, and divine events                                                                         |
| [Sky](gmcp-darkwind-sky.md)                       | Game time, sky stages, moons, and world bodies                                                                     |
| [Guild vitals](gmcp-darkwind-guild-vitals.md)     | Typed v2 guild indicators and v1 bar compatibility                                                                 |
| [XP Monitor](gmcp-darkwind-xpmon.md)              | XP/gold session totals and rates                                                                                   |
| [Window](gmcp-darkwind-window.md)                 | Server-driven windows, forms, updates, and responses                                                               |
| [Snoop](gmcp-darkwind-snoop.md)                   | Builder graphical snoop sessions                                                                                   |
| [IDE](gmcp-darkwind-ide.md)                       | Single-frame and chunked file open/save flow                                                                       |
| [MapData2](gmcp-darkwind-mapdata-v2.md)           | Server-authoritative map sync, browse, reset, and errors                                                           |
| [Completion](gmcp-darkwind-completion.md)         | Server-authoritative Tab completion                                                                                |
| [Quests](gmcp-darkwind-quests.md)                 | Quest lists, active state, progress, and completion                                                                |
| [Achievements](gmcp-darkwind-achievements.md)     | Achievement snapshots and updates                                                                                  |
| [Announcements](gmcp-darkwind-announcements.md)   | Announcement inbox and read state                                                                                  |
| [Giphy](gmcp-darkwind-giphy.md)                   | Transient GIF overlays                                                                                             |
| [Sound](gmcp-darkwind-sound.md)                   | Audio events, categories, loops, and volume behavior                                                               |
| [Broadcast](gmcp-darkwind-broadcast.md)           | High-priority broadcast overlay                                                                                    |
| [Linux Rescue](gmcp-darkwind-linux-rescue.md)     | Local privacy-screen terminal                                                                                      |
| [Lag](gmcp-darkwind-lag.md)                       | Server driver-health request/response                                                                              |
| [Fishing](gmcp-darkwind-fishing.md)               | Interactive fishing session protocol                                                                               |
| [Cyberware](gmcp-darkwind-cyberware.md)           | Implant list, detail, and image flow                                                                               |
| [Street Samurai](gmcp-darkwind-street-samurai.md) | Live Cortex dashboard state and window lifecycle                                                                   |
| [Room playlist](gmcp-darkwind-room-playlist.md)   | Shared room jukebox state, actions, and reports                                                                    |

The [legacy MapData v1 document](gmcp-darkwind-mapdata.md) is historical. The
current client advertises and implements MapData2 only.

## MCP Test Harness

These documents cover the embedded relay that lets an LLM or CLI drive a MUD:

| Document                                | Coverage                                                 |
| --------------------------------------- | -------------------------------------------------------- |
| [MCP overview](mcp.md)                  | Tools, output framing, transport modes, and client setup |
| [MCP CLI](mcp-cli.md)                   | `send`, `state`, and `run` command reference             |
| [MCP test scripts](mcp-test-scripts.md) | YAML/JSON step and expectation format                    |

## Architecture And Historical Design

| Document                                                   | Coverage                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Session and configuration domain model](session-model.md) | Phase 1 persisted profiles, shared configuration sets, and session boundary |
| [Darkwind desktop client](desktop.md)                      | Electron architecture, packaging, updates, Steam depots, and releases       |
| [Curated backgrounds](backgrounds.md)                      | Preset catalog, ultrawide tiling, persistence, and asset requirements       |
| [Web client blueprint](BLUEPRINT-webclient.md)             | Original transport and browser-client design                                |
| [Web client plan](PLAN-webclient.md)                       | Original implementation and deployment plan                                 |
| [RFC 2549 debug](rfc2549-debug.md)                         | Debug surface for the optional RFC 2549 transport mode                      |

The blueprint and plan contain historical decisions. Prefer current modules,
tests, and package docs for present behavior.

## Documentation Maintenance

When adding or changing GMCP behavior:

1. Update the support declaration and implementation together.
2. Update the relevant package page and this index if package coverage changes.
3. Run `npm test`; the GMCP documentation test checks advertised package
   coverage and local documentation links.
