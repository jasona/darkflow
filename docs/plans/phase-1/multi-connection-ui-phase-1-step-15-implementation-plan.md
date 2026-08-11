_Ponytail full pass: reuse the Step 14 lifecycle, add no second scope or diagnostics system, and change only session-owned browser resources._

## Planning selection

- Mode: detailed implementation plan
- Complexity: 4/10 — one reversible lifecycle boundary with an established helper and one new browser soak
- Hard triggers: none; the master Phase 1 map already makes Step 15 one Green PR
- Current planning horizon: Phase 1 Step 15 only—remaining session-owned browser resources and the 25-cycle disposal gate
- Evidence horizon: Step 14 lifecycle APIs, remaining session-owned listeners/schedulers/observers, and focused unit/browser checks
- Adversarial review: focused — prevent raw resources from escaping diagnostics and preserve pending persistence

## Goal

Make the remaining session-owned browser resources die with `Session.dispose()` without changing the visible one-session UI.

Reuse `createControllerLifecycle()` for app-session, input, output, panel, overlay, and debug ownership. Do not add an application `ResourceScope`, a second lifecycle registry, new diagnostic types, or a same-document session-restart API.

Step 15 owns browser teardown and the 25-cycle soak; Step 16 still owns the complete parity battery and interface freeze (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:537-573`).

## Evidence

- The domain contract makes terminal buffers, render scheduling, workspace state, windows, notifications, and active timers session-owned; desktop integration and app version are application-owned (`docs/plans/multi-connection-ui-proposal.md:105-112`, `docs/plans/multi-connection-ui-proposal.md:157-174`).
- Step 14's existing helper already owns listeners, observers, timers, intervals, RAF callbacks, and guarded late callbacks through the session scope (`public/js/session-compat/controllers.js:130-228`).
- Existing session diagnostics already report every Step 15 resource class: timers, RAF callbacks, subscriptions, observers, listeners, child scopes, sockets, and teardowns (`client/runtime/diagnostics.ts:14-30`).
- `Session.dispose()` already reaches the shared root scope through transport disposal (`client/runtime/session.ts:141-149`, `client/transport/connection.ts:460-468`).
- `input.js` still owns raw persistent listeners, history debounce, and delayed batch sending; the emoji picker has no disposer (`public/js/input.js:136-145`, `public/js/input.js:768-890`, `public/js/emoji-picker.js:175-187`).
- `output.js` retains terminal buffer state, RAF scheduling, timers, persistent listeners, and a `ResizeObserver` (`public/js/output.js:44-69`, `public/js/output.js:863-867`, `public/js/output.js:1420-1488`).
- `app.js` still has session-facing status, visibility, observer, and delayed-render resources (`public/js/app.js:102-109`, `public/js/app.js:293-299`, `public/js/app.js:529-547`).
- `panelManager` has a Step 14 lifecycle but still manually owns some timers, RAF work, and observers (`public/js/panel-manager.js:172-264`).
- The reconnect overlay and RFC debug view retain raw document listeners and intervals (`public/js/connection-overlay.js:22-38`, `public/js/connection-overlay.js:149-171`, `public/js/rfc2549-debug.js:165-181`).
- The typed transport already owns its `online` listener, while legacy `connection.js` also installs one at module load (`client/transport/connection.ts:362-382`, `public/js/connection.js:980-990`).
- Existing browser coverage disposes one runtime once; the reusable local transport fixture already exposes active socket counts for a real connect/dispose soak (`e2e/session-single-runtime.spec.ts:72-150`, `e2e/fixtures/transport-fixtures.ts:9-18`).

## Must-haves

- [MH1] Step 14 remains green — acceptance: its controller census, lifecycle test, and current browser disposal assertion pass before and after Step 15.
- [MH2] Existing lifecycle and diagnostics primitives are reused — acceptance: no new scope, registry, resource kind, or public `Session` API is introduced.
- [MH3] Input teardown is lossless — acceptance: history flushes before cancellation; batch, completion, mention, and emoji work stops; disposed input cannot send.
- [MH4] Terminal teardown is complete — acceptance: pending RAF/timer work, observers, listeners, line observers, and session buffer state return to zero and cannot render late.
- [MH5] Remaining session browser owners are tracked — acceptance: status/visibility, session-facade subscriptions, panel scheduling, overlay, debug, and legacy-online fallback use explicit disposers.
- [MH6] Twenty-five real browser cycles are clean — acceptance: each boot/connect/disconnect/double-dispose cycle leaves zero fixture sockets and zero session resources, with no late DOM mutation, send, or page error.
- [MH7] One-session parity remains intact — acceptance: existing input, output, panel, connection, development-browser, and built-browser checks remain green.

## Out of scope

- Application-lifetime shell controls, desktop update IPC, client-version polling, shared sound unlock infrastructure, and theme. They are not recreated per session; change them only if the implementation census proves otherwise.
- New application lifecycle or diagnostics infrastructure. Phase 1 has no application teardown or same-document session-restart product contract.
- Phase 2 Svelte/Dockview/terminal ports and Phase 3 tabs, switching, background rendering, or multiple visible sessions.
- Transport, GMCP, storage, profile, protocol, and persistence-schema changes.
- Step 16's full Electron, Docker, transport, MCP, and interface-freeze decision.

## Assumptions

- [The browser page is the application lifetime for Phase 1] — if false: stop and plan an application scope rather than smuggling one into Step 15.
- [The 25 cycles may reload after each explicit disposal] — if false: a same-document session-restart contract is required and Step 15 must be reclassified.
- [Removing controller-created DOM releases its element-local listeners] — if false: explicitly own only the persistent element listeners found by the census.

## Risks

- Raw resources can evade session diagnostics — mitigation: run the source census before and after each implementation slice and reject unexplained persistent acquisitions.
- Disposal can lose debounced persistence — mitigation: flush history and panel state before releasing timers.
- A queued terminal callback can run after disposal — mitigation: route all output scheduling through the existing guarded lifecycle and test disposal between queue and callback.
- The legacy online listener can duplicate typed reconnect behavior — mitigation: install it only in the legacy-fallback path.
- The soak can be slow or flaky — mitigation: reuse the local `ws` fixture, disable auto-reconnect, and report the failing cycle index.

## Gates

### Predecessor gate

```bash
node --test test/session-gmcp-controller-lifecycle.test.mjs test/session-gmcp-controller-census.test.mjs
npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium
```

### Resource census

```bash
rg -n "addEventListener|setInterval|setTimeout|requestAnimationFrame|new (MutationObserver|ResizeObserver|IntersectionObserver)" public/js/app.js public/js/input.js public/js/emoji-picker.js public/js/output.js public/js/panel-manager.js public/js/connection-overlay.js public/js/rfc2549-debug.js public/js/connection.js
```

Proceed when every persistent acquisition is either application-lifetime, element-local, or assigned to one existing session lifecycle. Replan only if a new resource class cannot use `createControllerLifecycle()`.

## Steps

### Step 1 — Make input and emoji disposable

**Files:** `public/js/input.js`, `public/js/emoji-picker.js`, existing completion/mention/input tests

**Intent:** Give `initInput()` one stable controller lifecycle. Register persistent input/document listeners through it; schedule history debounce and batch commands through it; own the existing completion and mention disposers; make emoji initialization idempotent and disposer-returning. Teardown flushes history first, then cancels batch/picker work and removes transient DOM.

**Verify:**

```bash
node --test test/completion.test.mjs test/mention-picker.test.mjs test/emoji-manager.test.mjs
node --test test/session-gmcp-controller-lifecycle.test.mjs
```

**Done when:** repeated input initialization returns the same disposer, teardown preserves the final history value, and later keyboard/paste/timer callbacks are inert.

### Step 2 — Make terminal scheduling disposable

**Files:** `public/js/output.js`, existing output/browser tests

**Intent:** Give `initOutput()` one stable controller lifecycle. Replace the boolean-only RAF ownership with lifecycle cancellation and route all output RAF/timer work through the same helper. Own the persistent output/window listeners and `ResizeObserver`. Teardown cancels scheduling before clearing pending lines, line observers, session buffer state, pointer state, accessibility queues, and generated viewport nodes; retain the static terminal host.

**Verify:**

```bash
node --test test/connection-transport.test.mjs test/notification-manager.test.mjs
npm run test:browser -- e2e/session-single-runtime.spec.ts --project=chromium
```

**Done when:** disposal between queueing and RAF execution produces no render, all output lifecycle counts reach zero, and current scrolling/rendering behavior remains green.

### Step 3 — Finish the remaining session browser owners

**Files:** `public/js/app.js`, `public/js/connection.js`, `public/js/panel-manager.js`, `public/js/connection-overlay.js`, `public/js/rfc2549-debug.js`, related tests

**Intent:** Create one app-session lifecycle for status, visibility, connection observation, GMCP-debug RAF work, delayed panel work, and the returned facade subscription disposers. Leave fixed shell/version/before-unload resources page-owned. Move panel native handles through its existing lifecycle, flushing state first. Give overlay and RFC debug stable session disposers. Replace the top-level legacy online listener with an explicit fallback-only installer.

**Verify:**

```bash
node --test test/panel-manager-layout.test.mjs test/panel-snap-bounds.test.mjs
node --test test/session-runtime-bridge.test.mjs test/session-transport.test.mjs
node --test test/session-gmcp-controller-lifecycle.test.mjs test/session-gmcp-controller-census.test.mjs
```

**Done when:** the post-change census has no unexplained session acquisition, panel state flushes before cancellation, the session-backed path has one online listener, and late app/overlay/debug events are inert.

### Step 4 — Add the 25-cycle browser gate

**Files:** `e2e/session-disposal.spec.ts` (new), `e2e/session-single-runtime.spec.ts`, `e2e/production-artifact.spec.ts`

**Intent:** Reuse `TransportFixtureOwner` and its local `ws` endpoint. Each cycle boots the real transformed root, connects through public controls, exercises input/output/panel scheduling, disconnects, disposes twice, asserts fixture sockets and all session diagnostics are zero, dispatches representative late events, and reloads. Update existing exact controller-count expectations to the final Step 15 census.

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
npm run test:browser:production -- e2e/session-disposal.spec.ts e2e/session-single-runtime.spec.ts
git diff --check
```

**Done when:** all 25 cycles pass with zero fixture sockets, timers, RAF callbacks, subscriptions, observers, listeners, child scopes, teardowns, and active session controllers; no late event mutates UI or sends data; and development/built one-session behavior remains green.

## Success criteria

- [ ] Step 14 remains green.
- [ ] No new lifecycle or diagnostics abstraction exists.
- [ ] Input flushes history and cancels batch/picker work.
- [ ] Output cancels every pending scheduler and releases session buffer state.
- [ ] App-session, panel, overlay, debug, and fallback-online resources are explicitly disposable.
- [ ] The final source census has no unexplained session-owned acquisition.
- [ ] Twenty-five real browser cycles return session diagnostics and fixture sockets to zero.
- [ ] Development and built-browser one-session behavior remain at parity.
- [ ] Step 16 remains deferred.

## Rollback

Step 15 is code-only. Revert the complete Green PR to Step 14 commit `2443e01`; do not retain a partially converted lifecycle. The change introduces no protocol, schema, storage-key, or server mutation, and existing history, workspace, map, profile, and legacy records remain readable.

## Execution fit

- Scope: multi-run phase
- Lead: Terra at high reasoning — one established lifecycle boundary with tricky terminal and browser teardown
- Workers: none — app, input, output, and final diagnostics share one sequential session scope
- Delegation shape: solo
- Ownership: lead owns the census, integration, browser soak, final verification, and rollback decision
- Replan trigger: Step 14 regression, a resource that cannot use the existing lifecycle, lost persistence, same-document restart becoming required, or any post-disposal callback/send
- Confidence: medium — the helper and disposal path are proven, but output scheduling has several late-callback paths

Plan self-review: PASS (9/10)

notes:

- Ponytail removed the proposed application lifecycle, application diagnostics, desktop/audio edits, and three speculative unit-test files.
- Implementation starts with the current Step 14 gate and resource census; no code changes begin before both pass.
- Loopback-dependent checks may report sandbox `EPERM`; a loopback-capable environment remains required.
