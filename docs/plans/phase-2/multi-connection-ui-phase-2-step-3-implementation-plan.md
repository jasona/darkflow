# Phase 2 Step 3 Implementation Plan

_Plan stress-tested via focused adversarial review. Twelve findings surfaced;
ten survived. Ponytail full keeps this step to the approved adapter, the existing
character-profile graph, one real workspace host, and one browser fixture._

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 — this is one bounded workspace vertical slice, but it joins
  the real session lifecycle, character-owned persistence, Dockview layout,
  terminal DOM identity, responsive presentation, touch, accessibility, and
  deterministic disposal
- Hard triggers: none; the Phase 2 master plan already supplies the phase map and
  makes Step 3 a bounded implementation horizon
- Current planning horizon: Phase 2 Step 3 only — complete parity rows `P2-3-*`
  in the non-production `/phase2/` entry
- Evidence horizon: the completed Step 2 shell/session host, Step 1 parity rows,
  approved Phase 0 adapter and tests, character workspace schema/repository,
  legacy panel persistence, current mobile sheet, and browser build matrix
- Adversarial review: focused — challenge duplicate workspace code, leaky public
  APIs, lossy migration, save storms, restore failure, terminal remounting,
  mobile duplication, test-only surfaces, disposal, and rollback

## Planning status

Step 2 is locally `COMPLETE` on branch `story/multi-connections-phase2`; its
preview owns one public session while `/` remains the legacy production root
(`multi-connection-ui-phase-2-step-2-implementation-plan.md:22-34`). Step 3 is
ready to implement but remains `PLANNED` until all four Green PRs and the
completion gate pass.

This plan changes documentation only. It does not authorize production cutover,
mark a `P2-3-*` row green, or claim that the currently skipped Phase 0 touch test
ran. Step 12 remains the only production cutover and packaged-Electron gate
(`multi-connection-ui-phase-2-step-1-parity-matrix.md:43-50`).

## Goal

Replace the inert Phase 2 content host with one real-session Dockview workspace.
The workspace must preserve one imperative terminal DOM island while panels are
opened, closed, focused, docked, floated, resized, saved, and restored; persist
the Dockview layout to the active character profile; recover to a usable default
without losing the migrated legacy layout; present the same mounted workspace
through an accessible mobile panel sheet; and dispose with the public session.

The step succeeds when rows `P2-3-panel-layout`, `P2-3-layout-recovery`,
`P2-3-terminal-layout-identity`, and `P2-3-mobile-sheet-touch` pass in development
and built web. Step 3 does not port terminal behavior or information-panel data;
Steps 4 and 6 retain those owners.

## Evidence and constraints

- Step 3 owns the real workspace lifecycle, character layout persistence and
  recovery, workspace keyboard/focus/touch behavior, responsive behavior, and
  the mobile sheet; its exit explicitly requires real-session layout operations,
  terminal identity, restore/recovery, mobile behavior, and repeated disposal
  (`multi-connection-ui-phase-2-implementation-plan.md:232-244`).
- The four frozen Step 3 rows require built-web, mobile/touch,
  keyboard/focus/theme, and disposal evidence. `/phase0/` evidence and the
  skipped `workspace-touch.spec.ts` are explicitly not replacement evidence
  (`multi-connection-ui-phase-2-step-1-parity-matrix.md:87-96`).
- Step 2 currently renders one inert `phase2-content-host`, never imports
  `/js/app.js`, and unmounts the Svelte root through `Session.onDispose`
  (`client/app/App.svelte:197-256`, `client/app/phase2.ts:102-115`). Step 3 replaces
  that inert host; it must not start the legacy panel manager beside it.
- The Phase 0 workspace contract is vendor-neutral and already covers panel
  upsert/remove, save/restore, and disposal
  (`client/phase0/workspace/workspace.ts:17-49`). Dockview types are confined to
  the adapter (`client/phase0/workspace/dockview-workspace.ts:162-170`).
- The adapter already retains Svelte renderer identity on updates, keeps the
  terminal renderer mounted when hidden, preserves focus during placement, uses
  `reuseExistingPanels` on restore, rejects incompatible/malformed layouts, and
  awaits renderer unmounts during disposal
  (`client/phase0/workspace/dockview-workspace.ts:247-300`,
  `client/phase0/workspace/dockview-workspace.ts:423-524`). Promote that code;
  do not fork a second Dockview adapter.
- Phase 0 proved terminal DOM identity, buffer, focus, native scroll position,
  layout restore, malformed recovery, 25 add/remove cycles, and zero final
  workspace resources, but its terminal is synthetic and its bridge/diagnostics
  are not production APIs
  (`../phase-0/multi-connection-ui-phase-0-step-6-dockview-decision.md:37-43`,
  `../phase-0/multi-connection-ui-phase-0-step-6-dockview-decision.md:96-110`).
- Character profiles already own an opaque, versioned, JSON-safe workspace
  snapshot (`client/model/profiles.ts:41-57`). The repository validates the full
  graph and commits it with one storage write (`client/storage/repository.ts:26-69`).
  No application-schema revision or new storage key is required.
- Phase 1 migration copied the legacy `darkwind-panel-state` object into only the
  active character workspace and deliberately left every legacy key unchanged
  (`client/storage/legacy-migration.ts:112-179`,
  `test/session-storage.test.mjs:157-219`). Step 3 must retain both the migrated
  fallback and the original legacy key byte-for-byte.
- The current legacy mobile owner switches at a width breakpoint, keeps a desktop
  snapshot, and presents one active panel through a sheet
  (`public/js/panel-manager.js:1919-2009`,
  `public/js/panel-manager.js:2906-3055`). Preserve the user-visible sheet
  behavior, not that mutable singleton or its panel DOM movement.
- Dockview 7.0.4 is already exact-pinned and approved; no dependency decision is
  open (`../phase-0/multi-connection-ui-phase-0-step-6-dockview-decision.md:3-29`).

## Decisions

### Promote one adapter; keep Phase 0 as a consumer

Relocate the vendor-neutral workspace contract, Dockview adapter/style import,
renderer lifecycle diagnostics, terminal island, and terminal panel from
`client/phase0/workspace/` to `client/workspace/`. Update the Phase 0 harness to
import the promoted modules so its existing lifecycle suite remains a regression
test of the same implementation used by `/phase2/`.

Add only the production capabilities Step 3 needs to the vendor-neutral
contract:

```ts
activatePanel(id: string): void;
subscribeLayout(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
```

The adapter owns its host `ResizeObserver`, calls Dockview layout with the current
host bounds, enables Dockview's installed keyboard navigation, and releases both
the observer and layout subscription on disposal. It emits serialized snapshots
only after initialization/restore completes so initial seeding and recovery do
not create an unsolicited storage write.

Do not add `WorkspaceInspector` to the production `Workspace` contract, expose
Dockview APIs or types, publish `window.__darkflowWorkspace` from `/phase2/`, or
add a second adapter. The adjacent diagnostics/inspection surface remains usable
only by the Phase 0 harness.

### Use a versioned fallback, not a legacy translation

The existing character `workspace` envelope remains the persistence boundary.
Step 3 stores this exact logical shape:

```ts
{
  version: 2,
  payload: {
    dockview: DockviewWorkspaceSnapshot,
    legacy: CharacterWorkspaceSnapshot
  }
}
```

On a valid version-2 record, restore `dockview` and carry `legacy` forward
unchanged. On a migrated version-1 record, an incompatible version, or malformed
Dockview data, retain the entire existing character workspace as `legacy`, seed
the fixed default Dockview layout, and report recovery in the shell. A later
successful user layout change may store a fresh `dockview` snapshot, but it must
not rewrite the retained `legacy` value or the `darkwind-panel-state` key.

This is intentionally not a heuristic conversion from legacy dock/float pixels
to Dockview groups. The formats have different semantics, and a guessed mapping
would create more code while weakening rollback.

### Persist from the character graph without widening `Session`

Add two focused workspace-persistence functions that load and save by
`session.characterProfileId`. Saving re-reads the validated graph, changes only
that character's `workspace`, and uses the existing repository `commit`. It
returns a result the shell can display; storage failure never destroys the live
workspace or legacy fallback.

The workspace host debounces layout writes with one short timer and flushes the
latest pending snapshot on `visibilitychange`, `pagehide`, and component/session
disposal. No new public `Session` method, global store, persistence service class,
or generic mutation API is added.

### Keep one workspace DOM across desktop and mobile

`WorkspaceHost.svelte` owns one Dockview host for the session. Desktop renders it
in the shell content area. At the existing narrow breakpoint, opening Panels
presents that same host as a modal bottom sheet; it does not create another
workspace, renderer, terminal, or saved mobile layout. Native sheet buttons call
`activatePanel` for the selected open panel.

The sheet owns a labelled dialog, close button, outside click, Escape, initial
focus, return focus, visible focus rings, scroll containment, safe-area padding,
and reduced-motion styles. Dockview remains responsible for docking, floating,
resizing, pointer/touch drag, and its native keyboard navigation. The terminal
stays registered with `preserveDomWhenHidden`; the mobile view changes visibility
and active panel only.

### Seed only the port boundary Step 3 can honestly own

Register one terminal island and one inert panel-host placeholder. The terminal
is always present and not offered as a closable panel; the placeholder can be
opened/closed and gives the adapter two real panels for movement and restore
evidence. Step 4 replaces the terminal island's synthetic content with the real
output/input owner, and Step 6 replaces the placeholder with actual information
panels.

Do not import `public/js/output.js`, `panel-manager.js`, `panel-defs.js`, or any
GMCP renderer to make Step 3 appear feature-complete.

## Must-haves

- [MH1] One approved adapter serves Phase 0 and Phase 2 — acceptance: production
  workspace imports resolve from `client/workspace/`; Phase 0 lifecycle tests
  still pass against those files; only the adapter imports `dockview`; no copied
  adapter or new dependency exists.
- [MH2] The real session owns one workspace — acceptance: `/phase2/` replaces the
  inert content host with one Dockview host tied to the existing session ID;
  `/js/app.js` and the legacy panel manager do not load; `Session.dispose()`
  removes the workspace and all owned renderers, subscriptions, observers,
  timers, dialogs, and DOM.
- [MH3] Panel layout operations work without leaking vendor APIs — acceptance:
  the terminal and placeholder can be focused, docked, floated, moved, and
  resized; the placeholder can close/reopen; keyboard navigation uses Dockview's
  installed behavior; Svelte/app code imports no Dockview type and no Phase 2
  test bridge is published.
- [MH4] Terminal DOM identity is singular and stable — acceptance: movement,
  tab hiding/showing, floating, resize, in-document save/restore, mobile sheet
  open/close, and placeholder close/reopen retain the terminal element identity,
  text, focus, and scroll position; exactly one terminal island exists. Actual
  output/input behavior remains Step 4.
- [MH5] Layout persistence is character-owned and atomic — acceptance: a layout
  change updates only `session.characterProfileId` through one validated graph
  commit; another character's workspace and every non-workspace graph field are
  unchanged; pending writes coalesce and flush on page hide/disposal.
- [MH6] Legacy layout remains a reversible fallback — acceptance: migrated
  version-1, valid version-2, incompatible, malformed, missing-panel, and storage-
  failure fixtures recover without an empty terminal; the retained `legacy`
  value and `darkwind-panel-state` bytes are unchanged; repeated saves do not
  nest fallback envelopes.
- [MH7] Reload restores the real layout — acceptance: development and built-web
  browser scenarios move/float/resize, wait for commit, reload `/phase2/`, and
  recover panel group/order/bounds within the existing 2 px tolerance while
  creating one fresh terminal island for the new document.
- [MH8] The mobile sheet uses the same workspace — acceptance: at 390-by-844 the
  Panels control opens a labelled modal sheet, panel selection activates the
  requested renderer, Escape/close/outside click restore focus, sheet cycles do
  not remount the terminal, safe areas remain usable, and reduced motion removes
  nonessential transitions.
- [MH9] Real-session touch evidence replaces the gap honestly — acceptance: a
  dedicated `mobile-chromium` project runs the Phase 2 workspace scenario with
  touch input for tab activation, Dockview long-press drag, sheet navigation,
  and teardown in development and built web. The skipped Phase 0 file remains
  `NOT_RUN`, not cited as replacement evidence.
- [MH10] Repeated disposal is deterministic — acceptance: repeated Phase 2 boot/
  dispose cycles leave no workspace-owned DOM, layout timer, storage callback,
  ResizeObserver, sheet, or duplicate terminal; a second session disposal is
  harmless and the legacy `/` root remains green.
- [MH11] Evidence stays scoped — acceptance: only the four `P2-3-*` rows receive
  Step 3 replacement evidence; packaged Electron remains `MISSING (Step 12)`,
  Step 4/6 behavior remains open, and `/` stays the production owner.

## Out of scope

- Replacing `/`, deploying `/phase2/`, certifying Phase 2, or changing the Step 12
  cutover rule.
- Real terminal output, command input, history, completion, automation, or GMCP
  variable behavior — Step 4 owns those ports.
- Character, inventory, map, window, IDE, settings, notification, sound, combat,
  tutorial, effect, or specialty panel content — Steps 5-11 own those ports.
- Translating legacy dock/float coordinates into Dockview, deleting or rewriting
  the legacy panel key, deleting the Phase 0 harness, or changing application
  schema version 1.
- A public workspace on `Session`, a Dockview-aware Svelte API, router, global
  store, generic panel framework, generic legacy-island registry, or test bridge.
- Functional connection tabs, inactive workspaces, shared workspace presets,
  physical-device testing, or packaged-Electron evidence.

## Assumptions

- [The exact legacy layout is not product-required as the initial Dockview
  arrangement] — if false: stop before Green PR 2 and define a tested product
  mapping for each legacy profile shape; do not infer coordinates ad hoc.
- [A version-2 character workspace inside the existing opaque field is accepted
  by the frozen application graph] — if false: Step 3 requires an explicit
  versioned application migration and must be replanned before any write.
- [Dockview keyboard navigation and pointer strategy cover the required workspace
  operations when enabled] — if false: use the native panel menu/mobile controls
  for activation and replan only the failing Dockview interaction; do not build a
  parallel keyboard layout engine.
- [Playwright's emulated mobile Chromium remains the supported Step 3 touch gate]
  — if false: add the named physical-device gate before marking MH9 complete.
- [One terminal and one inert placeholder are sufficient to prove the Step 3
  workspace boundary] — if false: move only the newly required panel's owning
  Step forward; do not import all legacy panel content.

## Risks

- Relocation could make Phase 0 and production imports drift — mitigation: move
  rather than copy, retain the existing Phase 0 browser suite, and keep Dockview
  imports confined to one adapter.
- Dockview layout events could commit during restore or on every resize tick —
  mitigation: suppress emission through initial seed/restore, debounce one latest
  snapshot, and unit-test write count plus disposal flush.
- A bad or future snapshot could clear the workspace and strand the terminal —
  mitigation: restore transactionally from the validated envelope, seed the fixed
  terminal layout on any rejection, and retain the rejected value as fallback.
- The whole-graph commit could clobber adjacent state — mitigation: re-read
  immediately before the synchronous commit, change only the selected character
  workspace, and assert byte-equivalent unrelated profiles/defaults/sets in the
  persistence test.
- Mobile presentation could remount renderers or corrupt desktop layout —
  mitigation: use CSS presentation of the same host, keep one persisted layout,
  call `activatePanel`, and compare terminal identity plus saved desktop layout
  before and after sheet cycles.
- Svelte teardown does not await the adapter promise directly — mitigation: start
  `workspace.dispose()` in component cleanup, make it idempotent, and poll the
  observable zero-owned-resource boundary before the browser test continues.
- The inert placeholder could accidentally become a permanent feature —
  mitigation: name it as a port placeholder, give it no state or protocol
  behavior, and make Step 6 replace its registry entry rather than generalizing it.
- A passing desktop fixture could hide the current touch gap — mitigation: add a
  real-session mobile project in both dev and production configs and never cite
  the skipped Phase 0 spec.

## Green PR sequence

The four Green PRs are independently reviewable, preserve the default `/` owner,
and keep the legacy panel key untouched. Repair a failing slice before starting
its dependent slice. Evidence recording is the completion gate after Green PR 4,
not a fifth implementation PR.

### Green PR 1 — Promote the approved workspace adapter

**Files:** `client/workspace/workspace.ts`,
`client/workspace/dockview-workspace.ts`,
`client/workspace/dockview-styles.js`,
`client/workspace/lifecycle-diagnostics.ts`,
`client/workspace/terminal-island.ts`,
`client/workspace/TerminalPanel.svelte`, `client/phase0/main.ts`,
`client/phase0/workspace/LifecyclePanel.svelte`,
`client/phase0/workspace/workspace-test-bridge.ts`,
`e2e/workspace-test-bridge.ts`, `e2e/workspace-lifecycle.spec.ts`,
`package.json`

**Intent:** Move the reusable Phase 0 modules to `client/workspace/` and update
the harness imports. Extend the vendor-neutral interface with `activatePanel`
and `subscribeLayout`; add one adapter-owned host `ResizeObserver`, installed
Dockview keyboard navigation, initialization emission suppression, and complete
cleanup. Keep `WorkspaceInspector`, diagnostics injection, and the window bridge
available only to the Phase 0 harness.

Update the existing lint/format globs to include `client/workspace` rather than
adding new scripts. Do not change visible Phase 0 behavior or add Phase 2 UI yet.

**Tests:** Extend the existing lifecycle scenario to prove layout subscription
emits after a user operation but not seed/restore, unsubscribe stops delivery,
host resize relayouts, activation preserves terminal focus/identity, and disposal
releases the added observer/listener.

**Verify:**

```sh
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run typecheck
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run check
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser -- e2e/workspace-lifecycle.spec.ts --project=chromium
```

**Done when:** Phase 0 passes against the relocated implementation, only one
source file imports Dockview, the production contract contains no Dockview type,
and the adapter exposes exactly the two newly required operations.

### Green PR 2 — Add reversible character workspace persistence

**Files:** `client/workspace/persistence.ts`,
`test/workspace-persistence.test.mjs`, `client/model/profiles.ts`

**Intent:** Implement the version-2 envelope and focused load/save functions from
the Decisions section. Read the selected character through the existing
repository, semantically accept only a version-1 Dockview snapshot with an object
layout, preserve one non-nesting legacy fallback, and commit only the selected
workspace. Correct the stale model comment that assigns workspace migration to
Phase 1 Step 4; do not weaken the opaque JSON-safe graph type.

**Tests:** Through the repository's existing Vite SSR pattern, cover migrated
version 1, valid version 2, malformed layout, incompatible versions, unknown
character, validation failure, thrown storage write, repeated saves, and two
characters. Assert the original legacy key string and all unrelated graph values
are unchanged.

**Verify:**

```sh
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin node --test test/workspace-persistence.test.mjs test/session-storage.test.mjs
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run typecheck
```

**Done when:** A valid Dockview snapshot round-trips under one character profile,
invalid data returns a recoverable fallback, and no legacy byte, other profile,
schema version, or storage key changes.

### Green PR 3 — Mount the workspace in the real session lifecycle

**Files:** `client/app/App.svelte`, `client/app/phase2.ts`,
`client/workspace/WorkspaceHost.svelte`,
`client/workspace/PlaceholderPanel.svelte`,
`client/workspace/TerminalPanel.svelte`,
`client/workspace/terminal-island.ts`, `e2e/phase2-workspace.spec.ts`,
`playwright.production.config.ts`

**Intent:** Replace `phase2-content-host` with `WorkspaceHost`. Pass only the
public session identity and the focused persistence functions; do not pass
factory handles or the application graph. Register the terminal and inert
placeholder, restore a valid saved layout or seed the fixed default, expose an
accessible Panels menu for placeholder open/close and focus, debounce layout
saves, show save/recovery status, and flush/dispose through Svelte/session cleanup.

Keep the terminal renderer always mounted and give its existing imperative
element stable test-observable identity, buffer, focus, and scroll state. Do not
bind it to the transport text sink or input until Step 4.

**Tests:** The real `/phase2/` browser fixture proves one session/workspace,
absence of `/js/app.js`, open/close/focus, pointer dock/float/resize, terminal
identity across those operations and live restore, coalesced profile save,
reload restore, malformed/missing-panel recovery, visible storage failure,
repeated boot/dispose, and unchanged `/` behavior. It reads persisted storage and
DOM only; it does not publish or call a production workspace bridge.

**Verify:**

```sh
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser -- e2e/phase2-workspace.spec.ts --project=chromium
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run build
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser:production -- e2e/phase2-workspace.spec.ts --project=chromium
```

**Done when:** Rows `P2-3-panel-layout`, `P2-3-layout-recovery`, and
`P2-3-terminal-layout-identity` meet their development/built cutover conditions
on a real session host without claiming Step 4 terminal parity.

### Green PR 4 — Present the same workspace through the mobile sheet

**Files:** `client/workspace/WorkspaceHost.svelte`,
`client/workspace/dockview-workspace.ts`, `e2e/phase2-workspace.spec.ts`,
`playwright.config.ts`, `playwright.production.config.ts`, `package.json`

**Intent:** Add the narrow-viewport Panels button and same-host modal sheet,
native panel selection, Escape/outside/close handling, focus entry/return,
safe-area/scroll containment, visible focus, and reduced-motion CSS. Enable a
dedicated `mobile-chromium` project for only the real Phase 2 workspace spec in
development and built-web configurations. Remove the built-browser script's
hard-coded Chromium selection so the config can run both scoped projects; do not
add another script. Leave the skipped Phase 0 touch file unchanged.

Use the existing Dockview pointer strategy for touch docking and floating. If a
real interaction fails, fix the adapter boundary or record an explicit missing
facet; do not replace the test with direct adapter calls.

**Tests:** At 390-by-844, open the sheet, activate both panels, exercise a
touch-typed long-press drag, close by button/Escape/backdrop, verify focus return,
cycle the sheet without changing terminal identity, resize back to desktop
without changing saved layout, dispose, and assert zero owned DOM. Repeat the
same observable scenario against the built artifact.

**Verify:**

```sh
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser -- e2e/phase2-workspace.spec.ts --project=mobile-chromium
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run build
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser:production -- e2e/phase2-workspace.spec.ts --project=mobile-chromium
```

**Done when:** `P2-3-mobile-sheet-touch` has real-session development and built
evidence for touch, keyboard/focus, reduced motion, and disposal, while the old
skipped Phase 0 test remains `NOT_RUN`.

### Completion gate — Run the Step 3 regression battery and record evidence

**Files:**
`docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md`,
`docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md`,
`docs/plans/phase-2/multi-connection-ui-phase-2-step-3-implementation-plan.md`

**Intent:** After Green PR 4, run the complete Step 3 battery from one clean
implementation candidate. Append replacement evidence only to the four `P2-3-*`
rows, link that implementation revision, and set Step 3 `COMPLETE` only when
every owned facet is green. This documentation closeout may be the final commit
on the Step 3 branch, but it is not another implementation PR. Keep Electron/
package evidence, Steps 4-12, legacy rollback text, and the default root status
unchanged.

Use the repository-pinned Node/npm toolchain:

```sh
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm test
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run typecheck
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run check
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run lint
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run format:check
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run build
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser -- --project=chromium
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser -- e2e/phase2-workspace.spec.ts --project=mobile-chromium
env PATH=/Users/anderson/.nvm/versions/node/v22.15.0/bin:/usr/bin:/bin npm run test:browser:production
git diff --check
npx prettier --check docs/plans/phase-2/multi-connection-ui-phase-2-step-1-parity-matrix.md docs/plans/phase-2/multi-connection-ui-phase-2-implementation-plan.md docs/plans/phase-2/multi-connection-ui-phase-2-step-3-implementation-plan.md
```

**Done when:** One candidate has all local Step 3 evidence, the four owned rows
are green without overstating packaged Electron or terminal/panel feature parity,
the legacy bytes and root remain available, and Steps 4 and 6 can plan against
the frozen workspace host.

## Success criteria

- [ ] MH1-MH11 are satisfied by Green PRs 1-4 and confirmed by the completion
      gate.
- [ ] `/phase2/` owns one real-session Dockview workspace and `/` still owns the
      legacy client.
- [ ] One terminal DOM island retains identity through layout and mobile-sheet
      operations; Step 4 behavior remains explicitly open.
- [ ] The active character's valid version-2 layout restores after reload while
      the retained legacy fallback, original legacy key, other profiles, and
      graph fields remain unchanged.
- [ ] Malformed/incompatible/missing-panel/storage-failure scenarios recover to a
      usable terminal layout without destructive writes.
- [ ] Desktop Chromium and dedicated mobile Chromium pass the real-session
      workspace fixture in development and built web.
- [ ] Repeated disposal leaves no workspace-owned root, host, terminal, observer,
      listener, save timer, sheet, or duplicate callback.
- [ ] Unit, type, Svelte, lint, format, build, development-browser,
      production-browser, and diff/plan-format checks exit cleanly.
- [ ] Only `P2-3-*` rows receive evidence; packaged Electron and later ports stay
      open.

## Rollback

Step 3 does not change `/`. Runtime rollback is to stop serving or remove the
non-linked `/phase2/` workspace integration and return that preview to Step 2's
inert content host. Revert Green PRs 4 through 1 in reverse order: mobile sheet,
real-session mount, persistence, then adapter promotion. Correct the completion
record separately so it never claims reverted evidence.

The original `darkwind-panel-state` key is never changed. Every version-2
character workspace retains its prior workspace under `payload.legacy`, so a
rollback reader can restore the exact migrated fallback. The certified legacy
root and pre-Step-3 artifact remain the functional rollback path.

If a persistence or restore gate fails, leave Step 3 `OPEN`, do not write a
replacement snapshot, and keep the live default workspace usable for diagnosis.
Do not delete bad data, switch `/`, or import the legacy panel manager into the
preview to bypass the failure.

## Execution fit

- Scope: multi-run phase
- Lead: Terra at high reasoning — the implementation is bounded, but one owner
  must preserve the adapter boundary, profile bytes, save/restore ordering,
  terminal identity, mobile same-DOM rule, and cross-runtime evidence
- Workers: none — the Green PRs share the adapter/persistence/workspace contract
  and must land sequentially
- Delegation shape: solo staged handoff
- Ownership: the lead owns the vendor boundary, persistence policy, shell
  integration, rollback decision, candidate selection, and final verification
- Replan trigger: the profile field rejects version 2; the real workspace needs
  an internal session handle; Dockview restore cannot retain terminal identity;
  a touch/keyboard operation cannot pass through the approved adapter; same-host
  mobile presentation corrupts desktop layout; or any legacy `/` gate regresses
- Confidence: medium-high — the adapter, schema envelope, repository, shell, and
  legacy/mobile precedents are verified; the remaining uncertainty is real-host
  mobile/touch behavior, isolated behind Green PR 4's explicit gate

Plan self-review: PASS (9/10)

Notes:

- Every must-have maps to Green PRs 1-4 and a runnable completion check.
- The plan adds no dependency, public session capability, second workspace,
  generic panel framework, legacy translation, or production test bridge.
- The executor must preserve the distinction between the skipped Phase 0 touch
  test and new real-session Step 3 evidence.
