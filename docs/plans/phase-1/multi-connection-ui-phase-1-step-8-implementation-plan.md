# Phase 1 Step 8 Implementation Plan

*Plan stress-tested via focused adversarial review (Skeptic, Validator,
Researcher, Architect). 12 findings surfaced, 9 refined into the plan below, 1
conceded (removed), 2 confirmed the original draft.*

## Planning selection

- Mode: detailed implementation plan
- Complexity: 4/10 - one bounded subsystem (`client/gmcp/contracts/**`, four
  new files plus one already-existing `validators.ts`), built entirely on
  frozen Step 7 primitives (`frame.ts`'s `canonicalPackageName`, `bus.ts`'s
  `dispatch`/`lookupGmcpValidator` plumbing, the Vite-SSR test pattern); the
  remaining uncertainty is which of several credible shapes the two
  ambiguous master-plan phrases ("session recovery", "separately named
  ... unmodeled compatibility dispatch") resolve to, which adversarial review
  below pins as assumptions rather than leaves open
- Hard triggers: none - one deliverable, one phase-gate continuation, zero
  importers added to the boot path, no user-requested sequencing
- Current planning horizon: `client/gmcp/contracts/darkwind-window.ts`,
  `darkwind-ide.ts`, `darkwind-map-data-v2.ts`, `darkwind-client.ts`,
  `client/gmcp/contracts/validators.ts` (validator registrations),
  `test/session-gmcp-darkwind.test.mjs`, and
  `docs/plans/multi-connection-ui-phase-1-gmcp-inventory.md`, exactly as
  scoped by the master plan's Step 8 entry
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:388-405`)
- Evidence horizon: the frozen Step 7 `bus.ts`/`frame.ts`/`validators.ts`
  contract and its test pattern, the four target protocol docs
  (`docs/gmcp-darkwind-window.md`, `gmcp-darkwind-ide.md`,
  `gmcp-darkwind-mapdata-v2.md`, `gmcp-darkwind-client.md`), every current
  `public/js/*` GMCP package registration, and (for the one package with no
  client-side doc) the server-side payload construction in
  `../darkwind-nextgen/codebase/secure/daemons/telopt_d.c`
- Adversarial review: focused, with Architect added (this step extends a
  contract boundary Steps 9-16 inherit, and two phrases in the master plan's
  Step 8 intent each had more than one credible resolution) - completed.
  Findings dropped a speculative diagnostics/dispatch change (Skeptic),
  corrected the outbound-validator rationale and flagged an IDE
  identifier-naming collision (Researcher), forced a permissive MapData2
  v1/v2 union and a loosely-typed `Darkwind.Window` layout tree instead of
  strict recursive modeling (Validator), and prevented a duplicate
  `Darkwind.Client.Subscriptions` type definition (Architect). Results are
  folded into the Must-haves, Out of scope, Assumptions, and Risks below.

The clarification gate is skipped for the same reason Steps 3, 5, 6, and 7
skipped it: the product decision (a session-scoped, validated GMCP bus with a
Phase 1 protocol catalog) is already approved at the phase level
(`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:9-15`). This
plan resolves the remaining implementation-level ambiguities as documented
assumptions rather than open product questions, because repository and
server-source evidence already answers them.

## Goal

Extend the Step 7 session-scoped GMCP bus with typed, validated contracts for
the Darkwind packages that cross session-core or long-lived controller
boundaries - server-driven windows, IDE file transfers, the MapData2
collaborative map, client coordination (NAWS/subscriptions/media refresh),
and post-reconnect session recovery - and produce one inventory document that
accounts for every other package a current `public/js/*` consumer registers,
so Step 16's interface freeze has a complete, evidence-backed picture of what
is modeled versus intentionally left on the legacy passthrough. Nothing built
in this step is imported into the boot path, a legacy manager, or the real
`Session`; that begins at Step 9 (transport) and Step 13 (compatibility
cutover), exactly as Step 7 deferred its own wiring.

## Evidence and constraints

- Step 7 already ships the machinery this step extends without modification:
  `lookupGmcpValidator(packageName)` returns `undefined` for any canonical
  name absent from `PACKAGE_VALIDATORS`, and `dispatch()` already delivers
  that frame to wildcard and package handlers unchanged when no validator is
  registered (`client/gmcp/bus.ts:195-207`,
  `client/gmcp/contracts/validators.ts:52-88`). Step 7's own Out-of-scope
  section explicitly deferred `Group` and `Game` - both non-Darkwind,
  standard-package families - into this step's inventory, not just the
  Darkwind families this step's intent paragraph names
  (`docs/plans/multi-connection-ui-phase-1-step-7-implementation-plan.md:200-204`).
- `client/gmcp/**/*.ts` is already in `tsconfig.json`'s `include`, the
  `scriptFiles` glob in `eslint.config.mjs`, and the `lint`/`format`/
  `format:check` globs in `package.json` (`tsconfig.json:24`,
  `eslint.config.mjs:13`, `package.json:53-55`). This step adds no new
  top-level directory, unlike Step 7, so it touches none of those three
  files.
- `bus.ts` already fully implements and sends `Darkwind.Client.Subscriptions`
  through its own `GmcpSubscriptionPayload` interface and `sendSubscriptions()`
  method (`client/gmcp/bus.ts:58-64,282-301`), and already advertises
  `Darkwind.Window 1`, `Darkwind.IDE 2`, `Darkwind.MapData2 2`,
  `Darkwind.Client.Subscriptions 1`, and `Darkwind.Client.NAWS 1` in
  `CLIENT_SUPPORTS_SET` (`client/gmcp/bus.ts:37-42`). No current module types
  or sends `Darkwind.Client.NAWS`; the legacy sender in
  `public/js/output.js:37,1095-1100` builds the frame ad hoc.
- Every currently-registered GMCP package across `public/js/*` was enumerated
  by grepping both literal `.on('Package.Name', ...)` call sites and the
  `const PKG_* = 'Package.Name'` constant pattern several managers use
  instead. The complete set beyond Core/Char/Room/Comm/Group/Game
  (Step 7's territory) is: `Darkwind.Char.Avatar`; `Darkwind.Combat.State`/
  `.Events`/`.Event`; `Darkwind.Tutorial.State`/`.Control`/`.Action`/
  `.Resync`; `Darkwind.Visual.State`/`.Events`/`.Event`/`.Preview`;
  `Darkwind.Room.Image`; `Darkwind.Divine`; `Darkwind.Sky`;
  `Darkwind.GuildVitals`; `Darkwind.XPMon`; `Darkwind.Snoop.Open`/`.Append`/
  `.Status`/`.Close`/`.Command`/`.Stop`/`.Closed`; `Darkwind.Completion.Request`/
  `.Result`; `Darkwind.Quests.List`/`.Active`/`.Update`/`.Complete`;
  `Darkwind.Achievements.List`/`.Update`; `Darkwind.Announcements.List`/`.New`/
  `.Update`/`.State`/`.MarkRead`; `Darkwind.Giphy.Show`; `Darkwind.Sound`;
  `Darkwind.Broadcast.Show`; `Darkwind.LinuxRescue.Open`; `Darkwind.Lag.Get`/
  `.Status`; `Darkwind.Fishing.Open`/`.Cast`/`.Bite`/`.Hook`/`.Fight`/`.Result`/
  `.Caught`/`.Escaped`/`.Art`/`.Cancel`/`.End`; `Darkwind.Cyberware.List`/
  `.Details`/`.Image`; `Darkwind.StreetSamurai`; `Darkwind.Room.Playlist.State`/
  `.Open`/`.Action`/`.Report`. None of these is this step's Files list, so
  none is modeled; all become inventory entries
  (`public/js/window-types.js:2-7`, `ide-manager.js:8-18`,
  `announcements-manager.js:5-9`, `completion.js:7-8`,
  `broadcast-manager.js:3`, `giphy-manager.js:3`, `fishing-manager.js:15-25`,
  `linux-rescue-manager.js:10`, `snoop-manager.js:4-10`,
  `room-playlist-manager.js:10-13`, `street-samurai-dashboard.js:1`,
  `tutorial-manager.js:12-15`, and the literal-string registrations across
  the remaining manager files).
- `Darkwind.Session.Recovered` has no client-side protocol doc and no entry
  in `docs/gmcp-darkwind-index.md`'s Darkwind Extensions table, even though
  three legacy consumers register it and it is already canonicalized by
  Step 7's `frame.ts` (`public/js/tutorial-manager.js:16,134,300-302`;
  `public/js/visual-effects-manager.js:146,543-546`;
  `public/js/login-theme-manager.js:37,91`;
  `client/gmcp/frame.ts:34`). Every current client handler ignores its
  payload entirely (each is registered as a zero-argument callback). Its
  real shape is server-defined: `send_session_recovered` builds
  `{ mode, playerName, recoveredAt }` and conditionally adds
  `previousCharacter` only when `mode === "switch"`
  (`../darkwind-nextgen/codebase/secure/daemons/telopt_d.c:4574-4590`), and
  is called with `mode` values `"switch"`, `"linkdead"`, and `"takeover"`
  (`../darkwind-nextgen/codebase/secure/player.c:3793,3796,3817`;
  package constant at
  `../darkwind-nextgen/codebase/secure/include/gmcp_defs.h:465`).
- `docs/gmcp-darkwind-mapdata-v2.md` documents two live wire shapes for the
  same messages: the current version-2 fields (`mapEpoch`, `areaGeneration`,
  `snapshotVersion`, `cursor`, `complete`, `replace`) and a retained
  version-1 compatibility path (`version`, `since`, `offset`, `more`) the
  server still serves to version-1-declaring clients
  (`docs/gmcp-darkwind-mapdata-v2.md:14-16,82-145`). The legacy client
  itself reads both field families across the same functions today
  (`public/js/map-data-v2.js:516-536,558-576,594,621-633,656-697,723-730,
  764-794,815`), confirming a single client must tolerate either shape on
  the wire simultaneously, not just at a past migration boundary.
- `Darkwind.Window.Open`'s `layout` field is an arbitrarily deep node tree
  with 15+ documented node types and a much larger implicit surface (any
  future node type the server adds before this doc is updated)
  (`docs/gmcp-darkwind-window.md:68-105`). The current renderer degrades
  per-node - an unrecognized node type simply does not render - rather than
  rejecting the whole window
  (`docs/gmcp-darkwind-window.md:126-145` describes only the fields each
  known node type reads; nothing in the renderer path fails the whole
  window for an unrecognized one).
- `public/js/ide-manager.js:27` defines a **local** `createSessionId()` that
  mints IDE chunked-transfer identifiers, entirely unrelated to Phase 1's
  branded `SessionId` domain type from `client/model/ids.ts`. The wire field
  is literally named `"session"` in every chunked IDE message
  (`docs/gmcp-darkwind-ide.md:63-92,124-161`); `ide-manager.js:136-218` reads
  and matches on `data.session` to reassemble transfers.

## Must-haves

- [MH1] `Darkwind.Window.Open`/`.Update`/`.Close` inbound payloads validate
  structurally against every documented envelope field, while `layout`'s and
  `updates[]`'s node contents stay intentionally loosely typed so an
  unrecognized node degrades per-node (today's behavior) instead of
  rejecting the whole window. Acceptance: the doc's `Open`/`Update`/`Close`
  example payloads validate; a documented required envelope field holding
  the wrong runtime type (`layout` missing from `Open`, `id` missing from
  `Close`) fails; a `layout` payload containing a node `type` absent from
  the documented list still validates successfully.
- [MH2] `Darkwind.IDE.Open`/`.OpenStart`/`.OpenChunk`/`.OpenFinish`/
  `.SaveResult` inbound payloads validate structurally; chunk sequencing and
  reassembly correctness stay out of scope. Acceptance: every doc example
  payload for these five messages validates; a documented required field
  holding the wrong runtime type (`OpenStart.chunks` as a string,
  `SaveResult.errors[0].line` as a string) fails.
- [MH3] `Darkwind.MapData2.Current`/`.Area`/`.Update`/`.Error`/`.BrowseArea`/
  `.Reset` inbound payloads validate as a version-1-and-version-2 superset
  per message, not a version-2-only shape. Acceptance: both a v1-shaped and
  a v2-shaped example for `Update` (and for `Area`) validate successfully
  against the same registered interface; the one anchor field each message's
  doc section identifies as always present (room `id` for `Current`, `area`
  for `Area`/`Update`/scoped `Reset`) holding the wrong runtime type fails.
- [MH4] `Darkwind.Client.NAWS` and `Darkwind.Session.Recovered` get typed,
  validated contracts; `Darkwind.Client.Subscriptions` reuses `bus.ts`'s
  existing `GmcpSubscriptionPayload` rather than a second, divergent
  definition; `Darkwind.Client.RefreshMedia` is documented as carrying no
  payload rather than given an empty interface. Acceptance: the doc's NAWS
  example validates and a wrong-type `width` fails; all three server-emitted
  `Darkwind.Session.Recovered` `mode` values (`"switch"` with
  `previousCharacter`, `"linkdead"`, `"takeover"`) validate and a wrong-type
  `recoveredAt` fails; `darkwind-client.ts` imports
  `GmcpSubscriptionPayload` from `../bus.ts` instead of redeclaring it.
- [MH5] Every canonical package name currently registered by a `public/js/*`
  consumer - Darkwind or standard - is accounted for as either modeled (has
  a `lookupGmcpValidator` entry) or explicitly inventoried as unmodeled, with
  both sets derived from one exported source of truth so the inventory
  cannot silently drift from the validator registrations. Acceptance: a
  fixture iterates an exported `unmodeledGmcpPackageNames` array and asserts
  `lookupGmcpValidator()` is `undefined` for every entry; the inventory
  document's package table matches that same array plus
  `modeledGmcpPackageNames`, including `Group` and `Game` carried forward
  from Step 7.
- [MH6] The new Darkwind contracts inherit Step 7's per-session isolation
  guarantee, proven specifically for IDE's transfer-scoped `session` field.
  Acceptance: two `SessionGmcpBus` instances (two distinct `SessionId`s) each
  register a `Darkwind.IDE.OpenChunk` handler; frames carrying the identical
  transfer `session` string value dispatched on bus A are never observed by
  bus B's handler, and vice versa.

## Out of scope

- Wiring `window-manager.js`, `ide-manager.js`, `map-data-v2.js`, or
  `output.js`'s NAWS sender to the new typed contracts, and any change to
  those files. Step 8 ships types and validators with zero importers, exactly
  like Step 7; adapter wiring is Step 11-13 territory.
- A runtime "unmodeled" diagnostics counter or any change to `bus.ts`'s
  `dispatch()` or `client/runtime/diagnostics.ts`. The phase-level mitigation
  ("mark diagnostics as unmodeled") is satisfied by the inventory document
  plus MH5's fixture tying it to the `lookupGmcpValidator`/
  `modeledGmcpPackageNames` surface Step 7 already exports - see
  Assumption 2. No consumer of a bespoke counter exists yet, the same reason
  Step 7's own adversarial review rejected a bus-local diagnostics shape for
  a hypothetical future need
  (`docs/plans/multi-connection-ui-phase-1-step-7-implementation-plan.md:586-593`).
- A strict, recursive `Darkwind.Window` layout/node-tree type, and structural
  patch-operation modeling for `Update.updates[]`. Both stay loosely typed
  per MH1.
- The remaining ~24 unmodeled Darkwind package families' payload shapes
  (Combat, Visual, Tutorial, GuildVitals, Quests, Achievements,
  Announcements, Snoop, Completion, Fishing, Cyberware, StreetSamurai, Room
  Playlist, and the rest listed in Evidence) and `Group`/`Game`. They are
  inventoried by canonical name, direction, and current consumer file only;
  typed modeling is each one's own future Phase 2 port, per the phase-level
  assumption
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:164-167`).
- Modeling `Darkwind.Client.RefreshMedia`'s payload. It carries none
  (`docs/gmcp-darkwind-client.md:237-243`); MH4 documents that fact instead
  of inventing an empty interface.
- Runtime validators for any outbound (Client -> Server) message in this
  step's four families - see Assumption 3.

## Assumptions

- [The master plan's "session recovery" in Step 8's intent refers to the
  `Darkwind.Session.Recovered` GMCP package, and its contract lives in
  `darkwind-client.ts` alongside the other client/session-coordination
  messages rather than a fifth, unlisted contract file - reading the master
  plan's single sentence naming "client subscriptions/NAWS/media refresh,
  and session recovery" together as one client-boundary grouping] - if
  false: it needs its own `darkwind-session.ts` file, and the new protocol
  doc (Step 4 below) needs its own top-level family entry in
  `docs/gmcp-darkwind-index.md` rather than a row inside the Client family
  section.
- [The phase-level risk mitigation "mark diagnostics as unmodeled" and
  master Step 8's "separately named ... unmodeled compatibility dispatch" are
  satisfied by a purely static pairing - one exported
  `unmodeledGmcpPackageNames` array plus a fixture proving it never
  overlaps `modeledGmcpPackageNames`/`lookupGmcpValidator` - rather than new
  runtime instrumentation in `bus.ts` or `diagnostics.ts`. Changing
  `dispatch()`'s wildcard delivery to exclude unmodeled packages would
  break Step 12's plan, which explicitly depends on `gmcp-variables.js`
  receiving every dispatched frame unconditionally through the wildcard
  handler regardless of modeled status
  (`docs/plans/multi-connection-ui-phase-1-implementation-plan.md:462-463`;
  `public/js/gmcp.js:88`), so "never appear on the typed bus" is read as
  "never has a registered validator or per-package modeled contract," not
  "never reaches a wildcard handler"] - if false: Step 12's wildcard-based
  variable registry needs its own separate unmodeled-frame filter instead of
  inheriting an unfiltered wildcard, and this step must add the dispatch-level
  split before Step 12 can be planned safely.
- [Outbound-only (Client -> Server) Darkwind packages in this step's four
  families get typed interfaces but no `typia.createValidate` registration,
  because the caller always constructs an already-typed TypeScript object
  with no `unknown` boundary to validate at the send call site - this is a
  different rationale than Step 7's `Core.Hello` precedent (which cited an
  undocumented shape), since several of these outbound shapes (Subscriptions,
  NAWS) are in fact fully documented; the determining factor here is
  direction, not documentation completeness] - if false: every outbound
  interface in this step also needs a registered validator and a
  UI-construction-site fixture proving it rejects malformed data, which
  cannot be tested until a real caller exists in Step 11+.
- [MapData2's version-1 and version-2 field families are modeled as one
  permissive superset interface per message (most fields optional beyond one
  anchor field) rather than two mutually exclusive shapes] - if false: this
  step needs a discriminated union keyed on `protocol`/`mapEpoch` presence,
  and Step 16's parity gate needs an explicit version-1-server compatibility
  fixture this plan does not yet name.

## Risks

- A strict `Darkwind.Window.Open` layout validator could turn today's
  graceful "unknown node type renders nothing" behavior into whole-window
  rejection for screens that lean on `player_row`/`finger_profile` nodes
  (login and `who`), a materially worse regression than the malformed-frame
  suppression Step 7's MH3 accepted for ordinary data packages. Mitigation:
  MH1 keeps `layout`/`updates[]` node contents loosely typed; a fixture
  posts a payload with an unrecognized node `type` through the envelope and
  asserts it still validates.
- IDE's wire-level `session` field (a per-transfer id minted by
  `public/js/ide-manager.js:27`'s local `createSessionId()`) shares a name
  with Phase 1's branded `SessionId` domain type but is a completely
  unrelated identifier space. Mitigation: `darkwind-ide.ts` types the field
  as plain `string` with a comment distinguishing it from `SessionId`, so a
  future implementer does not import the domain factory by name confusion;
  this plan records the collision so Step 11-13's adapters see it coming.
- Hand-listing every currently-registered legacy package name for the
  inventory risks silent omission or drift as legacy managers change.
  Mitigation: MH5's `unmodeledGmcpPackageNames` array is the single source
  both the test file and the inventory document draw from, the same
  anti-drift pattern Step 7 used for the 43-entry `Core.Supports.Set` list
  (`docs/plans/multi-connection-ui-phase-1-step-7-implementation-plan.md:285-290`).
- A MapData2 superset interface permissive enough to accept both protocol
  versions could also accept a payload missing every field a real server
  response would always include, masking a genuine server-side regression.
  Mitigation: each message keeps its one doc-identified anchor field
  required (room `id` for `Current`; `area` for `Area`/`Update`/scoped
  `Reset`), cited to the specific doc lines establishing that field's
  presence in both protocol versions (MH3, Evidence).

## Steps

### Step 1 - Darkwind.Window contracts and validators

**Files:** `client/gmcp/contracts/darkwind-window.ts` (new),
`client/gmcp/contracts/validators.ts`

**Intent:** Define `DarkwindWindowOpen`, `DarkwindWindowUpdate`,
`DarkwindWindowClose` (inbound), and `DarkwindWindowSubmit`,
`DarkwindWindowAction`, `DarkwindWindowClosed` (outbound, typed only, no
validator per Assumption 3), citing `docs/gmcp-darkwind-window.md` line
ranges per interface exactly as Step 7 cited `docs/gmcp-*.md`. Model every
envelope field from the `Open` schema table (`id`, `type`, `title`,
`closable`, `width`, `height`, `dock`, `order`, the six `defaultFloat*`/
`defaultSnap*`/`defaultBelowPanel` hints) as its documented type; type
`layout` as `{ type?: string; id?: string; style?: Record<string, unknown>;
[key: string]: unknown }`-shaped and `updates[]` entries the same way,
deliberately not modeling the 15+ node-specific field tables (MH1, Risk 1).
Register `validateDarkwindWindowOpen`/`Update`/`Close` in
`PACKAGE_VALIDATORS` keyed through `canonicalPackageName()`, matching Step
7's registration pattern (`client/gmcp/contracts/validators.ts:52-79`).

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** the doc's `Open`/`Update`/`Close` example payloads validate
through their looked-up validators; a required envelope field with a flipped
runtime type fails; a `layout` payload with an unrecognized node `type`
still validates (MH1).

### Step 2 - Darkwind.IDE contracts and validators

**Files:** `client/gmcp/contracts/darkwind-ide.ts` (new),
`client/gmcp/contracts/validators.ts`

**Intent:** Define `DarkwindIdeOpen`, `DarkwindIdeOpenStart`,
`DarkwindIdeOpenChunk`, `DarkwindIdeOpenFinish`, `DarkwindIdeSaveResult`
(inbound), and `DarkwindIdeSave`, `DarkwindIdeSaveStart`,
`DarkwindIdeSaveChunk`, `DarkwindIdeSaveFinish`, `DarkwindIdeSaveAbort`,
`DarkwindIdeClose` (outbound, typed only), citing
`docs/gmcp-darkwind-ide.md` line ranges per interface. Every chunked-transfer
interface's `session` field is `string`, with a one-line comment noting it is
an IDE-protocol transfer id unrelated to `client/model/ids.ts`'s branded
`SessionId` (Risk 2). `SaveResult.errors` is
`Array<{ line: number; column?: number; message: string }>`. Register the
five inbound validators in `PACKAGE_VALIDATORS`.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** every doc example for the five inbound messages validates; a
required field with a flipped runtime type (`OpenStart.chunks` as a string,
`SaveResult.errors[0].line` as a string) fails (MH2).

### Step 3 - Darkwind.MapData2 contracts and validators

**Files:** `client/gmcp/contracts/darkwind-map-data-v2.ts` (new),
`client/gmcp/contracts/validators.ts`

**Intent:** Define `MapData2RoomRecord` (the shared room-record shape from
`docs/gmcp-darkwind-mapdata-v2.md:31-60`, `id` required and every other field
optional) and per-message interfaces for `Current`, `Area`, `Update`,
`Error`, `BrowseArea`, `Reset` as permissive supersets covering both protocol
versions (Assumption 4, MH3): `Update` carries optional `protocol`,
`mapEpoch`, `areaGeneration`, `since`, `snapshotVersion`, `latestVersion`,
`cursor`, `complete`, `replace`, `rooms`, plus optional legacy `version`,
`offset`, `more`, with `area` required; `Area` carries required `area` and
`rooms`, plus optional `version`, `more`, `replace`, `areaGeneration`,
`mapEpoch`; `Current` is `MapData2RoomRecord` plus optional `protocol`,
`mapEpoch`, `areaGeneration`, `areaVersion`, `areaName`, `liveExits`,
`liveDoors`; `Error` is `{ restart?: boolean; retryAfterMs?: number }`;
`BrowseArea` carries required `catalog`, optional `name`, `center`, `rooms`,
`more`, `offset`; `Reset` is all-optional (`scope`, `area`,
`areaGeneration`, `mapEpoch`). Define outbound-only `MapData2Sync` and
`MapData2Browse` (typed only). Register the six inbound validators.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** a v1-shaped and a v2-shaped example both validate for
`Update` and for `Area`; the anchor field for each message (room `id` for
`Current`, `area` for `Area`/`Update`/a scoped `Reset`) with a flipped
runtime type fails (MH3).

### Step 4 - Darkwind.Client and Darkwind.Session.Recovered contracts and validators

**Files:** `client/gmcp/contracts/darkwind-client.ts` (new),
`client/gmcp/contracts/validators.ts`, `docs/gmcp-darkwind-session.md` (new),
`docs/gmcp-darkwind-index.md`, `docs/gmcp-darkwind-client.md`

**Intent:** Define `DarkwindClientNaws` (`{ width: number; height: number }`,
outbound, typed only) and `DarkwindSessionRecovered`
(`{ mode: string; playerName?: string; recoveredAt?: number;
previousCharacter?: string }`, inbound, validated) in `darkwind-client.ts`.
Import and re-export `GmcpSubscriptionPayload` from `../bus.ts` as the type
for `Darkwind.Client.Subscriptions` instead of redeclaring it (MH4,
Assumption 2, Architect finding). Add a short new
`docs/gmcp-darkwind-session.md` documenting `Darkwind.Session.Recovered`'s
server-sourced shape and citing the `darkwind-nextgen` evidence above, note
that current client handlers ignore the payload, and add its row to
`docs/gmcp-darkwind-index.md`'s Darkwind Extensions table and a
cross-reference note in `docs/gmcp-darkwind-client.md`. Register
`validateDarkwindClientNaws` and `validateDarkwindSessionRecovered` in
`PACKAGE_VALIDATORS`.

**Verify:**

```bash
npm run typecheck
npm run build
```

**Done when:** the NAWS doc example validates and a wrong-type `width`
fails; all three server-emitted `Darkwind.Session.Recovered` `mode` values
validate (with `previousCharacter` present only for `"switch"`) and a
wrong-type `recoveredAt` fails; `darkwind-client.ts` has no second
`GmcpSubscriptionPayload`-shaped declaration (MH4).

### Step 5 - Inventory document, unmodeled-package export, and full fixture suite

**Files:** `client/gmcp/contracts/validators.ts` (add
`unmodeledGmcpPackageNames`), `docs/plans/multi-connection-ui-phase-1-gmcp-inventory.md`
(new), `test/session-gmcp-darkwind.test.mjs` (new)

**Intent:** Add one exported `unmodeledGmcpPackageNames: readonly string[]`
constant to `validators.ts` listing every canonical name from the Evidence
section's grep results plus `Group` and `Game` (carried forward from Step
7). Write the inventory document as a table of every package this repository
currently registers - canonical name, direction, current `public/js/*`
consumer, and modeled/unmodeled status - generated from
`modeledGmcpPackageNames` plus `unmodeledGmcpPackageNames` so the document
and the code cannot silently diverge (MH5, Risk 3). Follow
`test/session-gmcp-bus.test.mjs`'s Vite-SSR import pattern
(`server.environments.ssr.runner.import`) to import all four new contract
modules, `validators.ts`, `bus.ts`, and `model/ids.ts`; cover every Done-when
scenario from MH1-MH6 plus the master plan's Step 8 Done-when line, including
the two-bus IDE `session`-field isolation fixture (MH6) reusing Step 7's
two-fake-sink pattern.

**Verify:**

```bash
node --test test/session-gmcp-darkwind.test.mjs
npm run build
npm run verify:bundle
npm run format:check
npm run lint
npm run typecheck
npm run check
git diff --check
```

**Done when:** every Must-have and the master plan's Step 8 Done-when
condition ("protocol docs and fixtures pass valid/malformed/unknown-key
cases, chunk/session IDs cannot cross sessions, and the inventory accounts
for every package registered by current `public/js/*` consumers") has a
passing fixture, and the full quality/build battery is green.

## Success criteria

- [ ] `Darkwind.Window`/`.IDE`/`.MapData2` inbound messages validate
      structurally, allow unknown extra keys, and reject documented fields
      holding the wrong runtime type, while `Window`'s node-tree contents
      stay intentionally unvalidated.
- [ ] `Darkwind.MapData2` messages accept both version-1 and version-2 wire
      shapes through one interface per message.
- [ ] `Darkwind.Client.NAWS` and `Darkwind.Session.Recovered` are typed and
      validated; `Darkwind.Client.Subscriptions` reuses `bus.ts`'s existing
      type without duplication.
- [ ] Every package a current `public/js/*` consumer registers is either
      modeled (has a validator) or listed in `unmodeledGmcpPackageNames`,
      with a fixture proving the two sets never overlap.
- [ ] Two `SessionGmcpBus` instances never observe each other's
      `Darkwind.IDE.OpenChunk` frames even when the transfer `session` field
      value collides.
- [ ] The full quality/build battery (`format:check`, `lint`, `typecheck`,
      `check`, `build`, `verify:bundle`) passes alongside the new test.

## Rollback

Nothing built in this step is imported into the boot path, the legacy UI, or
any other production module - `client/gmcp/contracts/**` gains four new
files with no importers until Step 9+ wires the bus into the real `Session`
and Step 11-13 adapt legacy managers. This step also touches neither
`bus.ts` nor `client/runtime/diagnostics.ts` (Assumption 2), which is a
stricter isolation property than Step 7's own rollback story. Reverting
before then is a pure code deletion of the four new contract files, their
`validators.ts` registrations, the new test file, and the two new/edited
docs, with zero runtime impact. This step touches no persisted data and no
key under `darkflow-session-core-v1`, so it needs no data-recovery step.

## Execution fit

- Scope: multi-run phase (one step within the ongoing Phase 1 program)
- Lead: Terra at medium reasoning - the per-message modeling work follows
  Step 7's already-proven contract/validator pattern closely; the two
  judgment calls with real correctness consequence (the loose `Window`
  layout typing in Step 1, and the MapData2 v1/v2 superset in Step 3) are
  already pinned by this plan's Must-haves and Risks rather than left to
  implementation-time discretion
- Workers: none - the four contract files and their shared
  `validators.ts` registrations form one incrementally built, tightly
  coupled catalog; splitting authorship risks inconsistent
  strict-vs-loose modeling choices between files
- Delegation shape: solo
- Ownership: the lead owns the `Window` layout looseness call, the MapData2
  superset field list, and the go/no-go decision before Step 9 begins
- Replan trigger: Step 16's interface freeze overrides the
  "unmodeled = no validator, still wildcard-reachable" interpretation
  (Assumption 2) after Step 12's variable registry is already built against
  it; or a real `Darkwind.Window` node type the current doc does not list
  turns out to need envelope-level (not just node-level) rejection
- Confidence: high - every pattern this step needs (contract interfaces,
  `typia.createValidate` registration, canonical-name lookup, the Vite-SSR
  test harness, two-bus isolation fixtures) already has a proven precedent
  from Step 7; the four adversarially-resolved judgment calls are pinned
  explicitly rather than left implicit

Plan self-review: PASS (9/10)

Notes:

- A focused adversarial pass (`plan-adversarial`, Skeptic/Validator/
  Researcher/Architect) ran against two ambiguous phrases in the master
  plan's Step 8 intent - "session recovery" and "separately named ...
  unmodeled compatibility dispatch" - before implementation starts, the same
  reason Step 7's plan reviewed its malformed-frame/wildcard-suppression
  contract before shipping. Results are folded into Assumption 1,
  Assumption 2, MH4, MH5, and the Out of scope section above.
- The Skeptic lens's strongest finding was cut entirely rather than refined:
  an earlier draft of this plan added a `SessionDiagnostics.recordUnmodeledPackage()`
  counter and a `bus.ts dispatch()` change to call it. That draft was
  rejected because no consumer needs it yet and it would have required
  editing two frozen Step 7 files this step's master-plan file list does not
  name - the same "no hypothetical-consumer complexity" reasoning Step 7's
  own adversarial review already applied to a different bus-local counter
  idea.
- The Validator lens's `Darkwind.Window` finding is the one most likely to
  matter if this plan is wrong: if a future node type genuinely needs
  envelope-level rejection (not per-node degradation), Step 1's loose
  `layout` typing must be revisited before Step 16's interface freeze, not
  discovered after a login-screen regression ships.
- Server-side evidence for `Darkwind.Session.Recovered` came from
  `../darkwind-nextgen`, a sibling repository, not `darkflow` itself. If that
  repository's checkout is stale relative to the deployed server, Step 4's
  doc and validator should be re-checked against current server behavior
  before this step's PR merges.
