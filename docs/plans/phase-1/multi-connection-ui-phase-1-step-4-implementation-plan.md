# Phase 1 Step 4 Implementation Plan

## Planning selection

- Mode: detailed implementation plan
- Complexity: 7/10 - one bounded storage subsystem, but it is the first
  data-mutating step in Phase 1 and carries real silent-misattribution risk
- Hard triggers: none - one deliverable, one phase-gate continuation, no
  user-requested sequencing; risk=2 requires an explicit rollback/go-no-go
  decision rather than a phase map
- Current planning horizon: `client/storage/schema.ts`, `legacy-keys.ts`,
  `config-validator.ts`, `repository.ts`, `legacy-migration.ts`, and their
  transformed test coverage, exactly as scoped by the master plan's Step 4
  entry (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:302-321`)
- Evidence horizon: the frozen Step 3 domain/validator contracts, every legacy
  local-storage key this step reads, the existing `/config.json` route and its
  client-side precedence logic, and the Step 3 Vite-SSR test pattern
- Adversarial review: focused - recommended before implementation begins,
  targeting the WorldKey-placeholder policy and active-scope precedence
  replication introduced below (neither is decided in the master plan or
  proposal)

The clarification gate is skipped for the same reason Step 3 skipped it: the
product decisions (versioned local document, reversible migration, one
provisional character per legacy endpoint) are already approved at the phase
level. This plan resolves the remaining implementation-level ambiguities as
documented assumptions rather than open questions, because repository
evidence and the frozen Step 3 contract are sufficient to answer them.

## Goal

Give the Phase 1 domain graph (`client/model/*.ts`) a versioned home in local
storage, and convert every existing legacy record into that graph exactly
once, without deleting, rewriting, or otherwise mutating a single legacy key.
After this step, `darkflow-session-core-v1` either does not exist, or contains
a fully validated `ApplicationStateV1` that a later step can read - nothing
in the browser runtime, UI, or boot path changes yet.

## Evidence and constraints

- The frozen Step 3 contract requires `ServerProfile.worldKey`
  (`client/model/profiles.ts:25`) as a non-optional, opaque, server-owned
  value that must not be derived from host/port
  (`docs/session-model.md:78-79`). No handshake has occurred at migration
  time, so this step cannot obtain a real world key; it must write a fixed,
  non-host/port-derived placeholder and record it as unconfirmed (see
  Assumptions).
- `ApplicationStateV1`, `ServerProfile`, `CharacterProfile`, and their
  structural/graph validators already exist and are frozen
  (`client/model/profiles.ts:18-73`, `client/model/validators.ts:75-111`).
  This step must not modify them; if a legacy value cannot fit the existing
  shape, that is a blocking finding for this plan, not a license to widen the
  schema in place.
- Legacy automation is scoped by a two-bucket key computed from the DOM
  protocol select, not from all four transport literals: `wss`/`telnets`
  collapse to `'wss://host:port'` and everything else collapses to
  `'ws://host:port'` (`public/js/alias-manager.js:288-295`,
  `public/js/timer-manager.js:210-216`). Host is lowercased and defaulted to
  `'default'`, port defaults to `'4242'`. Migrating a scope key therefore
  cannot recover which of the four real protocols originally produced it.
- The current boot sequence computes the active protocol/host/port from URL
  parameters, then the `'darkflow-protocol'` local-storage key, then
  `/config.json`, then a hardcoded default, entirely before any DOM value is
  read back out (`public/js/app.js:445-461`). This step must replicate that
  precedence as a pure function so migration can compute the same "active"
  scope key without a DOM.
- Command history, panel workspace layout, and sound settings are global
  today, not endpoint-scoped: `HISTORY_STORAGE_KEY`
  (`public/js/constants.js:6`), `PANEL_STORAGE_KEY`
  (`public/js/panel-manager.js:42,779`), and `SOUND_STORAGE_KEY`
  (`public/js/sound-manager.js:3`) are single top-level keys, not
  scope-keyed dictionaries. The frozen `CharacterProfile` model made these
  character-owned (`client/model/profiles.ts:55-58`), so exactly one migrated
  character profile must inherit them.
- `CharacterAudioControls` narrows sound to `ambient`/`combat`/`notification`
  (`client/model/profiles.ts:35-39`), while the legacy sound manager tracks
  eleven categories (`public/js/sound-manager.js:13-25`). The other eight
  categories have no home in the frozen model and must remain solely in the
  untouched legacy `darkwind-sound-settings` key.
- The theme key is the one `ApplicationDefaults` field with a legacy source:
  `settings.theme` inside `SETTINGS_STORAGE_KEY`
  (`public/js/settings-manager.js:142,890`, `'darkwind-client-settings'`).
- The existing settings-export/import path already merges five separate
  scope-keyed legacy stores plus panels/sound into one bundle
  (`public/js/settings-manager.js:760-848`), confirming that reading multiple
  independent legacy keys and reconciling them into one document is an
  established pattern in this codebase, not a novel operation.
- The Vite-SSR transformed-test pattern used by Step 3 is the only proven way
  to execute Typia-generated validators under `node --test`
  (`test/typia-transform-dev.test.mjs:19-36`); there is no existing
  `localStorage` shim for `node:test`, so the repository/migration code must
  accept an injected Web Storage-compatible object rather than assume a
  global `localStorage`.
- `client/storage/**` is not yet in the TypeScript include list, the ESLint
  script globs, or the Prettier globs (`tsconfig.json:18-23`,
  `package.json:53,55`); Step 3 added `client/model/**` the same way
  (`docs/plans/multi-connection-ui-phase-1-step-3-implementation-plan.md:219-221`)
  and this step must do the same for `client/storage/**`.
- Root `node --test` only discovers `test/*.test.js`/`test/*.test.mjs`
  (`package.json:22`), so a new `test/session-storage.test.mjs` at the top
  level is automatically included without touching the discovery boundary
  Step 1 fixed.

## Must-haves

- [MH1] Legacy data is read without mutation and normalized deterministically.
  Acceptance: no code path in this step calls `setItem`/`removeItem` on any
  legacy key; every distinct legacy automation scope key maps to exactly one
  `ServerProfile`/`CharacterProfile` pair; the two-bucket protocol collapse
  and active-scope precedence are replicated to match
  `public/js/app.js:445-461` for the documented URL/local-storage/config
  combinations.
- [MH2] The built graph is fully validated before any commit. Acceptance: the
  in-memory migration result passes `client/model/validators.ts`'s
  `validateApplicationState` before `repository.commit()` is ever called; a
  failing validation aborts with zero local-storage writes.
- [MH3] Persistence commit is atomic and quota-safe. Acceptance: exactly one
  `setItem` call commits `darkflow-session-core-v1`; a simulated storage
  write failure leaves no partial or corrupted key and surfaces as a typed
  failure; migration provenance is a separate, best-effort write that never
  blocks or is blocked by the main commit.
- [MH4] Migration is idempotent. Acceptance: a second run against an existing
  valid `darkflow-session-core-v1` key performs zero legacy reads and zero
  writes; a run with a missing or invalid Phase 1 key but unchanged legacy
  data re-migrates to the same result.
- [MH5] `/config.json` is validated at the storage boundary. Acceptance:
  `config-validator.ts` structurally rejects a malformed response and the
  active-scope computation falls back to the documented defaults rather than
  throwing.
- [MH6] Character-scoped legacy globals attach to exactly one profile.
  Acceptance: command history, the panel workspace envelope, and
  ambient/combat/notification audio settings are present only on the
  character profile matching the computed active scope key; every other
  migrated character profile has empty history, a default workspace
  snapshot, and default audio.
- [MH7] A corrupted individual legacy key never aborts the whole migration.
  Acceptance: a fixture with one unparsable manager key still produces a
  valid graph for every other legacy key, and the corrupted key is recorded
  in migration provenance rather than silently dropped.

## Out of scope

- IndexedDB or a general repository abstraction; a single versioned
  `localStorage` document remains sufficient per the master plan's assumption
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:145-148`).
- Reconciling `ServerProfile.worldKey` with a real server-supplied value.
  That requires a live handshake and belongs to the transport/session steps
  later in the dependency order (Steps 9-10).
- Recovering the true `telnet`/`telnets` distinction for non-active legacy
  scopes; the two-bucket legacy key cannot express it (see Assumptions).
- Any change to `public/js/*`, `client/app/bootstrap.ts`, or the boot path.
  Nothing built in this step is imported anywhere yet; that is Step 13.
- The eight sound categories outside ambient/combat/notification; they stay
  exclusively in the untouched legacy `darkwind-sound-settings` key.
- Effective-configuration precedence, shared-set revisions, or propagation
  (Step 5 of the master plan).
- Deleting, rewriting, or adding a cleanup tool for any legacy key.

## Assumptions

- [A fixed, non-host/port-derived placeholder `WorldKey` (for example
  `"legacy-migration:unconfirmed"`) is an acceptable provisional value for
  every migrated `ServerProfile` until a later transport/session step
  replaces it with the real server-supplied key] - if false: this step cannot
  create `ServerProfile` records at migration time at all, and the master
  plan's "server/provisional-character records" Step 4 scope
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:311`) must
  be renegotiated to defer server-profile creation to first connect.
- [Only the two-bucket `wss`/`ws` scope-key prefix is recoverable for
  non-active legacy scopes, so a migrated `ServerProfile.protocol` defaults to
  `'wss'` for a `'wss://'` bucket and `'ws'` for a `'ws://'` bucket, losing
  the `telnet`/`telnets` distinction for those profiles] - if false: those
  profiles show the wrong protocol until a user manually corrects them in a
  later phase's profile UI; record this as a known limitation in the Step 16
  decision record either way.
- [The active scope key can be fully recomputed at migration time from URL
  search parameters, the `'darkflow-protocol'` local-storage key, and a
  validated `/config.json` response, without any DOM read, and this
  reproduces `public/js/app.js:445-461`'s precedence exactly] - if false, the
  character profile chosen to inherit history/workspace/audio may not match
  what the user currently sees, and migration must accept an explicit active
  scope as an input rather than recomputing it.
- [Migration provenance is diagnostic-only and may live under a separate,
  non-`ApplicationStateV1` local-storage key without blocking or being
  blocked by the primary graph commit] - if false, provenance must be folded
  into the validated graph, which would require reopening the frozen Step 3
  schema.
- [An injected Web Storage-compatible interface (`getItem`/`setItem`/
  `removeItem`) is sufficient to test `repository.ts`/`legacy-migration.ts`
  under `node --test` without `jsdom`] - if false, this step's test file
  needs a browser-backed test environment, which changes its verify command
  and likely its file location relative to `e2e/`.

## Risks

- Precedence-replication drift: if the migration's recomputed active scope
  key diverges from `app.js`'s actual runtime precedence, history/workspace/
  audio silently attach to the wrong character. Mitigation: implement the
  precedence as one small pure function in `config-validator.ts`, cite the
  exact source lines in its doc comment, and cover it with fixtures built
  from literal URL/local-storage/config combinations rather than
  paraphrasing the logic from memory.
- Sound-category narrowing: only ambient/combat/notification map into
  `CharacterAudioControls`; a player relying on the other eight categories
  sees them absent from the new model. Mitigation: those settings remain
  fully intact and functional in the untouched legacy key/manager, since this
  step does not cut over the UI; record the narrowing explicitly in the Step
  16 decision record so it is a deliberate, tracked limitation.
- `QuotaExceededError` (or any storage failure) during the main graph write
  could leave the browser without a Phase 1 document while a stale
  provenance record implies completion. Mitigation: write order is always
  main graph key first, provenance second; only the main key's presence
  defines "migrated"; a provenance write failure is caught and ignored by
  `repository.commit()`'s return value.
- A malformed individual legacy key could abort the entire migration and
  block boot once Step 13 wires this in. Mitigation: catch parse/validation
  errors per legacy key inside `legacy-migration.ts`, record them in
  provenance's skipped-key list, and continue migrating everything else -
  mirroring the existing per-manager catch/warn/default behavior already in
  `alias-manager.js:265-269`.

## Steps

### Step 1 - Storage schema, hoisted validators, legacy key inventory, and quality-gate coverage

**Files:** `client/storage/schema.ts` (new), `client/storage/validators.ts`
(new), `client/storage/legacy-keys.ts` (new), `tsconfig.json`,
`eslint.config.mjs`, `package.json`

**Intent:** Define `SESSION_CORE_STORAGE_KEY = 'darkflow-session-core-v1'`,
`SESSION_MIGRATION_PROVENANCE_KEY`, and a `MigrationProvenance` interface
(`schemaVersion`, `migratedAt`, `sourceScopeKeys`, `activeScopeKey`,
`skippedLegacyKeys: Array<{ key: string; reason: string }>`) in `schema.ts`.

In `validators.ts`, hoist this storage layer's own Typia factories at module
scope, matching `client/model/validators.ts`'s pattern
(`client/model/validators.ts:7-10`): `validateMigrationProvenance` /
`parseMigrationProvenance` for the new type above, plus a re-export of
`validateApplicationState`/`parseApplicationState` from
`client/model/validators.ts`. This keeps `repository.ts` and
`legacy-migration.ts` importing one storage-layer validators module instead
of reaching into `client/model` directly, and keeps every hoisted factory in
this step visible to the Vite/Typia transform from a single file.

In `legacy-keys.ts`, define one named constant per legacy key this step reads
(`darkwind-client-aliases-v1`, `-highlights-v1`, `-triggers-v1`, `-timers-v1`,
`-functions-v1`, `darkwind-panel-state`, `darkwind-cmd-history`,
`darkwind-sound-settings`, `darkwind-client-settings`,
`darkflow-protocol`), plus typed best-effort readers that catch parse errors
and return `undefined` rather than throwing, matching the existing
`try { JSON.parse(...) } catch { warn }` shape already used by every legacy
manager. These readers must never call `setItem`/`removeItem`.

Add `client/storage/**/*.ts` to `tsconfig.json`'s `include`, to the
`scriptFiles` glob in `eslint.config.mjs`, and to the `lint`/`format`/
`format:check` globs in `package.json`, exactly as Step 3 did for
`client/model/**`.

**Verify:**

```bash
npm run typecheck
npm run lint
npm run format:check
```

**Done when:** every legacy key string used later in this step exists in
exactly one place, a reader for a legacy key never calls
`localStorage.setItem`/`removeItem` even internally, and the new files are
covered by every existing quality gate.

### Step 2 - Validate `/config.json` and replicate active-scope precedence

**Files:** `client/storage/config-validator.ts` (new)

**Intent:** Hoist a Typia factory validating the `/config.json` shape
(`{ host: string; port: number; wss: boolean; gameName: string; hiddenPanels:
string[] }`, matching `server.js:63-73`) as a module-scope
`createValidate`/`createValidateParse` pair, following the same hoisting rule
already used in `client/model/validators.ts:7-10`.

Export a pure `computeActiveScopeKey(input)` function that takes injected
`urlSearchParams`, `protocolOverride` (the `'darkflow-protocol'` value), and
a validated config object, and reproduces `public/js/app.js:445-461`'s exact
precedence (URL `type` > URL `wss` > `protocolOverride` > `config.wss` >
default `'wss'`; host from URL `host` > `config.host` > `''`; port from URL
`port` > `config.port` > `'4242'`), then collapses the resolved protocol to
the two-bucket `'wss://host:port'` / `'ws://host:port'` form using the exact
rule from `public/js/alias-manager.js:288-295`. Accept injected inputs only;
do not read `window.location`, `localStorage`, or `fetch` directly, so the
function stays pure and independently testable.

**Verify:**

```bash
npm run typecheck
```

**Done when:** a malformed `/config.json` payload fails structural
validation with a stable error shape, and `computeActiveScopeKey` returns the
same scope key `public/js/app.js` would have produced for every documented
URL/local-storage/config combination in this step's fixtures.

### Step 3 - Repository: versioned read/write over an injected storage

**Files:** `client/storage/repository.ts` (new)

**Intent:** Define a small `StorageLike` interface (`getItem`/`setItem`/
`removeItem`) and accept it as a constructor/factory argument rather than
assuming the global `localStorage`, so production code can pass
`window.localStorage` while tests inject an in-memory implementation.

Expose:
- `readState(storage): ValidationResult<ApplicationStateV1>` - reads
  `SESSION_CORE_STORAGE_KEY` and runs it through this step's
  `client/storage/validators.ts` re-export of `parseApplicationState`.
- `hasValidState(storage): boolean` - `true` only when `readState` succeeds.
- `commit(storage, state: ApplicationStateV1): CommitResult` - re-validates
  `state` via `client/storage/validators.ts` (never trust an
  already-validated caller), then performs exactly one `setItem` call;
  catches any thrown error (quota, private-mode, serialization) and returns
  a typed failure without a second attempt or a partial write.
- `writeProvenance(storage, provenance: MigrationProvenance): void` - runs
  `provenance` through `validateMigrationProvenance` from
  `client/storage/validators.ts`, then attempts a best-effort `setItem`
  under `SESSION_MIGRATION_PROVENANCE_KEY` that catches and swallows any
  error; it must never throw and its outcome must never affect `commit`'s
  return value.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** `commit` never calls `setItem` with data that failed its own
re-validation, a storage mock that throws on `setItem` surfaces as a typed
`CommitResult` failure with no key written, and a `writeProvenance` failure
is fully swallowed.

### Step 4 - Legacy migration

**Files:** `client/storage/legacy-migration.ts` (new)

**Intent:** Implement `migrateLegacyData(storage, configJson, urlSearchParams,
uuidFactory)`:

1. If `repository.hasValidState(storage)` is `true`, return immediately
   without reading any legacy key (idempotent no-op).
2. Read every legacy automation key via `legacy-keys.ts`; union the distinct
   scope keys present across aliases/triggers/highlights/functions/timers
   (key mappings currently live inside `darkwind-client-settings`, not a
   scoped key - confirm during implementation and fold them into the active
   character's local definitions only, since they are not scope-keyed
   today).
3. For each distinct scope key, create one `ServerProfile` (protocol
   defaulted from the two-bucket collapse, host/port parsed from the scope
   key, the fixed placeholder `WorldKey`) and one `CharacterProfile`
   referencing it, with that scope's aliases/triggers/highlights/functions/
   timers copied into `localDefinitions` (not shared configuration sets -
   shared-set creation is not part of this step).
4. Compute the active scope key via `config-validator.ts`'s
   `computeActiveScopeKey`. If it matches one of the migrated character
   profiles, attach `commandHistory`, the parsed panel-workspace envelope
   (as an opaque `WorkspaceSnapshot`), and the ambient/combat/notification
   subset of the sound settings to that profile only. If it matches no
   migrated profile (for example a fresh install with legacy data from a
   different endpoint, or no legacy scopes at all), still create a
   `ServerProfile`/`CharacterProfile` pair for the active scope key so the
   globals have a home.
5. Set `ApplicationDefaults.themeKey` from `darkwind-client-settings`'s
   `theme` field, defaulting per the existing `DEFAULT_THEME_KEY` fallback
   rule if absent or non-string.
6. Validate the assembled graph with `client/storage/validators.ts`'s
   re-exported `validateApplicationState`. On failure, return a typed failure with zero
   writes. On success, call `repository.commit`, then build and write a
   `MigrationProvenance` record (source scope keys, active scope key, and
   any per-key parse/validation failures collected in step 2-3, each
   recorded rather than silently dropped) via `repository.writeProvenance`.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** zero `ServerProfile.worldKey` values are derived from host or
port, exactly one character profile in a multi-scope fixture carries the
non-empty history/workspace/audio, a corrupted single legacy key is recorded
in provenance without aborting migration of the rest, and `commit` is never
reached with an unvalidated graph.

### Step 5 - Prove migration through transformed fixtures

**Files:** `test/session-storage.test.mjs` (new),
`test/fixtures/session-migration/**` (new)

**Intent:** Follow the Step 3 Vite-SSR pattern
(`test/typia-transform-dev.test.mjs:19-36`) to import
`/storage/schema.ts`, `/storage/legacy-keys.ts`, `/storage/config-validator.ts`,
`/storage/repository.ts`, and `/storage/legacy-migration.ts` through
`server.environments.ssr.runner.import`. Implement one small in-memory
`StorageLike` mock local to the test file - no `jsdom`, matching this step's
injected-storage design.

Add fixture JSON files under `test/fixtures/session-migration/` for:

- a single-scope legacy install;
- a multi-scope legacy install, asserting only the active-scope character
  profile carries history/workspace/audio;
- a fresh install with zero legacy keys present;
- a legacy install where one manager's key is corrupted JSON (asserts
  MH7 and checks the resulting provenance entry);
- a partially populated legacy install (aliases present, timers absent);
- a pre-existing valid `darkflow-session-core-v1` key (asserts the
  idempotent no-op path reads no legacy keys - assert via a storage spy);
- a storage mock whose `setItem` throws only for the main graph key
  (quota-failure case), asserting no key is written and no exception
  escapes `migrateLegacyData`.

After every fixture run, assert every legacy key's stored value is
byte-for-byte identical to its pre-migration value.

**Verify:**

```bash
node --test test/session-storage.test.mjs
npm run format:check
npm run lint
npm run typecheck
npm run check
npm run build
npm run verify:bundle
git diff --check
```

**Done when:** every master-plan Step 4 "Done when" condition (clean,
repeated, malformed, partial, quota-failure, and interrupted migration
fixtures behave deterministically; only a fully validated graph is
committed; a second startup is a no-op; the old client can still read all
legacy records after rollback) has a passing fixture, and the full
quality/build battery is green.

## Success criteria

- [ ] `client/storage/**` is included in typecheck, lint, and format gates
      without widening the legacy `public/js/**` boundary.
- [ ] No fixture or code path in this step ever calls `setItem` or
      `removeItem` on a legacy key.
- [ ] A malformed or partial legacy install still produces the largest valid
      subgraph possible, with every skipped item recorded in provenance.
- [ ] Exactly one character profile inherits command history, workspace
      layout, and ambient/combat/notification audio per migration run.
- [ ] A second migration run against an already-migrated browser performs
      zero legacy reads and zero writes.
- [ ] A simulated quota/storage failure leaves no partial `darkflow-session-
      core-v1` key.
- [ ] The full quality/build battery (`format:check`, `lint`, `typecheck`,
      `check`, `build`, `verify:bundle`) passes alongside the new test.

## Rollback

This is the first data-mutating step in Phase 1, but nothing built here is
imported into the boot path until Step 13. Reverting before Step 13 lands is
a pure code deletion of `client/storage/**`, its test, and its fixtures, with
zero runtime impact, since no shipped build ever executes this code outside
`node --test`.

If a later environment has already gone through Step 13's cutover (out of
this step's scope) and needs to roll back, serving the pre-Step-4 built
client continues to work unmodified, because every legacy key remains
untouched and readable. Do not add automatic cleanup of
`darkflow-session-core-v1` or the provenance key during rollback; either may
contain later user edits from Steps 5-12. If an explicit cleanup tool is
ever needed, it must export the Phase 1 document first and require direct
user action, per the master plan's rollback policy
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:571-573`).

## Execution fit

- Scope: multi-run phase (one step within the ongoing Phase 1 program)
- Lead: Terra at high reasoning - the active-scope precedence replication and
  the WorldKey-placeholder policy are subtle boundary decisions with real
  silent-misattribution risk, but the injected-storage/Typia/Vite-SSR pattern
  is now well established from Step 3
- Workers: none - `repository.ts`, `legacy-migration.ts`, and
  `config-validator.ts` share tight ownership of one scope-key computation;
  splitting them risks divergent precedence logic between files
- Delegation shape: solo
- Ownership: the lead owns migration correctness, fixture coverage, and the
  Step 4 go/no-go decision before Step 5 (effective configuration) begins
- Replan trigger: the WorldKey-placeholder assumption is rejected (forces
  deferring `ServerProfile` creation to a connect-time step); the
  active-scope precedence replication cannot be made to match `app.js` in a
  documented case; or quota-failure handling turns out to need a temp-key/
  promoted-key protocol beyond a single `setItem` call
- Confidence: medium - legacy shapes and the frozen Step 3 contract are
  directly verified in this plan, but the WorldKey-placeholder and
  protocol-bucket-collapse policies are judgment calls introduced by this
  plan rather than decisions already made in the master plan or proposal

Plan self-review: PASS (8/10)

Notes:

- Run a focused adversarial pass (`plan-adversarial`) before implementation
  starts, specifically against the WorldKey-placeholder policy and the
  active-scope precedence replication in Steps 2 and 4 - both are new
  judgment calls this plan introduces rather than decisions already settled
  upstream, and a migration bug here fails silently (wrong character gets
  the settings) rather than loudly.
- Key mappings currently live inside the global settings blob rather than a
  scope-keyed manager; Step 4's Step 4 (legacy migration) flags this for
  confirmation during implementation rather than asserting it as verified
  evidence, since it was not independently traced to a specific line range
  in this planning pass.
- The eight non-modeled sound categories are a deliberate, tracked scope
  narrowing, not an oversight; they remain fully functional through the
  untouched legacy key until a later phase decides whether to extend
  `CharacterAudioControls`.
