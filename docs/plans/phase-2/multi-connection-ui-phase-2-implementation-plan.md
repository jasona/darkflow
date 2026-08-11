# Phase 2 Implementation Plan

_Plan stress-tested via focused adversarial review, then simplified with
Ponytail full. The shared boundary is proved by a real vertical slice, and
mobile/accessibility acceptance stays with each visible port._

## Planning selection

- Mode: phase map
- Complexity: 8/10 — Phase 2 crosses the shell, workspace, terminal,
  configuration, protocol, panel, desktop, and mobile boundaries and ends in a
  production UI cutover.
- Hard triggers: project-level sequencing, multiple blocking gates, and
  independently plannable port families
- Current planning horizon: the mid-level Phase 2 step sequence only; each step
  gets a separate planning session before implementation work is defined
- Evidence horizon: the proposal, Phase 0 Dockview decision, Phase 1
  master/freeze records, GMCP owner inventory, and current release boundaries
- Adversarial review: focused — entry status, ownership, ordering, rollback,
  parallelization, and parity evidence

## Planning status

This artifact plans Phase 2 but does not itself authorize implementation. Phase
1 Step 16 is `COMPLETE` for immutable candidate
`21b1dc111e50d736318895eb7c45e3e096af4953`, so the Phase 2 entry gate is
satisfied
(`docs/plans/phase-1/multi-connection-ui-phase-1-step-16-decision.md:3-11`).

Each numbered item is a planning horizon, not an implementation task list. When
a step is ready, create
`multi-connection-ui-phase-2-step-N-implementation-plan.md` in this directory.
That later session inspects exact files, defines Green PR slices, assigns
ownership, and pins commands.

## Goal

Replace the visible one-session legacy frontend with a Svelte application shell
and the approved Dockview workspace while preserving current behavior. The new
UI consumes the public Phase 1 session, configuration, transport, GMCP, event,
and lifecycle contracts and leaves a stable host for Phase 3 to add multiple
sessions.

Success is one production Svelte/Dockview frontend whose single-session web,
Electron, and mobile parity matrix passes. Phase 2 does not expose multiple live
sessions or delete legacy rollback sources and compatibility adapters.

## Evidence and hard constraints

- Phase 2 owns the Svelte shell, approved workspace adapter, `panel-manager`
  data/layout split, panels, settings, terminal host, windows, IDE, input,
  notifications, sound, mobile sheet, and bundled CodeMirror. Its exit is
  single-session web, Electron, and mobile parity
  (`docs/plans/multi-connection-ui-proposal.md:256-264`).
- Dockview 7.0.4 is approved for migration, not yet for production cutover
  (`docs/plans/phase-0/multi-connection-ui-phase-0-step-6-dockview-decision.md:3-14`).
  Its adapter, Svelte lifecycle, terminal-island, layout recovery, desktop
  browser, and emulated-touch gates passed
  (`docs/plans/phase-0/multi-connection-ui-phase-0-step-6-dockview-decision.md:31-43`).
- Phase 2 consumes the public Phase 1 foundation. `SessionFacadeHandles` is
  internal compatibility wiring, not a Svelte/workspace API
  (`docs/plans/phase-1/multi-connection-ui-phase-1-step-16-decision.md:13-26`).
- Cached game state and GMCP subscriptions must leave legacy layout ownership
  before their Svelte renderers replace it
  (`docs/plans/multi-connection-ui-proposal.md:238-252`). The boundary is
  extracted through Step 6's first real panel port, not a standalone framework.
- Every unmodeled GMCP family remains compatibility pass-through until its named
  port owns representative fixtures and an explicit ingress contract
  (`docs/plans/multi-connection-ui-phase-1-gmcp-inventory.md:144-176`).
- Phase 1 must resolve its GMCP contract before certification. The proposal says
  malformed modeled payloads do not reach typed handlers
  (`docs/plans/multi-connection-ui-proposal.md:179-196`), while the open Step 16
  record currently describes advisory delivery
  (`docs/plans/phase-1/multi-connection-ui-phase-1-step-16-decision.md:42-49`).
- Mobile, accessibility, theme, and disposal acceptance belongs to every visible
  port. Shell-level behavior belongs to Steps 2-3; Step 12 verifies the integrated
  result.
- Legacy production remains the rollback source until every Phase 2 gate passes.
  There is no long-lived production feature flag; Step 12 owns cutover.

## Must-have outcomes

- [MO1] Phase 2 starts from one certified Phase 1 candidate with a coherent
  public session/GMCP contract.
- [MO2] One Svelte shell owns one public `Session`, and one Dockview workspace
  persists character-owned layout and disposes deterministically.
- [MO3] Terminal, input, automation, settings, panels, maps, windows, IDE,
  notifications, sound, media, effects, debug tooling, and connection chrome
  pass the Step 1 parity matrix.
- [MO4] Every migrated GMCP family has one typed owner, representative fixtures,
  direction-correct send/receive behavior, and no ambiguous unmodeled delivery.
- [MO5] Configuration editing preserves the Phase 1 graph, precedence, atomic
  revisions, provenance, and runtime-state isolation.
- [MO6] Development, built web, Electron, Docker, transports, MCP, mobile/touch,
  accessibility, theme, focus, and disposal pass for one immutable Phase 2
  candidate.
- [MO7] Phase 3 receives a stable one-session host while legacy sources,
  persistence, and adapters remain available for rollback and Phase 4 cleanup.

## Out of scope

- Correcting or certifying Phase 1; failures return to their owning Phase 1 step.
- Functional tabs, multiple live workspaces, session create/close/switch/reorder,
  inactive rendering, cross-session notifications, or four-session isolation.
- Shared-set attach/duplicate/detach and cross-profile management UX.
- Deleting `public/js`, legacy persistence keys, compatibility facades, or the
  Phase 0 harness.
- Rewriting terminal algorithms, map data, MUD protocols, Express `/proxy`,
  Electron/Docker architecture, or MCP transport.
- Server features, deployments, backfills, or a published release.

## Assumptions

- [Phase 1 completes with a coherent public GMCP contract] — if false: replan
  Step 6 around the actual frozen contract before any panel port begins.
- [Dockview 7.0.4 remains approved] — if false: Step 3 becomes a bounded
  replacement decision that must reproduce the Phase 0 gates.
- [The Phase 1 character profile can own the new layout without weakening its
  schema] — if false: Step 3 must add a versioned migration and rollback.
- [The terminal renderer remains an imperative island] — if false: split its
  migration from input/automation before Step 4 implementation.
- [The supported mobile gate can use Playwright emulation unless Step 1 finds an
  existing physical-device requirement] — if false: add that device gate to the
  parity matrix.

## Risks

- Dual legacy/Svelte ownership could duplicate socket, input, focus, persistence,
  or disposal work — mitigation: each detailed plan names the old and new owner
  and one cutover point.
- Saved-layout conversion could strand a workspace — mitigation: Step 3 preserves
  legacy bytes and proves malformed/incompatible recovery before writing.
- Parallel ports could drift — mitigation: Step 6 proves the shared boundary;
  later ports own disjoint families and return shared changes to the lead.
- Desktop-first ports could defer mobile/accessibility — mitigation: each visible
  port carries those acceptance rows; Step 12 only integrates and certifies them.
- Final cutover could miss a legacy consumer — mitigation: Step 12 requires GMCP
  and compatibility censuses, one immutable candidate, and rollback evidence.

## Decision gates

### User decision gates

- None currently. Phase 2 remains one-session; Phase 3 owns functional tabs and
  shared-set workflows; Phase 4 owns legacy deletion
  (`docs/plans/multi-connection-ui-proposal.md:391-395`).

### Evidence and experiment gates

- Phase 1 entry: Step 16 is `COMPLETE` and its full local/hosted battery is green
  for one candidate
  (`docs/plans/phase-1/multi-connection-ui-phase-1-step-16-decision.md:94-101`).
- Parity scope: Step 1 maps each current workflow and release boundary to an
  automated fixture or explicitly owned manual check.
- Persisted layout: Step 3 proves its migration/recovery policy on real and
  malformed fixtures using the real session host.
- GMCP ownership: Step 6 reconciles the frozen contract, registration census,
  deferred owner ledger, and representative fixtures.
- Packaged editor: Step 9 proves bundled CodeMirror from built web and a
  source-free Electron package without external editor CDN access.

## Step dependency order

```text
Phase 1 Step 16 COMPLETE
  -> 1 parity and cutover contract
  -> 2 Svelte shell and one-session host
       -> 3 workspace, layout, and mobile sheet
            -> 4 terminal, input, completion, automation
            -> 6 panel boundary and core information panels
                 -> 7 map, world, room media, and playlist
                 -> 8 server windows and interactive workflows
                 -> 9 IDE and bundled CodeMirror
                 -> 10 notifications, sound, and media
                 -> 11 combat, tutorial, effects, and specialty surfaces
       -> 5 settings and configuration editors

Steps 4-11 complete
  -> 12 production cutover, integrated parity, certification, Phase 3 freeze
```

Steps 3 and 5 may proceed independently after Step 2. Steps 4 and 6 may proceed
independently after Step 3. Steps 7-11 may parallelize only after Step 6 passes
and their detailed plans establish disjoint ownership. Step 12 waits for every
preceding gate.

## Individual implementation-planning steps

### Step 1 — Freeze the parity matrix and cutover contract

Detailed implementation plan:
[`multi-connection-ui-phase-2-step-1-implementation-plan.md`](multi-connection-ui-phase-2-step-1-implementation-plan.md).

**Depends on:** Phase 1 Step 16 is `COMPLETE` for one immutable candidate.

**Outcome:** Record the current one-session behavior across shell, connection,
terminal/input, automation, settings, layout, panels, maps, windows, IDE,
notifications/media, debug tooling, accessibility, mobile, Electron, and release
boundaries.

**Exit:** Every row names its evidence, current owner, Phase 2 step, and rollback
behavior; missing evidence is explicit
(`docs/plans/multi-connection-ui-proposal.md:399-455`).

**Later plan resolves:** Exact fixtures, manual checks, and any unresolved product
support decision.

### Step 2 — Establish the Svelte shell and one-session host

**Depends on:** Step 1.

**Outcome:** Make Svelte own the Phase 2 integration root, one public `Session`,
shell connection/status/theme behavior, desktop integration, app-level
accessibility, and controlled legacy islands. Do not add functional tabs, change
the default production owner, or create a second session.

**Exit:** One shell/session lifecycle passes its parity and disposal rows; legacy
islands have one owner; no Svelte code imports `SessionFacadeHandles` or infers
ownership from legacy toolbar DOM.

**Later plan resolves:** The smallest public shell/session surface and every
root-level legacy lifecycle owner.

### Step 3 — Promote the workspace, persisted layout, and mobile sheet

**Depends on:** Step 2.

**Outcome:** Promote the proven Dockview adapter into the real session lifecycle;
own character layout persistence/recovery, workspace-level keyboard/focus/touch,
responsive behavior, and the mobile panel sheet without exposing Dockview types.

**Exit:** Real-session layout operations, restore/recovery, terminal identity,
desktop/touch/mobile-sheet behavior, and repeated disposal pass; legacy layout
input remains available for rollback.

**Later plan resolves:** The current layout schema and a reversible translation or
versioned fallback.

### Step 4 — Port terminal, input, completion, and automation

**Depends on:** Step 3.

**Outcome:** Move the terminal command loop behind the workspace host while
retaining its imperative rendering algorithms. Consume the public session
automation runtime directly for history, completion, key mappings, aliases,
triggers, timers, and variables.

**Exit:** The Step 1 terminal/input/automation rows pass in development, built
web, mobile, and disposal coverage; completion owns its GMCP fixtures; terminal
identity survives layout movement and restore.

**Later plan resolves:** The call graph and the smallest independently testable
Green PR slices.

### Step 5 — Port settings and single-profile configuration editing

**Depends on:** Step 2; it may proceed independently of Steps 3, 4, and 6 after
the shell/profile boundary freezes.

**Outcome:** Replace toolbar/endpoint-derived ownership with the active character
profile and configuration services for general settings and all six editors.

**Exit:** Settings round-trip through the intended source; provenance,
precedence, atomic publication, validation, stale writes, mobile/accessibility,
and runtime-state isolation pass without the configuration compatibility facade.

**Later plan resolves:** Every existing editor/storage path and any value whose
application/server/character/set/runtime/world owner is still unclear.

### Step 6 — Extract the panel boundary through core information panels

**Depends on:** Steps 2-3 and the frozen Phase 1 GMCP policy.

**Outcome:** Port the core character/status, group, inventory, quest, achievement,
cyberware, guild/vitals/XP, lag, and diagnostics panels while extracting only the
layout-independent controller/presentation seams those real ports require. Do not
create a generic panel framework.

**Exit:** These panels render/update without legacy layout knowledge; each owned
GMCP family has direction-correct fixtures and explicit validation; desktop,
mobile, reconnect, malformed-data, and disposal rows pass; the minimal proven
boundary for Steps 7-11 is frozen.

**Later plan resolves:** Exact vertical slices, representative wire fixtures, and
any consumer that appears to require an internal session handle or Dockview type.

### Step 7 — Port map, world, room-media, speedwalk, and playlist surfaces

**Depends on:** Step 6.

**Outcome:** Host the retained map algorithms behind Svelte/workspace surfaces
while preserving world-owned data and session-owned view state
(`docs/plans/multi-connection-ui-proposal.md:226-235`).

**Exit:** Map hydration/navigation, view isolation, room media, playlist actions,
layout restore, mobile interaction, typed/outbound GMCP, and disposal pass.

**Later plan resolves:** Existing map data/view/storage ownership and the exact
MapData2/room/playlist fixtures.

### Step 8 — Port server windows and interactive workflows

**Depends on:** Step 6.

**Outcome:** Port `Darkwind.Window`, snoop, announcements, Giphy, broadcast,
Linux rescue, fishing, and their actions to session-scoped Svelte roots and
controllers.

**Exit:** Open/update/close, focus, user actions, responsive presentation,
reconnect, malformed input, and disposal pass for every assigned family.

**Later plan resolves:** Generic versus specialized window lifecycles and the
independent vertical slices.

### Step 9 — Port the IDE and bundle CodeMirror

**Depends on:** Step 6.

**Outcome:** Port IDE transfer/edit/save behavior to the workspace and replace the
runtime CDN editor with only the CodeMirror packages/features needed for parity.

**Exit:** IDE transfer/session/focus/layout/disposal rows pass; built web and a
source-free Electron package execute the editor without external CDN access.

**Later plan resolves:** The actually used CodeMirror extensions, IDE fixtures,
and mobile fallback.

### Step 10 — Port notifications, sound, and media controls

**Depends on:** Steps 4 and 6.

**Outcome:** Port one-session notifications, output-line navigation, sound
controls/engine integration, and login/room media while keeping Phase 3
background and cross-session policy out.

**Exit:** Mention/navigation, permission and locked-audio behavior, playback,
Electron paths, mobile controls, GMCP contracts, reconnect, and disposal pass.

**Later plan resolves:** Application-owned browser/engine resources versus
character/session-owned notification and playback state.

### Step 11 — Port combat, tutorial, effects, and specialty surfaces

**Depends on:** Step 6.

**Outcome:** Port combat, tutorial, visual effects, Street Samurai, and their
textual fallbacks without adding new design or gameplay behavior.

**Exit:** Each owner-ledger group has one Phase 2 port; ordering, reconnect,
textual fallback, reduced motion, desktop/mobile presentation, and disposal pass.

**Later plan resolves:** Timing/animation/accessibility behavior and independent
lifecycle slices.

### Step 12 — Cut over, certify Phase 2, and freeze Phase 3 interfaces

**Depends on:** Every Step 1-11 gate is green. No partial cutover.

**Outcome:** Make the Svelte/Dockview ports the production one-session frontend;
run integrated web/Electron/mobile/accessibility parity against one immutable
candidate; record remaining Phase 3/4 debt; certify or return failures to their
owning step.

**Exit:** Root quality/build/artifact, browser, production browser, mobile,
accessibility/theme/focus, transports, Electron smoke/source-free package,
Docker, and MCP are green for the same candidate; GMCP and compatibility censuses
have no unowned consumer; direct hosted evidence supports `COMPLETE`; rollback to
the pre-cutover artifact is evidenced.

**Later plan resolves:** The exact command/candidate workflow and documentation-
only attestation. Any executable change creates a new candidate.

## Phase 2 gate

Phase 2 is `COMPLETE` only when all must-have outcomes pass for one immutable
candidate with required hosted evidence, every remaining debt item has a Phase 3
or Phase 4 owner, functional multi-session behavior is absent, and the rollback
artifact remains usable. Otherwise it stays `OPEN` and the failure returns to its
owning step.

## Rollback

Steps 1-11 do not become the production owner. Each detailed plan preserves its
predecessor and names its local rollback; no user-facing long-lived feature flag
is introduced.

Step 3 retains the legacy layout byte-for-byte and uses a versioned or otherwise
explicitly reversible new record. No rollback deletes either layout
automatically.

Step 12 rollback serves the last certified pre-cutover artifact, which continues
to use preserved legacy sources, keys, and adapters. A failed candidate stays
`OPEN`, returns to its owning step, and reruns affected downstream gates. Phase 4
alone removes the legacy rollback path.

## Execution fit

- Scope: multi-run phase
- Lead: Sol at high reasoning — one owner must preserve the shared shell,
  workspace, lifecycle, GMCP, cutover, and final evidence contracts
- Workers: selected by each detailed plan; Steps 7-11 are candidates only after
  Step 6 freezes interfaces and disjoint ownership
- Delegation shape: staged shared work, optional parallel owned ports, lead-owned
  integration and certification
- Ownership: the lead owns shared changes, candidate selection, rollback, and the
  Phase 2/Phase 3 decision
- Replan trigger: a port needs internal session handles, Dockview types, or active
  DOM ownership; layout cannot migrate reversibly; port families overlap; or a
  parity/release gate fails
- Confidence: medium-high — ownership is documented, but implementation remains
  correctly blocked on Phase 1 certification and its GMCP contract

Plan self-review: PASS (9/10)

Notes:

- The 12 steps are mid-level planning horizons; implementation files, commands,
  PR slices, and worker assignments remain deferred to each step's planning
  session.
- The first real panel port proves the shared boundary; no speculative panel
  framework step remains.
- Mobile/accessibility work is owned where behavior is built and certified again
  at final integration. Cutover remains “after all gates.”
