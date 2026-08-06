# Phase 0 Implementation Plan

## Summary

TypeScript and Vite are the right starting area, but the first executable
requirement is the compiler and transformer contract. Typia can compile
successfully yet fail at runtime when its transform is bypassed, so the order
is:

**baseline -> pinned TypeScript/Typia toolchain -> Vite/Svelte harness ->
transform proof -> Express/HMR -> Dockview spike -> production artifact ->
packaging/transports -> cutover**

The existing 81-module JavaScript client remains untouched and continues as
the default until every Phase 0 gate passes.

## Implementation Steps

### 1. Establish a reproducible baseline

- Require Node 22.15.0+ and add normal push/PR CI alongside the tag-only release
  workflow.
- Run `npm ci`, the existing `npm test`, Electron smoke, Docker build/start,
  and current server/proxy checks in a loopback-capable environment.
- Record pre-existing failures; do not treat missing local dependencies or
  sandbox-denied sockets as application regressions.
- Gate: the clean CI baseline is known before frontend dependencies are
  introduced.

### 2. Pin the compiler and frontend toolchain

- Start with exact candidates: TypeScript 7.0.2, Typia 13.2.0, `ttsc` 0.23.0,
  `@ttsc/unplugin` 0.23.0, Vite 8.1.5, Svelte 5.56.8, and
  `@sveltejs/vite-plugin-svelte` 7.2.0.
- Use exact versions without caret ranges and commit the lockfile; treat
  TypeScript, Typia, ttsc, and the unplugin as one upgrade unit.
- Add a strict client-only `tsconfig` with DOM types. Do not type-check or
  rename `public/js/*` yet.
- Add `ttsc --noEmit` and Svelte checking commands.
- Typia's documented requirement is to run through ttsc or its bundler plugin;
  ordinary TypeScript transpilation is insufficient. See the
  [Typia setup documentation](https://typia.io/docs/setup/).

### 3. Create the minimal Vite/Svelte build

- Add an isolated Phase 0 browser harness under `client/phase0/`; it mounts one
  Svelte 5 component and has no production-game responsibilities.
- Configure Vite to emit `dist/client/` and copy the existing `public/` tree
  unchanged into that artifact. The current `public/index.html` therefore
  remains the root client while the Phase 0 harness is bundled separately.
- Register `ttsc()` before the Svelte plugin.
- Add `dev`, `build`, `typecheck`, and `check` scripts without changing
  `npm start` or Electron's default client yet.
- Adopt Vite 8's browser baseline as selected, replacing the repository's
  former Chrome/Firefox 90 and Safari 15 promise. See the
  [Vite browser target documentation](https://vite.dev/guide/build).

### 4. Prove Typia transformation

- Define a small imported protocol type and hoisted `createValidate<T>()` and
  `json.createValidateParse<T>()` factories in plain `.ts` modules.
- Verify valid data passes, malformed known fields fail, and unknown object
  keys remain allowed.
- Execute the validators from both the development harness and production
  bundle; any "no transform configured" runtime path fails CI.
- Add a bundle sentinel confirming no executable, untransformed Typia factory
  call remains.
- Gate: development, type-check, tests, and production all execute generated
  validators successfully.

### 5. Integrate Vite with Express and automate HMR

- Refactor server initialization so API routes, `/config.json`, `/ping`,
  `/vendor`, and `/mcp` are registered before frontend middleware.
- In development, mount Vite in middleware mode on the existing HTTP server so
  Vite HMR and `/proxy` WebSocket upgrades share one origin.
- Keep the legacy `public/` client at `/`; expose the Phase 0 harness at a
  non-production-facing path.
- Add Playwright CI using Chromium, Firefox, and WebKit.
- Test imported-type HMR by editing a temporary copy of the protocol fixture
  and proving the validator changes without restarting Express or Vite.
- Gate: HMR, API routes, desktop-cookie protection, `/mcp`, and `/proxy`
  coexist without routing or upgrade conflicts.

### 6. Implement the Dockview/Svelte lifecycle spike

- Pin the framework-agnostic `dockview` package, not its internal
  `dockview-core` package. See the
  [Dockview v7 packaging notes](https://dockview.dev/docs/overview/whats-new-v7/).
- Put Dockview behind a workspace adapter so application code does not import
  Dockview types directly.
- Each panel renderer owns one Svelte `mount`; parameter updates flow through a
  stable writable store; disposal calls Svelte `unmount` exactly once and
  releases the host element.
- Use a representative imperative terminal island rather than porting
  `output.js`; verify node identity, focus, scroll state, and buffered content
  survive layout movement and restoration.
- Playwright covers mount/update/dispose counts, repeated add/remove cycles,
  docking, floating, resize, serialization/restoration, touch interaction, and
  complete workspace disposal.
- Gate: approve Dockview only with zero surviving Svelte roots, observers,
  subscriptions, or DOM listeners. If rejected, remove the dependency and
  retain the adapter boundary for another workspace implementation.

### 7. Establish the production artifact contract

- Add an opt-in production mode where Express serves only `dist/client/`; keep
  legacy direct serving as the default during the remaining Phase 0 work.
- Generate `dist/client/version.json` from `package.json` during the build and
  make `/api/version` read that build-owned artifact.
- Preserve existing `/vendor/howler.core.min.js`, configuration, ping, MCP,
  proxy, manifest, CSS, JavaScript, and asset URLs.
- Fail startup/package validation clearly when the built client is missing.
- Gate: the built artifact renders the unchanged legacy UI and passes
  production Playwright and server lifecycle tests.

### 8. Prove Electron, Docker, and transports

- Package `dist/client/` in Electron and make smoke/package commands build the
  client first; verify cookies, preload API, Howler, configuration, version,
  icons, updater metadata, and unpacked contents.
- Convert Docker to a build/runtime flow: install dev dependencies and build in
  the builder stage, then install production dependencies and copy `server.js`,
  `lib/`, and `dist/client/` into the runtime stage.
- Use deterministic local fixtures for direct `ws`/`wss` and bridged
  `telnet`/`telnets`; keep a real Darkwind connection as a manual smoke test
  rather than a network-dependent CI gate.
- Gate: Electron smoke/unpacked package, Docker startup, all four transports,
  root tests, and the separate MCP harness pass.

### 9. Cut over and record decisions

- Only after every prior gate passes, make built-client serving the default for
  web and Electron and remove the transitional legacy production mode.
- Keep `npm run dev` on Express plus Vite middleware and `npm start` on the
  prebuilt artifact.
- Add the client build to every desktop release job and normal CI.
- Record the exact approved dependency cohort, Dockview approval/rejection,
  browser-support change, commands, evidence, and known limitations.

## Interfaces and Commands

- Preserve HTTP and WebSocket contracts: `/config.json`, `/api/version`,
  `/ping`, `/mcp`, `/vendor/*`, and `/proxy`.
- Extend `startServer` internally to select development middleware or
  built-static initialization while retaining existing `port` and `host`
  behavior.
- Introduce `npm run dev`, `build`, `typecheck`, `test:browser`, and a single
  aggregate CI command.
- The workspace adapter exposes create/add-or-update/save/restore/dispose
  behavior; Dockview objects remain private to the adapter.

## Acceptance Tests

- Clean install, strict type-check, Svelte check, existing 371-test suite, and
  production build.
- Typia runtime sentinel in development, HMR, tests, and production.
- Imported-type edits regenerate validators without a server restart.
- Dockview lifecycle, floating, touch, serialization, terminal-island
  stability, and leak checks.
- Express route precedence and shared HMR/`/proxy` WebSocket handling.
- Production static assets and generated version artifact.
- Electron smoke/unpacked package, Docker build/start, four transport modes,
  and MCP harness.

## Assumptions

- Phase 0 introduces the build and validation foundation; it does not convert
  the existing frontend modules or replace the visible application shell.
- Green, independently reviewable PRs are required.
- The legacy client remains the default until all gates pass.
- Vite 8's current browser baseline is the new supported web baseline.
- Dependency versions are pinned exactly; a failed candidate cohort blocks the
  gate rather than triggering an unreviewed downgrade.
