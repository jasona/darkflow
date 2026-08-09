# Phase 1 Implementation Plan

Clarification gate skipped: this is a documentation-only expansion of the
bounded Phase 1 contract already approved in the multi-connection proposal.
Each numbered item below is an independently planned and reviewed Green PR;
when implementation reaches an item, it receives its own Step N implementation
plan before code changes begin.

## Goal

Extract a typed, session-scoped runtime underneath Darkflow's current visible
single-session client. Success means the existing UI still behaves as one
session, but its connection, reconnect, GMCP, profiles, configuration, runtime
state, and teardown are owned by an explicit `Session` rather than process-wide
browser singletons.

Phase 1 also establishes versioned server profiles, character profiles, shared
configuration sets, deterministic effective-configuration resolution, and a
reversible legacy-data migration. It does not expose multiple tabs or replace
the legacy workspace; it freezes the interfaces that Phases 2 and 3 will use.

## Evidence and constraints

- The proposal defines Phase 1 as `Session`, server/character profiles, shared
  configuration sets, effective configuration, scoped transport/reconnect,
  validated GMCP, event envelopes, versioned migration, deterministic disposal,
  and adaptation of the existing single-session UI
  (`docs/plans/multi-connection-ui-proposal.md:281-295`).
- The production root still loads `public/js/app.js` directly
  (`public/index.html:146-147`), while the Vite/Typia build has only the isolated
  Phase 0 HTML entry (`vite.config.ts:6-18`). Phase 1 TypeScript therefore needs
  a transformed production-root bootstrap before it can own live runtime state.
- The current runtime is a singleton: socket/reconnect/health fields live in
  `state` (`public/js/state.js:1-30`), transport timers and ladder state are
  module globals (`public/js/connection.js:32-51`), and GMCP handlers/supports
  live on one exported object (`public/js/gmcp.js:53-58`).
- Connection events currently omit session identity and are dispatched on the
  global document (`public/js/connection.js:74-97`). Many consumers also infer
  ownership through the current DOM or imported `state`; those imports must
  continue to work through a temporary one-session compatibility boundary until
  their Phase 2 ports.
- Automation is persisted in global documents whose active scope is derived
  from protocol, host, and port DOM fields, for example aliases
  (`public/js/alias-manager.js:255-294`) and timers
  (`public/js/timer-manager.js:173-215`). This cannot distinguish two character
  profiles on the same endpoint.
- Command history is one global local-storage record
  (`public/js/constants.js:6-7`, `public/js/input.js:754-781`), and workspace
  layout is one versioned global record (`public/js/panel-defs.js:56`,
  `public/js/panel-manager.js:42-42`, `public/js/panel-manager.js:779-779`). Both
  must become character-profile-owned without deleting their rollback source.
- `gmcp.dispatch` normalizes data and invokes handlers without runtime shape
  validation (`public/js/gmcp.js:71-109`). Handler failures are isolated today;
  Phase 1 must preserve that resilience while rejecting malformed modeled
  payloads before typed consumers see them.
- Direct `ws`/`wss` and bridged `telnet`/`telnets` URL behavior is already
  established in the legacy transport (`public/js/connection.js:615-633`) and
  covered by production fixtures. Phase 1 changes ownership, not those external
  contracts.
- TypeScript currently includes only `client/phase0/**`, and lint/format scripts
  are scoped the same way (`tsconfig.json:18-18`, `package.json:53-55`). Every
  production client source path must enter all four build-quality gates from its
  first PR.
- The root and MCP test suites are intended to be separate, but unqualified
  `node --test` can discover the nested `mud-test-mcp/test` tree. Step 1 makes
  that boundary deterministic before Phase 1 uses the suite as a regression
  signal.
- Mobile workspace coverage is currently explicitly skipped
  (`e2e/workspace-touch.spec.ts:94-94`). This plan does not silently reverse that
  product/testing decision.

## Must-haves

- [MH1] The production root executes Phase 1 through the existing transformed
  Vite/Typia pipeline before loading the legacy app. Acceptance: development and
  production render the unchanged single-session shell, the built root references
  a generated Phase 1 bundle, and an untransformed Typia call fails the existing
  bundle sentinel.
- [MH2] Stable UUID identities represent server profiles, character profiles,
  shared configuration sets, and ephemeral runtime sessions; application state
  is versioned once, and worlds retain server-defined source keys. Acceptance:
  structural and graph validation reject cross-collection IDs, dangling
  references, invalid versions, and malformed world keys; the runtime registry
  rejects a second live session for one character profile.
- [MH3] Existing user data migrates without destructive cleanup. Acceptance: an
  idempotent migration converts endpoint-scoped automation plus current
  app/character data into the Phase 1 document, validates the complete result
  before one atomic write, and leaves every legacy key untouched.
- [MH4] Effective configuration is deterministic and exposes provenance.
  Acceptance: built-ins resolve first, referenced sets in listed order, and
  profile-local entries last; later manager-specific identities replace earlier
  ones; every result identifies its source.
- [MH5] Shared-set changes propagate as immutable, whole revisions. Acceptance:
  persistence succeeds before publication, every attached live session observes
  one complete revision, stale revisions are rejected, and no session observes
  a partially updated collection.
- [MH6] GMCP is session-scoped and validated once at ingress for the Phase 1
  protocol catalog. Acceptance: unknown extra keys remain allowed, malformed
  known fields reach diagnostics but no typed handler, one throwing handler does
  not starve later handlers, and the session remains connected.
- [MH7] Transport and reconnect state are session-owned without changing the
  four shipped transport contracts. Acceptance: direct and proxy URL tests,
  fallback order, watchdog/reconnect behavior, handshake retry, and cancellation
  after disposal all pass with injected clocks and socket fixtures.
- [MH8] Runtime execution state is never shared with configuration definitions.
  Acceptance: timers, trigger cooldown/match state, recursion guards, waits,
  user/GMCP variables, and socket state are distinct per `Session`; only immutable
  definitions and their revisions propagate.
- [MH9] `Session.dispose()` is idempotent and complete. Acceptance: it closes the
  socket, cancels reconnect/watchdog/automation/RAF work, removes GMCP and DOM
  subscriptions, disconnects observers, releases controllers, and emits no
  session event after disposal.
- [MH10] Existing one-session behavior remains at parity through the current web
  and Electron production artifact. Acceptance: connection, output/input,
  reconnect, GMCP panels/windows, settings, automation, history, workspace
  persistence, production web, Electron smoke, Docker, transports, and MCP gates
  pass before the Phase 1 interfaces are frozen.

## Out of scope

- Connection tabs, session create/close/switch/reorder UI, multiple visible
  workspaces, inactive-render throttling, and cross-session notifications. Those
  are Phase 3 behavior.
- Replacing the visible app shell, adopting Dockview in production, porting
  panels to Svelte, bundling CodeMirror, or rewriting the terminal renderer.
  Those are Phase 2 work after the Phase 1 interfaces freeze.
- Shared-set attach/duplicate/detach user interfaces. Phase 1 implements and
  tests the storage/runtime operations; Phase 3 exposes them to players.
- Deleting legacy local-storage keys, deleting `public/js/*`, or removing the
  one-session compatibility facades. Legacy data and facades remain rollback
  paths until later phase gates pass.
- Moving world map records out of the existing IndexedDB/local-storage map
  layer. Phase 1 stores only the world reference needed by profiles and sessions;
  the map-data port remains later work.
- Validating every panel-specific GMCP package in one batch. Phase 1 covers the
  common session/auth packages and the Window, IDE, MapData2, and client-control
  families; remaining legacy-only packages stay on an inventoried diagnostic
  passthrough until their owning Phase 2 port adds a typed contract.
- Restoring or expanding the currently skipped mobile workspace suite.
- Server-side (`darkwind-nextgen`) protocol changes, new `/proxy` behavior,
  deployments, backfills, or published releases.

## Assumptions

- [A single versioned local-storage document is sufficient for the bounded
  Phase 1 profile/configuration MVP] - if false: Step 4 must introduce IndexedDB
  transactions and a repository abstraction before migration, increasing scope
  and changing rollback evidence.
- [A complete `localStorage.setItem` of the validated Phase 1 document is the
  persistence commit boundary] - if false: use a temporary-key plus promoted-key
  protocol and recovery marker; do not publish shared revisions before the
  durable commit is confirmed.
- [Legacy endpoint scopes can be represented as one provisional character
  profile per distinct endpoint, with current entries migrated as profile-local
  configuration] - if false: migration needs a user choice for character
  attribution and Step 4 must stop before writing ambiguous records.
- [The active endpoint at first migration owns the existing global command
  history, workspace layout, sound controls, and other character-scoped legacy
  values] - if false: those values cannot be assigned automatically and require
  a pre-migration selection UI, expanding Phase 1 beyond a background migration.
- [Temporary one-session `state`, `gmcp`, and connection facades are acceptable
  as migration boundaries] - if false: all current consumers must accept injected
  dependencies in Phase 1, pulling much of the Phase 2 port into this phase.
- [Unmodeled panel-specific GMCP may continue through a clearly labeled legacy
  passthrough until that panel is ported] - if false: split Step 8 into additional
  protocol-family steps and model every currently observed package before the
  compatibility cutover.
- [No Phase 1 implementation begins until Step 1 establishes a green
  loopback-capable CI baseline] - if false: later failures cannot be attributed
  reliably and the Green PR contract is lost.

## Risks

- A migration bug could orphan settings or attach them to the wrong character.
  Mitigation: read all legacy inputs first, validate a complete in-memory result,
  write one new key, keep old keys untouched, and test real exported fixtures plus
  malformed/partial variants.
- The compatibility facades could conceal an accidental dependency on the active
  DOM and make Phase 3 isolation fail later. Mitigation: keep facades in one
  directory, prohibit new imports through lint, expose session IDs in diagnostics,
  and record every remaining consumer in the Phase 1 decision.
- A raw legacy GMCP passthrough could be mistaken for validated data. Mitigation:
  expose it through a separately named compatibility API, mark diagnostics as
  `unmodeled`, never publish it on the typed bus, and freeze an explicit package
  inventory for Phase 2.
- Extracting transport logic can subtly alter fallback/reconnect timing.
  Mitigation: characterize the current ladder and timer behavior before moving
  code, inject clocks/WebSocket factories, and run all four shipped transport
  fixtures against the built browser.
- Shared edits can leak mutable runtime objects across sessions. Mitigation:
  deep-copy/validate persisted definitions, publish frozen effective snapshots,
  and keep every timer handle, cooldown, variable map, and execution guard under
  the owning session.
- Existing top-level listeners and intervals are difficult to dispose because
  their callbacks are anonymous. Mitigation: Steps 14-15 add explicit controller
  ownership and diagnostics before the final soak; no Phase 1 gate passes on
  inferred garbage collection alone.
- Changing the root HTML from a copied public file to a Vite entry could break
  development route order, desktop cookies, artifact parity, or source-free
  packages. Mitigation: Step 2 changes no visible behavior and reruns the full
  Phase 0 artifact/server/desktop contract before domain work begins.

## Step dependency order

```text
1 baseline
  -> 2 transformed root bootstrap
  -> 3 domain contracts
  -> 4 persistence and migration
  -> 5 effective configuration
  -> 6 event and disposal primitives
  -> 7 common validated GMCP bus
  -> 8 Darkwind session protocol catalog
  -> 9 scoped transport/reconnect
  -> 10 Session composition
  -> 11 definition-manager adapters
  -> 12 automation runtime isolation
  -> 13 legacy singleton compatibility cutover
  -> 14 GMCP controller teardown
  -> 15 browser resource teardown
  -> 16 parity gate and interface freeze
```

No later step may merge before its direct predecessor passes. Phase 2 panel work
may be planned in parallel, but implementation waits for Step 16's interface
decision.

## Individual implementation-plan steps

### Step 1 - Re-establish the Phase 1 baseline and parity contract

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-1-implementation-plan.md`](multi-connection-ui-phase-1-step-1-implementation-plan.md).

**Files:** `package.json`, `.github/workflows/ci.yml`,
`test/dev-server-integration.test.mjs`, `test/proxy-upgrade.test.js`, and
`test/server-lifecycle.test.js` (only if CI shows a genuine defect),
`docs/plans/multi-connection-ui-phase-1-step-1-baseline.md` (new)

**Intent:** Make root test discovery exclude `mud-test-mcp/test/**`, keep
`npm run test:mcp` as its own required clean-install gate, resolve any genuine
non-sandbox root failures, and record the current one-session parity scenarios
that later steps must preserve. This step changes no client behavior.

**Verify:** `npm test && npm run test:mcp`

**Done when:** loopback-capable CI is green for both isolated suites; the baseline
record lists exact commands, environment, failures resolved, and the representative
single-session browser scenarios used by Step 16.

### Step 2 - Put the production root behind the transformed bootstrap

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-2-implementation-plan.md`](multi-connection-ui-phase-1-step-2-implementation-plan.md).

**Files:** `client/index.html` (new), `client/app/bootstrap.ts` (new),
`public/index.html` (remove after moving unchanged markup), `vite.config.ts`,
`tsconfig.json`, `eslint.config.mjs`, `package.json`, `lib/dev-client.js`,
`server.js`, `lib/client-artifact.js`, artifact/server/browser tests

**Intent:** Make the root HTML a Vite entry while preserving its current markup,
styles, asset URLs, Howler load order, and visible behavior. The transformed
bootstrap runs first, exposes only a temporary diagnostic in this step, and then
dynamically imports `/js/app.js`; development serves transformed root HTML through
the existing Express/Vite origin, while production validates the generated root
bundle. Add all production `client/**` paths to typecheck, lint, format, and
bundle-sentinel
coverage.

**Verify:** `npm run format:check && npm run lint && npm run typecheck && npm run check && npm run build && npm run verify:client-artifact && npm run test:server:built && npm run test:browser:production`

**Done when:** `/` looks and behaves as before in development and production,
`dist/client/index.html` references a generated Phase 1 bundle, no raw `.ts`
ships, all `public/` assets except the moved HTML retain source parity, and Phase
0 server/Electron artifact contracts remain valid.

### Step 3 - Define scoped identities and domain contracts

Domain model reference: [`../session-model.md`](../session-model.md).

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-3-implementation-plan.md`](multi-connection-ui-phase-1-step-3-implementation-plan.md).

**Files:** `client/model/ids.ts`, `profiles.ts`, `configuration.ts`,
`session-contract.ts`, `validators.ts`, `test/session-model.test.mjs` (all new)

**Intent:** Define branded UUID identities for server, character,
configuration-set, and runtime-session scopes; define validated server-owned
world keys and versioned application state separately. Model ordered set
references by kind, profile-local definitions, character-owned history/layout/
audio controls, application defaults, and the rule that one character profile has
at most one live session. Hoist Typia validators in plain `.ts` modules and inject
the UUID factory in tests.

**Verify:** `node --test test/session-model.test.mjs && npm run typecheck && npm run build`

**Done when:** valid persisted graphs round-trip; invalid UUID shapes, versions,
enum kinds, world keys, dangling profile references, and cross-collection
configuration references are rejected with structured diagnostics; the
one-live-session rule has a typed registry contract for Step 10 to implement.

### Step 4 - Add versioned persistence and reversible legacy migration

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-4-implementation-plan.md`](multi-connection-ui-phase-1-step-4-implementation-plan.md).

**Files:** `client/storage/schema.ts`, `validators.ts`, `repository.ts`,
`legacy-migration.ts`, `legacy-keys.ts`, `config-validator.ts`,
`test/session-storage.test.mjs`, `test/fixtures/session-migration/**` (new)

**Intent:** Store the Phase 1 graph under one versioned key,
`darkflow-session-core-v1`. Validate `/config.json`, persisted JSON, and the final
migration result through transformed Typia factories. Migrate each legacy endpoint
scope to stable server/provisional-character records, migrate its definitions as
profile-local entries, assign global character data to the active endpoint, and
record migration provenance. Never delete or rewrite a legacy key.

**Verify:** `node --test test/session-storage.test.mjs && npm run build && npm run verify:bundle`

**Done when:** clean, repeated, malformed, partial, quota-failure, and interrupted
migration fixtures behave deterministically; only a fully validated graph is
committed; a second startup is a no-op; and the old client can still read all
legacy records after rollback.

### Step 5 - Resolve effective configuration and publish atomic revisions

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-5-implementation-plan.md`](multi-connection-ui-phase-1-step-5-implementation-plan.md).

**Files:** `client/configuration/identity.ts`, `resolve.ts`, `service.ts`,
`snapshot.ts`, `test/effective-configuration.test.mjs` (new)

**Intent:** Implement exact precedence and provenance for aliases (normalized
trigger), triggers/highlights (normalized pattern), functions/timers (normalized
name), and key mappings (key code): built-ins, ordered referenced sets, then
profile-local definitions. Persist a validated shared-set revision before
publishing one frozen effective snapshot to every attached live session; reject
stale compare-and-swap revisions. Definitions only are shareable.

**Verify:** `node --test test/effective-configuration.test.mjs`

**Done when:** order, conflicts, provenance, immutable snapshots, stale revisions,
failed persistence, and two attached-session propagation tests all pass without
sharing runtime state.

### Step 6 - Add session event envelopes and resource scopes

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-6-implementation-plan.md`](multi-connection-ui-phase-1-step-6-implementation-plan.md).

**Files:** `client/runtime/events.ts`, `event-bus.ts`, `resource-scope.ts`,
`diagnostics.ts`, `test/session-lifecycle-primitives.test.mjs` (new)

**Intent:** Introduce typed `{ sessionId, type, payload }` events and an idempotent
resource scope that owns timers, animation frames, subscriptions, observers,
listeners, child controllers, sockets, and teardown callbacks. Subscriptions
return explicit disposers; dispatch snapshots subscribers so one handler can
unsubscribe or throw without starving later handlers. Disposed scopes reject new
resources and suppress later events.

**Verify:** `node --test test/session-lifecycle-primitives.test.mjs`

**Done when:** wrong-session routing, handler failure, unsubscribe-during-dispatch,
reverse-order cleanup, repeated disposal, late async completion, and zero-post-
dispose-event cases pass under fake clocks.

### Step 7 - Implement the common validated per-session GMCP bus

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-7-implementation-plan.md`](multi-connection-ui-phase-1-step-7-implementation-plan.md).

**Files:** `client/gmcp/contracts/core.ts`, `char.ts`, `room.ts`, `comm.ts`,
`validators.ts`, `bus.ts`, `frame.ts`, `test/session-gmcp-bus.test.mjs` (new)

**Intent:** Move normalization, supports tracking, handshake/subscription state,
send behavior, and handler isolation behind an instance owned by one session.
Validate modeled Core, Char, Room, and Comm payloads after normalization and
before typed dispatch. Allow unknown object keys, reject malformed known fields
to session-tagged diagnostics, and retain the socket connection.

**Verify:** `node --test test/session-gmcp-bus.test.mjs && npm run build && npm run verify:bundle`

**Done when:** two bus instances cannot observe each other's handlers, supports,
subscriptions, variables, outbound socket, or diagnostics; malformed modeled
frames never reach typed handlers; and both transformed validator paths execute
in development and production.

### Step 8 - Add the Phase 1 Darkwind protocol catalog and legacy inventory

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-8-implementation-plan.md`](multi-connection-ui-phase-1-step-8-implementation-plan.md).

**Files:** `client/gmcp/contracts/darkwind-window.ts`,
`darkwind-ide.ts`, `darkwind-map-data-v2.ts`, `darkwind-client.ts`, their validator
registrations/tests, `docs/plans/multi-connection-ui-phase-1-gmcp-inventory.md`
(new)

**Intent:** Model and validate the Darkwind packages that cross session-core or
long-lived controller boundaries: server windows, IDE transfers, MapData2, client
subscriptions/NAWS/media refresh, and session recovery. Inventory every remaining
legacy package and expose it only through a separately named, session-tagged
`unmodeled` compatibility dispatch; it must never appear on the typed bus.

**Verify:** `node --test test/session-gmcp-darkwind.test.mjs && npm run typecheck && npm run build`

**Done when:** protocol docs and fixtures pass valid/malformed/unknown-key cases,
chunk/session IDs cannot cross sessions, and the inventory accounts for every
package registered by current `public/js/*` consumers.

### Step 9 - Extract scoped transport and reconnect ownership

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-9-implementation-plan.md`](multi-connection-ui-phase-1-step-9-implementation-plan.md).

**Files:** `client/transport/types.ts`, `urls.ts`, `health.ts`,
`connection.ts`, `reconnect.ts`, `test/session-transport.test.mjs`, existing
transport browser fixtures

**Intent:** Port the current ladder, proxy URL construction, connection epochs,
health watchdog, lost-transmission recovery, upgrade probe, reconnect backoff,
handshake retry, send accounting, and online recovery into an injected transport
instance. It emits session events and byte/GMCP callbacks rather than touching
DOM, panel, settings, or global state. Disposal cancels and closes every owned
resource.

**Verify:** `node --test test/session-transport.test.mjs && npm run test:transports`

**Done when:** characterized timing and fallback tests match legacy behavior;
`ws`/`wss` remain direct, `telnet`/`telnets` remain `/proxy` bridged, and forced
close/dispose tests prove no reconnect, probe, watchdog, send, or late socket
callback survives.

### Step 10 - Compose the Session and enforce live-character ownership

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-10-implementation-plan.md`](multi-connection-ui-phase-1-step-10-implementation-plan.md).

**Files:** `client/runtime/session.ts`, `session-factory.ts`,
`session-registry.ts`, `runtime-state.ts`, `test/session-runtime.test.mjs` (new)

**Intent:** Compose profile references, one effective-configuration snapshot,
transport, validated GMCP, diagnostics, mutable execution state, and resource
scope into the public `Session` interface. Separate `disconnect()` (transport
ends but profile/UI state remains reusable) from terminal `dispose()`. Add a
registry that rejects a second live session for one character profile even
though Phase 1 mounts only one session.

**Verify:** `node --test test/session-runtime.test.mjs`

**Done when:** create/connect/disconnect/reconnect/dispose transitions are explicit
and tested; two different characters may reference one server; duplicate live
character ownership fails; and disposal is idempotent from every lifecycle state.

### Step 11 - Adapt definition managers to profile/configuration snapshots

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-11-implementation-plan.md`](multi-connection-ui-phase-1-step-11-implementation-plan.md).

**Files:** `public/js/alias-manager.js`, `highlight-manager.js`,
`function-manager.js`, key-mapping portions of `settings-manager.js`, new
`public/js/session-compat/configuration.js`, existing/new manager tests

**Intent:** Stop deriving definitions from toolbar endpoint scope. Make aliases,
highlights, functions, and key mappings read/write through the active character's
profile-local/shared-set service while preserving their current exported APIs for
the legacy settings UI. Keep user automation variables out of shared alias
definitions and expose definition source/revision through the compatibility API.

**Verify:** `node --test test/alias-expression-core.test.mjs test/automation-script-core.test.mjs test/session-definition-adapters.test.mjs`

**Done when:** current manager behavior remains green, same-server character
fixtures stay isolated, shared definitions resolve with provenance, and no
adapted manager reads its active scope from `dom.host`, `dom.port`, or protocol.

### Step 12 - Isolate trigger/timer execution and shared-set propagation

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-12-implementation-plan.md`](multi-connection-ui-phase-1-step-12-implementation-plan.md).

**Files:** `public/js/trigger-manager.js`, `timer-manager.js`,
`automation-executor.js`, `gmcp-variables.js`, related adapters and tests

**Intent:** Move trigger/timer definitions to effective snapshots while creating
session-owned execution containers for timer handles, cooldown/match state,
waits, recursion guards, user variables, and GMCP variables. Reconcile a new
definition revision atomically: keep still-valid runtime entries, stop removed
timers, start newly enabled auto-timers once, and never transfer runtime objects
between sessions.

**Verify:** `node --test test/automation-executor.test.mjs test/gmcp-variables.test.mjs test/session-automation-runtime.test.mjs`

**Done when:** two-session unit fixtures share revisions but not runtime state;
definition edits never double-start timers; removed definitions clean up; and
session disposal cancels all delayed automation.

### Step 13 - Cut the current UI over through one-session compatibility facades

Detailed implementation plan:
[`multi-connection-ui-phase-1-step-13-implementation-plan.md`](multi-connection-ui-phase-1-step-13-implementation-plan.md).

**Files:** `client/app/bootstrap.ts`, `public/js/state.js`, `gmcp.js`,
`connection.js`, `app.js`, `settings-manager.js`, new
`public/js/session-compat/runtime.js`, bootstrap/browser tests

**Intent:** In exact order, fetch and validate `/config.json`, open/migrate the
profile store, resolve the active provisional character, create one `Session`,
install the temporary `state`/`gmcp`/connection facades, and only then import and
initialize the legacy app. Existing import names remain stable, but their socket,
reconnect, GMCP, health, settings, and profile data delegate to the installed
session. The legacy connection module retains only facade functions; it owns no
socket or timer.

**Verify:** `npm run build && npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium && npm run test:browser:production`

**Done when:** the shipped root creates exactly one session before any legacy
manager subscribes, one connect/reconnect path exists, existing UI controls and
debug output remain at parity, and diagnostics attach the same `sessionId` from
transport through GMCP and UI adapters.

### Step 14 - Make GMCP-bound legacy controllers explicitly disposable

**Files:** `public/js/panel-manager.js`, `window-manager.js`, `ide-manager.js`,
map controllers, notification/sound/visual/combat/tutorial and other GMCP-bound
managers, `public/js/session-compat/controllers.js`, lifecycle tests

**Intent:** Make each long-lived controller return or expose one disposer that
releases every GMCP subscription and controller-owned timer/observer/listener.
Use the session resource scope to own those disposers. Preserve panel rendering
and layout behavior; this step changes lifecycle ownership only.

**Verify:** `node --test test/session-gmcp-controller-lifecycle.test.mjs && npm run test:browser -- e2e/session-disposal.spec.ts --project=chromium`

**Done when:** repeated create/dispatch/dispose cycles return GMCP handler and
controller diagnostics to zero, no disposed controller handles later frames, and
all existing controller behavior tests remain green.

### Step 15 - Make browser listeners, schedulers, and terminal resources disposable

**Files:** `public/js/app.js`, `input.js`, `output.js`, `panel-manager.js`,
connection overlay/status/debug modules, `client/runtime/diagnostics.ts`,
browser lifecycle tests

**Intent:** Replace anonymous top-level listener/timer/RAF/observer ownership with
named controller initialization returning explicit disposers. Register app,
input, output, panel timers, version polling, mutation/resize/visibility/online
listeners, debounced persistence, terminal render scheduling, and any remaining
resources under the session or application scope as appropriate.

**Verify:** `npm run test:browser -- e2e/session-disposal.spec.ts --project=chromium && npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium`

**Done when:** 25 create/connect/disconnect/dispose cycles leave zero session
sockets, reconnects, timers, RAF callbacks, observers, GMCP handlers, DOM
listeners, terminal schedulers, and post-disposal events, without changing the
visible one-session UI.

### Step 16 - Run the parity gate and freeze Phase 1 interfaces

**Files:** `docs/plans/multi-connection-ui-phase-1-step-16-decision.md` (new),
`docs/plans/multi-connection-ui-phase-1-gmcp-inventory.md`, this master plan,
CI/browser parity fixtures as needed

**Intent:** Run the complete clean-install and release-adjacent battery against
the session-backed root. Record exact `Session`, event-envelope, profile,
configuration, repository, transport, GMCP, and disposal interfaces; list every
temporary compatibility facade and unmodeled GMCP package with its Phase 2/3
owner; record migration/rollback evidence and known limitations. Mark Phase 1
complete only if one-session parity and teardown gates pass.

**Verify:** `npm run format:check && npm run lint && npm run typecheck && npm run check && npm test && npm run build && npm run verify:client-artifact && npm run test:server:built && npm run test:browser && npm run test:browser:production && npm run test:transports && npm run desktop:smoke && npm run test:mcp`

**Done when:** all required CI jobs are green from a clean checkout; the decision
record contains commands and evidence; the frozen interfaces have no unresolved
ownership ambiguity; and Phase 2 is explicitly unblocked or Phase 1 remains open.

## Phase 1 gate

- [ ] Root runtime goes through a transformed Vite/Typia bootstrap in development
      and production.
- [ ] Versioned profile/configuration data validates and migrates idempotently
      without deleting legacy data.
- [ ] Effective configuration precedence, provenance, stale-write rejection, and
      whole-revision propagation pass.
- [ ] Modeled GMCP rejects malformed known fields without crashing or
      disconnecting; unmodeled packages are separately inventoried.
- [ ] Transport behavior remains identical for `ws`, `wss`, `telnet`, and
      `telnets`, including reconnect teardown.
- [ ] Runtime automation state is isolated from shared definitions.
- [ ] The legacy single-session UI runs entirely through one explicit `Session`.
- [ ] Repeated full disposal returns all session-owned diagnostics to zero.
- [ ] Web, built artifact, Electron, Docker, transport, and MCP gates pass.
- [ ] Step 16 freezes the interfaces and assigns every compatibility debt item to
      a later phase.

## Rollback

Each step lands separately and may be reverted independently before its successor
starts. Steps 1-3 and 6-10 create code/contracts but do not mutate user data.

Step 4 is the first data-affecting change. Rollback serves the previous built
client, which ignores `darkflow-session-core-v1` and continues reading untouched
legacy keys. Do not delete the new Phase 1 key automatically during rollback; it
may contain later user edits. If implementation requires an explicit cleanup
tool, it must export the Phase 1 document first and require direct user action.

After Step 13, revert in reverse dependency order (15/14 lifecycle adapters,
then 13 compatibility cutover) or redeploy the last pre-cutover artifact. The
external HTTP, `/proxy`, Electron, Docker, and on-disk legacy-key contracts do not
change, so no server rollback or data backfill is required.

Plan self-review: PASS (9/10)

Notes:

- Every Phase 1 item is bounded enough to receive its own implementation plan;
  Steps 11-15 deliberately separate definition, execution, compatibility, GMCP
  controller, and browser-resource ownership instead of hiding them in one
  "adapt the UI" change.
- The only intentional transitional hole is the named unmodeled-GMCP path. It is
  excluded from typed consumers and must have a complete Step 8/16 inventory.
- Loopback-dependent commands may fail with `EPERM` in a restricted local
  sandbox. Required CI remains authoritative; environment failures must be
  recorded separately from repository regressions.
