# Phase 0 Step 7 Verification

## Status

Local Step 7 gate: **PASS**. Hosted CI is pending a push, so Step 7 is not
recorded as fully complete yet.

## Environment

- Verification date: 2026-08-07 (America/Detroit)
- Working-tree base commit: `011a170`
- Implementation state: uncommitted working tree
- Node: `v22.15.0`
- npm: `10.9.2`
- Generated client version: `1.5.6`
- Generated artifact files: `296`
- Generated Phase 0 bundle: `dist/client/assets/phase0-D8WtUFKX.js`
- CI URL: not available; the branch was not pushed during this implementation

All npm commands were run with the repository-pinned Node installation on
`PATH`.

## Command results

| Command | Result |
| --- | --- |
| `npm ci` | PASS; 560 packages installed from the lockfile |
| `npm run format:check` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run check` | PASS; 0 errors and 0 warnings |
| `npm test` | PASS; 409 passed, 0 failed, 0 skipped |
| `node --test test/client-artifact.test.js` | PASS; 10 passed |
| `npm run build` | PASS; 222 modules transformed; version writer, Typia sentinel, and artifact verifier passed |
| `npm run verify:client-artifact` | PASS; `dist/client` validated at version `1.5.6` |
| Generated version shape/package comparison | PASS; exactly `{ "version": "1.5.6" }` |
| `cmp public/index.html dist/client/index.html` | PASS |
| `npm run test:server:built` | PASS; built lifecycle contract verified |
| `npm run test:browser` | PASS; 19 passed across Chromium, Firefox, WebKit, and mobile Chromium |
| `npm run test:browser:production` | PASS; 1 Chromium production smoke passed |
| Default `start`/Electron script invariant | PASS; `npm start` and `npm run desktop` remain legacy |
| `git diff --check` | PASS |

## Verified behavior

- `npm run build` rewrites `dist/client/version.json` from `package.json` and
  validates the complete public-file parity and Phase 0 bundle contract.
- Built mode validates before MCP attachment and listening, serves only
  `dist/client/`, returns the generated version with `no-store`, and exposes no
  Vite source or HMR endpoints.
- Missing artifacts, unknown modes, conflicting CLI flags, listen failures,
  repeated development lifecycles, and development-to-built restarts preserve
  mode isolation and recover cleanly.
- The production browser smoke renders the unchanged legacy shell, loads
  Howler, verifies representative APIs/assets, and observes no page, console,
  or same-origin request failures.
- The normal CI workflow now requires artifact validation, the built-server
  lifecycle gate, the existing development browser matrix, and the production
  Chromium smoke.

## Known limitations

- Hosted CI evidence and a CI URL remain pending until the branch is pushed.
- Docker and Electron intentionally remain legacy consumers until Step 8.
- Root `npm ci` does not install the optional `mud-test-mcp` dependencies. The
  production gates set `MCP_ENABLED=0` and verify that disabled mount status is
  observable; MCP behavior itself is unchanged.
