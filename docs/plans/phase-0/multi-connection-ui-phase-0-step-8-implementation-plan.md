# Phase 0 Step 8 Implementation Plan

Clarification gate skipped: this is a documentation-only expansion of the
bounded Step 8 contract already approved in the Phase 0 plan.

## Goal

Prove that the Step 7 built-client artifact survives Darkflow's real desktop,
container, and connection boundaries without changing the default web or
unpackaged Electron development entry points. Success means a built Electron
smoke and unpacked package, a source-free Docker runtime image, deterministic
browser checks for `ws`, `wss`, `telnet`, and `telnets`, the root suite, and the
separately installed MCP harness all pass in normal CI.

This step makes packaged Electron and Docker consume `dist/client/`, but it does
not perform the final Phase 0 cutover. `npm start`, omitted `startServer` modes,
and `npm run desktop` remain on the legacy source client until Step 9.

## Evidence and constraints

- The parent plan requires Electron to package `dist/client/`, a multi-stage
  Docker build, deterministic local fixtures for all four transports, and
  Electron, Docker, transport, root-test, and MCP gates
  (`docs/plans/multi-connection-ui-phase-0-implementation-plan.md:117-129`).
- The same plan reserves default web/Electron cutover, transitional-mode
  removal, and explicit release-workflow cutover for Step 9
  (`docs/plans/multi-connection-ui-phase-0-implementation-plan.md:131-139`).
- Step 7 left `npm start`, calls omitting `mode`, and Electron on legacy serving
  while establishing `npm run build` and `npm run verify:client-artifact` as the
  handoff to Step 8
  (`docs/plans/multi-connection-ui-phase-0-step-7-implementation-plan.md:55-62`,
  `docs/plans/multi-connection-ui-phase-0-step-7-implementation-plan.md:120-123`).
- The runtime artifact validator currently requires both absolute
  `artifactDir` and `publicDir` paths and always compares the artifact against
  the source tree (`lib/client-artifact.js:154-182`,
  `lib/client-artifact.js:194-205`). The server invokes that source-dependent
  validation before built startup (`server.js:351-369`), so it cannot yet run
  from the source-free Step 8 package/image contract.
- Electron currently starts `startServer` without a mode, resolves its runtime
  window icon under `public/`, and its smoke checks only the preload presence,
  Howler, product name, and connection configuration
  (`desktop/main.cjs:80-90`, `desktop/main.cjs:126-149`,
  `desktop/main.cjs:194-217`).
- Electron Builder currently includes `public/**/*` rather than
  `dist/client/**/*`, while every smoke, pack, distribution, release, and Steam
  script invokes Electron or Electron Builder directly without a client build
  prerequisite (`package.json:20-45`, `package.json:84-101`).
- The current Dockerfile is a single production-dependency stage that copies
  `server.js`, `lib/`, and `public/`, then starts legacy mode
  (`Dockerfile:1-14`).
- The browser maps `ws`/`wss` directly to the selected host and maps
  `telnet`/`telnets` through same-origin `/proxy` with `tls=0` or `tls=1`
  (`public/js/connection.js:615-633`). The proxy already selects `net.connect`
  or `tls.connect`, parses telnet/GMCP, normalizes browser text commands to
  CRLF, and forwards upstream text to the browser
  (`server.js:164-223`, `server.js:230-268`, `server.js:289-333`).
- Existing transport coverage proves ladder order and one plain TCP proxy
  exchange, but it does not drive the built browser through all four transport
  modes (`test/connection-transport.test.mjs:34-56`,
  `test/proxy-upgrade.test.js:20-63`). The production browser configuration is
  currently Chromium-only and runs only the artifact smoke
  (`playwright.production.config.ts:3-26`).
- Root installation intentionally does not install `mud-test-mcp`; the harness
  owns a separate package and already has deterministic fake-MUD tests
  (`AGENTS.md:92-95`, `mud-test-mcp/package.json:1-20`,
  `mud-test-mcp/test/session.test.js:1-20`).
- Repository rules require Playwright specs under `e2e/`, preserve legacy file
  style, run lint and formatting on the Phase 0/browser surface, and use Node
  22.15.0 with npm 10.9.2 (`AGENTS.md:92-103`).

## Must-haves

- [MH1] Preserve full build-time artifact validation while making runtime
  validation self-contained. Acceptance: `npm run verify:client-artifact`
  still rejects every missing or byte-different source file, while
  `startServer({ mode: "built" })` validates and serves an artifact when no
  `public/` directory exists beside it.
- [MH2] Make Electron smoke and packaged runtimes use the built client without
  cutting over unpackaged development. Acceptance: `npm run desktop:smoke`
  builds first and reports built mode; `app.isPackaged` selects built mode;
  `npm run desktop` and an unpackaged launch without the explicit smoke/built
  flag still select legacy mode.
- [MH3] Expand Electron runtime smoke coverage. Acceptance: the smoke verifies
  the HttpOnly desktop session cookie, exact preload API surface, Howler,
  configuration, package/build version equality, a built icon response,
  absence of Vite source/HMR endpoints, and expected updater state, with no
  live Darkwind connection or updater download.
- [MH4] Package and inspect the built artifact. Acceptance: every Electron
  Builder command builds first; the unpacked application's ASAR contains
  `desktop/`, `lib/`, `server.js`, `package.json`, and the complete
  `dist/client/` tree, excludes `public/`, `client/`, and build scripts, and has
  direct-release updater metadata outside the ASAR.
- [MH5] Launch the actual unpacked Electron package. Acceptance: the native
  executable produced by `desktop:pack` exits zero under the smoke flag and
  proves the packaged ASAR can validate and serve its built client, preload,
  Howler route, configuration, version, and icon.
- [MH6] Produce a source-free Docker runtime image. Acceptance: the builder
  installs dev dependencies and runs the normal client build; the runtime
  installs production dependencies only, contains `server.js`, `lib/`, and
  `dist/client/` but no `public/`, client source, or Vite dependency, starts
  with `--built-client`, and passes the existing HTTP/static probes.
- [MH7] Prove all four transports through the shipped browser code.
  Acceptance: Chromium loaded from the built server connects separately to
  deterministic loopback `ws`, `wss`, TCP, and TLS fixtures; each case receives
  fixture text, sends one command, observes the exact command at the fixture,
  and reports the selected transport without falling through the ladder.
- [MH8] Keep transport CI offline and protocol-representative. Acceptance:
  fixtures use a committed test-only localhost certificate, direct fixtures
  speak WebSocket text/binary framing, bridged fixtures exercise `/proxy` and
  CRLF normalization, and no automated gate resolves or connects to
  `darkwind.ai`.
- [MH9] Keep the MCP harness a separate required gate. Acceptance: a clean
  nested `npm ci` followed by the harness's own `npm test` exits zero in a
  distinct CI job; root `npm ci` and the production Docker image do not absorb
  the harness dependencies.
- [MH10] Make Step 8 required in normal CI and record evidence. Acceptance: CI
  has no skipped or allowed-failure Step 8 check and the verification record
  captures the commit, environment, exact commands, Electron/package, Docker,
  four-transport, root-suite, and MCP outcomes.

## Out of scope

- Making `npm start`, omitted `startServer` calls, or `npm run desktop` use the
  built client by default; that is the Step 9 cutover.
- Removing legacy/development serve modes, deleting `public/`, porting legacy
  JavaScript into Svelte, or making the Phase 0 harness the root UI.
- Changing transport fallback order, reconnect policy, GMCP semantics, telnet
  parsing, `/proxy` security policy, or configuration schema.
- Using the live Darkwind service as an automated test dependency. A live
  connection remains a documented manual smoke only.
- Publishing installers, a GitHub release, a container image, a Steam depot,
  or any deployment.
- Adding signing, notarization, Steamworks, production TLS trust, or updater
  behavior beyond validating the existing package metadata and disabled/manual
  smoke state.
- Editing the tag-triggered desktop release workflow; Step 8 makes the package
  commands safe, while explicit release-job cutover remains in Step 9.
- Bundling `mud-test-mcp` into Electron or Docker, mounting `/mcp` in desktop,
  or changing the harness API.

## Assumptions

- [assumption] Build-time source parity and self-contained runtime structural
  validation are separate responsibilities - if false: add a generated,
  content-hashed artifact manifest before removing `public/` from packaged
  runtimes.
- [assumption] Electron's patched filesystem can serve `dist/client/` from
  `app.asar` through the existing Express and `fs` calls - if false: place only
  `dist/client/` under `asarUnpack` and keep the same package validator and
  runtime URL contract.
- [assumption] A Linux unpacked-package launch in normal CI plus platform-neutral
  ASAR validation and existing release-contract unit tests is sufficient for
  this Phase 0 gate - if false: add native unpacked smoke jobs for macOS and
  Windows, increasing CI time and runner cost.
- [assumption] Playwright `ignoreHTTPSErrors` applies to page-created secure
  WebSockets in the supported Chromium build - if false: launch the isolated
  transport project with Chromium's certificate-error override; do not weaken
  application TLS behavior.
- [assumption] One built-mode Chromium pass is sufficient to prove transport
  URL construction and proxy integration because the existing development
  suite retains Chromium, Firefox, and WebKit coverage - if false: add the
  transport spec to Firefox and WebKit after measuring certificate and timing
  stability.
- [assumption] Electron Builder emits direct-update configuration in the
  unpacked application's resources directory when the existing GitHub publish
  configuration is present - if false: inspect the generated platform layout
  and validate the equivalent builder metadata without manufacturing updater
  files.
- [assumption] A long-lived self-signed certificate and private key committed
  under `e2e/fixtures/` are acceptable because they are used only by loopback
  test servers - if false: generate an ephemeral certificate through a pinned
  JavaScript dev dependency rather than relying on a system `openssl` binary.
- [assumption] Docker BuildKit and GitHub-hosted runners provide enough disk and
  time for a clean dev-dependency builder plus the existing browser and desktop
  jobs - if false: cache only immutable dependency downloads and split jobs;
  do not reuse a host-built `dist/client/` in the Docker context.

## Risks

- Splitting runtime validation from source parity could silently weaken the
  Step 7 build gate. Mitigation: expose two explicitly named functions, require
  both in `verify:client-artifact`, and add negative tests proving source parity
  still fails independently while runtime validation works without `public/`.
- Electron source smoke could pass while the packaged ASAR is incomplete.
  Mitigation: inspect the ASAR file list, compare every generated client path,
  validate updater resources, and then launch the native unpacked executable.
- A package command could use a stale `dist/client/`. Mitigation: route every
  Electron Builder command through one `desktop:prepare-client` script that
  performs a fresh `npm run build`; assert the command contract in unit tests.
- Removing `public/` from the package could break a hidden runtime path such as
  the BrowserWindow icon. Mitigation: change runtime paths to the selected
  built root, search packaged code for source-client paths, and make icon fetch
  and native-image validity part of both source and packaged smoke.
- Packaged smoke may accidentally execute the repository's server or assets.
  Mitigation: launch the binary by absolute path with a temporary user-data
  directory and assert built-only paths from inside its renderer.
- TLS fixtures can become flaky because of certificate validity, IPv4/hostname
  mismatch, or sockets surviving a failed test. Mitigation: include localhost
  and `127.0.0.1` SANs, validate dates in a unit test, bind explicitly to
  `127.0.0.1`, track every socket, and close servers/sockets in fixture teardown.
- The transport fallback ladder can mask a broken requested mode by succeeding
  on another fixture. Mitigation: start only the target fixture for each case,
  disable auto-reconnect for the test page, and assert the first/open event,
  exact URL shape, and active transport.
- The Docker builder could hide an undeclared host artifact through the build
  context. Mitigation: keep `dist/` ignored by `.dockerignore`, run `npm ci` and
  `npm run build` inside the builder, and inspect the runtime image for both
  required and forbidden paths.
- Installing nested MCP dependencies in the root job could contaminate root
  dependency or artifact checks. Mitigation: use a separate CI job with
  `npm ci --prefix mud-test-mcp` and `npm test --prefix mud-test-mcp`.
- Electron packaging may push the existing 15-minute CI timeout over its limit.
  Mitigation: measure the unpacked Linux pack separately, give that job an
  explicit bounded timeout, and retain logs/package inspection output on
  failure.

## Public interfaces

Retain the server interface established in Step 7:

```js
await startServer({
  port,
  host,
  mode: 'legacy' | 'dev' | 'built',
});
```

Refine the artifact-validation boundary into two explicit operations:

```js
await validateClientArtifact({
  artifactDir,
  expectedVersion,
});

await validateClientSourceParity({
  artifactDir,
  publicDir,
});
```

Behavioral rules:

- `validateClientArtifact` requires only the candidate artifact and validates
  its root entry, exact version shape/value, Phase 0 entry, and referenced
  production bundle.
- `validateClientSourceParity` requires both directories and checks every
  source public file except generated `version.json` for presence and identical
  bytes.
- `npm run verify:client-artifact` invokes both operations; built server startup
  invokes only the self-contained operation.
- `npm run desktop` remains an unpackaged legacy-development command.
- `npm run desktop:smoke` builds and opts into built mode.
- Packaged Electron selects built mode from `app.isPackaged`, not from
  `NODE_ENV`; a missing or invalid artifact is a startup error.
- Every Electron Builder command invokes `npm run desktop:prepare-client`
  before packaging. No command silently falls back to `public/`.
- Docker starts `node server.js --built-client`; `npm start` remains unchanged.
- The transport suite drives the public controls (`#host`, `#port`,
  `#protocol-select`, `#connect-btn`, and `#command-input`) rather than calling
  internal connection functions.

Expected command surface:

```bash
npm run desktop                 # unchanged legacy source development
npm run desktop:smoke           # build + source Electron built-mode smoke
npm run desktop:pack            # build + unpacked package + package validation
npm run desktop:smoke:packaged  # launch the unpacked native application
npm run test:transports         # built Chromium + four local fixtures
npm run test:mcp                # clean install/test of the nested harness
docker build -t darkflow:phase0-step8 .
```

## Steps

### Step 1 - Make artifact runtime validation source-independent

**Files:** `lib/client-artifact.js`, `scripts/verify-client-artifact.mjs`,
`server.js`, `test/client-artifact.test.js`,
`integration/production-server-check.mjs`

**Intent:** Split the current validator without weakening the Step 7 build
contract. Keep root entry, version, Phase 0 entry, and referenced-bundle checks
in `validateClientArtifact({ artifactDir, expectedVersion })`; move the recursive
`public/` comparison into
`validateClientSourceParity({ artifactDir, publicDir })`.

The command-line verifier must invoke both functions and aggregate their
violations so `npm run build` continues proving complete source parity. Built
server startup must invoke only the self-contained validator, because deployed
artifacts do not carry the source tree. Add temporary-directory tests proving:

- Runtime validation succeeds after the fixture `public/` tree is removed.
- Runtime validation still rejects missing root/version/Phase 0/bundle files.
- Source parity independently rejects missing, changed, and absent source
  trees.
- The build verifier reports violations from both validation layers.
- Built server startup and restart pass when a temporary copy contains the
  artifact, server files, and package metadata but no `public/` tree.

Do not add an optional `publicDir` argument whose omission silently changes the
same function's strictness; the two responsibilities must be named at call
sites.

**Verify:**

```bash
node --test test/client-artifact.test.js
npm run build
npm run verify:client-artifact
npm run test:server:built
npm test
git diff --check
```

**Done when:** Build-time parity remains as strict as Step 7, built startup no
longer needs `public/`, and every negative fixture identifies whether the
runtime artifact or source-copy contract failed.

### Step 2 - Route Electron smoke and packaged runs through built mode

**Files:** `desktop/main.cjs`, `desktop/runtime.cjs`,
`test/desktop-runtime.test.js`, `package.json`

**Intent:** Add a pure, unit-tested serve-mode selector that returns `built`
for packaged Electron and the explicit `--built-client` flag, and `legacy` for
ordinary unpackaged development. Pass that result to `startServer`; resolve the
BrowserWindow icon from `dist/client/` when built mode is selected and from
`public/` otherwise.

Add `desktop:prepare-client` and make `desktop:smoke` run it before launching
Electron with both `--smoke-test` and `--built-client`. Extend the smoke result
to verify:

- Exactly one HttpOnly `darkflow-desktop-token` cookie exists for the app
  origin, and renderer JavaScript cannot read it.
- `window.darkflowDesktop` is frozen and exposes only `getInfo`,
  `checkForUpdates`, `installUpdate`, and `onUpdateStatus`.
- Product/version/distribution and disabled development updater state are
  expected.
- `/config.json`, `/api/version`, Howler, and a built icon load successfully.
- `/phase0/` exists while `/phase0/main.ts` and `/@vite/client` return 404.
- The page records no console, page, or same-origin request failures and never
  opens a live MUD connection.

Keep `npm run desktop` unchanged and prove the default-mode invariant in the
unit test.

**Verify:**

```bash
node --test test/desktop-runtime.test.js
npm run build
npm run desktop:smoke
node -e "const p=require('./package.json'); if(p.scripts.desktop!=='electron .') process.exit(1)"
npm test
```

On Linux, run the smoke under:

```bash
xvfb-run --auto-servernum npm run desktop:smoke
```

**Done when:** Source Electron smoke proves the built runtime and expanded
desktop security/asset contracts, while an ordinary unpackaged desktop launch
still uses the legacy source client.

### Step 3 - Package and inspect the built Electron application

**Files:** `package.json`, `package-lock.json`,
`desktop/validate-package.cjs`, `test/desktop-package.test.js`,
`test/desktop-release.test.js`

**Intent:** Add exact `@electron/asar@3.4.1` as a direct development dependency
because the lockfile already resolves that version
(`package-lock.json:55-70`). Replace `public/**/*` in Electron Builder's file
set with `dist/client/**/*`; retain `desktop/**/*`, `lib/**/*`, `server.js`, and
`package.json`. The platform icon configuration may continue reading source
icons during the build, but runtime code and packaged files must not require
`public/`.

Route every `electron-builder` command - unpacked, installer, platform,
unsigned release, and Steam - through `desktop:prepare-client`. After
`desktop:pack`, run a cross-platform validator that locates `app.asar` and:

- Compares every regular path under the freshly built `dist/client/` with the
  ASAR list.
- Requires desktop main/preload/updater/runtime files, `server.js`, `lib/`, and
  package metadata.
- Rejects packaged `public/`, `client/`, `scripts/`, Vite configuration, and
  test files.
- Extracts packaged `package.json` and checks name/version/main/distribution.
- Locates direct-update metadata in the unpacked resources and checks the
  existing GitHub provider, owner, and repository without contacting GitHub.

Unit tests use temporary fake package layouts/ASARs for missing client files,
forbidden source paths, version mismatch, and missing updater metadata. Extend
release-contract tests to assert that every package-producing script contains
the shared build prerequisite.

**Verify:**

```bash
npm ci
node --test test/desktop-package.test.js test/desktop-release.test.js
npm run desktop:pack
node desktop/validate-package.cjs dist/desktop
npm test
```

**Done when:** The validated ASAR contains the exact built-client tree and no
source-client fallback, updater metadata is present, and all package-producing
commands share the fresh-build prerequisite.

### Step 4 - Launch the unpacked Electron package

**Files:** `desktop/run-packaged-smoke.cjs`,
`test/desktop-package-launcher.test.js`, `package.json`

**Intent:** Add a cross-platform launcher that resolves the current platform's
unpacked executable from a validated Step 3 output, gives it a unique temporary
user-data directory, passes `--smoke-test`, captures output, enforces a bounded
timeout, and always removes the temporary profile. Expose it as
`desktop:smoke:packaged` without rebuilding or repacking, so failures identify
the package-runtime boundary instead of repeating the package build.

Unit-test executable discovery for Linux, Windows, Intel/Apple Silicon macOS,
and universal macOS layouts using temporary directories; prove missing and
ambiguous layouts fail with actionable errors. Under Linux CI, launch the
actual unpacked application through Xvfb. The packaged smoke must exercise the
Step 2 checks from inside `app.asar`, including built route selection, cookie,
preload, Howler, configuration, version, icon, and updater state.

**Verify:**

```bash
node --test test/desktop-package-launcher.test.js
npm run desktop:pack
npm run desktop:smoke:packaged
```

On Linux, run:

```bash
xvfb-run --auto-servernum npm run desktop:smoke:packaged
```

**Done when:** Executable discovery is deterministic on every configured
platform, and the actual Linux unpacked binary serves its ASAR-owned built
client and exits zero under the complete smoke contract.

### Step 5 - Convert Docker to a reproducible build/runtime artifact

**Files:** `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`

**Intent:** Replace the single-stage image with:

1. A builder stage pinned to Node 22.15.0 Alpine that copies package manifests,
   runs `npm ci`, copies only build inputs (including the Typia sentinel fixture
   imported by `postbuild`), runs `npm run build`, and therefore executes Typia
   plus artifact validation.
2. A runtime stage pinned to the same Node image that copies package manifests,
   runs `npm ci --omit=dev`, and copies `server.js`, `lib/`, and the builder's
   `dist/client/`.

Keep generated host `dist/`, local dependencies, logs, tests, documentation,
and source-control metadata out of the build context. Start the runtime with
`node server.js --built-client`; do not copy `public/`, `client/`, build scripts,
or `mud-test-mcp/` into the runtime image.

Extend the Docker CI job to prove:

- Required runtime files exist and forbidden source/dev paths do not.
- `vite` and `electron` cannot be resolved in the runtime image while
  `express`, `ws`, and `howler` can.
- `/`, `/config.json`, `/api/version`, `/ping`, Howler, manifest, CSS,
  JavaScript, a brand icon, media, and `/phase0/` succeed.
- `/phase0/main.ts` and `/@vite/client` return 404.
- The container reports a clear startup failure if `dist/client/` is hidden in
  a derived negative-test image/container.

Keep `MCP_ENABLED=0` for the container smoke because the harness is a separate
Step 8 gate.

**Verify:**

```bash
docker build --tag darkflow:phase0-step8 .
docker run --rm darkflow:phase0-step8 node -e "const fs=require('fs'); for(const p of ['/app/server.js','/app/lib/client-artifact.js','/app/dist/client/index.html']) if(!fs.existsSync(p)) process.exit(1); for(const p of ['/app/public','/app/client','/app/scripts']) if(fs.existsSync(p)) process.exit(1)"
docker run --rm darkflow:phase0-step8 node -e "for(const m of ['express','ws','howler']) require.resolve(m); for(const m of ['vite','electron']) { try { require.resolve(m); process.exit(1) } catch(e) { if(e.code!=='MODULE_NOT_FOUND') throw e } }"
```

Then start the image with `MCP_ENABLED=0`, poll `/ping`, run the HTTP probes
listed above, inspect logs, and remove the container in a shell `trap`.

**Done when:** Docker builds the client internally from a clean context, the
minimal runtime contains and serves only the validated artifact plus required
server/runtime dependencies, and every positive and negative probe is
observable in CI.

### Step 6 - Exercise `ws`, `wss`, `telnet`, and `telnets` end to end

**Files:** `e2e/fixtures/transport-fixtures.ts`,
`e2e/fixtures/localhost-cert.pem`, `e2e/fixtures/localhost-key.pem`,
`e2e/transports.spec.ts`, `playwright.production.config.ts`, `package.json`

**Intent:** Add one fixture owner that starts four loopback servers on ephemeral
ports and tears down every accepted socket:

- Plain and TLS `ws` fixtures using the installed `ws` package.
- Plain TCP and TLS fixtures that emit prompt text, accept telnet negotiation,
  and record normalized commands.

The test certificate must be test-only, include DNS `localhost` and IP
`127.0.0.1` SANs, have a deliberately long validity window, and have a unit
assertion that its expiry remains at least one year away. Configure only the
isolated production transport project to ignore fixture certificate errors.

For each transport, open a fresh built-client page with WebSocket diagnostics,
disable auto-reconnect before connecting, fill the visible host/port/protocol
controls, and click Connect. Assert:

- The first attempted URL is the direct fixture root for `ws`/`wss`, or the
  same-origin `/proxy` URL with the correct target and `tls` bit for
  `telnet`/`telnets`.
- The requested transport is the one that reaches `open`; no fallback event is
  recorded.
- Initial fixture text renders in the terminal.
- Sending `look` from the command input reaches direct fixtures as one text
  WebSocket message and bridged fixtures as exactly `look\r\n` after telnet
  negotiation bytes are parsed.
- A transport-specific reply renders, binary GMCP input does not crash the
  page, and disconnect/fixture teardown leaves no open client socket.

Keep the existing lower-level ladder, parser, and proxy tests. Add
`test:transports` as the focused built Chromium command; do not call or resolve
the live Darkwind host.

**Verify:**

```bash
node --test test/connection-transport.test.mjs test/proxy-upgrade.test.js test/telnet-parser.test.js
npm run build
npm run test:transports
npm run lint
npm run format:check
```

**Done when:** Four independent cases prove the browser's requested transport,
URL, outbound command framing, inbound text/GMCP handling, and cleanup against
local fixtures with no fallback or external network dependency.

### Step 7 - Wire all gates into CI and record the Step 8 result

**Files:** `.github/workflows/ci.yml`, `package.json`, `README.md`,
`docs/desktop.md`,
`docs/plans/multi-connection-ui-phase-0-step-8-verification.md`

**Intent:** Make the normal workflow require these dependency-ordered gates:

- Root job: clean install, format, lint, typecheck, Svelte check, root tests,
  client build/artifact verification, built-server lifecycle, expanded Electron
  source smoke, unpacked Linux package validation, and packaged smoke.
- Docker job: clean multi-stage build, runtime inventory, dependency inventory,
  startup, and built-only HTTP/static probes.
- Browser job: existing development matrix, production artifact smoke, and the
  focused four-transport suite.
- MCP job: Node 22.15.0, `npm ci --prefix mud-test-mcp`, then
  `npm test --prefix mud-test-mcp`, with its own npm cache key and timeout.

Expose the same nested install-then-test order as `npm run test:mcp`; keep it
separate from root `npm test` so package ownership remains explicit.

Do not use `continue-on-error`, skip TLS modes, or make live Darkwind
availability a condition of CI success. Keep the tag-triggered release workflow
unchanged in this step.

Update user-facing documentation to distinguish:

- Legacy `npm start` and unpackaged `npm run desktop` development.
- Built Electron smoke/package commands and packaged runtime behavior.
- The source-free multi-stage Docker image.
- Deterministic automated transport gates versus the optional manual live
  Darkwind smoke.

Create the verification record before implementation starts, then fill it with
the commit SHA, Node/npm/browser/Docker/Electron versions, exact command
results, test counts, packaged paths, image inventory, four transport outcomes,
MCP outcome, CI URL, and any environmental limitation. Do not mark the gate
complete until hosted CI is green.

**Verify:**

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run check
npm test
npm run build
npm run verify:client-artifact
npm run test:server:built
npm run desktop:smoke
npm run desktop:pack
npm run desktop:smoke:packaged
npm run test:browser
npm run test:browser:production
npm run test:transports
npm ci --prefix mud-test-mcp
npm test --prefix mud-test-mcp
git diff --check
```

Run the Docker Step 5 verification separately. After pushing:

```bash
gh run list --workflow ci.yml --branch <branch> --limit 1
gh run watch <run-id> --exit-status
```

**Done when:** Every local gate has a recorded result, all normal CI jobs pass
without exceptions, documentation matches the shipped command/runtime split,
and the Step 8 record links the successful hosted run.

## Success criteria

- [ ] Build-time validation still checks every copied `public/` file, while
  built runtime startup succeeds without a source `public/` directory.
- [ ] `npm run desktop` remains legacy; `npm run desktop:smoke` and packaged
  Electron use a freshly built `dist/client/`.
- [ ] Electron smoke proves the session cookie, exact preload surface, Howler,
  configuration, version, icon, updater state, and built-only route behavior.
- [ ] The unpacked ASAR contains the complete built client and required server
  files, excludes source/build surfaces, and includes valid direct-update
  metadata in resources.
- [ ] The actual unpacked native Electron executable exits zero under smoke.
- [ ] Docker builds the client in its builder stage and its production-only,
  source-free runtime starts in built mode and passes every probe.
- [ ] Built Chromium passes independent `ws`, `wss`, `telnet`, and `telnets`
  fixture cases with the expected URL and command framing and no fallback.
- [ ] `npm test`, typecheck, Svelte check, lint, formatting, development browser
  matrix, production browser smoke, and built-server lifecycle all exit zero.
- [ ] A clean, separately installed `mud-test-mcp` suite exits zero.
- [ ] Normal hosted CI is green with no skipped or allowed-failure Step 8 gate.
- [ ] The verification record contains reproducible command evidence and the CI
  URL; live Darkwind remains manual and non-blocking.
- [ ] No installer, release, container image, Steam depot, or deployment is
  published.

## Rollback

No data migration, external mutation, or publication occurs. Revert the Step 8
commits to restore legacy Electron packaging and the single-stage Dockerfile;
remove ignored `dist/client/` and `dist/desktop/` outputs if desired. The
committed loopback certificate is test-only and can be deleted with the test
fixture commit; no trusted credential or production secret is rotated.

Plan self-review: PASS (9/10)

Notes:

- Every must-have maps to at least one dependency-ordered step, and every step
  names files, runnable verification, and an observable completion condition.
- The executor must confirm Electron Builder's actual per-platform unpacked
  resource layout before finalizing `desktop/validate-package.cjs`; the
  validator should discover supported layouts and fail clearly rather than
  assuming one operating system's directory name.
- If Electron cannot serve static files from ASAR in the packaged smoke, use
  `asarUnpack` only for `dist/client/`; do not restore `public/` as an implicit
  fallback.
