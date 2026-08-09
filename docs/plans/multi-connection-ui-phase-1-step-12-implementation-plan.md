# Phase 1 Step 12 Implementation Plan

*Plan stress-tested via full adversarial review. 9 findings surfaced: 1
conceded (an erroneous build-config step removed), 5 refined the plan below,
3 stand unchanged, confirming the original design against a named
alternative.*

## Planning selection

- Mode: detailed implementation plan
- Complexity: 7/10 - one already-scoped, already-sequenced master-plan step
  (like Steps 1-11), but it introduces two new judgment calls no earlier step
  settled: a second, brand-new compat-bridge primitive (automation runtime,
  distinct from Step 11's configuration bridge) and an atomic
  reconcile-on-new-revision contract for live timers. Raw dimension scoring
  would land this near phase-map/discovery-first territory, but no hard
  trigger applies - this is one independently deployable, already-approved
  master-plan step, not multiple deployables, not a rollout, and the phase
  map already exists as this master plan. Matching Step 11's own precedent
  (self-scored 7/10, still planned as a detailed plan), the remaining
  ambiguity is resolved as documented assumptions rather than forcing a
  phase-map re-decomposition.
- Hard triggers: none - single deliverable, one phase-gate continuation,
  nothing wired into the boot path, no user-requested sequencing
- Current planning horizon: `public/js/trigger-manager.js`,
  `timer-manager.js`, `automation-executor.js`, `gmcp-variables.js`, plus the
  master plan's own "related adapters and tests" clause covering
  `public/js/alias-manager.js`'s variable methods (Step 11 explicitly
  deferred these here) and two new files
  (`client/runtime/automation-runtime.ts`,
  `public/js/session-compat/automation.js`), exactly as scoped by the master
  plan's Step 12 entry
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:475-491`)
- Evidence horizon: the four target legacy files in full, Step 11's already-
  shipped configuration compat bridge and its `client/configuration/**`
  backing, Step 6's `ResourceScope`/diagnostics primitives, Step 10's
  `runtime-state.ts` and its own explicit deferral of this exact scope,
  `docs/session-model.md`'s runtime-state ownership rules, the frozen Step 3
  `CharacterProfile` contract, and every current caller of the four target
  files' public methods, including `settings-manager.js`'s backup/export
  path
- Adversarial review: full (Skeptic, Validator, Researcher, Architect,
  Creative), self-applied - this step originates more first-instance design
  (a second bridge shape, an atomic reconciliation contract, a persisted-to-
  in-memory variable ownership change) than Step 11 did, and Step 13 builds
  directly on whatever this step decides, matching Step 6's and Step 11's
  own reasoning for a full pass. Findings are folded into Evidence,
  Must-haves, Hard constraints, Risks, and Notes below.

The clarification gate is skipped for the same reason Steps 3, 5, 6, 9, and
11 skipped it: the product decision (session-owned automation execution
state, isolated from shared/local definitions) is already approved at the
phase level
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:105-108`).
This plan resolves the remaining implementation-level ambiguities as
documented assumptions because repository evidence - specifically Step 11's
already-frozen generic configuration bridge, Step 6's already-frozen
disposal primitives, and Step 3's already-frozen `CharacterProfile`
contract - answers most of what the master plan's four-line Step 12 summary
leaves open.

## Goal

Move trigger and timer *definitions* onto the same effective-configuration
read/write path Step 11 already built for aliases, highlights, functions,
and key mappings, and give Phase 1 a session-owned automation *execution*
container - timer handles, user variables, and GMCP variables - that is
provably distinct per instance and cancels every pending timer and wait on
disposal. Reconciling a new definition revision must be atomic: still-
running timers keep running, removed or disabled timers stop, and newly
enabled auto-start timers start exactly once. Nothing built in this step is
imported into the boot path or the legacy UI's live code path; Step 13
installs the real bridges.

## Evidence and constraints

- Step 11 already built and froze a *generic*, per-`ConfigKind` compatibility
  bridge and service function: `public/js/session-compat/configuration.js`'s
  `getEffectiveDefinitions(kind)`/`replaceLocalDefinitions(kind, ...)`/
  `upsertLocalDefinitionByIdentity(kind, ...)`/
  `removeLocalDefinitionByIdentity(kind, ...)`/
  `setLocalDefinitionEnabledByIdentity(kind, ...)`/`subscribe(listener)`
  (`public/js/session-compat/configuration.js:1-85`), backed by
  `client/configuration/service.ts`'s `replaceLocalDefinitions<K extends
  ConfigKind>` (`client/configuration/service.ts:156-206`) and
  `client/configuration/identity.ts`'s per-kind identity functions, which
  already cover `'triggers'` (`normalizeWhitespace(pattern)`, no case-fold)
  and `'timers'` (`normalizeWhitespace(name).toLowerCase()`) per Step 5's own
  Evidence
  (`docs/plans/multi-connection-ui-phase-1-step-5-implementation-plan.md:76-85`).
  Adapting trigger/timer *definitions* therefore needs zero new
  `client/configuration/**` code - it is Step 11's Step 3 pattern applied to
  two more `ConfigKind` values.
- Step 11's own Evidence and Out-of-scope explicitly reserved three things to
  this step, by name: `trigger-manager.js` and `timer-manager.js` ("both
  carry runtime execution state ... alongside their definitions, which is
  Step 12's ... scope, not this step's pure-definition scope"), and
  `alias-manager.js`'s variable methods ("Formalizing them as session-scoped
  runtime state is Step 12's job")
  (`docs/plans/multi-connection-ui-phase-1-step-11-implementation-plan.md:145-157,
  243-252`). The master plan's own "related adapters" clause for Step 12
  covers `alias-manager.js` even though it is not named in the four explicit
  files.
- Step 10's own Out-of-scope explicitly reserved "the full automation
  runtime" - "cooldowns, recursion guards, GMCP variables" attached to "a
  session-owned container" - to this step, and states its `runtime-state.ts`
  "intentionally does not anticipate that shape, so as not to guess at a
  contract Step 12's own plan has not yet pinned"
  (`docs/plans/multi-connection-ui-phase-1-step-10-implementation-plan.md:252-256,
  651-656`). This step is the first to pin that shape, but composing it onto
  the real `Session`/`SessionParts` (`client/runtime/session.ts:37-48`)
  remains Step 13's job, matching Step 11's identical boundary.
- `docs/session-model.md:80-82` already states the ownership rule this step
  implements: "Shared sets and local definitions contain definitions only.
  Runtime state - sockets, GMCP variables, timer handles, cooldowns, match
  state - stays on the session side of the boundary." This is not merely
  descriptive: the frozen Step 3 `CharacterProfile` interface has no field
  for variables at all - only `configSetRefs`, `localDefinitions`,
  `commandHistory`, `workspace`, and `audio`
  (`client/model/profiles.ts:48-58`). A design that kept user variables
  persisted per-character (rather than in-memory, session-owned) would
  require reopening Step 3's already-frozen contract, which this step's
  Out-of-scope does not permit. The persisted-to-in-memory ownership change
  below is therefore evidence-backed, not merely assumed.
- `trigger-manager.js` derives its scope key from `dom.host`/`dom.port`/
  `dom.protocolSelect` exactly like the pre-Step-11 managers
  (`public/js/trigger-manager.js:237-244`), stores triggers in
  `this._data.scopes[scopeKey]` (`:246-251`), and has no compat-bridge import
  today (grep-verified). `evaluateLine`/`getCompiledTriggers` are already
  stateless pure reads over the active scope with no persisted match state or
  cooldown field anywhere in the file (`:479-521`, grep-verified absence of
  `cooldown` in this file).
- `timer-manager.js` has the identical dom-derived scope key
  (`public/js/timer-manager.js:210-216`) and no compat-bridge import, plus a
  *second*, distinct concern: `_runtime` is a `Map<scopeKey, Map<timerId,
  {handle, startedAt, fireAt}>>` built from raw, uncancellable
  `setTimeout`/`clearTimeout` calls (`:175`, `:298-317`).
  `reconcileRuntime(scopeKey)` only *stops* runtime entries whose id is no
  longer enabled/present (`:430-437`) - it never starts anything, so it
  cannot alone satisfy the master plan's "start newly enabled auto-timers
  once" requirement. `startAutoTimers()`/`stopAllTimers()` are called from
  `connection.js` on connect and on every disconnect/close path
  (`public/js/connection.js:710,787,798`) - those call sites are unaffected
  by this step; only what they call into changes ownership.
- `automation-executor.js`'s `wait` step schedules an uncancellable
  `setTimeout(resolve, delayMs)` directly on the global
  (`public/js/automation-executor.js:78-92`) with no session or scope
  awareness anywhere in the module (grep-verified: no `import` beyond
  `alias-manager.js`, `trigger-manager.js`, `function-manager.js`,
  `sound-manager.js`, and the expression/script core modules). A session
  disposed mid-`wait` today has no way to stop that step's continuation from
  running.
- `gmcp-variables.js` is a single bare module-level object,
  `runtimeVariables` (`public/js/gmcp-variables.js:2`), with zero scoping by
  server, character, or session - `registerGmcpVariables`/
  `resetGmcpVariables` are called from `gmcp.js`'s dispatch and reset paths
  (`public/js/gmcp.js:88,188`), and `getGmcpVariables()` is read by
  `alias-manager.js`'s `getAutomationVariables(scopeKey)`, which merges it
  ahead of the scope's own persisted `variables` bag
  (`public/js/alias-manager.js:396-402`: `{ ...getGmcpVariables(),
  ...scopeVariables }` - GMCP values first, local variables win on
  conflict). `alias-manager.js`'s `getVariable`/`setVariable`/
  `removeVariable`/`listVariableNames` read/write
  `this._ensureScope(scopeKey).variables`, which is part of the same
  `localStorage`-persisted blob as its aliases (`ALIAS_STORAGE_KEY`,
  `public/js/alias-manager.js:18,328-333,404-419`) - variables persist
  across reloads today.
- `client/runtime/resource-scope.ts` (Step 6, shipped) already proves the
  exact idempotent-disposal, fake-clock-safe scheduling contract this step's
  timer and wait runtime needs: `setTimeout(callback, delayMs): Disposer`
  calls `globalThis.setTimeout` at invocation time, auto-releases its own
  scope-entry immediately before invoking the callback on natural fire, and
  a disposed scope silently absorbs new registrations instead of throwing
  (`client/runtime/resource-scope.ts:9-17,59-79`). It has consumers only in
  its own test and Step 9's transport today; this step is its second real
  consumer.
- `client/runtime/**/*.ts` is already covered by Step 6's own additions to
  `tsconfig.json`'s `include`, `eslint.config.mjs`'s `scriptFiles` glob, and
  `package.json`'s `lint`/`format`/`format:check` globs (`tsconfig.json:23`,
  `eslint.config.mjs:12`, `package.json:53-55`, grep-verified). A new file
  placed inside that existing directory needs no further build-config
  changes, unlike Steps 3-6's introduction of their own new top-level
  directories.
- `settings-manager.js`'s backup/export feature reads
  `triggerManager._data`/`timerManager._data`/`aliasManager._data`/
  `highlightManager._data`/`functionManager._data` directly, bypassing every
  adapted method, and its import path writes straight to each manager's
  `_STORAGE_KEY` (`public/js/settings-manager.js:750-756,836-840`). This
  already silently under-serves aliases/highlights/functions once Step 11's
  bridge is active - Step 11's own plan does not mention
  `_buildSettingsBundle` anywhere (grep-verified) - and this step extends the
  identical gap to triggers/timers rather than introducing a new one.
- The master plan's own Verify command for this step is already committed:
  `node --test test/automation-executor.test.mjs test/gmcp-variables.test.mjs
  test/session-automation-runtime.test.mjs`
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:487`).
  `test/automation-executor.test.mjs` (1214 lines) and
  `test/gmcp-variables.test.mjs` (101 lines) are today's full regression
  suites for these two files; `test/session-automation-runtime.test.mjs` is
  wholly new.
- The Step 5/6/9/11 Vite-SSR `node --test` pattern
  (`test/typia-transform-dev.test.mjs:19-36`) is the only proven way to
  execute a new `client/runtime/**.ts` file alongside plain-ESM `public/js/**`
  imports and Node's `t.mock.timers` in one test file.

## Must-haves

- [MH1] Trigger and timer definitions resolve through the same local-over-
  shared-over-builtin effective-configuration precedence Step 11 already
  proved for the other four kinds, with the identical fallback-safety
  guarantee. Acceptance: with the bridge uninstalled, every trigger/timer
  manager method's exported behavior is byte-identical to its pre-step
  implementation; with it installed, `getCompiledTriggers`/`evaluateLine`
  and `findTimerByName`/`getScopeSnapshot` reflect
  `getEffectiveDefinitions('triggers'|'timers')`'s local-over-shared-over-
  builtin result with correct provenance, matching Step 11's MH4.
- [MH2] Every automation-runtime instance (variables, GMCP variables, timer
  registry) is provably independent of every other instance. Acceptance: a
  fixture constructs two `AutomationRuntimeState` instances, writes a user
  variable, a GMCP variable, and a running timer into the first, and proves
  the second observes none of them - mirroring Step 11's MH6 cross-session
  isolation, applied to runtime state instead of definitions.
- [MH3] Reconciling a new effective-timer-snapshot revision is atomic and
  idempotent. Acceptance: a fixture with a running timer whose id remains
  present and enabled in the new snapshot shows its remaining time
  untouched (not reset or restarted) after reconciliation; a timer removed
  from, or disabled in, the new snapshot has its runtime entry cleared; a
  timer with `autoStart: true` newly enabled in the new snapshot and with no
  existing runtime entry is started exactly once; running reconciliation
  twice in a row on an unchanged snapshot starts nothing a second time.
- [MH4] Disposing an automation runtime cancels every pending timer and wait
  it owns; no callback fires after disposal even under an advanced fake
  clock. Acceptance: a fixture schedules a recurring timer and a pending
  `wait` step's completion through the runtime, disposes it before either
  fires, advances a fake clock past both delays, and observes zero
  invocations - mirroring Step 6's MH4 fixture shape applied through this
  step's own timer/wait scheduling.
- [MH5] GMCP variables become session-scoped when the bridge is active
  without changing their flattening, serialization, or naming behavior.
  Acceptance: a fixture feeds identical GMCP package/data pairs through the
  bridge-active and bridge-inactive paths and asserts identical resulting
  variable names and values, reusing `gmcp-variables.js`'s existing
  `toVariableSegment`/`variableNameFor`/`serializeValue`/`flattenValue`
  algorithm rather than reimplementing it.
- [MH6] User variables move from persisted, per-scope `localStorage` state to
  in-memory, session-owned state only on the active path; the inactive path
  keeps today's persisted behavior verbatim. Acceptance: with the bridge
  installed, a fixture proves `setVariable`/`getVariable`/`removeVariable`/
  `listVariableNames`/`getAutomationVariables` never read or write
  `ALIAS_STORAGE_KEY`; with the bridge uninstalled, the same fixture proves
  byte-identical persisted behavior to pre-step code, including surviving a
  simulated reload.
- [MH7] The `wait` automation step's delay is cancelable per session when the
  bridge is active, and unchanged when inactive. Acceptance: with no
  `scheduleWait` supplied, `waitResult`'s existing 1214-line test suite
  passes unmodified; with a fake `scheduleWait` supplied, `waitResult` calls
  it instead of the global `setTimeout`; disposing the owning scope mid-wait
  leaves the wait's completion promise permanently unresolved and its
  continuation steps unexecuted.
- [MH8] The two compat bridges this step and Step 11 install do not silently
  misbehave when only one is active. Acceptance: with the automation bridge
  installed and the configuration bridge uninstalled (or the reverse),
  `timer-manager.js`'s reconciliation subscription stays dormant - no
  thrown `BRIDGE_UNINSTALLED_ERROR`, no dead subscription left behind; once
  both are installed, reconciliation behaves per MH3.

## Out of scope

- Wiring the automation runtime into the real `Session`/`SessionParts`
  (`client/runtime/session.ts:37-48`) or `client/app/bootstrap.ts`. This
  step's bridge is installed nowhere reachable by a real browser session,
  matching Step 11's identical boundary; constructing a real
  `AutomationRuntimeState` per live session and installing both compat
  bridges is Step 13's job.
- Implementing an actual trigger cooldown or rate-limiting feature.
  `evaluateLine`/`getCompiledTriggers` are already stateless with no
  persisted match state in the legacy code (Evidence); this step reserves
  the isolation boundary the master plan names but does not add new trigger
  product behavior.
- Changing `connection.js`'s `startAutoTimers()`/`stopAllTimers()` call
  sites, their timing, or the connect/disconnect lifecycle they represent.
  Only what those calls route into changes ownership.
- A single compat bridge covering both configuration definitions and
  automation runtime. This step keeps Step 11's configuration bridge
  (`public/js/session-compat/configuration.js`) untouched and adds a second,
  separate bridge (`public/js/session-compat/automation.js`) for runtime
  execution state, matching the master plan's own conceptual split between
  "definitions" (Step 11) and "execution state" (this step). A single merged
  bridge was considered and rejected: it would reopen Step 11's already-
  shipped, already-tested bridge file for a change unrelated to its own
  concern, risking a regression in `test/session-definition-adapters.test.mjs`
  for no benefit this step needs.
- Fixing `settings-manager.js`'s backup/export path reading manager `_data`
  directly instead of through the compat bridges (Evidence). This gap
  already exists for the four kinds Step 11 adapted and is not novel to this
  step; fixing it for all six kinds at once is better owned by whichever
  step first activates a bridge for a real user (Step 13), not scattered
  one kind at a time.
- Cooldowns or rate limiting for aliases or functions. Not named in the
  master plan's MH8 or this step's intent.
- Persisting any automation-runtime state (variables, GMCP variables, timer
  handles) under `darkflow-session-core-v1` or any other key. It is
  explicitly session-side, non-persisted state per `docs/session-model.md`'s
  ownership rules and the frozen `CharacterProfile` contract's absence of a
  variables field.

## Assumptions

- [User variables become pure in-memory, session-owned state with no
  `localStorage` persistence once the automation bridge is active, rather
  than remaining a persisted-but-rekeyed bag as Step 11 kept them for the
  configuration bridge] - this is evidence-backed, not a bare reading of
  `docs/session-model.md:80-82`: the frozen `CharacterProfile` interface has
  no variables field at all (`client/model/profiles.ts:48-58`), so a
  persisted-per-character design would require reopening Step 3's contract,
  which is out of scope here. If a future reviewer nonetheless decides
  variables must survive reload (a product-policy call, not an evidence
  question), that needs a Step 3 amendment first, and
  `automation-runtime.ts`'s variable store would then need to synchronize
  with a new persisted field instead of being purely in-memory - MH6's
  fixtures would need a persistence-parity case instead of a
  reset-on-session-boundary case.
- [Trigger cooldown/match state has no real implementation to isolate in
  Phase 1, since `evaluateLine`/`getCompiledTriggers` are already stateless
  pure functions with no persisted match state (grep-verified)] - if false:
  this step must design and add an actual cooldown/match-state feature,
  which is new product behavior outside a parity-preserving isolation step
  and would need its own Must-haves and fixtures.
- [A running timer's scheduled callback is never force-rescheduled when
  `reconcileTimers` processes a new snapshot revision that leaves that
  timer's id still present and enabled - only "started" (new) and "stopped"
  (removed/disabled) are reconciliation actions; a changed `durationMs` or
  other field on an already-running timer takes effect starting from its
  next natural fire or reschedule, not immediately] - if false:
  `reconcileTimers` must diff full definition payloads instead of only
  id/enabled state, and MH3's fixtures need an edited-running-timer case
  with a different, and currently undecided, expected outcome.
- [`automation-executor.js` gains one optional context field
  (`scheduleWait`) that defaults to today's raw, uncancellable
  `setTimeout`-based Promise when absent, rather than importing the new
  automation bridge directly] - if false: `automation-executor.js` needs a
  direct static import of `session-compat/automation.js`, turning a
  currently bridge-agnostic, purely functional module into one with global
  runtime-state coupling and complicating its own existing 1214-line test
  suite's isolation from bridge state.

## Hard constraints

- `timer-manager.js`'s runtime-reconciliation subscription (Step 4) is only
  meaningful when *both* compat bridges are active together: it calls the
  configuration bridge's `subscribe()` to learn about new timer-definition
  revisions, then calls the automation bridge's `reconcileTimers`. Neither
  bridge enforces this ordering on its own - `isAutomationCompatActive()`
  and `isConfigurationCompatActive()` are independent flags. `timer-manager.js`
  must guard its subscription setup on both flags together and treat
  "automation active, configuration inactive" (or the reverse) as
  reconciliation staying dormant rather than throwing
  `BRIDGE_UNINSTALLED_ERROR` from inside a notification callback. Step 13,
  the first real installer of either bridge, must install both together for
  timer reconciliation to ever run for real. [Architect, Validator finding]
- `timer-manager.js`'s subscription to the configuration bridge must be
  idempotent across repeated bridge install/reset cycles. A test (or Step
  13's own re-initialization path) that installs, resets, and reinstalls
  the bridges must not accumulate duplicate reconciliation subscriptions -
  `timer-manager.js` tracks its own current unsubscribe handle and releases
  it before establishing a new one whenever bridge activation state changes.
  [Validator finding]

## Risks

- Implementing "keep still-valid runtime entries" as anything other than a
  strict no-op for an already-running, still-enabled, still-present timer
  could silently reset every running timer's countdown on an unrelated
  settings save. Mitigation: MH3's fixture asserts a running timer's
  remaining time is untouched when reconciliation runs after an edit to a
  *different* timer in the same snapshot.
- Moving user variables from persisted to in-memory-only when the bridge
  activates is a genuine behavior change (variables no longer survive
  reload) that a future reader could mistake for "same behavior, different
  storage," matching Step 11's own concern about a misread step summary.
  Mitigation: this is named explicitly in Evidence, Assumptions, and Notes,
  and MH6 makes the *inactive* path's persistence a tested, provable
  regression check, confining the actual behavior change to the not-yet-
  installed bridge path exactly as Step 11 confined its own changes.
- Two parallel timer-scheduling paths (raw `setTimeout` inactive, scope-owned
  active) and two parallel wait-scheduling paths double the surface for
  behavioral drift, mirroring Step 11's fallback-path risk. Mitigation: the
  inactive path is a verbatim copy of pre-step logic in every adapted
  method, and every Must-have requires a fixture in both bridge states.
- `alias-manager.js`'s `getAutomationVariables` merges `getGmcpVariables()`
  with its own scope variables today
  (`public/js/alias-manager.js:396-402`); if `gmcp-variables.js` gains
  bridge-awareness in one step but `alias-manager.js`'s variable methods are
  adapted separately or inconsistently, the merge could silently read a
  stale global while claiming to be session-scoped. Mitigation: this plan
  adapts both files in the same step (Step 3 below), and a fixture calls
  `getAutomationVariables` directly (not the two underlying functions in
  isolation) to catch a partial migration.
- `settings-manager.js`'s backup/export path reads `triggerManager._data`
  and `timerManager._data` directly, bypassing every adapted method
  (`public/js/settings-manager.js:754-755`), and its import path writes
  straight to `TRIGGER_STORAGE_KEY`/`TIMER_STORAGE_KEY`
  (`public/js/settings-manager.js:838-839`). When the bridge is active,
  `_data` no longer reflects true state (writes route to the compat bridge,
  not `this._data`), so a backup taken with the bridge active would
  silently export stale or empty trigger/timer data. This is not new to
  this step - the identical gap already exists for `aliasManager._data`/
  `highlightManager._data`/`functionManager._data` since Step 11 shipped,
  and Step 11's own plan did not address it either (grep-verified: no
  mention of `_buildSettingsBundle` anywhere in that plan). Mitigation: out
  of scope here, same as it was implicitly out of scope for Step 11 - but
  record it explicitly in the Step 16 decision record as a known gap all
  six kinds share, so Step 13 (the first step that can activate a bridge
  for a real user) treats fixing the backup/export path as a prerequisite
  of, not an afterthought to, real cutover.
- A `wait` step whose `scheduleWait` context field is forgotten by a caller
  when the bridge is active would silently fall back to the raw,
  uncancelable `setTimeout`, defeating MH4/MH7 without an error. Mitigation:
  the Step 6 fixture pattern of asserting zero post-dispose invocations
  under `t.mock.timers` (not just "no throw") makes a forgotten wiring a
  failing test rather than a silent gap; Step 13's own wiring is out of this
  step's scope but this step's own test proves the mechanism works when
  wired.

## Steps

### Step 1 - Build the session-owned automation runtime primitive

**Files:** `client/runtime/automation-runtime.ts` (new)

No `tsconfig.json`/`eslint.config.mjs`/`package.json` changes are needed:
`client/runtime/**/*.ts` is already covered by Step 6's own glob additions
(`tsconfig.json:23`, `eslint.config.mjs:12`, `package.json:53-55`,
grep-verified), and this file lands inside that existing directory rather
than a new one.

**Intent:** Implement `createAutomationRuntimeState(scope: ResourceScope):
AutomationRuntimeState`, built specifically on Step 6's `ResourceScope`
(`client/runtime/resource-scope.ts:9-17`) rather than a plain-JS scheduling
helper, so timer/wait cancellation reuses that primitive's already-proven
idempotent-disposal and fake-clock-safe guarantees instead of reimplementing
them. Expose user-variable methods (`getVariable(name)`/
`setVariable(name, value)`/`removeVariable(name)`/`listVariableNames()`) over
an in-memory `Map`; GMCP-variable methods
(`setGmcpVariable(packageName, data)`/`resetGmcpVariables()`/
`getGmcpVariables()`/`listGmcpVariables()`) reusing `gmcp-variables.js`'s
exact `toVariableSegment`/`variableNameFor`/`serializeValue`/`flattenValue`
algorithm ported into this file (not reimplemented from scratch, to keep
MH5's naming/serialization identical); `getAutomationVariables()` merging
GMCP variables first, then user variables overriding, matching
`alias-manager.js`'s existing merge order
(`public/js/alias-manager.js:396-402`). Expose a timer registry -
`scheduleTimer(timerId, durationMs, onFire): void`/`clearTimer(timerId):
void`/`getTimerRuntimeState(timerId): {startedAt, fireAt} | null` - built on
one shared internal helper that wraps `scope.setTimeout`, replacing any
existing scheduled entry for the same id before registering a new one. This
helper's own fire callback removes the registry map entry for that id
*before* invoking `onFire` - `scope.setTimeout`'s own returned `Disposer`
already self-releases the scope's internal bookkeeping on natural fire
(`client/runtime/resource-scope.ts:65-78`), and the registry map must track
that release symmetrically, or a one-shot timer that already fired would
still read as "registered" to `reconcileTimers` and `getTimerRuntimeState`
forever afterward. `scheduleWait(delayMs): Promise<void>` reuses that same
`scope.setTimeout` wrapper directly (an ungated, unregistered call - not a
second scheduling system, just the one shared primitive used without a
registry key) rather than introducing independent scheduling code. Expose
`reconcileTimers(effectiveTimers, onStart)`: for each effective timer
definition, if it is enabled, `autoStart`, and has no current registry
entry, call `onStart(timer)`; for each currently registered timer id absent
from or disabled in `effectiveTimers`, call `clearTimer(timerId)`; a timer
id present, enabled, and already registered is untouched. Expose
`dispose()` that clears every variable/GMCP-variable/timer-registry map
entry (the underlying `scope.setTimeout` handles are already cancelled by
the owning `scope`'s own disposal per Step 6's contract, so this method only
clears this module's own bookkeeping maps, mirroring how the registry
already self-clears on natural fire).

**Verify:**

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
```

**Done when:** two independently constructed `AutomationRuntimeState`
instances never observe each other's variables, GMCP variables, or timer
registry entries (MH2); `reconcileTimers` starts a newly enabled `autoStart`
timer exactly once, leaves an already-running timer's registry entry
untouched, and clears a removed/disabled timer's entry (MH3); disposing the
owning `scope` before a scheduled timer's or `scheduleWait`'s delay elapses
shows zero invocations after a fake clock advances past that delay (MH4);
GMCP-variable naming/serialization matches `gmcp-variables.js`'s existing
output for identical inputs (MH5 groundwork); a naturally fired one-shot
timer no longer reads as registered afterward.

### Step 2 - Build the plain-JavaScript automation compatibility bridge

**Files:** `public/js/session-compat/automation.js` (new)

**Intent:** Mirror Step 11's `session-compat/configuration.js` shape exactly:
a module-local `let bridge = null;` plus `installAutomationCompatBridge`,
`resetAutomationCompatBridgeForTests`, `isAutomationCompatActive`, and one
forwarding function per `AutomationRuntimeState` method from Step 1
(`getVariable`/`setVariable`/`removeVariable`/`listVariableNames`/
`getAutomationVariables`, `setGmcpVariable`/`resetGmcpVariables`/
`getGmcpVariables`/`listGmcpVariables`, `scheduleTimer`/`clearTimer`/
`getTimerRuntimeState`/`reconcileTimers`, `scheduleWait`). Document the
expected bridge shape with a JSDoc `@typedef` only, and calling a forwarding
function while uninstalled throws a distinctly named error (never silently
returns empty/default data), matching Step 11's `BRIDGE_UNINSTALLED_ERROR`
precedent with its own distinct error name. This file contains zero `import`
statements beyond its own exports, satisfying the same structural
zero-cross-boundary-import guarantee as Step 11's MH1.

**Verify:**

```bash
node --test test/session-automation-runtime.test.mjs
```

(bridge-wiring fixtures only at this point; manager fixtures land in Steps
3-5)

**Done when:** installing then resetting the bridge atomically swaps
`isAutomationCompatActive()`'s return value; every forwarding function
passes its arguments through unchanged to the installed bridge; calling a
forwarding function while uninstalled throws a distinctly named error.

### Step 3 - Adapt gmcp-variables.js and alias-manager.js's variable methods

**Files:** `public/js/gmcp-variables.js`, `public/js/alias-manager.js`

**Intent:** In `gmcp-variables.js`, branch `registerGmcpVariables`/
`resetGmcpVariables`/`getGmcpVariables`/`listGmcpVariables` on
`isAutomationCompatActive()`: active delegates to the Step 2 bridge's
matching forwarder; inactive keeps the current module-global
`runtimeVariables` object verbatim, including the existing
`darkwind:gmcp-variables-changed` `CustomEvent` dispatch in both branches (so
`settings-manager.js`'s `dataSyncHandler`
(`public/js/settings-manager.js:260-274`) needs no change in either state).
In `alias-manager.js`, branch `getVariable`/`setVariable`/`removeVariable`/
`listVariableNames`/`getAutomationVariables` the same way: active calls the
Step 2 bridge's matching forwarder (ignoring the `scopeKey` parameter,
matching Step 11's MH3 "no `dom` read" precedent applied to this bridge
instead of the configuration one); inactive keeps today's
`this._ensureScope(scopeKey).variables` read/write verbatim, including the
`_save`/`emitAliasDataChanged` persistence call. No other line in either
file's variable-handling block changes.

**Verify:**

```bash
node --test test/gmcp-variables.test.mjs test/alias-expression-core.test.mjs test/session-automation-runtime.test.mjs
```

**Done when:** `test/gmcp-variables.test.mjs` passes unmodified; with the
bridge installed, a fixture proves `alias-manager.js`'s
`getAutomationVariables` reads solely from the bridge and never touches
`ALIAS_STORAGE_KEY` (MH6); with the bridge uninstalled, the same fixture
proves byte-identical persisted behavior across a simulated reload (MH6);
GMCP-variable naming and values are identical between bridge-active and
bridge-inactive paths for the same inputs (MH5).

### Step 4 - Adapt trigger-manager.js and timer-manager.js

**Files:** `public/js/trigger-manager.js`, `public/js/timer-manager.js`

**Intent:** Apply Step 11's Step 3 adaptation pattern to
`trigger-manager.js` (`ConfigKind` `'triggers'`) and to `timer-manager.js`'s
*definition* methods (`ConfigKind` `'timers'`), reusing the already-frozen
`public/js/session-compat/configuration.js` bridge from Step 11 unchanged -
no new configuration-bridge code, since `client/configuration/service.ts`
and `identity.ts` are already generic across all six kinds. `getActiveScopeKey()`
in both files gains the same two-branch dispatcher Step 11 used; every read
entry point (`getScopeSnapshot`, `findTriggerByPattern`/`findTriggerById`/
`getCompiledTriggers`/`evaluateLine` in `trigger-manager.js`;
`getScopeSnapshot`, `findTimerByName`/`findTimerById` in `timer-manager.js`)
and write entry point (`saveScope`, `upsertSimpleTrigger`/
`removeTriggerByPattern`/`setEnabledById`/`toggleEnabledById` in
`trigger-manager.js`) branches the same way, mapping `EffectiveDefinition<T>[]`
to the plain array shape each caller expects when active, and keeping the
existing `_ensureScope`/`this._data` path verbatim when inactive.

Separately, adapt `timer-manager.js`'s *runtime* half to the new automation
bridge from Step 2: `_scheduleTimer`/`_clearRuntimeTimer` call the bridge's
`scheduleTimer`/`clearTimer` forwarders instead of raw `setTimeout`/
`clearTimeout` when `isAutomationCompatActive()`; `getRuntimeState` reads
from the bridge's `getTimerRuntimeState` when active. Per the Hard
constraints above, `timer-manager.js` establishes its reconciliation
subscription only when **both** `isAutomationCompatActive()` and
`isConfigurationCompatActive()` are true, tracking the resulting
unsubscribe handle in a module-local variable and releasing it first
whenever either flag's value changes, so repeated install/reset cycles
never accumulate duplicate subscriptions. While both are active, the
subscription (via the *configuration* bridge's existing
`subscribe(listener)`) calls, on each notification, the automation bridge's
`reconcileTimers(effectiveTimers, onStart)` with the freshly resolved
effective timer list and an `onStart` callback that wraps the existing
`_executeTimer`/reschedule logic - implementing the master plan's
atomic-reconciliation requirement without changing the inactive fallback's
own `reconcileRuntime`/`saveScope` call sites, which stay verbatim.

**Verify:**

```bash
node --test test/automation-executor.test.mjs test/session-automation-runtime.test.mjs
```

**Done when:** with the bridge uninstalled, every trigger/timer fixture
produces output identical to pre-step behavior (MH1); with it installed, no
`dom` getter is touched and effective reads carry correct provenance (MH1);
a new configuration revision (a timer edited, added, removed, or toggled)
reconciles per MH3's exact three cases through `timer-manager.js`'s own
public API, not just through `automation-runtime.ts` directly; installing
only one of the two bridges leaves reconciliation dormant (no thrown error,
no dead subscription) until both are active (MH8); reinstalling both
bridges across two fixtures in the same process leaves exactly one live
reconciliation subscription, not two.

### Step 5 - Make the wait step's delay cancelable per session

**Files:** `public/js/automation-executor.js`

**Intent:** Add one optional context field, `scheduleWait(delayMs) =>
Promise<void>`. Change `waitResult(seconds)` (currently reading only
`seconds`) to accept a second parameter and call `context.scheduleWait` in
place of its own `new Promise((resolve) => setTimeout(resolve, delayMs))`
when that field is a function; when absent, keep the exact current
raw-`setTimeout` Promise construction (byte-identical default, satisfying
the majority of MH7 by construction). Thread `context.scheduleWait` through
to every `waitResult` call site inside the file (the `wait`-step branch of
`executeAutomationStep`). `trigger-manager.js`'s `evaluateLine`-driven
execution path and `timer-manager.js`'s `_executeTimer` pass
`context.scheduleWait` as a thin wrapper around the Step 2 bridge's
`scheduleWait` forwarder when `isAutomationCompatActive()`, and omit the
field entirely when inactive - no other file in the automation-executor call
graph changes.

**Verify:**

```bash
node --test test/automation-executor.test.mjs test/session-automation-runtime.test.mjs
```

**Done when:** the existing 1214-line `test/automation-executor.test.mjs`
suite passes unmodified with no `scheduleWait` supplied; a fixture supplying
a fake `scheduleWait` proves `waitResult` calls it instead of the global
`setTimeout`; a fixture disposes the owning scope mid-wait and proves the
wait's completion promise never resolves and its continuation steps never
run (MH4, MH7).

### Step 6 - Prove isolation, reconciliation, disposal, and production-safety

**Files:** `test/session-automation-runtime.test.mjs` (new),
`test/automation-executor.test.mjs` (extended in Step 5),
`test/gmcp-variables.test.mjs` (extended in Step 3)

**Intent:** Use plain Node ESM imports (no Vite-SSR runner needed) for the
fallback-path and bridge-wiring fixtures that only touch `public/js/**` plus
a hand-built fake bridge object, proving MH1 (fallback parity for triggers/
timers), MH6/MH7's inactive-path byte parity, MH5's naming parity, and MH8's
dormant-when-partially-installed behavior. Use the Step 5/6/9/11 Vite-SSR
pattern to additionally import `client/runtime/automation-runtime.ts` and
`client/runtime/resource-scope.ts` alongside the legacy managers in the same
file, using `t.mock.timers` exactly as `test/session-lifecycle-primitives.test.mjs`
and `test/map-data-v2-lifecycle.test.mjs` already do, to prove MH2
(two-instance isolation), MH3 (all three reconciliation cases plus the
edited-running-timer non-restart case from Assumptions), and MH4/MH7 (zero
post-dispose invocations under an advanced fake clock).

**Verify:**

```bash
node --test test/automation-executor.test.mjs test/gmcp-variables.test.mjs test/session-automation-runtime.test.mjs
npm run format:check
npm run lint
npm run typecheck
npm run check
npm run build
npm run verify:bundle
npm run verify:client-artifact
git diff --check
```

**Done when:** every Must-have in this plan and every master-plan Step 12
Done-when condition
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:489-491`) has
a passing fixture; the full quality/build battery is green;
`npm run verify:client-artifact` confirms the four adapted `public/js/**`
files (plus the new `session-compat/automation.js`) still ship as exact
source copies with no bundling side effect.

## Success criteria

- [ ] Trigger and timer definitions resolve through local-over-shared-over-
      builtin precedence with correct provenance, with byte-identical
      fallback behavior when the bridge is uninstalled.
- [ ] Two independent automation-runtime instances never observe each
      other's variables, GMCP variables, or timer registry entries.
- [ ] A new effective-timer-snapshot revision reconciles atomically: still-
      valid running timers are untouched, removed/disabled timers stop, and
      newly enabled auto-start timers start exactly once.
- [ ] Disposing an automation runtime cancels every pending timer and wait
      it owns; nothing fires after disposal even under an advanced fake
      clock.
- [ ] GMCP variables are session-scoped when the bridge is active, with
      naming/serialization identical to the bridge-inactive path.
- [ ] User variables are in-memory and session-owned when the bridge is
      active, and byte-identical persisted `localStorage` state when it is
      not.
- [ ] The `wait` automation step's delay is cancelable per session when the
      bridge is active, and unchanged (including its existing test suite)
      when it is not.
- [ ] Activating only one of the two compat bridges leaves timer
      reconciliation dormant instead of throwing or leaking a subscription.
- [ ] The full quality/build battery, including `verify:client-artifact`'s
      byte-parity check, passes alongside the new and extended tests.

## Rollback

Like Step 11, this step edits four already-shipped, live-imported production
files (`trigger-manager.js`, `timer-manager.js`, `automation-executor.js`,
`gmcp-variables.js`) plus `alias-manager.js`, but the inert-by-default design
(both compat bridges are installed nowhere reachable by a real browser
session) means production behavior is provably unchanged for the entire time
this step is merged and Step 13 has not yet shipped. Reverting before Step
13 lands is a plain revert of the five manager edits and deletion of
`client/runtime/automation-runtime.ts` and
`public/js/session-compat/automation.js` plus their test coverage - zero
data impact, since neither bridge is ever installed outside `node --test`.
This step touches no persisted user data and writes nothing new under
`darkflow-session-core-v1`.

## Execution fit

- Scope: multi-run phase (one step within the ongoing Phase 1 program)
- Lead: Terra at high reasoning - matching Steps 5, 6, 9, and 11's own
  choice; the disposal-safety and reconciliation-atomicity design carries
  real correctness risk (silent timer resets, leaked post-dispose
  callbacks), but every underlying primitive it composes (Step 6's
  `ResourceScope`, Step 11's configuration bridge, Step 5's identity/resolve
  engine) is already frozen and proven
- Workers: none - the automation-runtime primitive, its compat bridge, and
  the five adapted legacy files share one design decision (the runtime
  container's shape and its uninstalled-fallback contract); splitting
  authorship risks the reconciliation logic and the variable-ownership
  change drifting out of sync with each other
- Delegation shape: solo
- Ownership: the lead owns the automation-runtime container shape (Step 1),
  the atomic-reconciliation contract (MH3), the persisted-to-in-memory
  variable-ownership decision, the dual-bridge coupling guard (Hard
  constraints), and the go/no-go decision before Step 13 begins
- Replan trigger: Step 13's actual bootstrap sequencing reveals the
  automation bridge's shape is insufficient for what
  `client/app/bootstrap.ts` needs to construct and hand off (for example if
  timer reconciliation needs to run before the first `subscribe`
  notification rather than only in response to one); or the persisted-to-
  in-memory variable change is rejected once a real user workflow is
  exercised, requiring a persistence-parity redesign and a Step 3 amendment
- Confidence: medium-high - the definition-adaptation half directly reuses
  Step 11's proven pattern and Step 6's proven disposal contract, and the
  variable-ownership decision is now evidence-backed by the frozen
  `CharacterProfile` contract rather than inferred; the
  reconciliation-atomicity contract and the dual-bridge coupling guard
  remain this plan's own first-instance judgment calls

Plan self-review: PASS (9/10)

Notes:

- This plan deliberately keeps the automation compat bridge separate from
  Step 11's configuration bridge rather than folding runtime scheduling into
  the same file, mirroring the master plan's own conceptual split between
  "definitions" (Step 11) and "execution state" (this step). If Step 13's
  own planning finds two bridges awkward to install together, that is this
  plan's named replan trigger, not a sign this step was done incorrectly -
  and the Hard constraints section above already requires Step 13 to
  install both together for timer reconciliation to function.
- The "trigger cooldown/match state" language in the master plan's MH8 and
  this step's own intent line has no corresponding implementation anywhere
  in today's legacy code (grep-verified). This plan treats that tier as
  legitimately empty in Phase 1, exactly as Step 5 treated the built-in
  configuration tier as legitimately empty - record this explicitly in the
  Step 16 decision record so a future reader does not mistake the absence
  for an oversight.
- Adversarial review upgraded the user-variable persistence question from an
  assumption to an evidence-backed decision: the frozen `CharacterProfile`
  contract (`client/model/profiles.ts:48-58`) has no variables field, which
  forecloses a "persist per-character" alternative without reopening Step 3.
  This is a stronger footing than the plan started with.
- Adversarial review also found and fixed one concrete error: Step 1
  originally listed `tsconfig.json`/`eslint.config.mjs`/`package.json` as
  files to modify, copying the boilerplate from Steps 3, 5, and 6 without
  checking that `client/runtime/**` was already covered by Step 6's own
  glob additions. No such build-config edit is needed for this step.
- Adversarial review surfaced a real, previously undocumented gap:
  `settings-manager.js`'s backup/export path reads manager `_data` directly,
  bypassing the compat-bridge pattern entirely. It already silently affects
  Step 11's four adapted kinds and will extend to triggers/timers here. This
  plan keeps it explicitly out of scope (consistent with Step 11's own
  silence on it) but records it as a named risk so Step 13 does not
  discover it late.
- A single unified bridge (configuration + automation combined) and
  persisting variables on `CharacterProfile` were both considered as
  alternatives and rejected - the first for reopening a shipped, tested
  file for an unrelated concern, the second because it is foreclosed by
  Step 3's already-frozen contract, not merely undesirable.
