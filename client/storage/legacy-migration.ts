import type {
  ApplicationStateV1,
  CharacterAudioControls,
  CharacterProfile,
  ServerProfile,
  TransportProtocol,
  WorkspaceSnapshot,
} from "../model/profiles.ts";
import type {
  AliasDefinition,
  AutomationStep,
  FunctionDefinition,
  HighlightDefinition,
  KeyMappingDefinition,
  TimerDefinition,
  TriggerDefinition,
} from "../model/configuration.ts";
import {
  createCharacterProfileId,
  createServerProfileId,
  type CharacterProfileId,
  type ServerProfileId,
  type UuidFactory,
} from "../model/ids.ts";
import { createEmptyConfigurationSetRefs, createEmptyLocalDefinitions } from "../model/profiles.ts";
import type { GraphValidationIssue } from "../model/validators.ts";
import {
  DEFAULT_CONFIG_JSON,
  computeActiveScopeKey,
  validateConfigJsonInput,
  type ConfigJson,
} from "./config-validator.ts";
import {
  LEGACY_ALIAS_STORAGE_KEY,
  LEGACY_FUNCTION_STORAGE_KEY,
  LEGACY_HIGHLIGHT_STORAGE_KEY,
  LEGACY_HISTORY_STORAGE_KEY,
  LEGACY_PANEL_STORAGE_KEY,
  LEGACY_SETTINGS_STORAGE_KEY,
  LEGACY_SOUND_STORAGE_KEY,
  LEGACY_TIMER_STORAGE_KEY,
  LEGACY_TRIGGER_STORAGE_KEY,
  readLegacyClientSettings,
  readLegacyCommandHistory,
  readLegacyPanelState,
  readLegacyProtocolOverride,
  readLegacyScopedStore,
  readLegacySoundSettings,
  type LegacyScopedStore,
} from "./legacy-keys.ts";
import { commit, hasValidState, writeProvenance, type StorageLike } from "./repository.ts";
import {
  DEFAULT_THEME_KEY,
  LEGACY_MIGRATION_WORLD_KEY,
  type MigrationProvenance,
} from "./schema.ts";
import { validateApplicationState } from "./validators.ts";

/** Outcome of a legacy migration attempt. */
export type MigrationResult =
  | { success: true; skipped: boolean }
  | {
      success: false;
      code: "validation-failed" | "commit-failed";
      message: string;
      errors?: GraphValidationIssue[];
    };

const MAX_COMMAND_HISTORY = 200;
const MAX_COMMAND_LENGTH = 4096;
const DEFAULT_SOUND_VOLUME = 0.7;

/** Converts legacy local-storage records into the Phase 1 graph exactly once. */
export function migrateLegacyData(
  storage: StorageLike,
  configJson: unknown,
  urlSearchParams: URLSearchParams,
  uuidFactory: UuidFactory,
): MigrationResult {
  if (hasValidState(storage)) {
    return { success: true, skipped: true };
  }

  const skippedLegacyKeys: MigrationProvenance["skippedLegacyKeys"] = [];
  const config = resolveConfigJson(configJson);
  const protocolOverride = readLegacyProtocolOverride(storage);

  const aliasStore = readScopedStore(storage, LEGACY_ALIAS_STORAGE_KEY, skippedLegacyKeys);
  const highlightStore = readScopedStore(storage, LEGACY_HIGHLIGHT_STORAGE_KEY, skippedLegacyKeys);
  const triggerStore = readScopedStore(storage, LEGACY_TRIGGER_STORAGE_KEY, skippedLegacyKeys);
  const timerStore = readScopedStore(storage, LEGACY_TIMER_STORAGE_KEY, skippedLegacyKeys);
  const functionStore = readScopedStore(storage, LEGACY_FUNCTION_STORAGE_KEY, skippedLegacyKeys);

  const scopeKeys = collectScopeKeys([
    aliasStore,
    highlightStore,
    triggerStore,
    timerStore,
    functionStore,
  ]);

  const activeScopeKey = computeActiveScopeKey({
    urlSearchParams,
    protocolOverride,
    config,
  });

  if (!scopeKeys.includes(activeScopeKey)) {
    scopeKeys.push(activeScopeKey);
  }

  const settingsResult = readLegacyClientSettings(storage);
  if (settingsResult.error) {
    skippedLegacyKeys.push({ key: LEGACY_SETTINGS_STORAGE_KEY, reason: settingsResult.error });
  }

  const historyResult = readLegacyCommandHistory(storage);
  if (historyResult.error) {
    skippedLegacyKeys.push({ key: LEGACY_HISTORY_STORAGE_KEY, reason: historyResult.error });
  }

  const panelResult = readLegacyPanelState(storage);
  if (panelResult.error) {
    skippedLegacyKeys.push({ key: LEGACY_PANEL_STORAGE_KEY, reason: panelResult.error });
  }

  const soundResult = readLegacySoundSettings(storage);
  if (soundResult.error) {
    skippedLegacyKeys.push({ key: LEGACY_SOUND_STORAGE_KEY, reason: soundResult.error });
  }

  const themeKey = resolveThemeKey(settingsResult.value);
  const activeKeyMappings = resolveActiveKeyMappings(settingsResult.value);

  const serverProfiles: Record<ServerProfileId, ServerProfile> = {};
  const characterProfiles: Record<CharacterProfileId, CharacterProfile> = {};
  let activeCharacterProfileId: CharacterProfileId | undefined;

  for (const scopeKey of scopeKeys) {
    const parsedScope = parseScopeKey(scopeKey);
    if (!parsedScope) {
      continue;
    }

    const serverProfileId = createServerProfileId(uuidFactory);
    const characterProfileId = createCharacterProfileId(uuidFactory);
    const isActiveScope = scopeKey === activeScopeKey;

    serverProfiles[serverProfileId] = {
      id: serverProfileId,
      protocol: parsedScope.protocol,
      host: parsedScope.host,
      port: parsedScope.port,
      label: `${parsedScope.host}:${parsedScope.port}`,
      capabilities: {},
      worldKey: LEGACY_MIGRATION_WORLD_KEY,
    };

    characterProfiles[characterProfileId] = {
      id: characterProfileId,
      serverProfileId,
      label: parsedScope.host,
      configSetRefs: createEmptyConfigurationSetRefs(),
      localDefinitions: buildLocalDefinitions(scopeKey, {
        aliasStore,
        highlightStore,
        triggerStore,
        timerStore,
        functionStore,
        keyMappings: isActiveScope ? activeKeyMappings : [],
      }),
      commandHistory: isActiveScope ? normalizeCommandHistory(historyResult.value) : [],
      workspace: isActiveScope
        ? buildWorkspaceSnapshot(panelResult.value)
        : createDefaultWorkspace(),
      audio: isActiveScope
        ? mapLegacySoundToCharacterAudio(soundResult.value)
        : createDefaultAudio(),
    };

    if (isActiveScope) {
      activeCharacterProfileId = characterProfileId;
    }
  }

  if (!activeCharacterProfileId) {
    return {
      success: false,
      code: "validation-failed",
      message: "Unable to build an active character profile during migration.",
    };
  }

  const state: ApplicationStateV1 = {
    schemaVersion: 1,
    defaults: {
      themeKey,
      defaultCharacterProfileId: activeCharacterProfileId,
    },
    serverProfiles,
    characterProfiles,
    configurationSets: {},
  };

  const validation = validateApplicationState(state);
  if (!validation.success || !validation.data) {
    return {
      success: false,
      code: "validation-failed",
      message: "Legacy migration produced an invalid application graph.",
      ...(validation.errors ? { errors: validation.errors } : {}),
    };
  }

  const commitResult = commit(storage, validation.data);
  if (!commitResult.success) {
    return {
      success: false,
      code: "commit-failed",
      message: commitResult.message,
    };
  }

  writeProvenance(storage, {
    schemaVersion: 1,
    migratedAt: new Date().toISOString(),
    sourceScopeKeys: scopeKeys,
    activeScopeKey,
    skippedLegacyKeys,
  });

  return { success: true, skipped: false };
}

function resolveConfigJson(configJson: unknown): ConfigJson {
  const validation = validateConfigJsonInput(configJson);
  if (validation.success && validation.data) {
    return validation.data;
  }
  return DEFAULT_CONFIG_JSON;
}

function readScopedStore(
  storage: StorageLike,
  key: string,
  skippedLegacyKeys: MigrationProvenance["skippedLegacyKeys"],
): LegacyScopedStore | undefined {
  const result = readLegacyScopedStore(storage, key);
  if (result.error) {
    skippedLegacyKeys.push({ key, reason: result.error });
    return undefined;
  }
  return result.value;
}

function collectScopeKeys(stores: Array<LegacyScopedStore | undefined>): string[] {
  const keys = new Set<string>();
  for (const store of stores) {
    if (!store) {
      continue;
    }
    for (const scopeKey of Object.keys(store.scopes)) {
      keys.add(scopeKey);
    }
  }
  return [...keys];
}

function parseScopeKey(
  scopeKey: string,
): { protocol: TransportProtocol; host: string; port: number } | null {
  const match = scopeKey.match(/^(wss|ws):\/\/([^:]+):(\d+)$/);
  if (!match) {
    return null;
  }

  const bucket = match[1];
  const host = match[2];
  const port = Number(match[3]);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return {
    protocol: bucket === "wss" ? "wss" : "ws",
    host,
    port,
  };
}

interface ScopeStoreBundle {
  aliasStore?: LegacyScopedStore | undefined;
  highlightStore?: LegacyScopedStore | undefined;
  triggerStore?: LegacyScopedStore | undefined;
  timerStore?: LegacyScopedStore | undefined;
  functionStore?: LegacyScopedStore | undefined;
  keyMappings: KeyMappingDefinition[];
}

function buildLocalDefinitions(scopeKey: string, stores: ScopeStoreBundle) {
  const localDefinitions = createEmptyLocalDefinitions();
  localDefinitions.aliases = extractAliases(stores.aliasStore?.scopes[scopeKey]);
  localDefinitions.triggers = extractTriggers(stores.triggerStore?.scopes[scopeKey]);
  localDefinitions.highlights = extractHighlights(stores.highlightStore?.scopes[scopeKey]);
  localDefinitions.functions = extractFunctions(stores.functionStore?.scopes[scopeKey]);
  localDefinitions.timers = extractTimers(stores.timerStore?.scopes[scopeKey]);
  localDefinitions.keyMappings = stores.keyMappings;
  return localDefinitions;
}

function extractAliases(scope: Record<string, unknown> | undefined): AliasDefinition[] {
  if (!scope || !Array.isArray(scope.aliases)) {
    return [];
  }
  return scope.aliases
    .filter((entry): entry is Record<string, unknown> => isObject(entry))
    .map(convertAlias)
    .filter((entry): entry is AliasDefinition => entry !== null);
}

function extractTriggers(scope: Record<string, unknown> | undefined): TriggerDefinition[] {
  if (!scope || !Array.isArray(scope.triggers)) {
    return [];
  }
  return scope.triggers
    .filter((entry): entry is Record<string, unknown> => isObject(entry))
    .map(convertTrigger)
    .filter((entry): entry is TriggerDefinition => entry !== null);
}

function extractHighlights(scope: Record<string, unknown> | undefined): HighlightDefinition[] {
  if (!scope || !Array.isArray(scope.rules)) {
    return [];
  }
  return scope.rules
    .filter((entry): entry is Record<string, unknown> => isObject(entry))
    .map(convertHighlight)
    .filter((entry): entry is HighlightDefinition => entry !== null);
}

function extractFunctions(scope: Record<string, unknown> | undefined): FunctionDefinition[] {
  if (!scope || !Array.isArray(scope.functions)) {
    return [];
  }
  return scope.functions
    .filter((entry): entry is Record<string, unknown> => isObject(entry))
    .map(convertFunction)
    .filter((entry): entry is FunctionDefinition => entry !== null);
}

function extractTimers(scope: Record<string, unknown> | undefined): TimerDefinition[] {
  if (!scope || !Array.isArray(scope.timers)) {
    return [];
  }
  return scope.timers
    .filter((entry): entry is Record<string, unknown> => isObject(entry))
    .map(convertTimer)
    .filter((entry): entry is TimerDefinition => entry !== null);
}

function convertAlias(entry: Record<string, unknown>): AliasDefinition | null {
  const trigger = normalizeWhitespace(entry.trigger);
  if (!trigger) {
    return null;
  }
  const steps = normalizeAutomationSteps(entry.steps);
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : createLegacyId("alias"),
    enabled: entry.enabled !== false,
    trigger,
    description: String(entry.description ?? ""),
    group: normalizeWhitespace(entry.group),
    isRegex: Boolean(entry.isRegex),
    ignoreCase: entry.ignoreCase !== false,
    steps: steps.length > 0 ? steps : [{ type: "send_command", template: "" }],
  };
}

function convertTrigger(entry: Record<string, unknown>): TriggerDefinition | null {
  const pattern = String(entry.pattern ?? "").trim();
  if (!pattern) {
    return null;
  }
  const steps = normalizeAutomationSteps(entry.steps);
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : createLegacyId("trigger"),
    enabled: entry.enabled !== false,
    pattern,
    description: String(entry.description ?? ""),
    group: normalizeWhitespace(entry.group),
    isRegex: Boolean(entry.isRegex),
    ignoreCase: Boolean(entry.ignoreCase),
    gag: Boolean(entry.gag),
    steps: steps.length > 0 ? steps : [{ type: "send_command", template: "" }],
  };
}

function convertHighlight(entry: Record<string, unknown>): HighlightDefinition | null {
  const patternSource = String(entry.patternSource ?? "").trim();
  if (!patternSource) {
    return null;
  }
  const style = isObject(entry.style) ? entry.style : {};
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : createLegacyId("highlight"),
    enabled: entry.enabled !== false,
    patternSource,
    description: String(entry.description ?? ""),
    group: normalizeWhitespace(entry.group),
    ignoreCase: Boolean(entry.ignoreCase),
    style: {
      fg: normalizeColorToken(style.fg) || "yellow",
      bg: normalizeColorToken(style.bg) || "black",
      bold: Boolean(style.bold),
    },
  };
}

function convertFunction(entry: Record<string, unknown>): FunctionDefinition | null {
  const name = normalizeWhitespace(entry.name).toLowerCase();
  if (!name) {
    return null;
  }
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : createLegacyId("function"),
    enabled: entry.enabled !== false,
    name,
    description: String(entry.description ?? ""),
    group: normalizeWhitespace(entry.group),
    script: String(entry.script ?? ""),
  };
}

function convertTimer(entry: Record<string, unknown>): TimerDefinition | null {
  const name = normalizeWhitespace(entry.name);
  if (!name) {
    return null;
  }
  const steps = normalizeAutomationSteps(entry.steps);
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : createLegacyId("timer"),
    enabled: entry.enabled !== false,
    name,
    description: String(entry.description ?? ""),
    group: normalizeWhitespace(entry.group),
    durationMs: normalizeDurationMs(entry.durationMs),
    recurring: Boolean(entry.recurring),
    autoStart: Boolean(entry.autoStart),
    steps: steps.length > 0 ? steps : [{ type: "send_command", template: "" }],
  };
}

function normalizeAutomationSteps(value: unknown): AutomationStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => isObject(entry))
    .map(normalizeAutomationStep)
    .filter((entry): entry is AutomationStep => entry !== null);
}

function normalizeAutomationStep(step: Record<string, unknown>): AutomationStep | null {
  const type = typeof step.type === "string" ? step.type : "send_command";

  if (type === "set_variable") {
    const name = normalizeWhitespace(step.name);
    return name ? { type, name, template: String(step.template ?? "") } : null;
  }
  if (type === "show_message") {
    return { type, template: String(step.template ?? "") };
  }
  if (type === "script") {
    return { type, script: String(step.script ?? "") };
  }
  if (type === "wait") {
    return { type, seconds: normalizeWaitSeconds(step.seconds) };
  }
  if (
    type === "set_alias_enabled" ||
    type === "set_trigger_enabled" ||
    type === "set_timer_enabled"
  ) {
    const mode = step.mode === "enable" || step.mode === "disable" ? step.mode : "toggle";
    return {
      type,
      mode,
      target: String(step.target ?? ""),
      targetId: String(step.targetId ?? ""),
    };
  }
  if (type === "control_timer") {
    const mode = step.mode === "stop" || step.mode === "reset" ? step.mode : "start";
    return {
      type,
      mode,
      target: String(step.target ?? ""),
      targetId: String(step.targetId ?? ""),
    };
  }
  if (type === "run_alias") {
    return { type, template: String(step.template ?? "") };
  }
  if (type === "call_function") {
    return {
      type,
      target: String(step.target ?? ""),
      targetId: String(step.targetId ?? ""),
      template: String(step.template ?? ""),
    };
  }
  if (type === "play_sound") {
    return {
      type,
      category: normalizeWhitespace(step.category),
      sound: normalizeWhitespace(step.sound),
      volume: clampVolume(step.volume, 1),
    };
  }

  return { type: "send_command", template: String(step.template ?? "") };
}

function resolveThemeKey(settings: unknown): string {
  if (!isObject(settings)) {
    return DEFAULT_THEME_KEY;
  }
  return typeof settings.theme === "string" && settings.theme ? settings.theme : DEFAULT_THEME_KEY;
}

function resolveActiveKeyMappings(settings: unknown): KeyMappingDefinition[] {
  if (!isObject(settings) || !Array.isArray(settings.keyMappings)) {
    return [];
  }
  return settings.keyMappings
    .map((entry, index) => normalizeKeyMapping(entry, index))
    .filter((entry): entry is KeyMappingDefinition => entry !== null);
}

function normalizeKeyMapping(entry: unknown, index: number): KeyMappingDefinition | null {
  if (!isObject(entry)) {
    return null;
  }
  const code = typeof entry.code === "string" ? entry.code.trim() : "";
  const legacyKey = typeof entry.key === "string" ? entry.key.trim() : "";
  const command = typeof entry.command === "string" ? entry.command.trim() : "";
  const normalizedCode = code || legacyKey;
  if (!normalizedCode || !command) {
    return null;
  }
  const label =
    typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : normalizedCode;
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : `keymap-${index + 1}`,
    enabled: true,
    code: normalizedCode,
    label,
    legacyKey: code ? "" : legacyKey,
    command,
  };
}

function normalizeCommandHistory(history: string[] | undefined): string[] {
  if (!history) {
    return [];
  }
  return history
    .slice(-MAX_COMMAND_HISTORY)
    .map((entry) => String(entry).slice(0, MAX_COMMAND_LENGTH));
}

function buildWorkspaceSnapshot(raw: unknown): WorkspaceSnapshot {
  if (isObject(raw)) {
    return { version: 1, payload: raw as WorkspaceSnapshot["payload"] };
  }
  return createDefaultWorkspace();
}

function createDefaultWorkspace(): WorkspaceSnapshot {
  return { version: 1, payload: {} };
}

function createDefaultAudio(): CharacterAudioControls {
  return {
    ambient: { enabled: true, volume: 1 },
    combat: { enabled: true, volume: 1 },
    notification: { enabled: true, volume: 1 },
  };
}

function mapLegacySoundToCharacterAudio(raw: unknown): CharacterAudioControls {
  const defaults = createDefaultAudio();
  if (!isObject(raw)) {
    return defaults;
  }

  const volume = clampVolume(raw.volume, DEFAULT_SOUND_VOLUME);
  const categoryEnabled = isObject(raw.categoryEnabled) ? raw.categoryEnabled : {};
  const globallyEnabled = raw.enabled !== false;

  return {
    ambient: {
      enabled: globallyEnabled && categoryEnabled.ambient !== false,
      volume,
    },
    combat: {
      enabled: globallyEnabled && categoryEnabled.combat !== false,
      volume,
    },
    notification: {
      enabled: globallyEnabled && categoryEnabled.alert !== false,
      volume,
    },
  };
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeColorToken(value: unknown): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeDurationMs(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 1000;
  }
  return Math.round(number);
}

function normalizeWaitSeconds(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 1;
  }
  return Math.max(0, Math.min(24 * 60 * 60, number));
}

function clampVolume(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, number));
}

function createLegacyId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
