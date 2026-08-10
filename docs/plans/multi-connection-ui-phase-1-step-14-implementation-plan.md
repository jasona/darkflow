_Plan stress-tested via full adversarial review. 26 findings surfaced, 20 survived._

## Planning selection

- Mode: detailed implementation plan
- Complexity: 5/10 — one lifecycle subsystem spanning many legacy controllers, with ordered bridge wiring and new browser verification
- Hard triggers: none; the master Phase 1 plan already supplies the phase map and makes Step 14 independently reversible
- Current planning horizon: Phase 1 Step 14 only—GMCP-bound controller ownership and disposal
- Evidence horizon: Step 13 bootstrap/facades, session resource scope and diagnostics, all current `public/js` GMCP registrations, controller-owned asynchronous resources, and relevant unit/browser tests
- Adversarial review: full — explicitly requested

## Goal

Give every GMCP-bound legacy controller one idempotent disposer owned by the active session’s `ResourceScope`. Disposing the session must unregister its GMCP handlers, cancel controller-owned timers/RAF work, remove external listeners and observers, invalidate late asynchronous work, and release controller-created UI without changing normal rendering, layout, protocol, or persistence behavior.

This remains the lifecycle-only Step 14 described by the master plan; the full app/input/output/browser-resource teardown and 25-cycle browser soak remain Step 15 ([master plan:520-553](/Users/anderson/src/games/darkwind/darkflow/docs/plans/multi-connection-ui-phase-1-implementation-plan.md:520)).

## Evidence

- The current census is 22 `public/js` modules containing 109 `gmcp.on(...)` registrations. Only `login-theme-manager.js` currently unregisters its three handlers ([login-theme-manager.js:27-97](/Users/anderson/src/games/darkwind/darkflow/public/js/login-theme-manager.js:27)).
- The master-plan file list is illustrative rather than exhaustive. App-level wildcard/`Game` handlers also remain live ([app.js:296-359](/Users/anderson/src/games/darkwind/darkflow/public/js/app.js:296)), while completion and mention-picker subscribe indirectly during `initInput()` ([input.js:789-795](/Users/anderson/src/games/darkwind/darkflow/public/js/input.js:789)).
- `gmcp.on()` currently returns no disposer, and callers must preserve the exact callback reference to use `off()` ([gmcp.js:86-104](/Users/anderson/src/games/darkwind/darkflow/public/js/gmcp.js:86)). Step 14 should wrap this API rather than change it.
- The session factory already exposes its root `ResourceScope` to facades ([session-factory.ts:22-32](/Users/anderson/src/games/darkwind/darkflow/client/runtime/session-factory.ts:22)). The scope supports child scopes, typed resource ownership, timers, intervals, RAF work, reverse-order cleanup, and rejection after disposal ([resource-scope.ts:5-17](/Users/anderson/src/games/darkwind/darkflow/client/runtime/resource-scope.ts:5), [resource-scope.ts:169-223](/Users/anderson/src/games/darkwind/darkflow/client/runtime/resource-scope.ts:169)).
- `Session.dispose()` reaches `transport.dispose()`, which closes transport state and disposes the shared scope ([session.ts:141-149](/Users/anderson/src/games/darkwind/darkflow/client/runtime/session.ts:141), [connection.ts:460-468](/Users/anderson/src/games/darkwind/darkflow/client/transport/connection.ts:460)).
- Step 13 installs all facades before loading the legacy app and disposes the session on partial boot failure ([bootstrap-transaction.ts:296-356](/Users/anderson/src/games/darkwind/darkflow/client/app/bootstrap-transaction.ts:296)). The controller bridge must join this transaction.
- GMCP dispatch snapshots handler arrays before invoking them ([bus.ts:237-258](/Users/anderson/src/games/darkwind/darkflow/client/gmcp/bus.ts:237)). Removing a handler during dispatch is insufficient by itself; the registered wrapper must also check whether its controller has been disposed.
- `panel-manager.js` alone owns 47 GMCP registrations and several GMCP-driven timers/render callbacks ([panel-manager.js:3382-3437](/Users/anderson/src/games/darkwind/darkflow/public/js/panel-manager.js:3382)). Map modules also own save, retry, paging, fallback, and speedwalk timers ([map-data-v2.js:344-383](/Users/anderson/src/games/darkwind/darkflow/public/js/map-data-v2.js:344), [map-speedwalk.js:13-50](/Users/anderson/src/games/darkwind/darkflow/public/js/map-speedwalk.js:13)).
- Existing local cleanup should be reused: windows already centralize per-window timer/listener/observer release in `closeWindow()` ([window-manager.js:419-445](/Users/anderson/src/games/darkwind/darkflow/public/js/window-manager.js:419)), and the IDE editor already has silent local teardown ([ide-editor.js:436-463](/Users/anderson/src/games/darkwind/darkflow/public/js/ide-editor.js:436)).
- Legacy JavaScript remains outside the formatter boundary and must retain its existing style; TypeScript and browser tests still require lint and format checks ([CLAUDE.md:93-104](/Users/anderson/src/games/darkwind/darkflow/CLAUDE.md:93)).

## Must-haves

- [MH1] One controller-lifecycle compatibility primitive owns GMCP subscriptions, external listeners, observers, timers, intervals, RAF callbacks, custom teardown, and late-callback guards. Acceptance: an isolated fixture acquires every supported resource, disposes twice, observes one LIFO cleanup, and records zero live resources.
- [MH2] Controller bridge installation is transactional. Acceptance: it is active before the legacy app imports, same-document reuse does not reinstall it, and partial boot failure resets all four facades and disposes created controller scopes.
- [MH3] Every current public-JS GMCP registration is accounted for. Acceptance: the source census contains the same 22 modules and 109 logical registrations, no controller uses raw `gmcp.on(...)`, and double `init()` does not duplicate a subscription.
- [MH4] No disposed controller handles a frame or already-snapshotted callback. Acceptance: dispatch-before-dispose works, dispatch-after-dispose has no effect, and disposal during another handler’s dispatch suppresses the disposed wrapper.
- [MH5] Panel and map behavior remain unchanged while their GMCP/data lifecycle becomes disposable. Acceptance: layout/persistence tests remain green; pending map data is flushed before teardown; retries, paging, fallback, speedwalk, image probes, and GMCP-driven panel timers cannot complete afterward.
- [MH6] Windows, IDE, and server-driven overlays tear down locally and silently. Acceptance: disposal removes their UI/resources without sending `Close`, `Stop`, `Cancel`, or equivalent GMCP packages.
- [MH7] Notification, audio, lag, visual, combat, tutorial, and login-theme controllers release their session-owned resources. Acceptance: output subscriptions, media-query listeners, timers, observers, and active session-triggered playback return to zero without deleting settings.
- [MH8] Browser disposal is observable and preserves one-session parity. Acceptance: the browser test disposes twice, verifies zero controller/session lifecycle counts, dispatches representative frames afterward, and observes no DOM mutation or outbound send.

## Out of scope

- Top-level app status/version timers, general input/output listeners, terminal rendering, workspace-wide resize/pointer handling, and the 25-cycle full-app soak—Step 15 owns these.
- Porting controllers to TypeScript, Svelte, Dockview, or new dependency-injected classes.
- Changing GMCP payloads, validation status, subscriptions, package names, or server behavior.
- Creating multiple sessions or adding session tabs/switching UI.
- Deleting map caches, profile data, legacy local-storage keys, or controller facades.
- Disposing application-scoped audio engine/unlock infrastructure. Step 14 stops session-triggered playback; Step 15 decides application teardown.

## Lifecycle pattern

Each controller follows one pattern:

1. `init()` returns the existing stable disposer when already initialized.
2. Otherwise it creates one named child lifecycle through `createControllerLifecycle(name)`.
3. GMCP callbacks register through `lifecycle.onGmcp(gmcp, packageName, callback)`.
4. External listeners, observers, timers, intervals, RAF callbacks, and custom cleanup register on that lifecycle.
5. Timer fields store cancellation disposers, not native timer IDs.
6. Disposal first prevents new callbacks, then releases resources in reverse order, then performs silent local state/UI cleanup.
7. Controller-created DOM subtrees may release their internal element listeners by removing the subtree and clearing retained references. Listeners on `window`, `document`, media queries, toolbar elements, or other persistent targets must be explicitly owned.
8. Existing `destroy()` names remain as aliases where callers already use them.

Do not extend `gmcp.on()` or add a bus-wide `clearHandlers()`. Both alternatives hide which controller owns a subscription and prevent independent controller disposal.

## Gates

### User decision gates

- None.

### Evidence gate

- Re-run `rg -c "gmcp\\.on\\(" public/js --glob '*.js' | sort` immediately before implementation.
- Owner: Step 14 lead.
- Go condition: 22 files and 109 registrations match this plan.
- Replan condition: any new registration, module, or controller-specific cleanup surface has landed.

### Experiment gate

- Implement and test the lifecycle primitive before porting managers.
- Owner: Step 14 lead.
- Go condition: child-scope disposal, fallback mode, guarded snapshotted callbacks, manual disposal, and diagnostics all pass.
- Replan condition: satisfying the fixture requires changing the public `Session` API or expanding into Step 15’s application lifecycle.

## Risks

- Mechanical omission across 109 handlers — mitigation: per-file count fixture plus a ban on remaining raw controller `gmcp.on(...)` calls.
- A disposer may send protocol cleanup while the socket is still open — mitigation: explicit silent teardown paths and an outbound-send spy in lifecycle tests.
- Async IDE loads, image probes, map hydration, lag requests, or permission work may finish after disposal — mitigation: controller generation/disposed guards after every relevant `await` or browser callback.
- Map teardown could discard a debounced write — mitigation: invoke the existing flush functions before invalidating tokens and cancelling timers; never clear persisted caches.
- Controller bridge installation could recreate Step 13’s pre-DOM failure — mitigation: installation may allocate scopes and subscriptions but perform no DOM work; controllers create scopes lazily from their existing `init()` calls.
- Scope could spread into Step 15 — mitigation: touch `app.js` only for its two GMCP handlers and leave its unrelated timers/listeners unchanged; do not edit `input.js` or `output.js` except where an existing unsubscribe API must be consumed.
- Removing controller UI may disturb layout persistence — mitigation: use existing silent close/remove paths, preserve panel state, and run current panel/window/map tests before browser disposal.

## Steps

### Step 1 — Add the controller lifecycle compatibility boundary

**Files:** `public/js/session-compat/controllers.js` (new), `client/runtime/session-factory.ts`, `client/app/session-bridge-wiring.ts`, `test/session-gmcp-controller-lifecycle.test.mjs` (new)

**Intent:** Add the install/reset facade and lazy `createControllerLifecycle(name)` primitive. Back active lifecycles with session child scopes; retain a local disposer collector for legacy fallback. Provide guarded GMCP/listener registration, observer ownership, scope-backed scheduling, asynchronous delay cancellation, custom teardown, idempotent disposal, and read-only diagnostics. Add only a `getLifecycleDiagnostics()` function to `SessionFacadeHandles`; do not expose raw diagnostics or enlarge the public `Session` interface.

**Verify:**

```bash
node --test test/session-gmcp-controller-lifecycle.test.mjs
npm run typecheck
npm run lint
npm run format:check
```

**Done when:** the experiment gate passes and the helper has no dependency from `public/js` into `client/**`.

### Step 2 — Install the fourth facade transactionally

**Files:** `client/app/bootstrap-transaction.ts`, `test/session-bootstrap.test.mjs`

**Intent:** Import the controller compatibility module alongside configuration, automation, and runtime. After creating the session, build the controller bridge from `handles.scope` and `getLifecycleDiagnostics()`. Install configuration, automation, runtime, then controllers before `loadLegacyApp()`. On failure, reset all four bridges before disposing the session; on same-document reuse, retain the installed bridge and existing controller scopes.

**Verify:**

```bash
node --test test/session-bootstrap.test.mjs
node --test test/session-gmcp-controller-lifecycle.test.mjs
npm run build
```

**Done when:** boot-order, reuse, pre-DOM safety, and partial-import failure fixtures pass.

### Step 3 — Port app-level, panel, completion, mention, and map controllers

**Files:** `public/js/app.js`, `panel-manager.js`, `completion.js`, `mention-picker.js`, `map-speedwalk.js`, `map-data-v2.js`, `map-data-gmcp.js`, `live-map-source.js`, related tests

**Intent:** Move only `app.js`’s wildcard and `Game` handlers into a named GMCP lifecycle. Make completion and mention-picker initialization idempotent and disposable without changing `input.js`. Split panel GMCP/data ownership from workspace layout ownership: lifecycle-own all 47 GMCP handlers, lag/map/playlist data listeners, subscription fallback, buff/sky/avatar timers, GMCP-triggered image probes, and pending GMCP render work; leave layout persistence, drag, resize, and general workspace teardown for Step 15.

Give map data, live-source fallback, and speedwalk explicit runtime disposal. Flush dirty areas first, invalidate hydration/sync generations, cancel request/retry/page/save/fallback/step work, and keep persisted world data intact.

**Verify:**

```bash
node --test test/session-gmcp-controller-lifecycle.test.mjs
node --test test/completion.test.mjs test/mention-picker.test.mjs
node --test test/panel-manager-layout.test.mjs test/panel-snap-bounds.test.mjs
node --test test/map-data-gmcp.test.mjs test/map-data-v2-lifecycle.test.mjs test/map-data-v2-reset.test.mjs
node --test test/map-hydration-race.test.mjs test/map-speedwalk.test.mjs test/live-map-source.test.mjs
```

**Done when:** panel/map behavior remains green, map saves are not discarded, and repeated init/dispatch/dispose fixtures leave no handler or map-runtime resource alive.

### Step 4 — Port server-driven window and workbench controllers

**Files:** `public/js/window-manager.js`, `ide-manager.js`, `ide-editor.js`, `snoop-manager.js`, `announcements-manager.js`, `giphy-manager.js`, `broadcast-manager.js`, `linux-rescue-manager.js`, `fishing-manager.js`, `street-samurai-dashboard-manager.js`, `room-playlist-manager.js`, related tests

**Intent:** Give every manager an idempotent `dispose()` and stable disposer-returning `init()`. Own GMCP subscriptions and persistent external listeners through the lifecycle. Reuse local close/hide methods to remove created DOM, but add silent variants where existing close methods send GMCP. Unregister panel close/lifecycle callbacks, clear IDE transfers/editor resources, cancel fishing RAF/interval state, stop room-playlist scheduling/audio, and guard lazy imports/backpressure waits against disposal.

**Verify:**

```bash
node --test test/session-gmcp-controller-lifecycle.test.mjs
node --test test/window-renderer.test.mjs test/npc-dialogue-layout.test.mjs
node --test test/linux-rescue-manager.test.mjs test/fishing-core.test.mjs
node --test test/room-playlist-core.test.mjs test/street-samurai-dashboard.test.mjs
```

**Done when:** disposal removes every open surface without an outbound protocol message, and post-disposal frames cannot recreate one.

### Step 5 — Port notification, audio, monitoring, and effects controllers

**Files:** `public/js/notification-manager.js`, `sound-panel.js`, `sound-manager.js`, `lag-monitor.js`, `login-theme-manager.js`, `visual-effects-manager.js`, `combat-visual-manager.js`, `tutorial-manager.js`, related tests

**Intent:** Lifecycle-own all seven managers’ GMCP handlers and persistent resources. Register the existing `onOutputLine()` and `soundManager.onChange()` disposers, remove document/media-query listeners, disconnect tutorial observers, cancel lag/visual/combat/tutorial/audio timers and RAF work, stop active session-triggered sounds, and reset transient state. Preserve sound settings/cache and the application-scoped unlock engine for Step 15.

**Verify:**

```bash
node --test test/session-gmcp-controller-lifecycle.test.mjs
node --test test/notification-manager.test.mjs
node --test test/sound-manager.test.mjs test/sound-panel-layering.test.mjs
node --test test/lag-core.test.mjs test/login-theme-manager.test.mjs
node --test test/combat-visual-manager.test.mjs test/visual-effects-manager.test.mjs
node --test test/tutorial-manager.test.mjs test/tutorial-ui-contract.test.mjs
```

**Done when:** all session-origin effects stop at disposal, settings remain intact, and representative post-disposal frames are inert.

### Step 6 — Lock the census and browser disposal contract

**Files:** `test/session-gmcp-controller-lifecycle.test.mjs`, `e2e/session-disposal.spec.ts` (new), `e2e/session-single-runtime.spec.ts` as needed

**Intent:** Add an explicit expected per-file registration census totaling 109 logical subscriptions across the 22 modules. Assert zero raw controller `gmcp.on(...)` calls and 25 lightweight unit create/dispatch/dispose cycles. In Chromium, boot the real single-session root, verify representative handlers work, dispose the session twice, assert all tracked lifecycle counts are zero, dispatch representative Window/IDE/Char/Map/Visual frames, and prove no DOM state or outbound GMCP changes. Do not add Step 15’s 25 full-app browser recreation soak.

**Verify:**

```bash
npm test
npm run typecheck
npm run check
npm run lint
npm run format:check
npm run build
npm run verify:client-artifact
npm run test:browser -- e2e/session-disposal.spec.ts e2e/session-single-runtime.spec.ts --project=chromium
npm run test:browser:production
git diff --check
```

**Done when:** the complete census, unit lifecycle matrix, browser disposal test, existing one-session browser test, production artifact, and quality gates pass.

## Success criteria

- [ ] All 22 current GMCP-bound modules and 109 registrations are lifecycle-owned.
- [ ] Every controller has one stable, idempotent disposer.
- [ ] Repeated initialization does not duplicate handlers or resources.
- [ ] Session disposal returns subscriptions, controller scopes, timers, RAF callbacks, observers, listeners, and teardowns to zero.
- [ ] No disposed callback, asynchronous completion, or later GMCP frame mutates UI or sends data.
- [ ] Map persistence, panel layout, windows, IDE, notification, sound, visual, combat, tutorial, and other controller behavior remain green.
- [ ] Step 15’s browser-wide ownership work remains deferred.

## Rollback

Step 14 is code-only and introduces no schema, protocol, or storage-key change. Roll back the entire Step 14 Green PR together, restoring the Step 13 artifact at commit `139bba9`; do not retain a partially installed fourth facade or partially converted controller census.

Map disposal may invoke the same existing cache writes already used by debounced flushes, but it neither deletes nor rewrites the cache schema. Existing map/profile/legacy data therefore remains readable after rollback.

## Execution fit

- Scope: multi-run phase
- Lead: Sol at high reasoning — broad legacy lifecycle boundary with asynchronous and browser-specific edge cases
- Workers: none — bootstrap, lifecycle helper, controller ports, census, and disposal verification share ordering and ownership contracts
- Delegation shape: solo
- Ownership: lead owns all integration, the final census, browser verification, and rollback decision
- Replan trigger: census drift, a controller requiring public `Session` API changes, lifecycle work expanding into Step 15, or any post-disposal callback/outbound send
- Confidence: medium — the architectural seam is established, but controller-specific asynchronous cleanup is extensive

Plan self-review: PASS (9/10)

notes:

- The plan is executable against the clean Step 13 branch inspected here.
- No tests were run during this planning turn; Step 1 begins by capturing the implementation-time census and baseline.
