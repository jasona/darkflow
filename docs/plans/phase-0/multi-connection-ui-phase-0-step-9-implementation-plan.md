# Phase 0 Step 9 Implementation Plan

## Goal

Make the Step 7/8 built-client artifact (`dist/client/`) the default
production serve target for both web and Electron, and remove the
transitional "serve `public/` directly, unbuilt" production path that Steps
7-8 deliberately kept in place. `npm run dev` keeps serving legacy `public/`
plus Vite middleware unchanged; `npm start` and unpackaged `npm run desktop`
switch from that unbuilt legacy path to the validated `dist/client/`
artifact. Record the Phase 0 decision cohort (dependency versions, Dockview
verdict, browser-baseline change, known limitations) in one consolidated
document so Phase 0 has a single closing record.

This is a low-risk content-wise change: Vite already copies `public/`
byte-for-byte into `dist/client/` (`vite.config.ts:8`, enforced by
`lib/client-artifact.js`'s parity check per the Step 7 plan), so flipping the
default does not change what users see - it changes which validated
directory Express serves it from.


## Must-haves

- [MH1] `npm start` (and any unflagged `startServer()` call) serves
  `dist/client/` by default. Acceptance: `npm run build && npm start`, then
  `curl -s localhost:3000/api/version` returns the real `package.json`
  version (not `unknown`); deleting `dist/client` first makes `npm start`
  exit non-zero with the existing "Run `npm run build`" message
  (`server.js:364-367`, unchanged).
- [MH2] The non-dev "serve unbuilt `public/` directly" production path is
  removed from `server.js`, `desktop/runtime.cjs`, and `Dockerfile`, while
  `npm run dev` is bit-for-bit unchanged. Acceptance:
  `rg -n "'legacy'" server.js desktop/runtime.cjs` returns nothing;
  `rg -n "built-client" Dockerfile` returns nothing; `npm run dev` still
  serves legacy `public/` at `/` plus Vite HMR at `/phase0/`.
- [MH3] Unpackaged Electron (`npm run desktop`, no flags) defaults to
  `dist/client/`, matching packaged Electron's existing default. Acceptance:
  `npm run desktop:prepare-client && npm run desktop` launches without the
  missing-artifact error; `npm run desktop:smoke` (already CI-covered) stays
  green with `--built-client` dropped from its invocation.
- [MH4] CI proves the new default explicitly, not just the previously-flagged
  path. Acceptance: `npm run test:server:built` (or an added case in it)
  exercises `node server.js` with **no** flags and asserts built-mode
  behavior; CI `baseline` job stays green.
- [MH5] A consolidated Step 9 decision doc records the exact dependency
  cohort, the Dockview verdict (by reference), the browser-baseline change,
  verification commands/evidence, and known limitations. Acceptance:
  `docs/plans/multi-connection-ui-phase-0-step-9-decision.md` exists and is
  linked from the master plan.
- [MH6] Stale browser-support docs are corrected. Acceptance:
  `rg -n "Firefox 90" CLAUDE.md README.md` returns nothing.

## Out of scope

- Porting any `public/js/*` module to Svelte, or replacing the visible
  application shell - Phase 0's own assumption is explicit that it "does not
  convert the existing frontend modules or replace the visible application
  shell" (`multi-connection-ui-phase-0-implementation-plan.md:168-169`).
- Adopting Dockview/Svelte panels in the production UI. Step 6's approval is
  scoped to "a future migration step" only
  (`multi-connection-ui-phase-0-step-6-dockview-decision.md:13-14`); this
  plan changes which directory Express serves, not what the UI renders.
- Any GMCP protocol change, `Darkwind.*` package rename, or server-side
  (`darkwind-nextgen`) change.
- New Playwright/E2E coverage beyond what Steps 1-8 already added - this
  plan reuses the existing suite against the now-default path.
- Adding, removing, or upgrading any Phase 0 dependency.
- Resolving the two pre-existing uncommitted files' actual content (Step 1
  below only requires the tree to be clean before this diff starts; it does
  not decide what happens to that other WIP).

## Assumptions

- [Full removal of the `'legacy'` production mode is what "remove the
  transitional legacy production mode" means, not just changing its
  default] - if false: keep a `--legacy` opt-in flag as a manual escape
  hatch instead of deleting the branch; MH2's acceptance criterion changes
  from "grep finds nothing" to "grep finds only the explicit flag, default
  proven built," and Step 2 keeps a three-way `mode` enum instead of
  collapsing to two.
- [`dist/client/` is a strict superset of every route `public/`-direct
  serving currently satisfies, since Step 7's parity validator already
  enforces byte-identical copies] - if false: some route works only via the
  `'legacy'` code path today and breaks on removal; impact is an extra
  route-parity audit step before Step 2 ships.
- [The two pre-existing uncommitted files are unrelated in-progress work,
  not a prerequisite for Step 9] - if false (e.g. the touch-spec edit is a
  required fix for a currently-broken test): Step 1 must land that other
  work first, adding up to an hour before this plan's Step 2 can start.
- [No release-tag deadline currently constrains this cutover] - if false,
  confirm before executing since step ordering may need to compress.

## Risks

- Removing the legacy production path is a real behavior change for anyone
  invoking `node server.js` or `npm start` expecting instant unbuilt-`public/`
  serving (ops scripts, other docs, muscle memory). Mitigation: `npm run dev`
  keeps that exact experience; the new default fails loudly (build-artifact
  error) rather than silently serving something wrong, since
  `validateClientArtifact` already runs before `server.listen`
  (`server.js:357-369`, unchanged by this plan). Call this out prominently in
  the Step 9 decision doc.
- `initializeApp` is shared code that Docker, CI, Electron, and bare
  `node server.js` all import - a change here has a wide blast radius even
  though every other consumer already pins `mode` explicitly today.
  Mitigation: Step 6 below re-runs the full Phase 0 acceptance battery (not
  just the new assertion) before merge.
- Flipping unpackaged `npm run desktop`'s default changes local developer
  experience: it now needs a fresh `npm run build` first or it hits the
  missing-artifact error. Mitigation: MH3 wires `desktop:prepare-client` into
  the plain `desktop` script's expected usage and documents it in the
  decision doc; `npm run dev` remains the no-build-required local option.
- Doc drift has already happened once silently (Step 3's browser-baseline
  intent never reached `CLAUDE.md`/`README.md`). Mitigation: MH6 closes this
  specific instance; building doc-lint tooling to prevent future drift is
  explicitly out of scope for Step 9.

## Public interfaces

```js
await startServer({
  port,
  host,
  mode: 'dev' | 'built', // 'legacy' removed
});
```

```bash
npm start                  # now serves dist/client/ (built) by default
npm run dev                 # unchanged: public/ plus Vite middleware
npm run build                # unchanged: produces and validates dist/client/
npm run desktop               # now builds+serves dist/client/ by default (was legacy)
```

Behavioral rules:

- `built` is the default when `mode` is omitted; `legacy` is no longer a
  valid value.
- `--dev` selects `dev`; no other CLI flag exists or is needed for serve-mode
  selection (`--built-client` is removed as meaningless once there is only
  one non-dev mode).
- Route order is unchanged: `/config.json`, `/api/version`, `/ping`,
  `/vendor/*` remain registered at module load (`server.js:63-102`); `/mcp`
  still mounts before frontend middleware (`server.js:374-419`); `/proxy`
  remains handled by the shared `upgrade` dispatcher (`server.js:149-158`).
- `getServeInfo().mode` reports `built` by default now instead of `legacy`.

## Steps

### Step 1 - Clear working-tree prerequisites

**Files:** none (git operations only)

**Intent:** Resolve the two pre-existing uncommitted changes -
`docs/plans/multi-connection-ui-phase-0-step-8-implementation-plan.md` and
`e2e/workspace-touch.spec.ts` - by committing, stashing, or intentionally
discarding them, so this plan's diff starts from a clean tree and stays
independently reviewable. Do not fold unrelated WIP into the Step 9 commits.

**Verify:**

```bash
git status --porcelain
```

**Done when:** the command above prints nothing (or only files this plan's
later steps are about to touch); a branch exists for this work.

### Step 2 - Flip the web default and delete the legacy production path

**Files:** `server.js`, `package.json`, `Dockerfile`

**Intent:** In `server.js`: shrink the accepted mode set at line 352 from
`['legacy', 'dev', 'built']` to `['dev', 'built']`; change the `clientRoot`
ternary at line 356 to `mode === 'dev' ? PUBLIC_CLIENT_ROOT :
BUILT_CLIENT_ROOT`; change `startServer`'s default parameter at line 449 from
`mode = 'legacy'` to `mode = 'built'`; change the CLI dispatch at line 501
from `devMode ? 'dev' : builtClientMode ? 'built' : 'legacy'` to
`devMode ? 'dev' : 'built'`; remove the now-unused `builtClientMode`
constant (line 129) and simplify the combine-guard at lines 497-500
accordingly (there is only one non-dev mode left, so there is nothing left to
conflict with `--dev`). In `package.json`: remove the now-redundant
`"start:built"` script (line 22) since `"start"` now does the same thing;
leave `"start"` (line 21) and `"dev"` (line 44) untouched. In `Dockerfile`:
drop the now-meaningless `"--built-client"` token from the `CMD` at line 29,
leaving `CMD ["node", "server.js"]`.

**Verify:**

```bash
rg -n "'legacy'|builtClientMode|start:built|--built-client" server.js package.json Dockerfile
npm run build
npm start &
sleep 1
curl -sf localhost:3000/api/version | grep -q "$(node -p "require('./package.json').version")"
kill %1
rm -rf dist/client
( npm start; echo "exit=$?" ) | grep -q "exit=1"
```

**Done when:** the grep above returns nothing production-relevant; unflagged
`npm start` serves the built artifact; deleting `dist/client` makes unflagged
`npm start` fail fast with the existing build-artifact error;
`npm run dev`'s behavior (legacy `public/` + Vite HMR at `/phase0/`) is
unchanged.

### Step 3 - Flip the Electron default

**Files:** `desktop/runtime.cjs`, `package.json`

**Intent:** Simplify `selectDesktopServeMode` (`desktop/runtime.cjs:14-17`)
to always return `'built'`, dropping the `isPackaged || argv.includes(
'--built-client')` branch now that there is no legacy production mode to
fall back to (packaged apps already always resolved `'built'`; this only
changes the unpackaged default). `desktop/main.cjs` needs no edit - its
`clientRoot` ternary (lines 35-39) and embedded `startServer({ mode:
desktopServeMode, ... })` call (lines 96-99) already key off
`selectDesktopServeMode`'s return value. In `package.json`: add
`desktop:prepare-client &&` to the plain `"desktop"` script (line 26) so a
local `npm run desktop` builds first instead of hitting the missing-artifact
error, matching every other `desktop:*` script's existing pattern
(`package.json:28-42`); drop the now-unnecessary `--built-client` token from
`"desktop:smoke"` (line 28).

**Verify:**

```bash
rg -n "legacy" desktop/*.cjs
npm run desktop:smoke
```

**Done when:** no code path under `desktop/` can select `'legacy'` mode;
`npm run desktop:smoke` (already CI-covered by `ci.yml`'s `baseline` job)
stays green.

### Step 4 - Lock in the default with a CI assertion

**Files:** `integration/production-server-check.mjs` (or wherever
`test:server:built` lives), `.github/workflows/ci.yml`

**Intent:** Steps 7-8 already wired `npm run build` into every push/PR CI
job and every desktop release job (see Evidence above) - this step does not
add that wiring again. It adds exactly one assertion that the check now
covers the **unflagged** path (`node server.js`, no `--built-client`) and
not only the previously-explicit flagged path, so CI would fail if someone
ever reintroduced a legacy default.

**Verify:**

```bash
npm run build
npm run test:server:built
```

**Done when:** `test:server:built` exercises unflagged `node server.js` and
asserts built-mode behavior; CI `baseline` job (`ci.yml:16-48`) stays green
with no new job added.

### Step 5 - Update stale browser-support docs

**Files:** `CLAUDE.md`, `README.md`

**Intent:** Replace `CLAUDE.md:83` and `README.md:236`'s "Chrome 90+,
Firefox 90+, Safari 15+, Edge 90+" line with Vite 8.1.5's actual default
target (`build.target` unset in `vite.config.ts` -> Vite's own
`baseline-widely-available` default). Also update `README.md:227`'s
"`public/version.json` for legacy/development" phrasing to say
"development" only, since `legacy` no longer exists as a production mode
after Step 2.

**Verify:**

```bash
rg -n "Firefox 90" CLAUDE.md README.md
```

**Done when:** the command above returns nothing; both docs describe Vite
8's actual baseline and current two-mode (`dev`/`built`) serving.

### Step 6 - Write the consolidated Step 9 decision record and re-verify

**Files:** `docs/plans/multi-connection-ui-phase-0-step-9-decision.md` (new),
`docs/plans/multi-connection-ui-phase-0-implementation-plan.md`

**Intent:** Follow the Step 6/Step 8 doc convention. Record: the exact
dependency cohort as pinned in `package.json` today - `typescript` 6.0.3 as
the plain dependency plus `@typescript/native: npm:typescript@7.0.2`
(`package.json:71`) as the native compiler `ttsc` actually uses, `typia`
13.2.0, `ttsc` 0.23.0, `@ttsc/unplugin` 0.23.0, `vite` 8.1.5, `svelte`
5.56.8, `@sveltejs/vite-plugin-svelte` 7.2.0, `dockview` 7.0.4 - spelled out
precisely so a future reader isn't confused when `npm ls typescript` shows
6.0.3 instead of the plan's original "7.0.2" headline number; the Dockview
verdict (quote/link
`multi-connection-ui-phase-0-step-6-dockview-decision.md`, and clarify that
approval covers a future migration step, not production adoption); the
browser-baseline change from Step 5; every command run in Steps 2-5 plus a
full acceptance run (`npm run format:check && npm run lint && npm run
typecheck && npm run check && npm test && npm run build && npm run
verify:client-artifact && npm run test:server:built && npm run test:browser
&& npm run test:browser:production && npm run test:transports && npm run
desktop:smoke && npm run desktop:pack && npm run desktop:smoke:packaged`,
plus a Docker build/start per `ci.yml`'s `docker` job); and known
limitations (no runtime rollback flag - rollback means redeploying the
previous release/image or `git revert`; Dockview is approved but not adopted
in production UI; legacy unbuilt-`public/` production serving is gone
permanently, `npm run dev` is now the only way to run against source).
Add a one-line cross-reference from the master plan
(`multi-connection-ui-phase-0-implementation-plan.md`) pointing at the new
decision doc.

**Verify:**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run check && npm test
npm run build && npm run verify:client-artifact && npm run test:server:built
npm run test:browser && npm run test:browser:production && npm run test:transports
npm run desktop:smoke && npm run desktop:pack && npm run desktop:smoke:packaged
docker build --tag darkflow-ci .
```

**Done when:** every command above exits 0; the decision doc exists and is
linked from the master plan; a future reader can answer "what shipped in
Phase 0 and why" from that doc alone.

## Success criteria

- [ ] `npm start` (no flags) serves `dist/client/`; `/api/version` returns
  the real package version.
- [ ] `node server.js` with `dist/client` missing exits non-zero with the
  build-artifact error.
- [ ] `npm run dev` still serves legacy `public/` plus Vite HMR unchanged.
- [ ] `npm run desktop` (unpackaged, unflagged) loads `dist/client/` without
  the missing-artifact error.
- [ ] `rg -n "'legacy'" server.js desktop/runtime.cjs` and
  `rg -n "built-client" Dockerfile` both return nothing.
- [ ] `CLAUDE.md` and `README.md` no longer say "Firefox 90+" / "Safari
  15+".
- [ ] `docs/plans/multi-connection-ui-phase-0-step-9-decision.md` exists and
  is linked from the master plan.
- [ ] The full command chain in Step 6 exits 0, and CI (`ci.yml`) is green
  on the branch.
