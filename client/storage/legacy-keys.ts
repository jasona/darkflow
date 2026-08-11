import type { StorageLike } from "./repository.ts";

/** Legacy scoped automation store shape shared by alias/trigger/timer managers. */
export interface LegacyScopedStore {
  scopes: Record<string, Record<string, unknown>>;
}

export const LEGACY_ALIAS_STORAGE_KEY = "darkwind-client-aliases-v1";
export const LEGACY_HIGHLIGHT_STORAGE_KEY = "darkwind-client-highlights-v1";
export const LEGACY_TRIGGER_STORAGE_KEY = "darkwind-client-triggers-v1";
export const LEGACY_TIMER_STORAGE_KEY = "darkwind-client-timers-v1";
export const LEGACY_FUNCTION_STORAGE_KEY = "darkwind-client-functions-v1";
export const LEGACY_PANEL_STORAGE_KEY = "darkwind-panel-state";
export const LEGACY_HISTORY_STORAGE_KEY = "darkwind-cmd-history";
export const LEGACY_SOUND_STORAGE_KEY = "darkwind-sound-settings";
export const LEGACY_SETTINGS_STORAGE_KEY = "darkwind-client-settings";
export const LEGACY_PROTOCOL_STORAGE_KEY = "darkflow-protocol";

/** All legacy keys this step may read, in one inventory. */
export const LEGACY_STORAGE_KEYS = [
  LEGACY_ALIAS_STORAGE_KEY,
  LEGACY_HIGHLIGHT_STORAGE_KEY,
  LEGACY_TRIGGER_STORAGE_KEY,
  LEGACY_TIMER_STORAGE_KEY,
  LEGACY_FUNCTION_STORAGE_KEY,
  LEGACY_PANEL_STORAGE_KEY,
  LEGACY_HISTORY_STORAGE_KEY,
  LEGACY_SOUND_STORAGE_KEY,
  LEGACY_SETTINGS_STORAGE_KEY,
  LEGACY_PROTOCOL_STORAGE_KEY,
] as const;

/** Result of a best-effort legacy JSON read. */
export interface LegacyReadResult<T> {
  value?: T;
  error?: string;
}

/** Parses JSON from storage without throwing; never mutates storage. */
export function readLegacyJson<T>(storage: StorageLike, key: string): LegacyReadResult<T> {
  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return {};
    }
    return { value: JSON.parse(raw) as T };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid JSON document.",
    };
  }
}

/** Reads a legacy scoped automation store. */
export function readLegacyScopedStore(
  storage: StorageLike,
  key: string,
): LegacyReadResult<LegacyScopedStore> {
  const result = readLegacyJson<unknown>(storage, key);
  if (result.error) {
    return { error: result.error };
  }
  if (result.value === undefined) {
    return {};
  }
  if (
    typeof result.value !== "object" ||
    result.value === null ||
    !("scopes" in result.value) ||
    typeof (result.value as LegacyScopedStore).scopes !== "object" ||
    (result.value as LegacyScopedStore).scopes === null
  ) {
    return { error: "Legacy scoped store is missing a scopes object." };
  }
  return { value: result.value as LegacyScopedStore };
}

/** Reads legacy command history as a string array. */
export function readLegacyCommandHistory(storage: StorageLike): LegacyReadResult<string[]> {
  const result = readLegacyJson<unknown>(storage, LEGACY_HISTORY_STORAGE_KEY);
  if (result.error) {
    return { error: result.error };
  }
  if (result.value === undefined) {
    return {};
  }
  if (!Array.isArray(result.value)) {
    return { error: "Command history must be a JSON array." };
  }
  return { value: result.value.filter((entry): entry is string => typeof entry === "string") };
}

/** Reads the opaque panel workspace envelope. */
export function readLegacyPanelState(storage: StorageLike): LegacyReadResult<unknown> {
  return readLegacyJson<unknown>(storage, LEGACY_PANEL_STORAGE_KEY);
}

/** Reads legacy sound settings. */
export function readLegacySoundSettings(storage: StorageLike): LegacyReadResult<unknown> {
  return readLegacyJson<unknown>(storage, LEGACY_SOUND_STORAGE_KEY);
}

/** Reads the global client settings blob. */
export function readLegacyClientSettings(storage: StorageLike): LegacyReadResult<unknown> {
  return readLegacyJson<unknown>(storage, LEGACY_SETTINGS_STORAGE_KEY);
}

/** Reads the persisted protocol override without parsing JSON. */
export function readLegacyProtocolOverride(storage: StorageLike): string | undefined {
  const value = storage.getItem(LEGACY_PROTOCOL_STORAGE_KEY);
  if (value === null || value === "") {
    return undefined;
  }
  return value;
}
