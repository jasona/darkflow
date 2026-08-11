# Phase 1 Step 9 Implementation Plan

*Plan stress-tested via focused adversarial review (Skeptic, Validator,
Researcher, Architect, Creative). 13 findings surfaced, 10 refined into the
plan below, 3 alternatives considered and rejected.*

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 - one bounded subsystem (`client/transport/**`, four new
  files, zero importers yet), built entirely on already-frozen Step 3
  identities and Step 6 disposal/event primitives; the remaining uncertainty
  is a handful of extraction-boundary design calls (session-event vs.
  callback split for the guard timers, live-vs-static endpoint/autoReconnect
  config, the `send()` signature) that repository evidence and the master
  plan's own phrasing resolve rather than open product questions
- Hard triggers: none - one deliverable, one phase-gate continuation, nothing
  wired into the boot path, no user-requested sequencing
- Current planning horizon: `client/transport/types.ts`, `urls.ts`,
  `health.ts`, `connection.ts`, `reconnect.ts`, and
  `test/session-transport.test.mjs`, exactly as scoped by the master plan's
  Step 9 entry
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:410-428`)
- Evidence horizon: the current `public/js/connection.js` transport/reconnect
  implementation in full, the `public/js/state.js` health-state shape it
  mutates, the existing unit and Playwright transport fixtures, the frozen
  Step 3 `SessionId` contract, the already-committed Step 6
  `ResourceScope`/`SessionEventBus`/`SessionDiagnostics` and Step 7
  `SessionGmcpBus` send-sink boundary this step must compose with, and
  `CLAUDE.md`'s WebSocket text-frame/binary-frame protocol split
- Adversarial review: focused, with Architect and Creative added (this step
  defines a boundary/contract Steps 10 and 13 inherit, and several
  extraction-boundary questions had more than one credible resolution) -
  completed. Findings corrected two citation errors, split a conflated
  connection-state/reconnect-status type, added a concurrent-connect guard,
  a `retryNow()` equivalent, the previously-omitted `online`-event recovery
  listener, an explicit user-initiated-disconnect flag, a named/exported
  GMCP-decode seam, an explicit composition-root rule between `reconnect.ts`
  and `connection.ts`, and a protocol-correctness justification (not just an
  empirical one) for `send()`'s dual-type signature. Results are folded into
  the Evidence, Must-haves, Steps, and Notes below.

The clarification gate is skipped for the same reason Steps 3, 5, 6, 7, and 8
skipped it: the product decision (scoped transport/reconnect ownership) is
already approved at the phase level
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:9-15`). This
plan resolves the remaining implementation-level ambiguities as documented
assumptions rather than open questions, because repository precedent already
answers them.

## Goal

Give Phase 1 a session-scoped transport that replaces the module-global
socket/reconnect/health state in `public/js/connection.js` with one injected
instance per session: the transport fallback ladder, proxy URL construction,
connection epochs, health watchdog, lost-transmission recovery, upgrade
probe, reconnect backoff, handshake retry, send accounting, and online
recovery all move behind one object that emits session events and byte/GMCP
callbacks instead of touching the DOM, panels, settings, or any other global
state. Nothing built in this step is imported into the boot path, a legacy
manager, or the real `Session`; that begins at Step 10 (`Session`
composition) and Step 13 (compatibility cutover).

## Evidence and constraints

- The current transport is entirely module-global state: `watchdogTimer`,
  `transportIndex`, `activeLadder`, `cycleRungsTried`, and four more timer
  handles live as bare module-level `let`s
  (`public/js/connection.js:41-51`), and socket/reconnect/health fields live
  on the shared `state` singleton (`public/js/state.js:1-30`), so two logical
  sessions could never observe independent transport state today.
- `buildTransportLadder(selected)` filters plain `ws` on `https:` pages
  (mixed content) and reorders the selected rung to the front, keeping the
  rest in priority order (`public/js/connection.js:100-110`).
  `nextTransport`/`advanceTransport`/`resetTransportLadder` track which rung
  is active within one reconnect cycle (`public/js/connection.js:112-141`),
  and `handleRungFailure` cycles through every untried rung with a fixed
  `WS_FORCE_RECONNECT_DELAY_MS` (250ms) delay before falling back to normal
  exponential backoff once the whole ladder has failed
  (`public/js/connection.js:245-264`).
- `connect()` guards against overlapping attempts with
  `if (state.ws || state.connectionPending) return;`
  (`public/js/connection.js:598`) and builds a direct `ws://`/`wss://` URL
  for `ws`/`wss`, or bridges through this server's own `/proxy` endpoint with
  `host`/`port`/`tls` query parameters for `telnet`/`telnets`
  (`public/js/connection.js:615-633`), reading `dom.host.value`,
  `dom.port.value`, and `dom.protocolSelect.value` fresh on every call
  (`public/js/connection.js:616,618-619`). `ensureConnected()` and
  `retryNow()` are the two exported entry points other legacy modules use to
  (re)kick a dead connection: `ensureConnected()` is idempotent and defers to
  any in-flight attempt, while `retryNow()` cancels a pending backoff timer,
  clears `state.userDisconnected`, and connects immediately
  (`public/js/connection.js:380-396`).
- `setConnectionState(connState)` is called with exactly three literal
  values across the whole module -- `'connecting'`, `'connected'`,
  `'disconnected'` (`public/js/connection.js:637,649,668,313`) -- and is a
  distinct signal from `emitReconnectStatus(detail)`, which carries a
  four-value `status` field -- `'connecting' | 'scheduled' | 'connected' |
  'idle'` -- describing whether an automatic retry is pending, documented at
  its own call site and used identically at every emission
  (`public/js/connection.js:86-98,638,654,680,803,829`, plus the
  `'scheduled'` emissions inside `handleRungFailure`, `forceReconnect`, and
  `scheduleReconnect` at `public/js/connection.js:249,347,583`). These are
  two independent enums today, not one merged state machine.
- `evaluateSocketHealth()` runs every `WS_HEALTH_INTERVAL_MS` (5000ms) and
  detects two independent stall conditions -- a command burst with no
  inbound reply for `WS_STALL_WINDOW_MS` (8000ms), and a buffered-output
  backlog above `WS_STALLED_BUFFERED_THRESHOLD` (64KB) with no in/out
  traffic for the same window -- each triggering `forceReconnect()`
  (`public/js/connection.js:21-30,398-432`).
- `forceReconnect()` tears down the current socket, closes it with code
  4000, and always retries after a fixed `WS_FORCE_RECONNECT_DELAY_MS`
  regardless of `state.reconnectAttempts` (`public/js/connection.js:326-357`),
  which is distinct from `scheduleReconnect()`'s exponential
  `RECONNECT_BASE_MS * 2^attempts` backoff capped at `RECONNECT_MAX_MS`
  (`public/js/connection.js:579-592`; constants imported from
  `public/js/constants.js`).
- `scheduleUpgradeProbe()` opens a background probe socket on the preferred
  transport when the session connected on a lower rung, and only upgrades if
  `loggedIntoCharacter()` is false -- a read of
  `panelManager.gmcpData.vitals` (`public/js/connection.js:154-158,166-207`).
  `scheduleHandshakeGuard()` re-sends the GMCP handshake once if text has
  flowed but no GMCP frame arrived within `HANDSHAKE_RESEND_DELAY_MS`
  (3000ms), calling `gmcp.sendHandshake()`/`gmcp.sendSubscriptions()`
  directly (`public/js/connection.js:214-239`).
  `scheduleLostTransmissionRecovery()` matches a server-emitted
  "Text lost in transmission" marker, waits
  `LOST_TRANSMISSION_RECOVERY_DELAY_MS` (750ms) inside a
  `LOST_TRANSMISSION_RECOVERY_COOLDOWN_MS` (30000ms) cooldown, then calls
  `gmcp.restartHandshake()` directly (`public/js/connection.js:439-469`).
  All three reach directly into GMCP, panel, or settings state today.
- A top-level, unconditional `window.addEventListener('online', ...)`
  listener retries the connection when the browser regains network, guarded
  by `!state.userDisconnected` and either `autoReconnect` being on or a
  reconnect timer already pending (`public/js/connection.js:811-821`). The
  master plan's own Step 9 intent names "online recovery" explicitly as
  behavior this step ports
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:416-421`).
- `ws.onmessage` distinguishes string frames (game text, appended via
  `appendOutput`) from binary frames (GMCP): binary payloads decode through
  `gmcpTextDecoder`, split at the first space into `packageName`/`data`, and
  `JSON.parse` the remainder with a string fallback on failure, then call
  `gmcp.dispatch(packageName, data)` directly
  (`public/js/connection.js:713-757`). No `client/gmcp/**` module currently
  performs this raw-bytes-to-`(packageName, data)` decode -- `SessionGmcpBus`
  only exposes `dispatch(packageName, data)` on already-split input
  (`client/gmcp/bus.ts:78`), so this step is this decode's only owner.
- `sendSocketPayload(payload, metadata)` is called with a plain `string` for
  player commands (`public/js/input.js:64`) and terminal-geometry text
  (`public/js/output.js:1409`), and with a pre-encoded `Uint8Array` for GMCP
  frames (`public/js/gmcp.js:121`, `public/js/output.js:1095`). This is not
  an arbitrary legacy convenience: `CLAUDE.md` states the wire protocol
  distinguishes the two by WebSocket **frame type**, not payload shape --
  "Text frames carry commands... as plain UTF-8 strings" and "Binary frames
  carry GMCP messages" -- and the native `WebSocket.send()` API sends a text
  frame for a `string` argument and a binary frame for a `Uint8Array`
  argument. Collapsing `send()` to one payload type would either send every
  player command as a binary frame or force every GMCP frame out as text,
  either of which the server-side protocol does not accept.
- Every socket event handler re-checks `state.ws !== ws` before acting so a
  stale or superseded socket's late callback is inert -- at the start of
  `onopen` (`public/js/connection.js:665`), `onmessage`
  (`public/js/connection.js:714`), `onerror`
  (`public/js/connection.js:760`), and after health/event bookkeeping in
  `onclose` (`public/js/connection.js:777`). `disconnect()` sets
  `state.userDisconnected = true` and closes the socket with code 1000
  (`public/js/connection.js:823-833`); that same flag is what gates every
  auto-reconnect scheduling path (`scheduleReconnect`'s callers and the
  `online`-listener guard above), and is cleared by `ensureConnected()`/
  `retryNow()` (`public/js/connection.js:381,393`).
- `finalizeDisconnect()` resets socket/timer state but also resets five
  unrelated managers and mutates the DOM directly (`combatVisualManager`,
  `tutorialManager`, `panelManager`, `fishingManager`, `windowManager`, brand
  text, `dom.statusConnection`) (`public/js/connection.js:300-324`), and
  `setConnectionState()` both mutates DOM classes/text and dispatches a
  `dw:connectionstate` `CustomEvent` on `document`
  (`public/js/connection.js:74-84,551-577`). None of this belongs in a
  session-scoped transport; only the event-emission half is this step's
  concern.
- Six other legacy modules import from `connection.js` today
  (`app.js`, `connection-overlay.js`, `gmcp.js`, `input.js`, `output.js`,
  `window-manager.js`), and `app.js` exposes a `window.wsDebug.snapshot()`
  global backed by `getWsDebugSnapshot()`
  (`public/js/connection.js:522-549`, `public/js/app.js:547`) that
  `e2e/transports.spec.ts` reads directly. Replicating that exact global is
  Step 13's compatibility-facade concern; this step only needs a comparable
  `TransportHealthSnapshot` read model for that facade to build on.
- The only existing unit coverage for this module is
  `test/connection-transport.test.mjs`, which stubs a minimal
  `document`/`window`/`WebSocket`/`localStorage` environment (the
  `WebSocket` stub itself is `test/connection-transport.test.mjs:27-28`) and
  exercises only `buildTransportLadder`
  (`test/connection-transport.test.mjs:1-57`). Everything else (watchdog,
  backoff, guards, byte/GMCP dispatch, disposal) has zero unit coverage
  today; parity fixtures for those are new, not ported.
- `e2e/transports.spec.ts` plus `e2e/fixtures/transport-fixtures.ts` already
  cover all four transports end-to-end against the built browser app,
  including URL correctness, one connect-attempt/one-open invariant, zero
  transport-fallback events on the happy path, and zero leaked sockets after
  `page.close()` (`e2e/transports.spec.ts:61-120`,
  `e2e/fixtures/transport-fixtures.ts:258-304`). These fixtures exercise the
  still-unmodified `public/js/connection.js`, since nothing is wired into the
  boot path until Step 13; running them in this step is a pure regression
  check that adding `client/transport/**` did not disturb the shipped path.
- Step 6's `ResourceScope` already proves the exact disposal contract this
  step must route every timer and the socket through: `own()`/`setTimeout()`/
  `setInterval()`/`requestAnimationFrame()` register a disposer that
  `dispose()` releases in reverse order exactly once, and a disposed scope
  synchronously rejects new registrations rather than throwing
  (`client/runtime/resource-scope.ts:9-17,49-120,169-199`). Step 6's
  `SessionEventBus` proves the matching event contract: `publish()` stamps
  the bus's own `sessionId`, `dispatch()` on a mismatched `sessionId`
  increments a misrouted-event counter without invoking a handler, and a
  disposed bus is idempotent and silent
  (`client/runtime/event-bus.ts:6-15,68-111`).
- Step 7's `SessionGmcpBus` already establishes the precedent this step's
  send path should follow: outbound frames go through one injected
  `sendSink: (bytes: Uint8Array) => boolean` function rather than a raw
  socket reference, and the bus itself owns wire-format encoding
  (`client/gmcp/bus.ts:89-93,150-172,254`). This step is the eventual
  provider of that sink once Step 10 composes the two; a `send()` accepting
  `string | Uint8Array` (plus an optional metadata parameter) is structurally
  assignable wherever `(bytes: Uint8Array) => boolean` is expected, so no
  adapter function is strictly required for that composition, only a bound
  method reference.
- `client/transport/**` does not yet exist in the TypeScript include list,
  the ESLint `scriptFiles` glob, or the lint/format/format:check globs
  (`tsconfig.json:18-27`, `eslint.config.mjs:7-19`, `package.json:53-55`).
  Steps 3-7 each added their own directory to all three the same way; this
  step must do the same for `client/transport/**`.

## Must-haves

- [MH1] URL construction and the fallback ladder reproduce legacy behavior
  exactly. Acceptance: `ws`/`wss` produce direct URLs, `telnet`/`telnets`
  produce `/proxy`-bridged URLs with identical query-string encoding, `https`
  pages skip the plain-`ws` rung, and the selected rung is always reordered
  to the front of the returned ladder -- matching every case in
  `test/connection-transport.test.mjs` plus the URL strings
  `e2e/transports.spec.ts:132-139` asserts against.
- [MH2] The health watchdog reproduces both legacy stall predicates under a
  fake clock. Acceptance: a fixture replaying the exact command-burst and
  buffered-backlog timestamp sequences from
  `public/js/connection.js:398-432` reports a stall at the same simulated
  offset the legacy constants imply, and neither predicate fires outside its
  own scenario.
- [MH3] Reconnect backoff and rung-failure cycling reproduce legacy timing
  and sequencing exactly. Acceptance: under a fake clock, scheduled backoff
  delays follow `RECONNECT_BASE_MS * 2^attempts` capped at
  `RECONNECT_MAX_MS`; a rung-failure sequence cycles through all four ladder
  entries at the fixed 250ms rung-failure delay before falling through to
  backoff, matching `cycleRungsTried`'s reset-on-success semantics; and
  `forceReconnect()` always retries after the fixed 250ms delay regardless of
  `reconnectAttempts`.
- [MH4] The handshake-resend guard and lost-transmission recovery timer fire
  at their legacy delays and cooldown window, and surface only as session
  events -- never as a direct call into GMCP, panel, or settings state.
  Acceptance: a fixture proves each timer fires (or, for lost-transmission,
  is cooldown-suppressed) at the exact legacy millisecond offsets, and the
  transport module has zero import of any `client/gmcp/**` or legacy
  `public/js/*` module.
- [MH5] The upgrade probe reproduces legacy gating through an injected
  predicate instead of reading panel state directly. Acceptance: a fixture
  with the injected `isLoggedIntoCharacter()` returning `true` never opens a
  probe socket or upgrades; returning `false` reproduces the legacy
  probe-then-upgrade sequence, including never upgrading to a rung the
  session did not open on below the top.
- [MH6] Inbound frames reach the correct callback with byte-identical decoded
  content to the legacy parser. Acceptance: a string frame reaches
  `onText()` unchanged; a binary GMCP frame reaches `onGmcpFrame(packageName,
  data)` with `data` `JSON.parse`d exactly as
  `public/js/connection.js:739-743` does, including the string-fallback case
  for a payload that fails to parse.
- [MH7] Disposal is complete, idempotent, and blocks every late callback.
  Acceptance: disposing during an in-flight `connect()`, during a pending
  reconnect/rung-failure/watchdog/upgrade-probe/handshake-guard/
  lost-transmission timer, and while a socket is open each leave zero
  pending timers after the fake clock is advanced past every delay, and a
  manually fired `onopen`/`onmessage`/`onerror`/`onclose` on the disposed
  transport's stale socket produces no observable effect; a second
  `dispose()` call is a no-op.
- [MH8] Connection-attempt lifecycle integrity matches legacy exactly.
  Acceptance: calling `connect()` twice in a row before the first attempt
  resolves opens exactly one socket, matching the `state.ws ||
  state.connectionPending` guard (`public/js/connection.js:598`);
  `retryNow()` cancels any pending backoff timer, clears the
  user-initiated-disconnect flag, and connects immediately even mid-backoff;
  and a `disconnect()` call sets that flag so no reconnect scheduling path
  (backoff, rung-failure retry, or the `online`-recovery listener) fires
  again until the next `connect()`/`retryNow()` call.
- [MH9] Outbound frame type is preserved and network recovery matches
  legacy. Acceptance: `send()` given a `string` payload results in the
  injected socket's `send()` being called with that `string` (a WebSocket
  text frame); `send()` given a `Uint8Array` payload results in the socket's
  `send()` being called with that `Uint8Array` (a binary frame) -- the two
  are never coerced into each other; and an injected `online` event
  triggers an immediate retry only when not already connected/connecting,
  autoReconnect (or a pending reconnect timer) is active, and no
  user-initiated disconnect is in effect, matching
  `public/js/connection.js:811-821`.
- [MH10] Connection state and reconnect status are modeled as two distinct
  signals, matching two distinct legacy enums. Acceptance: the transport's
  `state` field only ever takes the three values `setConnectionState` is
  called with -- `'connecting'`, `'connected'`, `'disconnected'`
  (`public/js/connection.js:637,649,668,313`) -- and a separate
  `transport:reconnect-status` `SessionEvent` carries the four-value
  `'connecting' | 'scheduled' | 'connected' | 'idle'` shape matching every
  `emitReconnectStatus` call site
  (`public/js/connection.js:86-98,249,347,583,638,654,680,803,829`); no
  fixture or interface merges the two into one enum.

## Out of scope

- Any DOM mutation, `appendSystemMessage` call, or manager reset
  (`combatVisualManager`, `tutorialManager`, `panelManager`,
  `fishingManager`, `windowManager`, `timerManager`). Those are UI/automation
  side effects Step 13's compatibility facade attaches by subscribing to this
  step's session events.
- Calling `gmcp.sendHandshake()`, `gmcp.sendSubscriptions()`, or
  `gmcp.restartHandshake()` directly. This step only emits the timing
  signal (`transport:handshake-guard-elapsed`,
  `transport:lost-transmission-detected`); turning that signal into a real
  GMCP call is Step 10's composition job.
- Reading `settingsManager`, `dom.*`, or any other legacy global directly.
  Endpoint selection and the auto-reconnect policy are injected callbacks
  (Assumption 3); the composer (Step 10/13) is responsible for backing them
  with real settings/DOM reads.
- Reproducing the exact `window.wsDebug` global or rewriting
  `e2e/transports.spec.ts`/`e2e/fixtures/transport-fixtures.ts`. Those
  fixtures continue to exercise the unmodified `public/js/connection.js` and
  are run read-only in this step as a regression check; only a genuine
  defect they surface justifies editing them, mirroring Step 1's baseline
  qualifier.
- Wiring `client/transport/**` into the real `Session`, the GMCP bus's
  `sendSink`, or any legacy manager. That begins at Step 10 (`Session`
  composition) and Step 13 (compatibility cutover); this step's only
  consumer is its own test file.
- Command history, workspace layout, or any other character-scoped legacy
  data this transport does not touch.

## Assumptions

- [The transport owns raw GMCP wire-frame decoding -- splitting a binary
  frame into `packageName`/`data` and `JSON.parse`-with-string-fallback --
  since no `client/gmcp/**` module currently performs this decode; `bus.ts`
  only accepts already-split `(packageName, data)` input
  (`client/gmcp/bus.ts:78`). Adversarial review (Architect lens) flagged
  that inlining this inside `onmessage` would embed GMCP-protocol knowledge
  in `connection.ts` with no compiler-enforced link to `client/gmcp/frame.ts`,
  the natural future home; Step 4 now requires this decode to live in one
  separately named, individually exported function
  (`decodeGmcpWireFrame(bytes): { packageName: string; data: unknown }`)
  rather than inline logic, so relocating it into `client/gmcp/frame.ts`
  later is a one-line import change, not a rewrite] - if false: this decode
  belongs in `client/gmcp/frame.ts` today instead, and this step must import
  it from there rather than duplicating parsing logic, adding an unlisted
  `client/gmcp` dependency Step 7's file list did not anticipate.
- [`transport:handshake-guard-elapsed`, `transport:lost-transmission-
  detected`, and `transport:upgrade-available`/`transport:upgraded` are
  emitted as `SessionEvent`s through the Step 6 `SessionEventBus` rather than
  as additional constructor callbacks -- state-signal shape goes through the
  event bus, matching the master plan's own "emits session events and
  byte/GMCP callbacks" split (state signals versus per-message hot-path
  payloads), the same split Step 7 drew between its `sendSink` function and
  its handler-registry event surface. Adversarial review (Creative lens)
  considered collapsing all three into one narrow callback union instead;
  rejected, because the three signals' payloads genuinely differ (only
  `upgrade-available` carries a target-transport field) and Step 6's own
  plan already named Step 9 as the event bus's first anticipated real
  consumer] - if false: these need dedicated callback parameters instead,
  growing the callbacks interface and changing the test fixture shape and
  Step 10's composition surface.
- [`getEndpoint(): TransportEndpoint` and `getAutoReconnect(): boolean` are
  injected callbacks invoked fresh on every connect/reconnect attempt, not a
  config snapshot captured once at construction -- preserving the legacy
  behavior of re-reading `dom.host.value`/`dom.port.value`/
  `dom.protocolSelect.value` and `settingsManager.get('autoReconnect')` on
  every `connect()`/`onclose` call
  (`public/js/connection.js:616,618-619,651,800`)] - if false: a static
  config snapshot is sufficient, and Step 10/13 must instead construct a
  fresh transport instance on every field edit or settings toggle, which no
  legacy behavior currently requires and which would complicate mid-session
  reconnects.
- [`isLoggedIntoCharacter(): boolean` is a required injected predicate with
  no default, replacing the legacy `panelManager.gmcpData.vitals` read
  (`public/js/connection.js:154-158`)] - if false: upgrade-probe logic must
  be deferred out of this step entirely, since this step has no legitimate
  access to panel data to fall back on.
- [`send(payload: string | Uint8Array, metadata?): boolean` is one
  overloaded entry point mirroring legacy `sendSocketPayload`'s dual
  text/binary use (`public/js/connection.js:492-520,input.js:64,
  output.js:1095,1409`, `public/js/gmcp.js:121`), rather than the narrower
  `(bytes: Uint8Array) => boolean` shape the GMCP bus's `sendSink` expects
  (`client/gmcp/bus.ts:91`). Adversarial review (Creative lens) considered
  narrowing `send()` to `Uint8Array`-only, matching the GMCP bus exactly and
  removing the union entirely; **rejected** on protocol-correctness grounds,
  not merely convenience -- `CLAUDE.md` documents that command text and GMCP
  are distinguished by WebSocket **frame type**, and forcing every player
  command through a `Uint8Array` `send()` would corrupt that framing (see
  Evidence). The union is therefore a hard constraint, not a style choice]
  - if false (i.e., if some other frame-type-preserving mechanism is
  preferred): transport needs two separate methods (`sendText`/`sendBytes`)
  instead of one entry point, and Step 10's composition wiring changes
  accordingly, but the underlying frame-type-preservation requirement (MH9)
  does not change.

## Risks

- Porting five-plus independently-timed state machines (backoff,
  rung-cycling, watchdog, upgrade-probe, handshake-guard,
  lost-transmission-recovery) risks silent timing drift from legacy
  behavior, and this module has almost no existing unit coverage to catch
  it. Mitigation: every literal delay/threshold constant is copied unchanged
  into `client/transport/**`, and the Step 5 fixtures assert exact simulated
  timestamps/delays for each state machine rather than only "eventually
  fires."
- Decoupling the handshake-guard and lost-transmission-recovery timers from
  direct GMCP calls (Assumption 2) could look like a silent functionality
  regression if no consumer subscribes to the new events before Step 10
  composes the real `Session`. Mitigation: this plan's Out-of-scope section
  states the gap explicitly, nothing in this step is wired into the boot
  path (legacy `public/js/connection.js` keeps running unmodified until Step
  13), and the Step 16 decision record is expected to confirm or override
  this boundary before Step 10 depends on it, mirroring how Step 7 recorded
  its own send-sink/malformed-frame boundary decisions for later steps to
  inherit.
- The live-config-callback contract (Assumption 3) could be implemented as a
  one-time read by mistake, silently reintroducing the "stale DOM snapshot"
  bug class this design is meant to avoid. Mitigation: the Step 5 test
  fixture mutates `getEndpoint()`'s and `getAutoReconnect()`'s return values
  between connection attempts within one fixture and asserts the transport
  observes the change on the very next attempt, not only at construction.
- Routing every timer through `ResourceScope` (rather than a mix of scope-
  owned and raw `globalThis.setTimeout`) is required for `dispose()` alone to
  guarantee full cancellation; one call site using a raw timer would silently
  survive disposal. Mitigation: `connection.ts` and `reconnect.ts` never call
  `globalThis.setTimeout`/`setInterval` directly -- every scheduled callback
  goes through `scope.setTimeout`/`scope.setInterval` -- and the Step 5
  fixture advances a fake clock past every constant's delay after `dispose()`
  and asserts zero callback invocations for each of the six timer kinds.
- Splitting reconnect/rung-cycling logic (`reconnect.ts`) from the socket
  lifecycle that must actually retry (`connection.ts`) risks either a
  circular import or an undefined control-flow direction between the two
  files (Architect finding). Mitigation: `reconnect.ts` exports pure
  functions parameterized by an `onRetry: () => void` callback and never
  imports `connection.ts`; `connection.ts` is the sole importer of
  `reconnect.ts` and supplies its own internal connect routine as
  `onRetry`, so the dependency graph is one-directional by construction.
- Omitting the `window.addEventListener('online', ...)` recovery listener
  (explicitly named in the master plan's own Step 9 intent) would silently
  drop a real user-facing behavior -- the client sitting out the rest of a
  long backoff window after connectivity actually returns. Mitigation: Step
  4 registers this listener through `scope.own('listener', ...)`, gated
  identically to legacy (`public/js/connection.js:811-821`), and the Step 5
  fixture simulates a dispatched `online` event mid-backoff and asserts an
  immediate retry.
- No concurrent-connect guard or `retryNow()` equivalent would leave two
  gaps: overlapping `connect()` calls could open two live sockets, and
  Step 13's "reconnect now"-style UI control would have no capability to
  bind to. Mitigation: MH8 makes both explicit acceptance criteria, and
  Step 4's intent adds an internal `connectionPending`-equivalent guard and
  a `retryNow()` method.

## Steps

### Step 1 - Transport types, URL construction, and quality-gate coverage

**Files:** `client/transport/types.ts` (new), `client/transport/urls.ts`
(new), `tsconfig.json`, `eslint.config.mjs`, `package.json`

**Intent:** In `types.ts`, define `TransportName` (`'ws' | 'wss' | 'telnet' |
'telnets'`), `TransportEndpoint` (`{ host: string; port: string; protocol:
TransportName }`), `TransportState` (`'connecting' | 'connected' |
'disconnected'` -- exactly the three values `setConnectionState` uses today,
per MH10; no fourth `'idle'` value, since that belongs to the separate
reconnect-status signal below), `TransportReconnectStatus` (`'connecting' |
'scheduled' | 'connected' | 'idle'`, matching `emitReconnectStatus`), a
minimal `WebSocketLike` interface covering exactly what this module needs
(`readyState`, `bufferedAmount`, `binaryType`, `send`, `close`, and
assignable `onopen`/`onmessage`/`onerror`/`onclose` properties, matching the
property-assignment style `public/js/connection.js` already uses so both the
real global `WebSocket` and a test fixture satisfy it structurally),
`TransportHealthSnapshot`, `SessionTransportCallbacks` (`getEndpoint`,
`getAutoReconnect`, `isLoggedIntoCharacter`, `onText`, `onGmcpFrame`), and
the public `SessionTransport` interface (`state`, `connect`, `disconnect`,
`retryNow`, `forceReconnect`, `send`, `getHealthSnapshot`, `dispose`). In
`urls.ts`, port `buildTransportLadder` (`public/js/connection.js:100-110`)
and a `buildConnectionUrl(endpoint, appOrigin)` function reproducing the
direct `ws`/`wss` URL and the `/proxy`-bridged `telnet`/`telnets` URL
construction (`public/js/connection.js:615-633`), with `appOrigin` (protocol
+ host) injected instead of read from `location`. Add
`client/transport/**/*.ts` to `tsconfig.json`'s `include`, the `scriptFiles`
glob in `eslint.config.mjs`, and the `lint`/`format`/`format:check` globs in
`package.json`, exactly as Steps 3-7 did for their own directories.

**Verify:**

```bash
npm run typecheck
npm run lint
npm run format:check
```

**Done when:** every `buildTransportLadder` fixture ported from
`test/connection-transport.test.mjs` passes unchanged against the new
module; `buildConnectionUrl` produces byte-identical URLs to
`public/js/connection.js:621-633`'s string construction for all four
transports, including the proxy-bridge query-string encoding; the new
directory passes every extended quality gate.

### Step 2 - Health tracking and stall detection

**Files:** `client/transport/health.ts` (new)

**Intent:** Implement `createTransportHealth(now?: () => number)`: an
instance-scoped tracker replacing `state.wsHealth`
(`public/js/state.js:12-29`) and the module-global `pushWsEvent`/
`trimCommandBurst`/`recordBufferedAmount`/`evaluateSocketHealth` functions
(`public/js/connection.js:57-73,266-272,398-432`). Track `currentUrl`,
`lastOpenAt`/`lastInboundAt`/`lastInboundTextAt`/`lastInboundGmcpAt`/
`lastOutboundAt`/`lastCommandAt`/`lastErrorAt`/`lastCloseAt`/
`lastHandlerErrorAt`, buffered-amount current/high-water values, a
capped-at-100 (`WS_DIAG_LIMIT`) event ring buffer, and a `forcedReconnects`
counter. Port `evaluateSocketHealth`'s two stall predicates -- command-burst
stall (`WS_STALL_COMMAND_BURST_COUNT` within `WS_STALL_COMMAND_BURST_MS`,
unanswered for `WS_STALL_WINDOW_MS`) and buffered-backlog stall
(`WS_STALLED_BUFFERED_THRESHOLD` with no in/out traffic for
`WS_STALL_WINDOW_MS`) -- exactly, parameterized by the injected `now`
function (defaulting to `Date.now`) and the live socket's
`readyState`/`bufferedAmount` passed in by the caller rather than a global
`state.ws` read. Export `TransportHealthSnapshot` matching
`getWsDebugSnapshot`'s field set (`public/js/connection.js:522-549`) minus
the DOM-derived `openWindows` field.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** a fixture replaying the exact event/timestamp sequences from
`public/js/connection.js:398-432` (both the command-burst and
buffered-backlog cases) reports a stall at the same simulated offset the
legacy constants imply; the event ring buffer caps at 100 entries and drops
the oldest first.

### Step 3 - Reconnect backoff, ladder cycling, and guard timers

**Files:** `client/transport/reconnect.ts` (new)

**Intent:** Implement pure timer-driven state machines built only on an
injected `ResourceScope` (never raw `globalThis.setTimeout`/`setInterval`)
and the Step 6 `SessionEventBus`: (a) exponential reconnect backoff
(`RECONNECT_BASE_MS * 2^attempts` capped at `RECONNECT_MAX_MS`,
`public/js/connection.js:579-592`); (b) rung-failure cycling within one
connection cycle at the fixed `WS_FORCE_RECONNECT_DELAY_MS` before backoff
applies (`handleRungFailure`/`advanceTransport`/`resetTransportLadder`/
`cycleRungsTried`, `public/js/connection.js:122-141,245-264`); (c) the
upgrade probe that reconnects onto a preferred transport when connected on a
lower rung, gated by the injected `isLoggedIntoCharacter()` callback instead
of `panelManager.gmcpData.vitals`
(`public/js/connection.js:160-207`); (d) the handshake-resend guard that
fires when text has flowed but no GMCP frame arrived within
`HANDSHAKE_RESEND_DELAY_MS` after open (`public/js/connection.js:214-239`);
(e) lost-transmission-pattern detection and its cooldown-gated recovery
timer (`public/js/connection.js:439-469`). None of these call into GMCP,
panels, or UI; each publishes a named `SessionEvent`
(`transport:handshake-guard-elapsed`, `transport:lost-transmission-
detected`, `transport:upgrade-available`, `transport:transport-fallback`,
`transport:reconnect-status`) through the injected event bus, per
Assumption 2, for a future composer (Step 10/13) to turn into a real
`gmcp.sendHandshake()`/`restartHandshake()` call. **Composition-root rule**
(Architect finding): every function here that needs to trigger a new
connection attempt (backoff expiry, rung-failure retry, upgrade acceptance)
takes an `onRetry: () => void` callback parameter rather than importing
anything from `connection.ts`; this module has zero imports of
`client/transport/connection.ts`, so `connection.ts` remains the sole
composition root and no circular dependency can form.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** under a fake clock, the backoff sequence produces the
identical delay sequence as `RECONNECT_BASE_MS * 2^n` capped at
`RECONNECT_MAX_MS`; a rung-failure sequence cycles through all four ladder
entries at the fixed 250ms delay before falling back to backoff, matching
`cycleRungsTried`'s reset-on-success semantics; the handshake-guard and
lost-transmission timers fire their events at the exact legacy delay
constants and the lost-transmission timer respects its cooldown window; and
`reconnect.ts` has zero import of `connection.ts`.

### Step 4 - Socket lifecycle and byte/GMCP callback dispatch

**Files:** `client/transport/connection.ts` (new)

**Intent:** Implement `createSessionTransport(sessionId, scope, eventBus,
diagnostics, callbacks, webSocketFactory?)` (default factory: `(url) => new
globalThis.WebSocket(url)`), composing `urls.ts` + `health.ts` +
`reconnect.ts`, and owning two additional pieces of state Assumption/Risk
review surfaced as missing from the original draft: an internal
`connectionPending`-equivalent boolean guarding `connect()` re-entrancy
(mirroring `public/js/connection.js:598`, MH8), and an internal
user-initiated-disconnect flag that `disconnect()` sets and `connect()`/
`retryNow()` clear, gating every reconnect-scheduling path exactly as
`state.userDisconnected` does today (`public/js/connection.js:380-396,
823-833`). `connect()` reads `callbacks.getEndpoint()` fresh (per
Assumption 3), builds the URL via `urls.ts`, constructs a socket through the
factory, and registers every timer/listener/socket through
`scope.own('socket', ...)`/`scope.setTimeout`/`scope.setInterval` so
`scope.dispose()` alone guarantees full teardown (Risk 4). `retryNow()`
cancels any pending backoff timer, clears the user-initiated-disconnect
flag, and calls `connect()` immediately (MH8). A `scope.own('listener', ...)`
-registered `online` event handler retries exactly as
`public/js/connection.js:811-821` does (MH9, Risk 6). `onmessage` splits
string vs. `ArrayBuffer` exactly as `public/js/connection.js:713-757`: string
frames call `callbacks.onText(text)`; binary frames are decoded by a
separately named, individually exported `decodeGmcpWireFrame(bytes):
{ packageName: string; data: unknown }` function (per Assumption 1 -- not
inlined into the handler body) that splits at the first space and
`JSON.parse`s the remainder with a string fallback on failure, and the
result is handed to `callbacks.onGmcpFrame(packageName, data)` -- never any
`client/gmcp/**` function directly. Every socket handler re-checks the
socket is still the transport's current socket before acting, porting the
`state.ws !== ws` staleness guards
(`public/js/connection.js:665,714,760,777`), so a stale or superseded
socket's late callback is inert. `send(payload, metadata)` calls the
socket's native `send()` with `payload` unchanged -- a `string` stays a text
frame, a `Uint8Array` stays a binary frame (MH9) -- mirroring
`sendSocketPayload`'s try/catch-then-force-reconnect-on-throw behavior
(`public/js/connection.js:492-520`) but reporting failures through
`diagnostics.recordHandlerFailure()` and a `transport:send-error`
`SessionEvent` instead of `appendSystemMessage`. `dispose()` disposes the
owning `ResourceScope` exactly once and closes the live socket, if any.

**Verify:**

```bash
npm run typecheck
npm run build
npm run verify:bundle
```

**Done when:** direct `ws://`/`wss://` URLs and proxy-bridged `telnet`/
`telnets` URLs open exactly as today; text and GMCP-binary frames reach
their respective callback with byte-identical decoded content to the legacy
parser, including the malformed-JSON string-fallback case (MH6); outbound
frame type is preserved for both payload kinds (MH9); a forced
disconnect/dispose during an in-flight `connect()`, an in-flight reconnect
timer, and an open socket each leave zero pending timers and zero effect
from a subsequently-fired native callback (MH7); and two back-to-back
`connect()` calls open exactly one socket (MH8).

### Step 5 - Prove parity under injected clocks and socket fixtures

**Files:** `test/session-transport.test.mjs` (new)

**Intent:** Follow the Step 6/7 Vite-SSR import pattern (`import via
server.environments.ssr.runner.import`) to import `client/transport/*.ts`,
`client/runtime/{resource-scope,event-bus,diagnostics}.ts`, and
`client/model/ids.ts`'s `createSequentialUuidFactory`. Build a minimal fake
`WebSocket` class satisfying `types.ts`'s `WebSocketLike` (matching the
existing `globalThis.WebSocket` stub shape already proven at
`test/connection-transport.test.mjs:27-28`) and inject it as the
transport's `webSocketFactory`. Use `t.mock.timers` exactly as
`test/session-lifecycle-primitives.test.mjs` already does for every
backoff/watchdog/guard fixture. Cover every master-plan Step 9 Done-when
scenario (direct/proxy URL tests, fallback order, watchdog/reconnect
behavior, handshake retry, cancellation after disposal) plus this plan's
Must-haves 1-10, including: the live-config-callback re-read fixture from
Risk 3 (mutating `getEndpoint()`'s/`getAutoReconnect()`'s return value
between attempts within one fixture); a simulated `online` event mid-backoff
(MH9/Risk 6); a `retryNow()` call mid-backoff and a double `connect()` call
(MH8); a fixture asserting `send()` preserves frame type for both a
`string` and a `Uint8Array` payload (MH9); and a fixture asserting `state`
only ever takes its three values while a separate `transport:reconnect-
status` event carries the four-value shape (MH10). Port every existing
`test/connection-transport.test.mjs` case so `buildTransportLadder` coverage
is not lost.

**Verify:**

```bash
node --test test/session-transport.test.mjs
npm run build
npm run verify:bundle
npm run format:check
npm run lint
npm run typecheck
npm run check
git diff --check
npm run test:transports
```

**Done when:** every master-plan Step 9 Done-when condition and every
Must-have in this plan has a corresponding passing fixture; the full
quality/build battery is green; and `npm run test:transports` (the existing
four-protocol Playwright battery against the still-unmodified legacy
`public/js/connection.js`) remains green, proving this step introduced zero
regression to the shipped path it has not yet replaced.

## Success criteria

- [ ] `client/transport/**` is included in typecheck, lint, and format gates
      without widening the legacy `public/js/**` boundary.
- [ ] URL construction and the fallback ladder match legacy behavior exactly
      for all four transports, including the `https` mixed-content skip.
- [ ] The health watchdog reproduces both legacy stall predicates under a
      fake clock at the correct simulated offsets.
- [ ] Reconnect backoff, rung-failure cycling, the upgrade probe, the
      handshake-resend guard, and lost-transmission recovery all reproduce
      legacy timing and are exposed only through session events/injected
      predicates, never a direct GMCP/panel/settings call.
- [ ] Inbound text and GMCP-binary frames reach distinct callbacks with
      byte-identical decoded content, including the malformed-JSON
      string-fallback case; outbound `send()` never coerces a `string`
      payload into a binary frame or vice versa.
- [ ] A forced disposal at every lifecycle point (in-flight connect, pending
      reconnect/watchdog/guard timer, open socket) leaves zero pending
      timers and blocks every late native socket callback.
- [ ] Overlapping `connect()` calls never open two sockets, `retryNow()`
      cancels backoff and reconnects immediately, and a user-initiated
      `disconnect()` suppresses every auto-reconnect path (including the
      `online`-recovery listener) until the next `connect()`/`retryNow()`.
- [ ] `state` and `transport:reconnect-status` remain two distinct signals
      with their own value sets; no interface or fixture merges them.
- [ ] The full quality/build battery (`format:check`, `lint`, `typecheck`,
      `check`, `build`, `verify:bundle`) and the existing
      `npm run test:transports` Playwright battery both pass alongside the
      new unit test.

## Rollback

Nothing built in this step is imported into the boot path, the legacy UI, or
any other production module yet -- `client/transport/**` has no importers
until Step 10 composes the real `Session` and Step 13 cuts the legacy UI
over. Reverting before then is a pure code deletion of `client/transport/**`,
its test file, and the three added quality-glob entries, with zero runtime
impact, since no shipped build executes this code outside `node --test`.
This step touches no persisted data and no key under
`darkflow-session-core-v1`, so it needs no data-recovery step.

## Execution fit

- Scope: multi-run phase (one step within the ongoing Phase 1 program)
- Lead: Terra at high reasoning - real correctness risk porting five-plus
  independently-timed state machines (backoff, rung-cycling, watchdog,
  upgrade-probe, handshake-guard, lost-transmission-recovery, online
  recovery) with almost no existing unit coverage to check against, even
  though Step 6's `ResourceScope`/`SessionEventBus` disposal contract and
  Step 7's injected-function send-sink pattern substantially reduce
  uncertainty about how to structure the extraction
- Workers: none - `types.ts`, `urls.ts`, `health.ts`, `reconnect.ts`, and
  `connection.ts` form one tightly coupled timing-and-disposal contract;
  splitting authorship risks divergent staleness-guard behavior, a timer
  that bypasses the shared `ResourceScope`, or a violation of the
  `reconnect.ts`-never-imports-`connection.ts` composition rule
- Delegation shape: solo
- Ownership: the lead owns the session-event-vs-callback boundary
  (Assumption 2), the live-config-callback contract (Assumption 3), the
  `reconnect.ts`/`connection.ts` composition-root rule, and the go/no-go
  decision before Step 10 begins
- Replan trigger: Step 10's composition reveals the session-event boundary
  for the guard timers (Assumption 2) needs dedicated callbacks instead; or
  the `decodeGmcpWireFrame` seam (Assumption 1) should move into
  `client/gmcp/frame.ts` immediately rather than staying in
  `client/transport/**` until a later relocation
- Confidence: medium - the disposal/isolation/injected-function patterns are
  proven precedent from Steps 6-7, and adversarial review closed the
  concrete gaps found in the original draft (missing online-recovery
  listener, missing concurrent-connect guard, conflated state/reconnect-
  status types, an unjustified send-signature simplification that would
  have broken wire framing), but this step still ports substantially more
  independent timing state than any prior step, and `public/js/connection.js`
  has almost no unit coverage today beyond `buildTransportLadder`, so most
  parity fixtures are newly written rather than ported from an existing
  suite

Plan self-review: PASS (8/10)

Notes:

- Adversarial review (Researcher lens) corrected two citation errors in the
  original draft: `client/gmcp/bus.ts:75` was one line off from
  `dispatch()`'s actual location (`:78`), and the staleness-guard line list
  conflated three function-declaration lines with the actual `if (state.ws
  !== ws) return;` guard lines (corrected to `665,714,760,777`). Neither
  changed a design decision, but both are fixed throughout this revision.
- Adversarial review (Skeptic/Researcher lenses) found the original
  `TransportState` type invented a fourth `'idle'` value that matches
  neither of the two real legacy enums (`setConnectionState`'s 3-value
  connection state, `emitReconnectStatus`'s 4-value reconnect status). This
  revision splits them into MH10/Step 1's `TransportState` (3 values) and a
  separate `transport:reconnect-status` `SessionEvent` (4 values).
- Adversarial review (Validator lens) found three behaviors the original
  draft silently dropped despite legacy precedent or the master plan's own
  wording: a concurrent-connect guard (`public/js/connection.js:598`), a
  `retryNow()` equivalent (`public/js/connection.js:380-396`), and the
  `online`-event recovery listener the master plan's own Step 9 intent names
  explicitly (`public/js/connection.js:811-821`). All three are now MH8/MH9
  acceptance criteria with corresponding Step 4/5 work.
- Adversarial review (Creative lens) seriously considered narrowing
  `send()` to a `Uint8Array`-only signature to eliminate the union and match
  the GMCP bus's `sendSink` exactly. This was rejected once traced to
  `CLAUDE.md`'s WebSocket text-frame/binary-frame protocol split: a
  `Uint8Array`-only `send()` would force every player command out as a
  binary frame, which the server-side protocol does not accept. The
  near-miss is recorded because it demonstrates the union signature is a
  protocol-correctness requirement, not a legacy-convenience one -- Step 10
  must not "simplify" it later without re-deriving this constraint.
- Adversarial review (Creative lens) also considered merging `reconnect.ts`
  into `connection.ts` to sidestep the composition-root question the
  Architect lens raised; rejected because the master plan's own Files list
  requires `reconnect.ts` as a separate file, and the `onRetry`-callback
  pattern resolves the coupling risk without needing to merge them.
- `test/connection-transport.test.mjs` is left untouched by this step: it
  still imports and tests `public/js/connection.js` directly, which remains
  the shipped code path until Step 13's cutover. This plan's Step 5 ports
  its ladder fixtures into the new test file as additional coverage, not a
  replacement; deleting or redirecting the legacy test file is Step 13's
  decision to make once the legacy module actually delegates to this one.
- This step deliberately leaves the handshake-guard/lost-transmission/
  upgrade-probe session events with no subscriber. That is an intentional,
  temporary hole identical in shape to Step 7's `Group`/`Game` unmodeled-
  package gap: harmless because nothing is wired into the boot path yet, but
  it must be recorded in the Step 16 decision record as a compatibility item
  Step 10 is expected to close.
- The `WebSocketLike` interface (Step 1) is intentionally narrower than the
  DOM `WebSocket` type -- it exists so the Step 5 test fixture can satisfy it
  without a browser environment, the same reasoning that led
  `test/connection-transport.test.mjs` to hand-stub `WebSocket` rather than
  pull in a DOM polyfill.
