# Phase 1 Step 10 Implementation Plan

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 - one bounded new subsystem (`client/runtime/session*.ts`,
  `runtime-state.ts`, four new files, zero importers yet, `client/runtime/**`
  already covered by every quality gate), but it is the first module to
  compose six already-frozen subsystems (Step 3 identities, Step 5 effective
  configuration, Step 6 disposal/event primitives, Step 7 GMCP bus, Step 9
  transport) into one public interface and must resolve several
  composition-order and event-wiring judgment calls that repository evidence
  resolves rather than open product questions
- Hard triggers: none - one deliverable, one phase-gate continuation, nothing
  wired into the boot path, no user-requested sequencing
- Current planning horizon: `client/runtime/session.ts`, `session-factory.ts`,
  `session-registry.ts`, `runtime-state.ts`, and `test/session-runtime.test.mjs`,
  exactly as scoped by the master plan's Step 10 entry
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:433-449`)
- Evidence horizon: the frozen `SessionDescriptor`/`SessionRegistry`/
  `DuplicateLiveSessionError` contract (`client/model/session-contract.ts`),
  the Step 9 `SessionTransport`/`ReconnectController` event surface in full
  (`client/transport/types.ts`, `connection.ts`, `reconnect.ts`), the Step 7
  `SessionGmcpBus` send/dispatch surface (`client/gmcp/bus.ts`), the Step 6
  `ResourceScope`/`SessionEventBus`/`SessionDiagnostics` primitives, the Step 5
  effective-configuration resolve/publish/subscribe surface
  (`client/configuration/{resolve,service,snapshot}.ts`), the `ServerProfile`/
  `CharacterProfile` shapes (`client/model/profiles.ts`), and the legacy
  `ws.onopen`/handshake-guard/lost-transmission call sites in
  `public/js/connection.js` that this step must reproduce through composition
  rather than reimplementation
- Adversarial review: focused, self-applied (Skeptic/Architect/Creative
  lenses) - this step freezes the `Session` public interface Step 16 records
  and Phases 2-3 depend on, and one lens (Skeptic) surfaced a real gap left
  open by Step 9's own risk log: the ported `lost-transmission-detected`
  signal fires at *detection* time, not at the delayed *recovery* moment
  legacy actually calls `gmcp.restartHandshake()` from, and the delayed
  internal timer in `reconnect.ts` publishes no session event at all. That
  finding reshaped Must-have 5 and Assumption 1 below. Findings are folded
  into Evidence, Must-haves, Assumptions, and Risks rather than kept separate.

The clarification gate is skipped for the same reason Steps 3, 5, 6, 7, 8, and
9 skipped it: the product decision (session-scoped composition with a
one-live-session-per-character registry) is already approved at the phase
level (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:9-15`).
This plan resolves the remaining implementation-level ambiguities as
documented assumptions, because repository precedent and the legacy call
sites already answer them.

## Goal

Give Phase 1 a composed `Session`: one object per live character that owns a
`SessionTransport` (Step 9), a `SessionGmcpBus` (Step 7), a `ResourceScope`,
`SessionEventBus`, and `SessionDiagnostics` (Step 6), an effective-configuration
snapshot that stays live via Step 5's publish/subscribe contract, and the
minimal mutable runtime state (login-detection flag, effective-configuration
reference) needed to drive them. `Session` reproduces the exact
GMCP-handshake choreography `public/js/connection.js`'s `ws.onopen` /
handshake-guard / lost-transmission-recovery call sites perform today, but as
event-driven composition instead of direct calls, and enforces the frozen
`SessionRegistry` contract's one-live-session-per-character rule. Nothing
built in this step is imported into the boot path, a legacy manager, or any
UI code; that begins at Step 11 (definition-manager adapters) and Step 13
(compatibility cutover).

## Evidence and constraints

- `SessionRegistry`/`SessionDescriptor`/`DuplicateLiveSessionError` are
  already frozen as an interface contract with a doc comment naming this step
  as the implementer (`client/model/session-contract.ts:10-44`), and
  `docs/session-model.md:39-42,73-77` documents the one-live-session-per-
  character rule as the only cross-cutting invariant this step must enforce.
- The Step 9 transport requires four callbacks with no defaults:
  `getEndpoint()`, `getAutoReconnect()`, `isLoggedIntoCharacter()`, `onText()`,
  `onGmcpFrame()` (`client/transport/types.ts:78-84`), and its own plan
  explicitly assigns backing them to "the composer (Step 10/13)"
  (`docs/plans/multi-connection-ui-phase-1-step-9-implementation-plan.md:324-327`).
  `ServerProfile.protocol`/`host`/`port` supply `getEndpoint()`'s data, but
  `port` is a validated `number` (`client/model/profiles.ts:18-26`) while
  `TransportEndpoint.port` is a `string` (`client/transport/types.ts:7-11`);
  the endpoint callback must convert.
- The transport publishes exactly five named `SessionEvent`s with no
  subscriber yet: `transport:reconnect-status` (four-value status including
  `'connected'`, `client/transport/reconnect.ts:152-166`),
  `transport:handshake-guard-elapsed` (fired **after** its 3000ms delay
  already elapsed, `client/transport/reconnect.ts:319-341`),
  `transport:lost-transmission-detected` (fired **immediately** at pattern
  detection, before any delay, `client/transport/reconnect.ts:350-377`),
  `transport:transport-fallback`, and `transport:upgrade-available` (already
  fully handled inside `reconnect.ts` via its own `onUpgrade` callback -
  `client/transport/connection.ts:113-115` - so it needs no Session-level
  action). Step 9's own risk log states this gap explicitly and names this
  step as the required subscriber
  (`docs/plans/multi-connection-ui-phase-1-step-9-implementation-plan.md:826-831`).
- Legacy's actual handshake choreography, which this step's event wiring must
  reproduce: `ws.onopen` calls `panelManager.resetData()` then
  `gmcp.sendHandshake()` then `gmcp.sendSubscriptions({reason: wasReconnect ?
  'reconnect' : 'login', full: true, ...})` (`public/js/connection.js:696-706`);
  `scheduleHandshakeGuard`'s timer calls the same two sends again
  (`public/js/gmcp.js:227-228` inlined at `public/js/connection.js:227-239`,
  ported without the direct call at `client/transport/reconnect.ts:319-341`);
  and `scheduleLostTransmissionRecovery`'s **delayed** callback (not its
  immediate detection branch) calls `gmcp.restartHandshake({reason:
  'lost-transmission', ...})` only if the socket is still open
  (`public/js/connection.js:455-468`).
- `wasReconnect` is read as `state.reconnectAttempts > 0` at the very top of
  `ws.onopen`, before `state.reconnectAttempts` is zeroed two lines later
  (`public/js/connection.js:667,673`). The ported transport zeroes the
  equivalent `reconnect.state.reconnectAttempts` **before** publishing
  `transport:reconnect-status` with `status: 'connected'`
  (`client/transport/connection.ts:271,277`), so by the time this step's
  subscriber observes the event, that counter has already reset to zero and
  cannot supply `wasReconnect` even if it were exposed. This step must derive
  the login-vs-reconnect distinction from its own state instead.
- `loggedIntoCharacter()` reads `panelManager.gmcpData.vitals`
  (`public/js/connection.js:154-157`), a field `panelManager.js` sets whenever
  a `Char.Vitals` GMCP frame arrives (`public/js/panel-manager.js:3396`). No
  panel manager exists in `client/**` yet (Step 14 ports it), so this step's
  only legitimate non-DOM source for the same signal is subscribing its own
  `SessionGmcpBus` to the canonical `"Char.Vitals"` package name
  (`client/gmcp/frame.ts:11,241`) and tracking receipt directly.
- `SessionGmcpBus.sendHandshake(clientInfo: CoreHello)` takes a required
  `{client, version, width, height}` argument with no default
  (`client/gmcp/contracts/core.ts:2-7`, `client/gmcp/bus.ts:80,257-263`); this
  step has no terminal-geometry source (Step 15 owns that), so it needs an
  injected `getClientInfo(): CoreHello` callback, mirroring the
  no-default-callback pattern Step 9 already established for
  `isLoggedIntoCharacter`.
- `createSessionGmcpBus(sessionId, sendSink, diagnostics)` takes a bound
  `sendSink: (bytes: Uint8Array) => boolean` at construction
  (`client/gmcp/bus.ts:89-95`), and `createSessionTransport(...)` takes bound
  `callbacks.onGmcpFrame` at construction (`client/transport/connection.ts:72-84`).
  Each needs the other's instance before either can be fully constructed;
  Step 9's own plan already anticipated this is resolvable with "only a bound
  method reference," not an adapter function
  (`docs/plans/multi-connection-ui-phase-1-step-9-implementation-plan.md:221-225`).
- `resolveEffectiveConfiguration(state, characterProfileId)` takes the full
  `ApplicationStateV1` and returns a `ValidationResult`
  (`client/configuration/resolve.ts:24-73`), and
  `subscribe(characterProfileId, listener)` /
  `publishConfigurationSet(storage, input)` in
  `client/configuration/service.ts:54-77,85-142` are the only existing
  callers/producers of live snapshot propagation; no production code
  subscribes yet, so this step is Step 5's first real consumer, matching how
  Step 9's plan itself was the first named consumer of Step 6's event bus.
- Step 13's own intent already separates "fetch and validate `/config.json`,
  open/migrate the profile store, resolve the active provisional character,
  create one `Session`" as sequential bootstrap phases
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:493-495`),
  which means the already-loaded, already-validated `ApplicationStateV1` is
  available to whatever calls this step's factory; this step's factory does
  not need its own `StorageLike` parameter or its own `readState` call.
- `client/runtime/**/*.ts` is already included in `tsconfig.json:23`,
  `eslint.config.mjs:12`, and the `lint`/`format`/`format:check` globs in
  `package.json:53-55` (added by Step 6). Unlike Step 9, this step adds no new
  top-level `client/**` directory and needs no glob-registration work.
- The Step 6/7/9 Vite-SSR test harness pattern
  (`test/session-gmcp-bus.test.mjs:1-40`, `test/session-transport.test.mjs:1-50`)
  imports modules through `server.environments.ssr.runner.import(...)`, uses
  `ids.createSequentialUuidFactory()` for deterministic IDs, and (in the
  transport test) stubs `globalThis.requestAnimationFrame`/
  `cancelAnimationFrame` plus a fake `WebSocketLike` class and `t.mock.timers`.
  This step's test file follows the identical pattern, adding
  `/configuration/{resolve,service,snapshot}.ts` and `/model/{profiles,ids}.ts`
  to the import set.

## Must-haves

- [MH1] `Session` composes exactly the parts the master plan names - profile
  references, one effective-configuration snapshot, transport, validated
  GMCP, diagnostics, mutable execution state, and resource scope - behind one
  public interface with no other module able to reach the transport socket,
  GMCP handler registry, or resource scope directly. Acceptance: `session.ts`
  exports no internal part directly; every external interaction goes through
  `Session`'s own methods/read models.
- [MH2] `connect()`/`disconnect()`/`dispose()` are distinct and match the
  master plan's own separation. Acceptance: `disconnect()` ends the
  transport's socket but leaves the `Session` object, its registry claim, and
  its effective-configuration subscription intact and reusable via a later
  `connect()`; `dispose()` is terminal, idempotent from every lifecycle state
  (never connected, connecting, connected, disconnected-but-not-disposed),
  releases the registry claim, unsubscribes from configuration updates,
  disposes the GMCP bus's send path, and disposes the resource scope exactly
  once per Step 6's own idempotency contract.
- [MH3] The registry enforces one live session per character profile and
  nothing coarser. Acceptance: a second `createSessionFromState` call for the
  same `characterProfileId` while the first session is still live throws
  `DuplicateLiveSessionError` without constructing any transport/GMCP/scope
  resources for the rejected attempt; two different `characterProfileId`s
  referencing the same `serverProfileId` each succeed and run concurrently;
  after the first session's `dispose()`, a new session for the same character
  succeeds.
- [MH4] On the transport's first `transport:reconnect-status` event with
  `status: 'connected'`, `Session` sends `Core.Hello` then
  `Core.Supports.Set` then `Darkwind.Client.Subscriptions` through the real
  `SessionGmcpBus`/transport send path, with the subscriptions payload's
  `reason` field `'login'` on the session's first successful connect and
  `'reconnect'` on every connect after that, derived from the session's own
  tracked state rather than any transport-exposed counter (per the
  `reconnectAttempts`-already-reset evidence above). Acceptance: a fixture
  driving the fake socket's `onopen` twice (a fresh connect, then a forced
  reconnect) asserts the encoded outbound bytes decode to those three
  packages in order each time, with `reason` flipping from `'login'` to
  `'reconnect'`.
- [MH5] `Session` closes the Step 9-documented handshake-guard and
  lost-transmission gaps. Acceptance: on `transport:handshake-guard-elapsed`,
  `Session` immediately resends `Core.Hello` + `Core.Supports.Set` +
  `Darkwind.Client.Subscriptions`; on `transport:lost-transmission-detected`,
  `Session` schedules its own `LOST_TRANSMISSION_RECOVERY_DELAY_MS`-delayed
  call (through its own `ResourceScope`, using the constant exported from
  `client/transport/reconnect.ts`) to `restartHandshake({reason:
  'lost-transmission'})`, and that scheduled call is cancelled with zero
  effect if `dispose()` runs before the delay elapses - matching Step 9's own
  MH7 disposal pattern applied at the `Session` level.
- [MH6] `isLoggedIntoCharacter()` is answered from GMCP, not DOM/panel state.
  Acceptance: the transport's injected `isLoggedIntoCharacter` callback
  returns `false` until a `"Char.Vitals"` frame has been dispatched through
  the session's own `SessionGmcpBus` since the most recent connect, returns
  `true` after, and resets to `false` on every new connect attempt (fresh
  login state per socket), verified indirectly through the already-proven
  Step 9 upgrade-probe gating fixture pattern.
- [MH7] The effective-configuration snapshot stays live without cross-session
  leakage. Acceptance: `Session` subscribes to
  `client/configuration/service.ts`'s `subscribe(characterProfileId,
  listener)` at creation and exposes the latest snapshot through a read
  method; publishing a new revision for that character's configuration
  (`publishConfigurationSet`) updates the exposed snapshot; publishing for a
  different character's configuration leaves this session's snapshot
  unchanged; `dispose()` unsubscribes so a post-dispose publish never invokes
  the session's listener again.
- [MH8] The factory validates before claiming. Acceptance:
  `createSessionFromState` returns a structured failure (not a thrown error)
  for an unknown `serverProfileId`, an unknown `characterProfileId`, or a
  `characterProfileId` whose `serverProfileId` does not match the supplied
  `serverProfileId`, and none of those failure paths calls
  `registry.claim(...)` or constructs any transport/GMCP/scope resource.

## Out of scope

- Any DOM mutation, `appendSystemMessage`-equivalent output, or panel/
  automation manager reset. Those are Step 13/14's compatibility-facade
  concern, reached by subscribing to this step's `SessionEventBus`.
- Reading `/config.json`, opening or migrating the profile store, or choosing
  the active character. `Session` and its factory take an already-loaded,
  already-validated `ApplicationStateV1` plus explicit
  `serverProfileId`/`characterProfileId`; that resolution is Step 13's job.
- Real settings-backed `getAutoReconnect()` or terminal-geometry-backed
  `getClientInfo()`. Both are required injected callbacks with no default in
  this step (per Step 9's own no-default precedent for
  `isLoggedIntoCharacter`); Step 13 supplies the real settings/DOM-backed
  implementations.
- Trigger/timer execution state, cooldowns, recursion guards, waits, or
  GMCP/user variables. Step 10's `runtime-state.ts` holds only the
  effective-configuration reference and the login-detection flag this step's
  own composition needs; the full automation runtime is Step 12's job and
  must not be anticipated here.
- Panel-specific subscription payload fields (`panels`, `visualEffects`,
  `tutorialPane`, and similar). `Darkwind.Client.Subscriptions` sends with
  `SessionGmcpBus`'s own built-in feature defaults
  (`client/gmcp/bus.ts:134-147`) until Step 14 ports panel-aware payloads.
- Modifying `client/transport/reconnect.ts` or any other already-shipped Step
  9 file to add a delayed lost-transmission session event. This step closes
  that gap by scheduling its own delayed action from the existing
  `transport:lost-transmission-detected` signal instead (Assumption 1),
  keeping Step 9's frozen files untouched.
- Wiring `client/runtime/session*.ts` into the real boot path, any legacy
  manager, or `client/app/bootstrap.ts`. That begins at Step 13; this step's
  only consumer is its own test file.

## Assumptions

- [The lost-transmission recovery gap is closed by `Session` scheduling its
  own `LOST_TRANSMISSION_RECOVERY_DELAY_MS`-delayed `restartHandshake()` call
  off the existing `transport:lost-transmission-detected` event, reusing the
  constant `reconnect.ts` already exports, rather than reopening `reconnect.ts`
  to add a second delayed event. The 30-second cooldown between recovery
  attempts is still enforced exactly once, upstream, by `reconnect.ts`
  refusing to publish a second `transport:lost-transmission-detected` event
  within the cooldown window (`client/transport/reconnect.ts:358-365`); this
  step's own delayed timer only reproduces the 750ms *call* delay, not the
  cooldown, so no double-gating occurs] - if false: `client/transport/
  reconnect.ts` must be reopened in this step to publish a
  `transport:lost-transmission-recovery-elapsed` event from inside its
  existing delayed callback, turning this from a pure-addition step into one
  that edits an already-shipped, already-tested Step 9 file.
- [`getAutoReconnect(): boolean`, `getClientInfo(): CoreHello`, `appOrigin:
  string`, `webSocketFactory`, `onlineTarget`, and `now` are required
  parameters on the session factory with no built-in default outside the test
  file, mirroring Step 9's own no-default `isLoggedIntoCharacter` precedent]
  - if false: this step must hardcode a Phase-1-only default (for example,
  `getAutoReconnect` always returning `true`), which Step 13 would then have
  to override anyway, duplicating the composition seam instead of exposing it
  cleanly once.
- [The session factory accepts an already-loaded, already-validated
  `ApplicationStateV1` (not a `StorageLike`) plus explicit
  `serverProfileId`/`characterProfileId`, per Step 13's own intent already
  separating storage/migration/character-selection from `Session` creation]
  - if false: `session-factory.ts` needs its own `StorageLike` parameter and
  `readState`/error-handling logic, duplicating what Step 13's bootstrap
  sequence already owns and creating two places that can disagree about a
  malformed-storage failure mode.
- [The registry is a factory-created instance (`createSessionRegistry()`)
  injected into the session factory, not a module-level singleton, so a
  future Step 13 bootstrap owns exactly one long-lived instance across the
  app and tests can create a fresh one per fixture without a manual reset
  function] - if false: switch to a module-level singleton matching
  `client/configuration/service.ts`'s subscriber-map precedent
  (`client/configuration/service.ts:51`), and this step's test file needs an
  exported `resetSessionRegistryForTests()` analogous to
  `resetConfigurationSubscriptionsForTests()`.
- [The mutual construction dependency between the GMCP bus's `sendSink` and
  the transport's `onGmcpFrame` callback is resolved with a
  definite-assignment-asserted forward reference (`let transport!:
  SessionTransport`) rather than a lazy-adapter object, since Step 9's own
  plan already named "a bound method reference" as sufficient
  (`docs/plans/multi-connection-ui-phase-1-step-9-implementation-plan.md:221-225`)]
  - if false: `session.ts`/`session-factory.ts` need an explicit lazy-binding
  wrapper object instead, adding one more indirection layer to the
  composition root for no behavioral difference.

## Risks

- Deriving `isLoggedIntoCharacter()` from `"Char.Vitals"` receipt instead of
  `panelManager.gmcpData.vitals` changes the signal's *source* even though its
  *timing* is intended to match (both flip true on the same inbound frame).
  Mitigation: MH6's fixture dispatches a `Char.Vitals` frame through the same
  `SessionGmcpBus.dispatch` path production code will use (not a direct flag
  mutation), so the fixture proves the composition, not just the flag.
- The forward-reference construction pattern (Assumption 4) is a real
  TypeScript footgun if the `sendSink` closure is ever invoked synchronously
  during either constructor before `transport` is assigned. Mitigation:
  neither `createSessionGmcpBus` nor `createSessionTransport` invokes the
  other's callback during its own construction (`client/gmcp/bus.ts:165-173`
  only stores `sendSink`; `client/transport/connection.ts:72-119` only stores
  `callbacks`), so the closure is guaranteed to run only after both objects
  exist; this step's test file adds an explicit fixture that sends a GMCP
  frame at the earliest possible moment (immediately after the fake socket's
  `onopen` fires) to catch a regression if that guarantee is ever violated by
  a future edit to either module.
- Scheduling the lost-transmission restart from `Session`'s own
  `ResourceScope` (Assumption 1) means a second, independent timer now exists
  alongside `reconnect.ts`'s own internal (event-less) 750ms timer for the
  same condition. Mitigation: both timers start from the same
  `transport:lost-transmission-detected` publish instant and use the same
  exported `LOST_TRANSMISSION_RECOVERY_DELAY_MS` constant, so under the
  shared fake clock used by both this step's and Step 9's fixtures they
  always resolve at the identical simulated offset; this step's fixture
  asserts the `restartHandshake` call happens at exactly that offset, not
  "eventually."
- Claiming the registry before constructing any transport/GMCP/scope resource
  (MH8) means a `DuplicateLiveSessionError` is thrown with zero partial
  construction to clean up, but only if every validation happens strictly
  before the `registry.claim(...)` call. Mitigation: the Step 3 composition
  order in `session-factory.ts` is fixed as (a) look up server/character
  profiles, (b) resolve initial effective configuration, (c) claim the
  registry, (d) construct scope/diagnostics/eventBus/transport/gmcp, (e)
  subscribe to configuration updates - and the test file includes a fixture
  proving a failed lookup or a failed claim leaves zero live resources in a
  fresh `SessionDiagnostics` snapshot.
- Encoding the subscriptions `reason` field as `'login'` vs `'reconnect'`
  from session-local state (Assumption/MH4) is a cosmetic field with no
  master-plan acceptance criterion tied to it; getting it wrong would not
  fail any Step 10 Must-have but would be a silent behavior drift from
  legacy. Mitigation: MH4 makes it an explicit acceptance criterion anyway,
  since it is free to test correctly once `Session` already tracks "has this
  session connected before."

## Steps

### Step 1 - Session runtime state and the live-session registry

**Files:** `client/runtime/runtime-state.ts` (new),
`client/runtime/session-registry.ts` (new)

**Intent:** In `runtime-state.ts`, implement `createSessionRuntimeState(initial:
EffectiveConfigurationSnapshot): SessionRuntimeState` holding exactly the
mutable state this step's composition needs and nothing from Step 12's
automation scope: the current `EffectiveConfigurationSnapshot`
(`getEffectiveConfiguration()`/`setEffectiveConfiguration()`), a
login-detection flag (`isLoggedIntoCharacter()`/`markCharacterVitalsReceived()`/
`resetCharacterVitals()`), and a first-connect tracking flag
(`markConnected(): { reason: 'login' | 'reconnect' }`, which returns
`'login'` the first time it is called and `'reconnect'` every time after,
matching the `wasReconnect` semantics evidence above without depending on any
transport-internal counter). In `session-registry.ts`, implement
`createSessionRegistry(): SessionRegistry` against the frozen
`client/model/session-contract.ts` interface with a
`Map<CharacterProfileId, SessionDescriptor>`: `claim()` throws
`DuplicateLiveSessionError` when the character already has an entry;
`release()` removes an entry only when both `sessionId` and
`characterProfileId` match and returns whether it did;
`lookupByCharacter()` returns the current entry or `undefined`.

**Verify:**

```bash
npm run typecheck
npm run lint
npm run format:check
```

**Done when:** `runtime-state.ts` and `session-registry.ts` compile with no
import of `client/transport/**`, `client/gmcp/**`, or `client/storage/**` (both
are pure state containers); `session-registry.ts` satisfies the
`SessionRegistry` interface with no widening of its method signatures.

### Step 2 - Compose the `Session` interface and lifecycle

**Files:** `client/runtime/session.ts` (new)

**Intent:** Define the public `Session` interface (`sessionId`,
`serverProfileId`, `characterProfileId`, `connect()`, `disconnect()`,
`dispose()`, `disposed`, `getEffectiveConfiguration()`,
`getHealthSnapshot()` delegating to the transport, and a minimal
`getRuntimeSnapshot()` read model exposing `{ isLoggedIntoCharacter,
effectiveConfiguration }` for tests and Step 13's future compatibility
facade). Implement `createSession(parts: SessionParts): Session`, a function
taking **already-constructed** pieces (`descriptor: SessionDescriptor`,
`registry: SessionRegistry`, `scope: ResourceScope`, `eventBus:
SessionEventBus`, `diagnostics: SessionDiagnostics`, `transport:
SessionTransport`, `gmcp: SessionGmcpBus`, `runtimeState:
SessionRuntimeState`, `getClientInfo: () => CoreHello`,
`unsubscribeConfiguration: Unsubscribe`) and wiring only the *behavioral*
composition, per Assumption 4's forward-reference pattern documented at the
call site: subscribe (via `scope.own('subscription', ...)`) to
`transport:reconnect-status` and, on `status === 'connected'`, call
`runtimeState.resetCharacterVitals()` then send `Core.Hello` +
`Core.Supports.Set` + `Darkwind.Client.Subscriptions` with `reason:
runtimeState.markConnected().reason`; subscribe to
`transport:handshake-guard-elapsed` and resend the same two-call sequence
unconditionally (the delay/GMCP-arrival gate already happened inside
`reconnect.ts` before publishing, per Evidence); subscribe to
`transport:lost-transmission-detected` and schedule (via
`scope.setTimeout`, using the imported `LOST_TRANSMISSION_RECOVERY_DELAY_MS`)
a guarded `gmcp.restartHandshake({reason: 'lost-transmission'})` call that
no-ops if the transport is no longer connected when the delay elapses;
subscribe the GMCP bus (`gmcp.on('Char.Vitals', ...)`) to call
`runtimeState.markCharacterVitalsReceived()`. `dispose()` is idempotent
(guarded by `disposed`), calls `unsubscribeConfiguration()`,
`registry.release(descriptor.sessionId, descriptor.characterProfileId)`, and
`scope.dispose()` (which cascades to the transport per Step 9's own disposal
contract, since the transport's socket is registered as `scope.own('socket',
...)`); `disconnect()` only calls `transport.disconnect()`.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** `session.ts` imports zero storage or model-validation modules
(it only composes already-constructed parts and the frozen model/runtime
types); every event subscription is registered through the injected `scope`
so `scope.dispose()` alone guarantees no post-dispose handler fires, matching
the Step 6 `ResourceScope` contract this module depends on rather than
reimplements.

### Step 3 - Session factory: resolve, validate, claim, and construct

**Files:** `client/runtime/session-factory.ts` (new)

**Intent:** Implement `createSessionFromState(state: ApplicationStateV1,
serverProfileId: ServerProfileId, characterProfileId: CharacterProfileId,
deps: SessionFactoryDeps): SessionFactoryResult` (a `{success:true, data:
Session} | {success:false, code, message}` result, matching the
`ValidationResult`/`CommitResult` shape already used across
`client/storage/**` and `client/configuration/**`). `SessionFactoryDeps`
carries every required injected value named in Assumption 2
(`uuidFactory`, `registry`, `getAutoReconnect`, `getClientInfo`, `appOrigin`,
`webSocketFactory`, `onlineTarget`, `now`). In order: (a) look up
`state.serverProfiles[serverProfileId]` and
`state.characterProfiles[characterProfileId]`, failing with a structured
result if either is missing or the character's `serverProfileId` does not
match the supplied one (MH8); (b) call `resolveEffectiveConfiguration(state,
characterProfileId)`, failing through if it does not succeed; (c) create
`sessionId` via `createSessionId(deps.uuidFactory)` and call
`deps.registry.claim({sessionId, serverProfileId, characterProfileId})`,
letting `DuplicateLiveSessionError` propagate uncaught (it is already a typed
error the caller is expected to catch, per its own class definition); (d)
construct `diagnostics`, `scope` (`createResourceScope`), `eventBus`
(`createSessionEventBus`); (e) construct `gmcp` and `transport` using the
Assumption 4 forward-reference pattern, with `transport`'s `getEndpoint`
callback converting `serverProfile.port` (`number`) to the `string`
`TransportEndpoint` expects and passing `serverProfile.protocol` directly
(both are the same four-value union); (f) construct `runtimeState` via
`createSessionRuntimeState(initialSnapshot)`; (g) call
`subscribe(characterProfileId, (snapshot) =>
runtimeState.setEffectiveConfiguration(snapshot))` from
`client/configuration/service.ts`, keeping the returned `Unsubscribe`; (h)
call `createSession(...)` from Step 2 with every constructed part and return
`{success: true, data: session}`.

**Verify:**

```bash
npm run typecheck
npm run build
npm run verify:bundle
```

**Done when:** a lookup failure or a `DuplicateLiveSessionError` never
constructs a `ResourceScope`, `SessionTransport`, or `SessionGmcpBus` (MH8,
Risk 4); the endpoint callback produces a `TransportEndpoint` whose `port` is
the `String()` of the `ServerProfile`'s numeric port; and the factory's own
module has zero import of any `public/js/**` legacy module.

### Step 4 - Prove lifecycle, registry, and handshake-choreography parity

**Files:** `test/session-runtime.test.mjs` (new)

**Intent:** Follow the Step 7/9 Vite-SSR import pattern to import
`client/runtime/{session,session-factory,session-registry,runtime-state,
resource-scope,event-bus,diagnostics}.ts`, `client/transport/*.ts`,
`client/gmcp/{bus,frame}.ts`, `client/configuration/{resolve,service,
snapshot}.ts`, and `client/model/{ids,profiles,configuration}.ts`. Build a
minimal valid `ApplicationStateV1` fixture in-memory (one `ServerProfile`,
two `CharacterProfile`s referencing it, empty configuration sets) and the
same fake `WebSocketLike` class plus `t.mock.timers` pattern
`test/session-transport.test.mjs` already established. Cover every
Must-have: MH2's four dispose-idempotency lifecycle points; MH3's duplicate-
claim rejection and two-characters-one-server concurrency, including
asserting `SessionDiagnostics.snapshot()` shows zero acquired resources for
the rejected attempt; MH4's login-vs-reconnect `reason` flip across two
`onopen` firings on the fake socket, decoding the fake socket's captured
`send()` calls to assert package order and payload; MH5's handshake-guard
resend and the lost-transmission delayed-restart-then-cancel-on-dispose
fixture, both driven by `t.mock.timers.tick(...)` at the exact exported delay
constants; MH6's `Char.Vitals`-driven login flag proven by dispatching a real
frame through `gmcp.dispatch`, not a direct flag mutation (per Risk 1); MH7's
live effective-configuration propagation and its cross-session-isolation
negative case (publishing for a different character must not touch this
session's snapshot); and MH8's three factory-rejection paths (unknown
server, unknown character, mismatched server/character pair).

**Verify:**

```bash
node --test test/session-runtime.test.mjs
npm run build
npm run verify:bundle
npm run format:check
npm run lint
npm run typecheck
npm run check
git diff --check
```

**Done when:** every Must-have in this plan and every Done-when condition in
the master plan's Step 10 entry
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:447-449`) has
a corresponding passing fixture, and the full quality/build battery is green.

## Success criteria

- [ ] `Session` composes profile references, one live effective-configuration
      snapshot, the Step 9 transport, the Step 7 GMCP bus, `SessionDiagnostics`,
      minimal mutable runtime state, and a `ResourceScope` behind one public
      interface, with no other module reaching the socket, GMCP handler
      registry, or scope directly.
- [ ] `connect()`/`disconnect()`/`dispose()` transitions are explicit, and
      `disconnect()` leaves the session reusable while `dispose()` is terminal
      and idempotent from every lifecycle state.
- [ ] The registry rejects a second live session for one character profile
      without constructing any transport/GMCP/scope resource for the rejected
      attempt, while two different characters on the same server profile run
      concurrently.
- [ ] `Session` reproduces legacy's exact GMCP handshake choreography (initial
      handshake with the correct login/reconnect reason, handshake-guard
      resend, and lost-transmission delayed restart) purely through composed
      event subscriptions, closing the gap Step 9's own risk log left open.
- [ ] `isLoggedIntoCharacter()` is answered from an observed `Char.Vitals` GMCP
      frame, not DOM or panel state.
- [ ] The effective-configuration snapshot updates live on a published
      revision for this session's character and never observes another
      character's revision.
- [ ] The factory validates server/character profile existence and consistency
      before claiming the registry or constructing any resource.
- [ ] The full quality/build battery (`format:check`, `lint`, `typecheck`,
      `check`, `build`, `verify:bundle`) and the new unit test all pass.

## Rollback

Nothing built in this step is imported into the boot path, the legacy UI, or
any other production module yet - `client/runtime/session*.ts` and
`runtime-state.ts` have no importers until Step 11 begins adapting definition
managers and Step 13 cuts the legacy UI over. Reverting before then is a pure
code deletion of the four new files plus `test/session-runtime.test.mjs`, with
zero runtime impact, since no shipped build executes this code outside `node
--test`. This step touches no persisted data and no key under
`darkflow-session-core-v1`; it only reads an already-loaded
`ApplicationStateV1` and calls the read-only/publish-only functions Step 4/5
already committed, so it needs no data-recovery step.

## Execution fit

- Scope: multi-run phase (one step within the ongoing Phase 1 program)
- Lead: Terra at high reasoning - real judgment risk in the composition-order
  decisions (forward-reference construction, claim-before-construct
  ordering, the lost-transmission gap resolution) even though every
  sub-component it composes (Steps 3, 5, 6, 7, 9) is already frozen,
  well-tested precedent that substantially narrows the design space
- Workers: none - the four files form one tightly coupled composition root;
  splitting authorship across `session.ts`/`session-factory.ts`/
  `session-registry.ts`/`runtime-state.ts` risks a mismatched claim-ordering
  assumption between the factory and the registry, or an event subscription
  in `session.ts` that bypasses the injected `scope`
- Delegation shape: solo
- Ownership: the lead owns the lost-transmission gap-closure decision
  (Assumption 1), the required-injected-callback boundary (Assumption 2), the
  state-vs-storage factory input decision (Assumption 3), and the go/no-go
  decision before Step 11 begins
- Replan trigger: Step 11's definition-manager adapters reveal
  `getRuntimeSnapshot()`'s shape is insufficient for what the compatibility
  layer needs to read; or Step 13's bootstrap sequencing reveals the
  state-vs-storage factory boundary (Assumption 3) should move storage
  reading into this step after all
- Confidence: medium-high - every composed sub-component is already frozen
  and independently tested, and the one genuine open question this plan found
  (the lost-transmission event-timing gap) has a concrete, evidence-backed
  resolution rather than remaining an unknown, but this is still the first
  step to prove the six-subsystem composition actually wires together end to
  end, which no prior step's fixture could exercise

Plan self-review: PASS (8/10)

Notes:

- The Skeptic-lens finding on this plan mirrors the kind of gap Step 9's own
  adversarial review found in its draft (a silently dropped legacy behavior):
  here it is the lost-transmission recovery call itself, which Step 9's
  ported `reconnect.ts` left detectable but not actionable. Resolving it by
  adding one delayed timer in `Session` (Assumption 1) was chosen over
  reopening `reconnect.ts` specifically to keep every already-shipped Step
  1-9 file untouched, matching this plan's own Rollback claim.
- The `reason: 'login' | 'reconnect'` field (MH4) is the one place this plan
  deliberately diverges from *how* legacy computes a value while still
  reproducing *what* legacy sends, because the underlying transport counter
  it originally read is provably unavailable by the time `Session` can act
  (Evidence: `client/transport/connection.ts:271,277`). This is recorded
  explicitly so a future reviewer does not mistake it for an unexamined
  behavior change.
- This step deliberately does not expose `scope`, `eventBus`, `transport`, or
  `gmcp` on the public `Session` interface itself, only read models
  (`getEffectiveConfiguration()`, `getHealthSnapshot()`,
  `getRuntimeSnapshot()`). If Step 11 or Step 13 finds it needs direct access
  to one of those parts, that is a signal to add a specific narrow accessor
  rather than widen `Session` to expose the parts wholesale - the same
  narrow-accessor discipline Step 9 applied to `TransportHealthSnapshot`
  instead of exposing raw socket/timer state.
- Step 12 ("Isolate trigger/timer execution and shared-set propagation") is
  the step that will eventually attach automation execution state
  (cooldowns, recursion guards, GMCP variables) to a session-owned container;
  this step's `runtime-state.ts` intentionally does not anticipate that
  shape, so as not to guess at a contract Step 12's own plan has not yet
  pinned.
