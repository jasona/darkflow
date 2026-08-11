## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 — one documentation-and-verification Green PR freezes several already-implemented contracts and requires cross-runtime release evidence
- Hard triggers: none; the Phase 1 master plan already supplies the program map and makes Step 16 its final bounded gate
- Current planning horizon: Phase 1 Step 16 only—one-session parity evidence, interface freeze, compatibility-debt ownership, and the Phase 1 go/no-go decision
- Evidence horizon: the Step 15 disposal gate, exported Phase 1 contracts, temporary compatibility consumers, GMCP inventory, migration rollback, package scripts, and hosted CI jobs
- Adversarial review: focused — reject paper completion, weakened gates, stale inventories, and local-only evidence presented as clean-checkout or hosted-CI proof

_Ponytail full pass: add no runtime abstraction, duplicate test harness, generated API layer, or speculative Phase 2 code. Reuse the current tests and CI; a failure goes back to its owning step._

## Goal

Certify that the session-backed root preserves the current one-session client and disposes it cleanly across development, built web, Electron, Docker, transport, and MCP boundaries. Freeze the exact Phase 1 interfaces that Phase 2 may build against, assign every temporary facade and unmodeled GMCP package to a later-phase owner, and record a binary Phase 1 decision with reproducible evidence.

Step 16 changes documentation and verification evidence only. It marks Phase 1 complete only after all required gates pass from one clean candidate commit in hosted CI. A later documentation-only attestation commit may record those immutable results; any source, test, build, or workflow change invalidates the candidate and restarts the gate. If a gate exposes a product defect, stop Step 16, leave the decision `OPEN`, and return the smallest correction to the step that owns the failed contract.

## Evidence

- The master plan defines Step 16 as the complete clean-install/release-adjacent battery, interface freeze, compatibility-debt ledger, migration/rollback record, and final Phase 1 decision (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:556-573`).
- Phase 1 ends at single-session parity; Phase 2 owns the Svelte/workspace port, Phase 3 owns multi-connection behavior, and Phase 4 removes legacy paths and compatibility adapters (`docs/plans/multi-connection-ui-proposal.md:258-269`).
- The public `Session` surface is currently limited to stable identities, connection lifecycle, disposal, and read-only configuration/health/runtime snapshots (`client/runtime/session.ts:16-34`). Its factory handles expose GMCP, transport, scope, automation, event bus, diagnostics, and endpoint controls only to compatibility wiring, not as public `Session` API (`client/runtime/session-factory.ts:22-35`).
- Cross-session routing already has one immutable `{ sessionId, type, payload }` envelope, and the bus rejects wrong-session dispatch while isolating handler failures (`client/runtime/events.ts:3-16`, `client/runtime/event-bus.ts:68-111`).
- The persisted contract is one versioned graph containing server profiles, character profiles, and shared configuration sets (`client/model/profiles.ts:11-73`), committed under `darkflow-session-core-v1` only after whole-graph validation (`client/storage/schema.ts:1-8`, `client/storage/repository.ts:21-70`).
- Effective configuration is a deeply frozen six-kind snapshot with source metadata; shared-set publishing uses expected-revision comparison, one validated commit, then subscriber notification (`client/configuration/snapshot.ts:14-44`, `client/configuration/service.ts:25-52`, `client/configuration/service.ts:95-153`).
- The transport contract fixes the four protocols, endpoint/state/reconnect payloads, health snapshot, send semantics, and session-scoped lifecycle (`client/transport/types.ts:3-29`, `client/transport/types.ts:44-97`). The production Playwright transport gate exercises `ws`, `wss`, `telnet`, and `telnets` through public controls without live Darkwind traffic (`e2e/transports.spec.ts:33-62`, `e2e/transports.spec.ts:76-118`).
- The GMCP bus freezes the advertised support set and session-scoped dispatch/send surface (`client/gmcp/bus.ts:11-86`). Modeled validators are advisory for existing compatibility handlers: failures reach diagnostics without suppressing delivery. Modeled and pass-through package names are explicit code inventories (`client/gmcp/contracts/validators.ts:134-143`), while the planning inventory still defers explicit owners to Step 16 (`docs/plans/multi-connection-ui-phase-1-gmcp-inventory.md:137-146`).
- Session diagnostics cover every owned resource class (`client/runtime/diagnostics.ts:3-30`), and `ResourceScope` performs guarded, reverse-order, idempotent cleanup (`client/runtime/resource-scope.ts:8-17`, `client/runtime/resource-scope.ts:169-223`). The real-browser Step 15 gate runs 25 connect/disconnect/double-dispose cycles and requires zero resources, sockets, late sends, late DOM mutations, and page errors (`e2e/session-disposal.spec.ts:4-14`, `e2e/session-disposal.spec.ts:26-145`).
- Four temporary bridges—configuration, automation, runtime, and controllers—are installed before the legacy app and reset together on failed bootstrap (`client/app/bootstrap-transaction.ts:45-64`, `client/app/bootstrap-transaction.ts:305-367`). They are migration seams, not additions to the frozen public `Session` interface.
- Migration is idempotent when valid Phase 1 state exists and writes the new graph/provenance without deleting legacy records (`client/storage/legacy-migration.ts:73-85`, `client/storage/legacy-migration.ts:194-232`). Storage tests explicitly compare all legacy values byte-for-byte after migration (`test/session-storage.test.mjs:41-70`, `test/session-storage.test.mjs:157-190`).
- Root scripts expose the local quality, built-server, browser, transport, Electron, packaging, and MCP gates (`package.json:20-55`). Hosted CI adds clean installs, the packaged Electron smoke, source-free Docker probes, all development browsers, production Chromium, all transports, and an independently installed MCP job (`.github/workflows/ci.yml:15-49`, `.github/workflows/ci.yml:50-92`, `.github/workflows/ci.yml:93-144`).

## Must-haves

- [MH1] The Step 15 predecessor gate is green before interface work is accepted — acceptance: focused model/storage/configuration/runtime/GMCP/transport tests and both development and production disposal/parity specs pass without modified expectations, skips, retries added by Step 16, or unexplained environment failures.
- [MH2] The Phase 1 foundation is frozen precisely — acceptance: the decision record names the exact source declarations and invariants for `Session`, `SessionEvent`, identities/profiles, `ApplicationStateV1`, repository keys/commit behavior, effective configuration, transport, GMCP, `ResourceScope`, diagnostics, and disposal; it distinguishes public Phase 2 foundations from internal compatibility handles.
- [MH3] Compatibility debt has complete ownership — acceptance: every import of the configuration, automation, runtime, and controller bridges is grouped by consumer area, assigned a Phase 2 or Phase 3 migration owner, and given a Phase 4 deletion gate; no facade is described as permanent architecture.
- [MH4] GMCP inventory is exact and actionable — acceptance: every modeled and unmodeled package matches the code inventories and current public-JS registrations; every unmodeled row names its consuming Phase 2 port (or protocol/runtime owner), and outbound-only rows remain explicitly distinguished from inbound validation work.
- [MH5] Migration and rollback are proven rather than inferred — acceptance: the decision record identifies the new keys, untouched legacy keys, idempotent migration cases, corrupted/partial input behavior, rollback artifact, and prohibition on automatically deleting `darkflow-session-core-v1`.
- [MH6] The complete release-adjacent battery is recorded for one immutable candidate commit — acceptance: the record contains date/time zone, candidate SHA, clean-checkout source, platform, exact Node/npm/tool versions, command, result, count/artifact where applicable, and log or hosted-run reference for every required gate; the attestation diff after that SHA is documentation-only.
- [MH7] Phase completion is binary and evidence-backed — acceptance: the decision remains `OPEN` if any required local or hosted gate fails, is unavailable, belongs to another candidate, or the attestation changes executable inputs; only after all gates pass does it become `COMPLETE`, check the master Phase 1 gate, and explicitly unblock Phase 2.

## Out of scope

- Fixing regressions found by the gate. The owning prior step receives a separate smallest corrective change, after which Step 16 restarts from its predecessor gate.
- New public APIs, contract barrels, generated API documentation, snapshots of every exported symbol, or compile-time surface baselines. The decision freezes the intentional boundaries by source declaration; existing typecheck and behavior tests enforce them.
- Svelte/Dockview adoption, panel or terminal ports, settings redesign, mobile parity implementation, tabs, multiple sessions, background policy, or shared-set UX.
- Typing every unmodeled GMCP payload in Phase 1. Step 16 assigns owners; the consuming Phase 2 port adds the contract at the ingress boundary.
- Removing compatibility facades or legacy `public/js` modules. Consumer ports occur in Phase 2/3 and final deletion remains Phase 4.
- A live production Darkwind connection as a blocking automated gate. Deterministic local fixtures cover transport and GMCP; any live smoke is recorded separately as non-blocking evidence.
- Publishing a release, image, installer, tag, or deployment. Step 16 validates release-adjacent artifacts but does not mutate external release state.

## Assumptions

- [The committed Step 15 implementation is the sole predecessor] — if false: inventory any intervening runtime change, rerun its owning step gate, and replan the affected freeze rows before Step 16.
- [The current repository tests and CI jobs collectively cover every required runtime boundary] — if false: add only the smallest missing fixture to the owning step; do not build a parallel Step 16 harness.
- [Phase 2 can consume the current TypeScript declarations directly by source path] — if false: stop and plan an intentional package/export boundary rather than inventing one inside the freeze document.
- [Compatibility consumers can be assigned from current imports and the proposal phase boundaries] — if false: leave the specific row unresolved and keep Phase 1 `OPEN`; do not guess ownership.
- [Hosted CI is available for authoritative Linux, Docker, packaged Electron, browser, transport, and nested MCP evidence] — if false: Step 16 may record local evidence but cannot mark Phase 1 complete.

## Risks

- A documentation-only step can declare victory while runtime proof is stale — mitigation: every result records one candidate SHA and the final attestation diff is limited to the decision, inventory, and master-plan Markdown files.
- The master command list omits some release boundaries that CI actually enforces — mitigation: use `.github/workflows/ci.yml` as the job inventory and explicitly include packaged Electron and Docker evidence.
- A static interface ledger can accidentally freeze internal implementation details — mitigation: separate foundation contracts, internal composition handles, and temporary compatibility facades; freeze only behavior Phase 2 depends on.
- The GMCP Markdown inventory can drift from validators or consumers — mitigation: compare the document to code exports and the 109-registration census before assigning owners.
- Platform or loopback restrictions can be misreported as passes — mitigation: record `PASS`, `FAIL`, or `BLOCKED_ENVIRONMENT` exactly; only hosted green jobs satisfy an unavailable required boundary.
- Re-running long browser/packaging gates after a documentation edit can appear wasteful — mitigation: make the interface/debt draft first, then run the complete battery once at the final candidate commit; rerun only gates whose inputs changed.
- A test failure can tempt Step 16 to weaken an assertion or add a broad guard — mitigation: preserve expectations and route the root cause to the owning prior step.

## Gates

### Predecessor gate

Run before editing the freeze decision:

```bash
node --test test/session-model.test.mjs test/session-storage.test.mjs test/effective-configuration.test.mjs
node --test test/session-lifecycle-primitives.test.mjs test/session-runtime.test.mjs test/session-automation-runtime.test.mjs
node --test test/session-gmcp-bus.test.mjs test/session-gmcp-darkwind.test.mjs test/session-gmcp-controller-lifecycle.test.mjs test/session-gmcp-controller-census.test.mjs
node --test test/session-transport.test.mjs test/session-runtime-bridge.test.mjs test/session-bootstrap.test.mjs
npm run test:browser -- e2e/session-disposal.spec.ts e2e/session-single-runtime.spec.ts --project=chromium
npm run build
npm run test:browser:production
```

Proceed only when every command passes without changing production code or weakening tests. A failure is an evidence gate back to Steps 3-15, selected by the failed contract.

### Inventory gate

```bash
rg -n "^export (interface|type|class|const|function)" client/model client/storage client/configuration client/runtime client/gmcp client/transport
rg -n "session-compat/(configuration|automation|runtime|controllers)\\.js" public/js client test e2e --glob '*.{js,mjs,ts}'
node --test test/session-gmcp-controller-census.test.mjs test/session-gmcp-darkwind.test.mjs
```

Proceed when every intentional foundation contract has one freeze row, every compatibility import has an owner, and the GMCP document matches code. New exports are not automatically public; classify them before recording them.

### Final go/no-go gate

Phase 1 can become `COMPLETE` only after the candidate commit has an empty checkout before installation, the full local battery is recorded, and all four hosted CI jobs—`baseline`, `docker`, `browser`, and `mcp`—are green for that same candidate. The following attestation commit may change only the Step 16 decision, GMCP inventory, and master-plan Markdown. `BLOCKED_ENVIRONMENT`, skipped, cancelled, stale-candidate, and allowed-failure results are not green.

## Steps

### Step 1 — Draft the interface and compatibility freeze

**Files:** `docs/plans/multi-connection-ui-phase-1-step-16-decision.md` (new), `docs/plans/multi-connection-ui-phase-1-gmcp-inventory.md`

**Intent:** Create the decision record with status `OPEN`. Record a compact freeze table with columns for contract, source declaration, frozen invariant, Phase 2 consumer, allowed evolution, and replan trigger. Cover the public `Session`, event envelope/bus routing, identity/profile graph, repository/storage keys, effective configuration resolution/publish semantics, transport, GMCP validation/pass-through policy, resource ownership/diagnostics, and disposal. List `SessionFacadeHandles` and all four public-JS compatibility bridges separately as transitional internals.

Update the GMCP inventory in place: replace the generic owner paragraph with one owner per unmodeled row or cohesive package family. Assign the next consuming port in Phase 2, Phase 3 only where behavior truly depends on multiple live sessions, and Phase 4 as the deletion gate for legacy adapters. Do not add validators or source barrels.

**Verify:**

```bash
rg -n "Session|SessionEvent|ApplicationStateV1|darkflow-session-core-v1|EffectiveConfigurationSnapshot|SessionTransport|SessionGmcpBus|ResourceScope|SessionDiagnosticsSnapshot" docs/plans/multi-connection-ui-phase-1-step-16-decision.md
rg -n "configuration|automation|runtime|controllers|Phase 2|Phase 3|Phase 4" docs/plans/multi-connection-ui-phase-1-step-16-decision.md
rg -n "unmodeled|Phase 2|Phase 3|Phase 4" docs/plans/multi-connection-ui-phase-1-gmcp-inventory.md
```

**Done when:** every MH2-MH5 item is represented, no debt row lacks a named later-phase owner/deletion gate, and the record still says `OPEN` with no invented verification results.

### Step 2 — Run and record the clean-install parity battery

**Files:** `docs/plans/multi-connection-ui-phase-1-step-16-decision.md`

**Intent:** Commit the `OPEN` decision/inventory draft, then use that immutable commit as the candidate. From a clean checkout, record its SHA and clean status before dependency installation. Use the pinned Node/npm cohort, perform one root `npm ci`, and run the existing checks in the order below. Record the exact command and outcome; include pass counts, artifact paths, and environment limitations where useful. Do not edit source or expectations during the run.

**Verify:**

```bash
nvm use
test "$(node --version)" = "v22.15.0"
test "$(npm --version)" = "10.9.2"
git status --short
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run check
npm test
npm run build
npm run verify:client-artifact
npm run test:server:built
npm run test:browser
npm run test:browser:production
npm run test:transports
npm run desktop:smoke
npm run desktop:pack
npm run desktop:smoke:packaged
npm run test:mcp
docker build --tag darkflow:phase1-step16 .
git diff --check
```

The pre-install `git status --short` output must be empty. Then require the hosted `.github/workflows/ci.yml` run for the same candidate SHA and record direct run/job links for `baseline`, `docker`, `browser`, and `mcp`. Hosted CI is authoritative for Docker runtime probes and any local platform/loopback boundary that could not execute.

**Done when:** the decision contains a complete result row for every command and hosted job, evidence is tied to one immutable candidate SHA, and failures or unavailable required checks leave status `OPEN` with the owning step and rerun command named.

### Step 3 — Decide Phase 1 after all gates

**Files:** `docs/plans/multi-connection-ui-phase-1-step-16-decision.md`, `docs/plans/multi-connection-ui-phase-1-implementation-plan.md`

**Intent:** After all gates—not before—make one documentation-only attestation diff: set the decision to `COMPLETE`, record the exact completion date and validated candidate SHA, summarize known non-blocking limitations, and state that Phase 2 may rely on the frozen foundation contracts. Link the Step 16 implementation plan and decision from the master Step 16 section, check each Phase 1 gate using its corresponding evidence row, and leave Phase 2/3 implementation details deferred.

Before committing, prove the attestation changes only the decision, inventory, and master-plan Markdown files. If it changes code, tests, dependencies, build configuration, or CI, revert the status to `OPEN`, commit those corrections to a new candidate, and rerun Step 2. The attestation PR/commit must itself receive normal green CI before merge, but its run link need not be written back into the immutable file.

If any required evidence remains red or unavailable, keep the decision `OPEN`, leave the master checklist unchecked, identify the owning prior step and correction boundary, and stop. Do not use `COMPLETE_WITH_NOTES` for a missing required gate.

**Verify:**

```bash
rg -n "Step 16|step-16-implementation-plan|step-16-decision" docs/plans/multi-connection-ui-phase-1-implementation-plan.md
git diff --name-only
! rg -n "^\- \[ \]" docs/plans/multi-connection-ui-phase-1-implementation-plan.md
git diff --check
```

For the `COMPLETE` path, `git diff --name-only` must list only the Step 16 decision, GMCP inventory, and master-plan Markdown files. The negated checklist command also applies only to `COMPLETE`. On the `OPEN` path, unchecked items are required evidence that Phase 1 has not been certified.

**Done when:** either (a) all required evidence is green, the decision is `COMPLETE`, every Phase 1 gate is checked, and Phase 2 is explicitly unblocked; or (b) the record and master plan accurately keep Phase 1 open with no ambiguous status.

## Success criteria

- [ ] The predecessor and inventory gates pass without source/test changes.
- [ ] The decision freezes only intentional Phase 1 foundation contracts and labels internal handles accurately.
- [ ] Every temporary compatibility consumer has a Phase 2/3 migration owner and Phase 4 deletion gate.
- [ ] Every modeled/unmodeled GMCP package matches code and has an actionable owner.
- [ ] Migration, untouched legacy records, and rollback behavior have explicit evidence.
- [ ] One immutable candidate has complete clean-install local evidence and green hosted `baseline`, `docker`, `browser`, and `mcp` jobs.
- [ ] The final attestation changes documentation only and receives normal green CI before merge.
- [ ] Development/built web, all three development browsers, production Chromium, all four transports, source and packaged Electron, Docker, and MCP boundaries pass.
- [ ] The 25-cycle disposal gate returns every tracked resource and fixture socket to zero without late mutation, send, or error.
- [ ] Phase 1 status is binary: all gates green and Phase 2 unblocked, or Phase 1 remains open with an owning corrective boundary.
- [ ] No new runtime abstraction, production dependency, public API, or speculative Phase 2 implementation was added.

## Rollback

Step 16 is documentation-only and creates no user-data, protocol, runtime, release, or external-state mutation. Before completion, discard or revert the Step 16 documentation Green PR and Phase 1 remains open at the Step 15 runtime.

After completion, reverting only the Step 16 documents withdraws the certification but does not roll back runtime behavior. A runtime rollback redeploys or reverts to the last pre-cutover artifact in reverse dependency order; it continues reading untouched legacy keys and ignores `darkflow-session-core-v1`. Never delete the Phase 1 document automatically because it may contain later user edits (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:599-608`).

## Execution fit

- Scope: multi-run phase
- Lead: Terra at high reasoning — the code is already implemented, but evidence integration and go/no-go judgment span several runtime boundaries
- Workers: none — contract classification, evidence recording, and the final status must remain tied to one commit and one accountable verifier
- Delegation shape: solo
- Ownership: the lead owns the interface/debt ledger, clean-checkout provenance, final local battery, hosted-CI correlation, rollback decision, and Phase 1 status
- Replan trigger: any predecessor regression, unowned facade/package, missing runtime boundary, interface that Phase 2 cannot consume directly, required check unavailable in hosted CI, evidence from differing candidate SHAs, or a non-documentation attestation diff
- Confidence: high — contracts, behavior fixtures, disposal soak, packaging paths, and CI jobs already exist; Step 16 mainly makes their evidence and ownership explicit

Plan self-review: PASS (9/10)

notes:

- Ponytail kept Step 16 documentation-only and reused the current test/CI matrix; it adds no contract snapshot system or duplicate parity harness.
- The executor must preserve `OPEN` until all required evidence is green for one immutable candidate; local success cannot substitute for a missing hosted boundary.
- Loopback-dependent local checks may report sandbox `EPERM`; record that precisely and require the corresponding hosted CI job rather than weakening or skipping the test.
