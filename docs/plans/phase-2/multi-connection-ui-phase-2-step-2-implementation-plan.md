# Phase 2 Step 2 Implementation Plan

_Plan stress-tested via focused adversarial review. Twelve findings surfaced;
ten survived. Ponytail full keeps this step to one non-default Svelte entry, one
deliberately narrow `Session` extension, and the existing boot transaction._

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 — this is one bounded shell/session vertical slice, but it
  crosses a frozen public runtime boundary and must prove development, built-web,
  mobile, accessibility, theme, desktop-adapter, and disposal behavior without
  changing the production root
- Hard triggers: none; the Phase 2 master plan already supplies the phase map and
  makes Step 2 a bounded implementation horizon
- Current planning horizon: Phase 2 Step 2 only — establish the non-production
  Svelte integration root and complete parity rows `P2-2-*`
- Evidence horizon: the Step 1 ledger, public `Session` and internal factory
  handles, root boot transaction, transport/reconnect events, legacy shell
  owners, Phase 0 Svelte lifecycle precedent, Vite MPA build, and browser/release
  fixtures
- Adversarial review: focused — test public-boundary leakage, dual DOM/session
  ownership, cutover timing, boot rollback, endpoint precedence, listener
  disposal, and evidence gaps

## Planning status

This document is planning-only and does not authorize implementation. Step 1 is
`COMPLETE`, and its ledger assigns the five shell rows to Step 2
(`multi-connection-ui-phase-2-step-1-parity-matrix.md:54-64`). The current branch
is `story/multi-connections-phase2` at `7452fc753f53eeeac0f1d7b210497e70df90257d`.

Step 2 remains `OPEN` until every success criterion in this plan passes. The
existing `/` entry remains the default legacy frontend throughout this step;
Step 12 alone may replace it
(`multi-connection-ui-phase-2-step-1-parity-matrix.md:43-50`).

## Goal

Add a built `/phase2/` entry whose Svelte root owns one public `Session`, the
connect form, connection status and reconnect overlay, application chrome,
initial theme, update banner, root focus/accessibility behavior, and one inert
content host for later ports. It must reuse the Phase 1 graph, migration,
transport, reconnect, and disposal contracts without importing
`SessionFacadeHandles`, initializing `/js/app.js`, creating a second session, or
changing the production `/` owner.

The step succeeds when the five `P2-2-*` rows have development and built-web
replacement evidence, their mobile/accessibility/theme/disposal facets are green
where Step 2 owns them, and the preserved legacy root still passes its existing
checks.

## Evidence and constraints

- Step 2 is explicitly limited to one Svelte shell/session host, shell
  connection/status/theme behavior, desktop integration, app-level
  accessibility, and controlled legacy islands. It must not add tabs, change the
  default production owner, or create a second session
  (`multi-connection-ui-phase-2-implementation-plan.md:216-230`).
- Step 1 freezes five Step 2 rows: root bootstrap, connection, reconnect overlay,
  endpoint controls, and chrome/theme/desktop. Each row names its cutover and
  rollback behavior
  (`multi-connection-ui-phase-2-step-1-parity-matrix.md:54-64`).
- The current root contains all shell and legacy feature DOM and loads Howler
  before `/app/bootstrap.ts` (`client/index.html:27-149`). The Phase 2
  preview must not move or partially rewrite that production file.
- The root boot transaction creates exactly one session, installs the four
  compatibility bridges, records it in the window-owned slot, then loads the
  legacy app (`client/app/bootstrap-transaction.ts:177-204`,
  `client/app/bootstrap-transaction.ts:241-356`). Its failure path resets
  bridges, disposes a created session, and clears diagnostics
  (`client/app/bootstrap-transaction.ts:357-367`).
- Public `Session` currently exposes identities, connect/disconnect/dispose, and
  read-only configuration, health, and runtime snapshots only
  (`client/runtime/session.ts:16-34`). Endpoint mutation and transport event
  subscription currently exist only on internal `SessionFacadeHandles`
  (`client/runtime/session-factory.ts:22-35`); Svelte may not import those
  handles (`../phase-1/multi-connection-ui-phase-1-step-16-decision.md:26-28`).
- The transport already publishes one reconnect payload containing status,
  attempt, transport, delay, target time, reason, URL, and user-disconnect state
  (`client/transport/types.ts:13-29`,
  `client/transport/reconnect.ts:152-166`). Step 2 reuses that event instead
  of creating a second connection state machine.
- The existing endpoint resolver preserves the four protocols, blank-value
  fallbacks, and profile baseline without exposing raw sockets
  (`client/transport/urls.ts:22-90`). The Svelte form also retains native
  host/port/select validation rather than adding a form library.
- The current toolbar owns connect controls and status markup
  (`client/index.html:63-104`); `app.js` owns endpoint/config precedence,
  auto-connect, protocol persistence, and root manager startup
  (`public/js/app.js:384-514`); `connection.js` owns the legacy status DOM
  (`public/js/connection.js:727-753`). Loading both shells would create
  duplicate owners.
- The legacy reconnect overlay is driven by connection and reconnect events,
  supports retry/stop/countdown, and disposes its timer and DOM
  (`public/js/connection-overlay.js:23-59`,
  `public/js/connection-overlay.js:112-194`). Its behavior is retained, not
  its mutable singleton.
- The Phase 0 entry proves the installed Svelte 5 `mount` API and a direct
  lifecycle/disposal pattern (`client/phase0/main.ts:1-24`,
  `client/phase0/main.ts:138-147`). Step 2 does not promote Dockview or the
  Phase 0 test bridge; those remain Step 3 concerns.
- Vite already builds multiple HTML entries and emits source-free artifacts
  (`vite.config.ts:6-19`); the existing production test rejects served TypeScript
  and checks the generated root bundle (`e2e/production-artifact.spec.ts:125-154`).
- The Electron preload already supplies a disposable update-status listener
  (`desktop/preload.cjs:5-14`). The current DOM integration ignores that disposer
  (`public/js/desktop-integration.js:32-73`); the Svelte owner must
  retain and call it.
- Root scripts already provide unit, build/artifact, type, Svelte, lint, format,
  development-browser, production-browser, transport, and desktop gates. No new
  dependency or test framework is needed (`package.json:20-55`,
  `package.json:63-86`).

## Decisions

### Non-production integration entry

Add `client/phase2/index.html` as a Vite MPA input served at `/phase2/`. It uses
the same static CSS, brand assets, Howler ordering, `/config.json`, and boot
foundation as `/`, but mounts the Svelte client instead of importing
`/js/app.js`.

This is a temporary integration entry, not a runtime feature flag. The rejected
alternatives are a query/localStorage switch, which creates long-lived branching
inside the production root, and replacing `/` now, which violates the Step 12
cutover gate.

### Public session surface

Extend `Session` with only the shell capabilities proven necessary here:

```ts
interface SessionConnectionSnapshot {
  endpoint: TransportEndpoint;
  state: TransportState;
  reconnect: TransportReconnectStatusPayload | null;
}

getConnectionSnapshot(): SessionConnectionSnapshot;
setConnectionEndpoint(endpoint: TransportEndpoint): void;
retryConnection(): void;
subscribeConnection(listener: (snapshot: SessionConnectionSnapshot) => void): Unsubscribe;
onDispose(listener: () => void): Unsubscribe;
```

`subscribeConnection` emits the current snapshot immediately, then emits a new
immutable snapshot from the existing reconnect-status event. It derives the
visible state from that payload (`connecting`, `connected`, or
`scheduled`/`idle` as disconnected) rather than adding a polling loop or exposing
the event bus. Endpoint getters return copies. `onDispose` registers one teardown
with the existing session resource scope so the mounted Svelte root is removed by
the same terminal `Session.dispose()` path.

Do not expose `SessionFacadeHandles`, `SessionTransport`, `SessionEventBus`,
`ResourceScope`, raw sockets, a generic `own()` method, or a shell-specific
facade. If this exact surface cannot drive the shell tests, stop and replan the
public contract instead of reaching into internal handles.

### Boot and legacy ownership

Generalize the existing transaction's final `loadLegacyApp` callback to one
`loadClient(record)` callback and rename its boolean record field from
`legacyAppLoaded` to `clientLoaded`. The production entry supplies its unchanged
legacy loader; `/phase2/` supplies the Svelte mount. Same-document reuse still
loads one client once, and any mount failure follows the existing bridge/session
cleanup path.

The Phase 2 entry does not import `/js/app.js` or start a generic legacy-island
registry. Its only migration boundary is one inert content element that Step 3
may replace with the real workspace. Pure existing utilities may be consumed by
the Svelte owner where useful, but no legacy module may mutate Svelte-owned shell
DOM. This is the smallest ownership rule that prevents duplicate socket, focus,
timer, and listener work today.

## Must-haves

- [MH1] The production owner stays unchanged — acceptance: `client/index.html`
  remains byte-for-byte unchanged; `/` still reaches `legacy-loaded`; only
  `/phase2/` mounts the Svelte shell; there is no query, storage, environment, or
  build-time feature flag selecting owners.
- [MH2] The Phase 2 entry creates and reuses exactly one public session —
  acceptance: repeated boot in one document returns the same session ID, reload
  creates one fresh session, the registry rejects a duplicate live session, and
  `/phase2/` never imports `/js/app.js` or constructs a second transport.
- [MH3] Svelte consumes a reviewed public contract — acceptance: the exact
  connection snapshot, endpoint update, retry, subscription, and disposal
  methods above have focused runtime tests; no `client/app/**/*.svelte` or Phase 2
  entry imports `SessionFacadeHandles` or a compatibility bridge.
- [MH4] Connection controls preserve current behavior — acceptance: host, port,
  and all four protocols initialize from the migrated/profile endpoint and URL
  precedence; blank host/port retain current fallbacks; Zork-only launch
  overrides remain; configured hosts auto-connect; protocol selection keeps the
  existing `darkflow-protocol` compatibility value until Step 5 owns persistence.
- [MH5] Connection lifecycle remains session-owned — acceptance: connect,
  disconnect, immediate retry, fallback/reconnect updates, user-disconnect idle
  state, and reconnect countdown render from `Session` snapshots; the four
  transport fixtures each create one expected socket with no fallback or live
  Darkwind connection.
- [MH6] The replacement overlay retains behavior and improves ownership —
  acceptance: it appears only after a previously connected session drops, shows
  connecting/scheduled/idle detail, exposes Retry now and Stop trying, restores
  focus when hidden, works at a narrow viewport, and leaves no timer or element
  after session disposal.
- [MH7] Svelte owns shell chrome and initial theme — acceptance: brand/title,
  connection status, update banner, and application theme render from explicit
  props/session state; the selected migrated theme updates CSS variables plus
  `theme-color`/`color-scheme`; terminal ANSI colors remain untouched. The theme
  editor and custom-theme mutation remain Step 5 work.
- [MH8] Desktop integration has one disposable owner — acceptance: browser
  fallback update polling and mocked Electron checking/downloading/downloaded/
  manual/error states render once; action calls the expected preload method; the
  status subscription and timers release on session disposal. Actual packaged
  Electron parity remains assigned to Step 12.
- [MH9] App-level accessibility and mobile shell facets are green — acceptance:
  the page has one main landmark, an accessible connection form/status live
  region, labeled controls, visible keyboard focus, an accessible reconnect
  dialog, no focus trap after dismissal, a usable 390-by-844 layout, and reduced
  motion disables nonessential shell animation. No accessibility dependency is
  added.
- [MH10] Disposal and partial boot failure are deterministic — acceptance:
  `Session.dispose()` unmounts the one Svelte root and releases its subscriptions,
  timers, desktop listener, and overlay; a Svelte mount failure clears the runtime
  slot and session diagnostic and does not fall through to a hidden legacy shell
  on `/phase2/`.
- [MH11] Step 2 evidence is honest and scoped — acceptance: the five `P2-2-*`
  rows append exact development/built replacement commands and results; Electron
  package facets remain `MISSING (Step 12)`; no Step 3-11 row is marked green.

## Out of scope

- Changing `/` to Svelte, deploying the preview, adding a long-lived feature
  flag, or certifying Phase 2 — Step 12 owns production cutover and certification.
- Dockview, saved layout, mobile panel sheet, terminal/output/input, settings
  editors, panels, maps, windows, IDE, notifications, sound, login-theme audio,
  effects, and debug tooling — their existing Phase 2 steps remain owners.
- A generic legacy-island registry, panel framework, app host class, global store,
  router, or dependency injection layer — no Step 2 behavior requires them.
- Removing any compatibility facade, `/js/app.js`, legacy shell markup, public JS
  utility, persistence key, Phase 0 harness, or rollback artifact.
- Generalizing the public `Session` for Phase 3 multi-session switching,
  background policy, commands, GMCP panels, or configuration editing.
- Docker, MCP, hosted CI certification, physical-device evidence, or source-free
  packaged Electron proof — Step 12 owns those integrated gates.

## Assumptions

- [A1] A temporary `/phase2/` built entry satisfies the master plan's
  non-production-owner rule — if false: stop before implementation and obtain an
  explicit cutover mechanism; do not hide the choice in a runtime flag.
- [A2] Later ports can start from one inert content host without running the
  entire legacy app inside the preview — if false: the first port needing a real
  legacy island must plan that one island's mount/dispose contract; Step 2 still
  must not add a speculative registry.
- [A3] The existing theme utility can remain a retained pure compatibility
  dependency while Svelte owns theme DOM application — if false: Step 2 must move
  the exact palette/application logic behind one tested client module, increasing
  scope; it must not fork two editable theme implementations.
- [A4] Playwright viewport emulation is the required Step 2 mobile evidence — if
  false: add the named physical-device gate before marking MH9 complete.
- [A5] The existing built server serves an added Vite MPA directory like
  `/phase0/` — if false: replan the preview URL at Green PR 2; do not alter `/`
  merely to make the test convenient.

## Risks

- Generalizing the boot callback could regress the certified legacy root —
  mitigation: make the production loader an explicit unchanged callback, keep
  `client/index.html` untouched, and run the existing boot, session, development,
  and production-artifact tests before any shell behavior is added.
- A public connection API could become a disguised transport leak — mitigation:
  freeze the five exact members above, return immutable copies, test disposal,
  and replan if a component asks for raw bus/transport/scope access.
- The preview route could silently drift because it is not the default entry —
  mitigation: include its one browser spec in both development and production
  Playwright configurations and probe its generated bundle/source-free behavior.
- Svelte and compatibility wiring could both update shell DOM — mitigation:
  `/phase2/` never imports `app.js`, never calls `markLegacyUiReady`, and tests one
  socket, one root, one overlay, and post-disposal absence.
- Endpoint precedence could change while moving away from toolbar DOM —
  mitigation: reuse the existing resolver and migration outputs, then cover URL,
  config/profile, blank fallback, Zork-only, and protocol-persistence cases.
- Update and countdown callbacks could survive disposal — mitigation: register
  every Svelte effect cleanup and desktop disposer, dispose via the public
  session path, and assert no later DOM update occurs.
- An incomplete preview may look like a production candidate — mitigation: label
  it as the Phase 2 integration shell, keep feature content inert, do not link it
  from `/`, and leave all non-Step-2 ledger rows unchanged.

## Green PR sequence

Each Green PR is independently reviewable and keeps `/` green. Do not combine
slices after a failure; repair the owning slice and rerun its downstream checks.

### Green PR 1 — Add the minimum public shell/session contract

**Files:** `client/runtime/session.ts`, `client/runtime/session-factory.ts`,
`test/session-runtime.test.mjs`

**Intent:** Add `SessionConnectionSnapshot` and the five exact `Session` members
in the Decisions section. Keep the mutable endpoint in the factory closure,
subscribe through the existing session event bus, own the returned subscription
and disposal callback through the existing resource scope, and expose neither
object. Preserve all existing `Session` methods and compatibility handles.

**Tests:** Extend the existing runtime fixture to prove:

1. the initial snapshot returns a copied baseline endpoint and disconnected state;
2. endpoint updates affect the next connect URL without mutating the server
   profile;
3. connect, connected, scheduled, idle/user-disconnect, and retry snapshots arrive
   in order;
4. two sessions do not cross-deliver snapshots; and
5. unsubscribe and `dispose()` stop callbacks while `onDispose` runs once.

**Verify:**

```sh
node --test test/session-runtime.test.mjs
npm run typecheck
```

**Done when:** The Svelte shell can drive connection behavior using `Session`
alone, and a repository search finds no new public exposure of factory handles,
transport, event bus, or resource scope.

### Green PR 2 — Reuse boot transaction for a non-default Svelte entry

**Files:** `client/app/bootstrap-transaction.ts`, `client/app/bootstrap.ts`,
`client/app/phase2.ts`, `client/app/App.svelte`, `client/phase2/index.html`,
`vite.config.ts`, `test/session-bootstrap.test.mjs`

**Intent:** Rename the transaction's final loader/boolean to generic client terms
and pass the created/reused runtime record to that loader. Keep the legacy root's
loader and fallback behavior unchanged. Add the `/phase2/` entry, mount one
minimal Svelte shell with the public session, register `unmount` through
`session.onDispose`, and render an accessible boot error instead of loading the
legacy app if Phase 2 mounting fails.

The transaction returns only the shell bootstrap values already resolved at the
boundary: game name, migrated application theme key, whether the configured/URL
host should auto-connect, and Zork-only launch state. It does not return the
application graph or internal handles. The Svelte component initially renders a
brand, integration-shell status, and one inert content host; no Dockview or
legacy manager is started.

**Tests:** Update the boot harness for generic load/reuse naming and add cases for
one client load, mount failure cleanup, and unchanged legacy loader order. Add a
browser smoke that proves `/` remains legacy while `/phase2/` has one Svelte root,
one session ID, no `/js/app.js` request, Howler availability, and unmount on
session disposal.

**Verify:**

```sh
node --test test/session-bootstrap.test.mjs test/session-runtime.test.mjs
npm run build
npm run test:browser -- e2e/phase2-shell.spec.ts --project=chromium
```

**Done when:** Both entries build source-free, `/` behavior is unchanged, and
`/phase2/` owns exactly one Svelte root and one public session without a feature
flag.

### Green PR 3 — Port connection controls, status, and reconnect overlay

**Files:** `client/app/App.svelte`, `client/app/phase2.ts`,
`e2e/phase2-shell.spec.ts`, `e2e/transports.spec.ts`

**Intent:** Render a native connection form using the session's initial endpoint,
the existing four protocols, URL/config/profile precedence, the Zork-only
override, and the existing protocol compatibility key. Drive connect/disconnect/
retry and all status/overlay rendering from one `subscribeConnection` effect.
Use component cleanup for the subscription, countdown, and focus restoration.

Do not port terminal/input as a shortcut for transport testing. Extend the
existing transport fixture file with a Phase 2 connection-only scenario that
asserts the runtime health URL, one socket, handshake receipt, and no fallback;
retain the existing legacy terminal/command scenario unchanged.

**Tests:** The shell spec covers manual connect/disconnect, connecting and
connected state, a failed connection followed by scheduled retry, Retry now,
Stop trying, countdown text, focus restoration, configured-host auto-connect,
URL and Zork-only precedence, and post-disposal silence. The transport spec runs
`ws`, `wss`, `telnet`, and `telnets` through `/phase2/` without a live MUD.

**Verify:**

```sh
npm run test:browser -- e2e/phase2-shell.spec.ts --project=chromium
npm run test:transports
```

**Done when:** Rows `P2-2-connection`, `P2-2-connection-overlay`, and
`P2-2-endpoint-controls` meet their development and built-web cutover conditions
with one session-owned transport.

### Green PR 4 — Complete chrome, theme, desktop, accessibility, and built evidence

**Files:** `client/app/App.svelte`, `client/app/phase2.ts`, `package.json`,
`playwright.production.config.ts`, `e2e/phase2-shell.spec.ts`

**Intent:** Apply the migrated application theme without changing terminal ANSI
variables; complete brand/title/status and the update banner; consume the
existing desktop status formatter and preload API with cleanup; add browser
fallback version polling; and finish semantic, focus, narrow-viewport, and
reduced-motion behavior. Expand the existing lint/format globs to include Svelte
files under `client/app` rather than creating new scripts.

Add `phase2-shell.spec.ts` to the production-browser configuration so the same
observable shell scenarios run against the built artifact. Mock
`window.darkflowDesktop` in that spec to prove update states, actions, and
listener disposal without claiming packaged Electron evidence.

**Verify:**

```sh
npm run typecheck
npm run check
npm run lint
npm run format:check
npm run build
npm run test:browser -- e2e/phase2-shell.spec.ts --project=chromium
npm run test:browser:production -- e2e/phase2-shell.spec.ts --project=chromium
```

**Done when:** Rows `P2-2-root-bootstrap` and `P2-2-chrome-theme-desktop` meet
their Step 2 cutover conditions, including narrow viewport, keyboard/focus,
theme, mocked desktop, and disposal evidence.

### Green PR 5 — Run the Step 2 regression gate and record evidence

**Files:**
`docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md`,
`docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md`,
`docs/plans/phase-2/multi-connection-ui-phase-2-step-2-implementation-plan.md`

**Intent:** Run the complete Step 2 battery from one clean candidate, append
replacement evidence only to the five `P2-2-*` rows, link this plan from the
master, and set Step 2 `COMPLETE` only if every owned facet is green. Preserve
the original Phase 1 baseline, row rollback text, the staged cutover rule, and all
Step 3-12 gaps.

Use the repository-pinned Node/npm toolchain:

```sh
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm test
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run typecheck
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run check
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run lint
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run format:check
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run build
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser -- --project=chromium
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser:production
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:transports
git diff --check
npx prettier --check docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md docs/plans/phase-2/multi-connection-ui-phase-2-step-2-implementation-plan.md
```

**Done when:** One candidate has all local Step 2 evidence, the five owned rows
are green without overstating Electron/package coverage, `/` remains the legacy
default, and Step 3 can plan against the frozen public shell/session boundary.

## Success criteria

- [ ] MH1-MH11 are satisfied and mapped to Green PR evidence.
- [ ] `/` still loads one legacy client through the existing production bundle.
- [ ] `/phase2/` loads one Svelte root and one public session without
      `/js/app.js`, a feature flag, or a second socket owner.
- [ ] Svelte imports neither `SessionFacadeHandles` nor compatibility bridges.
- [ ] All four transport fixtures pass through Phase 2 connection controls.
- [ ] Reconnect overlay, app chrome, theme, mocked desktop integration,
      390-by-844 layout, keyboard/focus, reduced motion, and disposal pass in
      development and built web.
- [ ] Unit, type, Svelte, lint, format, build/artifact, development-browser,
      production-browser, transport, and diff/plan-format checks exit cleanly.
- [ ] Only the five Step 2 ledger rows receive replacement evidence; actual
      packaged Electron and all later-port gaps remain open.

## Rollback

Step 2 never changes the default production root, so runtime rollback is to stop
serving or remove the non-linked `/phase2/` MPA entry. Revert the five Green PRs
in reverse order: evidence, shell behavior, Phase 2 entry/boot generalization,
then the public `Session` extension. The untouched `client/index.html`,
`/js/app.js`, public assets, compatibility facades, and certified pre-Step-2
artifact remain the functional rollback path.

If a Green PR fails, leave Step 2 `OPEN`, restore that slice's files, and rerun
all later checks affected by it. Do not switch `/` to Svelte to bypass a preview
route, build, or test failure.

## Execution fit

- Scope: multi-run phase
- Lead: Terra at high reasoning — the work is bounded, but one owner must preserve
  the frozen public session boundary, transaction rollback, DOM ownership, and
  cross-runtime evidence
- Workers: none — all five Green PRs share the session/bootstrap/shell contract
  and are sequential
- Delegation shape: solo staged handoff
- Ownership: the lead owns the public API decision, every shared bootstrap edit,
  integration, rollback, candidate selection, and final verification
- Replan trigger: the shell needs an internal handle or raw event bus; `/phase2/`
  cannot be served source-free; a real legacy feature must run before its owning
  step; public connection snapshots cannot represent disconnect/retry without a
  second state machine; or any existing `/` gate regresses
- Confidence: medium-high — the required behavior and existing seams are mapped;
  the main uncertainty is the boot callback generalization, and Green PR 2 tests
  it before visible shell work proceeds

Plan self-review: PASS (9/10)

Notes:

- Every must-have maps to an exact Green PR and runnable check.
- The plan adds no dependency, router, store, generic island framework, or
  production flag.
- Step 12 still owns default-root cutover, packaged Electron evidence, hosted
  certification, and global rollback.
