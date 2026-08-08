# Darkwind Desktop Client

The desktop client packages the existing Darkflow web application in Electron.
It is not a second frontend: Electron starts `server.js` on a private loopback
origin. Unpackaged development loads `public/`; smoke tests and packaged builds
load the validated `dist/client/` artifact from the same codebase.

## Architecture

```text
Electron main process
  -> Express + WebSocket proxy on 127.0.0.1:47831
  -> BrowserWindow loads public/ in unpackaged development
  -> BrowserWindow loads dist/client/ in smoke and packaged runs
  -> preload exposes only version/update operations

Browser deployment
  -> node server.js
  -> unchanged public/ client and five-minute web version polling
```

The renderer has Node integration disabled, context isolation and Chromium
sandboxing enabled, and no generic IPC bridge. Main-frame navigation is limited
to the private app origin; safe web and email links open in the system browser.
The embedded MCP relay is disabled and proxy logs are written under Electron's
per-user application data directory. A per-process HttpOnly token protects the
loopback server and proxy from unrelated browser pages. The stable port keeps
the browser origin constant so settings, maps, and other local data survive
desktop restarts.

## Development

Install dependencies once, then start either surface:

```bash
npm install
npm start          # web client at http://localhost:3000
npm run desktop    # unpackaged Electron using legacy public/ files
npm run desktop:smoke  # build, verify the built renderer/preload/server, and exit
```

The desktop runtime defaults to `darkwind.ai:4242` over WSS. Environment
variables such as `MUD_HOST`, `MUD_PORT`, and `MUD_WSS` still override those
defaults during development. `DARKFLOW_DESKTOP_PORT` can override the desktop
port for conflict recovery; changing it also changes the browser storage origin,
so it should remain stable after use begins.

## Local Packages

Build the current operating system:

```bash
npm run desktop:pack        # unpacked application for smoke testing
npm run desktop:smoke:packaged  # launch and verify that unpacked application
npm run desktop:dist        # installers for the current OS
```

Explicit platform commands are also available:

```bash
npm run desktop:dist:mac
npm run desktop:dist:win
npm run desktop:dist:linux
```

Every package command first rebuilds and validates `dist/client/`; packages do
not contain `public/` or client source as a fallback. Build on the target
operating system. Output is written to `dist/desktop/`.
Configured direct-download targets are:

| Platform | Targets |
| --- | --- |
| macOS | Universal DMG and ZIP |
| Windows | x64 NSIS installer |
| Linux | x64 AppImage and DEB |

## Direct-Download Updates

Direct builds use `electron-updater` with public GitHub releases from
`jasona/darkflow`. The app checks shortly after launch, every four hours, and
from **File > Check for Updates**. Downloads happen in the background. Once an
update is ready, the existing Darkflow update banner offers **Restart and
update**; quitting normally also installs a downloaded update.

Desktop auto-updates do not replace web update detection. Browser sessions
continue polling `/api/version` and offer the existing refresh action when a
new web deployment is available.

Direct desktop packages are currently released unsigned on every platform.
macOS users must approve the application through Gatekeeper and manually
download and install each new version because Electron cannot auto-update an
unsigned macOS application. The in-app update action therefore opens the exact
versioned universal DMG instead of offering a restart that cannot install.
Windows users should expect an unknown-publisher SmartScreen warning, but
installed direct builds can still use the NSIS update path. Linux AppImage
builds can also use the published update metadata.

The release workflow deliberately supplies no signing credentials. It still
verifies every expected installer and blockmap, checks the platform-specific
updater metadata and checksums, and refuses tags whose version does not match
the application or whose commit is not on `main`. A future signed release line
should restore signature and notarization checks before signing credentials are
added to CI.

## Releasing

Keep the web runtime version, npm package version, and desktop application
version synchronized:

```bash
npm run version:set -- 1.5.1
npm test
git add package.json package-lock.json public/version.json
git commit -m "Release Darkwind desktop 1.5.1"
git tag -a v1.5.1 -m "Darkwind desktop 1.5.1"
git push origin main
git push origin refs/tags/v1.5.1
```

Pushing a matching `v*` tag runs `.github/workflows/desktop-release.yml`. It
tests once, builds each target on its native runner, and publishes a GitHub
release containing installers plus the update metadata consumed by the app.
The tagged commit must be contained in `origin/main`. Use one GitHub release
per version with all three platforms; do not create separate platform releases.
Do not publish a lower or reused version after a broken release; update clients
only move to a higher semantic version.

## Steam Builds

Steam should remain responsible for every Steam installation. Build unpacked
depots on their target operating systems with:

```bash
npm run desktop:steam:mac       # universal macOS depot
npm run desktop:steam:win       # x64 Windows depot
npm run desktop:steam:linux     # x64 Linux depot
```

`npm run desktop:steam` remains a current-platform/current-architecture shortcut.

This embeds `darkflowDistribution=steam` in the packaged application and turns
off GitHub update checks. Runtime detection also disables direct updates when
Steam supplies `SteamAppId`/`SteamGameId`, or when the app is launched with
`--steam`. Upload the resulting unpacked directory with SteamPipe.

This wrapper is ready for Steam distribution but does not yet include the
Steamworks SDK, achievements, cloud saves, overlay callbacks, or ownership
checks. Those can be added independently without forking the Darkflow UI.

## Release Smoke Test

Before publishing, verify an installed build rather than only `npm run desktop`:

1. Launch it and confirm it connects to Darkwind and survives minimize/restore.
2. Exercise map, audio/YouTube, settings import/export, IDE, and external links.
3. On Windows and Linux, install an older direct build, publish a higher
   prerelease in a test repository/channel, and verify download plus
   restart-to-install. On macOS, verify the documented manual upgrade path.
4. Launch a Steam build with `--steam` and confirm the update menu says Steam
   manages updates and no GitHub request is made.
5. Confirm `npm start` still serves the browser client and its refresh banner.
