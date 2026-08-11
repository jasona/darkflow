import type {
  AliasDefinition,
  ConfigSourceMetadata,
  FunctionDefinition,
  HighlightDefinition,
  KeyMappingDefinition,
  LocalDefinitions,
  TimerDefinition,
  TriggerDefinition,
} from "../model/configuration.ts";
import type { CharacterProfileId } from "../model/ids.ts";
import { createEmptyLocalDefinitions } from "../model/profiles.ts";

/** One effective definition with provenance metadata for a resolved snapshot. */
export interface EffectiveDefinition<T> {
  definition: T;
  source: ConfigSourceMetadata;
}

/** Resolved effective configuration for one character profile across all six kinds. */
export interface EffectiveConfigurationSnapshot {
  characterProfileId: CharacterProfileId;
  aliases: EffectiveDefinition<AliasDefinition>[];
  triggers: EffectiveDefinition<TriggerDefinition>[];
  highlights: EffectiveDefinition<HighlightDefinition>[];
  functions: EffectiveDefinition<FunctionDefinition>[];
  keyMappings: EffectiveDefinition<KeyMappingDefinition>[];
  timers: EffectiveDefinition<TimerDefinition>[];
}

/**
 * Phase 1 built-in precedence tier. Legacy managers ship no defaults, so every
 * kind is intentionally empty while preserving the reserved built-in layer.
 */
export const BUILTIN_DEFINITIONS: Readonly<LocalDefinitions> = Object.freeze(
  deepFreezeLocalDefinitions(createEmptyLocalDefinitions()),
);

/** Deep-freezes a resolved snapshot and every nested definition payload. */
export function freezeSnapshot(
  snapshot: EffectiveConfigurationSnapshot,
): EffectiveConfigurationSnapshot {
  return deepFreeze(snapshot);
}

function deepFreezeLocalDefinitions(definitions: LocalDefinitions): LocalDefinitions {
  return {
    aliases: Object.freeze(
      definitions.aliases.map((item) => deepFreeze(item)),
    ) as AliasDefinition[],
    triggers: Object.freeze(
      definitions.triggers.map((item) => deepFreeze(item)),
    ) as TriggerDefinition[],
    highlights: Object.freeze(
      definitions.highlights.map((item) => deepFreeze(item)),
    ) as HighlightDefinition[],
    functions: Object.freeze(
      definitions.functions.map((item) => deepFreeze(item)),
    ) as FunctionDefinition[],
    keyMappings: Object.freeze(
      definitions.keyMappings.map((item) => deepFreeze(item)),
    ) as KeyMappingDefinition[],
    timers: Object.freeze(definitions.timers.map((item) => deepFreeze(item))) as TimerDefinition[],
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  Object.freeze(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }

  return value;
}
