# Session and configuration domain model

Phase 1 contract for persisted profiles, shared configuration sets, and the
runtime session boundary. The TypeScript source of truth lives in
[`client/model/`](../client/model/).

This document describes the graph introduced in Phase 1 Step 3. It does not
cover persistence (`darkflow-session-core-v1`), effective-configuration
resolution, or live session runtime — those arrive in later steps.

## Persisted graph

`ApplicationStateV1` is the versioned JSON graph stored by the client. It
separates application defaults, server profiles, character profiles, and
shared configuration sets into keyed collections. Map keys must equal each
record's branded `id`.

Runtime sessions are **not** persisted. `SessionDescriptor` and
`SessionRegistry` are interface contracts for Step 10.

```mermaid
flowchart TB
  subgraph Persisted["ApplicationStateV1 (persisted, schemaVersion: 1)"]
    Defaults["ApplicationDefaults<br/>themeKey<br/>defaultCharacterProfileId?"]

    subgraph Servers["serverProfiles: Record&lt;ServerProfileId, ServerProfile&gt;"]
      SP["ServerProfile<br/>protocol, host, port, label<br/>capabilities<br/>worldKey"]
    end

    subgraph Characters["characterProfiles: Record&lt;CharacterProfileId, CharacterProfile&gt;"]
      CP["CharacterProfile<br/>label, serverIdentity?<br/>commandHistory<br/>workspace, audio"]
    end

    subgraph Sets["configurationSets: Record&lt;ConfigSetId, ConfigurationSet&gt;"]
      CS["ConfigurationSet<br/>kind, label, revision<br/>definitions[]"]
    end
  end

  subgraph Ephemeral["Runtime only (Step 10)"]
    SD["SessionDescriptor<br/>sessionId"]
    SR["SessionRegistry<br/>claim / release / lookup"]
  end

  Defaults -.->|"defaultCharacterProfileId?"| CP
  CP -->|"serverProfileId"| SP
  CP --> Refs
  CP --> Local

  subgraph Refs["ConfigurationSetRefs (ordered IDs only)"]
    R1["aliases[]"]
    R2["triggers[]"]
    R3["highlights[]"]
    R4["functions[]"]
    R5["keyMappings[]"]
    R6["timers[]"]
  end

  subgraph Local["LocalDefinitions (inline, per character)"]
    L1["aliases[]"]
    L2["triggers[]"]
    L3["highlights[]"]
    L4["functions[]"]
    L5["keyMappings[]"]
    L6["timers[]"]
  end

  R1 & R2 & R3 & R4 & R5 & R6 -->|"must match kind + exist"| CS
  SD -->|"serverProfileId"| SP
  SD -->|"characterProfileId"| CP
  SR -->|"one live session per character"| SD
```

### Ownership rules

- Multiple character profiles may reference the same server profile and the
  same shared configuration sets.
- A character profile may have at most one live runtime session.
- `worldKey` on `ServerProfile` is an opaque server-owned value. It is not
  derived from host/port.
- Shared sets and local definitions contain **definitions only**. Runtime
  state — sockets, GMCP variables, timer handles, cooldowns, match state —
  stays on the session side of the boundary.

## Configuration sets and definitions

Each `ConfigurationSet` contains exactly one of six kinds. A character profile
holds ordered references per kind plus optional profile-local entries of the
same shape.

Manager-specific identity fields preserved from the legacy managers:

| Kind        | Identity field  |
| ----------- | --------------- |
| aliases     | `trigger`       |
| triggers    | `pattern`       |
| highlights  | `patternSource` |
| functions   | `name`          |
| keyMappings | `code`          |
| timers      | `name`          |

```mermaid
flowchart LR
  subgraph Kinds["ConfigKind (exactly one per set)"]
    direction TB
    K1["aliases"]
    K2["triggers"]
    K3["highlights"]
    K4["functions"]
    K5["keyMappings"]
    K6["timers"]
  end

  CS["ConfigurationSet<br/>(discriminated union)"] --> Kinds
  CS --> Defs["definitions[]"]

  Defs --> A["AliasDefinition<br/>identity: trigger"]
  Defs --> T["TriggerDefinition<br/>identity: pattern"]
  Defs --> H["HighlightDefinition<br/>identity: patternSource"]
  Defs --> F["FunctionDefinition<br/>identity: name"]
  Defs --> K["KeyMappingDefinition<br/>identity: code"]
  Defs --> TM["TimerDefinition<br/>identity: name"]

  A & T & TM --> Steps["AutomationStep[]"]
  H --> Style["HighlightStyle"]
```

## Effective configuration resolution

Step 5 implements precedence and provenance. The contract already separates
shared references from local overrides so resolution can follow this order:

```mermaid
flowchart TD
  Builtin["Built-in defaults"] --> Ordered["Referenced ConfigurationSets<br/>(in listed order, per kind)"]
  Ordered --> Local["CharacterProfile.localDefinitions<br/>(wins over shared sets)"]
  Local --> Effective["Effective configuration snapshot<br/>(definitions only, no runtime state)"]
```

Later definitions replace earlier ones with the same manager-specific identity
within a kind.

## Source modules

| Module                                                                    | Role                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| [`client/model/ids.ts`](../client/model/ids.ts)                           | Branded scoped UUIDs and test factories             |
| [`client/model/configuration.ts`](../client/model/configuration.ts)       | Six kinds, definition unions, set references        |
| [`client/model/profiles.ts`](../client/model/profiles.ts)                 | `ApplicationStateV1`, server and character profiles |
| [`client/model/session-contract.ts`](../client/model/session-contract.ts) | `SessionDescriptor`, `SessionRegistry`              |
| [`client/model/validators.ts`](../client/model/validators.ts)             | Typia structural validation and graph checks        |

## Related docs

- [Multi-connection UI proposal](plans/multi-connection-ui-proposal.md) —
  product rationale and ownership table
- [Phase 1 overview](plans/phase-1/multi-connection-ui-phase-1-implementation-plan.md) —
  step sequence including persistence and effective configuration
- [Phase 1 Step 3 implementation plan](plans/phase-1/multi-connection-ui-phase-1-step-3-implementation-plan.md) —
  contract decisions and validation requirements
