# Phase 1 Step 7 Implementation Plan

*Plan stress-tested via focused adversarial review (Skeptic, Validator,
Researcher, Architect, Creative). 7 findings surfaced, 6 refined into the
plan below, 1 considered and rejected.*

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 - one bounded subsystem (`client/gmcp/**`, eight new
  files, zero importers yet), built entirely on already-frozen Step 3
  identities and Step 6 disposal/diagnostics conventions; the remaining
  uncertainty is a handful of implementation-level design calls (send-sink
  injection ahead of Step 9's transport, where GMCP-specific diagnostics
  live, and the exact malformed-frame/wildcard interaction) that repository
  evidence and the master plan's own phrasing resolve rather than open
  product questions
- Hard triggers: none - one deliverable, one phase-gate continuation,
  nothing wired into the boot path, no user-requested sequencing
- Current planning horizon: `client/gmcp/frame.ts`,
  `client/gmcp/contracts/core.ts`, `char.ts`, `room.ts`, `comm.ts`,
  `client/gmcp/contracts/validators.ts`, `client/gmcp/bus.ts`, and
  `test/session-gmcp-bus.test.mjs`, exactly as scoped by the master plan's
  Step 7 entry
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:367-383`)
- Evidence horizon: the frozen Step 3 `SessionId` contract, the Step 6
  `SessionDiagnostics`/handler-isolation precedent, the current
  `public/js/gmcp.js` and `public/js/gmcp-normalizer.js` behavior this step
  replaces, the documented Core/Char/Room/Comm message shapes in
  `docs/gmcp-*.md`, and this repository's existing Typia validator
  convention
- Adversarial review: focused, with Architect and Creative added (this step
  defines a boundary/contract Steps 8-13 inherit, and the send-sink and
  malformed-frame questions each had more than one credible resolution) -
  completed. Findings pinned the send-sink signature (Assumption 1), moved
  GMCP diagnostics onto the existing `SessionDiagnostics` counters
  (Assumption 2), corrected a stale 44-vs-43-entry count (MH6, Risk 1) and
  the Char.Items.\*/Char.Defences.\* canonical-table claim (Evidence),
  reordered `Core.Supports.*` tracking to run after validation and added an
  explicit handler-list copy (Step 4), and added two fixtures (Step 5)

The clarification gate is skipped for the same reason Steps 3, 5, and 6
skipped it: the product decision (a session-scoped, validated GMCP bus) is
already approved at the phase level
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:9-15`). This
plan resolves the remaining implementation-level ambiguities as documented
assumptions rather than open questions, because repository precedent already
answers them.

## Goal

Give Phase 1 a session-scoped GMCP bus that replaces the singleton
`public/js/gmcp.js` object for the common protocol surface: package-name
canonicalization and payload normalization, structural validation of
modeled Core, Char, Room, and Comm payloads before typed dispatch,
`Core.Supports` tracking, subscription state, handshake/send mechanics, and
the existing `'*'`-wildcard-plus-per-package handler isolation - all owned
by one instance instead of one module-level object. Nothing built in this
step is imported into the boot path, a legacy manager, or the real
`Session`; that begins at Step 9 (transport) and Step 10 (`Session`
composition), exactly as Step 6 deferred its own wiring.

## Evidence and constraints

- The current bus is one exported singleton object: `handlers`,
  `subscriptions`, and `serverSupports` are shared mutable fields
  (`public/js/gmcp.js:53-57`), so two logical sessions could never observe
  independent state today. `dispatch()` already proves the exact
  handler-isolation shape this step must generalize per instance:
  normalize first, then update `Core.Supports.*` tracking, then snapshot and
  invoke wildcard handlers, then snapshot and invoke package handlers, each
  inside `try`/`catch` that logs and continues rather than lets one throw
  stop delivery (`public/js/gmcp.js:71-109`). Step 6's plan already names
  this as the precedent its own event bus formalized
  (`docs/plans/multi-connection-ui-phase-1-step-6-implementation-plan.md:55-60`).
- `public/js/gmcp-normalizer.js` is the complete existing normalization
  surface: a case-insensitive canonical-name table
  (`public/js/gmcp-normalizer.js:1-46`), `normalizeSupportsPayload` for
  array/object supports payloads (`:64-80`), and payload-shape aliasing for
  `Char.Vitals` (`:82-109`), `Room.Info` (`:111-133`), `Comm.Channel`/
  `Comm.Channel.Text` (`:135-145`), and `Group` (`:147-159`), dispatched by
  `normalizeGmcpFrame` (`:161-180`). Notably, there is no `Char.Enemy`
  normalization case anywhere in this file: the docs' generic cross-MUD
  alias shape for `Char.Enemy` (`docs/gmcp-char.md:112-114`) is not applied
  at the GMCP-ingress layer today, so this step models only the native
  Darkwind `enemy_*` shape actually validated at ingress
  (`docs/gmcp-char.md:99-109`).
  `Char.Defences.*` sub-package names are absent from the canonical-name
  table, meaning Darkwind already sends those with correct casing and no
  aliasing is currently applied to them. `Char.Items.List`/`.Add`/`.Remove`/
  `.Update`, by contrast, already have identity entries in the table
  (`public/js/gmcp-normalizer.js:10-13`) that case-normalize but do not
  rename them; `frame.ts`'s ported table must keep those entries rather than
  drop them as if they were unmapped like `Char.Defences.*`.
- No `client/*.ts` module imports from `public/js/*` anywhere in this
  repository; the only reference is a comment in
  `client/storage/config-validator.ts:36-37` that cites legacy line numbers
  to replicate, never an import. This step continues that boundary rather
  than pulling untyped legacy code into `client/gmcp/**`.
- Every existing Typia validator in this repository uses
  `typia.createValidate<T>()` (`client/model/validators.ts:7,9`;
  `client/storage/config-validator.ts:14`; `client/storage/validators.ts:11`;
  `client/phase0/gmcp-validators.ts:4`; `client/app/bootstrap.ts:8`), which
  performs structural (non-exact) validation - an object with extra,
  undeclared keys still passes. This already satisfies MH6's "unknown extra
  keys remain allowed" without any additional Typia configuration.
- The documented message shapes this step must model are:
  `Core.Hello`/`Core.Supports.*`/`Core.Ping` (`docs/gmcp-core.md:18-82`);
  `Char.Vitals`, `Char.Status`, `Char.StatusVars`, `Char.Stats`/
  `Char.RealStats`, `Char.Worth`, `Char.Enemy`, `Char.Items.*`,
  `Char.Defences.*` (`docs/gmcp-char.md:40-165`); `Room.Info`,
  `Room.Players`/`AddPlayer`/`RemovePlayer` (`docs/gmcp-room.md:16-72`); and
  `Comm.Channel`/`.Text`/`.List`/`.Players`/`.Start`/`.End`/`.Enable`
  (`docs/gmcp-comm.md:9-78`).
- `client/gmcp/**` does not yet exist in the TypeScript include list, the
  ESLint `scriptFiles` glob, or the lint/format/format:check globs
  (`tsconfig.json:18-27`, `eslint.config.mjs:7-18`, `package.json`'s
  `lint`/`format`/`format:check` scripts). Steps 3-6 each added their own
  directory to all three the same way; this step must do the same for
  `client/gmcp/**`.
- No scoped transport exists yet - that is Step 9, which comes after this
  step in the dependency chain
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:206-222`).
  `public/js/gmcp.js`'s `send()` reaches directly into `state.ws` and
  `sendSocketPayload` (`public/js/gmcp.js:116-126`), which this step cannot
  depend on without importing legacy globals into a typed session module.
- Step 6's `SessionEventBus`/`ResourceScope`/`SessionDiagnostics` contract is
  already committed and covered by a passing test
  (`test/session-lifecycle-primitives.test.mjs`, 8/8 passing as of this
  plan). The master plan's Step 7 "Files" list does not include
  `client/runtime/diagnostics.ts`, unlike Step 12's or Step 14's file lists,
  which do touch runtime-adjacent modules explicitly when they need to - but
  that means this step does not *edit* `diagnostics.ts`, not that it cannot
  *depend on* the already-committed `SessionDiagnostics` class it exports;
  see Assumption 2.
- Step 8 explicitly owns the Darkwind-specific package families (window,
  IDE, MapData2, client-control) and the full legacy-package inventory
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:385-402`).
  Step 12 explicitly owns `gmcp-variables.js`
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:462-463`),
  which today registers on every dispatched frame unconditionally
  (`public/js/gmcp.js:88`, `registerGmcpVariables`).

## Must-haves

- [MH1] Canonical package-name resolution and generic frame normalization
  match every case the legacy normalizer currently handles, operating on
  `unknown` input before any modeled-type validation runs. Acceptance: every
  fixture case from `test/gmcp-normalizer.test.mjs` (case-insensitive
  canonicalization, `Core.Supports.*` array/object payloads, `Char.Vitals`
  Aardwolf-style aliases, `Room.Info` coords/exits shaping, `Comm.Channel`
  field aliasing) passes unchanged against the ported TypeScript
  implementation.
- [MH2] Core, Char, Room, and Comm payloads are structurally validated only
  when their canonical package name has a registered validator; any other
  canonical name continues through unchanged. Acceptance: every documented
  valid example payload in `docs/gmcp-core.md`, `gmcp-char.md`,
  `gmcp-room.md`, and `gmcp-comm.md` validates successfully through its
  looked-up validator; a canonical name absent from Step 2's contracts
  resolves to no validator and is never blocked.
- [MH3] A malformed known-field frame reaches neither its package-specific
  handler nor the wildcard handler, is recorded through the session's
  diagnostics, and does not disconnect the session or block delivery of the
  next frame. Acceptance: a fixture posts one malformed `Char.Vitals` frame
  (a documented field holding the wrong runtime type) immediately followed
  by one valid `Room.Info` frame on the same bus instance; zero handlers -
  package-specific or wildcard - observe the malformed frame, the session's
  `SessionDiagnostics.suppressedEvents` counter increments exactly once, and
  the valid `Room.Info` frame is still delivered to its handlers.
- [MH4] Two `SessionGmcpBus` instances never observe each other's handlers,
  supports map, subscription state, outbound sends, or diagnostics.
  Acceptance: a two-bus fixture registers distinct handlers and independent
  fake send sinks on each bus, calls `serverSupportsPackage`,
  `sendHandshake`, and `dispatch` differently on each, and asserts neither
  bus's observable state ever reflects the other's calls.
- [MH5] `Core.Supports.Set`/`Add`/`Remove` tracking and
  `serverSupportsPackage()` reproduce the exact legacy replace/merge/delete
  semantics. Acceptance: a fixture replays `Set`, then `Add`, then `Remove`
  against overlapping package names in sequence and asserts the exact
  resulting supports map after each call, matching
  `public/js/gmcp.js:76-86`.
- [MH6] Handshake, subscription, and send mechanics are session-scoped and
  transport-agnostic: every outbound frame goes through one injected send
  function rather than a global socket. Acceptance: constructing two bus
  instances with two independent fake send-sink spies and calling
  `sendHandshake()`/`sendSubscriptions()`/`restartHandshake()`-equivalent
  methods on one never invokes the other's sink; the emitted
  `Core.Supports.Set` package/version list is deep-equal to the 43-entry
  legacy list (`public/js/gmcp.js:137-179`).
- [MH7] One throwing package-specific or wildcard handler does not starve
  delivery to the remaining handlers of the same frame, mirroring
  `gmcp.dispatch`. Acceptance: a fixture registers three handlers on the
  same package where the middle handler throws; the first and third are
  both invoked, and the failure is recorded via
  `SessionDiagnostics.recordHandlerFailure()` rather than propagating out of
  `dispatch()`.

## Out of scope

- `Group` and `Game` package contracts and validators. Neither is part of
  Core/Char/Room/Comm; both remain on the ordinary (unvalidated) dispatch
  path pending Step 8's inventory, even though the legacy normalizer already
  has a `Group` case (`public/js/gmcp-normalizer.js:147-159`) - normalizing
  a package is not the same as modeling and validating it.
- `Char.Enemy`'s documented generic cross-MUD alias shape
  (`docs/gmcp-char.md:112-114`). It is not handled by the existing
  GMCP-layer normalizer today and stays a Phase 2 panel-rendering concern;
  this step models only the native Darkwind `enemy_*` shape.
- `Darkwind.Window`, `Darkwind.IDE`, `Darkwind.MapData2`, and
  `Darkwind.Client.*` contracts, and the full legacy-package inventory
  document. Those are Step 8's deliverables, built on this step's `bus.ts`
  and `validators.ts`.
- GMCP variable registration (`registerGmcpVariables`/`resetGmcpVariables`).
  Step 12 owns `gmcp-variables.js`; this step only preserves the
  `'*'`-wildcard handler registration point Step 12 will subscribe through,
  exactly as Step 6 deferred a concrete event catalog to its own consumers.
- A formally, separately named "unmodeled" compatibility dispatch entry
  point and its full package accounting. That labeling and inventory is
  explicitly Step 8 work; this step's unmodeled packages simply continue
  through ordinary `dispatch()` unchanged, same as today.
- Wiring the bus into the real `Session`, a scoped transport, or any legacy
  manager, and any real WebSocket send. That begins at Step 9 (transport)
  and Step 10 (`Session` composition); this step's only consumer is its own
  test file.
- UI side effects such as `appendSystemMessage` on a handshake restart
  (`public/js/gmcp.js:265`). Bus methods return results; a future
  compatibility facade (Step 13) decides what, if anything, the UI shows.

## Assumptions

- [The `SessionGmcpBus` sends outbound frames through one injected send
  function - pinned to `(bytes: Uint8Array) => boolean`, not a
  `(packageName, data) => boolean` structured alternative, so `bus.ts` owns
  GMCP-level encoding and the sink only ever sees transport-level bytes,
  matching `public/js/gmcp.js:118-126`'s existing `send()` shape - rather
  than owning or reaching into a WebSocket, since scoped transport is not
  extracted until Step 9] - if false: this step must either wait until after
  Step 9, or accept a mutable/nullable socket reference and duplicate the
  open/closed gating logic Step 9 will own, pulling transport scope into
  this step.
- [`createSessionGmcpBus` takes an injected `SessionDiagnostics` instance
  (`client/runtime/diagnostics.ts`) and records malformed frames via its
  existing `recordSuppressedEvent()` and throwing handlers via its existing
  `recordHandlerFailure()`, rather than inventing a bus-local counter type -
  both counters are already generic, not GMCP-specific; `event-bus.ts`
  already establishes this exact inject-and-record pattern without editing
  `diagnostics.ts`; and the master plan's own Step 7 intent says malformed
  fields are rejected "to session-tagged diagnostics"
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md`, Step 7
  section) - language that names `SessionDiagnostics` specifically. This
  adds a dependency on `client/runtime/diagnostics.ts` that Step 7's Files
  list doesn't mention, but `bus.ts` already depends on `client/model/ids.ts`
  for `SessionId` the same way, so an unlisted read-only dependency on
  another frozen step's module is already this plan's own pattern] - if
  false: a bus-local counter type must be introduced instead, and Step 5's
  fixtures must assert against that bespoke shape rather than a
  `SessionDiagnostics.snapshot()` read.
- [`frame.ts` re-implements canonicalization and normalization in
  TypeScript rather than importing `public/js/gmcp-normalizer.js`,
  continuing the boundary every other `client/*.ts` module already
  observes] - if false: `client/gmcp/**` gains a runtime dependency on
  unaudited legacy JS, and Step 13's compatibility cutover inherits two
  divergent copies of normalization logic to reconcile instead of one.
- [`typia.createValidate<T>()`'s existing structural, non-exact behavior is
  sufficient to satisfy "unknown extra keys remain allowed" without any
  extra Typia configuration, matching this repository's existing validator
  convention] - if false: every modeled interface needs explicit loose-mode
  annotation, and this step's fixtures must additionally prove today's
  default would have wrongly rejected a real server payload.
- [`Core.Hello`'s server-to-client direction stays unvalidated against a
  strict shape, since the protocol docs describe only "optional server
  identity" with no fixed field list (`docs/gmcp-core.md:36-38`)] - if
  false: a concrete inbound `Core.Hello` schema must be reverse-engineered
  from server behavior before this step's validator set is complete.
- [A malformed known-field frame is withheld from both the package-specific
  handler and the wildcard handler, not just the package-specific one -
  reading the master plan's "no typed handler" as covering every handler on
  the typed bus] - if false: MH3's fixture and `bus.ts`'s dispatch gate both
  invert, and Step 12's future wildcard-based variable listener would need
  its own separate malformed-frame filter instead of inheriting this step's
  guarantee.

## Risks

- Hand-copying the 43-entry `Core.Supports.Set` list risks silent drift from
  the legacy list, breaking the parity Step 13/16 will test. Mitigation:
  the test file imports and deep-equals against the same array `bus.ts`
  sends, and a second fixture asserts its length and a spot-checked subset
  of entries against `public/js/gmcp.js:137-179` rather than relying on
  visual inspection or a hardcoded count.
- The master plan's "malformed known fields reach diagnostics but no typed
  handler" is terse enough to support the opposite reading (wildcard still
  receives raw, unvalidated data). Picking wrong changes what Step 12's
  wildcard-based GMCP-variable listener will actually observe once wired
  up. Mitigation: MH3 and Assumption 6 pin this plan's binding
  interpretation explicitly, recorded for Step 16's interface freeze to
  confirm or override before Step 12 depends on it.
- A validator registered under a canonical package name that does not
  exactly match what `dispatch()` looks up (a casing slip, a stray space, or
  a lookup that skips canonicalization) would silently fall back to
  unvalidated passthrough for a package this step intends to model.
  Mitigation: the canonical-name-to-validator lookup always canonicalizes
  its key through the same `canonicalPackageName()` function `dispatch()`
  uses, and the test file asserts every documented Core/Char/Room/Comm
  message name from `docs/gmcp-*.md` round-trips to a registered validator.
- Porting field-alias normalization inconsistently (for example keeping
  `Char.Vitals`'s mana/move aliasing but dropping `Room.Info`'s coordinate
  copy) would silently change which payloads the client accepts from
  non-Darkwind or legacy-shaped sources. Mitigation: `frame.ts`'s
  normalization fixtures port every existing case from
  `test/gmcp-normalizer.test.mjs` unchanged before any modeled-type
  validation is layered on top, so a missed case fails an existing
  assertion rather than going unnoticed.

## Steps

### Step 1 - Canonical frame normalization and quality-gate coverage

**Files:** `client/gmcp/frame.ts` (new), `tsconfig.json`,
`eslint.config.mjs`, `package.json`

**Intent:** Port `canonicalPackageName`, `normalizeSupportsPayload`, and the
package-specific normalization cases for `Core.Supports.*`, `Char.Vitals`,
`Room.Info`, and `Comm.Channel`/`Comm.Channel.Text` from
`public/js/gmcp-normalizer.js:1-180` into typed TypeScript. Export a
`GmcpFrame` type (`{ packageName: string; data: unknown }`) and a
`normalizeGmcpFrame(packageName: string, data: unknown): GmcpFrame`
dispatcher that operates on `unknown` input and runs before any modeled-type
validation. Add `client/gmcp/**/*.ts` to `tsconfig.json`'s `include`, the
`scriptFiles` glob in `eslint.config.mjs`, and the `lint`/`format`/
`format:check` globs in `package.json`, exactly as Steps 3-6 did for their
own directories.

**Verify:**

```bash
npm run typecheck
npm run lint
npm run format:check
```

**Done when:** every canonicalization/normalization fixture ported from
`test/gmcp-normalizer.test.mjs` passes unchanged against `frame.ts`, and the
new directory passes every extended quality gate.

### Step 2 - Core, Char, Room, and Comm protocol contracts

**Files:** `client/gmcp/contracts/core.ts`, `char.ts`, `room.ts`, `comm.ts`
(all new)

**Intent:** Define plain interfaces for each documented message shape,
citing `docs/gmcp-*.md` line ranges in a short comment per interface:
`core.ts` for outbound `Core.Hello` (`client`, `version`, `width`, `height`)
and the `Core.Supports` payload (`string[] | Record<string, string |
number>`); `char.ts` for `Char.Vitals`, `Char.Status`, `Char.StatusVars` (an
open `Record<string, unknown>`, per `docs/gmcp-char.md:80-82`),
`Char.Stats`/`Char.RealStats`, `Char.Worth`, `Char.Enemy` in its native
Darkwind shape, `Char.Items.List`/`.Add`/`.Remove`/`.Update`, and
`Char.Defences.List`/`.Add`/`.Remove`; `room.ts` for `Room.Info` and
`Room.Players`/`.AddPlayer`/`.RemovePlayer`; `comm.ts` for the channel
message shape (both field-name families), `Comm.Channel.List` entries,
`Comm.Channel.Players` entries, and `Comm.Channel.Start`/`.End`. Model only
fields the linked docs specify; leave genuinely free-form objects (room
`details`, `Char.StatusVars`) as `Record<string, unknown>` rather than
inventing structure the docs do not promise.

**Verify:**

```bash
npm run typecheck
```

**Done when:** every documented example payload in `docs/gmcp-core.md`,
`gmcp-char.md`, `gmcp-room.md`, and `gmcp-comm.md` type-checks as a value of
its corresponding interface in a compile-only fixture.

### Step 3 - Validators and canonical-name lookup

**Files:** `client/gmcp/contracts/validators.ts` (new)

**Intent:** Export one `typia.createValidate<T>()` per interface from Step
2. Export a `Record<string, (input: unknown) => typia.IValidation<unknown>>`
keyed by every canonical inbound package name Step 2 modeled (`Core.Hello`
is outbound-only and excluded; `Core.Supports.Set`/`.Add`/`.Remove` share
one validator). Build the lookup table's keys by running each literal
package name through `frame.ts`'s `canonicalPackageName()` rather than
hardcoding the canonical spelling twice.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** a fixture posts every documented valid example through its
looked-up validator and gets `success: true`; the same example with one
required, documented field's runtime type flipped (a number where a string
is documented, and vice versa) gets `success: false`; a canonical package
name Step 2 did not model resolves to no lookup entry.

### Step 4 - Session-scoped GMCP bus

**Files:** `client/gmcp/bus.ts` (new)

**Intent:** Implement `createSessionGmcpBus(sessionId, sendSink, diagnostics)`:

- `sendSink: (bytes: Uint8Array) => boolean` - a small injected function
  standing in for Step 9's real transport, pinned to the byte-level
  signature (Assumption 1) rather than a structured `(packageName, data)`
  alternative. `bus.ts` owns `packageName + ' ' + JSON.stringify(data)`
  encoding itself, matching `public/js/gmcp.js:118-126`'s existing `send()`,
  and hands the sink only encoded bytes, so protocol framing stays in this
  step and Step 9's transport only ever sees bytes, never GMCP semantics.
- `diagnostics: SessionDiagnostics` (from `client/runtime/diagnostics.ts`,
  a read-only dependency not in this step's Files list, the same way
  `SessionId` is - see Assumption 2)

returning a `SessionGmcpBus` with `on(packageName, handler)`/`off(...)`
including the existing `'*'` wildcard, `dispatch(packageName, data)`,
`serverSupportsPackage(name)`, `sendHandshake(clientInfo)`,
`sendSubscriptions(payload)`, `requestMediaRefresh()`,
`requestChannelPlayers()`, `enableChannel(name)`, and a
`restartHandshake(payload)`-equivalent that composes the same
reset-then-handshake-then-subscriptions-then-media-refresh sequence as
`public/js/gmcp.js:242-267`, minus its `appendSystemMessage` UI call.

`dispatch()` runs in this order: (1) `frame.ts`'s `normalizeGmcpFrame`; (2)
look up a validator by canonical name - if one exists and validation fails,
call `diagnostics.recordSuppressedEvent()` and return before touching
`Core.Supports.*` tracking or invoking any handler for that frame (validate
before tracking, not after: a malformed `Core.Supports.Set` must never
mutate the bus's supports map, a distinction `public/js/gmcp.js` has no
validation step to make); (3) update `Core.Supports.*` tracking exactly as
`public/js/gmcp.js:76-86` does; (4) copy the wildcard and package-specific
handler lists (`[...handlers]`) before iterating either - new behavior this
step introduces, not a literal port, since `public/js/gmcp.js:92-109`'s
`forEach` iterates the live arrays directly - then invoke each copy in
turn, each call wrapped in `try`/`catch` that logs and calls
`diagnostics.recordHandlerFailure()` without stopping delivery to the rest,
mirroring the isolation goal (not the literal iteration mechanics) of
`public/js/gmcp.js:90-109`.

**Verify:**

```bash
npm run typecheck
npm run build
npm run verify:bundle
```

**Done when:** two bus instances constructed with independent sinks and
independent `SessionDiagnostics` instances never observe each other's
handlers, supports map, subscription state, sends, or diagnostics (MH4);
`Core.Supports.Set`/`.Add`/`.Remove` sequencing matches legacy semantics
exactly (MH5); a malformed known-field frame reaches no handler of either
kind, leaves `Core.Supports.*` tracking untouched, and is recorded via
`diagnostics.recordSuppressedEvent()` without disconnecting or blocking the
next frame (MH3); a handler that unsubscribes another handler for the same
package mid-dispatch does not change which handlers receive the in-flight
frame; and a throwing handler does not block delivery to the remaining
handlers for the same frame and is recorded via
`diagnostics.recordHandlerFailure()` (MH7).

### Step 5 - Prove the bus against the master plan's Done-when scenarios

**Files:** `test/session-gmcp-bus.test.mjs` (new)

**Intent:** Follow the Vite-SSR pattern already proven in
`test/session-lifecycle-primitives.test.mjs` (import via
`server.environments.ssr.runner.import`) to import `/gmcp/frame.ts`,
`/gmcp/contracts/*.ts`, `/runtime/diagnostics.ts`, and `/gmcp/bus.ts`, using
`client/model/ids.ts`'s `createSequentialUuidFactory` for deterministic
`SessionId`s, one `SessionDiagnostics` instance per bus, and two fake
send-sink spies for the two-bus isolation fixture. Cover every master-plan
Step 7 Done-when scenario (two-bus isolation across handlers/supports/
subscriptions/variables/send/diagnostics, malformed frames never reaching a
typed handler, both transformed validator paths executing) plus this plan's
malformed-frame/wildcard-suppression (MH3), `Core.Supports` sequencing
(MH5), and `Core.Supports.Set` list parity (Risk 1) fixtures, and two
adversarial-review additions: a handler that calls `off()` on another
handler for the same package mid-`dispatch()` (proving the Step 4
handler-list copy actually protects in-flight delivery - the same scenario
`test/session-lifecycle-primitives.test.mjs`'s "SessionEventBus isolates
handler failures and snapshot delivery" test already proves for the generic
event bus), and a malformed `Core.Supports.Set` frame (proving it is
rejected to diagnostics before it touches the supports map, not just before
handlers see it).

**Verify:**

```bash
node --test test/session-gmcp-bus.test.mjs
npm run build
npm run verify:bundle
npm run format:check
npm run lint
npm run typecheck
npm run check
git diff --check
```

**Done when:** every master-plan Step 7 Done-when condition and every
Must-have in this plan has a corresponding passing fixture, and the full
quality/build battery is green.

## Success criteria

- [ ] `client/gmcp/**` is included in typecheck, lint, and format gates
      without widening the legacy `public/js/**` boundary.
- [ ] `frame.ts` reproduces every existing normalization/canonicalization
      case from `public/js/gmcp-normalizer.js`.
- [ ] Core, Char, Room, and Comm payloads validate structurally, allow
      unknown extra keys, and reject documented fields holding the wrong
      runtime type.
- [ ] A malformed known-field frame reaches neither a package-specific nor
      a wildcard handler, is diagnosed, and does not disconnect the session
      or block the next frame.
- [ ] Two `SessionGmcpBus` instances are fully isolated: handlers, supports,
      subscriptions, sends, and diagnostics never leak between them.
- [ ] `Core.Supports.Set`/`.Add`/`.Remove` tracking and the emitted
      handshake support list match legacy behavior exactly.
- [ ] The full quality/build battery (`format:check`, `lint`, `typecheck`,
      `check`, `build`, `verify:bundle`) passes alongside the new test.

## Rollback

Nothing built in this step is imported into the boot path, the legacy UI, or
any other production module yet - `client/gmcp/**` has no importers until
Step 8 extends its contracts/validators and Steps 9-10 wire the bus into the
real `Session`. Reverting before then is a pure code deletion of
`client/gmcp/**`, its test file, and the three added quality-glob entries,
with zero runtime impact, since no shipped build executes this code outside
`node --test`. This step touches no persisted data and no key under
`darkflow-session-core-v1`, so it needs no data-recovery step.

## Execution fit

- Scope: multi-run phase (one step within the ongoing Phase 1 program)
- Lead: Terra at high reasoning - the malformed-frame/wildcard-suppression
  contract and the two-bus isolation guarantee carry real correctness risk
  (a wrong call here silently reshapes what Step 12's variable listener and
  every future panel handler observe), even though the normalization,
  Typia-validator, and Vite-SSR test patterns from Steps 3-6 substantially
  reduce uncertainty
- Workers: none - `frame.ts`, the four contract files, `validators.ts`, and
  `bus.ts` form one tightly coupled normalize-validate-dispatch contract;
  splitting authorship risks divergent canonicalization or inconsistent
  malformed-frame handling between files
- Delegation shape: solo
- Ownership: the lead owns the malformed-frame/wildcard interpretation, the
  Core.Supports.Set parity fixture, and the go/no-go decision before Step 8
  begins
- Replan trigger: the send-sink injection shape (Assumption 1) turns out to
  be wrong once Step 9's transport exists and needs a different bus-facing
  contract; or Step 16's interface freeze overrides this plan's
  malformed-frame/wildcard interpretation (Assumption 6) after Step 12 is
  already built against it
- Confidence: medium-high - every normalization, validation, and
  handler-isolation pattern this step needs already has a proven precedent
  in this codebase; the main new judgment calls are the send-sink boundary
  and the malformed-frame/wildcard interpretation, both of which this plan
  pins explicitly rather than leaves open

Plan self-review: PASS (8/10)

Notes:

- A focused adversarial pass (`plan-adversarial`, Skeptic/Validator/
  Researcher/Architect/Creative) ran against the malformed-frame/
  wildcard-suppression contract (MH3, Assumption 6) and the send-sink
  injection boundary (Assumption 1) before implementation starts - Steps 9,
  10, 12, and 13 all inherit whatever this step decides, the same reason
  Step 6's plan recommended review before its own disposal-ordering
  contract shipped. Results are folded into Assumption 1, Assumption 2,
  Step 4, and Step 5 above.
- `bus.ts` deliberately does not depend on `client/runtime/event-bus.ts` or
  `resource-scope.ts` for its handler registry - it stays package-name-keyed
  like the legacy object, not a generic typed-event bus - but it does now
  depend on `client/runtime/diagnostics.ts` for counters (Assumption 2);
  these are two independent decisions, not one. Step 10 is expected to
  register the composed bus's teardown (closing handlers, not a socket) as
  a `teardown` resource on the session's root scope. Record this
  composition decision in the Step 16 decision record so it is not silently
  reinvented.
- Adversarial review reversed this plan's original intent to give GMCP its
  own bus-local diagnostics counters. Malformed-frame and handler-failure
  counting now goes straight into the injected `SessionDiagnostics`
  instance's existing `recordSuppressedEvent()`/`recordHandlerFailure()`
  methods (Assumption 2), so Step 8's and Step 12's future GMCP consumers
  read GMCP health from the same per-session diagnostics snapshot every
  other runtime primitive already reports through, with no separate counter
  shape to reconcile later.
- Adversarial review (Creative lens) considered tagging malformed frames
  with a `valid: false` flag and delivering them to the wildcard handler
  anyway, letting a future consumer decide rather than the bus deciding
  unilaterally. Rejected for now: no wildcard consumer exists yet that would
  read such a flag (Step 12 is the earliest candidate and is not built), so
  it would add a discriminated-payload shape to every wildcard delivery for
  a hypothetical need. The binary gate (Assumption 6) stays; Step 16's
  interface freeze remains the cheap override point if a real consumer later
  needs the raw payload.
