# Darkflow Frontend Multi-Connection UI Proposal

## Executive Summary

Modernize the Darkflow client frontend with **Vite + Svelte 5 + TypeScript + Zod
4**, replace the custom panel shell with a proven workspace library, and
introduce a **multi-session architecture** so players can maintain multiple
simultaneous MUD connections (tabs). The existing Express/Electron server layer
remains. Native WebSocket connections (`ws`/`wss`) continue to connect directly
to the MUD; telnet transports (`telnet`/`telnets`) continue through the Express
`/proxy` WebSocket bridge.

Dockview is the leading workspace candidate, not an unconditional choice: Phase
0 must prove that its framework-agnostic API can mount, update, serialize, and
reliably dispose Svelte components. This is a deliberate architectural upgrade
driven by multi-connection, not a rewrite for its own sake.

---

## Why Now

### Current strengths

- Fast, terminal-first client with rich GMCP integrations (maps, IDE,
  server-driven windows, combat visuals, etc.)
- Zero frontend build step — edit `public/`, refresh, ship
- Single codebase for web and Electron desktop/Steam

### Current limits

1. **Single connection only.** The entire app assumes one global `WebSocket`,
   one GMCP bus, one terminal, one panel layout. ~25 modules share singleton
   `state`. Multi-connection is not a toolbar tweak — it requires session-scoped
   state throughout.
2. **Custom panel shell doesn't scale.** `panel-manager.js` is ~3,800 lines of
   hand-rolled docking, floating, snapping, persistence, mobile behavior, GMCP
   subscriptions, and cached game data. It works, but layout and game-state
   responsibilities are entangled.
3. **GMCP contracts are not consistently typed or validated.** Protocol shapes
   (`Darkwind.MapData2`, `Darkwind.Window`, `Darkwind.IDE`, etc.) need
   compile-time TypeScript types and runtime validation at the network boundary.
   TypeScript alone cannot make untrusted server payloads safe.
4. **No dev hot-reload.** Full page refresh on every JS/CSS change slows
   iteration, especially across 70+ frontend modules.
5. **CDN-loaded CodeMirror.** The IDE loads editor dependencies from esm.sh at
   runtime; bundling would improve reliability and offline/Electron behavior.

The original "vanilla JS, no build step" decision made sense for a single-file
MUD client. The product has outgrown it.

---

## Proposed Stack

| Layer                      | Choice                                              | Role                                                                                                  |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Build / dev**            | [Vite](https://vitejs.dev/)                         | HMR, bundling, dev proxy to Express                                                                   |
| **UI framework**           | [Svelte 5](https://svelte.dev/)                     | Panel content, settings, tab chrome, app shell                                                        |
| **Language**               | TypeScript (`strict`)                               | GMCP types, session interfaces, safer refactors                                                       |
| **Runtime validation**     | [Zod 4](https://zod.dev/)                           | Validate GMCP, configuration, persisted data, and IPC/API payloads; infer TypeScript types            |
| **Workspace / panels**     | [Dockview](https://dockview.dev/) if Phase 0 passes | Docking, floating panels, tabs, layout serialization through a small Svelte lifecycle adapter         |
| **Terminal core**          | Port existing `ansi.js` / `output.js`               | Imperative stream rendering (not forced into Svelte)                                                  |
| **Editor**                 | CodeMirror 6 (bundled)                              | Replace esm.sh CDN imports                                                                            |
| **Server / desktop shell** | Existing Express + Electron                         | Static assets, `/config.json`, `/api/version`, `/ping`, `/mcp`, `/proxy`, desktop security, packaging |
| **MUD transport**          | Direct WebSocket or Express bridge                  | `ws`/`wss` connect directly; `telnet`/`telnets` use `/proxy`                                          |

---

## Architecture

### Two-level UI chrome

```
┌─────────────────────────────────────────────────────────────┐
│  App Shell (Svelte) — global settings, status, tab strip    │
├─────────────────────────────────────────────────────────────┤
│  [ Session A ]  [ Session B ]  [ Session C ]  [ + ]          │  ← L1: Connection tabs
├─────────────────────────────────────────────────────────────┤
│  Active Session                                             │
│  ┌──────────┬─────────────────────────────┬──────────────┐  │
│  │ Vitals   │                             │ Room         │  │
│  │ Map      │   Terminal (imperative)     │ Inventory    │  │  ← L2: Dockview workspace
│  │ Chat     │                             │ IDE (float)  │  │
│  └──────────┴─────────────────────────────┴──────────────┘  │
│  + GMCP modals (Darkwind.Window)                            │
└─────────────────────────────────────────────────────────────┘
```

- **L1 — Connection tabs:** one tab = one runtime session with its own socket,
  GMCP bus, terminal, windows, and reconnect lifecycle.
- **L2 — Workspace:** one workspace instance per session. Dockview is used only
  if the Phase 0 adapter spike passes.

### Identity and state ownership

Multi-connection requires more than adding a `sessionId`. State is assigned to
the narrowest durable scope that matches its meaning:

| Scope                    | Identity                            | Owns                                                                                                                               |
| ------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Application**          | One running client                  | Theme, desktop integration, app version, global defaults, tab registry                                                             |
| **Server profile**       | Stable UUID (`serverProfileId`)     | Endpoint, protocol, display name, server capabilities, world reference                                                             |
| **Character profile**    | Stable UUID (`characterProfileId`)  | Server reference, character label/identity, local automation overrides, input history, workspace layout, background audio controls |
| **Shared configuration** | Stable UUID per set (`configSetId`) | Reusable aliases, triggers, highlights, functions, key mappings, or timer definitions                                              |
| **Runtime session**      | Ephemeral UUID (`sessionId`)        | Socket, reconnect state, GMCP bus, terminal buffer, scroll position, windows, notifications, active timers                         |
| **World**                | Server-defined source/world key     | Shareable map data and world metadata                                                                                              |

A character profile may have at most one live runtime session. Two characters
connecting to the same MUD use distinct character profiles that reference the
same server profile and may attach the same shared configuration sets. This
prevents host/port storage collisions without forcing players to duplicate
useful automation.

Persisted records include schema versions and are validated with Zod before use.
Server-confirmed character identity may enrich a character profile after login,
but it is never required as the persistence key.

### Shared configuration sets

Profiles share selected definitions through reusable, typed configuration sets
rather than sharing an entire mutable character profile:

- A configuration set contains exactly one kind: aliases, triggers, highlights,
  functions, key mappings, or timer definitions.
- A character profile stores an ordered list of referenced set IDs for each kind
  plus optional profile-local entries.
- Effective configuration resolves built-in defaults first, referenced sets in
  listed order, and profile-local entries last. Later definitions replace
  earlier definitions with the same manager-specific identity.
- The settings UI shows each entry's source and every shared set's attached
  profiles. Players can edit the shared set, duplicate it, or detach a profile
  into a private copy.
- A validated shared-set edit increments its revision and is applied atomically
  to every attached live session; sessions never observe a partially updated
  collection.
- Shared sets contain definitions only. Running timers, trigger cooldowns,
  recursion guards, GMCP variables, match state, and other execution state
  remain runtime-session-owned.
- Workspace presets may be copied into character profiles, but live workspace
  layout state is not shared. Concurrent tabs must not overwrite one another's
  panel positions.
- Input history remains character-profile-owned. Map data remains world-owned.

When creating another character profile for an existing server, the UI offers
three explicit choices: attach selected shared sets (default), duplicate
selected sets into private copies, or start with no automation sets.

### Session model (core abstraction)

Each session owns:

- WebSocket connection + reconnect/transport ladder
- GMCP event bus + subscriptions + `Core.Hello`
- Zod validation at the GMCP ingress boundary
- Terminal output buffer + render scheduler
- Workspace instance + runtime panel state
- Server-driven windows (`Darkwind.Window`)
- Runtime notification, automation timer, IDE transfer, and teardown state

Each session references one server profile, one character profile, and the
character profile's ordered shared configuration sets. The session receives an
immutable effective-configuration snapshot for each set revision. Closing a
session calls one deterministic `dispose()` path that cancels reconnects, closes
sockets, removes GMCP subscriptions and DOM listeners, stops session timers,
unmounts Svelte roots, and releases workspace panels.

Cross-session events use an envelope containing `sessionId`, event type, and
payload. Managers do not infer ownership from the active tab or global DOM.

### Runtime validation policy

- Define Zod schemas for major external packages, beginning with `Darkwind.*`,
  authentication/status packages, and payloads used by automation.
- Infer TypeScript payload types from those schemas rather than maintaining
  parallel handwritten interfaces.
- Validate once when data crosses into the typed GMCP bus. Internal consumers
  receive validated values.
- Permit unknown object keys unless the protocol explicitly forbids them,
  preserving forward compatibility.
- A malformed payload is logged with its package and session, omitted from typed
  handlers, and exposed to debug tooling; it must not crash or disconnect the
  session.
- Apply the same boundary rule to `/config.json`, desktop IPC responses, and
  versioned localStorage/IndexedDB records.

### Background-session policy

- Background sessions remain connected and process GMCP, triggers, aliases, and
  timers.
- Only the active session accepts command input and global terminal shortcuts.
- Inactive sessions update model state but throttle or defer DOM rendering until
  activation.
- Notifications carry `sessionId`; activating one selects the correct tab and
  terminal line.
- Browser visibility applies to all sessions. Switching an in-app session tab
  does not send the existing `tab-away`/`tab-back` commands.
- Each character profile has separate background ambient, combat, and
  notification audio controls. Ambient and combat audio default to muted in the
  background; notification audio defaults to enabled and identifies its source
  session.
- Each terminal keeps the configured per-session scrollback limit. Acceptance
  tests cover four concurrent sessions to prevent unbounded aggregate DOM or
  listener growth.

---

## What We Keep vs. Rewrite

### Keep logic, port behind scoped instances

- `ansi.js`, `output.js` — terminal parsing and rendering algorithms; buffers
  and schedulers become session-owned
- `connection.js` — transport ladder, reconnect, and health-watchdog logic;
  module globals become session fields
- `gmcp-normalizer.js`, protocol docs in `docs/gmcp-*`
- `map-data-v2.js`, map renderer logic — world data remains world-scoped while
  view state is session-scoped
- `window-types.js`, GMCP window protocol
- Express server, Electron packaging, MCP relay

### Extract, then rewrite

- `panel-manager.js` → separate GMCP/data controllers from workspace layout
  before replacing layout code
- Workspace layout → Dockview adapter + Svelte panel components if the Phase 0
  spike passes
- `panel-renderers.js` → Svelte components
- Toolbar, connect UI, settings UI → Svelte
- `gmcp.js` → per-session validated bus
- `window-manager.js` → session-scoped
- `settings-manager.js` and automation managers → application, server-profile,
  character-profile, and shared-configuration stores rather than toolbar-derived
  host/port scopes
- `input.js`, notifications, sound, IDE, visual effects, and all managers
  importing global `state` → explicit app/session dependencies

---

## Phased Migration

| Phase                                     | Scope                                                                                                                                                                                                                                                                       | Required gate                                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Decision spike and build contract** | Vite + Svelte 5 + strict TS + Zod 4; prove Svelte mount/update/dispose inside Dockview; serialize/restore/floating panels; build static assets; wire Express, `/proxy`, Docker, and Electron packaging                                                                      | Browser HMR, `npm test`, Electron smoke/package, Docker build, and telnet `/proxy` all pass; approve or reject Dockview                     |
| **1 — Session core**                      | Extract `Session`, server and character profiles, shared configuration sets, effective-config resolution, scoped transport/reconnect, validated GMCP bus, event envelope, storage schemas/migration, and deterministic disposal; adapt the existing single-session UI to it | One-session behavior remains at parity; malformed GMCP, configuration precedence, shared-set propagation, and reconnect teardown tests pass |
| **2 — Svelte workspace parity**           | Svelte app shell; approved workspace adapter; split `panel-manager` data responsibilities from layout; migrate panels, settings, terminal host, windows, IDE, input, notifications, sound, and the mobile panel sheet; bundle CodeMirror                                    | Single-session web, Electron, and mobile feature-parity matrix passes                                                                       |
| **3 — Multi-connection**                  | Tab create/close/switch/reorder; multiple character profiles on one server profile; shared-set attachment/duplicate/detach UX; background policy; session-aware notifications                                                                                               | Four concurrent sessions remain isolated while selected configuration changes propagate atomically across attached profiles                 |
| **4 — Cleanup**                           | Remove legacy `public/js/` paths and compatibility adapters; update protocol docs and debug tooling                                                                                                                                                                         | One frontend source tree; all release gates pass                                                                                            |

Phases are sequential at their gates. Independent panel ports may proceed in
parallel only after the Phase 1 interfaces are frozen. Multi-connection is not
treated as repetition: Phase 3 explicitly verifies isolation and background
behavior.

---

## Dev & Deploy Model

**Development**

- Phase 0 evaluates Vite middleware mode inside Express as the default
  development architecture. It preserves one origin for Electron cookies,
  `/proxy`, and HMR.
- If a separate Vite server is retained, it must proxy `/api/*`, `/config.json`,
  `/ping`, `/mcp`, `/vendor/*`, and WebSocket upgrades for `/proxy`.
- `ws`/`wss` MUD connections remain direct. `telnet`/`telnets` continue through
  `/proxy`.

**Production / Electron**

- `vite build` → static output at `dist/client/`
- Express serves `dist/client/` while retaining API and proxy routes
- Electron Builder includes the built client, required icons/assets,
  `server.js`, `lib/`, and desktop code
- Docker builds the client before assembling the runtime image
- `/api/version` reads a build-owned version artifact rather than assuming
  `public/version.json`
- No separate web vs. desktop frontend fork

**Release gates**

- Root `npm test`, including migrated source imports and server lifecycle tests
- Electron smoke test, unpacked package, and release validation
- Docker image build and startup smoke test
- Direct `ws`/`wss` and bridged `telnet`/`telnets`
- MCP web harness, explicitly separate from browser UI and Electron coverage
- Browser end-to-end tests for session isolation, focus, persistence, windows,
  IDE, and notifications

---

## Risks & Mitigations

| Risk                                           | Mitigation                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large rewrite introduces regressions           | Sequential gates, explicit feature-parity matrix, browser E2E coverage, and existing unit/release tests; MCP is supplementary rather than the UI regression harness |
| Dockview lacks an official Svelte binding      | Phase 0 lifecycle spike; keep workspace integration behind a small adapter; reject Dockview if disposal, floating, touch, or serialization is unreliable            |
| `panel-manager.js` mixes layout and game state | Extract GMCP subscriptions and cached data into session controllers before replacing layout code                                                                    |
| Session storage collides at the same endpoint  | Separate server and character UUIDs, versioned Zod-validated records, and one live session per character profile                                                    |
| Shared automation changes leak runtime state   | Share immutable definition snapshots only; keep timers, cooldowns, GMCP variables, and match state inside each runtime session                                      |
| Shared definitions conflict                    | Ordered set references, deterministic identity-based replacement, profile-local precedence, and source labels in the settings UI                                    |
| Background tabs consume CPU/memory             | Per-session scrollback limits, inactive render throttling, deterministic teardown, and four-session soak tests                                                      |
| Session events or auth actions cross-talk      | `sessionId` event envelopes; no ownership inferred from active DOM; focused E2E tests                                                                               |
| Electron, Docker, or telnet transport breaks   | Treat packaging, static paths, cookie/origin checks, and `/proxy` as Phase 0 gates                                                                                  |
| Server evolves GMCP payloads                   | Zod schemas permit unknown keys by default and reject malformed known fields without terminating the session                                                        |

---

## Alternative Svelte Desktop Architectures

### A — Electron + embedded Express + Vite/Svelte SPA (recommended)

Keep the current desktop security, updater, packaging, Steam distribution,
TCP/TLS bridge, and web deployment model. Express serves the same static Svelte
build in production; Vite runs as middleware or through a complete development
proxy.

- **Advantages:** smallest platform migration, one web/desktop frontend,
  existing Node proxy and Electron tests remain useful.
- **Costs:** Electron footprint remains; desktop still carries an embedded HTTP
  server.
- **Decision:** use for this project.

### B — Electron + static renderer + preload IPC

Remove embedded Express from desktop. Electron loads the built Svelte app
through a custom application protocol, while preload IPC replaces
`/config.json`, `/api/version`, and `/proxy`. Web deployment continues to use
Express.

- **Advantages:** cleaner desktop process model and no loopback server.
- **Costs:** two backend adapters, duplicated transport/security behavior, and a
  larger rewrite of tested desktop code.
- **Decision:** reject for this migration; reconsider only after the frontend
  and session core stabilize.

### C — SvelteKit static SPA

Use SvelteKit with `adapter-static` instead of a plain Vite/Svelte SPA.

- **Advantages:** file-based routing, layouts, and structured loading if
  Darkflow grows into a multi-page application.
- **Costs:** no current need for SSR or route-level data loading; desktop still
  requires static output and additional adapter conventions.
- **Decision:** prefer plain Vite/Svelte for the terminal workspace; adopt
  SvelteKit only when real routing requirements appear.

### Workspace integration alternatives

Regardless of desktop shell, keep the terminal renderer and workspace host as
imperative islands inside the Svelte app:

1. **Dockview-owned DOM with mounted Svelte panel roots** — preferred if the
   Phase 0 lifecycle spike passes.
2. **Retain the current panel manager while migrating session state** — lower
   initial risk, but leaves the 3,800-line workspace problem intact.
3. **Build docking directly in Svelte** — rejected; it recreates the maintenance
   burden this proposal is intended to remove.

---

## Open Questions for the Team

1. **Workspace candidate:** Does the Dockview spike pass disposal, floating,
   touch, serialization, and terminal-host tests? If not, retain the current
   workspace temporarily while evaluating another framework-agnostic library.

The v1 decisions are tabs-only, required mobile panel-sheet parity, background
trigger processing enabled, separate per-character-profile controls for
background ambient/combat/notification audio, one live session per character
profile, reusable shared configuration sets with profile-local precedence, and
phased migration without a long-lived production feature flag.

---

## Success Criteria

- [ ] Four simultaneous sessions, including multiple character profiles using
      the same server profile
- [ ] Disconnecting, reconnecting, or closing one session does not change
      another session's socket, GMCP state, timers, windows, terminal, or
      notifications
- [ ] Two character profiles on the same server can attach the same alias,
      trigger, highlight, function, key-map, and timer-definition sets
- [ ] Editing a shared set updates attached live sessions atomically without
      sharing timer, trigger, GMCP-variable, or other runtime execution state
- [ ] Configuration conflicts resolve deterministically; profile-local entries
      override shared entries and the UI identifies each entry's source
- [ ] Shared sets can be duplicated or detached without changing the original;
      input history and workspace persistence remain character-profile-owned
- [ ] World map data can be shared deliberately without sharing session view
      state
- [ ] Background sessions process network data and automation without stealing
      focus or growing unbounded DOM/listener state
- [ ] Zod validates major GMCP packages and persisted/config/IPC boundaries;
      malformed payloads cannot crash a session
- [ ] Single-session feature-parity matrix passes for maps, IDE, windows,
      combat, sound, mobile panel-sheet behavior, accessibility, and debug
      tooling
- [ ] Vite HMR works; production web, Docker, Electron, and Steam packages
      consume the same built frontend
- [ ] Direct and bridged transports pass: `ws`, `wss`, `telnet`, and `telnets`
- [ ] Root tests, browser E2E, Electron release gates, and the separate MCP web
      harness pass

---

## Recommendation

**Approve Vite + Svelte 5 + strict TypeScript + Zod 4. Conditionally approve
Dockview only after Phase 0 proves the Svelte lifecycle adapter and deployment
contract.** Keep Electron + embedded Express for this migration.

Start with the decision spike, then extract the session core under the current
single-session UI before replacing the workspace. The "no framework" era served
us well for bootstrapping; multi-connection is the point where explicit state
ownership, runtime protocol validation, and a maintained workspace library can
pay for themselves.

---

_Draft for team discussion — Aug 2026_
