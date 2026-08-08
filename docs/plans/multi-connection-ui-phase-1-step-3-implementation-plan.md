# Phase 1 Step 3 Implementation Plan

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 - one bounded domain-contract slice with several downstream
  identity and validation boundaries, but no persistence or runtime cutover
- Hard triggers: none
- Current planning horizon: define the Phase 1 identity, profile,
  configuration-set, application-state, and session-registry contracts and
  prove their transformed validators; do not implement storage or live runtime
- Evidence horizon: the Phase 1 overview and proposal, Step 2's Typia/build
  contract, current endpoint-scoped legacy data, and the existing Vite SSR test
  pattern
- Adversarial review: focused - the contracts determine the shape of Steps 4,
  5, and 10, so identity leakage and incomplete graph validation need to be
  removed before implementation

_Plan stress-tested via focused adversarial review. 4 findings surfaced, 4
survived in the revised constraints._

The clarification gate is skipped. The product decisions for identity
ownership, shared configuration, and one live session per character are already
approved in the proposal; this plan makes the next bounded contract slice
executable.

## Goal

Define a versioned, JSON-safe Phase 1 domain graph that gives later persistence,
effective-configuration, and `Session` work one stable ownership contract. A
valid graph must distinguish server, character, shared-configuration, and
ephemeral-session identities; preserve a server-owned world key; keep
character-owned data separate from runtime state; and report malformed or
cross-collection references with structured diagnostics. This step changes no
user data, browser runtime, transport, GMCP behavior, or visible UI.

The target contract is the one named by the overview Step 3
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:277-295`) and
the proposal's identity table and one-live-session rule
(`docs/plans/multi-connection-ui-proposal.md:122-140`).

## Evidence and constraints

- The proposal assigns endpoint and world reference to a server profile,
  history/layout/audio to a character profile, reusable definitions to a
  configuration set, and socket/reconnect/GMCP/runtime state to an ephemeral
  session (`docs/plans/multi-connection-ui-proposal.md:122-129`). A character
  may have one live session while different characters may share one server
  profile (`docs/plans/multi-connection-ui-proposal.md:132-136`).
- Shared sets contain exactly one of six definition kinds, character profiles
  keep ordered references by kind plus local entries, and runtime execution
  state is explicitly excluded from shared definitions
  (`docs/plans/multi-connection-ui-proposal.md:142-166`).
- The validator policy requires hoisted Typia factories in plain `.ts` modules,
  validation at the boundary, forward-compatible unknown keys where appropriate,
  and no untransformed factory call at runtime
  (`docs/plans/multi-connection-ui-proposal.md:194-216`). The existing Phase 0
  validator module is the local pattern (`client/phase0/gmcp-validators.ts:1-5`),
  and the existing Vite SSR test shows how a `.mjs` test imports transformed
  TypeScript without importing raw `.ts` through Node
  (`test/typia-transform-dev.test.mjs:19-36`).
- Step 2 places production TypeScript under the transformed Vite/Typia root,
  but its quality globs currently target `client/app/**` while the repository
  `tsconfig` includes only `client/app/**` and `client/phase0/**`
  (`docs/plans/multi-connection-ui-phase-1-step-2-implementation-plan.md:107-110`,
  `tsconfig.json:18-23`, `package.json:53-55`). Step 3 must add `client/model/**`
  to the same typecheck, lint, and format gates.
- The current client offers exactly `wss`, `ws`, `telnets`, and `telnet`
  (`client/index.html:72-76`). Existing aliases and timers scope persisted
  definitions from protocol, host, and port DOM fields
  (`public/js/alias-manager.js:255-294`, `public/js/timer-manager.js:173-215`),
  while command history and panel layout use global records
  (`public/js/constants.js:1-7`, `public/js/input.js:752-781`,
  `public/js/panel-defs.js:56`, `public/js/panel-manager.js:776-784`). Step 3
  defines the replacement ownership model without changing those legacy
  records.
- The current map layer normalizes a client-derived endpoint slug
  (`public/js/map-data-v2.js:187-199`). The new `WorldKey` must be an opaque,
  validated server-owned value; it must not silently derive identity from
  host/port. The actual map-data migration remains out of scope.

## Must-haves

- [MH1] Scoped IDs are nominally distinct at compile time and UUID-validated at
  runtime. Acceptance: `ServerProfileId`, `CharacterProfileId`, `ConfigSetId`,
  and `SessionId` cannot be assigned interchangeably in TypeScript; malformed
  UUID strings fail validation; test fixtures inject a deterministic UUID
  factory rather than calling `crypto.randomUUID()`.
- [MH2] The persisted graph has one explicit schema version and separate
  collections for application defaults, server profiles, character profiles,
  and configuration sets. Acceptance: valid graphs round-trip through JSON;
  schema versions other than `1` fail with a structured issue; collection keys
  must equal each record's branded `id`.
- [MH3] Profile ownership is explicit. Acceptance: a character references one
  server profile, ordered configuration-set references are grouped by the six
  exact kinds, history/layout/audio live on the character profile, and no
  socket, timer handle, reconnect timer, GMCP variable, cooldown, or match
  state appears in the persisted or shared-definition contract.
- [MH4] Configuration sets are kind-safe and graph-safe. Acceptance: a set
  contains exactly one of aliases, triggers, highlights, functions, key
  mappings, or timers; a character reference must resolve to an existing set of
  the same kind; dangling, duplicate, and cross-kind references fail without
  partial success.
- [MH5] World and transport values have bounded contracts. Acceptance: invalid
  protocol literals, empty/invalid hosts, ports outside `1..65535`, and empty,
  control-character, or overlong world keys fail; a valid world key is retained
  exactly as supplied by the server-facing contract.
- [MH6] The session boundary is frozen without implementing a session. Acceptance:
  `SessionDescriptor` carries an ephemeral session ID plus server and character
  references, and `SessionRegistry` documents typed claim/release/lookup
  semantics with a typed duplicate-live-character error for Step 10 to
  implement.
- [MH7] Validation is transformed and diagnosable. Acceptance: all Typia
  factories are hoisted in `client/model/validators.ts`; the Vite SSR test
  executes them, graph checks add stable codes/paths, malformed input never
  throws from the normal validation API, and the existing build/sentinel gates
  remain green.

## Contract decisions

Domain graph diagrams:
[`../session-model.md`](../session-model.md).

| Scope             | Contract owns                                                                                                                                                                         | Contract does not own                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Application       | `schemaVersion: 1`, application defaults, optional default character profile                                                                                                          | sockets, active runtime objects, legacy storage keys                    |
| Server profile    | stable ID, `ws`/`wss`/`telnet`/`telnets`, host, port, display name, capabilities, `WorldKey`                                                                                          | character history, workspace state, automation execution                |
| Character profile | stable ID, server reference, label/optional server identity, ordered set references, local definitions, input history, workspace snapshot, ambient/combat/notification audio controls | socket, reconnect timers, GMCP variables, cooldowns, waits, match state |
| Configuration set | stable ID, one `ConfigKind`, label, positive revision, definitions only                                                                                                               | variables, timer handles, running state, trigger runtime state          |
| Runtime session   | ephemeral ID, server/character references, one-live-session registry contract                                                                                                         | persisted application graph, shared mutable definitions                 |
| World             | opaque validated server source key                                                                                                                                                    | client-generated endpoint identity or map records                       |

Use JSON-safe values for the workspace snapshot so Step 4 can preserve the
current versioned panel payload without making Step 3 a panel-schema migration.
The configuration union should preserve the current normalized identity-bearing
fields used by legacy managers: alias `trigger`, trigger `pattern`, highlight
`patternSource`, function/timer `name`, and key mapping `code`. Automation steps
are a discriminated, JSON-safe union; their execution state is not part of the
definition.

## Out of scope

- Writing `darkflow-session-core-v1`, reading or migrating local storage,
  validating `/config.json`, or adding repository/atomic-write behavior; those
  belong to Step 4.
- Resolving effective configuration, calculating manager-specific precedence,
  publishing revisions, or propagating snapshots to live sessions; those belong
  to Step 5.
- Implementing the event bus, resource scope, transport, reconnect, GMCP bus,
  live `Session`, or the actual session registry; those belong to Steps 6-10.
- Adapting `public/js/*`, changing endpoint-derived legacy scopes, moving
  history/layout/audio records, or adding profile/session UI.
- Modeling every panel-specific GMCP package or map record; those are later
  protocol and world-data work.
- Adding a production feature flag, changing the root shell, changing server or
  Electron contracts, or touching `darkwind-nextgen`.

## Assumptions

- [Step 2 has passed its required predecessor gate and the transformed root
  quality surface is available] - if false: do not begin this implementation;
  record the Step 2 failure and replan the dependency order.
- [The four current transport literals remain the Phase 1 profile protocol
  union] - if false: add an evidence step against the transport contract before
  freezing `ServerProfile`.
- [A world key can be represented as an opaque non-empty JSON string bounded to
  128 characters with no whitespace or control characters] - if false: inspect
  the authoritative server/map key grammar and change the `WorldKey` validator
  before Step 4 writes any profile.
- [Current normalized manager fields are sufficient for the Step 3 definition
  envelope, while detailed execution semantics remain in Steps 11-12] - if
  false: stop before implementation and split the missing definition family
  into a reviewed contract step rather than using `unknown` in the shared-set
  graph.
- [The session registry is intentionally an interface contract in this step]
  - if false: a separate runtime-ownership implementation must be planned after
    the event/resource primitives and before Step 10; do not smuggle a partial
    registry into the model files.

## Risks

- Typia may treat a nominal branded UUID intersection as a structural property
  rather than a UUID string. Mitigation: keep the runtime validator on a tagged
  UUID string, compile the factories through the repository Vite transform, and
  test every scope ID with valid and malformed strings before accepting the
  brand shape.
- Typia cannot prove that a reference points into the correct collection or
  that a character's server matches a session's server. Mitigation: run a
  deterministic post-structural graph validator, aggregate stable issue codes
  and paths, and include wrong-collection, dangling, and mismatched-parent
  fixtures.
- A broad JSON escape hatch could let runtime state leak into shared definitions.
  Mitigation: use discriminated definition types, keep workspace opacity limited
  to the explicitly versioned layout payload, and make runtime-only fields absent
  from all definition and profile interfaces.
- The world-key rule could accidentally recreate endpoint scoping under a new
  name. Mitigation: preserve the key exactly, reject only the documented
  unsafe forms, and add a test proving two endpoints can carry the same server
  world key without the validator rewriting it.
- New model files could pass `ttsc` but be omitted from lint/format or from the
  transformed test path. Mitigation: update the quality globs in the first step,
  import validators through Vite SSR, and run the full quality/build battery at
  the step gate.

## Steps

### Step 1 - Add the scoped identity/value foundation and quality coverage

**Files:** `client/model/ids.ts` (new), `tsconfig.json`, `eslint.config.mjs`,
`package.json`

**Intent:** Define the nominal UUID type machinery and the four scoped ID
aliases. Export a small injected `UuidFactory`/ID-construction helper for
profile builders and tests; production callers may later provide
`crypto.randomUUID`, but this step must not call it at module evaluation.
Keep the runtime UUID rule on the shared tagged string representation so
Typia validates the value while TypeScript prevents scope interchange.

Add `client/model/**/*.ts` to the existing TypeScript, ESLint, Prettier, and
format-check surfaces without broadening the legacy `public/js/**` boundary.
Do not add model code to the browser root yet.

**Verify:**

```bash
npm run typecheck
npm run lint
npm run format:check
```

**Done when:** a compile-only fixture can assign a server ID to a server
profile but not to a character/session field, deterministic test code can create
all four ID scopes from an injected factory, and every new file is covered by
the repository quality commands.

### Step 2 - Define configuration kinds, definitions, and ordered references

**Files:** `client/model/configuration.ts` (new)

**Intent:** Define the exact six-literal `ConfigKind` union and a discriminated
`ConfigurationSet` union whose `kind` selects its definition array. Preserve
the minimum normalized fields required by the legacy managers and future Step 5
identity resolution: aliases, triggers, highlights, functions, key mappings,
and timers. Define JSON-safe automation steps and shared `JsonValue` types,
but exclude variables, timer handles, cooldowns, waits, match state, and other
execution containers.

Define `ConfigurationSetRefs` as six ordered ID arrays, one per kind, plus the
character-local definitions container. References are IDs only; do not resolve
or mutate them here. Expose manager-neutral source metadata types for Step 5,
but do not implement precedence or revision publication in this step.

**Verify:**

```bash
npm run typecheck
```

**Done when:** TypeScript rejects a definition placed in the wrong kind, all
six set kinds can be constructed without `any`/`unknown` casts, and no runtime
execution field is required by a shared definition.

### Step 3 - Define profiles, application state, and the session boundary

**Files:** `client/model/profiles.ts` (new),
`client/model/session-contract.ts` (new)

**Intent:** Model `ApplicationStateV1` as one versioned JSON graph with
separate keyed collections for application defaults, server profiles,
character profiles, and configuration sets. Require collection keys to be
checked against record IDs by the validator, rather than relying on a caller to
maintain that invariant.

`ServerProfile` owns protocol, host, port, label, capabilities, and the opaque
`WorldKey`. `CharacterProfile` owns its server reference, label/optional
server-confirmed identity, ordered configuration references, local definitions,
bounded command history, an opaque versioned workspace snapshot, and separate
ambient/combat/notification audio controls. `ApplicationDefaults` remains
narrow: theme key plus an optional default character profile ID; do not put
session or character runtime state there.

In `session-contract.ts`, define `SessionDescriptor` and the `SessionRegistry`
interface consumed by Step 10: lookup by character profile, claim one live
session, release only the matching claim, and return/throw a typed
`DuplicateLiveSessionError` when a character is already claimed. Include the
server/character parent relationship in the descriptor contract. Do not add a
socket, timer, event bus, or registry implementation.

**Verify:**

```bash
npm run typecheck
```

**Done when:** two character profiles can type-safely point to one server
profile and one shared set, a session descriptor cannot omit its parent IDs,
and the registry interface makes the one-live-character rule explicit for Step
10 without introducing a runtime singleton.

### Step 4 - Hoist structural validators and add graph validation

**Files:** `client/model/validators.ts` (new)

**Intent:** Hoist, at module scope, the Typia factories for `ApplicationStateV1`,
`SessionDescriptor`, and the relevant configuration/profile unions. Add JSON
parse validation alongside object validation. The public graph validator must
first run the generated structural validator, then run deterministic graph
checks that Typia cannot express:

1. schema version is exactly `1`;
2. every map key equals its record's `id`;
3. character server references exist and point to a server collection;
4. application default character references exist;
5. every ordered configuration reference exists, is unique within its kind, and
   has the requested kind;
6. every session descriptor points to an existing character and to the same
   server that owns that character; and
7. world/protocol/host/port and positive revision constraints hold.

Return a non-throwing `ValidationResult` that retains Typia path/expected/value
failures and appends stable graph issue codes such as
`dangling-server-reference`, `cross-kind-config-reference`,
`collection-key-id-mismatch`, and `session-server-mismatch`. Keep unknown
forward-compatible object keys allowed where the contract is not explicitly
closed; never use `validateEquals` as a shortcut for graph validation.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** the generated factories are visible to the transform, the
normal validation API returns structured failures for both shape and graph
errors, and the build's existing Typia sentinel remains clean.

### Step 5 - Prove the model through transformed unit fixtures

**Files:** `test/session-model.test.mjs`

**Intent:** Follow the existing Vite SSR test pattern: create a middleware-mode
Vite server from `vite.config.ts`, import `/model/validators.ts` through the SSR
runner, and close the server with `t.after`. Keep the test deterministic with an
injected UUID factory and use plain JSON fixtures at the validation boundary.

Cover these cases:

- a valid graph with two character profiles on one server, all six set kinds,
  ordered shared references, local definitions, history/layout/audio data, and
  application defaults;
- JSON stringify/parse round-trip through the generated parser and graph
  validator;
- malformed UUIDs for each scope, invalid protocol/host/port, invalid world
  keys, invalid schema/revision values, and invalid enum kinds;
- dangling server/character/set references, collection-key mismatches,
  cross-kind set references, duplicate ordered references, and a session whose
  character belongs to another server;
- preservation of unknown forward-compatible fields where the chosen contract
  allows them; and
- the session descriptor/registry contract fixture, proving compile-time
  coverage while leaving duplicate-claim behavior to Step 10.

Do not import `client/model/*.ts` directly from Node. If a production-bundle
execution proof is needed because the model validators are not yet reachable
from the root entry, build a temporary Vite library entry with `ttsc()` inside
this test, import its generated chunk, and remove the temporary output in
`t.after`; do not add a production bootstrap side effect merely to exercise a
future contract.

**Verify:**

```bash
node --test test/session-model.test.mjs
npm run format:check
npm run lint
npm run typecheck
npm run check
npm run build
npm run verify:bundle
git diff --check
```

**Done when:** valid graphs round-trip; every required invalid fixture fails
with a stable path/code; transformed Typia validators execute in the test
runner; the root build and existing Phase 0 artifact checks remain green; and
no legacy source, storage key, or browser behavior changes.

## Success criteria

- [ ] `client/model/**` is included in typecheck, lint, and format gates without
      widening the legacy `public/js/**` boundary.
- [ ] Scoped UUID brands, protocol/world values, and versioned state types
      compile under strict TypeScript and are constructed through injected test
      factories.
- [ ] The profile/configuration graph expresses server -> character -> session
      ownership and six ordered configuration-set kinds without runtime-state
      leakage.
- [ ] Structural Typia validation plus post-validation graph checks reject
      malformed, dangling, cross-kind, and cross-server references with
      structured diagnostics.
- [ ] The Vite-transformed model validators execute in `node --test`, and the
      full format, lint, typecheck, Svelte check, build, bundle-sentinel, and
      diff checks pass.
- [ ] No local-storage key, legacy manager, transport, GMCP handler, server
      route, Electron package, or visible UI behavior changes in this step.

## Rollback

This step is contract-only and has no user-data or external-state mutation.
Revert the Step 3 documentation link, the new `client/model/**` files, the
model test, and the narrowly scoped quality-glob additions as one reviewable
unit. The previous Step 2 artifact remains deployable, and Step 4 must not begin
until the contract is green. If a later step has already consumed these types,
do not silently revise them in place; record the incompatibility and replan the
dependent step before changing the schema.

## Execution fit

- Scope: multi-run phase
- Lead: Sol at high reasoning - this is a downstream-facing identity and graph
  contract with architectural consequences even though the code volume is small
- Workers: none - the files are tightly coupled and shared type integration is
  safer under one owner
- Delegation shape: solo
- Ownership: lead owns the contract integration, transformed-test harness,
  final verification, and the Step 4 go/no-go decision
- Replan trigger: Step 2 is not green; Typia cannot transform the branded model;
  the authoritative world-key grammar differs from the bounded assumption; or
  a required legacy definition cannot be represented without an `unknown`
  escape hatch
- Confidence: medium - the repository and proposal establish the ownership
  rules, but the model has no existing production implementation and the
  world-key grammar is intentionally being kept opaque

Plan self-review: PASS (9/10)

Notes:

- Structural Typia validation and cross-record graph validation are deliberately
  separate; neither is allowed to masquerade as the other.
- The `SessionRegistry` is only a typed contract here. Its single-live-claim
  behavior is implemented and tested after the event/resource primitives in
  Step 10.
- The world key is preserved as a server-owned opaque value rather than copied
  from the current endpoint-derived map slug.
