# Phase 0 Step 1 Implementation Plan

*Plan stress-tested via five-lens adversarial review. 9 findings surfaced, 6 survived.*

## Goal

Establish a reproducible, green baseline before introducing TypeScript, Typia,
Vite, Svelte, or other frontend dependencies. The baseline must enforce Node
22.12+, run existing tests and Electron smoke checks in a loopback-capable

The repository currently documents Node 18+ (`README.md:41-49`) despite
dependencies requiring Node 22.12+ (`package-lock.json:21-29`). Its only CI
workflow is tag-triggered (`.github/workflows/desktop-release.yml:3-7`), and
`lib/telnet-parser.js` (`Dockerfile:8-9`, `server.js:121-125`).

## Must-haves

- [MH1] Enforce Node.js 22.12.0 as the minimum supported runtime. Acceptance:
  `npm ci` succeeds on Node 22.12.0, and npm rejects unsupported Node versions
  through `engine-strict`.
- [MH2] Add normal CI for pull requests and pushes to `main`. Acceptance: the
  workflow performs a clean install and passes the existing root test suite
  without skipped or allowed-failure steps.
- [MH3] Run Electron smoke coverage in CI. Acceptance: `npm run desktop:smoke`
  exits successfully under Xvfb and exercises the renderer, preload, local
  Express server, configuration, and Howler checks implemented in
  `desktop/main.cjs:194-217`.
- [MH4] Build and start the Docker image in CI. Acceptance: the container
  remains running and `/`, `/ping`, `/config.json`, `/api/version`, and
  `/vendor/howler.core.min.js` return their expected successful responses.
- [MH5] Preserve existing server and proxy checks. Acceptance: the ephemeral
  loopback and desktop-session checks in `test/server-lifecycle.test.js:22-62`
  and the telnet/proxy parser tests in `test/telnet-parser.test.js` pass as part
  of `npm test`.
- [MH6] Record the initial and final baseline. Acceptance: a dated report
  identifies the commit, environment, commands, outcomes, genuine repository
  failures, environmental limitations, fixes, and final CI run.

## Out Of Scope

- TypeScript, Typia, ttsc, Vite, Svelte, and Dockview dependencies.
- A frontend build or changes under `public/`.
- Docker multi-stage production builds, which belong to Phase 0 Step 8.
- Electron packaging, installers, signing, or release publication.
- Live Darkwind connections or network-dependent transport tests.
- New `/proxy` behavior or broader server refactoring.
- Suppressing genuine failures with `continue-on-error`, retries, or
  expected-failure lists.

## Assumptions

- GitHub-hosted Ubuntu runners support loopback sockets, Docker, and Xvfb. If
  false: use a suitable self-hosted runner rather than weakening coverage.
- Electron 43.1.1 can complete the existing smoke path under Xvfb. If false:
  move that job to a supported native runner while retaining it as a required
  check.
- Copying `lib/` into the existing Docker image is an acceptable baseline
  correction. If false: Docker startup remains a known blocking failure and
  Step 2 cannot begin.
- CI should run on pull requests and pushes to `main`. If false: adjust only
  the workflow triggers, not its required checks.
- The existing test count may change before execution. If false: record the
  observed count rather than hard-coding the earlier 371-test figure.

## Risks

- `engine-strict` will intentionally break installs on older developer
  environments. Mitigation: add `.nvmrc`, update the README, and make the error
  occur before frontend dependencies are added.
- Electron can hang when renderer startup fails. Mitigation: give the CI job a
  short timeout and retain Electron output in the job log.
- A Docker smoke failure can leave a container running. Mitigation: use a shell
  trap that always prints logs and removes the container.
- Environmental socket denial can resemble an application regression.
  Mitigation: use GitHub CI as the authoritative loopback environment and
  record local sandbox failures separately.
- The first CI link cannot be recorded before pushing the workflow. Mitigation:
  use a two-pass update, first establishing CI and then recording the
  successful run.

## Steps

### Step 1 - Capture The Pre-change Baseline

**Files:** `docs/plans/multi-connection-ui-phase-0-step-1-baseline.md`

**Intent:** Run the current commands from the base commit in an environment
that permits loopback sockets. Record Node, npm, Docker, operating-system, test
count, command exit status, and complete failure summaries before changing
runtime requirements or CI.

Classify each failure as one of:

- Repository defect reproducible in CI.
- Missing local dependency or tool.
- Sandbox or loopback restriction.
- External network dependency.

The Docker omission of `lib/` should be recorded as a repository defect because
the image copies `server.js` but not a module it imports.

**Verify:**

```bash
node --version
npm --version
docker version
npm ci
npm test
npm run desktop:smoke
```

On Linux, run Electron through:

```bash
xvfb-run --auto-servernum npm run desktop:smoke
```

**Done when:** Every command has a dated result in the baseline report, with
environmental failures clearly separated from repository defects.

### Step 2 - Enforce The Node Runtime Floor

**Files:** `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `README.md`

**Intent:** Add `engines.node: ">=22.12.0"` to the root package and
synchronized lockfile metadata. Set `engine-strict=true`, provide `.nvmrc` with
`22.12.0`, and replace the README's Node 18+ requirement with Node 22.12+.

Do not change dependency versions in this step.

**Verify:**

```bash
node -e "const p=require('./package.json'); if (p.engines?.node !== '>=22.12.0') process.exit(1)"
node -e "const fs=require('fs'); if (fs.readFileSync('.nvmrc','utf8').trim() !== '22.12.0') process.exit(1); if (!fs.readFileSync('.npmrc','utf8').includes('engine-strict=true')) process.exit(1)"
npm ci
npm test
```

**Done when:** The manifest, lockfile, local runtime hint, npm enforcement, and
documentation agree on Node 22.12+, with no dependency-version drift.

### Step 3 - Restore Docker Startup

**Files:** `Dockerfile`

**Intent:** Copy `lib/` into the current image alongside `server.js` and
`public/`. This is the smallest correction required for the existing server
entry point to resolve `./lib/telnet-parser`.

Do not introduce the later multi-stage build or frontend artifact contract.

**Verify:**

```bash
docker build -t darkflow:phase0-step1 .
container="$(docker run -d -e MCP_ENABLED=0 -p 127.0.0.1:3000:3000 darkflow:phase0-step1)"
trap 'docker logs "$container"; docker rm -f "$container"' EXIT
curl --fail --silent http://127.0.0.1:3000/
curl --fail --silent http://127.0.0.1:3000/config.json
curl --fail --silent http://127.0.0.1:3000/api/version
curl --fail --silent http://127.0.0.1:3000/vendor/howler.core.min.js
test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:3000/ping)" = "204"
```

**Done when:** The image starts without a module-resolution error, all required
HTTP probes pass, and the container is removed after verification.

### Step 4 - Add Push And Pull-request CI

**Files:** `.github/workflows/ci.yml`

**Intent:** Add a read-only GitHub Actions workflow for pull requests and
pushes to `main`, separate from the tag-only release workflow.

Use two required jobs:

- Baseline job: checkout, Node 22.12.0, npm cache, `npm ci`, `npm test`, and
  Electron smoke under Xvfb.
- Docker job: build the image, start it with `MCP_ENABLED=0`, poll for
  readiness, verify the five HTTP contracts, print logs on failure, and always
  remove the container.

Set explicit job timeouts. Do not use `continue-on-error` or depend on the live
MUD.

**Verify:**

```bash
npm ci
npm test
xvfb-run --auto-servernum npm run desktop:smoke
```

After pushing:

```bash
gh run list --workflow ci.yml --branch <branch> --limit 1
gh run watch <run-id> --exit-status
```

**Done when:** Both CI jobs complete successfully from a clean checkout on Node
22.12.0.

### Step 5 - Finalize The Baseline Record

**Files:** `docs/plans/multi-connection-ui-phase-0-step-1-baseline.md`

**Intent:** Add the final CI run URL, commit SHA, exact test result, Electron
smoke result, Docker probes, resolved Docker defect, and any remaining
limitations. Environmental failures must not be represented as application
regressions, and genuine failures must not be hidden.

**Verify:**

```bash
gh run view <run-id>
git diff --check
```

**Done when:** The report shows a green clean-install baseline and contains no
unresolved repository failure that would make later frontend changes ambiguous.

## Success Criteria

- [ ] Node 22.12+ is consistently enforced and documented.
- [ ] `npm ci` succeeds from a clean checkout on Node 22.12.0.
- [ ] `npm test` exits successfully, including current server and proxy-related
  tests.
- [ ] Electron smoke exits successfully in CI.
- [ ] The Docker image builds, remains running, and passes all HTTP probes.
- [ ] Push and pull-request CI is green without allowed failures.
- [ ] The dated baseline report links to the successful CI run.
- [ ] No frontend dependency or production-client behavior has changed.

## Rollback

No data or externally published artifacts are changed. Revert the Step 1 commit
or pull request to remove the Node enforcement, CI workflow, Docker copy
correction, and baseline report.

Plan self-review: PASS (9/10)

Notes:

- Actual command output and CI URLs must be filled in during execution.
- Any genuine pre-existing failure discovered beyond the statically identified
  Docker omission blocks Phase 0 Step 2 until it is fixed or explicitly
  separated into a prerequisite change.
