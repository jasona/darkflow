# Phase 1 Step 1 Baseline Report

Date: 2026-08-08

## Purpose

Record the pre- and post-change test-suite split for Phase 1 Step 1. Root tests
and the nested MCP harness are independently owned, independently invoked, and
independently required in CI. This step does not change client behavior.

## Environment

| Field           | Pre-change (local)                         | Post-change (local, pinned)    | CI (authoritative) |
| --------------- | ------------------------------------------ | ------------------------------ | ------------------ |
| Base commit SHA | `652687df39be8ae724e0dcb5ea8cd9add6905af1` | same + uncommitted Step 1 diff | pending push       |
| OS              | Darwin 15.5                                | Darwin 15.5                    | ubuntu-latest      |
| Node            | v20.19.3                                   | v22.15.0                       | 22.15.0            |
| npm             | 10.8.2                                     | 10.9.2                         | 10.9.2             |
| Install state   | existing `node_modules`                    | existing `node_modules`        | clean `npm ci`     |

## Pre-change evidence (Step 1 capture)

Captured before modifying `package.json` or `.github/workflows/ci.yml`.

### `npm test` (unqualified `node --test`)

- **Command:** `npm test` → `node --test`
- **Test-file count:** 71 files discovered (70 under `test/` + 1 under `mud-test-mcp/test/`)
- **Result:** 431 tests, 430 pass, 1 fail, exit code 1
- **Nested discovery:** **Yes** — `mud-test-mcp/test/session.test.js` ran as subtests 1–3 (`logs in, frames output on IAC GA…`, `graceful-failure command…`, `runScript reports pass and fail per step`).
- **Failure:**

  ```
  not ok 100 - disabled alias Tab completion falls through without changing input
  location: test/completion.test.mjs:131:1
  error: WebSocket is not defined
  ```

- **Classification:** **Local environment limitation** — Node v20.19.3 lacks the
  global `WebSocket` that Node 22.15.0 provides. Re-running with Node 22.15.0
  yields 427 pass / 0 fail (see post-change section). Not a repository defect.

- **Plan-noted EPERM cases** (`dev-server-integration.test.mjs`,
  `proxy-upgrade.test.js`, `server-lifecycle.test.js`): **not reproduced** on
  this host; all three passed. Classified as sandbox/loopback restriction in
  the plan's authoring environment, not observed here.

### `npm run test:mcp`

- **Command:** `npm run test:mcp` → `npm ci --prefix mud-test-mcp && npm test --prefix mud-test-mcp`
- **Test-file count:** 1 file (`mud-test-mcp/test/session.test.js`)
- **Result:** 3 tests, 3 pass, exit code 0

## Post-change evidence (Steps 2–5)

### Changes applied

1. **`package.json`** — root `test` script narrowed to explicit globs:
   `node --test test/*.test.js test/*.test.mjs`
2. **`.github/workflows/ci.yml`** — MCP job invokes `npm run test:mcp` (single
   step replacing separate `npm ci --prefix` + `npm test --prefix`).

### `npm test` (explicit root globs)

- **Command:** `npm test` → `node --test test/*.test.js test/*.test.mjs`
- **Test-file count:** 70 files (35 × `.test.js` + 35 × `.test.mjs`)
- **Nested discovery:** **No** — `mud-test-mcp/test/**` absent from output.
- **Result (Node 22.15.0):** 427 tests, 427 pass, 0 fail, exit code 0
- **Result (Node 20.19.3):** 427 tests, 426 pass, 1 fail, exit code 1
  (same `completion.test.mjs` / `WebSocket is not defined`; local-only)

### `npm run test:mcp`

- **Command:** unchanged public contract
- **Test-file count:** 1 file
- **Result:** 3 tests, 3 pass, exit code 0

### CI status

- **Baseline job (`npm test`):** pending — requires push and `gh run watch`
- **MCP job (`npm run test:mcp`):** pending — requires push and `gh run watch`
- **CI run URL:** _not yet available (Step 1 diff uncommitted, not pushed)_

## Resolved defects

None. The sole local root failure is a Node-version mismatch (global
`WebSocket` available in 22.15.0, absent in 20.19.3). No source or fixture
change was required.

## One-session parity inventory

Scenarios Phase 1 Step 16 must preserve. Step 1 records existing executable
evidence; browser/e2e rows were **not re-executed** in this PR.

| Scenario to preserve     | Command / fixture                                                                          | User-visible behavior                                                                                                                                          | Step 1 status                                  |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Root startup shell       | `npm run test:browser` → `e2e/phase0-dev.spec.ts` — `legacy root renders its client shell` | `/` shows `#toolbar` before a game connection.                                                                                                                 | **Recorded fixture** — not executed in this PR |
| Production root          | `npm run build && npm run test:browser:production` → `e2e/production-artifact.spec.ts`     | Toolbar, terminal, command input, endpoint controls, Howler, `/config.json`, `/api/version`, `/ping`, static assets work without live-MUD connection attempts. | **Recorded fixture** — not executed in this PR |
| Four visible transports  | `npm run test:transports` → `e2e/transports.spec.ts`                                       | `ws`/`wss` direct; `telnet`/`telnets` via `/proxy`; prompt/output, `look` framing, no fallback, socket cleanup.                                                | **Recorded fixture** — not executed in this PR |
| Fallback selection       | `npm test` → `test/connection-transport.test.mjs`                                          | Priority ladder `wss → ws → telnets → telnet`; HTTPS mixed-content skips plain `ws`.                                                                           | **Green** (427/427 on Node 22.15.0)            |
| GMCP input normalization | `npm test` → `test/gmcp-normalizer.test.mjs`                                               | Canonical package names, support normalization, aliases, room data, exit-state mapping.                                                                        | **Green** (427/427 on Node 22.15.0)            |
| MCP relay flow           | `npm run test:mcp` → `mud-test-mcp/test/session.test.js`                                   | Fake-MUD login, IAC-GA framing, GMCP state, scripted pass/fail flow.                                                                                           | **Green** (3/3)                                |

## Limitations

- Local default Node (v20.19.3) is below the pinned engine (22.15.0); one root
  test (`completion.test.mjs:131`) fails locally but passes on the pinned toolchain.
- CI run URLs and required-job confirmation are pending until the Step 1 branch
  is pushed.
- Browser, Docker, and desktop smoke jobs were not re-run as part of Step 1;
  they remain covered by existing CI jobs unchanged in this step.

## Rollback

Revert the Step 1 diff to restore unqualified `node --test` and the separate
MCP CI install/test steps. This report remains valid as historical evidence.
