import type { tags } from "typia";

import type {
  ConfigurationSet,
  ConfigurationSetRefs,
  JsonValue,
  LocalDefinitions,
} from "./configuration.ts";
import type { CharacterProfileId, ConfigSetId, ServerProfileId } from "./ids.ts";

/** Supported transport protocols for server profiles. */
export type TransportProtocol = "ws" | "wss" | "telnet" | "telnets";

/** Opaque server-owned world key preserved exactly as supplied. */
export type WorldKey = string & tags.MinLength<1> & tags.MaxLength<128>;

/** Validated server connection endpoint and world reference. */
export interface ServerProfile {
  id: ServerProfileId;
  protocol: TransportProtocol;
  host: string & tags.MinLength<1>;
  port: number & tags.Minimum<1> & tags.Maximum<65535>;
  label: string;
  capabilities: Record<string, JsonValue>;
  worldKey: WorldKey;
}

/** Per-category audio controls owned by a character profile. */
export interface AudioCategoryControls {
  enabled: boolean;
  volume: number & tags.Minimum<0> & tags.Maximum<1>;
}

/** Character-owned ambient, combat, and notification audio settings. */
export interface CharacterAudioControls {
  ambient: AudioCategoryControls;
  combat: AudioCategoryControls;
  notification: AudioCategoryControls;
}

/** Opaque versioned workspace layout payload for Step 4 panel migration. */
export interface WorkspaceSnapshot {
  version: number & tags.Minimum<1>;
  payload: Record<string, JsonValue>;
}

/** Persisted character profile with history, layout, and configuration references. */
export interface CharacterProfile {
  id: CharacterProfileId;
  serverProfileId: ServerProfileId;
  label: string;
  serverIdentity?: string;
  configSetRefs: ConfigurationSetRefs;
  localDefinitions: LocalDefinitions;
  commandHistory: Array<string & tags.MaxLength<4096>> & tags.MaxItems<200>;
  workspace: WorkspaceSnapshot;
  audio: CharacterAudioControls;
}

/** Narrow application defaults that do not carry runtime session state. */
export interface ApplicationDefaults {
  themeKey: string & tags.MinLength<1>;
  defaultCharacterProfileId?: CharacterProfileId;
}

/** Phase 1 persisted application graph keyed by stable profile and set IDs. */
export interface ApplicationStateV1 {
  schemaVersion: 1;
  defaults: ApplicationDefaults;
  serverProfiles: Record<ServerProfileId, ServerProfile>;
  characterProfiles: Record<CharacterProfileId, CharacterProfile>;
  configurationSets: Record<ConfigSetId, ConfigurationSet>;
}

/** Returns an empty local-definitions container for new character profiles. */
export function createEmptyLocalDefinitions(): LocalDefinitions {
  return {
    aliases: [],
    triggers: [],
    highlights: [],
    functions: [],
    keyMappings: [],
    timers: [],
  };
}

/** Returns empty ordered configuration-set references for a new character profile. */
export function createEmptyConfigurationSetRefs(): ConfigurationSetRefs {
  return {
    aliases: [],
    triggers: [],
    highlights: [],
    functions: [],
    keyMappings: [],
    timers: [],
  };
}
