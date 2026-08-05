# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Darkflow, the web-based WebSocket client for the Darkwind LDMud game server (play.darkwind.ai). The client connects to the MUD via WebSocket using the browser-native `WebSocket` API. It supports GMCP over binary WebSocket frames for structured data (panels, mapping, IDE, server-driven windows).

## Architecture

- **Modular vanilla JS** -- native ES modules, no build tools, no frameworks, no client-side dependencies
- **Product identity** -- visible client branding and `Core.Hello.client` identify the app as Darkflow; existing `Darkwind.*` GMCP package names remain protocol-stable
- Express server serves static files from `public/`; does not proxy WebSocket traffic
- The LDMud driver auto-detects WebSocket connections on the same port as telnet (no separate WS port)
- Text frames carry commands (client->server) and game output (server->client) as plain UTF-8 strings
- Binary frames carry GMCP messages (bidirectional) for structured data
- ANSI SGR escape sequences in output are parsed and rendered as styled HTML spans
- 32x32 graphical tile map built collaboratively from all players' exploration data

## Key Modules

- `gmcp.js` -- GMCP event bus, handshake, send/receive
- `ansi.js` -- Stateful ANSI parser (handles partial sequences across messages)
- `output.js` -- Terminal output with requestAnimationFrame batching
- `panel-manager.js` -- Panel lifecycle, drag/drop, edge snapping, GMCP data handlers
- `panel-renderers.js` -- Render functions for each panel type
- `map-data-v2.js` -- Server-authoritative map model (MapData2): room graph + coords from the server, sync/version reconciliation, browse-area store
- `map-renderer.js` -- CSS Grid tile map renderer (32x32 terrain tiles)
- `window-manager.js` -- Server-driven GUI window rendering (Darkwind.Window)
- `ide-manager.js` / `ide-editor.js` -- In-browser code editor (Darkwind.IDE)

## GMCP Extensions

See [`docs/gmcp-darkwind-index.md`](docs/gmcp-darkwind-index.md) for the full,
handshake-aligned protocol catalog. Major extensions include:
- `Darkwind.Window 1` -- Server-driven modals, panels, and forms
- `Darkwind.IDE 2` -- In-browser LPC editor with single-frame and chunked transfers
- `Darkwind.MapData2 2` -- Server-authoritative mapping, browse, reset, and error flow

The V1 `Darkwind.MapData` package is retired and documented only for migration.

## Server-Side Companion (darkwind-nextgen)

The MUD server codebase is at `../darkwind-nextgen/`. Key server-side files for this client:
- `secure/daemons/telopt_d.c` -- GMCP message sending (Room.Info, MapData.Area, Window, IDE)
- `secure/player/telopt.c` -- GMCP message receiving and dispatch
- `secure/daemons/map2_d.c` -- Mapping daemon (MapData2: shared room graph, incremental sticky coordinate placement; legacy `map_d.c` is the retired V1)
- `secure/include/gmcp_defs.h` -- GMCP package/key constants
- `secure/daemons/vrroom.c` -- Virtual room mapping support (query_map_id, query_map_exit_path)

## Key Design Constraints

- Never use non-ASCII characters in any code files (LPC only supports ASCII, and this has caused server crashes)
- The driver source is at `../ldmud/`
- GMCP is delivered via binary WebSocket frames, not telnet subnegotiation
- Must handle partial ANSI sequences spanning message boundaries
- Batch DOM updates via requestAnimationFrame to handle rapid server messages
- Target browsers: Chrome 90+, Firefox 90+, Safari 15+, Edge 90+
- Tile assets served from `public/assets/tiles/` (22 terrain JPGs + 1 player PNG)
