# Phase 1 Step 13 Implementation Plan

*Plan stress-tested via full adversarial review. 18 findings surfaced, 13
survived and shaped the plan below: 3 major structural corrections (the factory
return is insufficient for the facades; `state.ws` must be a WebSocket-shaped
proxy, not a truthy flag; three existing tests pin the Step 2 bootstrap
diagnostic), plus disposal-on-failure, boot idempotency, and grep-driven
enumeration. One assumption was conceded outright (truthy `state.ws` proxy) and
replaced.*

## Planning selection

- Mode: detailed implementation plan
- Complexity: 8/10 raw - the cutover step: the first Phase 1 change that wires
  `client/**` runtime code into the live boot path, the first to install any
  compat bridge for a real browser session, and the first to run the Step 4
  migration during a real boot. No hard trigger forces a phase map: one
  already-sequenced, independently revertible master-plan step, phase map
  already exists as the master plan. Residual ambiguity is resolved as
  documented assumptions and hard constraints.
- Hard triggers: none - single deliverable, one phase-gate continuation. Risk
  score 2 forces the explicit Rollback and go/no-go section below, not a phase
  map.
- Current planning horizon: `client/app/bootstrap.ts`, `public/js/state.js`,
  `public/js/gmcp.js`, `public/js/connection.js`, `public/js/app.js`,
  `public/js/settings-manager.js`, new `public/js/session-compat/runtime.js`,
  the additive `client/runtime/session-factory.ts` extension the review forced,
  and new/updated bootstrap and browser tests - the master plan's Step 13 Files
  list (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:496-515`)
  plus the factory and test files the review proved are load-bearing.
- Evidence horizon: the frozen `Session`/`SessionParts`/factory
  (`client/runtime/session.ts`, `session-factory.ts`, `session-registry.ts`);
  Step 4 storage/migration (`client/storage/repository.ts`,
  `legacy-migration.ts`, `config-validator.ts`); Step 5 configuration service
  (`client/configuration/service.ts`, `resolve.ts`); the SessionGmcpBus and
  SessionTransport interfaces; the two shipped compat bridges and the shipped
  automation runtime primitive; the legacy singletons and boot sequence; and
  every direct `state.ws` consumer plus the tests that pin the Step 2 bootstrap
  diagnostic.
- Adversarial review: full, applied (Skeptic, Validator, Researcher, Architect,
  Creative). Findings are folded into Evidence, Must-haves, Hard constraints,
  Risks, Steps, and Notes.

The clarification gate is skipped for the same reason Steps 3, 5, 6, 9, 11, and
12 skipped it: the product decision (the single visible UI runs entirely
through one explicit `Session` behind temporary facades) is approved at the
phase level (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:
113-117,496-515`); the remaining questions are integration-level.

## Goal

Make the shipped root run on the Phase 1 `Session`. At boot,
`client/app/bootstrap.ts` validates `/config.json`, runs the reversible Step 4
migration, resolves the one active provisional character, constructs exactly
one `Session` plus its session-owned automation runtime, installs the
configuration, automation, and a new runtime compatibility bridge, and only
then imports and initializes the legacy `public/js/app.js`. The legacy `state`,
`gmcp`, and `connection` modules keep their exported names and shapes but
delegate their socket, reconnect, GMCP, health, and configuration behavior to
the installed session. After this step the legacy connection module owns no
socket and no timer; there is exactly one connect/reconnect path; and one
`sessionId` threads through diagnostics from transport to GMCP to the UI. Every
change is gated on the bridges being active, so with them uninstalled (the
pre-cutover and rollback path) each adapted file behaves byte-identically to
today.

## Evidence and constraints

- `client/app/bootstrap.ts` today is the Step 2 diagnostic-only bootstrap: it
  validates a throwaway `BootstrapDiagnostic`, sets
  `window.__darkflowPhase1Bootstrap`, then `await import("/js/app.js")`
  (`client/app/bootstrap.ts:3,16-24`). This step replaces the body with the
  real cutover but must preserve the `__darkflowPhase1Bootstrap` diagnostic
  contract (see below).
- **[Review - major]** `createSessionFromState` returns only
  `{ success: true; data: Session }` (`client/runtime/session-factory.ts:31-37,
  155`), and the public `Session` exposes just connect/disconnect/dispose and
  the read snapshots (`client/runtime/session.ts:23-34`) - it exposes **no**
  GMCP bus, transport `send`, or `ResourceScope`. The factory also never
  constructs an `AutomationRuntimeState`; that primitive exists
  (`client/runtime/automation-runtime.ts:107`) but is wired nowhere. Therefore
  the facades cannot be built from the factory's current return. This step
  extends the factory additively (pre the Step 16 freeze) to construct the
  automation runtime on the session's own scope and to return the wiring
  handles the facades need. The public `Session` interface is unchanged.
- **[Review - major]** `state.ws` is used as a real `WebSocket`, not a boolean:
  `.readyState` is read in `output.js:1083,1407`, `rfc2549-debug.js:99`,
  `app.js:326`, `connection.js:79,526`, `settings-manager.js:925,2420`, and
  `panel-renderers.js:1439`; `.send()` is called in `connection.js:499` and
  `settings-manager.js:931`; `.close()` is called in `app.js:541,592`,
  `connection.js:831`, and `settings-manager.js:2289`. A truthy proxy is
  insufficient. The facade must set `state.ws` to a WebSocket-shaped proxy
  exposing `readyState`, `send`, and `close` that forward to the session
  transport. Because that proxy exposes `readyState`, the read-only consumers
  (`output.js`, `rfc2549-debug.js`, `panel-renderers.js`) need no edit, keeping
  the Files list bounded to the four modules that also call `.send()`/`.close()`
  plus the mirror owner.
- **[Review - major]** Three tests pin the Step 2 bootstrap diagnostic:
  `e2e/phase0-dev.spec.ts:21-25` and `e2e/production-artifact.spec.ts:92-96`
  assert `window.__darkflowPhase1Bootstrap.phase === "legacy-loaded"`, and
  `test/client-artifact.test.js:19,282` asserts the built artifact contains the
  literal `window.__darkflowPhase1Bootstrap = { phase: "legacy-loaded" };`. The
  new bootstrap must keep setting that exact diagnostic after the legacy import
  so those contracts survive, or update all three tests. This step preserves
  the diagnostic and adds a separate session diagnostic.
- `createSessionFromState(state, serverProfileId, characterProfileId, deps)`
  requires a `uuidFactory`, `SessionRegistry`, `getAutoReconnect`,
  `getClientInfo` returning a `CoreHello`, `appOrigin`, `webSocketFactory(url)`,
  `onlineTarget`, and optional `now` (`client/runtime/session-factory.ts:
  18-28`). It claims the registry (`:88`), seeds initial config from
  `resolveEffectiveConfiguration` (`:72`), wires
  `subscribe(characterProfileId, ...)` into runtime state (`:138-140`), and
  does **not** auto-connect. Bootstrap supplies every dep from browser globals.
- `createSessionRegistry()` enforces one live session per character and throws
  `DuplicateLiveSessionError` on a second claim
  (`client/runtime/session-registry.ts:17-23`). A double-boot bug surfaces as
  this throw, so bootstrap must be idempotent (Hard constraints).
- `migrateLegacyData(storage, configJson, urlSearchParams, uuidFactory)` is
  idempotent - `{ skipped: true }` when `hasValidState` is already true
  (`client/storage/legacy-migration.ts:74-82`) - never deletes a legacy key,
  and on first run sets `defaults.defaultCharacterProfileId` to the
  active-scope character (`:196-198`). Even with no legacy keys, migration
  always pushes the active scope from `/config.json` (`:102-109`), so a
  brand-new user still gets one server + one character. The persisted graph has
  no `activeCharacterProfileId` field (`client/model/profiles.ts:67-73`), so
  `defaults.defaultCharacterProfileId` is the sole active-character source.
- `readState`/`commit`/`hasValidState` (`client/storage/repository.ts:27,45,
  50`), `validateConfigJsonInput`/`DEFAULT_CONFIG_JSON`
  (`client/storage/config-validator.ts:18,64`), and `computeActiveScopeKey`
  (`:39-62`, a fallback if `defaultCharacterProfileId` is ever absent) are the
  storage entry points bootstrap composes.
- The configuration service publishes per character:
  `subscribe(characterProfileId, listener)`
  (`client/configuration/service.ts:65`) adds a listener but pushes **no**
  initial snapshot, and `replaceLocalDefinitions<K>(storage, characterId, kind,
  defs)` (`:156`) plus `publishConfigurationSet` (`:96`) notify on change.
  `resolveEffectiveConfiguration(state, characterId)`
  (`client/configuration/resolve.ts:24`) produces a full snapshot. So the
  configuration bridge object this step builds must implement
  `getEffectiveDefinitions(kind)` as a fresh resolve-over-current-state read
  (extracting `kind`), `replaceLocalDefinitions(kind, defs)` as the service
  call for the active character, and `subscribe(listener)` wrapping the
  service's per-character subscription - the configuration.js forwarder module
  is only a shell; Step 13 supplies the object (`public/js/session-compat/
  configuration.js:1-3` comment: "Step 13 installs a real bridge object").
- The frozen configuration bridge typedef
  (`public/js/session-compat/configuration.js:10-18`, installed via
  `installConfigurationCompatBridge`, `:26-28`) and automation bridge typedef
  (`public/js/session-compat/automation.js:6-21`, installed via
  `installAutomationCompatBridge`, `:29-31`) define the exact object shapes
  bootstrap must satisfy; the `AutomationRuntimeState` interface already matches
  the automation typedef by Step 12's construction.
- The legacy singletons the facade stands in for: `state.ws`,
  `state.reconnectTimer`, `state.connectTime`, byte counters, and the whole
  `state.wsHealth` block on one exported object (`public/js/state.js:1-30`);
  `gmcp.send` gates on `isSocketOpen(state.ws)` (`public/js/gmcp.js:116-117`).
- `connection.js` owns the socket and every timer: `connect()`
  (`public/js/connection.js:594`), `disconnect()` (`:823`), plus
  `forceReconnect`/`retryNow`/`ensureConnected`/`expectInboundWithin`/
  `sendSocketPayload`/`noteOutboundActivity`/`getWsDebugSnapshot`/
  `setConnectionState` (`:326-594`) - the exact functions `app.js` and the
  managers import (`public/js/app.js:5`). `sendSocketPayload` is also the text
  command path (`state.ws.send(payload)` at `:499`), so command sending routes
  through it. After this step connection.js owns no socket and no timer
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:507-508`).
- The legacy `gmcp` object implements `on/off/dispatch/send/
  serverSupportsPackage/sendHandshake/reset/sendSubscriptions/
  requestMediaRefresh/requestChannelPlayers/enableChannel/restartHandshake`
  (`public/js/gmcp.js:53-110` and below), and its `dispatch` calls
  `registerGmcpVariables(packageName, data)` on every frame
  (`public/js/gmcp.js:88`). The `SessionGmcpBus` exposes the same method names
  (`client/gmcp/bus.ts:73-85`), so `gmcp.*` maps one-to-one onto the bus.
- Two bus behaviors the facade must reconcile: the bus `dispatch` **drops** a
  modeled frame on validation failure (`client/gmcp/bus.ts:200-207`) but passes
  unknown packages straight to registered handlers (`:235-245`), so legacy
  handlers for unmodeled packages keep firing; and the bus `dispatch` does
  **not** call `registerGmcpVariables` (`:195-246`). Because Step 12 made
  `gmcp-variables.js` branch on the automation bridge
  (`public/js/gmcp-variables.js:69-70,85-86`), GMCP variables flow only if
  bootstrap registers a session-scoped `gmcp.on("*", registerGmcpVariables)`.
- `SessionTransport` exposes `state`/`connect`/`disconnect`/`retryNow`/
  `forceReconnect`/`send`/`getHealthSnapshot`/`dispose`
  (`client/transport/types.ts:87-96`); `send` accepts `string | Uint8Array`
  (`:94`), covering both text commands and GMCP bytes. The session already
  relays reconnect-status/handshake-guard/lost-transmission events onto the
  GMCP handshake (`client/runtime/session.ts:66-114`).
- `settings-manager.js`'s backup/export reads `aliasManager._data` and the
  other four managers' `_data` directly (`public/js/settings-manager.js:
  750-756`) and imports by writing the five legacy `_STORAGE_KEY`s
  (`:836-840`), bypassing every Step 11/12 adapter. Step 12 flagged this as a
  cutover prerequisite (`docs/plans/multi-connection-ui-phase-1-step-12-
  implementation-plan.md:399-415`); this step is the first to activate a bridge
  for a real user, so it owns the six-kind fix.
- `app.js` fetches `/config.json`, seeds the toolbar host/port/protocol fields,
  and calls `connect()` only when a host is configured
  (`public/js/app.js:443-473`), initializing settings/alias/highlight/trigger/
  timer/function managers before panels and the connection overlay
  (`:432-501`). A no-host config therefore auto-connects nothing today - the
  session must be created but left unconnected in that case (parity).
- The build/test scripts this step uses exist: `build`, `verify:client-artifact`,
  `test:browser`, `test:browser:production` (`package.json:44,46,50-51`); no
  `e2e/session-*.spec.ts` exists yet.

## Must-haves

- [MH1] Boot ordering is correct, single, and idempotent. Acceptance: a fixture
  proves exactly one `Session` is created and its registry claimed before any
  legacy manager `init()` runs, that no second session is ever claimed, and
  that re-running bootstrap (dev HMR / double import) does not create a second
  session or throw `DuplicateLiveSessionError`.
- [MH2] `/config.json` is validated and migration runs once without destroying
  legacy data. Acceptance: a legacy-keys-present fixture boots, migrates, and
  reads back a valid graph; a second boot is a no-op (`skipped: true`) leaving
  the graph and every legacy key untouched; a malformed `/config.json` falls
  back to `DEFAULT_CONFIG_JSON` without aborting boot.
- [MH3] The active character resolves deterministically to
  `state.defaults.defaultCharacterProfileId`, its server profile drives the
  transport endpoint, and a no-host/empty endpoint creates the session but
  auto-connects nothing (legacy parity). Acceptance: fixtures assert the
  session's character/server ids and transport endpoint match the active scope,
  and that an empty-host config yields a created-but-unconnected session.
- [MH4] Exactly one connect/reconnect path exists and connection.js owns no
  socket or timer when active. Acceptance: with the bridge active,
  `connect`/`disconnect`/`retryNow`/`forceReconnect` forward to the transport;
  a fixture proves connection.js constructs no `WebSocket` and schedules no
  timer, and `app.js`'s auto-connect drives the single session.
- [MH5] GMCP is session-scoped and complete through the facade. Acceptance:
  legacy `gmcp.*` route to the session bus when active; a modeled frame and an
  unmodeled frame each still reach a legacy handler; and `registerGmcpVariables`
  runs on every dispatched frame so alias `$gmcp.*` variables resolve (a
  fixture asserts a registered GMCP variable after dispatch).
- [MH6] `state.ws` is a WebSocket-shaped proxy and `state`/`wsHealth` readers
  keep working. Acceptance: with the bridge active, `state.ws.readyState`,
  `state.ws.send()`, and `state.ws.close()` forward to the session transport;
  `state.wsHealth`, connection timing, and byte counters reflect the transport's
  `getHealthSnapshot()` and reconnect-status events; `getWsDebugSnapshot()`
  carries the active `sessionId`.
- [MH7] Settings backup/export/import reflect true state for all six definition
  kinds when the configuration bridge is active. Acceptance: with the bridge
  active, `_buildSettingsBundle` and the import path route through the bridge
  for aliases, highlights, triggers, timers, functions, and key mappings; with
  it inactive, backup/export/import behave byte-identically to today.
- [MH8] Inactive-path parity is total and existing diagnostics survive.
  Acceptance: with all three bridges uninstalled, every adapted legacy file is
  byte-identical to its pre-step implementation; `window.__darkflowPhase1Bootstrap`
  still resolves to `{ phase: "legacy-loaded" }`; and `phase0-dev`,
  `production-artifact`, and `client-artifact` tests plus
  `verify:client-artifact` pass.
- [MH9] One `sessionId` threads through diagnostics from transport to GMCP to
  the UI. Acceptance: an e2e fixture reads the same `sessionId` from a transport
  diagnostic, a GMCP diagnostic, and `getWsDebugSnapshot()`.
- [MH10] Partial boot failure is safe. Acceptance: a fixture that forces a
  post-session-creation failure (e.g. bridge build throws) proves bootstrap
  disposes the created session (releasing the registry claim) and then loads
  the legacy app with all bridges uninstalled, degrading to pre-Phase-1
  behavior rather than leaving an orphaned claimed session.

## Out of scope

- Making long-lived GMCP-bound controllers disposable (Step 14) and browser
  listeners/schedulers/terminal resources disposable plus the 25-cycle disposal
  soak (Step 15); `e2e/session-disposal.spec.ts` is created there
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:517-551`).
- Any session create/close/switch/reorder UI or editing the toolbar endpoint to
  spawn/re-target a session; Phase 1's single session's endpoint is fixed at
  creation from the active server profile (`:121-123`).
- Deleting any legacy `_STORAGE_KEY`, removing `public/js/*`, or removing the
  facades - the rollback path until a later phase gate (`:129-131`).
- Changing the four transport contracts, `/proxy`, or any server-side code.
- Modeling additional GMCP packages; unmodeled packages continue through the
  bus passthrough (Evidence); the inventory is Step 8/16's.

## Assumptions

- [`state.defaults.defaultCharacterProfileId` is present and valid after a
  successful migration or an existing valid graph] - evidence-backed
  (`client/storage/legacy-migration.ts:196-198`,
  `docs/plans/multi-connection-ui-phase-1-implementation-plan.md:158-160`). If
  absent (a hand-edited/partial graph): bootstrap falls back to
  `computeActiveScopeKey`-to-server-to-character resolution; MH3 gets a
  no-default fixture.
- [The toolbar host/port/protocol fields remain display-only, seeded from the
  active server profile; editing them does not re-target the live session in
  Phase 1] - if false: endpoint edits need a visible parity note or a Phase 3
  session teardown/recreate. This is the one visible-behavior narrowing vs. the
  legacy free-form connect form; it must be recorded in the Step 16 decision.
- [Bootstrap owns config validation and session creation; `app.js` keeps its own
  `/config.json` fetch for toolbar seeding and its single `connect()` call,
  which now routes through the facade to the one session] - if false (a double
  connect appears): `app.js`'s auto-connect block gates on
  `isSessionRuntimeActive()` and the connect trigger moves into bootstrap.
- [A change to `/config.json`'s default endpoint between boots does not
  re-target the active character, because `defaultCharacterProfileId` is frozen
  at first migration] - accepted for Phase 1's single fixed character; record in
  the Step 16 decision so a later reader does not mistake it for a bug.

## Hard constraints

- Bootstrap constructs the automation runtime on the **session's own**
  `ResourceScope` (via the factory extension), never a second unowned scope, so
  `session.dispose()` (Step 14/15) cancels automation.
- Bootstrap installs all three bridges (configuration, automation, runtime)
  **before** `await import("/js/app.js")`, and the configuration and automation
  bridges must be installed together, because `timer-manager.js`'s
  reconciliation subscription only runs when both are active and otherwise stays
  dormant (`docs/plans/multi-connection-ui-phase-1-step-12-implementation-plan.md:
  348-360`).
- The session-scoped `gmcp.on("*", registerGmcpVariables)` wildcard (MH5) is
  registered before any manager initializes and is owned by the session scope,
  not left as a permanent top-level subscription.
- `state.ws`, when the bridge is active, is a WebSocket-shaped proxy exposing at
  least `readyState`, `send`, and `close` forwarding to the transport - never a
  bare boolean (defeated by the direct `.send()`/`.close()`/`.readyState`
  consumers in Evidence).
- Bootstrap is idempotent: a second invocation detects the existing session and
  returns without a second registry claim.
- On any failure after `createSessionFromState` succeeds, bootstrap calls
  `session.dispose()` before falling back to the bridges-uninstalled legacy
  path (MH10).
- The `__darkflowPhase1Bootstrap` diagnostic still resolves to
  `{ phase: "legacy-loaded" }` after the legacy import, preserving the three
  pinning tests (MH8).
- No adapted `public/js/**` file gains a static `import` of `client/**`; all
  `client/**` wiring is built in `bootstrap.ts` and passed into the JS bridges'
  `install*` functions. `verify:client-artifact` must still pass.

## Risks

- The state.js/connection.js facade is the highest-blast-radius change: an
  incomplete `state.ws` proxy or `wsHealth` mirror silently breaks status UI,
  lag monitor, command sending, or reconnect display without a thrown error.
  Mitigation: the grep sweep in Step 3 is a required artifact enumerating every
  `state.ws`/`state.wsHealth` reader and every `state.ws.` method call; the
  proxy implements the exact method/property set found; MH6 asserts forwarded
  behavior against a driven session, not "no throw."
- Forgetting the `registerGmcpVariables` wildcard leaves alias `$gmcp.*`
  variables silently empty once dispatch routes through the bus (the bus does
  not call it). Mitigation: MH5 makes a registered GMCP variable a tested
  assertion.
- Extending the factory return could break Step 10's `test/session-runtime.test.mjs`
  if it asserts exact result shape. Mitigation: the extension is additive (a new
  `handles` field alongside `data`); Step 5 runs that suite and adds a handles
  assertion rather than changing existing ones.
- Boot-time migration is the first real data-affecting event in production; a
  validation/commit failure must not brick boot. Mitigation: MH10's
  dispose-then-degrade path plus MH2's malformed-config fixture make a migration
  defect fall back to pre-Phase-1 behavior, not a blank screen.
- The settings backup/export change touches a user recovery path. Mitigation:
  MH7 tests both bridge states and asserts inactive-path byte parity; the change
  routes through the already-tested Step 11/12 bridge APIs, not new storage
  logic.
- Editing several live-imported legacy files at once raises regression surface.
  Mitigation: every change gates on the relevant `is*CompatActive()` flag, the
  inactive branch is a verbatim copy, and MH8 makes inactive-path parity plus
  `verify:client-artifact` a hard gate.

## Steps

### Step 1 - Build the session runtime compatibility bridge

**Files:** `public/js/session-compat/runtime.js` (new)

**Intent:** Mirror `session-compat/configuration.js`/`automation.js` exactly:
`let bridge = null;`, `installSessionRuntimeBridge`,
`resetSessionRuntimeBridgeForTests`, `isSessionRuntimeActive`, a `requireBridge`
throwing a distinctly named `SessionRuntimeBridgeNotInstalledError`, and one
forwarder per method the legacy modules actually delegate - enumerated from the
Step 2/3 grep sweep, not a speculative superset. The forwarder set covers
connection actions (`connect`, `disconnect`, `retryNow`, `forceReconnect`,
`ensureConnected`, `expectInboundWithin`, `sendPayload`), a `getWebSocketProxy`
returning the WebSocket-shaped `state.ws` proxy, health/state reads
(`getHealthSnapshot`, `getConnectionState`, `getSessionId`), and GMCP
(`gmcpOn`, `gmcpOff`, `gmcpDispatch`, `gmcpSend`, `gmcpServerSupportsPackage`,
`gmcpSendHandshake`, `gmcpReset`, `gmcpSendSubscriptions`,
`gmcpRequestMediaRefresh`, `gmcpRequestChannelPlayers`, `gmcpEnableChannel`,
`gmcpRestartHandshake`). Document the bridge with a JSDoc `@typedef`. Zero
imports beyond own exports.

**Verify:**

```bash
node --test test/session-runtime-bridge.test.mjs
npm run format:check
npm run lint
```

**Done when:** install/reset toggles `isSessionRuntimeActive()` atomically;
forwarders pass arguments through unchanged; an uninstalled call throws the
distinctly named error; no `client/**` import.

### Step 2 - Delegate the legacy `gmcp` object to the session bus

**Files:** `public/js/gmcp.js`

**Intent:** Branch each `gmcp` method on `isSessionRuntimeActive()`: active
delegates to the Step 1 `gmcp*` forwarders; inactive keeps today's
implementation verbatim, including `isSocketOpen(state.ws)` in `send` and
`registerGmcpVariables` in `dispatch`. Leave `normalizeGmcpFrame`/
`normalizeSupports`/`normalizeSubscriptionPayload` unchanged (the bus reuses
them). When active, the bus is the frame source; the legacy `dispatch` body
stays functional for any direct caller by forwarding to the bus.

**Verify:**

```bash
node --test test/session-runtime-bridge.test.mjs
```

**Done when:** inactive GMCP behavior is byte-identical; active `gmcp.*`
observably route to the injected bus and touch no legacy `state.ws`.

### Step 3 - Turn `connection.js` and `state.js` into transport facades

**Files:** `public/js/connection.js`, `public/js/state.js` (first: a grep sweep
artifact of all `state.ws`/`state.wsHealth` consumers)

**Intent:** Produce the grep sweep first and record it in the PR: every reader
of `state.ws`/`state.wsHealth` and every `state.ws.` method call (known set:
`output.js`, `rfc2549-debug.js`, `panel-renderers.js`, `app.js`,
`connection.js`, `settings-manager.js`). Then branch `connect`, `disconnect`,
`retryNow`, `forceReconnect`, `ensureConnected`, `expectInboundWithin`,
`sendSocketPayload`, `noteOutboundActivity`, `getWsDebugSnapshot`, and
`setConnectionState` on `isSessionRuntimeActive()`: active forwards to the
runtime bridge (transport) and constructs no `WebSocket` and no timer; inactive
keeps today's implementation verbatim. Install a facade sync (owned by the
session scope, driven from bootstrap) that sets `state.ws` to a WebSocket-shaped
proxy exposing `readyState`/`send`/`close` forwarding to the transport, and
mirrors the exact `state` fields the sweep found - `connectTime`, byte
counters, and the `state.wsHealth.*` block - from `getHealthSnapshot()` and
`transport:reconnect-status` events. The read-only `readyState` consumers need
no edit because the proxy exposes `readyState`. `getWsDebugSnapshot` includes
the active `sessionId`.

**Verify:**

```bash
node --test test/session-runtime-bridge.test.mjs
npm run build
npm run verify:client-artifact
```

**Done when:** with the bridge active, connection.js opens no socket/timer,
`state.ws.readyState`/`send`/`close` and the mirrored `wsHealth` fields forward
to the transport, and `getWsDebugSnapshot()` carries the `sessionId`; with the
bridge uninstalled, behavior is byte-identical (MH6, MH8).

### Step 4 - Route settings backup/export through the configuration bridge

**Files:** `public/js/settings-manager.js`

**Intent:** In `_buildSettingsBundle`, branch on `isConfigurationCompatActive()`:
active reads aliases, highlights, triggers, timers, functions, and key mappings
through the bridge's `getEffectiveDefinitions(kind)` (mapped to the bundle's
expected shape); inactive keeps the `manager._data` reads verbatim. Branch the
import path the same way: active writes via `replaceLocalDefinitions(kind, ...)`;
inactive keeps the direct `_STORAGE_KEY` writes. Also adapt the two
`state.ws.send()`/`state.ws.close()` call sites here (`:931,2289`) to the proxy
- covered automatically once Step 3's proxy exposes those methods, verified by a
fixture.

**Verify:**

```bash
node --test test/session-definition-adapters.test.mjs test/session-runtime-bridge.test.mjs
```

**Done when:** active backup round-trips true state through the bridge for all
six kinds; inactive backup/export/import are byte-identical (MH7).

### Step 5 - Extend the session factory to return facade handles and automation runtime

**Files:** `client/runtime/session-factory.ts`, `test/session-runtime.test.mjs`
(extend)

**Intent:** Additively (pre the Step 16 freeze, no change to the public
`Session` interface) construct `createAutomationRuntimeState(scope)` on the
session's own `ResourceScope` inside the factory, and widen the success result
to `{ success: true; data: Session; handles: SessionFacadeHandles }` where
`handles` exposes exactly what the facades need: the `SessionGmcpBus`, a
transport action/`send` surface, the `ResourceScope`, and the
`AutomationRuntimeState`. Existing `.data`/`.success` assertions are unchanged;
add a `handles`-present assertion.

**Verify:**

```bash
node --test test/session-runtime.test.mjs
npm run typecheck
npm run build
```

**Done when:** the factory returns the handles and a scope-owned automation
runtime; the existing Step 10 suite passes with the additive assertion; the
public `Session` interface is unchanged (MH1 groundwork, Hard constraints).

### Step 6 - Rewrite `bootstrap.ts` for the real cutover and adapt `app.js`

**Files:** `client/app/bootstrap.ts`, `public/js/app.js`

**Intent:** Replace the diagnostic body with, in order and guarded by an
idempotency check (skip if a session already exists): (1) fetch `/config.json`
and `validateConfigJsonInput`, falling back to `DEFAULT_CONFIG_JSON`; (2)
`migrateLegacyData(localStorage, config, urlParams, uuidFactory)` then
`readState`; (3) resolve the active character from
`state.defaults.defaultCharacterProfileId` and its `serverProfileId`; (4) build
`deps` from browser globals and call the extended `createSessionFromState`; (5)
using `handles`, build the configuration, automation, and runtime bridge
objects (the configuration object's `getEffectiveDefinitions` resolves fresh via
`resolveEffectiveConfiguration`, `replaceLocalDefinitions` calls the service for
the active character), and register the session-scoped
`gmcp.on("*", registerGmcpVariables)`; (6) install all three bridges together;
(7) `await import("/js/app.js")`; (8) set
`window.__darkflowPhase1Bootstrap = { phase: "legacy-loaded" }`. On any failure
after step (4), call `session.dispose()` and load the legacy app with bridges
uninstalled. In `app.js`, keep exactly one connect trigger (its `connect()` now
routes through the facade) and keep its `/config.json` fetch for toolbar
seeding only; gate its auto-connect on `isSessionRuntimeActive()` only if
fixtures show a double connect. Do not auto-connect when the endpoint host is
empty (parity).

**Verify:**

```bash
npm run typecheck
npm run build
npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium
```

**Done when:** exactly one session is created and claimed before any manager
init, and re-running bootstrap does not double-claim (MH1); migration runs once
and no-ops on second boot (MH2); active character/endpoint resolve, empty-host
creates-but-does-not-connect (MH3); one connect path (MH4); three bridges
installed together before the legacy import; partial failure disposes and
degrades (MH10); `__darkflowPhase1Bootstrap` still reads `legacy-loaded` (MH8).

### Step 7 - Prove the cutover and update the pinned bootstrap tests

**Files:** `e2e/session-single-runtime.spec.ts` (new), `e2e/phase0-dev.spec.ts`,
`e2e/production-artifact.spec.ts`, `test/client-artifact.test.js` (verify/update
for the new bootstrap), plus bootstrap test helpers as needed

**Intent:** Author the Playwright spec Steps 14-15 depend on, proving MH1-MH10:
single idempotent session before manager init; validated config and idempotent
migration across a reload; active character/endpoint resolution incl. empty-host
parity; one connect/reconnect path with no second socket; modeled and unmodeled
GMCP frames reaching legacy handlers plus a registered GMCP variable; the
WebSocket-shaped `state.ws` proxy and mirrored `wsHealth`; `sessionId` in the
debug snapshot; six-kind backup parity; and partial-boot dispose-and-degrade.
Confirm `phase0-dev`, `production-artifact`, and `client-artifact` still pass
(update only if the preserved diagnostic literal or bundle shape shifts).
Validate visible one-session UI parity against the Step 1 baseline scenarios
(`docs/plans/multi-connection-ui-phase-1-step-1-baseline.md`).

**Verify:**

```bash
npm run build
npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium
npm run test:browser:production
npm run verify:client-artifact
npm run format:check
npm run lint
npm run typecheck
git diff --check
```

**Done when:** every Must-have has a passing fixture; the master plan's Step 13
Done-when conditions
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:512-515`) hold;
the three pinned tests pass; production and artifact gates are green.

## Success criteria

- [ ] The shipped root creates exactly one `Session`, claims the registry once
      before any legacy manager subscribes, and re-running bootstrap does not
      double-claim.
- [ ] `/config.json` is validated and the Step 4 migration runs once, no-ops on
      the next boot, and never deletes a legacy key; malformed config degrades
      safely.
- [ ] The active character resolves from `defaults.defaultCharacterProfileId`
      and its server drives the endpoint; empty host creates-but-does-not-connect.
- [ ] Exactly one connect/reconnect path; connection.js owns no socket/timer
      when active.
- [ ] Legacy `gmcp.*` and `state`/`wsHealth` readers work through the session,
      `state.ws` is a WebSocket-shaped proxy, and `registerGmcpVariables` runs
      on every dispatched frame.
- [ ] Settings backup/export/import reflect true state for all six kinds when
      active, byte-identical when inactive.
- [ ] One `sessionId` threads through transport, GMCP, and UI diagnostics.
- [ ] Partial boot failure disposes the session and degrades to legacy behavior.
- [ ] With all bridges uninstalled, every adapted file is byte-identical,
      `__darkflowPhase1Bootstrap` still reads `legacy-loaded`, and
      `verify:client-artifact` passes.
- [ ] `build`, the new spec, `test:browser:production`, the three pinned tests,
      and the quality battery are green.

## Rollback

The first Phase 1 step that changes visible boot behavior, so rollback is
explicit. Reverting is a plain revert of the edited/new files (`bootstrap.ts`,
`session-factory.ts`, `state.js`, `gmcp.js`, `connection.js`, `app.js`,
`settings-manager.js`, the updated tests) plus deletion of
`session-compat/runtime.js` and the new spec; the previous built client ignores
`darkflow-session-core-v1` and reads untouched legacy keys, exactly as the
master plan's post-Step-4 rollback describes
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:602-605`). Do
not delete the Phase 1 key on rollback - it may hold later edits. External HTTP,
`/proxy`, Electron, and Docker contracts are unchanged; no server rollback or
backfill.

Go/no-go before merge: boot-time migration must degrade to bridges-uninstalled
legacy behavior on any config/migration/read failure (MH10), MH8's inactive
parity plus `verify:client-artifact` must pass, and the three pinned bootstrap
tests must be green. If any fails, hold the merge - a defect here reaches every
user's first boot.

## Execution fit

- Scope: multi-run phase (one step within Phase 1), the single highest-
  integration step in it.
- Lead: Sol at high reasoning - cross-cutting integration wiring the frozen
  output of Steps 3-12 into one live boot path, with real correctness/blast-
  radius risk (factory extension, WebSocket-proxy fidelity, boot-time
  migration), above the Terra-at-high tier used for Steps 5/6/9/11/12.
- Workers: one read-only scout to produce the Step 3 grep sweep of every
  `state.ws`/`state.wsHealth` consumer and `state.ws.` method call and confirm
  the single-connect-trigger in `app.js`; otherwise none. The factory
  extension, bootstrap order, bridge wiring, and facade shape are one coupled
  decision and should not be split across implementers.
- Delegation shape: solo with one read-only reconnaissance scout.
- Ownership: the lead owns the factory-handles extension, the bootstrap order
  and idempotency/dispose-on-failure guards, the WebSocket-proxy contract, the
  three-bridge install coupling, and the go/no-go before merge.
- Replan trigger: a `state.ws` consumer needs `WebSocket` behavior beyond
  `readyState`/`send`/`close`; `app.js` cannot keep one clean connect trigger
  without a larger edit (Assumption 3); the factory extension breaks a Step 10
  assertion in a non-additive way; or the active character cannot resolve from
  `defaultCharacterProfileId` for a real graph (Assumption 1).
- Confidence: medium - every composed primitive is frozen and proven, and every
  change is inert-by-default behind a bridge flag, but the factory extension,
  the WebSocket-shaped `state.ws` proxy, and the boot-time migration are this
  step's first-instance judgment calls and carry the program's highest single-
  step regression risk.

Plan self-review: PASS (9/10)

Notes:

- Full adversarial review changed the plan materially: it added the factory
  extension (Step 5) after proving the frozen `Session` return exposes no bus,
  transport, or scope; replaced the conceded truthy-`state.ws` assumption with a
  WebSocket-shaped proxy after finding direct `.send()`/`.close()`/`.readyState`
  consumers across six files; added the three pinned bootstrap tests to scope;
  and added idempotency and dispose-on-failure guards (MH1, MH10).
- The one visible-behavior narrowing (toolbar endpoint fields become display-
  only for the fixed single session) and the frozen-`defaultCharacterProfileId`
  behavior across config changes are both Step 16 decision-record items, not
  bugs.
- Steps 14-15 depend on the session scope owning the automation runtime and the
  GMCP-variables wildcard (Hard constraints) so their disposal soak can drive
  session-owned diagnostics to zero; wiring those under the scope now is what
  makes those later steps possible.
- The Step 3 grep sweep is a required PR artifact, not a formality: it is the
  evidence gate that confirms the WebSocket-proxy method set and the `wsHealth`
  mirror set are complete before the highest-blast-radius edit lands.
