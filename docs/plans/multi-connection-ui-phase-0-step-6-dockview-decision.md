# Phase 0 Step 6 - Dockview Decision

## Decision

**APPROVED**

Candidate: `dockview` 7.0.4

Decision date: 2026-08-07

Dockview 7.0.4 satisfies the isolated Phase 0 workspace gates under Darkflow's
pinned Svelte, Vite, TypeScript, Typia, and Playwright toolchain. This decision
approves Dockview for a future migration step; it does not replace the legacy
client, change `/`, or authorize a production cutover.

## Evaluated toolchain

```text
Node v22.15.0
npm 10.9.2
dockview 7.0.4
Svelte 5.56.8
Vite 8.1.5
Playwright 1.62.1
```

`dockview` is an exact development dependency. The lockfile resolves both
`dockview` and its transitive `dockview-core` package to 7.0.4. Application
source imports only `dockview`; no source imports `dockview-core`.

## Gate results

| Gate | Result | Evidence |
| --- | --- | --- |
| MH1 exact candidate | PASS | Manifest declaration is `"dockview": "7.0.4"`; clean install resolved Dockview and Dockview Core to 7.0.4. |
| MH2 strict source checking | PASS | Both TypeScript configs set `skipLibCheck: true`; `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` remain enabled for Phase 0 source. |
| MH3 vendor boundary | PASS | `workspace.ts` exposes vendor-neutral panel, placement, snapshot, renderer, and lifecycle types. Dockview code/types are imported only by `dockview-workspace.ts`; its adjacent style shim imports only Dockview CSS. |
| MH4 stable Svelte ownership | PASS | Duplicate-ID updates retained root identity and mount count while the writable store and rendered title/state changed. Unaffected panels were not remounted. |
| MH5 deterministic teardown | PASS | Renderer disposal calls Svelte `unmount` once, tracks and awaits its promise, removes its host, and makes workspace disposal idempotent. Final roots, hosts, subscriptions, observers, listeners, terminal islands, and owned DOM were all zero; duplicate disposal count was zero. |
| MH6 terminal island | PASS | Terminal DOM identity, buffer, focus, native scroll position, and connection survived grid moves, tab hiding/showing, floating, resize, and live restore. |
| MH7 layout and recovery | PASS | Add, update, remove, dock, float, resize, save, reuse-existing restore, incompatible restore, malformed restore, and 25 remove/re-add cycles passed. Floating bounds were compared after layout settled with a 2 px browser-border tolerance. |
| MH8 browser and touch matrix | PASS | Desktop lifecycle and legacy/HMR coverage passed in Chromium, Firefox, and WebKit. The isolated Pixel 7 Chromium project passed tap, quick swipe, 300 ms long-press docking, long-press floating movement, and teardown. |
| MH9 binary decision | PASS | This record contains the candidate, commands, results, limitations, and `APPROVED` disposition. |

## Lifecycle evidence

The recovery scenario first returned to the empty-workspace diagnostic
baseline after malformed restore, then proved a `+25` mount / `+25` unmount
delta across 25 add/remove cycles. Final disposal reported:

```text
live roots          0
live renderer hosts 0
live subscriptions  0
live observers      0
live listeners      0
live terminal islands 0
owned DOM           0
duplicate disposals 0
```

Every post-disposal mutation method returned the same disposed-workspace error,
while a second `dispose()` completed harmlessly.

## Clean decision gate

Commands were run with the repository's exact Node/npm versions:

```text
npm ci                 PASS (560 packages installed)
npm run format:check   PASS
npm run lint           PASS
npm run typecheck      PASS
npm run check          PASS (0 errors, 0 warnings)
npm test               PASS (399 passed, 0 failed)
npm run build          PASS (222 modules transformed; 71 JavaScript files scanned)
npm run test:browser   PASS (19 passed, 0 failed)
git diff --check       PASS
```

The Node and browser commands require local loopback binding. Their first
sandboxed attempts failed with `listen EPERM`; rerunning with loopback access
passed and is the decision evidence above.

Browser distribution:

```text
Chromium desktop       6 passed
Firefox desktop        6 passed
WebKit desktop         6 passed
mobile Chromium touch  1 passed
```

No browser console errors or page errors were accepted by the new fixtures.

## Known limitations

- The terminal is a synthetic imperative island, not an extraction or partial
  port of `public/js/output.js`.
- Touch evidence uses Playwright's emulated Pixel 7 profile and trusted CDP
  touch input. No physical-device smoke test was performed.
- Floating layout observations wait for Dockview's asynchronous layout settle;
  restored pixel bounds allow 2 px for engine-specific borders and rounding.
- This spike does not cover popout windows, CodeMirror, production persistence,
  schema migrations, complete accessibility parity, or theme parity.
- `skipLibCheck` intentionally skips complete checking of dependency
  declarations. Darkflow's imported Dockview uses remain checked and are also
  exercised by production build and browser execution.
- The typed browser bridge and lifecycle diagnostics are Phase 0 harness
  surfaces, not production workspace APIs.

## Scope confirmation

The legacy client remains the default at `/`. No file under `public/`, no
production persistence schema, and no Electron or Docker artifact contract was
changed. The existing Typia/HMR, legacy root, server, proxy, build, and Node
tests remain green.
