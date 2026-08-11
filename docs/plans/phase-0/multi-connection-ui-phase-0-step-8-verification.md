# Phase 0 Step 8 Verification

## Status

Implementation is complete and the complete local Step 8 gate passes. Hosted CI
remains pending a push, so Step 8 is not recorded as fully complete.

## Environment

- Verification date: 2026-08-07 (America/Detroit)
- Working-tree base commit: `396d26c`
- Implementation state: uncommitted working tree
- Platform: macOS 15.5, Apple Silicon
- Node: `v22.15.0`
- npm: `10.9.2`
- Playwright: `1.62.1`
- Electron: `43.1.1`
- Docker Desktop client/server: `29.4.0`
- Generated client version: `1.5.6`
- Generated artifact files: `296`
- Generated Phase 0 bundle: `dist/client/assets/phase0-D8WtUFKX.js`
- CI URL: not available; the branch was not pushed during this implementation

All npm commands used the repository-pinned Node installation on `PATH`.

## Command results

| Command | Result |
| --- | --- |
| `npm ci` | PASS; 560 packages installed from the lockfile |
| `npm run format:check` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run check` | PASS; 0 errors and 0 warnings |
| `npm test` | PASS; 431 passed, 0 failed, 0 skipped |
| `node --test test/client-artifact.test.js` | PASS; 15 passed |
| `npm run build` | PASS; 222 modules transformed and postbuild validation passed |
| `npm run verify:client-artifact` | PASS; runtime artifact and source parity validated at `1.5.6` |
| `npm run test:server:built` | PASS; built lifecycle and source-free restart verified |
| Desktop package/runtime unit tests | PASS; 22 passed |
| `npm run desktop:smoke` | PASS; built source-checkout smoke exited zero |
| `npm run desktop:pack` | PASS; unpacked macOS ASAR validated with 296 client files |
| `npm run desktop:smoke:packaged` | PASS; packaged ASAR-owned runtime exited zero |
| `npm run test:browser` | PASS; 19 passed across Chromium, Firefox, WebKit, and mobile Chromium |
| `npm run test:browser:production` | PASS; 1 Chromium production smoke passed |
| `npm run test:transports` | PASS; certificate plus `ws`, `wss`, `telnet`, and `telnets` passed |
| `npm run test:mcp` | PASS; clean nested install, 3 passed |
| Default start/Electron script invariant | PASS; `npm start` and `npm run desktop` remain legacy |
| CI workflow YAML parse | PASS |
| `git diff --check` | PASS |
| `docker build --tag darkflow:phase0-step8 .` | PASS; clean builder produced and validated the client artifact |
| Docker runtime file/dependency inventories | PASS; source-free production runtime contains only required surfaces |
| Docker missing-artifact negative startup | PASS; exited 1 with `ERR_CLIENT_ARTIFACT_INVALID` guidance |
| Docker startup and built-only HTTP/static probes | PASS; 13 expected status/content contracts verified |

## Verified behavior

- Runtime artifact validation is source-independent, while the build verifier
  still requires every `public/` source file to be present with identical bytes.
- Built server startup and restart work from a temporary runtime containing
  `server.js`, `lib/`, package metadata, dependencies, and `dist/client/`, with
  no `public/` tree.
- Unpackaged `npm run desktop` remains legacy. Source smoke and packaged
  Electron select built mode, use the built icon, and do not fall back to
  `public/`.
- Source and packaged Electron smoke verify the single HttpOnly desktop token,
  frozen four-method preload surface, product/version/distribution/updater
  state, Howler, configuration, icon, Phase 0 entry, and absent Vite source/HMR
  routes. They report no page, console, same-origin request, or WebSocket
  failures and never contact the live MUD.
- The unpacked macOS package is
  `dist/desktop/mac-arm64/Darkwind.app`. Its ASAR contains all 296 built-client
  files and required desktop/server/runtime files, with no source-client,
  build-script, configuration, or test fallback.
- Electron Builder does not emit `app-update.yml` for a directory-only macOS
  target. For that layout the package validator verifies the equivalent active
  `build.publish` GitHub provider/owner/repository contract; installer/release
  targets retain generated updater-metadata validation.
- The local transport fixtures use a test-only localhost SAN certificate valid
  through 2036. Each requested transport opened without fallback, rendered
  prompt/reply text and binary GMCP safely, sent `look` with the expected direct
  or CRLF framing, and closed every fixture socket.
- Docker built the client from the clean context with the pinned Node image.
  The runtime contains `server.js`, `lib/`, production dependencies, and
  `dist/client/`; it excludes `public/`, `client/`, `scripts/`, `test/`,
  `desktop/`, Vite, and Electron. The default command starts built mode, all
  required routes respond, and Vite source/HMR routes remain unavailable.
- The normal CI workflow now requires root/static/build/server gates, source
  and packaged Electron smoke, source-free Docker inventories and probes, the
  development and production browser gates, the focused transport suite, and a
  separately installed MCP job.

## Packaged artifacts

- Electron unpacked package: `dist/desktop/mac-arm64/Darkwind.app`
- Electron ASAR: `dist/desktop/mac-arm64/Darkwind.app/Contents/Resources/app.asar`
- Electron built-client inventory: 296 regular files, exact match
- Docker image: `darkflow:phase0-step8`
- Docker image ID: `sha256:5f683556e6d002f3cb003b124fa6ac3671d7eb2054597d1ffab989092563e983`
- Docker image platform: Linux ARM64
- Docker image size: 368,551,106 bytes
- Docker runtime inventory: required files/dependencies present; all forbidden
  source/dev paths and dependencies absent

## Transport outcomes

- `ws`: PASS; direct WebSocket URL and `look` text frame
- `wss`: PASS; direct secure WebSocket URL against the localhost certificate
- `telnet`: PASS; same-origin `/proxy?tls=0` and exact `look\r\n`
- `telnets`: PASS; same-origin `/proxy?tls=1` and exact `look\r\n`

## Known limitations

- Hosted CI evidence and a CI URL remain pending until the branch is pushed.
- The nested MCP clean install reports six dependency audit findings (one low,
  three moderate, and two high); dependency remediation is outside this bounded
  packaging/transport step.
- Live Darkwind connectivity remains a manual, non-blocking smoke and is not
  part of the deterministic Step 8 gate.
