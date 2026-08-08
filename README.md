# Darkflow

Darkflow is the official web and desktop client for Darkwind. It is a fast, terminal-first WebSocket client with Darkwind-specific panels, mapping, media, builder tools, settings, and GMCP integrations layered around the live MUD session.

The app is intentionally lightweight: Express serves static files, the browser connects directly to the MUD over WebSocket, and the legacy frontend is native ES modules with no build required for the default web or Electron experience. During the Phase 0 migration, an opt-in Vite build proves the future production artifact without changing those defaults. Electron packages the legacy server and frontend for Windows, macOS, Linux, and Steam without creating a separate client fork.

## What Darkflow Supports

- **Direct WebSocket play**: browser-native `WebSocket` connects to the game server; the Node server does not proxy MUD traffic.
- **ANSI terminal rendering**: persistent ANSI parser for SGR colors/styles, split escape sequences, URL links, highlights, Giphy replay controls, scrollback virtualization, pause mode, and split history/live mode.
- **Connection resilience**: client version fetch before connect, auto-reconnect, stalled-socket watchdog, byte counters, diagnostics via `window.wsDebug`, and Ctrl+K full GMCP/media resync.
- **Dockable interface**: left/right sidebars, floating panels, drag/drop ordering, snapping, collapse/close controls, mobile panel sheet, and persisted panel layout.
- **Curated backgrounds**: selectable workspace artwork repeats horizontally for standard, ultrawide, and super-ultrawide displays.
- **Player panels**: avatar, status, vitals, worth, stats, room, room image, group, inventory, enemy, chat, quests, achievements, and dynamic server-driven panels.
- **Map system**: generic `Room.Info` learning plus server-authoritative `Darkwind.MapData2 2` sync, area browsing, safe speedwalk verification, and tile-based rendering.
- **Server-driven windows**: `Darkwind.Window` modals/panels for login and in-game UI, including forms, buttons, updates, submits, actions, and close notifications.
- **Builder IDE**: `Darkwind.IDE` opens files in the browser, supports save/compile feedback, diagnostics, and close notifications.
- **Command ergonomics**: command history, optional history-based Tab completion, server-authoritative completion, aliases, triggers, custom key mappings, and highlight rules.
- **Announcements and media**: announcement inbox with unread state, Giphy popups, avatar media, room imagery, and media refresh support.
- **Portable settings**: settings, aliases, highlights, triggers, and panel layouts can be exported/imported as JSON.
- **Darkflow branding**: app icon, favicons, manifest, About modal, and hidden brand asset page at `/darkflow-brand.html`.
- **LLM test harness (MCP)**: an embedded MCP relay at `/mcp` lets an LLM (Claude Code, Codex) drive the MUD — connect, run commands, assert on output/GMCP, and run scripted pass/fail tests. See [docs/mcp.md](docs/mcp.md).

## How It Works

```
Browser  --WebSocket-->  Darkwind game server, usually darkwind.ai:4242
Browser  --HTTP-->       Darkflow static app, usually localhost:3000
Desktop --loopback-->    The same Darkflow server and static app inside Electron
```

Darkflow identifies itself in GMCP as:

```json
{ "client": "Darkflow", "version": "<runtime version>" }
```

In the default legacy and development modes, the version comes from
`public/version.json`. The opt-in built mode uses `dist/client/version.json`,
which is generated from `package.json`; the custom protocol packages remain
`Darkwind.*` for compatibility.

## Quick Start

Requires [Node.js](https://nodejs.org/) 22.15.0+.

```bash
git clone https://github.com/jasona/darkflow.git
cd darkflow
npm install
npm start
```

Open `http://localhost:3000`. If no host is configured by the server, enter the MUD host and port manually and click **Connect**.

To launch the desktop client during development:

```bash
npm run desktop
```

See [Darkwind Desktop Client](docs/desktop.md) for native packages, GitHub
auto-updates, signing, versioned releases, and Steam depot builds.

### Opt-in built client

Phase 0 also provides a production-artifact path for verification:

```bash
npm run build
npm run start:built
```

This serves only the validated files under `dist/client/`. Missing or invalid
built output is an intentional startup failure; run `npm run build` to
regenerate it. `npm start` still serves `public/` directly and does not require
a build, and Electron remains on that legacy path.

## Configuration

The Express server serves static files and exposes `/config.json` and `/api/version`.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port for Darkflow |
| `HOST` | all interfaces | Optional HTTP bind address, such as `127.0.0.1` |
| `MUD_HOST` | empty | Default host shown in the toolbar; if set, the client auto-connects |
| `MUD_PORT` | `4242` | Default MUD port |
| `MUD_WSS` | enabled | Set to `0` to default to plain `ws://` |
| `GAME_NAME` | empty | Optional game name appended to the browser title |
| `MCP_ENABLED` | `1` | Set to `0` to not mount the MCP relay at `/mcp` |
| `MCP_PATH` | `/mcp` | Route the MCP relay is served on (use a long random path in production) |
| `MCP_AUTH_TOKEN` | empty | If set, MCP clients must send `Authorization: Bearer <token>` |
| `DARKFLOW_LOG_DIR` | `./log` | Proxy log directory; Electron sets this to per-user app data |

The runtime client version is returned by `/api/version` with
`Cache-Control: no-store`. Legacy and development serving read
`public/version.json`; built serving reads the generated
`dist/client/version.json`.

## MCP / MUD test harness

Starting the web client also exposes an **MCP relay** at `/mcp` on the same port,
so an LLM (Claude Code, Codex, …) can drive a MUD: connect, log in, send commands,
read framed output, assert on GMCP state, and run scripted pass/fail tests. The
target MUD is chosen per connection, so it works against any MUD — not just Darkwind.

```bash
npm start        # serves the client AND http://localhost:3000/mcp
```

A standalone CLI (`mud-test-mcp/cli.js`) runs the same checks for manual smoke
tests and CI.

- Overview, tools, wiring, and client (Claude Code / Codex) setup — [docs/mcp.md](docs/mcp.md)
- CLI reference — [docs/mcp-cli.md](docs/mcp-cli.md)
- Test-script (YAML) format — [docs/mcp-test-scripts.md](docs/mcp-test-scripts.md)

Disable with `MCP_ENABLED=0`; secure a public deployment with a hidden `MCP_PATH`
and an `MCP_AUTH_TOKEN` bearer token.

## Docker

```bash
docker build -t darkflow-client .
docker run -p 3000:3000 darkflow-client
```

## Project Layout

```
.
├── server.js                    # Express server with legacy, development, and opt-in built modes
├── desktop/                     # Electron main/preload, updater, and release helpers
├── public/
│   ├── index.html               # Darkflow app shell
│   ├── darkflow-brand.html      # Hidden brand asset download page
│   ├── site.webmanifest         # PWA/app metadata
│   ├── version.json             # Runtime client version
│   ├── assets/
│   │   ├── backgrounds/         # Curated seamless workspace backgrounds and thumbnails
│   │   ├── brand/               # Darkflow logos, favicons, app icons
│   │   ├── tiles/               # Terrain and player map tiles
│   │   └── login-background.jpg
│   ├── css/
│   │   ├── main.css             # App shell, toolbar, settings, terminal chrome
│   │   ├── panels.css           # Dock columns, panel widgets, map styling
│   │   ├── windows.css          # Server-driven modal/window styles
│   │   └── ide.css              # Browser IDE styles
│   └── js/
│       ├── app.js               # App init, status bar, toolbar wiring
│       ├── brand.js             # Darkflow product constants
│       ├── about-modal.js       # Top-left icon About modal
│       ├── connection.js        # WebSocket lifecycle, watchdog, reconnect
│       ├── gmcp.js              # GMCP bus, handshake, subscriptions
│       ├── output.js            # Terminal output, scrollback, replay controls
│       ├── input.js             # Command input, history, shortcuts
│       ├── settings-manager.js  # Settings, import/export, aliases/triggers/highlights UI
│       ├── panel-manager.js     # Panel lifecycle, layout, GMCP panel handlers
│       ├── panel-renderers.js   # Built-in panel renderers
│       ├── map-data-v2.js       # Server-authoritative map sync and browse state
│       ├── map-renderer.js      # Tile map renderer
│       ├── window-manager.js    # Darkwind.Window renderer
│       ├── ide-manager.js       # Darkwind.IDE GMCP bridge
│       ├── ide-editor.js        # Browser code editor
│       ├── completion.js        # Local/server Tab completion
│       ├── announcements-manager.js
│       └── giphy-manager.js
├── scripts/                     # Build artifact generation and validation commands
├── dist/client/                 # Ignored, generated built-client artifact
├── docs/                        # GMCP protocol + MCP/test-harness documentation
├── mud-test-mcp/                # MCP relay + CLI MUD test harness (see docs/mcp.md)
├── Dockerfile
├── package.json
└── CLAUDE.md
```

## GMCP Packages

Darkflow supports standard `Core`, `Char`, `Room`, `Comm`, `Group`, and `Game`
families plus Darkwind-specific panels, media, mapping, builder tools, windows,
completion, connection diagnostics, fishing, cyberware, the Street Samurai
Cortex dashboard, and shared-room media.

The [Darkflow GMCP Package Index](docs/gmcp-darkwind-index.md) is the canonical,
handshake-aligned catalog. It lists every advertised support string and links
to message schemas and client behavior for each package. The
[`docs/` landing page](docs/README.md) also groups the protocol pages by
standard and Darkwind-specific families.

The legacy `Darkwind.MapData 1` package is retired. Current mapping uses
`Darkwind.MapData2 2`.

## Brand Assets

The current Darkflow logo/icon exports live under `public/assets/brand/`.

Open `/darkflow-brand.html` in a running local or deployed client to view and download:

- horizontal logo
- compact logo
- standalone mark
- wordmark
- app icon
- favicon source
- 512/256/192/180/128/64/32/16 icon exports

The generated source sheet is stored as `Gemini_Generated_Image_itemzcitemzcitem.jpeg`.

## Development Notes

- No frontend build step is required for `npm start` or Electron; edit legacy files in `public/` directly.
- Run `npm run build` before `npm run start:built`; the build rewrites and validates `dist/client/version.json` from `package.json`.
- Keep `/api/version` aligned with the selected client root: `public/version.json` for legacy/development and generated `dist/client/version.json` for built mode. The client uses it for update detection and GMCP `Core.Hello`.
- Keep the visible product name as **Darkflow**, but do not rename existing `Darkwind.*` GMCP packages without a coordinated server compatibility plan.
- The settings export format remains `darkwind-client-settings-export` for backward compatibility, even though download filenames now use `darkflow-settings-...json`.
- Keep browser game audio behind `sound-manager.js` and `howler-audio-engine.js`; the server exposes the pinned Howler core runtime at `/vendor/howler.core.min.js` for both web and Electron clients.
- Use `window.wsDebug.snapshot()` and `window.wsDebug.exportAll()` for connection diagnostics.
- Use `window.mapDebug.summary()`, `window.mapDebug.exportAll()`, and `window.mapDebug.clearData()` for map diagnostics.

## Browser Support

Chrome 90+, Firefox 90+, Safari 15+, Edge 90+ with native WebSocket support.

Desktop packages target current supported releases of Windows, macOS, and
mainstream x64 Linux distributions.

## License

`darkflow-client` is released under the [Unknown](LICENSE).

This package includes or depends on third-party components under their own
licenses:

| Dependency | License |
| --- | --- |
| [Electron](https://github.com/electron/electron) | MIT |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT |
| [express](https://github.com/expressjs/express) | MIT |
| [howler.js](https://howlerjs.com/) | MIT |
| [ws](https://github.com/websockets/ws) | MIT |
