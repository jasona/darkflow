# Phase 2 Step 1 Implementation Plan

_Plan stress-tested via focused adversarial review. Nine findings surfaced;
eight survived. Ponytail full keeps this step to one documentation ledger and
the evidence that already exists._

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 — the change is documentation-only and reversible, but its
  parity rows become the acceptance and rollback contract for every later Phase
  2 port across several runtime boundaries
- Hard triggers: none; the Phase 2 master plan already supplies the phase map and
  makes this a bounded first step
- Current planning horizon: Phase 2 Step 1 only — freeze the current one-session
  parity matrix and per-row cutover/rollback contract
- Evidence horizon: the certified Phase 1 candidate, legacy UI/controller
  ownership, the compatibility and GMCP ledgers, existing unit/browser/package
  fixtures, CI jobs, and the approved-but-not-production Dockview spike
- Adversarial review: focused — prevent paper parity, duplicate harnesses,
  unowned rows, false mobile evidence, and premature cutover

## Planning status

This detailed plan is ready for implementation. Phase 1 Step 16 is `COMPLETE`
for immutable candidate `21b1dc111e50d736318895eb7c45e3e096af4953`, and required CI
passed, so the Step 1 predecessor gate is satisfied
(`docs/plans/phase-1/multi-connection-ui-phase-1-step-16-decision.md:3-11`).

## Goal

Create one authoritative parity-and-cutover ledger for the existing
single-session client. Each observable workflow must name its current owner,
current evidence, Phase 2 owning step, cutover condition, and local rollback.
Later port plans use those rows as acceptance criteria instead of rediscovering
or silently narrowing legacy behavior.

Step 1 changes no client, test, build, workflow, persistence, or production
behavior. It reuses the certified Phase 1 evidence and current fixtures; where
proof is absent, it records `MISSING` evidence and assigns the gap to the Phase
2 step that will change that surface.

## Evidence and constraints

- Phase 2 ends at one-session Svelte/Dockview parity for web, Electron, and
  mobile. Multiple live sessions and functional tabs remain Phase 3 work
  (`docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md:38-48`,
  `docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md:102-112`).
- The required Step 1 surface is shell, connection, terminal/input, automation,
  settings, layout, panels, maps, windows, IDE, notifications/media, debug
  tooling, accessibility, mobile, Electron, and release boundaries
  (`docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md:191-205`).
- The production root currently bootstraps one public `Session`, then loads the
  legacy app through four compatibility bridges
  (`client/app/bootstrap-transaction.ts:177-204`,
  `client/app/bootstrap-transaction.ts:241-255`). The public `Session` is limited
  to identity, connection lifecycle, disposal, and read-only snapshots
  (`client/runtime/session.ts:16-34`); Step 1 must not turn internal handles into
  a UI contract.
- The Phase 1 freeze already groups the four compatibility facades by Phase 2
  owner and lists the legacy controllers that must move
  (`docs/plans/phase-1/multi-connection-ui-phase-1-step-16-decision.md:28-40`).
  The existing controller census independently fixes the 22 files and 109 GMCP
  registrations that use session lifecycle ownership
  (`test/session-gmcp-controller-census.test.mjs:6-55`).
- The GMCP owner ledger assigns every deferred package family to a named Phase 2
  consumer and distinguishes inbound, outbound-only, and bidirectional traffic
  (`docs/plans/multi-connection-ui-phase-1-gmcp-inventory.md:144-176`). The parity
  ledger links these owner rows; it does not duplicate or reinterpret protocol
  payload contracts.
- The master mentions room media in both Steps 7 and 10, but current ownership
  supplies a clean split: Step 7 owns the room-playlist GMCP/UI/YouTube lifecycle
  (`public/js/room-playlist-manager.js:11-15`,
  `public/js/room-playlist-manager.js:64-102`), while Step 10 owns the separate
  Howler sound engine, unlock, visibility, and login/game-audio behavior
  (`public/js/sound-manager.js:1-11`, `public/js/sound-manager.js:147-169`).
- Existing production-browser evidence proves the built root shell, connection
  controls, terminal/input presence, session/controller bootstrap, built bundle,
  API/static routes, and Howler availability without a live MUD
  (`e2e/production-artifact.spec.ts:60-145`). Existing transport evidence drives
  all four public transport selections against loopback fixtures
  (`e2e/transports.spec.ts:52-115`).
- Existing browser lifecycle evidence proves one session survives reload and
  disposes legacy GMCP controllers
  (`e2e/session-single-runtime.spec.ts:3-151`); the 25-cycle soak owns the stronger
  resource-release boundary (`e2e/session-disposal.spec.ts:4-146`).
- The approved Dockview spike proves update identity, terminal preservation,
  restore/recovery, and disposal only under `/phase0/`
  (`e2e/workspace-lifecycle.spec.ts:128-175`,
  `e2e/workspace-lifecycle.spec.ts:175-307`). Its touch-gesture test is currently
  skipped (`e2e/workspace-touch.spec.ts:94-99`), so it is not mobile parity
  evidence.
- Root scripts expose the current unit, build, browser, production-browser,
  transport, Electron, package, and MCP commands (`package.json:20-55`). Hosted
  CI supplies four independently visible boundaries: `baseline`, `docker`,
  `browser`, and `mcp` (`.github/workflows/ci.yml:16-50`,
  `.github/workflows/ci.yml:50-93`, `.github/workflows/ci.yml:93-145`).
- Step 12 alone changes the production owner after every Step 1-11 gate is green
  for one immutable candidate; Steps 1-11 retain the legacy production artifact
  as rollback (`docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md:354-393`).

## Must-haves

- [MH1] Step 1 starts from the certified Phase 1 boundary — acceptance: the
  ledger records the `COMPLETE` Step 16 decision, immutable candidate SHA,
  completion date, and direct hosted `baseline`, `docker`, `browser`, and `mcp`
  evidence links before recording any baseline result as certified.
- [MH2] One file is the authoritative parity and cutover contract — acceptance:
  `multi-connection-ui-phase-2-step-1-parity-matrix.md` contains status,
  provenance, evidence taxonomy, row schema, all required rows, cross-cutting
  facets, cutover rules, rollback rules, and open gaps; there is no second
  competing inventory.
- [MH3] Every row is actionable — acceptance: each row has a stable ID, observable
  single-session behavior, current owner, current evidence and evidence class,
  candidate result, Phase 2 owning step, cutover condition, and concrete rollback
  behavior. Blank, `TBD`, `same as legacy`, and ownerless cells are forbidden.
- [MH4] Coverage spans the whole Phase 2 port surface — acceptance: at least one
  row covers every required workflow family listed in the row inventory below,
  and every controller-facade consumer and GMCP deferred-owner family maps to a
  row or an explicitly cited shared row.
- [MH5] Evidence is not overstated — acceptance: automated rows name an exact
  existing command and fixture/test; manual rows name environment, actions, and
  expected observations; absent proof is `MISSING`. A skipped, not-run,
  environment-blocked, stale-SHA, or Phase 0-only result is never `PASS` for the
  production legacy root.
- [MH6] Cross-cutting acceptance stays with the visible owner — acceptance: every
  user-visible row explicitly classifies development/built web, Electron,
  responsive/mobile/touch, keyboard/focus, accessibility, theme/reduced-motion,
  reconnect, and disposal as `COVERED`, `NOT_APPLICABLE` with a reason, or
  `MISSING` with its owning Phase 2 step.
- [MH7] The cutover stays after all gates — acceptance: Steps 2-11 may append
  replacement evidence to their rows but cannot erase the frozen legacy
  baseline or become the default production owner; Step 12 may cut over only
  when every required row is green for its immutable Phase 2 candidate and the
  pre-cutover artifact remains usable.
- [MH8] Step 1 itself is documentation-only — acceptance: its implementation diff
  changes only the parity ledger and the Phase 2 master-plan status/link. It adds
  no application code, test fixture, snapshot generator, dependency, feature
  flag, CI job, or release artifact.

## Required parity-row inventory

The executor may split a workflow family into multiple rows when behavior or
rollback differs. It may not collapse unrelated behaviors merely to reduce the
row count.

| Phase 2 owner | Required legacy workflow families                                                                                                                                                                     | Current owner sources to reconcile                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 2        | Root shell/bootstrap; connect/disconnect/reconnect; connection status and overlay; endpoint controls; app/theme/login chrome; desktop integration                                                     | `client/app/bootstrap-transaction.ts`; `public/js/app.js`; `connection.js`; `connection-overlay.js`; `theme-manager.js`; `login-theme-manager.js`; `desktop-integration.js` |
| Step 3        | Panel open/close/focus/move/resize; saved layout and recovery; terminal identity during layout change; responsive/mobile sheet and touch                                                              | `public/js/panel-manager.js`; `panel-defs.js`; `pane-settings.js`; Phase 0 workspace adapter and tests                                                                      |
| Step 4        | Terminal output/scroll/focus; command entry/history/batch/paste; completion; aliases, triggers, timers, functions, key maps, highlights, variables, and automation execution                          | `public/js/output.js`; `input.js`; `completion.js`; the six definition managers; `gmcp-variables.js`; `automation-executor.js`                                              |
| Step 5        | General settings and each of the six configuration editors; precedence/provenance; validation; save/reload; stale publication; runtime-state isolation                                                | `public/js/settings-manager.js`; `settings-automation.js`; the six definition managers; Phase 1 configuration service and storage tests                                     |
| Step 6        | Character/status, group, inventory, quest, achievement, cyberware, guild/vitals/XP, lag, and diagnostics panels; RFC 2549 debug behavior                                                              | `public/js/panel-manager.js`; `panel-renderers.js`; `lag-monitor.js`; `rfc2549-debug.js`                                                                                    |
| Step 7        | Map hydration/render/navigation/pan/zoom/speedwalk/storage; world/room data and image; shared room-playlist state, controls, and YouTube playback                                                     | `public/js/map-*.js`; `live-map-source.js`; `room-playlist-manager.js`; relevant panel data consumers                                                                       |
| Step 8        | Generic `Darkwind.Window`; snoop; announcements; Giphy; broadcast; Linux rescue; fishing; open/update/close/focus and outbound actions                                                                | `public/js/window-manager.js`; named window/manager modules; `window-renderer.js`                                                                                           |
| Step 9        | IDE open/chunk/close, edit/save/transfer, focus/layout, failure/reconnect, and editor loading in built web and source-free Electron                                                                   | `public/js/ide-manager.js`; `ide-editor.js`                                                                                                                                 |
| Step 10       | Mentions and output navigation; notification permission/delivery; Howler sound unlock/queue/loop/volume/visibility; sound panel; login theme and GMCP-triggered game audio                            | `public/js/notification-manager.js`; `mention-picker.js`; `sound-manager.js`; `sound-panel.js`; `login-theme-manager.js`                                                    |
| Step 11       | Combat, tutorial, visual effects, Street Samurai, textual fallbacks, timing, reduced motion, and specialty presentation                                                                               | `public/js/combat-visual-manager.js`; `tutorial-manager.js`; `visual-effects-manager.js`; `street-samurai-dashboard-manager.js`                                             |
| Step 12       | Development and built web; root quality/build/artifact; accessibility/theme/focus; mobile; all four transports; Electron source and source-free package; Docker; MCP; compatibility and GMCP censuses | `package.json`; `.github/workflows/ci.yml`; browser/package/release fixtures; Step 16 evidence ledger                                                                       |

## Evidence taxonomy

The parity ledger uses two independent fields so fixture existence cannot be
confused with an executed result.

**Evidence class**

- `AUTOMATED` — an exact repository command and test/fixture asserts the row's
  observable behavior.
- `MANUAL` — a repeatable check names its environment, actions, and expected
  observations. A live Darkwind smoke may be manual but never an automated gate.
- `MISSING` — no current proof is sufficient. The row states the smallest proof
  its Phase 2 owner must add before that row can go green.

**Candidate result**

- `PASS` or `FAIL` — tied to a named immutable SHA and evidence link/log.
- `BLOCKED_ENVIRONMENT` — the required check could not execute in that
  environment; it is not green.
- `NOT_RUN` — no result was attempted for that candidate.

Phase 0 Dockview evidence may support the Step 3 design, but it remains
`MISSING` for production-root parity until the real session host exercises the
same behavior. Skipped tests are `NOT_RUN`, never evidence of support.

## Out of scope

- Implementing, fixing, or porting any behavior found while building the matrix.
  A defect returns to Phase 1 if it contradicts the certified candidate; a
  missing Phase 2 proof stays assigned to its owning later step.
- Adding browser scenarios, unit tests, fixtures, screenshot baselines, audit
  tooling, generated inventories, or a documentation schema validator.
- Re-running the complete Phase 1 certification battery after a documentation-
  only Step 1 change. Reuse its immutable evidence; run only the focused census
  and documentation checks needed to prove this ledger.
- Making Dockview or Svelte the production root, changing layout persistence,
  introducing a production feature flag, or deleting any legacy source/key.
- Defining the internal architecture or exact source edits for Steps 2-12. This
  ledger freezes behavior and ownership, not future implementation detail.
- Functional tabs, multiple sessions, background-session policy, shared-set UX,
  Phase 4 deletion, deployments, or publishing releases/artifacts.

## Assumptions

- [Phase 1 Step 16 will complete with the same public contracts described by the
  current freeze] — if false: replan affected rows against the actual certified
  decision before Step 1 implementation.
- [The Step 16 candidate and hosted links remain retrievable] — if false: Step 1
  cannot label automated baseline results certified; restore immutable evidence
  or recertify Phase 1.
- [Playwright emulation is the supported mobile evidence boundary] — if false: add
  the named physical-device/browser matrix to the affected row and Step 12 gate
  before freezing Step 1.
- [The compatibility ledger, controller census, and GMCP owner ledger collectively
  enumerate current migration consumers] — if false: keep Step 1 `OPEN`, add the
  missing legacy owner to the appropriate Phase 1 ledger/census, then resume.
- [A workflow can share one parity row only when current owner, Phase 2 owner,
  evidence, cutover condition, and rollback are identical] — if false: split the
  row; otherwise failures will be routed ambiguously.

## Risks

- A broad unit test can be cited for behavior it never observes — mitigation:
  every `AUTOMATED` row cites the exact test case or bounded line range and states
  the user-visible assertion it proves.
- Manual checks can become unauditable folklore — mitigation: require platform,
  setup, actions, expected observation, result, date, and verifier; otherwise use
  `MISSING`.
- A tidy matrix can omit a legacy consumer — mitigation: reconcile it against all
  four compatibility-facade consumer lists, the 109-registration census, the
  GMCP owner ledger, public scripts, and the CI jobs before completion.
- Cross-cutting mobile/accessibility/disposal work can be deferred to Step 12 —
  mitigation: keep those classifications on each visible row; Step 12 aggregates
  and certifies rather than inventing missing port evidence.
- Phase 0 workspace tests can be mistaken for production parity — mitigation:
  label their `/phase0/` host explicitly and leave real-session workspace/mobile
  rows `MISSING` until Step 3.
- A future port can overwrite its baseline and hide a regression — mitigation:
  freeze legacy behavior/evidence columns; later steps append Phase 2 evidence and
  status, then Step 12 compares both.
- Cutover can be inferred from individual green rows — mitigation: the ledger
  states that only Step 12 changes the production owner after all required rows
  and release boundaries are green for one candidate.

## Steps

### Step 1 — Prove the entry gate and seed the ledger

**Files:**
`docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md` (new)

**Intent:** Stop unless the Step 16 decision says `COMPLETE`. Copy the certified
Phase 1 candidate SHA, completion date, Node/npm cohort, and direct hosted job
links into an `Entry provenance` section. Do not infer completion from the HEAD
commit message or preliminary local passes.

Create the one ledger with status `OPEN`, the evidence taxonomy above, and this
row schema:

| Field                | Required content                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| ID                   | Stable `P2-<step>-<short-name>` identifier                                                                          |
| Legacy behavior      | Observable single-session behavior, not an implementation intention                                                 |
| Current owner        | Exact legacy/public or Phase 1 source owner                                                                         |
| Baseline evidence    | Evidence class, exact test/manual check, candidate result, and immutable reference                                  |
| Phase 2 owner        | One numbered Step 2-12 owner                                                                                        |
| Cross-cutting facets | Built web, Electron, mobile/touch, accessibility/focus/theme, reconnect, and disposal classifications as applicable |
| Cutover condition    | Exact replacement evidence required before the row can go green                                                     |
| Rollback             | Concrete preceding module, preserved state/key, or pre-cutover artifact restored on failure                         |

**Verify:**

```bash
rg -n '^\*\*Status:\*\* `COMPLETE`$' docs/plans/phase-1/multi-connection-ui-phase-1-step-16-decision.md
rg -n 'Candidate SHA|baseline|docker|browser|mcp' docs/plans/phase-1/multi-connection-ui-phase-1-step-16-decision.md
git show --no-patch --format='%H %cI' <phase-1-candidate-sha>
```

**Done when:** the new ledger is `OPEN`, its provenance points to one certified
Phase 1 candidate, and it has no copied or invented result from another SHA.

### Step 2 — Inventory observable workflows and assign ownership

**Files:**
`docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md`

**Intent:** Walk the required row inventory from Step 2 through Step 12. For each
workflow, trace the current owner from the root bootstrap through the public-JS
controller or Phase 1 service, then assign exactly one later Phase 2 step. Keep
cross-cutting facets attached to the visible workflow rather than creating a
generic “accessibility later” or “mobile later” row.

Reconcile the resulting IDs against the four compatibility-facade consumer
groups, controller census, and deferred GMCP owner ledger. A cohesive GMCP family
may link to one workflow row; do not copy every package payload into this file.
Split any row whose cutover or rollback would have two owners.

**Verify:**

```bash
rg -n 'session-compat/(configuration|automation|runtime|controllers)\.js' public/js client test e2e --glob '*.{js,mjs,ts}'
node --test test/session-gmcp-controller-census.test.mjs test/session-gmcp-darkwind.test.mjs
rg -n '^\| Step (2|3|4|5|6|7|8|9|10|11|12) ' docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md
rg -n 'P2-(2|3|4|5|6|7|8|9|10|11|12)-' docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md
```

**Done when:** every required workflow family, compatibility consumer group, GMCP
owner family, and release boundary maps to a stable row with one current owner
and one numbered Phase 2 owner; there are no `TBD` or ownerless rows.

### Step 3 — Bind existing evidence and expose gaps

**Files:**
`docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md`

**Intent:** For each row, cite the narrowest existing automated test that observes
the behavior. Use the Step 16 candidate result/link instead of rerunning its full
battery. Where deterministic automation does not exist, write an exact manual
check; where neither is sufficient, mark `MISSING` and state the smallest proof
the owning Phase 2 step must add.

Record Phase 0 workspace evidence as design evidence only. Explicitly mark the
skipped touch spec `NOT_RUN` and real-session layout/mobile coverage `MISSING`.
Do not add tests in Step 1, use a live Darkwind server as an automated dependency,
or convert a source/unit assertion into a claim about visible browser behavior.

**Verify:**

```bash
rg -n 'AUTOMATED|MANUAL|MISSING' docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md
rg -n 'PASS|FAIL|BLOCKED_ENVIRONMENT|NOT_RUN' docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md
rg -n 'workspace-touch|NOT_RUN|MISSING|/phase0/' docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md
rg -n 'npm (test|run)|node --test|e2e/|test/' docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md
```

**Done when:** every row has one honest evidence class and candidate result;
manual checks are reproducible; missing proof has a named later owner; skipped,
Phase 0-only, stale, or blocked evidence is not green.

### Step 4 — Freeze per-row cutover and rollback

**Files:**
`docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md`

**Intent:** Add one cutover condition and rollback action to every row. The
condition names the replacement behavior, environment/facet coverage, and
focused evidence the owning step must produce. The rollback names the preserved
legacy module, storage/layout input, or last certified artifact that resumes
ownership; “revert it” without a target is insufficient.

Freeze the legacy baseline columns. Later steps append replacement evidence and
may mark their own rows green, but they do not erase the baseline, delete legacy
sources/keys, or change the default production root. State once that Step 12 is
the sole production cutover and requires all rows plus its release-boundary rows
green for one immutable candidate.

**Verify:**

```bash
rg -n 'Cutover|Rollback|Step 12|immutable candidate|legacy' docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md
! rg -n 'TBD|TODO|same as legacy|ownerless' docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md
```

**Done when:** each row routes a failed port to one owner and one rollback target,
no Step 2-11 row implies production cutover, and the global cutover remains
“after all gates.”

### Step 5 — Audit and close Step 1

**Files:**
`docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md`,
`docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md`

**Intent:** Review the ledger against MH1-MH8 and the master Step 1 exit. Record a
compact gap summary grouped by owning Step 2-12; gaps are allowed only when their
row has exact missing evidence, cutover condition, and rollback. Set the ledger
to `COMPLETE` only when the inventory and ownership contract is complete—not
when later Phase 2 behavior has passed.

Update the master Step 1 section with the ledger link and completion status. Keep
Phase 2 itself `OPEN`; this closes only its planning/evidence-freeze Step 1.

**Verify:**

```bash
npx prettier --check docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md
git diff --check
git diff --name-only
```

**Done when:** the ledger is `COMPLETE`, every row is populated and owned, all
missing evidence is explicit, the master links the ledger, formatting passes,
and the Step 1 implementation diff contains documentation only.

## Success criteria

- [ ] Phase 1 Step 16 is `COMPLETE`, and Step 1 provenance names its immutable
      candidate and four hosted CI jobs.
- [ ] One authoritative parity-and-cutover ledger contains the complete Step
      2-12 row inventory and required schema.
- [ ] Every legacy workflow, compatibility consumer group, GMCP owner family, and
      release boundary maps to one current owner and one Phase 2 step.
- [ ] Every evidence claim names an exact automated fixture or reproducible manual
      check; missing, skipped, stale, blocked, and Phase 0-only proof is labeled
      honestly.
- [ ] Every visible row classifies mobile/touch, accessibility/focus/theme,
      Electron/built web, reconnect, and disposal where applicable.
- [ ] Every row has a concrete cutover condition and rollback target; only Step 12
      may change the production owner after all gates.
- [ ] The parity ledger may be `COMPLETE` with assigned `MISSING` future evidence,
      but no owner, behavior, cutover, or rollback field may be missing.
- [ ] The Step 1 implementation changes documentation only and adds no duplicate
      harness, test suite, schema validator, feature flag, dependency, or runtime
      abstraction.

## Rollback

Step 1 has no runtime, data, protocol, release, or external-state mutation.
Revert the parity-ledger/master-link documentation change to reopen Step 1. The
certified Phase 1 artifact remains the production owner, legacy storage/layout
inputs remain untouched, and Phase 2 implementation remains uncut over.

## Execution fit

- Scope: single run
- Lead: Terra at high reasoning — implementation is documentation-only, but one
  owner must reconcile many evidence sources without weakening or duplicating
  the future acceptance contract
- Workers: none — row boundaries, evidence classification, cutover, and rollback
  are tightly coupled in one ledger
- Delegation shape: solo
- Ownership: the lead owns inventory completeness, evidence classification,
  master-plan integration, and the final Step 1 status
- Replan trigger: Phase 1 certifies a different public/GMCP contract; a current
  consumer is absent from all ledgers/censuses; a physical-device requirement is
  found; or a row cannot name one Phase 2 owner and one rollback target
- Confidence: medium-high — current owners and test boundaries are well
  inventoried, but execution correctly remains blocked on Phase 1 certification
  and several visible workflows are expected to expose honest evidence gaps

Plan self-review: PASS (9/10)

notes:

- The selected detailed-plan horizon fits one reversible documentation contract;
  later ports remain deferred to their own planning sessions.
- Step 1 completion certifies inventory and ownership, not Phase 2 parity. Missing
  behavior evidence remains a blocking row for its owning port and final cutover.
- The current skipped touch fixture is not mobile evidence; Step 3 must replace
  that gap at the real-session boundary.
