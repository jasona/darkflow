import type {
  AliasDefinition,
  ConfigKind,
  FunctionDefinition,
  HighlightDefinition,
  KeyMappingDefinition,
  TimerDefinition,
  TriggerDefinition,
} from "../model/configuration.ts";

/** Collapses surrounding and internal whitespace the way legacy managers do. */
export function normalizeWhitespace(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Alias identity: normalizeWhitespace(trigger).toLowerCase() — alias-manager.js:364 */
export function aliasIdentityKey(definition: AliasDefinition): string {
  return normalizeWhitespace(definition.trigger).toLowerCase();
}

/** Trigger identity: trim(pattern) only, case-sensitive — trigger-manager.js:283-285 */
export function triggerIdentityKey(definition: TriggerDefinition): string {
  return String(definition.pattern ?? "").trim();
}

/** Highlight identity: trim(patternSource) only — highlight-manager.js:472 */
export function highlightIdentityKey(definition: HighlightDefinition): string {
  return String(definition.patternSource ?? "").trim();
}

/** Function identity: normalizeWhitespace(name).toLowerCase() — function-manager.js:15-16 */
export function functionIdentityKey(definition: FunctionDefinition): string {
  return normalizeWhitespace(definition.name).toLowerCase();
}

/** Key-mapping identity: trim(code), case-sensitive — settings-manager.js:1198-1201 */
export function keyMappingIdentityKey(definition: KeyMappingDefinition): string {
  return typeof definition.code === "string" ? definition.code.trim() : "";
}

/** Timer identity: normalizeWhitespace(name).toLowerCase() — timer-manager.js:258 */
export function timerIdentityKey(definition: TimerDefinition): string {
  return normalizeWhitespace(definition.name).toLowerCase();
}

export function identityKeyFor(kind: ConfigKind, definition: unknown): string {
  switch (kind) {
    case "aliases":
      return aliasIdentityKey(definition as AliasDefinition);
    case "triggers":
      return triggerIdentityKey(definition as TriggerDefinition);
    case "highlights":
      return highlightIdentityKey(definition as HighlightDefinition);
    case "functions":
      return functionIdentityKey(definition as FunctionDefinition);
    case "keyMappings":
      return keyMappingIdentityKey(definition as KeyMappingDefinition);
    case "timers":
      return timerIdentityKey(definition as TimerDefinition);
  }
}

/** Dispatches identity normalization once the configuration kind is already selected. */
export function identityKeyForDefinition(kind: ConfigKind, definition: unknown): string {
  return identityKeyFor(kind, definition);
}
