# Phase 1 Step 5 Implementation Plan

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 - one bounded subsystem (`client/configuration/**`, four
  new files) with no public contract changes yet, built on already-frozen
  Step 3/4 contracts, using an established Typia/Vite-SSR test pattern; the
  CAS/atomicity and identity-normalization rules are judgment calls with a
  known resolution path rather than open unknowns
- Hard triggers: none - one deliverable, one phase-gate continuation, nothing
  wired into the boot path yet, no user-requested sequencing
- Current planning horizon: `client/configuration/identity.ts`, `snapshot.ts`,
  `resolve.ts`, `service.ts`, and `test/effective-configuration.test.mjs`,
  exactly as scoped by the master plan's Step 5 entry
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:325-341`)
- Evidence horizon: the frozen Step 3 domain/validator contracts, the Step 4
  storage repository, `docs/session-model.md`'s effective-configuration
  section, and every legacy manager's identity/normalization call site
  (`public/js/alias-manager.js`, `trigger-manager.js`, `highlight-manager.js`,
  `function-manager.js`, `timer-manager.js`, `settings-manager.js`)
- Adversarial review: focused - recommended before implementation begins,
  targeting the compare-and-swap atomicity design and the
  empty-built-in-tier assumption below, neither of which is decided in the
  master plan or proposal

The clarification gate is skipped for the same reason Steps 3 and 4 skipped
it: the product decision (deterministic precedence with provenance, atomic
whole-revision propagation) is already approved at the phase level
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:89-96`). This
plan resolves the remaining implementation-level ambiguities as documented
assumptions rather than open questions, because repository evidence is
sufficient to answer them.

## Goal

Give the Phase 1 domain graph a deterministic, provenance-tagged effective
configuration for each character profile, and a publish path that commits a
shared configuration-set revision exactly once and delivers one complete,
immutable snapshot to every attached subscriber - never a partial one.
Nothing built in this step is imported into the boot path or the legacy UI
yet; that is Steps 11 and 13.

## Evidence and constraints

- The frozen Step 3 contract already separates ordered shared-set references
  (`ConfigurationSetRefs`) from inline profile-local overrides
  (`LocalDefinitions`), both keyed by the same six `ConfigKind` values
  (`client/model/configuration.ts:174-220`), and defines
  `ConfigSourceMetadata` (`kind: 'builtin' | 'shared-set' | 'local'`,
  optional `configSetId`/`revision`) as the provenance shape this step must
  populate (`client/model/configuration.ts:203-210`).
- `docs/session-model.md:127-140` documents the precedence order this step
  implements: built-ins, then referenced sets in listed order, then
  profile-local entries last, with later definitions replacing earlier ones
  sharing the same manager-specific identity within a kind.
- `client/model/validators.ts`'s `validateApplicationState` already rejects
  dangling/cross-kind configuration-set references and non-positive revisions
  before any state reaches this step (`client/model/validators.ts:168-237,
  323-369`), so resolution can assume a graph-validated input rather than
  re-checking those invariants itself.
- `client/storage/repository.ts`'s `commit()` re-validates and performs
  exactly one `setItem` per call (`client/storage/repository.ts:50-70`); this
  step's publish path reuses that as its sole persistence write rather than
  inventing a second commit mechanism.
- No legacy manager ships default aliases, triggers, highlights, functions,
  key mappings, or timers: `alias-manager.js`, `trigger-manager.js`,
  `highlight-manager.js`, `function-manager.js`, and
  `settings-manager.js:127` (`keyMappings: []`) all start from empty
  collections. The "built-in" precedence tier therefore has no real content
  to migrate in Phase 1.
- Legacy identity/normalization rules differ per kind and must be replicated
  exactly, not approximated with one shared helper:
  - aliases: `normalizeWhitespace(trigger).toLowerCase()`
    (`public/js/alias-manager.js:17,364`)
  - triggers: `normalizeWhitespace(pattern)`, no case-folding
    (`public/js/trigger-manager.js:12,285`)
  - highlights: `patternSource.trim()` only, no whitespace collapse, no
    case-folding (`public/js/highlight-manager.js:472`)
  - functions: `normalizeWhitespace(name).toLowerCase()`
    (`public/js/function-manager.js:11,15-17`)
  - key mappings: `code.trim()`, case-sensitive
    (`public/js/settings-manager.js:1198-1201`)
  - timers: `normalizeWhitespace(name).toLowerCase()`
    (`public/js/timer-manager.js:18,258`)
- `gmcp.dispatch` isolates one throwing handler from starving later handlers
  today (`public/js/gmcp.js:71-109`), the precedent this step's subscriber
  notification must follow even though the shared Step 6 event-bus primitive
  that will formalize "snapshot subscribers before dispatch" does not exist
  yet (master plan Step 6 intent,
  `docs/plans/multi-connection-ui-phase-1-implementation-plan.md:343-353`).
- Step 6 (event envelopes) and Step 10 (`Session` composition, the real
  "attached live session") both come after this step in the dependency order
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:203-222`),
  so this step cannot subscribe real sessions; it needs its own minimal,
  later-replaceable subscription surface.
- The Step 3/Step 4 transformed-test pattern
  (`test/typia-transform-dev.test.mjs:19-36`,
  `docs/plans/multi-connection-ui-phase-1-step-4-implementation-plan.md:400-406`)
  is the only proven way to execute hoisted Typia validators under
  `node --test`, and `client/storage/repository.ts` already accepts an
  injected `StorageLike` for exactly this reason.
- `client/configuration/**` is not yet in the TypeScript include list, ESLint
  `scriptFiles` glob, or Prettier globs (`tsconfig.json:18-23`,
  `eslint.config.mjs:7-11`, `package.json:53-55`); Steps 3 and 4 each added
  their own directory the same way and this step must do the same.

## Must-haves

- [MH1] Effective-configuration precedence matches the documented order and
  exact legacy identity/normalization rules for all six kinds. Acceptance:
  built-ins (empty in Phase 1) resolve first, referenced shared sets resolve
  in `configSetRefs[kind]` listed order, profile-local definitions resolve
  last; within a kind, a later definition sharing the exact
  legacy-normalized identity replaces an earlier one's payload and
  provenance while keeping its first-seen array position.
- [MH2] Every effective definition carries accurate provenance. Acceptance:
  `ConfigSourceMetadata.kind` is `'builtin' | 'shared-set' | 'local'`;
  `configSetId`/`revision` are present and correct for `'shared-set'`
  entries and absent for `'builtin'`/`'local'` entries.
- [MH3] Effective snapshots are immutable and never alias mutable persisted
  objects. Acceptance: `freezeSnapshot` deep-freezes every array and
  definition object it returns; a mutation attempt on any returned array,
  definition, or nested `steps`/`style` object throws under strict mode or is
  a silent no-op, and never alters the underlying `ApplicationStateV1` or a
  previously delivered snapshot.
- [MH4] Shared-set publication is compare-and-swap and its only write is
  atomic. Acceptance: `publishConfigurationSet` re-reads current storage
  itself and accepts an `expectedRevision`; a mismatched revision or unknown
  `configSetId` returns a typed failure with zero storage writes and zero
  subscriber notifications; `repository.commit` is the sole persistence
  write, so a validation or storage failure there also yields zero
  notifications.
- [MH5] Every attached subscriber observes one complete revision, never a
  partial one. Acceptance: after a successful publish, every currently
  subscribed `characterProfileId` receives exactly one freshly resolved,
  frozen snapshot built from the newly committed state; a fixture with two
  subscribed characters (one referencing the changed set, one not) both
  receive a callback from the same commit, and a throwing listener does not
  prevent delivery to the remaining subscribers.
- [MH6] Resolution defends only against what the frozen graph contract does
  not already guarantee. Acceptance: `resolveEffectiveConfiguration` treats
  dangling/cross-kind config-set references as already excluded by
  `validateApplicationState`, and returns a typed failure (not a throw) only
  when the requested `characterProfileId` itself is missing from the state.

## Out of scope

- Wiring `service.ts` subscriptions to the real `Session`/event-bus
  primitives; Step 6 defines the shared event envelope and Step 10 composes
  the real `Session`, at which point subscription keying may move from
  `CharacterProfileId` to `SessionId`.
- Any UI for editing, attaching, duplicating, or detaching shared
  configuration sets (Phase 3 per the master plan's out-of-scope section,
  `docs/plans/multi-connection-ui-phase-1-implementation-plan.md:127-128`).
- Populating non-empty built-in default definitions; the built-in tier is a
  reserved, empty precedence layer in Phase 1 (see Evidence).
- Runtime execution state - timer handles, cooldowns, recursion guards,
  user/GMCP variables - which is Step 12 scope and explicitly excluded from
  `EffectiveConfigurationSnapshot`.
- Adapting `public/js/alias-manager.js` and its siblings to consume this
  service; that is Step 11.
- A temp-key/promoted-key persistence protocol beyond `repository.commit`'s
  single `setItem`; see Assumptions.

## Assumptions

- [`CharacterProfileId` is an adequate Phase 1 stand-in key for "attached
  live session" subscriptions, since Steps 6 and 10 have not landed yet] - if
  false: `service.ts`'s subscription surface must be rebuilt once
  `SessionId`/the event bus exist, and any test relying on character-keyed
  subscription must be revisited in Step 10.
- [The built-in precedence tier is legitimately empty for every one of the
  six kinds in Phase 1, since no legacy manager ships default aliases,
  triggers, highlights, functions, key mappings, or timers] - if false: this
  step must hardcode or import real default definitions instead of an empty
  constant, changing MH1's acceptance fixtures.
- [`resolveEffectiveConfiguration` may assume its input state already passed
  `client/model/validators.ts`'s `validateApplicationState`, and therefore
  does not need to re-check dangling/cross-kind config-set references
  itself] - if false: `resolve.ts` must duplicate graph-validation logic,
  increasing scope and coupling risk to Step 3's frozen validators.
- [A shallow-copy-and-replace update to `configurationSets[configSetId]`
  inside `service.ts`, re-validated and persisted through
  `repository.commit`'s existing single `setItem`, is sufficient atomicity
  for this step's CAS requirement, without a separate temp-key/promoted-key
  protocol] - if false: this step needs the same recovery-marker protocol
  flagged as a master-plan assumption for Step 4
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:149-152`),
  expanding this step's scope into persistence-layer changes.

## Risks

- A subscriber list captured by reference during notification could let a
  listener's synchronous unsubscribe-during-notify skip or double-notify
  another subscriber. Mitigation: `service.ts` copies the subscriber
  collection into a plain array before iterating, applying the same rule
  Step 6 will later formalize as a shared primitive.
- The six kinds' identity-normalization rules are easy to blur into one
  shared helper and silently diverge from the legacy managers they must
  match. Mitigation: `identity.ts` implements one dedicated function per
  kind, each doc-commented with its exact source citation, and a fixture
  table asserts each kind's identity function against literal legacy input
  values.
- A CAS revision check silently no-ops if `expectedRevision` is compared
  against a caller-cached copy of the state rather than the true current
  storage contents. Mitigation: `publishConfigurationSet` always calls
  `repository.readState` itself rather than accepting a caller-supplied
  `ApplicationStateV1`, so the compare is always against the authoritative
  current revision.

## Steps

### Step 1 - Manager identity keys and quality-gate coverage

**Files:** `client/configuration/identity.ts` (new), `tsconfig.json`,
`eslint.config.mjs`, `package.json`

**Intent:** Implement one `normalizeWhitespace` helper and one dedicated
identity-key function per `ConfigKind`, replicating the exact legacy
normalization cited in Evidence (alias/function/timer identities lowercase
after whitespace collapse; trigger identity collapses whitespace without
case-folding; highlight/key-mapping identities trim only, case-sensitive).
Export an `identityKeyFor(kind, definition)` dispatcher used by `resolve.ts`.
Add `client/configuration/**/*.ts` to `tsconfig.json`'s `include`, the
`scriptFiles` glob in `eslint.config.mjs`, and the `lint`/`format`/
`format:check` globs in `package.json`, exactly as Steps 3 and 4 did for
their own directories.

**Verify:**

```bash
npm run typecheck
npm run lint
npm run format:check
```

**Done when:** each of the six identity functions matches its cited legacy
behavior against literal fixture values (for example alias trigger
`"  Go North "` to `"go north"`; highlight pattern `" ^You see "` to
`"^You see"`, trimmed but case-preserved); the new file passes every extended
quality gate.

### Step 2 - Effective snapshot shape and immutable built-in tier

**Files:** `client/configuration/snapshot.ts` (new)

**Intent:** Define `EffectiveDefinition<T>` (`{ definition: T; source:
ConfigSourceMetadata }`), `EffectiveConfigurationSnapshot` (`characterProfileId`
plus six ordered `EffectiveDefinition<...>[]` fields, one per kind), and
`freezeSnapshot(snapshot)`, which deep-freezes every array, definition
object, and nested `steps`/`style` object it returns. Define
`BUILTIN_DEFINITIONS`, a frozen, empty six-kind constant matching
`LocalDefinitions`'s shape, documented as Phase 1's reserved (currently
empty) built-in precedence tier per the Evidence section's grep-verified
absence of legacy defaults.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** `freezeSnapshot(...)` output throws under strict mode (or is a
silent no-op) on any attempted mutation of its returned arrays, definitions,
or nested objects; `BUILTIN_DEFINITIONS` contains zero definitions across all
six kinds.

### Step 3 - Precedence resolution

**Files:** `client/configuration/resolve.ts` (new)

**Intent:** Implement `resolveEffectiveConfiguration(state, characterProfileId):
ValidationResult<EffectiveConfigurationSnapshot>` as a pure function. For each
kind, build the ordered layer `BUILTIN_DEFINITIONS[kind]` (source
`{ kind: 'builtin' }`) followed by each `configSetRefs[kind]` entry's
`definitions` in listed order (source `{ kind: 'shared-set', configSetId,
revision }`) followed by `character.localDefinitions[kind]` (source
`{ kind: 'local' }`); reduce with a `Map` keyed by `identityKeyFor(kind, def)`
so a later entry overwrites an earlier one's payload/provenance while
retaining the earlier entry's array position. Return a typed failure only
when `characterProfileId` is absent from `state.characterProfiles`; otherwise
assume the graph-validation invariants from `client/model/validators.ts`
already hold. Return `freezeSnapshot(...)` on success.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** fixtures cover a same-identity override at each of the three
tiers (local-over-shared, shared-over-shared via reference order,
shared-over-builtin) and confirm both the winning payload/provenance and the
retained first-seen array position; a missing character profile returns a
typed failure rather than throwing.

### Step 4 - Publish service with compare-and-swap and subscriber notification

**Files:** `client/configuration/service.ts` (new)

**Intent:** Implement `subscribe(characterProfileId, listener): Unsubscribe`,
a Phase 1 stand-in registry for "attached live session" ahead of Step 6's
event bus and Step 10's real `Session`. Implement
`publishConfigurationSet(storage, { configSetId, expectedRevision,
definitions, label? })`: call `repository.readState` itself; return a typed
failure with zero writes for an unknown `configSetId` or a mismatched
`expectedRevision`; otherwise build the next `ApplicationStateV1` with that
set's `definitions` replaced and `revision` incremented by exactly one, and
call `repository.commit` as the sole write. Only on a successful commit,
copy the current subscriber collection into a plain array and, for each
subscribed `characterProfileId`, call `resolveEffectiveConfiguration` against
the newly committed state and deliver the frozen snapshot to that character's
listeners, catching and isolating a throwing listener so it cannot block
delivery to the next subscriber (mirroring `gmcp.dispatch`'s existing
per-handler isolation).

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** a stale `expectedRevision` and an unknown `configSetId` both
leave storage untouched and notify zero subscribers; a successful publish
notifies every currently subscribed character exactly once with a snapshot
built from the newly committed state; a throwing listener does not block
delivery to another subscribed character.

### Step 5 - Prove precedence, provenance, and propagation through transformed fixtures

**Files:** `test/effective-configuration.test.mjs` (new)

**Intent:** Follow the Step 3/Step 4 Vite-SSR pattern
(`test/typia-transform-dev.test.mjs:19-36`) to import
`/configuration/identity.ts`, `snapshot.ts`, `resolve.ts`, `service.ts`, and
`/storage/repository.ts` through `server.environments.ssr.runner.import`,
reusing the in-memory `StorageLike` mock pattern already proven for Step 4.
Cover: per-kind identity/normalization fixtures against literal legacy
values; three-tier precedence and same-identity override at each tier;
provenance correctness for every source kind; snapshot immutability; CAS
rejection for a stale revision and an unknown configuration set with zero
writes and zero notifications; the two-attached-session propagation case
(one subscribed character referencing the changed set, one not, both
notified from the same commit); and a throwing-listener isolation case.

**Verify:**

```bash
node --test test/effective-configuration.test.mjs
npm run format:check
npm run lint
npm run typecheck
npm run check
npm run build
npm run verify:bundle
git diff --check
```

**Done when:** every master-plan Step 5 "Done when" condition (order,
conflicts, provenance, immutable snapshots, stale revisions, failed
persistence, and two attached-session propagation tests all pass without
sharing runtime state) has a passing fixture, and the full quality/build
battery is green.

## Success criteria

- [ ] `client/configuration/**` is included in typecheck, lint, and format
      gates without widening the legacy `public/js/**` boundary.
- [ ] Every one of the six kinds resolves with built-ins first, referenced
      shared sets in listed order, then local definitions last, with correct
      provenance on every result.
- [ ] Every value returned by `freezeSnapshot` is immutable and never aliases
      a mutable persisted object.
- [ ] A stale or unknown-target publish call performs zero storage writes and
      zero subscriber notifications.
- [ ] A successful publish delivers exactly one frozen, freshly resolved
      snapshot to every currently attached subscriber from the same commit,
      and one throwing listener never blocks another subscriber.
- [ ] The full quality/build battery (`format:check`, `lint`, `typecheck`,
      `check`, `build`, `verify:bundle`) passes alongside the new test.

## Rollback

Nothing built in this step is imported into the boot path, the legacy UI, or
any other production module yet - `client/configuration/**` has no importers
until Steps 11 and 13. Reverting before then is a pure code deletion of
`client/configuration/**` and its test file, with zero runtime impact, since
no shipped build executes this code outside `node --test`. Because
`publishConfigurationSet` writes through the same `darkflow-session-core-v1`
key as Step 4's migration, no rollback here ever needs to touch or clean up
that key - it remains exactly as Step 4's own rollback policy already
describes.

## Execution fit

- Scope: multi-run phase (one step within the ongoing Phase 1 program)
- Lead: Terra at high reasoning - the Typia/Vite-SSR pattern is now
  established from Steps 3-4, but the CAS/atomicity design, six-kind
  identity-normalization precision, and subscriber-isolation semantics carry
  real correctness risk that benefits from careful reasoning
- Workers: none - `identity.ts`, `snapshot.ts`, `resolve.ts`, and
  `service.ts` form one tightly coupled precedence/atomicity design;
  splitting them risks divergent identity or provenance rules between files
- Delegation shape: solo
- Ownership: the lead owns resolution-order correctness, CAS atomicity,
  subscriber isolation, and the Step 5 go/no-go decision before Step 6
  begins
- Replan trigger: the `CharacterProfileId`-as-subscription-key stand-in
  proves incompatible with Step 6's event-envelope shape once built; the
  empty-built-in-tier assumption is rejected; or the shallow-copy CAS design
  proves insufficient once real quota/concurrent-write behavior is exercised
- Confidence: medium-high - identity normalization and the empty built-in
  tier are directly verified against legacy source; the CAS/subscription
  design is new judgment introduced by this plan rather than a decision
  already settled upstream

Plan self-review: PASS (8/10)

Notes:

- Run a focused adversarial pass (`plan-adversarial`) before implementation
  starts, specifically against the compare-and-swap atomicity design in Step
  4 and the empty-built-in-tier assumption - both are judgment calls this
  plan introduces rather than decisions already settled upstream, and a
  propagation bug here (a subscriber missing a revision, or observing a
  half-updated one) fails silently rather than loudly.
- The `CharacterProfileId`-keyed subscription registry is a deliberate,
  temporary stand-in. Record it explicitly in the Step 16 decision record so
  Step 10's real `Session`/`SessionId` wiring does not silently inherit it
  as a permanent design.
