import type { tags } from "typia";

import type { ConfigSetId } from "./ids.ts";

/** The six shareable configuration-set kinds supported in Phase 1. */
export type ConfigKind =
  "aliases" | "triggers" | "highlights" | "functions" | "keyMappings" | "timers";

/** JSON-safe primitive and structured values used by persisted definitions. */
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Alias/trigger/timer enablement toggle mode. */
export type AutomationToggleMode = "enable" | "disable" | "toggle";

/** Timer control mode for automation steps. */
export type TimerControlMode = "start" | "stop" | "reset" | "run";

/** JSON-safe automation step union; execution state is intentionally excluded. */
export type AutomationStep =
  | { type: "send_command"; template: string }
  | { type: "set_variable"; name: string; template: string }
  | { type: "show_message"; template: string }
  | { type: "script"; script: string }
  | { type: "wait"; seconds: number }
  | {
      type: "set_alias_enabled" | "set_trigger_enabled" | "set_timer_enabled";
      mode: AutomationToggleMode;
      target: string;
      targetId: string;
    }
  | {
      type: "control_timer";
      mode: TimerControlMode;
      target: string;
      targetId: string;
    }
  | {
      type: "play_sound";
      category: string;
      sound: string;
      volume: number;
    }
  | { type: "run_alias"; template: string }
  | {
      type: "call_function";
      target: string;
      targetId: string;
      template: string;
    };

/** Highlight styling payload preserved from legacy highlight rules. */
export interface HighlightStyle {
  fg: string;
  bg: string;
  bold: boolean;
}

/** Alias definition identity and payload; variables remain runtime-only. */
export interface AliasDefinition {
  id: string;
  enabled: boolean;
  trigger: string;
  description: string;
  group: string;
  isRegex: boolean;
  ignoreCase: boolean;
  steps: AutomationStep[];
}

/** Trigger definition identity and payload. */
export interface TriggerDefinition {
  id: string;
  enabled: boolean;
  pattern: string;
  description: string;
  group: string;
  isRegex: boolean;
  ignoreCase: boolean;
  gag: boolean;
  steps: AutomationStep[];
}

/** Highlight definition identity and payload. */
export interface HighlightDefinition {
  id: string;
  enabled: boolean;
  patternSource: string;
  description: string;
  group: string;
  ignoreCase: boolean;
  style: HighlightStyle;
}

/** Function definition identity and payload. */
export interface FunctionDefinition {
  id: string;
  enabled: boolean;
  name: string;
  description: string;
  group: string;
  script: string;
}

/** Key mapping definition identity and payload. */
export interface KeyMappingDefinition {
  id: string;
  enabled: boolean;
  code: string;
  label: string;
  legacyKey: string;
  command: string;
}

/** Timer definition identity and payload; handles and runtime state are excluded. */
export interface TimerDefinition {
  id: string;
  enabled: boolean;
  name: string;
  description: string;
  group: string;
  durationMs: number;
  recurring: boolean;
  autoStart: boolean;
  steps: AutomationStep[];
}

type PositiveRevision = number & tags.Minimum<1>;

interface ConfigurationSetBase {
  id: ConfigSetId;
  label: string;
  revision: PositiveRevision;
}

/** Shared alias configuration set. */
export interface AliasConfigurationSet extends ConfigurationSetBase {
  kind: "aliases";
  definitions: AliasDefinition[];
}

/** Shared trigger configuration set. */
export interface TriggerConfigurationSet extends ConfigurationSetBase {
  kind: "triggers";
  definitions: TriggerDefinition[];
}

/** Shared highlight configuration set. */
export interface HighlightConfigurationSet extends ConfigurationSetBase {
  kind: "highlights";
  definitions: HighlightDefinition[];
}

/** Shared function configuration set. */
export interface FunctionConfigurationSet extends ConfigurationSetBase {
  kind: "functions";
  definitions: FunctionDefinition[];
}

/** Shared key-mapping configuration set. */
export interface KeyMappingConfigurationSet extends ConfigurationSetBase {
  kind: "keyMappings";
  definitions: KeyMappingDefinition[];
}

/** Shared timer configuration set. */
export interface TimerConfigurationSet extends ConfigurationSetBase {
  kind: "timers";
  definitions: TimerDefinition[];
}

/** Discriminated configuration-set union containing exactly one definition kind. */
export type ConfigurationSet =
  | AliasConfigurationSet
  | TriggerConfigurationSet
  | HighlightConfigurationSet
  | FunctionConfigurationSet
  | KeyMappingConfigurationSet
  | TimerConfigurationSet;

/** Ordered shared-set references grouped by the six configuration kinds. */
export interface ConfigurationSetRefs {
  aliases: ConfigSetId[];
  triggers: ConfigSetId[];
  highlights: ConfigSetId[];
  functions: ConfigSetId[];
  keyMappings: ConfigSetId[];
  timers: ConfigSetId[];
}

/** Character-local definitions that override shared sets during resolution. */
export interface LocalDefinitions {
  aliases: AliasDefinition[];
  triggers: TriggerDefinition[];
  highlights: HighlightDefinition[];
  functions: FunctionDefinition[];
  keyMappings: KeyMappingDefinition[];
  timers: TimerDefinition[];
}

/** Manager-neutral provenance metadata consumed by effective-configuration work. */
export type ConfigSourceKind = "builtin" | "shared-set" | "local";

/** Describes where an effective definition originated without encoding precedence. */
export interface ConfigSourceMetadata {
  kind: ConfigSourceKind;
  configSetId?: ConfigSetId;
  revision?: number;
}

/** Maps each configuration kind to its ordered shared-set reference list. */
export const CONFIG_KINDS: readonly ConfigKind[] = [
  "aliases",
  "triggers",
  "highlights",
  "functions",
  "keyMappings",
  "timers",
] as const;

/** Returns the expected configuration kind for a shared set. */
export function configurationSetKind(set: ConfigurationSet): ConfigKind {
  return set.kind;
}
