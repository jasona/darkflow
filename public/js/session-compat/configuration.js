/**
 * Runtime-installed bridge between legacy public/js managers and the Phase 1
 * configuration service. Never statically imports client/** - Step 13 installs
 * a real bridge object at boot time; until then bridge stays null.
 *
 * @typedef {Object} EffectiveDefinition
 * @property {Object} definition
 * @property {Object} source
 *
 * @typedef {Object} ConfigurationCompatBridge
 * @property {() => string} getActiveCharacterProfileId
 * @property {(kind: string) => EffectiveDefinition[]} getEffectiveDefinitions
 * @property {(kind: string, definitions: Object[]) => void} replaceLocalDefinitions
 * @property {(kind: string, definition: Object) => void} upsertLocalDefinitionByIdentity
 * @property {(kind: string, identityKey: string) => boolean} removeLocalDefinitionByIdentity
 * @property {(kind: string, identityKey: string, enabled: boolean) => boolean} setLocalDefinitionEnabledByIdentity
 * @property {(listener: Function) => () => void} subscribe
 */

const BRIDGE_UNINSTALLED_ERROR = 'ConfigurationCompatBridgeNotInstalledError';

/** @type {ConfigurationCompatBridge | null} */
let bridge = null;

/** Installs or replaces the active configuration compatibility bridge. */
export function installConfigurationCompatBridge(nextBridge) {
  bridge = nextBridge;
}

/** Clears the bridge; intended for isolated test fixtures only. */
export function resetConfigurationCompatBridgeForTests() {
  bridge = null;
}

/** Returns true when a configuration bridge is installed. */
export function isConfigurationCompatActive() {
  return bridge !== null;
}

function requireBridge() {
  if (bridge === null) {
    const error = new Error('Configuration compatibility bridge is not installed.');
    error.name = BRIDGE_UNINSTALLED_ERROR;
    throw error;
  }
  return bridge;
}

/** Returns the active character profile id from the installed bridge. */
export function getActiveCharacterProfileId() {
  return requireBridge().getActiveCharacterProfileId();
}

/** Returns effective definitions for one kind, including provenance metadata. */
export function getEffectiveDefinitions(kind) {
  return requireBridge().getEffectiveDefinitions(kind);
}

/** Bulk-replaces local definitions for one kind on the active character. */
export function replaceLocalDefinitions(kind, definitions) {
  requireBridge().replaceLocalDefinitions(kind, definitions);
}

/** Upserts one local definition keyed by kind-specific identity normalization. */
export function upsertLocalDefinitionByIdentity(kind, definition) {
  requireBridge().upsertLocalDefinitionByIdentity(kind, definition);
}

/** Removes one local definition by identity key; returns whether a local entry was found and removed. */
export function removeLocalDefinitionByIdentity(kind, identityKey) {
  return requireBridge().removeLocalDefinitionByIdentity(kind, identityKey);
}

/** Sets the enabled flag on one local definition by identity key; returns whether a local entry was found and mutated. */
export function setLocalDefinitionEnabledByIdentity(kind, identityKey, enabled) {
  return requireBridge().setLocalDefinitionEnabledByIdentity(kind, identityKey, enabled);
}

/** Registers a change listener on the installed bridge. */
export function subscribe(listener) {
  return requireBridge().subscribe(listener);
}

export { BRIDGE_UNINSTALLED_ERROR };
