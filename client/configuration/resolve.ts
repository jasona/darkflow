import type { ApplicationStateV1 } from "../model/profiles.ts";
import type { CharacterProfileId, ConfigSetId } from "../model/ids.ts";
import type { ValidationResult } from "../model/validators.ts";

import { identityKeyForDefinition } from "./identity.ts";
import {
  BUILTIN_DEFINITIONS,
  freezeSnapshot,
  type EffectiveConfigurationSnapshot,
  type EffectiveDefinition,
} from "./snapshot.ts";
import type {
  AliasDefinition,
  ConfigKind,
  ConfigurationSet,
  FunctionDefinition,
  HighlightDefinition,
  KeyMappingDefinition,
  TimerDefinition,
  TriggerDefinition,
} from "../model/configuration.ts";

/** Resolves the effective configuration for one character profile from validated state. */
export function resolveEffectiveConfiguration(
  state: ApplicationStateV1,
  characterProfileId: CharacterProfileId,
): ValidationResult<EffectiveConfigurationSnapshot> {
  const character = state.characterProfiles[characterProfileId];
  if (character === undefined) {
    return {
      success: false,
      errors: [
        {
          path: `characterProfiles.${characterProfileId}`,
          code: "missing-character-profile",
          message: "Character profile is not present in the application graph.",
        },
      ],
    };
  }

  const snapshot: EffectiveConfigurationSnapshot = {
    characterProfileId,
    aliases: resolveAliases(
      state,
      character.configSetRefs.aliases,
      character.localDefinitions.aliases,
    ),
    triggers: resolveTriggers(
      state,
      character.configSetRefs.triggers,
      character.localDefinitions.triggers,
    ),
    highlights: resolveHighlights(
      state,
      character.configSetRefs.highlights,
      character.localDefinitions.highlights,
    ),
    functions: resolveFunctions(
      state,
      character.configSetRefs.functions,
      character.localDefinitions.functions,
    ),
    keyMappings: resolveKeyMappings(
      state,
      character.configSetRefs.keyMappings,
      character.localDefinitions.keyMappings,
    ),
    timers: resolveTimers(state, character.configSetRefs.timers, character.localDefinitions.timers),
  };

  return { success: true, data: freezeSnapshot(snapshot) };
}

function resolveAliases(
  state: ApplicationStateV1,
  configSetRefs: ConfigSetId[],
  localDefinitions: AliasDefinition[],
): EffectiveDefinition<AliasDefinition>[] {
  return resolveKind(
    state,
    configSetRefs,
    localDefinitions,
    "aliases",
    BUILTIN_DEFINITIONS.aliases,
  );
}

function resolveTriggers(
  state: ApplicationStateV1,
  configSetRefs: ConfigSetId[],
  localDefinitions: TriggerDefinition[],
): EffectiveDefinition<TriggerDefinition>[] {
  return resolveKind(
    state,
    configSetRefs,
    localDefinitions,
    "triggers",
    BUILTIN_DEFINITIONS.triggers,
  );
}

function resolveHighlights(
  state: ApplicationStateV1,
  configSetRefs: ConfigSetId[],
  localDefinitions: HighlightDefinition[],
): EffectiveDefinition<HighlightDefinition>[] {
  return resolveKind(
    state,
    configSetRefs,
    localDefinitions,
    "highlights",
    BUILTIN_DEFINITIONS.highlights,
  );
}

function resolveFunctions(
  state: ApplicationStateV1,
  configSetRefs: ConfigSetId[],
  localDefinitions: FunctionDefinition[],
): EffectiveDefinition<FunctionDefinition>[] {
  return resolveKind(
    state,
    configSetRefs,
    localDefinitions,
    "functions",
    BUILTIN_DEFINITIONS.functions,
  );
}

function resolveKeyMappings(
  state: ApplicationStateV1,
  configSetRefs: ConfigSetId[],
  localDefinitions: KeyMappingDefinition[],
): EffectiveDefinition<KeyMappingDefinition>[] {
  return resolveKind(
    state,
    configSetRefs,
    localDefinitions,
    "keyMappings",
    BUILTIN_DEFINITIONS.keyMappings,
  );
}

function resolveTimers(
  state: ApplicationStateV1,
  configSetRefs: ConfigSetId[],
  localDefinitions: TimerDefinition[],
): EffectiveDefinition<TimerDefinition>[] {
  return resolveKind(state, configSetRefs, localDefinitions, "timers", BUILTIN_DEFINITIONS.timers);
}

function resolveKind<TDefinition>(
  state: ApplicationStateV1,
  configSetRefs: ConfigSetId[],
  localDefinitions: TDefinition[],
  kind: ConfigKind,
  builtinDefinitions: TDefinition[],
): EffectiveDefinition<TDefinition>[] {
  const entries: EffectiveDefinition<TDefinition>[] = [];
  const indexByKey = new Map<string, number>();

  const layers: Array<{
    definitions: TDefinition[];
    source: EffectiveDefinition<TDefinition>["source"];
  }> = [
    {
      definitions: builtinDefinitions,
      source: { kind: "builtin" },
    },
  ];

  for (const configSetId of configSetRefs) {
    const configSet = state.configurationSets[configSetId] as ConfigurationSet | undefined;
    if (configSet === undefined || configSet.kind !== kind) {
      continue;
    }

    layers.push({
      definitions: configSet.definitions as TDefinition[],
      source: {
        kind: "shared-set",
        configSetId,
        revision: configSet.revision,
      },
    });
  }

  layers.push({
    definitions: localDefinitions,
    source: { kind: "local" },
  });

  for (const layer of layers) {
    for (const definition of layer.definitions) {
      const key = identityKeyForDefinition(kind, definition);
      const effective: EffectiveDefinition<TDefinition> = {
        definition: cloneDefinition(definition),
        source: { ...layer.source },
      };

      const existingIndex = indexByKey.get(key);
      if (existingIndex === undefined) {
        indexByKey.set(key, entries.length);
        entries.push(effective);
        continue;
      }

      entries[existingIndex] = effective;
    }
  }

  return entries;
}

function cloneDefinition<TDefinition>(definition: TDefinition): TDefinition {
  return structuredClone(definition);
}
