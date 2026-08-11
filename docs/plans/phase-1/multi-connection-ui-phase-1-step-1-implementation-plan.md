# Phase 1 Step 1 Implementation Plan

Clarification gate skipped: this is a bounded, documentation-only elaboration
of the approved Phase 1 Step 1 contract. It introduces no product decision;
implementation remains one reversible baseline PR and preserves the current
single-session client.

## Goal

Establish a trustworthy Phase 1 starting point by making the root and embedded
MCP test suites independently owned and independently required in CI. A root
test result must contain only Darkflow root tests, while `npm run test:mcp` must
continue to prove the MCP package from a clean nested install.

Record the current one-session behaviors that subsequent Phase 1 PRs must
preserve. Success is a green, loopback-capable CI run with a baseline report
that distinguishes repository defects from local-environment limitations; this
step does not alter the client, transports, or stored player data.

## Evidence and constraints

- The root script currently runs unqualified `node --test`, but the separate
  MCP package has its own unqualified test command (`package.json:22-24`,
  `mud-test-mcp/package.json:9-12`). Node can therefore discover
  `mud-test-mcp/test/session.test.js` during a root run; Step 1 must make the
  root file set explicit.
- The root test files are currently direct children of `test/`, with both
  `.test.js` and `.test.mjs` extensions. The MCP integration test is instead
  under `mud-test-mcp/test/` and opens an ephemeral `127.0.0.1` fake MUD
  (`mud-test-mcp/test/session.test.js:1-7, 57-64`).
- At plan authoring, the explicit root command completed 424 passes and three
  `listen EPERM: operation not permitted 127.0.0.1` failures in
  `test/dev-server-integration.test.mjs:74`, `test/proxy-upgrade.test.js:20`,
  and `test/server-lifecycle.test.js:22`. This sandbox cannot bind loopback;
  record those as environment-limited evidence unless a loopback-capable CI run
  reproduces them.
- CI already has a root baseline job and a separate MCP job. The root job runs
  `npm test` after a clean root install, while the MCP job independently
  installs and runs the nested package (`.github/workflows/ci.yml:30-45,`
  `129-145`). Step 1 should make the MCP job invoke the public `test:mcp`
  script so local and CI execution use one contract.
- The root browser smoke already proves the legacy root shell renders
  (`e2e/phase0-dev.spec.ts:14-17`); the production artifact smoke covers the
  toolbar, terminal, command input, connection controls, Howler, and static
  route contracts without a live MUD (`e2e/production-artifact.spec.ts:60-127`).
- Built-browser transport coverage exercises `ws`, `wss`, `telnet`, and
  `telnets` through the visible controls, verifies prompt/output and command
  framing, and closes every fixture socket (`e2e/transports.spec.ts:61-115`).
  The root unit suite separately fixes fallback ordering and GMCP normalization
  semantics (`test/connection-transport.test.mjs:36-56`,
  `test/gmcp-normalizer.test.mjs:10-83`). These are the baseline parity
  scenarios; Step 1 records them rather than broadening them.

## Must-haves

- [MH1] The root `test` script names only root test-file patterns —
  acceptance: `npm test` invokes
  `node --test test/*.test.js test/*.test.mjs` (or an equivalent explicit
  root-only enumeration), and no `mud-test-mcp/test/**` file can be selected.
- [MH2] MCP remains a separately installed required gate — acceptance:
  `npm run test:mcp` executes `npm ci --prefix mud-test-mcp` before
  `npm test --prefix mud-test-mcp`, and the CI MCP job invokes that script
  from a clean checkout.
- [MH3] The two suites have independent green evidence — acceptance: each CI
  job succeeds on the pinned Node 22.15.0/npm 10.9.2 toolchain; a failure log
  identifies the owning suite rather than presenting a combined test result.
- [MH4] The baseline record freezes representative one-session parity behavior
  — acceptance: it names the command, fixture/test, user-visible scenario, and
  current status for root shell, production artifact, four transports,
  connection fallback, GMCP normalization, and the MCP fake-MUD flow.
- [MH5] No client behavior changes in this step — acceptance: the PR does not
  modify `public/**`, `client/**`, runtime server/proxy behavior, data formats,
  or the intentionally skipped mobile workspace coverage.

## Out of scope

- Any `Session`, profile, persistence, configuration, GMCP, reconnect, or
  teardown implementation; Step 2 remains blocked until this baseline is green.
- Adding or expanding browser tests, restoring the skipped mobile workspace
  suite, or changing Playwright projects/retries.
- Fixing a product behavior solely to make a test green. A confirmed behavior
  regression outside test isolation is a separately reviewed prerequisite.
- Dependency updates, test-framework migration, workspace conversion, or
  folding `mud-test-mcp/` into the root package.
- Server-side protocol, `/proxy`, Docker, Electron, deployment, release, or
  legacy-storage changes.

## Assumptions

- [All root test files remain direct children of `test/` through this PR] — if
  false: do not merge a script that silently omits a nested root test; add a
  reviewed root-test launcher that recursively enumerates only `test/**` and
  update this plan before changing the script.
- [GitHub's Ubuntu runner remains the authoritative loopback-capable
  environment] — if false: record the runner limitation and move the required
  job to a suitable runner rather than weakening the socket tests.
- [The existing `npm run test:mcp` clean install is the desired ownership
  boundary] — if false: a package/workspace decision is required and Step 1
  stops before changing test discovery.
- [Any red root test after isolation is independent of the MCP suite] — if
  false: preserve the original output in the baseline record and correct the
  test-selection change before investigating unrelated failures.

## Risks

- Shell glob behavior could differ across environments and omit a root test.
  Mitigation: use two explicit POSIX globs for the two extensions, run the
  script through npm locally and in Linux CI, and record the selected test-file
  list/count in the baseline report.
- A loopback, browser, or Electron failure can be misclassified as a product
  regression. Mitigation: classify every red command as repository defect,
  missing dependency/tool, sandbox/loopback restriction, or external-network
  dependency; only CI-reproducible repository defects may be fixed in this PR.
- Editing the CI MCP job may accidentally stop performing a clean nested
  install. Mitigation: call `npm run test:mcp` exactly once in that job and
  retain the nested lockfile cache key.
- The baseline record could claim parity not actually covered by an executable
  fixture. Mitigation: each row names an existing command and test file; mark
  unexecuted local evidence as such and use the linked CI outcome as the
  authoritative status.

## Steps

### Step 1 — Capture the pre-change split-suite evidence

**Files:** `docs/plans/multi-connection-ui-phase-1-step-1-baseline.md` (new)

**Intent:** Before changing a script, record the base commit SHA, date, OS,
Node/npm versions, install state, exact invocation, test-file count, exit code,
and concise failure output for both current commands. Explicitly record whether
the current root discovery includes `mud-test-mcp/test/session.test.js`.

Classify each failed command as a repository defect reproducible in CI, missing
local dependency/tool, sandbox or loopback restriction, or external-network
dependency. Do not treat an unavailable local browser/runtime as evidence of a
client regression.

**Verify:**

```bash
git rev-parse HEAD
node --version
npm --version
npm test
npm run test:mcp
```

**Done when:** The initial report has one dated result per command and labels
the nested-test-discovery observation and every failure classification.

### Step 2 — Make root test ownership explicit

**Files:** `package.json`

**Intent:** Change only the root `test` script from unqualified discovery to
the explicit root-owned file patterns:

```json
"test": "node --test test/*.test.js test/*.test.mjs"
```

Keep `test:mcp` unchanged: it is the MCP package's clean-install boundary, not
a dependency of the root suite. Do not add exclusions, retries, skips, or
`continue-on-error` behavior, and do not change any test assertions merely to
alter the count.

**Verify:**

```bash
npm test
npm run test:mcp
```

**Done when:** The root command selects only `test/*.test.js` and
`test/*.test.mjs`; the MCP test appears only in the `test:mcp` output; both
commands expose their own pass/fail result.

### Step 3 — Make CI execute the public split-suite contract

**Files:** `.github/workflows/ci.yml`

**Intent:** Preserve the existing root baseline job's `npm ci` then `npm test`
ordering. In the `mcp` job, replace the separate nested install/test commands
with one `npm run test:mcp` step, retaining Node/npm version checks, the nested
lockfile cache dependency path, the 15-minute timeout, and required-job status.
This gives local development and CI exactly the same nested clean-install
contract.

**Verify:**

```bash
npm ci
npm test
npm run test:mcp
```

After pushing the PR branch:

```bash
gh run watch <run-id> --exit-status
```

**Done when:** A clean CI run shows independent successful `baseline` and
`mcp` jobs; the MCP job log contains the nested clean install performed by
`npm run test:mcp`.

### Step 4 — Resolve only a confirmed root-suite defect, if isolation exposes one

**Files:** the failing file under `test/` and its directly owned implementation
module, only if a post-isolation failure is reproducible in CI

**Intent:** Re-run the isolated root suite after Step 2. The three known local
`EPERM` cases are sandbox-limited and receive no source change unless CI
reproduces them. If CI exposes another failure, or reproduces one of those
failures, preserve the command output in the baseline report and apply the
smallest contract-preserving correction to the named root test or directly owned
module. If it is green in CI, make no additional code or fixture change.

Stop and create a separate prerequisite plan if the correction changes visible
single-session behavior, crosses ownership boundaries, depends on external
network state, or needs a new test framework/toolchain decision.

**Verify:**

```bash
npm test
node --test <explicit-failing-root-test-file>
npm run test:mcp
```

**Done when:** There is either no post-isolation root failure or the report
links a CI-reproducible root defect to its minimal correction and both isolated
suites are green. No MCP, client, or transport behavior is changed to mask a
failure.

### Step 5 — Freeze the one-session parity inventory and final evidence

**Files:** `docs/plans/multi-connection-ui-phase-1-step-1-baseline.md`

**Intent:** Complete the report with the final commit SHA, exact root/MCP
commands and counts, local-versus-CI outcomes, resolved defects, limitations,
and links to the successful required jobs. Add this parity inventory for Step
16 to reuse without guessing:

| Scenario to preserve     | Existing executable evidence                                      | What the record must state                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root startup shell       | `e2e/phase0-dev.spec.ts` — `legacy root renders its client shell` | `/` shows the toolbar before a game connection.                                                                                                                    |
| Production root          | `npm run build && npm run test:browser:production`                | Toolbar, terminal, command input, endpoint controls, Howler, `/config.json`, `/api/version`, `/ping`, and static assets work without live-MUD connection attempts. |
| Four visible transports  | `npm run test:transports`                                         | `ws`/`wss` are direct; `telnet`/`telnets` use `/proxy`; prompt/output, `look` framing, no fallback, and socket cleanup hold.                                       |
| Fallback selection       | `test/connection-transport.test.mjs` through `npm test`           | The current ladder ordering and HTTPS mixed-content rule remain unchanged.                                                                                         |
| GMCP input normalization | `test/gmcp-normalizer.test.mjs` through `npm test`                | Canonical package names, support normalization, aliases, room data, and exit-state mapping remain unchanged.                                                       |
| MCP relay flow           | `npm run test:mcp`                                                | The nested fake-MUD login, IAC-GA framing, GMCP state, and scripted pass/fail flow remain independently green.                                                     |

The report must distinguish a scenario's **recorded fixture** from a command
executed in the Step 1 PR. Phase 1 Step 16 reruns the complete listed parity
battery; Step 1 establishes the baseline and test ownership, not a duplicate
release gate.

**Verify:**

```bash
npm test
npm run test:mcp
git diff --check
```

**Done when:** The baseline document has no unresolved CI-reproducible root
failure, links both green required jobs, and contains the complete parity table
with commands and expected user-visible behavior.

## Success criteria

- [ ] `npm test` is explicit about root-owned test files and cannot discover
      `mud-test-mcp/test/**`.
- [ ] `npm run test:mcp` remains a fresh nested install followed by the nested
      suite, and CI invokes that public command as a required job.
- [ ] Root and MCP outcomes are independently green in a clean, loopback-capable
      Node 22.15.0/npm 10.9.2 CI run.
- [ ] Any red command is classified with evidence; only CI-reproducible,
      scope-preserving root defects are fixed.
- [ ] `multi-connection-ui-phase-1-step-1-baseline.md` records exact commands,
      environment, selected tests/counts, CI links, limits, and the six-row parity
      inventory.
- [ ] The Step 1 diff leaves `public/**`, `client/**`, product contracts, and
      persisted data unchanged.

## Rollback

No data migration, external API mutation, or published artifact is involved.
Revert the Step 1 PR to restore the former root test-discovery command and CI
MCP invocation; the baseline report can remain as historical evidence or be
reverted with the PR. Do not delete the embedded MCP package or its lockfile.

Plan self-review: PASS (9/10)

Notes:

- The final report must use observed test counts and run URLs; this plan does
  not hard-code either because both can legitimately change before execution.
- The explicit two-glob root command is intentionally valid only while root
  tests remain flat. A future nested root test requires a reviewed runner change
  rather than silently losing coverage.
