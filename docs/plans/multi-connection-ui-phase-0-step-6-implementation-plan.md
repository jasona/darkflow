# Phase 0 Step 6 Implementation Plan

*Plan stress-tested via five-lens adversarial review. 18 findings surfaced, 14 survived.*

## Goal

Evaluate Dockview as Darkflow's future workspace engine without changing the
legacy client or committing to a production migration. Success means the
isolated Phase 0 harness proves that Svelte panels, imperative terminal
content, layout persistence, desktop and touch interaction, and complete
teardown remain reliable under Dockview.

Step 5 already provides the shared Express/Vite development server and
three-browser Playwright foundation. This step extends only that isolated
harness and ends with an explicit approve-or-reject decision.

## Must-haves

- [MH1] Pin `dockview` 7.0.4 exactly in the frontend toolchain. Acceptance:
  the manifest and lockfile contain no range and import `dockview`, never
  `dockview-core`. Version 7 made `dockview` the framework-agnostic package.
  See the [Dockview v7 notes](https://dockview.dev/docs/overview/whats-new-v7/)
  and [npm package](https://www.npmjs.com/package/dockview?activeTab=versions).
- [MH2] Allow third-party declaration checking to be skipped without weakening
  Darkflow source checks. Acceptance: `skipLibCheck: true` is set in both
  TypeScript configurations while `strict`, `exactOptionalPropertyTypes`, and
  `noUncheckedIndexedAccess` remain enabled for project source. See the
  [TypeScript option documentation](https://www.typescriptlang.org/tsconfig/skipLibCheck.html).
- [MH3] Keep Dockview behind a vendor-neutral workspace interface. Acceptance:
  only the Dockview adapter implementation imports Dockview code or types.
- [MH4] Give every panel exactly one Svelte root and one stable writable state
  store. Acceptance: updating an existing panel changes its rendered state
  without changing its root identity or increasing its mount count.
- [MH5] Make renderer disposal deterministic and idempotent. Acceptance: panel
  removal or workspace disposal invokes Svelte `unmount` exactly once, awaits
  its promise, releases the host element, and leaves no active owned listener,
  observer, subscription, or root.
- [MH6] Prove the imperative terminal-island boundary. Acceptance: terminal
  node identity, buffered content, focus, and scroll position survive grid
  movement, floating, resize, and in-place layout restoration.
- [MH7] Prove layout operations and recovery. Acceptance: add, update, remove,
  dock, float, resize, save, restore, malformed restore, and repeated
  create/remove cycles behave predictably without remounting unaffected panels.
- [MH8] Cover Chromium, Firefox, WebKit, and an emulated touch project.
  Acceptance: desktop layout tests pass in all three browser engines and a
  long-press touch drag changes panel placement in the mobile project.
- [MH9] Record a binary Dockview decision. Acceptance: the decision record
  contains the exact version, command evidence, each gate result, known
  limitations, and either `APPROVED` or `REJECTED`.

## Out of scope

- Porting or modifying `public/js/output.js`, `panel-manager.js`, or other
  legacy client modules; the spike uses representative fixtures only.
- Replacing the visible client at `/`; the existing root remains the default.
- Multi-session state, GMCP migration, connection tabs, or production workspace
  persistence.
- A production localStorage schema, migrations, or persisted runtime panel
  data.
- Dockview popout windows, complete accessibility parity, theming parity, or
  CodeMirror integration.
- Electron/Docker artifact cutover, which remains in later Phase 0 steps.
- Trying alternate Dockview versions or workspace libraries inside this step;
  failure of the pinned candidate produces a rejection record.
- Disabling strict project-source checking, adding blanket error suppressions,
  or treating `skipLibCheck` as permission to ignore Darkflow type errors.

## Assumptions

- Dockview 7.0.4 is compatible with the pinned Vite/Svelte/TypeScript cohort.
  If false: reject the candidate rather than silently changing versions.
- Skipping complete checks of third-party `.d.ts` files is acceptable while
  Darkflow's imported uses and source remain type-checked. If false: remove
  `skipLibCheck` and resolve every dependency declaration error before the gate.
- `renderer: "always"` preserves the terminal DOM while hidden, as documented
  by Dockview. If false: the terminal-state gate fails.
- `fromJSON(..., { reuseExistingPanels: true })` supports in-place restoration.
  If false: identity-preserving restore fails and Dockview is rejected.
- "Identity survives restoration" means restoration within a live workspace;
  rebuilding after full workspace disposal creates new DOM. If false: the
  requested lifecycle is impossible because disposal intentionally destroys
  every root.
- A synthetic terminal with an imperative buffer, focusable viewport, and
  scroll container is representative enough for this architectural gate. If
  false: scope expands into an `output.js` extraction before Dockview can be
  approved.
- Automated touch-pointer coverage plus the existing browser matrix is
  sufficient for Phase 0. If false: approval additionally requires a
  documented physical-device smoke test.
- The existing CI browser job will pick up the added Playwright project through
  `npm run test:browser`. If false: update the workflow explicitly.

## Risks

- `skipLibCheck` can hide inconsistent dependency declarations. Mitigation:
  pin the dependency, retain strict project checks, prohibit source
  suppressions, and exercise the imported Dockview API through build and
  browser tests.
- Dockview serializes panel parameters, accidentally coupling layout
  persistence to live application state. Mitigation: persist only the internal
  renderer kind; send changing panel data through the stable Svelte store.
- Layout restoration may dispose and recreate panels. Mitigation: reconcile
  current panel definitions first and restore with `reuseExistingPanels: true`;
  assert root identity afterward.
- Asynchronous Svelte teardown may outlive synchronous Dockview disposal.
  Mitigation: collect every unmount promise and make `removePanel` and
  `dispose` await them before reporting completion.
- Self-reported diagnostics could hide leaks. Mitigation: instrument the actual
  store subscriptions, observers, event registrations, roots, and host
  elements at allocation and cleanup boundaries, then also assert no detached
  workspace-owned DOM remains.
- Touch drag tests can be timing-sensitive. Mitigation: use an isolated mobile
  project, the documented approximately 250 ms long-press gesture, bounded
  polling, and placement assertions rather than animation timing.
- A zero-height workspace can make resizing and drag targets meaningless.
  Mitigation: give the harness an explicit viewport-sized host and assert
  non-zero workspace and panel bounds before interaction.
- Dockview add/remove events can also fire during moves. Mitigation: root
  ownership follows renderer `init`/`dispose`, not container-level add/remove
  events.

## Public interfaces

Create a vendor-neutral API under `client/phase0/workspace/`:

```ts
type PanelState = Record<string, unknown>;

type PanelPlacement =
  | {
      kind: "grid";
      direction?: "left" | "right" | "above" | "below" | "within";
      referencePanelId?: string;
    }
  | {
      kind: "floating";
      bounds: { left: number; top: number; width: number; height: number };
    };

interface WorkspacePanelSpec {
  id: string;
  kind: string;
  title: string;
  state: PanelState;
  placement?: PanelPlacement;
  size?: { width?: number; height?: number };
}

interface WorkspaceSnapshot {
  version: 1;
  layout: unknown;
}

interface Workspace {
  addOrUpdatePanel(spec: WorkspacePanelSpec): void;
  removePanel(id: string): Promise<void>;
  save(): WorkspaceSnapshot;
  restore(
    snapshot: WorkspaceSnapshot,
    panels: readonly WorkspacePanelSpec[],
  ): boolean;
  dispose(): Promise<void>;
}
```

`createWorkspace(host, rendererRegistry, diagnostics?)` returns `Workspace`.
The renderer registry maps application-owned `kind` strings to Svelte
components consuming a `Readable<PanelState>` and declares whether that kind
needs Dockview's `"always"` renderer.

Behavioral rules:

- Reusing an ID updates its title, state store, optional size, and explicitly
  supplied placement without remounting.
- Omitting placement during an update preserves the user's current layout.
- Removing an unknown ID is a no-op.
- Malformed or incompatible snapshots return `false`, leave a usable empty
  workspace, and leak nothing.
- `dispose()` is idempotent; all other methods throw a consistent
  disposed-workspace error afterward.
- Dockview types, objects, component names, and serialized types remain private
  to the adapter.

## Steps

### Step 1 - Pin the candidate and establish the adapter boundary

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`,
`client/phase0/workspace/workspace.ts`

**Intent:** Add exact `dockview@7.0.4` as a development dependency, because it
is bundled like the existing Svelte frontend dependencies. Set
`skipLibCheck: true` in the client configuration and retain it in
`tsconfig.node.json`. Keep `strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, and the existing Phase 0 include boundary. Define
the public workspace types without importing Dockview.

Do not add `@ts-ignore`, disable strict mode, or suppress errors originating in
Darkflow `.ts` or `.svelte` files.

**Verify:**

```bash
npm ci
node -e "const p=require('./package.json'); if(p.devDependencies?.dockview!=='7.0.4') process.exit(1)"
node -e "const c=require('./tsconfig.json'); if(c.compilerOptions?.skipLibCheck!==true || c.compilerOptions?.strict!==true || c.compilerOptions?.exactOptionalPropertyTypes!==true || c.compilerOptions?.noUncheckedIndexedAccess!==true) process.exit(1)"
node -e "const c=require('./tsconfig.node.json'); if(c.compilerOptions?.skipLibCheck!==true || c.compilerOptions?.strict!==true) process.exit(1)"
npm run typecheck
npm run check
```

**Done when:** A clean install resolves 7.0.4 exactly, both TypeScript projects
permit skipped declaration-file checking, strict project-source checks remain
enabled, and the vendor-neutral contract type-checks without Dockview imports.

### Step 2 - Implement Svelte renderer ownership and teardown

**Files:** `client/phase0/workspace/dockview-workspace.ts`,
`client/phase0/workspace/lifecycle-diagnostics.ts`

**Intent:** Implement `createWorkspace` with Dockview's framework-agnostic API.
Each Dockview content renderer creates one host, one writable store, and one
Svelte `mount`; updates call the same store's `set`, and idempotent disposal
invokes `unmount` once and registers its promise with the workspace.

Dispose Dockview-owned event subscriptions explicitly, dispose the Dockview
instance, await pending Svelte unmounts, and remove owned DOM. Keep Dockview CSS
and all Dockview imports inside this implementation boundary.

**Verify:**

```bash
npm run typecheck
npm run check
rg -n "from [\"']dockview[\"']" client/phase0
```

**Done when:** Type and Svelte checks pass, and the search reports Dockview
imports only in the adapter implementation.

### Step 3 - Build representative Svelte and terminal panels

**Files:** `client/phase0/workspace/LifecyclePanel.svelte`,
`client/phase0/workspace/TerminalPanel.svelte`,
`client/phase0/workspace/terminal-island.ts`

**Intent:** Add:

- A reactive lifecycle panel that displays state-store changes and owns a
  tracked listener, store subscription, and `ResizeObserver`.
- A Svelte terminal wrapper that creates one imperative terminal island during
  mount and disposes it during destroy.
- A terminal island with a stable focusable scroll node, appendable in-memory
  buffer, enough content to scroll, and observable identity token.
- Diagnostics for mounts, updates, unmounts, duplicate-dispose attempts, live
  roots, subscriptions, observers, listeners, and terminal islands.

Register the terminal panel with Dockview's `"always"` renderer so hiding or
tabbing it does not detach its DOM and lose native scroll state.

**Verify:**

```bash
npm run typecheck
npm run check
npm run build
```

**Done when:** The production bundle contains the workspace fixtures, no
untransformed Typia sentinel is introduced, and all fixture resource counts can
return to zero after teardown.

### Step 4 - Extend the Phase 0 harness and desktop lifecycle coverage

**Files:** `client/phase0/App.svelte`, `client/phase0/main.ts`,
`e2e/workspace-lifecycle.spec.ts`

**Intent:** Mount the workspace below the existing Typia/HMR proof without
changing `/` or removing current assertions. Add neutral harness controls and a
typed browser test bridge for panel upsert/removal, placement, size,
save/restore, terminal mutation, diagnostics, and workspace disposal.

Playwright desktop scenarios must prove:

- Duplicate-ID updates reuse the same Svelte root and store.
- Docking, floating, and resizing retain terminal node identity and buffered
  content.
- Re-focusing immediately before an adapter-driven move or restore preserves
  focus.
- Scroll position survives hiding, movement, floating, resize, and in-place
  restore.
- Save/restore reproduces group, order, size, and floating bounds.
- Malformed restore returns `false`, leaves the workspace reusable, and leaks
  nothing.
- Twenty-five remove/re-add cycles produce matching mount/unmount counts.
- Full disposal reaches zero live roots, terminal islands, observers,
  subscriptions, listeners, and workspace-owned DOM.
- A second `dispose()` is harmless, while later mutation attempts fail
  consistently.

**Verify:**

```bash
npm run test:browser -- e2e/workspace-lifecycle.spec.ts --project=chromium
```

**Done when:** Chromium completes every lifecycle, state-preservation,
recovery, and leak assertion without page errors.

### Step 5 - Add cross-browser layout and touch gates

**Files:** `playwright.config.ts`, `e2e/workspace-lifecycle.spec.ts`,
`e2e/workspace-touch.spec.ts`

**Intent:** Keep lifecycle/layout coverage in Chromium, Firefox, and WebKit.
Add an isolated `mobile-chromium` project using a Playwright mobile device
profile and run only the touch spec there.

The touch test must use Dockview's pointer backend and perform:

- A tap that activates a panel without dragging.
- A quick swipe that does not unintentionally move the panel.
- A long press followed by movement that docks the panel to a different group.
- A long-press move that creates or repositions a floating group.
- Final workspace disposal with all diagnostic counts at zero.

Do not run the complete desktop suite again in the mobile project.

**Verify:**

```bash
npm run test:browser
npm run format:check
npm run lint
```

**Done when:** All desktop projects and the dedicated mobile project pass, with
no flaky retry required locally and no browser console or page errors.

### Step 6 - Execute the decision gate and record the outcome

**Files:**
`docs/plans/multi-connection-ui-phase-0-step-6-dockview-decision.md`

**Intent:** Run the complete clean-checkout gate and record exact commands,
versions, test counts, browser results, lifecycle counters, limitations, and
final disposition.

Approval requires every must-have to pass. If any required Dockview behavior
remains unreliable:

- Mark the candidate `REJECTED` with exact failing evidence.
- Remove `dockview`, the Dockview implementation, and Dockview-specific
  harness/tests.
- Retain only the vendor-neutral workspace contract for evaluating another
  implementation.
- Confirm the legacy client and all prior Phase 0 gates remain green.

**Verify:**

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run check
npm test
npm run build
npm run test:browser
git diff --check
```

**Done when:** All commands pass and the decision record says either `APPROVED`
with every gate checked, or `REJECTED` with Dockview absent and the prior
baseline restored.

## Test scenarios

- Initial creation and reactive update without remount.
- Unknown-panel removal and repeated disposal.
- Grid-to-grid docking, grid-to-floating movement, resize, save, and restore.
- Terminal identity, focus, scroll, and buffer preservation.
- Corrupted and version-incompatible snapshot recovery.
- Twenty-five panel add/remove cycles plus complete workspace recreation.
- Desktop execution in Chromium, Firefox, and WebKit.
- Mobile tap, swipe, long-press docking, and floating.
- Existing Typia/HMR, legacy root, server, proxy, desktop-cookie, build, and
  Node tests remain green.

## Success criteria

- [ ] Only the adapter imports Dockview code or types.
- [ ] `dockview` is pinned exactly to 7.0.4.
- [ ] `skipLibCheck: true` is enabled without disabling or weakening strict
  checking of project-owned TypeScript and Svelte source.
- [ ] Updating a panel does not remount it.
- [ ] Every removed panel unmounts exactly once.
- [ ] Terminal node identity, buffer, focus, and scroll survive required layout
  operations.
- [ ] Save/restore preserves the observable layout and reuses live panels.
- [ ] Invalid restore is recoverable and leak-free.
- [ ] Repeated cycles and total disposal leave zero owned resources or DOM.
- [ ] Chromium, Firefox, WebKit, and mobile touch projects pass.
- [ ] Existing checks, root tests, and production build pass.
- [ ] The decision record contains an evidence-backed `APPROVED` or `REJECTED`.

## Rollback

No schema, production client, or external state is changed. Revert the Step 6
commit to return to the current Phase 0 harness; if Dockview is rejected during
execution, remove the dependency and Dockview-specific implementation while
retaining the vendor-neutral contract and rejection record.

Plan self-review: PASS (9/10)

Notes:

- Touch automation exercises Dockview's pointer backend, but a physical-device
  smoke remains the fallback if the team requires trusted mobile-hardware
  evidence.
- The terminal fixture proves the architectural boundary; it is deliberately
  not a partial port of the current terminal.
- Dockview approval is all-or-nothing for this pinned candidate. Known
  lifecycle leaks or state-loss defects are rejection conditions, not deferred
  cleanup.
