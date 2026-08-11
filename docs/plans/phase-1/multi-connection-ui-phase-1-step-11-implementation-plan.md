# Phase 1 Step 11 Implementation Plan

## Planning selection

- Mode: detailed implementation plan
- Complexity: 7/10 - narrow change surface (four already-shipped legacy files
  plus one new compatibility module and one small extension to an
  already-frozen Step 5 file), but real production-safety risk: unlike Steps
  3-10, which added inert new `client/**` files with zero importers, this step
  edits `public/js/alias-manager.js`/`highlight-manager.js`/
  `function-manager.js`/`settings-manager.js`, which are already imported by
  the live shipped app today. A wrong wiring decision here does not stay
  contained to an unreached module; it changes real user behavior the moment
  the PR merges. A risk score of 2 does not by itself require a phase map for
  one bounded change, so this stays a detailed plan with a full adversarial
  pass instead of a re-decomposition.
- Hard triggers: none of the phase-map triggers apply - this is one
  independently deployable, already-scoped master-plan step, not multiple
  deployables, not a multi-phase rollout, and the user asked specifically for
  Step 11
- Current planning horizon: `public/js/alias-manager.js`,
  `highlight-manager.js`, `function-manager.js`, the key-mapping portions of
  `settings-manager.js`, new `public/js/session-compat/configuration.js`, a
  small extension to `client/configuration/service.ts`, and
  `test/session-definition-adapters.test.mjs`, exactly as scoped by the
  master plan's Step 11 entry
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:454-470`)
- Evidence horizon: the four legacy managers' current scope/storage logic in
  full, the frozen Step 3/5 domain and configuration contracts, the Step 4
  migration code and its live-caller count, `vite.config.ts`'s `publicDir`
  boundary, `lib/client-artifact.js`'s public-parity check, and one real
  `npm run build` run to confirm what actually ships to `dist/client/`
- Adversarial review: full (Skeptic, Validator, Architect, Creative),
  self-applied - this step both defines a boundary/contract Step 13 directly
  builds on (matching Step 9's own justification for a full pass) and carries
  genuine production-safety stakes if the public/js-to-client/** boundary
  decision below is wrong. Findings are folded into Evidence, Must-haves,
  Assumptions, Risks, and Notes rather than kept separate.

The clarification gate is skipped for the same reason Steps 3, 5, 6, 7, 8, 9,
and 10 skipped it: the product decision (adapt definition managers to
profile/configuration snapshots) is already approved at the phase level
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:9-15`). This
plan resolves the remaining implementation-level ambiguities as documented
assumptions, because repository evidence - specifically a real build and the
public-parity checker - answers the one question the master plan's two-line
Step 11 summary leaves open: how legacy `public/js/**` can safely consume
`client/**` TypeScript contracts before Step 13 exists.

## Goal

Stop `alias-manager.js`, `highlight-manager.js`, `function-manager.js`, and
the key-mapping portions of `settings-manager.js` from deriving their active
scope by reading `dom.host`/`dom.port`/`dom.protocolSelect`, and give them a
path to read/write through the Step 5 effective-configuration service instead
- while guaranteeing zero behavior change for real users until Step 13
actually installs that path. Nothing this step builds is reachable from the
live boot path; Step 13 is what turns it on.

## Evidence and constraints

- `public/js/**` is Vite's `publicDir` (`vite.config.ts:7-8`: `root: "client"`,
  `publicDir: "../public"`). Vite copies `publicDir` content into the build
  output verbatim; it is never part of the `root`-scoped module graph, so no
  `@ttsc/unplugin` transform and no bundling ever touches it. A real
  `npm run build` confirms this: the root bundle
  (`dist/client/assets/root-*.js`) is 2.2 kB - only `client/app/bootstrap.ts`'s
  own logic - while every `public/js/**` file ships as a separate, untouched,
  unbundled file. `lib/client-artifact.js:210-234`'s `validatePublicParity`
  (wired into `npm run postbuild` via `verify:client-artifact`) asserts every
  `publicDir` file is byte-identical between source and artifact, which would
  fail the instant a `public/js/**` file were bundled or rewritten. Together
  this proves a `public/js/**` file can never contain a static ES import of a
  `client/**/*.ts` module: the browser would request that exact path in
  production and get a 404, since the `.ts` source is not copied and the
  bundled output uses hashed, unrelated filenames.
  (`client/app/bootstrap.ts`'s own `await import(/* @vite-ignore */
  "/js/app.js")` is the existing precedent for this exact boundary - the
  `@vite-ignore` comment is there specifically so Vite does not try to
  statically resolve a publicDir path.)
- `migrateLegacyData` (`client/storage/legacy-migration.ts:74-233`) has zero
  callers anywhere in `client/**` or `public/js/**` today (grep-verified). No
  browser session has a populated `darkflow-session-core-v1` graph yet. Step
  10's own Out-of-scope already reserves "reading `/config.json`, opening or
  migrating the profile store, or choosing the active character" to Step 13
  (`docs/plans/multi-connection-ui-phase-1-step-10-implementation-plan.md:243-246`).
  Therefore this step cannot make live manager behavior depend on that graph
  existing - for every current user, `readState()` would return
  `missing-state` (`client/storage/repository.ts:27-42`), and a manager that
  unconditionally switched to the new service would show empty
  aliases/highlights/functions/key mappings in production before Step 13
  ships.
- `client/configuration/service.ts` currently exposes only
  `publishConfigurationSet` (writes one shared `ConfigurationSet`,
  compare-and-swap, notifies every subscriber via `notifySubscribers`
  iterating all subscribed characters, `client/configuration/service.ts:85-162`)
  and `subscribe`/`resetConfigurationSubscriptionsForTests`
  (`client/configuration/service.ts:54-82`). Nothing publishes or notifies a
  single character's *local* definitions - `saveScope`'s bulk-replace
  semantics (evidence below) has no equivalent.
- Every manager follows the identical scope-derivation pattern:
  `getActiveScopeKey()` builds `protocol://host:port` from
  `dom.host.value`/`dom.port.value`/`dom.protocolSelect.value`
  (`public/js/alias-manager.js:288-295`, `highlight-manager.js:424-431`,
  `function-manager.js:99-105`), and every other method defaults its
  `scopeKey` parameter to a fresh call of that function
  (for example `public/js/alias-manager.js:304,315,333,337,345,349,357,363,
  371,386,432,447,455,461,469,477,535`).
- `getScopeSnapshot(scopeKey)` returns a deep-cloned read of one scope's whole
  collection (`public/js/alias-manager.js:304-313`,
  `highlight-manager.js:440-448`, `function-manager.js:114-119`), and
  `saveScope(scopeKey, scope)` bulk-replaces that entire collection in one
  call (`public/js/alias-manager.js:315-318`, `highlight-manager.js:450-453`,
  `function-manager.js:121-124`). `settings-manager.js`'s modal editor is the
  only caller of `saveScope`: it snapshots a draft on `open()`
  (`public/js/settings-manager.js:230-239`) and, on save, calls
  `saveScope(scopeKey, draftScope)` once per manager
  (`public/js/settings-manager.js:584-588`) - a single bulk replace, never a
  per-item write. Any adapter must preserve this exact bulk-replace contract,
  not just the per-item mutators.
- `findAliasByTrigger`/`matchAlias` (`public/js/alias-manager.js:363-369,
  535-537`) and the equivalent `find*`/`getCompiledRules`/`applyHighlights*`
  functions in the other two managers read over the *whole active scope's*
  definitions, which today conflates "what this endpoint has." Once
  shared-set references exist, matching a typed command against an alias must
  see the effective (local-over-shared-over-builtin) resolved set, not local
  definitions only - otherwise a shared alias silently stops firing. The
  frozen `resolveEffectiveConfiguration` (`client/configuration/resolve.ts:24-73`)
  already produces exactly this, ordered and provenance-tagged.
- `settingsManager._settings.keyMappings` is a single **global** array (not
  scope-keyed at all today - `public/js/settings-manager.js:127`), read by
  `input.js:704,706` via `settingsManager.get('keyMapperEnabled')`/
  `get('keyMappings')`. `_normalizeKeyMappings` produces `{code, label,
  legacyKey, command}` with **no `id` or `enabled` field**
  (`public/js/settings-manager.js:1192-1214`), while the frozen
  `KeyMappingDefinition` requires both (`client/model/configuration.ts:107-114`).
  Step 4's own migration already resolved the "one global list becomes
  per-character" question: it assigns the *entire* legacy `keyMappings` array
  only to the active migrated character, giving every other migrated
  character an empty list
  (`client/storage/legacy-migration.ts:133,170,297`), and synthesizes a
  fallback id `keymap-${index + 1}` when converting
  (`client/storage/legacy-migration.ts:540-561`). This step's key-mapping
  adapter must synthesize ids the same way and keep them stable across saves.
- `AliasDefinition` has no `variables` field
  (`client/model/configuration.ts:61-70`); the alias manager's per-scope
  `variables` bag (`getVariable`/`setVariable`/`removeVariable`/
  `getAutomationVariables`/`listVariableNames`,
  `public/js/alias-manager.js:333-361`) is runtime substitution state, not a
  definition. `docs/session-model.md:80-82` documents that runtime state
  (including variables) stays out of shared/local definitions by design, and
  the master plan assigns "user variables" to Step 12's session-owned
  execution containers
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:478-479`).
  This step must keep the variables bag exactly where it is today
  (persisted, per-scope) and out of any `AliasDefinition`/local-write payload;
  only its scope-key derivation may change.
- `ApplicationDefaults.defaultCharacterProfileId` is an already-frozen,
  optional field on the persisted graph (`client/model/profiles.ts:61-64`),
  and Step 4's migration already sets it to the migrated active character
  (`client/storage/legacy-migration.ts:196-198`). It is the only existing,
  non-DOM notion of "the active character" in the frozen contract, but this
  step does not read it directly - Step 13 owns resolving the active
  character (Step 10's Out-of-scope, cited above) and is expected to pass
  whatever `characterProfileId` it resolves into the bridge this step
  defines.
- No `e2e/**` spec currently exercises aliases, highlights, functions, or key
  mappings (directory-listed, none matched), and `test/` has no adapter test
  yet - `test/session-definition-adapters.test.mjs` is wholly new. The
  existing `test/alias-expression-core.test.mjs` and
  `test/automation-script-core.test.mjs` cover template/expression evaluation
  and script diagnostics, not scope derivation, so they are an unaffected
  regression check for this step, not overlapping coverage.
- The Step 5/9/10 Vite-SSR pattern
  (`test/effective-configuration.test.mjs:1-41`) is the only proven way to
  execute `client/configuration/**` and `client/storage/**` under
  `node --test`; it coexists in one test file with plain Node ESM imports of
  legacy `public/js/**` modules, since those need no transform.

## Must-haves

- [MH1] The compatibility boundary never crosses as a static import. Acceptance:
  no file under `public/js/**` (including the new compat module) contains an
  `import` of anything under `client/**`; `public/js/session-compat/configuration.js`
  has zero cross-boundary imports, verified by grep in the test file itself.
- [MH2] With the compatibility bridge uninstalled (its state for every current
  production user), every adapted manager's exported behavior is unchanged.
  Acceptance: `test/alias-expression-core.test.mjs` and
  `test/automation-script-core.test.mjs` pass unmodified; new fixtures
  exercise `getScopeSnapshot`/`saveScope`/`find*`/`upsert*`/`remove*`/
  `setEnabled*`/`toggleEnabled*` on all three managers and the key-mapping
  editor path with the bridge uninstalled, asserting identical results and
  identical `localStorage` shape to today's implementation.
- [MH3] With the bridge installed, no adapted code path reads
  `dom.host`/`dom.port`/`dom.protocolSelect`. Acceptance: a fixture replaces
  `dom` with an object whose relevant getters throw, installs the bridge, and
  exercises every adapted entry point without triggering a throw.
- [MH4] Reads reflect the frozen local-over-shared-over-builtin precedence
  with correct provenance. Acceptance: a fixture with one shared alias/
  highlight/function/key-mapping set plus a local override of the same
  identity resolves to the local payload with `source.kind === 'local'`; a
  shared-only entry resolves with `source.kind === 'shared-set'` and the
  correct `configSetId`/`revision`; the compatibility API exposes this
  `source` alongside every effective definition it returns.
- [MH5] Local writes never touch shared configuration sets and notify only
  the owning character. Acceptance: `client/configuration/service.ts`'s new
  local-write function commits a change to one character's
  `localDefinitions[kind]` with zero mutation of `configurationSets`; a
  fixture with two subscribed characters proves only the edited character's
  listener fires; `saveScope`'s bulk-replace semantics and each manager's
  per-item upsert/remove/enable/disable all route through this same function.
- [MH6] Same-server, different-character isolation holds through the adapted
  managers, not just through the underlying service. Acceptance: a fixture
  installs the bridge for character A on a server, writes a local alias,
  swaps the installed bridge to character B on the *same* server profile, and
  proves `matchAlias`/`getScopeSnapshot` for B never observes A's edit -
  matching Step 5's own cross-session isolation precedent applied through the
  manager's public API instead of the service directly.
- [MH7] Automation variables stay out of the definition model. Acceptance: no
  payload passed to the new local-write function or to
  `publishConfigurationSet` ever contains a `variables` key;
  `getVariable`/`setVariable`/`removeVariable`/`getAutomationVariables`/
  `listVariableNames` keep their current persisted-per-scope behavior,
  re-keyed only by whatever scope-key value `getActiveScopeKey()` now
  dispatches to.
- [MH8] Key mappings gain stable per-character identity without breaking
  `input.js`'s read contract. Acceptance: `settingsManager.get('keyMappings')`
  keeps returning a plain array of `{code, label, legacyKey, command}`-shaped
  objects regardless of bridge state; with the bridge installed, that array
  is derived from the active character's effective `keyMappings` snapshot;
  the key-mapper editor synthesizes a stable `id` once per row and reuses it
  across repeated saves (a fixture saves twice and asserts the `id`s did not
  change).

## Out of scope

- Any edit to `client/app/bootstrap.ts` or any other live boot-path file.
  This step never installs the compatibility bridge anywhere reachable by a
  real browser session; only `test/session-definition-adapters.test.mjs`
  installs it. Installing it for real - which requires migration to have run
  and an active character to be resolved - is explicitly Step 13's job
  (Evidence above, Step 10's own Out-of-scope).
- `trigger-manager.js` and `timer-manager.js`. Both carry runtime execution
  state (cooldowns, match state, timer handles) alongside their definitions,
  which is Step 12's "isolate trigger/timer execution" scope, not this step's
  pure-definition scope. Adapting their definition storage without their
  execution state would split one manager's concerns across two steps for no
  benefit.
- Moving automation variables or GMCP variables into the Step 3 domain model
  or into session-owned runtime state. They remain exactly where they are
  today (persisted, per-scope key/value bags); only the scope-key value
  changes. Formalizing them as session-scoped runtime state is Step 12's job.
- Any settings-UI visual or workflow change beyond what the bridge/fallback
  branch requires internally. Shared-set attach/duplicate/detach UI remains
  Phase 3 scope per the master plan.
- Non-`keyMappings` settings (`autoReconnect`, theme, background, visual
  effects, and the rest of `_defaults`). Only the key-mapping portions of
  `settings-manager.js` are touched, per the master plan's own file scoping.
- A generic/reusable "definition adapter" abstraction shared across all four
  kinds. Each manager keeps its own bridge calls inline; the shared surface
  is the compatibility module's functions, not a new manager base class.

## Assumptions

- [The compatibility bridge is a runtime-installed plain-JavaScript object
  reference (default `null`/uninstalled), never a static `import` from
  `public/js/**` into `client/**`, because a real build plus
  `lib/client-artifact.js`'s public-parity check prove the latter 404s in
  production] - if false: `client/app/bootstrap.ts` would need to become part
  of this step's file list to install a global before any legacy import runs,
  which reopens the boot-path-sequencing boundary Step 10 explicitly reserved
  to Step 13 and would need its own review of migration-readiness ordering.
- [Every adapted manager keeps a complete, byte-behavior-identical fallback
  implementation for when the bridge is uninstalled, rather than a bridge
  that degrades gracefully by returning empty/default data] - if false: every
  current production user would see empty aliases/highlights/functions/key
  mappings the moment this PR ships, since no live session has a migrated
  Phase 1 graph yet (Evidence: zero `migrateLegacyData` callers).
- [`client/configuration/service.ts` may gain one new exported local-write
  function in this step (extending, not reopening, Step 5's resolve/snapshot
  logic), rather than requiring a Step 5 follow-up step] - if false: this
  step must block on a separate Step 5 amendment before any local write can
  be implemented, since no existing function commits a character-scoped
  local-definitions change.
- [`getActiveScopeKey()`'s return value may silently change meaning (from a
  `protocol://host:port` string to whatever the installed bridge's active
  character identity is) as long as every internal and external caller
  (`settings-manager.js`'s scope-key-based event filtering) only ever
  compares it for equality, never parses it] - if false:
  `settings-manager.js`'s `dataSyncHandler` scope-key comparisons
  (`public/js/settings-manager.js:260-274`) need their own adaptation beyond
  the key-mapping portions this step already touches.
- [Key-mapping id synthesis reuses Step 4's own fallback convention
  (`keymap-${index + 1}` when no id is present, kept stable once assigned)
  rather than inventing a new id scheme] - if false: ids generated by this
  step's editor path and ids already migrated by Step 4 could diverge in
  format, though neither would break correctness since ids are never parsed,
  only compared for identity.

## Risks

- If a future reader assumes "read/write through the service" means this
  step activates live production behavior, someone could wire the bridge
  into `bootstrap.ts` before Step 13's migration sequencing exists, silently
  emptying every current user's aliases/highlights/functions/key mappings.
  Mitigation: this plan's Out-of-scope states the boundary explicitly and by
  name, and MH2's fixtures pin "bridge uninstalled" behavior as byte-identical
  to today's shipped code, making a premature activation a visible, testable
  regression rather than a silent one.
- Maintaining two parallel code paths (bridge-active vs. fallback) in every
  adapted method doubles the surface for behavioral drift between them.
  Mitigation: the fallback path is a verbatim copy of pre-Step-11 logic (no
  simplification or "while I'm here" changes), and MH2/MH3 each require a
  fixture for every adapted entry point in both states.
- Refactoring `client/configuration/service.ts`'s `notifySubscribers` to share
  logic with the new single-character notify path risks a regression in
  Step 5's own already-passing shared-set propagation tests. Mitigation:
  `test/effective-configuration.test.mjs` re-runs unmodified as part of this
  step's verify battery, and the shared notify helper is extracted, not
  rewritten, from the existing loop body.
- Key-mapping id synthesis could regenerate a fresh id on every save instead
  of reusing an existing one, silently churning identity across sessions
  (harmless for correctness since nothing parses ids today, but would make
  future provenance/diagnostics noisy). Mitigation: MH8's two-consecutive-saves
  fixture asserts id stability explicitly.
- A CustomEvent-based bridge (matching `darkwind:alias-data-changed` and
  siblings) was considered instead of a plain object with method calls, to
  stay closer to the existing notification idiom. Rejected: `matchAlias()`
  and the settings editor need synchronous return values (a player pressing
  Enter cannot wait on an event round-trip), so a directly callable bridge is
  required for reads; the bridge's `subscribe()` still layers on top of the
  existing CustomEvent convention for change notification, so this is an
  addition, not a divergence.

## Steps

### Step 1 - Extend the configuration service with a character-scoped local write

**Files:** `client/configuration/service.ts`

**Intent:** Add `replaceLocalDefinitions(storage, characterProfileId, kind,
definitions)`, matching `PublishConfigurationSetResult`'s discriminated-result
shape (`success:false` codes `'missing-state' | 'unknown-character' |
'validation-failed' | 'storage-failed'`). It calls `readState` itself
(never accepts a caller-supplied state, matching `publishConfigurationSet`'s
own CAS-safety precedent at `client/configuration/service.ts:89`), fails
through if the character is absent, replaces
`characterProfiles[characterProfileId].localDefinitions[kind]` with
`structuredClone(definitions)`, and commits via the existing `commit()`. On
success, extract a `notifyOneSubscriber(characterProfileId, state)` helper
from the existing `notifySubscribers` loop body
(`client/configuration/service.ts:144-162`) and call it for only the edited
character - `notifySubscribers` itself becomes a thin loop over that helper,
with zero behavior change for `publishConfigurationSet`'s own callers.

**Verify:**

```bash
node --test test/effective-configuration.test.mjs
npm run typecheck
npm run build
```

**Done when:** a local write for character A never mutates
`configurationSets` or character B's state; a two-subscriber fixture (A
subscribed, B subscribed, only A edited) shows exactly one notification, to
A; an unknown `characterProfileId` and a forced `commit` failure both leave
storage untouched and notify nobody; every existing
`test/effective-configuration.test.mjs` fixture still passes unmodified.

### Step 2 - Build the plain-JavaScript compatibility bridge

**Files:** `public/js/session-compat/configuration.js` (new)

**Intent:** Implement a module-local `let bridge = null;` plus
`installConfigurationCompatBridge(nextBridge)`,
`resetConfigurationCompatBridgeForTests()`, and `isConfigurationCompatActive()`.
Implement per-kind forwarding functions with no fallback logic of their own
(fallback stays inside each manager, per Step 3/4):
`getEffectiveDefinitions(kind)` (returns the bridge's
`EffectiveDefinition<T>[]`, source included), `getActiveCharacterProfileId()`,
`replaceLocalDefinitions(kind, definitions)`,
`upsertLocalDefinitionByIdentity(kind, definition)`,
`removeLocalDefinitionByIdentity(kind, identityKey)`,
`setLocalDefinitionEnabledByIdentity(kind, identityKey, enabled)`, and
`subscribe(listener)`. Document the expected bridge shape with a JSDoc
`@typedef` comment only - this file contains zero `import` statements beyond
its own `export`s, satisfying MH1 structurally, not just by convention.

**Verify:**

```bash
node --test test/session-definition-adapters.test.mjs
```

(bridge-wiring fixtures only at this point; manager fixtures land in Step 5)

**Done when:** installing then resetting the bridge atomically swaps
`isConfigurationCompatActive()`'s return value; every forwarding function
passes its arguments through unchanged to the installed bridge; calling a
forwarding function while uninstalled throws a clear, distinctly-named error
(never silently returns empty data, so a caller cannot mistake "uninstalled"
for "no definitions").

### Step 3 - Adapt alias-manager.js, highlight-manager.js, function-manager.js

**Files:** `public/js/alias-manager.js`, `highlight-manager.js`,
`function-manager.js`

**Intent:** Import the Step 2 compat module. Change `getActiveScopeKey()` in
each manager to a two-branch dispatcher: when
`isConfigurationCompatActive()`, return `getActiveCharacterProfileId()`;
otherwise, keep today's exact `dom.host`/`dom.port`/`dom.protocolSelect`
read (`public/js/alias-manager.js:288-295` and siblings) verbatim. At every
read entry point (`getScopeSnapshot`, `findAliasByTrigger`/`matchAlias`,
`findRuleByPattern`/`getCompiledRules`/`applyHighlightsToLines`,
`findFunctionById`/`findFunctionByName`), branch on the same flag: when
active, read via `getEffectiveDefinitions(kind)`, mapping
`EffectiveDefinition<T>[]` to the plain `T[]` shape each caller already
expects (add a parallel `*WithSource` reader alongside each, per MH4, rather
than changing the existing return shape); when inactive, keep the existing
`_ensureScope`/`this._data` read verbatim. At every write entry point
(`saveScope`, `upsertSimpleAlias`/`upsertSimpleRule`, `removeAliasByTrigger`/
`removeRuleByPattern`, `setEnabledById`/`setEnabledByTarget`/`toggleEnabled*`),
branch the same way: active calls `replaceLocalDefinitions`/
`upsertLocalDefinitionByIdentity`/`removeLocalDefinitionByIdentity`/
`setLocalDefinitionEnabledByIdentity` from Step 2; inactive keeps the
existing `this._data`/`localStorage` write verbatim. Leave
`alias-manager.js`'s `getVariable`/`setVariable`/`removeVariable`/
`getAutomationVariables`/`listVariableNames` untouched except for now calling
the dispatched `getActiveScopeKey()` (MH7) - no other line in that block
changes.

**Verify:**

```bash
node --test test/alias-expression-core.test.mjs test/automation-script-core.test.mjs test/session-definition-adapters.test.mjs
```

**Done when:** with the bridge uninstalled, every fixture produces output
identical to pre-step behavior; with the bridge installed (a fake bridge in
this step's own fixtures), no `dom` getter is touched (MH3); no
`AliasDefinition`/write payload contains a `variables` key (MH7).

### Step 4 - Adapt the key-mapping portions of settings-manager.js

**Files:** `public/js/settings-manager.js`

**Intent:** Add a `_resolveKeyMappings()` helper: when
`isConfigurationCompatActive()`, map `getEffectiveDefinitions('keyMappings')`
to the `{code, label, legacyKey, command}` shape `input.js` already expects
(dropping `id`/`enabled`/`source` at this boundary, since `input.js`'s
existing reader never used them); otherwise return `this._settings.keyMappings`
verbatim. Route `get('keyMappings')` through it. In the key-mapper editor's
draft path (`_normalizeKeyMappings`, `public/js/settings-manager.js:1192-1214`,
and its callers building `this._draftSettings.keyMappings`), synthesize a
stable `id` (reuse an existing row's `id` if the row already carries one from
a prior bridge-backed read; otherwise generate once, following Step 4
migration's `keymap-${index + 1}` fallback convention per Assumption 5) and
`enabled: true`. On save, when the bridge is active, call
`replaceLocalDefinitions('keyMappings', draftKeyMappings)` instead of writing
through `_applySettings`; when inactive, keep the existing
`_applySettings`/`SETTINGS_STORAGE_KEY` write verbatim.

**Verify:**

```bash
node --test test/session-definition-adapters.test.mjs
```

**Done when:** `input.js:704,706`'s two call sites need no change and keep
receiving the same shape regardless of bridge state; a fixture saves the
same draft key-mapping row twice with the bridge active and asserts the `id`
did not change between saves (MH8).

### Step 5 - Prove wiring, isolation, provenance, and production-safety

**Files:** `test/session-definition-adapters.test.mjs` (new),
`test/effective-configuration.test.mjs` (extended in Step 1)

**Intent:** Cover every Must-have. Use plain Node ESM imports (no Vite-SSR
runner needed) for the fallback-path and bridge-wiring fixtures, which only
touch `public/js/**` plus a hand-built fake bridge object - proving MH1
(grep the compat module's own source text for zero `client/**` imports),
MH2, MH3, MH7, and MH8. Use the Step 5/9/10 Vite-SSR pattern to additionally
import the real `client/configuration/**` and `client/storage/repository.ts`
alongside the legacy managers in the same file, constructing a real bridge
object backed by an in-memory `StorageLike` and a minimal two-character,
one-server `ApplicationStateV1` fixture (reusing
`test/effective-configuration.test.mjs`'s `buildMinimalGraph` pattern) -
proving MH4, MH5, and MH6 end-to-end through the managers' own public API,
not just through the service directly.

**Verify:**

```bash
node --test test/alias-expression-core.test.mjs test/automation-script-core.test.mjs test/session-definition-adapters.test.mjs test/effective-configuration.test.mjs
npm run format:check
npm run lint
npm run typecheck
npm run check
npm run build
npm run verify:bundle
npm run verify:client-artifact
git diff --check
```

**Done when:** every Must-have in this plan and every master-plan Step 11
Done-when condition
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:468-470`) has
a passing fixture; the full quality/build battery is green;
`npm run verify:client-artifact` (which includes the public-parity byte
check) passes, confirming the four adapted `public/js/**` files still ship
as exact source copies with no bundling side effect.

## Success criteria

- [ ] No `public/js/**` file, including the new compatibility module,
      contains a static import of anything under `client/**`.
- [ ] With the compatibility bridge uninstalled, every adapted manager's
      exported behavior is byte-identical to its pre-Step-11 implementation.
- [ ] With the bridge installed, no adapted code path reads
      `dom.host`/`dom.port`/`dom.protocolSelect`.
- [ ] Effective reads reflect local-over-shared-over-builtin precedence with
      correct, exposed provenance for every adapted kind.
- [ ] Local writes (bulk `saveScope` and per-item mutators) touch only the
      owning character's `localDefinitions` and notify only that character's
      subscribers.
- [ ] Two different characters on the same server profile never observe each
      other's local aliases/highlights/functions/key mappings through the
      adapted managers.
- [ ] Automation variables remain outside the definition model and keep their
      current persisted-per-scope behavior.
- [ ] Key mappings carry stable per-character identity without changing
      `input.js`'s read contract.
- [ ] The full quality/build battery, including `verify:client-artifact`'s
      byte-parity check, passes alongside the new and extended tests.

## Rollback

This step edits four already-shipped, live-imported production files, unlike
Steps 3-10's wholly new, zero-importer files - but the inert-by-default design
(Assumption 1-2) means production behavior is provably unchanged for the
entire time this step is merged and Step 13 has not yet shipped: the bridge
is installed nowhere reachable by a real browser session, so every user keeps
taking the verbatim fallback path. Reverting before Step 13 lands is a plain
revert of the four manager edits, the `client/configuration/service.ts`
addition, and deletion of `public/js/session-compat/configuration.js` plus
its test file - zero data impact, since this step's local-write function is
never called outside `node --test`. This step touches no persisted user data
and writes nothing new under `darkflow-session-core-v1` outside test
fixtures.

## Execution fit

- Scope: multi-run phase (one step within the ongoing Phase 1 program)
- Lead: Terra at high reasoning - the dual-path (bridge/fallback) design and
  the public/js-to-client/** boundary decision carry real production-safety
  consequences if reasoned about carelessly, even though the underlying
  Step 3/5 contracts this step composes are already frozen and well-tested
- Workers: none - the compat module, the three managers, and the
  settings-manager key-mapping edits share one design decision (the bridge
  shape and its uninstalled-fallback contract); splitting authorship risks
  one manager's fallback path silently drifting from the others'
- Delegation shape: solo
- Ownership: the lead owns the public/js-to-client/** boundary decision
  (Assumption 1), the inert-by-default production-safety guarantee
  (Assumption 2), the `service.ts` local-write extension (Assumption 3), and
  the go/no-go decision before Step 12 begins
- Replan trigger: Step 13's actual bootstrap sequencing reveals the bridge
  object's shape (Step 2) is insufficient for what `client/app/bootstrap.ts`
  needs to construct and hand off - for example if resolving the active
  character turns out to require a live subscription update mid-session
  rather than a one-time install; or `npm run verify:client-artifact` surfaces
  a public-parity violation this plan did not anticipate
- Confidence: medium - the isolation/precedence/notify logic reuses Step 5's
  already-proven engine directly, but the inert-by-default bridge design is
  this plan's own judgment call rather than something the master plan or an
  earlier step's plan already settled, so it carries more first-instance risk
  than a typical step in this series

Plan self-review: PASS (8/10)

Notes:

- The single highest-leverage finding in this plan is empirical, not
  theoretical: a real `npm run build` plus `lib/client-artifact.js`'s
  public-parity checker prove that `public/js/**` cannot statically import
  `client/**/*.ts`, which the master plan's own two-line Step 11 summary does
  not address. Every other design choice in this plan (the bridge shape, the
  inert-by-default fallback, deferring installation to Step 13) follows from
  that one constraint plus Step 10's existing reservation of boot-sequencing
  to Step 13.
- Skeptic-lens finding: "read/write through the service" in the master plan's
  Step 11 intent could be misread as requiring live production activation
  now. This plan deliberately does not do that, and states why in
  Out-of-scope and Assumption 2, specifically so a future reviewer does not
  mistake the inert design for an incomplete one.
- Architect-lens finding: `client/configuration/service.ts`'s
  `notifySubscribers` needed a single-character variant it did not have.
  Step 1 extracts a shared helper rather than duplicating the notify loop,
  keeping Step 5's original function and its passing tests intact.
- Creative-lens finding: a CustomEvent-based bridge (matching the existing
  `darkwind:*-data-changed` convention) was considered and rejected because
  `matchAlias()` needs a synchronous read; recorded here so a future reviewer
  does not re-propose it without re-deriving the synchronous-read constraint.
- This plan assumes Step 13 will extend the same
  `public/js/session-compat/configuration.js` module (calling
  `installConfigurationCompatBridge`) rather than replacing it, matching
  Step 13's own file list, which does not list this file again as "new."
  If Step 13's own planning finds the bridge shape insufficient, that is this
  plan's named replan trigger, not a sign this step was done incorrectly.
