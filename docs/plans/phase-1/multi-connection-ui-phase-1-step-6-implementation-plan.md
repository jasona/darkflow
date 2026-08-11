# Phase 1 Step 6 Implementation Plan

## Planning selection

- Mode: detailed implementation plan
- Complexity: 4/10 - one bounded subsystem (`client/runtime/**`, four new
  files, zero importers yet), no public contract changes, built entirely on
  already-frozen Step 3 identities; the remaining uncertainty is a handful of
  disposal/routing contract decisions (throw vs. absorb, wrong-session
  handling, RAF under a fake clock) that repository evidence resolves rather
  than open product questions
- Hard triggers: none - one deliverable, one phase-gate continuation, nothing
  wired into the boot path, no user-requested sequencing
- Current planning horizon: `client/runtime/diagnostics.ts`, `events.ts`,
  `resource-scope.ts`, `event-bus.ts`, and
  `test/session-lifecycle-primitives.test.mjs`, exactly as scoped by the
  master plan's Step 6 entry
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:346-362`)
- Evidence horizon: the frozen Step 3 `SessionId` contract, the existing
  Phase 0 `LifecycleDiagnostics`/`dockview-workspace.ts` disposal precedent,
  `gmcp.dispatch`'s handler-isolation precedent, and the existing
  fake-timer/RAF test patterns already proven in this repository's legacy
  test suite
- Adversarial review: focused - recommended before implementation begins,
  targeting the disposed-scope-rejects-new-resources contract and the
  cross-kind reverse-order teardown design, since five later steps (9, 10,
  12, 14, 15) inherit whatever this step decides here

The clarification gate is skipped for the same reason Steps 3 and 5 skipped
it: the product decision (session-scoped runtime primitives, resilient
handler isolation) is already approved at the phase level
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:9-15`). This
plan resolves the remaining implementation-level ambiguities as documented
assumptions rather than open questions, because repository precedent already
answers them.

## Goal

Give Phase 1 two shared runtime primitives that every later step (7-15)
builds on: a typed `{ sessionId, type, payload }` event envelope with a
per-session bus that isolates handler failures and refuses to leak across
sessions, and an idempotent resource scope that owns timers, animation
frames, subscriptions, observers, listeners, child scopes, sockets, and
teardown callbacks, tearing them down in reverse-registration order exactly
once. Nothing built in this step is imported into the boot path, a legacy
manager, or the real `Session`; that begins at Step 9 (transport) and Step 10
(`Session` composition).

## Evidence and constraints

- `SessionId` is already a frozen, UUID-branded type with an injected test
  factory (`client/model/ids.ts:25`, `:45-47`, `:50-58`); this step tags
  diagnostics, events, and scopes with that existing type rather than
  inventing a parallel identifier.
- `gmcp.dispatch` already proves the exact handler-isolation shape this step
  must generalize: snapshot-then-iterate per package, `try`/`catch` around
  each callback, `console.error` and continue rather than let one throw stop
  delivery to the rest (`public/js/gmcp.js:71-109`). Step 5's plan already
  cites this as the precedent Step 6 formalizes
  (`docs/plans/multi-connection-ui-phase-1-step-5-implementation-plan.md:86-91`).
- `client/phase0/workspace/lifecycle-diagnostics.ts` already proves a working
  session-adjacent diagnostics shape: per-kind resource tracking with token
  release (`client/phase0/workspace/lifecycle-diagnostics.ts:86-100`),
  idempotent duplicate-disposal counting
  (`client/phase0/workspace/lifecycle-diagnostics.ts:69-80`), and a plain
  `snapshot()` read model (`client/phase0/workspace/lifecycle-diagnostics.ts:128-145`).
  `dockview-workspace.ts` is a proven consumer of that shape, including a
  duplicate-disposal guard at its own dispose site
  (`client/phase0/workspace/dockview-workspace.ts:125-128`) and
  `trackResource("listener")` for a live subscription
  (`client/phase0/workspace/dockview-workspace.ts:218`). This step
  generalizes the same pattern for session runtime rather than inventing a
  new one.
- Legacy fixtures already stub `requestAnimationFrame` as
  `(cb) => setTimeout(cb, 0)` before importing browser-facing modules under
  `node --test` (`test/connection-transport.test.mjs:29`), and this
  repository's fake-clock tests already use Node's built-in
  `t.mock.timers.enable({ apis: [...] })` / `t.mock.timers.tick(ms)` rather
  than a third-party clock library (`test/map-data-v2-lifecycle.test.mjs:232`,
  `:259`). Node has no native `requestAnimationFrame`, so this step's RAF
  convenience wrapper is only exercisable under a fake clock if the test
  stubs it the same way and the wrapper calls the global at invocation time
  rather than an aliased reference captured at module load.
- `client/runtime/**` does not yet exist in the TypeScript include list, the
  ESLint `scriptFiles` glob, or the Prettier/lint globs
  (`tsconfig.json:18-26`, `eslint.config.mjs:7-17`, `package.json:53-55`).
  Steps 3, 4, and 5 each added their own directory to all three the same way;
  this step must do the same for `client/runtime/**`.
- Downstream steps already name what they expect from this step's contract:
  Step 9's transport "emits session events and byte/GMCP callbacks" and its
  "[d]isposal cancels and closes every owned resource"
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:401-419`);
  Step 10 composes "diagnostics" and "resource scope" as two distinct fields
  on the public `Session`, and separates a reusable `disconnect()` from a
  terminal `dispose()`
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:421-437`),
  which requires a scope to support creating more than one child over its
  lifetime (a connection-scoped child created and disposed per reconnect
  cycle, independent of the session-level parent); Step 14 states outright
  that GMCP-bound controllers will "[u]se the session resource scope to own
  those disposers"
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:501-505`);
  and Step 15 registers browser listeners/timers/schedulers "under the
  session or application scope as appropriate"
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:519-523`),
  meaning `ResourceScope` must work as a freestanding, independently
  constructible primitive, not something only `Session` can create.
- No step before 9 subscribes to real session events or owns real resources,
  so this step's only consumer is its own test file; the contract is provable
  in isolation.

## Must-haves

- [MH1] Session-tagged diagnostics accurately track every resource kind and
  every rejection/failure/duplicate/misroute/suppression event, independent
  of each other. Acceptance: `snapshot()` counts match an interleaved
  acquire/release fixture across all eight resource kinds (timer, animation
  frame, subscription, observer, listener, child scope, socket, teardown);
  the five event counters (duplicate disposal, rejected resource, handler
  failure, suppressed event, misrouted event) each increment only for their
  own scenario and never for another.
- [MH2] `ResourceScope.dispose()` is idempotent and tears down every owned
  resource in reverse-registration order regardless of kind. Acceptance: a
  fixture interleaving timer, listener, socket, child-scope, and teardown
  registrations observes release in exact LIFO order; a second `dispose()`
  call invokes no disposer and only increments the duplicate-disposal
  counter; a disposer that throws does not stop the remaining disposers from
  running and is reported through the handler-failure counter.
- [MH3] A disposed `ResourceScope` rejects new resources without throwing and
  without leaking. Acceptance: `own()`, `setTimeout()`, `setInterval()`, and
  `requestAnimationFrame()` called after `dispose()` schedule or register
  nothing live, immediately release any already-constructed disposer exactly
  once, and increment the rejected-resource counter rather than throw.
- [MH4] A `ResourceScope`'s pending native timers and RAF-stub callbacks
  never fire after disposal, even when a fake clock is advanced past their
  delay. Acceptance: under `t.mock.timers`, a scope disposed before its
  scheduled timer's or RAF-stub's delay elapses shows zero invocations of
  that callback after the clock ticks past the delay.
- [MH5] `SessionEventBus.dispatch()` only delivers an envelope whose
  `sessionId` matches the bus's own bound session, and `publish()` always
  stamps that same `sessionId`. Acceptance: a hand-built envelope carrying a
  different `SessionId` passed to `dispatch()` invokes zero handlers and
  increments the misrouted-event counter; every envelope `publish()`
  constructs carries the bus's own `sessionId`.
- [MH6] Event delivery snapshots subscribers before dispatch and isolates
  handler failures, mirroring `gmcp.dispatch`. Acceptance: a handler that
  synchronously unsubscribes itself or another handler during delivery
  neither skips a handler already captured in the current delivery's snapshot
  nor is invoked again once removed, and the removal only takes effect
  starting with the next `publish()`/`dispatch()` call; a throwing handler is
  caught, reported through the handler-failure counter, and does not block
  delivery to the remaining handlers for that event type.
- [MH7] A disposed `SessionEventBus` is idempotent and delivers to nobody.
  Acceptance: a second `dispose()` call only increments the
  duplicate-disposal counter; `subscribe()`, `publish()`, and `dispatch()`
  called after `dispose()` deliver to zero handlers and are recorded via the
  rejected-resource/suppressed-event counters rather than throwing.

## Out of scope

- Enumerating a concrete Darkwind session-event catalog (connection, GMCP,
  diagnostics-change payload shapes); `events.ts` stays a generic envelope.
  Steps 9, 12, and 14 each define their own `type`/`payload` shapes when they
  start emitting real events.
- Wiring `resource-scope.ts` or `event-bus.ts` into the real `Session`,
  transport, GMCP bus, or any legacy manager. That begins at Step 9
  (transport) and Step 10 (`Session` composition); this step's only consumer
  is its own test file.
- A wildcard/"subscribe to all types" surface. No master-plan Step 6
  acceptance criterion requires it, and `gmcp.js`'s existing `'*'` handler
  pattern is Step 7's per-session GMCP bus to replicate, not this shared
  primitive's job.
- A session directory, registry, or cross-bus/cross-scope discovery
  mechanism. The one-live-session-per-character `SessionRegistry` contract
  stays Step 3's frozen interface, implemented in Step 10.
- Dedicated typed methods per resource kind (for example a socket-specific
  `trackSocket` returning a typed handle). This step's generic
  `own(kind, disposer)` plus three scheduling convenience wrappers is the
  full surface; see Assumptions.

## Assumptions

- [`own(kind, disposer)` plus three scheduling convenience wrappers
  (`setTimeout`, `setInterval`, `requestAnimationFrame`) is a sufficient
  `ResourceScope` surface for every kind the master plan names, without a
  dedicated method per kind] - if false: Steps 9, 12, 14, and 15 call sites
  need per-kind typed wrappers, and this step's public API must grow before
  those steps can specify what they actually need from it.
- [A disposed `ResourceScope`/`SessionEventBus` silently absorbing new
  registrations, rather than throwing, is the correct contract - matching
  this codebase's existing non-throwing diagnostic style
  (`client/model/validators.ts`'s `ValidationResult`, `gmcp.dispatch`'s
  catch-and-continue at `public/js/gmcp.js:71-109`)] - if false: every Step
  9/12/14/15 call site must add its own `disposed` guard before calling into
  these primitives, since a throw would propagate into browser event
  handlers instead of a diagnostics counter.
- [Node's built-in `t.mock.timers` plus the existing legacy
  `requestAnimationFrame = (cb) => setTimeout(cb, 0)` stub
  (`test/connection-transport.test.mjs:29`) is sufficient to exercise the RAF
  convenience wrapper under a fake clock, without a jsdom or browser test
  environment] - if false: Step 6's test file needs a jsdom- or
  Playwright-based fixture instead of the Vite-SSR `node --test` pattern
  Steps 3-5 established, changing this step's verification path.
- [Wiring a `SessionEventBus`'s `dispose()` into an owning `ResourceScope` is
  deliberately left to the composing caller (Step 10) rather than this step
  accepting a `ResourceScope` in the bus's own constructor] - if false,
  `event-bus.ts` needs a direct dependency on `resource-scope.ts`, and this
  step's file order and disposal-composition tests both change.

## Risks

- Implementing kind-specific teardown as separate internal lists, rather than
  one chronologically ordered list, could silently break the cross-kind LIFO
  ordering the master plan's "reverse-order cleanup" acceptance requires.
  Mitigation: `resource-scope.ts` keeps exactly one ordered array of
  `{ kind, disposer }` entries and iterates it in reverse on `dispose()`; the
  Step 5 fixture deliberately interleaves kinds to catch a per-kind-list
  regression.
- A scheduling wrapper that captures `setTimeout`/`requestAnimationFrame` as
  a reference at module load, rather than calling the global at invocation
  time, would silently bypass `t.mock.timers` and the legacy RAF stub,
  making MH4's fake-clock fixture pass for the wrong reason or fail flakily.
  Mitigation: each wrapper calls `globalThis.setTimeout`/`setInterval`/
  `requestAnimationFrame` directly at call time rather than aliasing them at
  the top of the module.
- A throwing disposer or handler could still propagate past isolation if the
  `try`/`catch` wrapper is added only in `resource-scope.ts` or only in
  `event-bus.ts`. Mitigation: both modules independently wrap every
  disposer/handler invocation, mirroring the already-proven `gmcp.dispatch`
  isolation (`public/js/gmcp.js:90-109`) and `LifecycleDiagnostics`'s
  duplicate-disposal precedent (`client/phase0/workspace/lifecycle-diagnostics.ts:69-80`).
- `createChildScope()`'s bookkeeping could double-count or under-count the
  parent's live child-scope count if a child disposes directly instead of
  through its parent, or if a second child is created after the first has
  already disposed. Mitigation: the child registers a callback with the
  parent at creation time that removes the parent-side entry and decrements
  the live count the first time the child disposes, from whichever side
  triggers it; the Step 5 fixture disposes one child directly, disposes a
  second child through the parent, and creates a third child after the first
  two are gone, asserting accurate diagnostics at each point.

## Steps

### Step 1 - Session diagnostics counters and quality-gate coverage

**Files:** `client/runtime/diagnostics.ts` (new), `tsconfig.json`,
`eslint.config.mjs`, `package.json`

**Intent:** Define the eight-literal `ResourceKind` union (`timer`,
`animationFrame`, `subscription`, `observer`, `listener`, `childScope`,
`socket`, `teardown`), a `SessionDiagnosticsSnapshot` interface carrying the
bound `SessionId`, a live count per `ResourceKind`, and the five event
counters (`duplicateDisposals`, `rejectedResources`, `handlerFailures`,
`suppressedEvents`, `misroutedEvents`). Implement `SessionDiagnostics`
(constructed with a `SessionId`) with `trackAcquire(kind)`/`trackRelease(kind)`,
`recordDuplicateDisposal()`, `recordRejectedResource()`,
`recordHandlerFailure()`, `recordSuppressedEvent()`, `recordMisroutedEvent()`,
and `snapshot()`, following the counter/token shape already proven by
`LifecycleDiagnostics` (`client/phase0/workspace/lifecycle-diagnostics.ts:32-152`).
Add `client/runtime/**/*.ts` to `tsconfig.json`'s `include`, the
`scriptFiles` glob in `eslint.config.mjs`, and the `lint`/`format`/
`format:check` globs in `package.json`, exactly as Steps 3, 4, and 5 did for
their own directories.

**Verify:**

```bash
npm run typecheck
npm run lint
npm run format:check
```

**Done when:** `snapshot()` reflects exact counts after an interleaved
acquire/release fixture across every one of the eight kinds; each of the five
event counters increments independently of the others and of resource
counts; the new file passes every extended quality gate.

### Step 2 - Session event envelope types

**Files:** `client/runtime/events.ts` (new)

**Intent:** Define `Unsubscribe = () => void`,
`SessionEvent<TType extends string = string, TPayload = unknown>` as a
readonly `{ sessionId: SessionId; type: TType; payload: TPayload }`, and
`SessionEventHandler<TType, TPayload> = (event: SessionEvent<TType,
TPayload>) => void`. Keep this module type-only with no runtime logic and no
concrete event catalog; enumerating Darkwind-specific event shapes is Steps
9, 12, and 14 scope.

**Verify:**

```bash
npm run typecheck
```

**Done when:** a compile-only fixture proves a handler typed for one
`TType`/`TPayload` pair cannot be assigned a mismatched envelope, and the
module exports no runtime value beyond type aliases.

### Step 3 - Idempotent resource scope

**Files:** `client/runtime/resource-scope.ts` (new)

**Intent:** Implement `createResourceScope(sessionId, diagnostics):
ResourceScope`. `ResourceScope` exposes a `disposed` getter,
`own(kind, disposer): Disposer` for `subscription`/`observer`/`listener`/
`socket`/`teardown` kinds, `setTimeout(callback, delayMs): Disposer`,
`setInterval(callback, delayMs): Disposer`, and
`requestAnimationFrame(callback): Disposer` convenience wrappers that call
`globalThis.setTimeout`/`setInterval`/`requestAnimationFrame` (and their
matching clear/cancel functions) directly at invocation time rather than an
aliased module-level reference, and `createChildScope(): ResourceScope` that
auto-registers its own disposal as a `childScope` resource on the parent and
removes that parent-side entry (decrementing the live count) the first time
either side disposes. Keep exactly one chronologically ordered internal list
of `{ kind, disposer }` entries across every kind. `dispose()` sets
`disposed = true` and iterates that list in reverse (LIFO), calling each
disposer inside a `try`/`catch` that reports a caught throw through
`diagnostics.recordHandlerFailure()` without stopping the remaining
disposers; a second `dispose()` call only calls
`diagnostics.recordDuplicateDisposal()`. After disposal, `own()` and the
three scheduling wrappers do not register or schedule anything: they
synchronously release any already-constructed native resource (or invoke a
provided disposer once) and call `diagnostics.recordRejectedResource()`,
returning a no-op `Disposer`.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** an interleaved timer/listener/socket/child-scope/teardown
registration fixture releases in exact reverse-registration order on
`dispose()`; a second `dispose()` invokes no disposer; a throwing disposer
does not prevent the remaining disposers from running; `own()`/
`setTimeout()`/`setInterval()`/`requestAnimationFrame()` called after
`dispose()` create nothing live and increment the rejected-resource counter;
and, under `t.mock.timers`, a scope disposed before a scheduled timer's or
RAF-stub's delay elapses shows zero invocations after the clock ticks past
that delay.

### Step 4 - Session-scoped event bus

**Files:** `client/runtime/event-bus.ts` (new)

**Intent:** Implement `createSessionEventBus(sessionId, diagnostics):
SessionEventBus` with `subscribe(type, handler): Unsubscribe`,
`publish(type, payload): void` (builds and delivers an envelope stamped with
the bus's own `sessionId`), and `dispatch(event: SessionEvent): void` (the
lower-level entry point for a pre-built envelope, for a future caller
forwarding another module's event). On a disposed bus, `subscribe()` returns
a no-op `Unsubscribe` and calls `diagnostics.recordRejectedResource()`
without registering; `publish()`/`dispatch()` call
`diagnostics.recordSuppressedEvent()` and deliver nothing. `dispatch()` on a
live bus drops and calls `diagnostics.recordMisroutedEvent()` for any event
whose `sessionId` does not match the bus's own, without invoking a handler.
Delivery snapshots the current handler set for the event's `type` into a
plain array before iterating (mirroring `gmcp.dispatch`,
`public/js/gmcp.js:90-109`), wraps each handler call in `try`/`catch`, and on
a throw calls `console.error` plus
`diagnostics.recordHandlerFailure()` without stopping delivery to the
remaining handlers. `dispose()` sets `disposed = true`, clears every
handler registration, and on a second call only calls
`diagnostics.recordDuplicateDisposal()`.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** `dispatch()` of an envelope carrying a different `SessionId`
than the bus's own invokes zero handlers and increments the misrouted-event
counter; a throwing handler is isolated and does not block delivery to the
remaining handlers of that type; a handler that unsubscribes itself or
another handler during delivery does not affect the in-flight delivery's
snapshot but does take effect on the next `publish()`/`dispatch()`; a second
`dispose()` only increments the duplicate-disposal counter; and
`subscribe()`/`publish()`/`dispatch()` after `dispose()` deliver to zero
handlers without throwing.

### Step 5 - Prove the primitives under fake clocks

**Files:** `test/session-lifecycle-primitives.test.mjs` (new)

**Intent:** Follow the Step 3/Step 5 Vite-SSR pattern
(`test/typia-transform-dev.test.mjs:19-36`) to import
`/runtime/diagnostics.ts`, `events.ts`, `resource-scope.ts`, and
`event-bus.ts` through `server.environments.ssr.runner.import`, using
`client/model/ids.ts`'s existing `createSequentialUuidFactory` for
deterministic `SessionId`s. Before any timer/RAF fixture, stub
`globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)` and
`globalThis.cancelAnimationFrame = (id) => clearTimeout(id)` exactly as the
existing legacy fixture already does
(`test/connection-transport.test.mjs:29`), then use
`t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })` /
`t.mock.timers.tick(ms)` exactly as the existing map-data fixture already
does (`test/map-data-v2-lifecycle.test.mjs:232`, `:259`), so the fake clock
transitively controls the RAF stub. Cover every master-plan Step 6 Done-when
scenario (wrong-session routing, handler failure, unsubscribe-during-dispatch,
reverse-order cleanup, repeated disposal, late async completion,
zero-post-dispose-event) plus this plan's disposed-scope-rejects-new-resources
behavior and the multi-child-over-time diagnostics case from Risks.

**Verify:**

```bash
node --test test/session-lifecycle-primitives.test.mjs
npm run format:check
npm run lint
npm run typecheck
npm run check
npm run build
npm run verify:bundle
git diff --check
```

**Done when:** every master-plan Step 6 Done-when condition has a passing
fixture under `t.mock.timers`, every Must-have in this plan has a
corresponding assertion, and the full quality/build battery is green.

## Success criteria

- [ ] `client/runtime/**` is included in typecheck, lint, and format gates
      without widening the legacy `public/js/**` boundary.
- [ ] `SessionDiagnostics` accurately counts all eight resource kinds and all
      five rejection/failure/duplicate/misroute/suppression events.
- [ ] `ResourceScope.dispose()` is idempotent, tears down every owned
      resource in exact reverse-registration order across mixed kinds, and
      isolates a throwing disposer without leaking or stopping the rest.
- [ ] A disposed `ResourceScope` rejects new resources and never lets a
      pending native timer or RAF-stub callback fire after disposal, even
      under an advanced fake clock.
- [ ] `SessionEventBus` only delivers envelopes matching its own bound
      `sessionId`, snapshots subscribers before dispatch, isolates a
      throwing handler, and is idempotent and silent after `dispose()`.
- [ ] The full quality/build battery (`format:check`, `lint`, `typecheck`,
      `check`, `build`, `verify:bundle`) passes alongside the new test.

## Rollback

Nothing built in this step is imported into the boot path, the legacy UI, or
any other production module yet - `client/runtime/**` has no importers until
Steps 9, 10, 12, 14, and 15. Reverting before then is a pure code deletion of
`client/runtime/**`, its test file, and the three added quality-glob entries,
with zero runtime impact, since no shipped build executes this code outside
`node --test`. This step touches no persisted data and no key under
`darkflow-session-core-v1`, so it needs no data-recovery step.

## Execution fit

- Scope: multi-run phase (one step within the ongoing Phase 1 program)
- Lead: Terra at high reasoning - the disposal-ordering and handler-isolation
  semantics carry real correctness risk (silent leaks, wrong-order teardown,
  swallowed exceptions) even though the Vite-SSR/fake-clock/handler-isolation
  patterns from Steps 3-5 and the legacy `gmcp.js`/`lifecycle-diagnostics.ts`
  precedent substantially reduce uncertainty
- Workers: none - `diagnostics.ts`, `events.ts`, `resource-scope.ts`, and
  `event-bus.ts` form one tightly coupled disposal-and-delivery contract;
  splitting authorship risks divergent counter semantics or inconsistent
  reverse-order guarantees between files
- Delegation shape: solo
- Ownership: the lead owns disposal-ordering correctness, the fake-clock test
  harness, and the go/no-go decision before Step 7 begins
- Replan trigger: the RAF-under-fake-clock assumption fails and a jsdom or
  Playwright fixture is needed instead; or Step 9/10 wiring later reveals the
  event-bus/resource-scope disposal-composition boundary this plan
  deliberately deferred was wrong
- Confidence: medium-high - every scheduling/isolation/diagnostics pattern
  this step needs already has a proven precedent somewhere in this codebase;
  the main new judgment call is the exact disposed-scope-rejects-new-resources
  contract shape, which MH3 pins rather than leaves open

Plan self-review: PASS (8/10)

Notes:

- Run a focused adversarial pass (`plan-adversarial`) before implementation
  starts, specifically against the disposed-scope-rejects-new-resources
  contract (MH3) and the cross-kind reverse-order teardown design (MH2) -
  five later steps (9, 10, 12, 14, 15) inherit whatever this step decides,
  and a wrong choice here (throwing instead of absorbing, or per-kind lists
  instead of one ordered list) would ripple through all of them silently.
- `event-bus.ts` deliberately does not depend on `resource-scope.ts`; Step 10
  is expected to compose them by registering `eventBus.dispose` as a
  `teardown` resource on the session's root scope. Record this composition
  decision in the Step 16 decision record so it is not silently reinvented.
- The five-counter diagnostics shape (duplicate disposal, rejected resource,
  handler failure, suppressed event, misrouted event) is new judgment this
  plan introduces; `LifecycleDiagnostics` proves the per-kind resource
  tracking half but had no precedent for session/event-routing failures.
