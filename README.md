# Darkflow

Darkflow is the official web and desktop client for Darkwind. It is a fast, terminal-first WebSocket client with Darkwind-specific panels, mapping, media, builder tools, settings, and GMCP integrations layered around the live MUD session.

The app is intentionally lightweight: Express serves static files, the browser connects directly to the MUD over WebSocket, and most of the runtime remains native ES modules under `public/js/`. A small Vite-built root bootstrap in `client/` now owns startup for both development and release artifacts; the legacy module graph is still loaded at runtime from copied `public/` output, not bundled into the bootstrap.

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

In the default development mode, the version comes from
`public/version.json`. Built and release modes use `dist/client/version.json`,
which is generated from `package.json` during `npm run build`; the custom
protocol packages remain `Darkwind.*` for compatibility.

## Build System and Release Workflow

If you are cutting a release and were not involved in the Phase 1 migration,
read this section first. The player-visible UI is unchanged, but **how the app
starts and what ships in production changed**.

### Architecture in one paragraph

The visible shell HTML lives in `client/index.html`. At page load, a generated
root bundle (built from `client/app/bootstrap.ts`) runs first, proves it passed
through the Typia transform, then dynamically imports the unchanged legacy entry
at `/js/app.js`. CSS, images, audio, and the rest of the game client still live
under `public/` and are copied into `dist/client/` at build time — they are not
converted to TypeScript and are not bundled into the root bootstrap. A separate
Phase 0 harness at `/phase0/` is another Vite entry used for migration work;
it is not the main game shell.

```text
Development (npm run dev)
  client/index.html  --Vite transform-->  /app/bootstrap.ts  --runtime import-->  public/js/app.js

Production / release (npm run build)
  dist/client/index.html  -->  dist/client/assets/root-*.js  -->  dist/client/js/app.js
```

### Three ways to run the client

| Command                                      | When to use                                            | Root HTML                                   | Legacy JS/CSS              | Build required?                                        |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- | -------------------------- | ------------------------------------------------------ |
| `npm run dev`                                | Day-to-day UI and server work                          | Vite-transformed `client/index.html` at `/` | Served from `public/`      | No                                                     |
| `npm run build` then `npm start`             | Production-like web server locally, CI, Docker runtime | Generated `dist/client/index.html`          | Copied into `dist/client/` | Yes                                                    |
| `npm run desktop` or any `desktop:*` command | Electron development or packaging                      | Same built artifact as `npm start`          | Copied into `dist/client/` | Yes — every desktop command runs `npm run build` first |

**Important:** `npm start` defaults to **built** mode. It serves `dist/client/` and
refuses to start if that artifact is missing or invalid. It does **not** fall back
to raw `public/` files. For local iteration without a build step, use
`npm run dev`.

Development still exposes Vite HMR for `/phase0/` and transforms the root
bootstrap on the shared Express origin. Production, Docker, and packaged Electron
expose only the generated files under `dist/client/` — no raw `.ts`, no
`/@vite/client`, and no `public/` or `client/` source trees.

### What `npm run build` produces

`vite build` writes the release artifact to `dist/client/`:

- `index.html` — generated shell; references a hashed `assets/root-*.js` bundle, not `/js/app.js` or `.ts` directly
- `assets/root-*.js` — root bootstrap with Typia-transformed startup code and the runtime `/js/app.js` handoff
- `phase0/` — isolated Phase 0 harness bundle (separate Vite input)
- `js/`, `css/`, `assets/`, and the rest of `public/**` — byte-copied legacy runtime files (`public/index.html` no longer exists in source)
- `version.json` — `{ "version": "<package.json version>" }`, written by the postbuild step

The postbuild hook also runs validation gates that must pass before the artifact
is considered releasable:

- `verify:bundle` — fails if any shipped JavaScript still contains untransformed Typia factory code
- `verify:client-artifact` — fails if the root entry bypasses the generated bootstrap, if Phase 0 or public-file parity checks fail, or if `version.json` does not match `package.json`

Run `npm run build` explicitly before `npm start`, Docker image builds that
expect a prebuilt tree, or any manual inspection of `dist/client/`. CI and
`npm run desktop:*` already invoke it.

### Where to edit what

| You want to change…                                   | Edit…                                                |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Toolbar, terminal shell, DOM structure, favicon links | `client/index.html`                                  |
| Game logic, panels, connection, GMCP handlers         | `public/js/**` (same as before)                      |
| Styles and static assets                              | `public/css/**`, `public/assets/**`                  |
| Root startup / future multi-connection bootstrap      | `client/app/**` (TypeScript, linted and typechecked) |
| Phase 0 harness only                                  | `client/phase0/**`                                   |

Do not recreate `public/index.html`; the root entry moved to `client/index.html`
on purpose so Vite owns startup without bundling the entire legacy graph.

### Web release checklist

1. Bump the version with `npm run version:set -- <version>` (keeps `package.json`, lockfile, and `public/version.json` aligned).
2. On the pinned toolchain (`nvm use && npm ci`), run the quality gates you normally use before merge (`npm test`, browser tests, etc.).
3. Run `npm run build` and confirm postbuild validation succeeds.
4. Deploy the server plus the **`dist/client/` artifact**. Docker builds and validates this artifact inside the image; its runtime image contains no `public/`, `client/`, Vite, or test sources.

Browser clients detect updates via `/api/version`, which reads `dist/client/version.json` in built mode.

### Desktop and Docker releases

- **Desktop:** every `npm run desktop:*` command rebuilds and validates `dist/client/` before packaging. Unpacked and packaged Electron builds load the same generated root as production web — not raw `public/`. Tagging, installers, auto-update metadata, and platform-specific release steps are documented in [docs/desktop.md](docs/desktop.md).
- **Docker:** `docker build` runs `npm run build` in a builder stage and copies only `dist/client/` into the runtime image. See the [Docker](#docker) section below.

### Common release mistakes

- Running `npm start` or shipping Docker/Electron without a fresh `npm run build` → intentional startup failure or stale UI.
- Editing or expecting `public/index.html` → that file was removed; use `client/index.html`.
- Assuming development HMR or raw TypeScript routes exist in production → they do not; only generated assets ship.
- Bumping `package.json` without rebuilding → `dist/client/version.json` and GMCP `Core.Hello` stay stale until the next successful build.

## Quick Start

Requires [Node.js](https://nodejs.org/) 22.15.0+.

```bash
git clone https://github.com/jasona/darkflow.git
cd darkflow
nvm use          # Node 22.15.0 — required by package.json engines
npm ci
npm run dev      # development server with Vite-transformed root at /
```

Open `http://localhost:3000`. If no host is configured by the server, enter the MUD host and port manually and click **Connect**.

For a production-like local server (what Docker and deployment use), build first:

```bash
npm run build
npm start
```

To launch the desktop client during development:

```bash
npm run desktop
```

See [Darkwind Desktop Client](docs/desktop.md) for native packages, GitHub
auto-updates, signing, versioned releases, and Steam depot builds.

### Production start

This is the same **built** mode used by deployment and `npm start` without
`--dev`. See [Build System and Release Workflow](#build-system-and-release-workflow) for what the artifact contains.

```bash
npm run build
npm start
```

`npm start` serves the validated files under `dist/client/`. Missing or invalid
built output is an intentional startup failure; run `npm run build` to
regenerate it. Use `npm run dev` for development with Vite-transformed root
HTML at `/` and HMR at `/phase0/`. Electron desktop commands build and
serve `dist/client/` as well.

## Configuration

The Express server serves static files and exposes `/config.json` and `/api/version`.

| Variable           | Default        | Description                                                             |
| ------------------ | -------------- | ----------------------------------------------------------------------- |
| `PORT`             | `3000`         | HTTP port for Darkflow                                                  |
| `HOST`             | all interfaces | Optional HTTP bind address, such as `127.0.0.1`                         |
| `MUD_HOST`         | empty          | Default host shown in the toolbar; if set, the client auto-connects     |
| `MUD_PORT`         | `4242`         | Default MUD port                                                        |
| `MUD_WSS`          | enabled        | Set to `0` to default to plain `ws://`                                  |
| `GAME_NAME`        | empty          | Optional game name appended to the browser title                        |
| `MCP_ENABLED`      | `1`            | Set to `0` to not mount the MCP relay at `/mcp`                         |
| `MCP_PATH`         | `/mcp`         | Route the MCP relay is served on (use a long random path in production) |
| `MCP_AUTH_TOKEN`   | empty          | If set, MCP clients must send `Authorization: Bearer <token>`           |
| `DARKFLOW_LOG_DIR` | `./log`        | Proxy log directory; Electron sets this to per-user app data            |

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

The multi-stage image builds and validates `dist/client/` inside the builder.
Its production-only runtime contains the server, runtime libraries, and built
client, but not `public/`, client source, tests, or Vite.

Deterministic connection coverage is available without contacting Darkwind:

```bash
npm run test:transports  # built Chromium against local ws/wss/telnet/telnets fixtures
npm run test:mcp         # clean install and test of the separately owned MCP harness
```

## Project Layout

```
.
├── server.js                    # Express server with legacy, development, and opt-in built modes
├── desktop/                     # Electron main/preload, updater, and release helpers
├── client/
│   ├── index.html               # Vite-transformed Darkflow app shell
│   ├── app/
│   │   └── bootstrap.ts         # Root bootstrap with Typia transform proof
│   └── phase0/                  # Phase 0 harness (Typia, HMR, Dockview)
├── public/
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

- Use `npm run dev` for day-to-day work; it serves a Vite-transformed root at
  `/` while legacy assets and modules remain under `public/`. HMR for the Phase 0
  harness is at `/phase0/`.
- `npm start`, packaged Electron, and Docker require a freshly built,
  validated `dist/client/` artifact and do not carry a `public/` fallback.
  See [Build System and Release Workflow](#build-system-and-release-workflow).
- Run `npm run build` before `npm start` or any release packaging; the build
  rewrites and validates `dist/client/version.json` from `package.json`.
- Keep `/api/version` aligned with the selected client root: `public/version.json`
  for development and generated `dist/client/version.json` for built mode. The
  client uses it for update detection and GMCP `Core.Hello`.
- Keep the visible product name as **Darkflow**, but do not rename existing `Darkwind.*` GMCP packages without a coordinated server compatibility plan.
- The settings export format remains `darkwind-client-settings-export` for backward compatibility, even though download filenames now use `darkflow-settings-...json`.
- Keep browser game audio behind `sound-manager.js` and `howler-audio-engine.js`; the server exposes the pinned Howler core runtime at `/vendor/howler.core.min.js` for both web and Electron clients.
- Use `window.wsDebug.snapshot()` and `window.wsDebug.exportAll()` for connection diagnostics.
- Use `window.mapDebug.summary()`, `window.mapDebug.exportAll()`, and `window.mapDebug.clearData()` for map diagnostics.

## Browser Support

Chrome 111+, Edge 111+, Firefox 114+, Safari 16.4+ with native WebSocket
support (Vite 8 `baseline-widely-available` default).

Desktop packages target current supported releases of Windows, macOS, and
mainstream x64 Linux distributions.

## License

`darkflow-client` is released under the [Unknown](LICENSE).

This package includes or depends on third-party components under their own
licenses:

| Dependency                                                                | License |
| ------------------------------------------------------------------------- | ------- |
| [Electron](https://github.com/electron/electron)                          | MIT     |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT     |
| [express](https://github.com/expressjs/express)                           | MIT     |
| [howler.js](https://howlerjs.com/)                                        | MIT     |
| [ws](https://github.com/websockets/ws)                                    | MIT     |
