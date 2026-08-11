# Phase 1 Step 13 Corrective Implementation Plan

*Plan stress-tested via focused adversarial review. 12 findings surfaced, 8
survived and shaped the execution order, ownership boundaries, and merge gates
below.*

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 - one reversible correction at the boot/session/legacy
  boundary, with known failures but a broad verification obligation.
- Hard triggers: none - this is one existing Step 13 deliverable, not a new
  independently deployable phase.
- Current planning horizon: correct the staged Step 13 implementation so the
  session runtime boots, carries live text and GMCP, preserves legacy
  connection lifecycle behavior, and satisfies MH1-MH10.
- Evidence horizon: the staged diff, the Step 13 plan, the session factory and
  transport callbacks, the runtime/configuration/automation bridges, legacy
  connection and GMCP consumers, and the relevant Node and Playwright suites.
- Adversarial review: focused - this is a high-blast-radius integration boundary
  with established architecture and reproducible failures; Architect was added
  to Skeptic, Validator, and Researcher.

## Goal

Repair the staged Step 13 cutover without changing its approved product scope.
The shipped root must create and retain one live `Session`, install all three
compatibility bridges before legacy manager initialization, defer DOM-facing
work until `app.js` initializes its DOM references, route live text and GMCP to
the existing UI, and preserve the legacy connection lifecycle while the session
transport remains the only socket/reconnect owner.

The correction is complete only when every original Step 13 must-have has an
automated fixture and the full Step 13 gate is green.

## Must-haves

- [CMH1] Session boot succeeds instead of falling back. Acceptance: the real
  browser boot publishes `__darkflowPhase1Session.phase === "session-ready"`,
  no pre-`initDom()` connection UI call occurs, and the existing
  `__darkflowPhase1Bootstrap.phase === "legacy-loaded"` diagnostic survives.
- [CMH2] Same-document boot is idempotent. Acceptance: two calls through the
  bootstrap transaction with the same window-owned runtime slot create and
  claim one session, install one bridge set, and do not throw
  `DuplicateLiveSessionError`.
- [CMH3] Partial boot failure remains safe. Acceptance: an injected failure
  after session creation resets all installed bridges, disposes the session,
  releases the registry claim, clears the window-owned runtime slot, and loads
  the legacy app once.
- [CMH4] Inbound game text is visible. Acceptance: a controlled WebSocket text
  frame reaches the existing `appendOutput` path exactly once and updates the
  inbound byte counter; a binary GMCP frame updates the same counter and reaches
  the session GMCP bus.
- [CMH5] Explicit inbound deadlines work. Acceptance: if no inbound timestamp
  advances after `expectInboundWithin(ms, reason)`, the session transport is
  force-reconnected with that reason; inbound traffic or disposal cancels the
  effect.
- [CMH6] Legacy lifecycle behavior is preserved without socket ownership.
  Acceptance: a session `connected` transition starts auto-timers, resets live
  panel data, arms the initial inbound deadline, notifies tutorial state, and
  emits the existing connection event; a `disconnected` transition stops
  timers and runs the existing manager/panel cleanup. No active-path code in
  `connection.js` constructs a WebSocket or reconnect timer.
- [CMH7] Legacy GMCP observable state reflects the session bus. Acceptance:
  `gmcp.enabled` becomes true after the session-owned handshake and false after
  reset/disconnect; lag-monitor guards and `serverSupportsPackage` observe the
  session bus without a second handshake.
- [CMH8] Counter behavior is not double-counted. Acceptance: one successful
  command send increments the legacy outbound counter once, and raw inbound
  text/binary byte counts are mirrored once per frame.
- [CMH9] The original Step 13 MH1-MH10 matrix is complete. Acceptance: each
  must-have in
  `docs/plans/multi-connection-ui-phase-1-step-13-implementation-plan.md:204-256`
  maps to a named Node or Playwright assertion; no row is represented only by
  "page loaded" or "did not throw."

## Out of scope

- Multi-session create/switch/reorder UI - remains owned by later Phase 1
  steps.
- Step 14 controller disposal and Step 15 25-cycle disposal soak - preserve
  their planned scope; only resources introduced by this correction must be
  session-scoped now.
- Removing legacy storage keys, modules, or compatibility bridges - they remain
  the rollback path.
- Re-targeting a live session from toolbar edits - the active server profile
  remains fixed at session creation.
- New GMCP package models or server/proxy changes - this correction only
  restores the already-approved cutover contract.
- Broad transport API redesign - use the existing callbacks and session event
  bus; do not widen `Session`, `SessionTransport`, or health snapshots merely
  for facade convenience.

## Assumptions

- [The root module runs after the static toolbar DOM exists, but legacy `dom.*`
  references remain null until `initDom()`] - if false: the UI-ready handshake
  must move to the first point at which both conditions are true; do not call
  legacy UI functions speculatively.
- [`app.js` completes synchronous manager initialization before its
  `/config.json` promise can call `connect()`] - if false: gate auto-connect on
  lifecycle-handler readiness and prove exactly one later connect.
- [Adding one injected text sink to pre-freeze `SessionFactoryDeps` is allowed]
  - if false: publish text through the existing session event bus instead; do
  not import `public/js/**` statically from `client/runtime/**`.
- [The legacy outbound counters intentionally count command/text paths rather
  than all GMCP bytes] - if false: stop and define one transport-owned byte
  accounting contract before editing all callers.

## Hard constraints

- Configuration, automation, and runtime bridges are installed before
  `app.js`; DOM-facing synchronization starts only after `app.js` calls the
  explicit UI-ready forwarder immediately after `initDom()`/`initOutput()`.
- The live runtime owner is stored on a stable window/global slot, not only a
  module-scoped variable, so same-document re-evaluation cannot claim a second
  session. Clear the slot only after disposal during failed boot.
- Session transport owns the WebSocket, reconnect ladder, reconnect timers,
  health watchdog, handshake guard, and send path. Legacy lifecycle hooks may
  update UI/managers but may not create sockets or schedule reconnects.
- Every new timer/subscription is owned by the session `ResourceScope` or is
  explicitly released when the runtime bridge is reset.
- Inactive bridge behavior remains observationally identical. Do not refactor
  the legacy socket branch unless a parity test proves the extraction.
- No `public/js/**` file statically imports `client/**`.
- No existing legacy key is deleted or rewritten by corrective tests or code.

## Decisions

- Use an explicit `markLegacyUiReady()` bridge operation called from `app.js`.
  Do not call `initDom()` from TypeScript bootstrap: DOM initialization remains
  owned by the legacy entry point.
- Add an injected session-factory text sink for live text delivery. Use a
  session event carrying raw inbound byte size for facade accounting; do not
  expand the transport health snapshot for one legacy consumer.
- Preserve connection side effects in active-only lifecycle helpers inside
  `connection.js`, where the required managers already exist. Do not move
  legacy managers into `client/**` or let the session factory depend on them.
- Expose session-bus enabled state through the runtime facade and make the
  legacy `gmcp.enabled` property read it while active. Do not send a duplicate
  handshake to toggle a legacy boolean.
- Execute sequentially with one integration owner. The factory, runtime bridge,
  and legacy lifecycle share ordering contracts and are not safe parallel edit
  slices.

## Risks

- UI-ready signaling could occur too late and miss an initial state change -
  mitigation: `markLegacyUiReady()` immediately applies the current transport
  state, then enables later state notifications.
- Active lifecycle helpers could duplicate legacy handshakes or reconnects -
  mitigation: enumerate the original `onopen`/`onclose` effects and explicitly
  exclude socket, reconnect, and handshake ownership; assert sent handshake
  package counts.
- Direct `state.ws.send()` and `sendSocketPayload()` paths can double-count -
  mitigation: one accounting test per path and remove bridge-side outbound
  increments where legacy callers already increment.
- A module-local idempotency guard can pass reload tests while failing HMR -
  mitigation: test two transaction calls against one persistent runtime slot,
  not two page loads.
- Browser-only happy-path tests can miss disposal and migration failures -
  mitigation: add an injected bootstrap transaction fixture plus a controlled
  WebSocket browser fixture.

## Steps

### Step 1 - Make bootstrap transactional, persistent, and UI-ready aware

**Files:** `client/app/bootstrap.ts`, `client/app/session-bridge-wiring.ts`,
`public/js/session-compat/runtime.js`, `public/js/app.js`,
`test/session-bootstrap.test.mjs` (new), `e2e/session-single-runtime.spec.ts`

**Intent:**

1. Extract only the boot transaction needed for deterministic testing into a
   small injected helper; keep browser dependency construction in
   `bootstrap.ts`. The helper must expose coarse operations for creating the
   runtime, installing/resetting bridges, loading the legacy app, and reading or
   writing the persistent runtime slot. Do not abstract storage/configuration
   services again.
2. Replace `bootstrappedSession` as the source of truth with a stable
   window-owned runtime record containing the live session, installed bridge
   state, and session diagnostic. A second call returns the existing live
   runtime and loads/imports the legacy entry at most once.
3. Preserve this successful call order:
   config fetch/validation -> migration/read -> active profile resolution ->
   session claim/create -> wildcard GMCP variable subscription -> build all
   bridges -> install all bridges -> publish the runtime record/diagnostic ->
   import `app.js` -> publish `legacy-loaded`.
4. Change runtime bridge installation so `startFacadeSync()` installs the
   WebSocket proxy, health mirror, and session subscriptions without calling
   legacy UI. Add `markLegacyUiReady()` to the bridge and its forwarding module.
5. In `app.js`, immediately after `initDom()` and `initOutput()`, call
   `markLegacyUiReady()` only when the runtime bridge is active. This applies
   the current state once before managers initialize.
6. On failure after session creation: reset runtime, automation, and
   configuration bridges; dispose the session; clear the persistent runtime
   slot and session diagnostic; then load legacy once. Preserve the original
   error as the logged cause.

**Verify:**

```bash
node --test test/session-bootstrap.test.mjs test/session-runtime-bridge.test.mjs
npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium
```

**Done when:** CMH1-CMH3 pass; bridge installation performs no DOM write;
`markLegacyUiReady()` performs exactly one initial UI synchronization; the
targeted browser test no longer logs the confirmed null-`textContent` fallback.

### Step 2 - Restore inbound text, byte accounting, and inbound deadlines

**Files:** `client/runtime/session-factory.ts`, `client/transport/connection.ts`,
`client/app/bootstrap.ts`, `client/app/session-bridge-wiring.ts`,
`public/js/session-compat/runtime.js`, `test/session-runtime.test.mjs`,
`test/session-transport.test.mjs`, `test/session-runtime-bridge.test.mjs`

**Intent:**

1. Add a required `onText(text)` dependency to `SessionFactoryDeps`; pass it to
   `createSessionTransport` instead of the current no-op. Bootstrap supplies
   the existing dynamically imported `appendOutput` function.
2. In the transport receive handler, publish a session-scoped
   `transport:inbound-bytes` event with `{ kind: "text" | "gmcp", size }`
   before invoking the text/GMCP callback. Use the raw string length and raw
   `Uint8Array.byteLength`, matching the legacy counters.
3. Subscribe to that event in the runtime bridge and update
   `legacyState.bytesReceived`. Reset inbound/outbound counters on each
   successful connected transition, matching the old `onopen` behavior.
4. Remove `bytesSent` increments from the proxy and active `sendPayload` bridge
   where the legacy command/output/settings callers already increment after a
   successful send. Add a regression assertion for each direct/forwarded path.
5. Implement `expectInboundWithin(ms, reason)` with one replaceable,
   scope-owned deadline. Capture the current `lastInboundAt`; at expiry, force
   reconnect only when the transport is still connected and the timestamp has
   not advanced. New inbound traffic makes the expiry harmless; disposal
   cancels it.

**Verify:**

```bash
node --test test/session-transport.test.mjs test/session-runtime.test.mjs test/session-runtime-bridge.test.mjs
npm run typecheck
```

**Done when:** CMH4, CMH5, and CMH8 pass with driven fake sockets; a text frame
is asserted at the injected sink, GMCP still dispatches, raw byte counts are
correct, and one command send counts once.

### Step 3 - Restore active connection lifecycle and GMCP observable state

**Files:** `public/js/connection.js`, `public/js/gmcp.js`,
`public/js/session-compat/runtime.js`, `client/app/session-bridge-wiring.ts`,
`test/session-runtime-bridge.test.mjs`, `test/connection-transport.test.mjs`,
`e2e/session-single-runtime.spec.ts`

**Intent:**

1. Enumerate the existing legacy `ws.onopen`, `finalizeDisconnect`, and
   `ws.onclose` effects before editing. Split them into:
   - session-owned: socket, reconnect, watchdog, handshake, health;
   - legacy lifecycle: UI/messages, `state.everConnected`, active transport,
     panel reset, tutorial notification, auto-timer start/stop, GMCP reset,
     tab-observability reset, and manager disconnect cleanup.
2. Add active-only lifecycle helpers in `connection.js`. Invoke them from the
   facade-driven state transition, never from the active `connect()` or
   `disconnect()` forwarding branch directly. Guard repeated states so polling
   cannot repeat side effects.
3. On active connected: record login versus reconnect from prior
   `state.everConnected`, reset counters, set active transport from reconnect
   status, reset panel data, start auto-timers, notify tutorial state, arm the
   initial 10-second inbound deadline, and emit the existing connection event.
   Do not send a handshake; `Session` already owns it.
4. On active disconnected: reset GMCP, stop timers, run the existing
   combat/tutorial/fishing/panel cleanup, reset tab observability and visible
   connection state, and emit the existing event. Do not schedule reconnect or
   close a socket here.
5. Add `gmcpIsEnabled()` through the runtime bridge. Change `gmcp.enabled` to an
   accessor that reads the session bus while active and retains the existing
   mutable legacy value while inactive. Preserve reset and restart behavior.

**Verify:**

```bash
node --test test/connection-transport.test.mjs test/session-runtime-bridge.test.mjs
npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium
```

**Done when:** CMH6-CMH7 pass; a controlled open/close cycle produces one set of
legacy lifecycle effects, lag-monitor sees enabled GMCP after the session
handshake, and active connection code constructs no socket or reconnect timer.

### Step 4 - Complete the original MH1-MH10 acceptance matrix

**Files:** `test/session-bootstrap.test.mjs`,
`test/session-runtime-bridge.test.mjs`, `test/session-runtime.test.mjs`,
`test/session-definition-adapters.test.mjs`,
`e2e/session-single-runtime.spec.ts`, and only the existing pinned tests that
require assertion updates without weakening their contracts

**Intent:** Add a table as a comment at the top of the new bootstrap test or in
the corrective PR description mapping each original must-have to an exact test
name. At minimum, cover:

- MH1: same-slot double bootstrap, one claim, and manager-init ordering;
- MH2: legacy-key migration, second-run skip, unchanged legacy keys, malformed
  config fallback;
- MH3: default/no-default active resolution, endpoint match, empty-host no
  auto-connect;
- MH4: one controlled WebSocket and forwarded connect/retry/disconnect actions;
- MH5: modeled and unmodeled GMCP delivery plus `$gmcp.*` registration;
- MH6: proxy methods, health mirror, counters, and session diagnostic;
- MH7: six-kind active backup/import plus inactive parity;
- MH8: inactive bridge behavior and pinned legacy-loaded diagnostic;
- MH9: the same session ID in session, GMCP, and `wsDebug` diagnostics;
- MH10: injected post-create failure, disposal, registry release, bridge reset,
  and one legacy load.

Use the existing fake WebSocket patterns in `test/session-transport.test.mjs`
and the Playwright WebSocket interception precedent in
`e2e/production-artifact.spec.ts`; do not depend on the live Darkwind server.
The reload test must assert a live session after reload and must not stand in for
the same-document idempotency fixture.

**Verify:**

```bash
node --test test/session-bootstrap.test.mjs test/session-runtime-bridge.test.mjs test/session-runtime.test.mjs test/session-definition-adapters.test.mjs
npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium
```

**Done when:** CMH9 passes and every original MH row names a passing assertion;
no required behavior is inferred from diagnostics alone.

### Step 5 - Run the complete Step 13 go/no-go gate

**Files:** no new production files; fix only failures attributable to the Step
13 staged change

**Intent:** Run the narrow tests first, then the repository quality and
production gates. Record environmental failures separately and do not weaken
assertions to make the gate green.

**Verify:**

```bash
node --test test/session-bootstrap.test.mjs test/session-runtime-bridge.test.mjs test/session-runtime.test.mjs test/session-transport.test.mjs test/session-definition-adapters.test.mjs test/connection-transport.test.mjs
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium
npm run test:browser:production
npm run verify:client-artifact
git diff --check
```

**Done when:** every command exits zero; the browser console contains no Phase
1 fallback error on the happy path; production artifact checks preserve the
legacy diagnostic and static-asset contracts.

## Success criteria

- [ ] The confirmed pre-`initDom()` boot failure is fixed without moving DOM
      ownership into TypeScript bootstrap.
- [ ] Same-document boot creates one session and one registry claim.
- [ ] Text and GMCP frames reach existing consumers and counters exactly once.
- [ ] Inbound deadlines, connect/disconnect lifecycle, timers, panels, tutorial,
      and GMCP enabled state match legacy visible behavior.
- [ ] Session transport remains the sole active socket/reconnect owner.
- [ ] Partial failure disposes and degrades to bridge-inactive legacy behavior.
- [ ] Every original Step 13 MH1-MH10 acceptance criterion has a named passing
      test.
- [ ] The complete Step 13 go/no-go gate passes.

## Rollback

This correction remains part of the unmerged Step 13 change. If any targeted or
production gate fails, do not partially enable the session path: revert the
corrective edits together with the staged Step 13 implementation and retain the
legacy boot path. Do not delete `darkflow-session-core-v1` or any legacy key;
the migration is additive and the legacy runtime ignores the Phase 1 graph.

## Execution fit

- Scope: single run
- Lead: Terra at high reasoning - the work is bounded but crosses boot ordering,
  runtime ownership, and legacy lifecycle behavior.
- Workers: none
- Delegation shape: solo
- Ownership: the executing subagent owns all implementation, integration,
  staged-diff preservation, and final verification.
- Replan trigger: satisfying a must-have requires a second socket/reconnect
  owner, a public `Session`/`SessionTransport` contract change, deletion of
  legacy data, or weakening an existing pinned test.
- Confidence: high - all primary failures are source-traced, one is reproduced
  in Chromium, and established fake-WebSocket and bridge patterns exist.

Plan self-review: PASS (9/10)

notes:
- The executor must preserve unrelated staged work and keep all corrective edits
  in the existing Step 13 change surface.
- The final handoff must distinguish passed automated evidence from any manual
  behavior not exercised locally.
