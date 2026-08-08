# Phase 0 Step 7 Implementation Plan

Clarification gate skipped: this is a documentation-only expansion of the
bounded Step 7 contract already approved in the Phase 0 plan.

## Goal

Establish a deterministic built-client artifact that Darkflow can serve in an
explicit opt-in mode without changing the default web or Electron experience.
Success means `npm run build` produces and validates `dist/client/`, Express
serves that directory without falling through to `public/`, `/api/version`
uses the artifact generated from `package.json`, and both server and browser
production gates pass.

This step proves the production artifact boundary while preserving the legacy
client as the visible UI. It does not package or deploy the artifact; Electron,
Docker, transport, release, and final-default changes remain in Steps 8 and 9.

## Evidence and constraints

- The parent plan requires opt-in serving from only `dist/client/`, a
  build-owned version file, preserved HTTP/WebSocket/static contracts, clear
  missing-artifact failure, and production server/Playwright gates
  (`docs/plans/multi-connection-ui-phase-0-implementation-plan.md:105-115`).
- Vite currently copies `public/` into `dist/client/`, empties that output
  first, and adds the Phase 0 MPA entry (`vite.config.ts:6-19`). This is the
  foundation for rendering the unchanged legacy root from the built artifact.
- Express currently reads only `public/version.json` and returns `unknown` on
  read failure (`server.js:68-77`). Its frontend initialization accepts only
  `legacy` and `dev` and always mounts `public/` (`server.js:334-378`).
- `startServer` already accepts a mode while retaining `port` and `host`, and
  its default is `legacy` (`server.js:381-402`). The CLI also maps only
  `--dev` or the legacy default (`server.js:424-432`).
- `npm start`, Electron, and Electron Builder still use the legacy path
  (`package.json:20-42`, `package.json:80-94`,
  `desktop/main.cjs:80-90`). Step 7 must not change those consumers.
- The existing browser configuration always starts Vite middleware
  (`playwright.config.ts:3-41`), so it cannot prove the production artifact
  contract without a separate configuration.
- CI currently builds the artifact and checks only three representative
  outputs (`.github/workflows/ci.yml:30-45`); the production server and browser
  are not exercised against `dist/client/`.

## Must-haves

- [MH1] Add a deterministic build-owned version artifact. Acceptance:
  `npm run build` rewrites `dist/client/version.json` from the root
  `package.json` version and emits exactly `{ "version": "<version>" }`
  regardless of the copied `public/version.json` contents.
- [MH2] Validate the complete built-client contract. Acceptance: the validator
  rejects a missing output directory, missing `index.html`, missing/malformed
  or version-mismatched `version.json`, any missing or byte-different legacy
  public file other than generated `version.json`, and a missing Phase 0
  production entry or hashed bundle.
- [MH3] Add an explicit built-static server mode. Acceptance:
  `startServer({ mode: "built" })` and `node server.js --built-client` serve
  static files from `dist/client/`; `npm start`, calls omitting `mode`, and the
  Electron call site remain legacy.
- [MH4] Never fall back from built mode to source files. Acceptance: built mode
  validates before `server.listen`, serves the built Phase 0 entry, does not
  expose Phase 0 source modules, and fails with an actionable `npm run build`
  message if the artifact is absent or invalid.
- [MH5] Make `/api/version` follow the selected client root. Acceptance:
  legacy/dev return `public/version.json`, built mode returns
  `dist/client/version.json`, every response retains `Cache-Control: no-store`,
  and the built response equals the root package version.
- [MH6] Preserve server and asset contracts. Acceptance: built-mode tests prove
  successful responses for `/`, `/config.json`, `/api/version`, `/ping`,
  `/vendor/howler.core.min.js`, `site.webmanifest`, representative CSS,
  JavaScript, icons, and media assets; `/proxy` remains handled by the shared
  upgrade dispatcher, and MCP mount status remains observable.
- [MH7] Render the unchanged legacy UI from the artifact. Acceptance: a
  Chromium production Playwright smoke test sees the Darkflow title, toolbar,
  terminal, command input, Howler global, no page/console errors, and successful
  representative network responses while the server reports built mode.
- [MH8] Put the new gates in normal CI. Acceptance: CI runs artifact validation,
  built server lifecycle tests, and production Playwright after a clean build,
  with no skipped or allowed-failure step.

## Out of scope

- Making built serving the default for `npm start`, web, or Electron; that is
  the Step 9 cutover.
- Adding `dist/client/` to Electron Builder, changing desktop icon paths, or
  prepending client builds to desktop commands; those are Step 8 packaging
  gates.
- Converting Docker to a builder/runtime image or serving the built artifact
  from Docker; that is Step 8.
- Changing `/proxy`, transport behavior, MCP semantics, configuration payloads,
  desktop-cookie policy, or the legacy UI implementation.
- Removing `public/version.json` or changing `desktop/set-version.cjs`; legacy
  serving and current release-version synchronization still need that source
  until final cutover.
- Porting any legacy module into Svelte or making the Phase 0 harness the root
  application.
- Publishing an artifact, package, image, release, or deployment.

## Assumptions

- [assumption] Vite continues to copy every file under `public/` byte-for-byte
  into `dist/client/` before the post-build contract scripts run - if false:
  replace the parity validator with an explicit copy stage before approving
  Step 7.
- [assumption] `public/version.json` remains synchronized with `package.json`
  for the legacy and desktop paths - if false: the existing release-version
  test must be repaired, but the generated built version must still come only
  from `package.json`.
- [assumption] A Chromium production smoke plus byte-for-byte legacy-tree
  parity and the existing three-browser development suite is sufficient for
  this artifact gate - if false: run the production smoke under Firefox and
  WebKit too, increasing CI time.
- [assumption] The built-mode lifecycle test may temporarily move and restore
  the ignored `dist/client/` directory when proving missing-artifact startup
  failure - if false: add a test-only dependency injection seam for the
  artifact root rather than a production environment override.
- [assumption] Existing `/proxy` tests are sufficient for bridge behavior and
  built-mode coverage only needs to prove the upgrade dispatcher remains
  reachable - if false: duplicate the deterministic proxy fixture under the
  built-mode lifecycle command.
- [assumption] Step 8 will consume the exact `npm run build` and
  `npm run verify:client-artifact` contract established here - if false:
  Electron and Docker could package unvalidated or differently generated
  files and must define a new shared artifact boundary before proceeding.

## Risks

- Express middleware order could allow `public/` to satisfy a request in built
  mode, hiding an incomplete artifact. Mitigation: choose exactly one static
  root during initialization, validate it before mounting/listening, and assert
  a built-only path succeeds while a source-only TypeScript path returns 404.
- The copied `public/version.json` could appear valid even if generation never
  ran. Mitigation: make version writing an explicit post-build stage, unit-test
  the writer, and have the artifact validator compare the output with
  `package.json`.
- A shallow asset checklist could miss a broken nested media or module URL.
  Mitigation: recursively compare every regular file in `public/` with its
  built counterpart except generated `version.json`, then use browser checks
  for representative execution and content types.
- A production Playwright test could accidentally reuse the development
  server. Mitigation: use a separate config and port, start only
  `node server.js --built-client`, disable server reuse, and assert Vite source
  and HMR endpoints are absent.
- Missing-artifact testing could destroy a developer's existing ignored build.
  Mitigation: atomically rename to a unique sibling, restore it in `finally`,
  never recursively delete the original, and run this test serially after the
  build.
- Mode-specific mutable state may survive `stopServer()` in an embedded
  process. Mitigation: reset selected mode/root/version state on stop and cover
  restart cleanup in the server lifecycle test.
- CI may test a stale artifact left by an earlier command. Mitigation: retain
  Vite's `emptyOutDir: true`, run from clean checkout, and make the validator
  part of `postbuild` so `npm run build` cannot report success on invalid
  output.

## Public interfaces

Extend the existing server contract with one mode and one CLI command:

```js
await startServer({
  port,
  host,
  mode: 'legacy' | 'dev' | 'built',
});
```

```bash
npm start                 # unchanged: serves public/
npm run dev               # unchanged: public/ plus Vite middleware
npm run build             # produces and validates dist/client/
npm run start:built       # opt-in: serves only dist/client/
npm run verify:client-artifact
```

Behavioral rules:

- `legacy` remains the default when `mode` is omitted.
- `--built-client` selects `built`; combining it with `--dev` is a usage error.
- Do not infer built mode from `NODE_ENV=production`; cutover is not approved.
- API, vendor, MCP, and WebSocket routes remain registered before the selected
  frontend middleware.
- Built-mode validation completes before MCP attachment and `server.listen`,
  so a missing artifact causes no listening socket or partially initialized
  service.
- The client version route reads `version.json` under the selected static root
  and retains `Cache-Control: no-store`.
- `getServeInfo().mode` reports `built` after successful initialization; no
  absolute filesystem path becomes a public response field.

## Steps

### Step 1 - Generate and validate the client artifact

**Files:** `package.json`, `scripts/write-client-version.mjs`,
`scripts/verify-client-artifact.mjs`, `lib/client-artifact.js`,
`test/client-artifact.test.js`

**Intent:** Add a small shared artifact-contract module that validates an
explicit directory and returns parsed version metadata without mutating it.
Add a writer that reads the root package version and atomically replaces
`dist/client/version.json` after Vite completes. Add a verifier that:

- Requires `dist/client/index.html`, generated `version.json`,
  `phase0/index.html`, and at least one referenced Phase 0 JavaScript bundle.
- Recursively walks `public/` and requires the same relative files and bytes in
  `dist/client/`, excluding `version.json` because that file is generated.
- Requires the generated version to equal `package.json.version`.
- Prints all contract violations together and exits non-zero.

Run the writer before the existing Typia sentinel and the new artifact
verifier in `postbuild`. Keep the scripts deterministic and offline; do not
write into `public/`.

Unit tests use temporary directories to prove valid, missing-root,
missing-entry, malformed-version, mismatched-version, and incomplete-copy
cases. They must not depend on a pre-existing ignored `dist/` tree.

**Verify:**

```bash
node --test test/client-artifact.test.js
npm run build
npm run verify:client-artifact
node -e "const p=require('./package.json'); const v=require('./dist/client/version.json'); if(v.version!==p.version || Object.keys(v).length!==1) process.exit(1)"
cmp public/index.html dist/client/index.html
git diff --check
```

**Done when:** A clean build creates the version file from package metadata,
both bundle sentinels pass, the complete legacy tree is present unchanged, the
Phase 0 production entry exists, and every negative fixture fails with a
specific artifact-contract error.

### Step 2 - Add the opt-in built server lifecycle

**Files:** `server.js`, `package.json`,
`integration/production-server-check.mjs`

**Intent:** Add `built` to the internal serve-mode selection and
`--built-client` to the CLI, exposed as `npm run start:built`. Resolve and
validate `dist/client/` before MCP attachment or `server.listen`; never catch
that validation error and fall back to `public/`.

Select one static root per mode:

- `legacy`: `public/`.
- `dev`: `public/`, followed by the existing Vite middleware.
- `built`: `dist/client/`, with no Vite middleware and no `public/` static
  middleware.

Make `/api/version` read from the selected root. Preserve the legacy fallback
behavior for a legacy source read error, but make an invalid built artifact a
startup error. Reject unknown modes and the conflicting
`--dev --built-client` combination with explicit messages. Reset all selected
client state in `stopServer()`.

The standalone lifecycle check runs only after `npm run build` and proves:

- Root HTML equals `dist/client/index.html` and `getServeInfo().mode` is
  `built`.
- `/phase0/` serves the bundled entry, while `/phase0/main.ts` and
  `/@vite/client` return 404.
- Configuration, version/no-store, ping, Howler, manifest, CSS, JavaScript,
  icon, and representative nested media paths return their expected status and
  content type.
- Desktop-cookie denial/allow behavior and `/proxy` upgrade rejection remain
  unchanged when enabled.
- MCP disabled status is recorded without changing route order.
- After stop, an atomically hidden artifact makes built startup reject before
  listening with an `npm run build` instruction; `finally` restores the exact
  prior directory.

**Verify:**

```bash
npm run build
npm run test:server:built
node -e "const p=require('./package.json'); if(p.scripts.start!=='node server.js' || p.scripts.desktop!=='electron .') process.exit(1)"
npm test
```

**Done when:** Built mode serves only the validated artifact and every existing
legacy/dev lifecycle test remains green; omitting the artifact produces a
pre-listen, actionable failure without modifying the default start or Electron
paths.

### Step 3 - Add production Playwright coverage

**Files:** `playwright.production.config.ts`, `playwright.config.ts`,
`e2e/production-artifact.spec.ts`, `package.json`

**Intent:** Add an isolated Chromium Playwright configuration on a distinct
port. It starts only `node server.js --built-client`, sets `MCP_ENABLED=0`,
does not reuse another server, and waits on `/ping`. Exclude the production
spec from the existing Vite-backed configuration so each test has exactly one
server contract.

The production spec must:

- Load `/` and assert the Darkflow title, toolbar brand, terminal output,
  command input, and connection controls are visible.
- Assert `window.Howl` and `window.Howler` exist after the legacy entry module
  loads.
- Verify `/config.json`, `/api/version`, `/ping`, the manifest, representative
  CSS/JavaScript/icon/media URLs, and `/phase0/` from the browser context.
- Confirm `/api/version` equals `package.json.version` and is `no-store`.
- Confirm `/phase0/main.ts` and `/@vite/client` are absent.
- Fail on `pageerror`, browser console error, or failed same-origin resource
  requests; do not connect to the live MUD.

Expose the gate as `npm run test:browser:production`. Require callers and CI to
run `npm run build` first rather than hiding a second build inside the
Playwright web-server command.

**Verify:**

```bash
npm run build
npm run test:browser:production
npm run test:browser -- e2e/phase0-dev.spec.ts --project=chromium
npm run format:check
npm run lint
```

**Done when:** The production smoke passes only against built-static Express,
the existing development HMR smoke still passes against Vite, and neither
configuration can discover the other's server-specific spec.

### Step 4 - Make the artifact gates required in CI

**Files:** `.github/workflows/ci.yml`

**Intent:** Replace the three ad hoc artifact probes in the baseline job with
the checked-in artifact verifier and add the built-server lifecycle command
immediately after `npm run build`. In the browser job, retain the full existing
development matrix, then build once and run the production Chromium command.

Keep the Docker job and Electron smoke command unchanged in this step: both are
still legacy consumers until Step 8. Do not add `continue-on-error`, retries
beyond the existing browser policy, or a live network dependency.

**Verify:**

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run check
npm test
npm run build
npm run test:server:built
npm run test:browser
npm run test:browser:production
```

After pushing:

```bash
gh run list --workflow ci.yml --branch <branch> --limit 1
gh run watch <run-id> --exit-status
```

**Done when:** A clean CI run cannot pass unless source tests, artifact
generation/validation, built server lifecycle, the development browser matrix,
and the production browser smoke all pass; legacy Docker and Electron jobs
remain green and unchanged.

### Step 5 - Document and execute the Step 7 gate

**Files:** `README.md`,
`docs/plans/multi-connection-ui-phase-0-step-7-verification.md`

**Intent:** Update runtime/build documentation to distinguish the transitional
commands and version sources:

- `npm start` directly serves `public/` and needs no build during Phase 0.
- `npm run build && npm run start:built` is the opt-in artifact path.
- `public/version.json` remains the legacy source;
  `dist/client/version.json` is generated from package metadata and used only
  in built mode.
- Missing or invalid built output is an intentional startup failure.

Record the commit, Node/npm versions, generated version, artifact file count,
exact command results, test counts, CI URL, and known limitations. Do not mark
Step 7 complete if any required gate is skipped or passed only against the
development server.

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
npm run test:browser
npm run test:browser:production
git diff --check
```

**Done when:** The verification record contains successful local or
loopback-capable CI evidence for every command, the documented default remains
legacy, the opt-in built command is reproducible from a clean checkout, and no
Step 8 or Step 9 consumer has been cut over.

## Success criteria

- [ ] `npm run build` exits zero only after generated version, Typia sentinel,
  legacy-tree parity, and Phase 0 bundle checks pass.
- [ ] `dist/client/version.json` contains only the version from
  `package.json`.
- [ ] `npm start` and Electron still select legacy serving without requiring
  `dist/client/`.
- [ ] `npm run start:built` serves `/` and `/phase0/` from `dist/client/`, does
  not expose Vite source/HMR endpoints, and never falls back to `public/`.
- [ ] Missing or invalid `dist/client/` prevents built-mode listening and names
  `npm run build` as the recovery action.
- [ ] `/config.json`, `/api/version`, `/ping`, `/vendor/howler.core.min.js`,
  MCP status, `/proxy`, manifest, CSS, JavaScript, icon, and media contracts
  remain observable in built mode.
- [ ] The production Playwright smoke renders the unchanged legacy UI without
  page, console, or same-origin resource errors.
- [ ] `npm test`, `npm run test:browser`, built server tests, production browser
  tests, formatting, lint, type checks, Svelte checks, and `git diff --check`
  all exit zero.
- [ ] Normal CI contains required artifact, built-server, and production-
  browser gates while Docker and Electron remain on their legacy Step 7 paths.

## Rollback

Step 7 creates no irreversible state or external side effect. If any gate
regresses, remove the `built` mode, its scripts/config/tests, and the CI steps;
restore `server.js` to `legacy`/`dev`, restore `/api/version` to
`public/version.json`, and keep `npm start`, Electron, Docker, and `public/`
unchanged. `dist/` is ignored build output and may be regenerated with
`npm run build`; do not delete or rewrite source assets during rollback.

## Plan self-review

Plan self-review: PASS (9/10)

notes:

- Every must-have maps to Steps 1-5, and each step names files, runnable
  verification, and an observable done condition.
- The production browser gate intentionally uses Chromium only; byte parity
  plus the existing Chromium/Firefox/WebKit development matrix bounds Step 7
  without duplicating the entire suite.
- The missing-artifact integration check must restore an existing ignored
  build directory in `finally`; failure to prove restoration blocks the gate.
