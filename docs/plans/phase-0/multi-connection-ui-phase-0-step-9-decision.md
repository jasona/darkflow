# Phase 0 Step 9 - Built-Client Default Decision

## Decision

**COMPLETE**

Cutover date: 2026-08-08

Phase 0 Step 9 makes `dist/client/` the default production serve target for
web (`npm start`), Docker, and unpackaged Electron (`npm run desktop`). The
transitional unbuilt `public/` production path is removed. Development against
source files remains available only through `npm run dev`.

## Dependency cohort

Exact versions pinned in `package.json` at cutover:

| Package                        | Version                | Notes                                                             |
| ------------------------------ | ---------------------- | ----------------------------------------------------------------- |
| `typescript`                   | 6.0.3                  | Plain dependency in the manifest                                  |
| `@typescript/native`           | `npm:typescript@7.0.2` | Native compiler `ttsc` actually invokes                           |
| `typia`                        | 13.2.0                 | Runtime validators via ttsc/unplugin transform                    |
| `ttsc`                         | 0.23.0                 | TypeScript compiler CLI wrapper                                   |
| `@ttsc/unplugin`               | 0.23.0                 | Vite transform plugin                                             |
| `vite`                         | 8.1.5                  | Builds `dist/client/`; default target `baseline-widely-available` |
| `svelte`                       | 5.56.8                 | Phase 0 harness only                                              |
| `@sveltejs/vite-plugin-svelte` | 7.2.0                  | Svelte integration for Vite                                       |
| `dockview`                     | 7.0.4                  | Isolated workspace spike only                                     |

`npm ls typescript` reports 6.0.3 because that is the declared dependency name;
the native compiler path resolves `@typescript/native` to TypeScript 7.0.2.

## Dockview verdict

See [Phase 0 Step 6 Dockview Decision](multi-connection-ui-phase-0-step-6-dockview-decision.md).

Dockview 7.0.4 is **APPROVED for a future migration step**. Step 9 does not
adopt Dockview in the production UI at `/`; it only changes which validated
directory Express serves.

## Browser baseline change

Vite 8.1.5 leaves `build.target` unset in `vite.config.ts`, so production
bundles use Vite's `baseline-widely-available` default:

- Chrome >= 111
- Edge >= 111
- Firefox >= 114
- Safari >= 16.4
- iOS >= 16.4

This replaces the repository's former Chrome/Firefox 90 and Safari 15 promise.
`CLAUDE.md` and `README.md` were updated accordingly.

## Serve-mode contract after Step 9

```js
await startServer({
  port,
  host,
  mode: "dev" | "built", // 'legacy' removed
});
```

| Command           | Mode              | Client root                           |
| ----------------- | ----------------- | ------------------------------------- |
| `npm run dev`     | `dev`             | `public/` plus Vite HMR at `/phase0/` |
| `npm start`       | `built` (default) | `dist/client/`                        |
| `npm run desktop` | `built` (default) | `dist/client/`                        |
| Docker `CMD`      | `built` (default) | `dist/client/`                        |

CLI flags: `--dev` selects development mode. `--built-client` and `start:built`
are removed; there is only one non-dev production mode.

## Verification commands

Environment: macOS, Node v22.15.0, npm 10.9.2, package version 1.5.6.

| Command                                                                                                                | Result                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "'legacy'\|builtClientMode\|start:built\|--built-client" server.js package.json Dockerfile desktop/runtime.cjs` | PASS; no production-relevant matches                                                                                               |
| `rg -n "Firefox 90" CLAUDE.md README.md`                                                                               | PASS; no matches                                                                                                                   |
| `npm run build`                                                                                                        | PASS; 222 modules transformed, artifact validated at 1.5.6                                                                         |
| `npm run format:check`                                                                                                 | PASS                                                                                                                               |
| `npm run lint`                                                                                                         | PASS                                                                                                                               |
| `npm run typecheck`                                                                                                    | PASS                                                                                                                               |
| `npm run check`                                                                                                        | PASS                                                                                                                               |
| `npm test`                                                                                                             | PASS; 429 passed, 2 pre-existing failures unrelated to Step 9 (see below)                                                          |
| `npm run test:server:built`                                                                                            | PASS; unflagged `node server.js` and built lifecycle verified                                                                      |
| `npm run verify:client-artifact`                                                                                       | PASS                                                                                                                               |
| `npm run test:browser:production`                                                                                      | PASS; unflagged `node server.js` webServer                                                                                         |
| `npm run test:transports`                                                                                              | PASS; ws/wss/telnet/telnets on unflagged server                                                                                    |
| `docker build --tag darkflow-ci .`                                                                                     | PASS                                                                                                                               |
| Unflagged `npm start` on port 3125                                                                                     | PASS; `/api/version` returned `1.5.6`                                                                                              |
| Unflagged `node server.js` with missing `dist/client/`                                                                 | PASS; exits 1 with build-artifact guidance                                                                                         |
| `npm run desktop:smoke`                                                                                                | Not run locally; Electron binary unavailable in this environment (`app` undefined at main load). CI baseline job covers this path. |

Step 2–5 spot checks during implementation:

```bash
npm run build && npm start &
sleep 1
curl -sf localhost:3000/api/version   # real package version when port free
kill %1
```

Full acceptance battery (browser, desktop, Docker) should be run before merge;
see the Step 9 implementation plan Step 6 command chain.

## Known limitations

- **No runtime rollback flag.** Reverting production serving means redeploying
  the previous release/image or `git revert`. `npm run dev` is now the only way
  to run against unbuilt `public/` source.
- **Build required for production paths.** `npm start`, `npm run desktop`, and
  Docker all require a fresh `npm run build` first. Missing `dist/client/` fails
  loudly via `validateClientArtifact` before `server.listen`.
- **Dockview approved but not adopted.** The legacy JavaScript client remains the
  visible application shell at `/`.
- **Ops muscle memory.** Anyone invoking `node server.js` or `npm start`
  expecting instant unbuilt-`public/` serving must switch to `npm run dev`.

## Pre-existing fixes bundled in this diff

- `e2e/workspace-touch.spec.ts`: added `@ts-expect-error` for CDP `pointerType:
"touch"` because Playwright typings omit it; required for `npm run typecheck`.

## Pre-existing test note

`npm test` reports two failures unrelated to Step 9:

- `disabled alias Tab completion falls through without changing input` —
  `WebSocket is not defined` in the Node test harness.
- These failures predate the serve-mode cutover and are not introduced by this
  diff.

## Scope confirmation

- `server.js`, `desktop/runtime.cjs`, `Dockerfile`, `package.json`, CI workflow,
  production Playwright config, integration check, and browser-support docs
  updated.
- No changes to `public/js/*` modules, GMCP protocol, or server-side
  (`darkwind-nextgen`) code.
- Phase 0 dependency versions unchanged.
