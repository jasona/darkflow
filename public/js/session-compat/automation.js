/**
 * Runtime-installed bridge between legacy public/js managers and the Phase 1
 * session-owned automation runtime. Never statically imports client/** - Step 13
 * installs a real bridge object at boot time; until then bridge stays null.
 *
 * @typedef {Object} AutomationCompatBridge
 * @property {() => string | undefined} getVariable
 * @property {(name: string, value: string) => boolean} setVariable
 * @property {(name: string) => void} removeVariable
 * @property {() => string[]} listVariableNames
 * @property {() => Object<string, string>} getAutomationVariables
 * @property {(packageName: string, data: *) => void} setGmcpVariable
 * @property {() => void} resetGmcpVariables
 * @property {() => Object<string, string>} getGmcpVariables
 * @property {() => Array<{name: string, value: string}>} listGmcpVariables
 * @property {(timerId: string, durationMs: number, onFire: Function) => void} scheduleTimer
 * @property {(timerId: string) => void} clearTimer
 * @property {(timerId: string) => ({startedAt: number, fireAt: number} | null)} getTimerRuntimeState
 * @property {(delayMs: number) => Promise<void>} scheduleWait
 * @property {(effectiveTimers: Object[], onStart: Function) => void} reconcileTimers
 */

const BRIDGE_UNINSTALLED_ERROR = 'AutomationCompatBridgeNotInstalledError';

/** @type {AutomationCompatBridge | null} */
let bridge = null;

/** Installs or replaces the active automation compatibility bridge. */
export function installAutomationCompatBridge(nextBridge) {
  bridge = nextBridge;
}

/** Clears the bridge; intended for isolated test fixtures only. */
export function resetAutomationCompatBridgeForTests() {
  bridge = null;
}

/** Returns true when an automation bridge is installed. */
export function isAutomationCompatActive() {
  return bridge !== null;
}

function requireBridge() {
  if (bridge === null) {
    const error = new Error('Automation compatibility bridge is not installed.');
    error.name = BRIDGE_UNINSTALLED_ERROR;
    throw error;
  }
  return bridge;
}

/** Returns one user variable from the installed bridge. */
export function getVariable(name) {
  return requireBridge().getVariable(name);
}

/** Sets one user variable on the installed bridge. */
export function setVariable(name, value) {
  return requireBridge().setVariable(name, value);
}

/** Removes one user variable from the installed bridge. */
export function removeVariable(name) {
  requireBridge().removeVariable(name);
}

/** Lists user variable names from the installed bridge. */
export function listVariableNames() {
  return requireBridge().listVariableNames();
}

/** Returns merged GMCP and user automation variables from the installed bridge. */
export function getAutomationVariables() {
  return requireBridge().getAutomationVariables();
}

/** Registers GMCP package data as session-scoped variables on the installed bridge. */
export function setGmcpVariable(packageName, data) {
  requireBridge().setGmcpVariable(packageName, data);
}

/** Clears all GMCP variables on the installed bridge. */
export function resetGmcpVariables() {
  requireBridge().resetGmcpVariables();
}

/** Returns GMCP variables from the installed bridge. */
export function getGmcpVariables() {
  return requireBridge().getGmcpVariables();
}

/** Lists GMCP variables from the installed bridge. */
export function listGmcpVariables() {
  return requireBridge().listGmcpVariables();
}

/** Schedules one timer through the installed bridge. */
export function scheduleTimer(timerId, durationMs, onFire) {
  requireBridge().scheduleTimer(timerId, durationMs, onFire);
}

/** Clears one timer through the installed bridge. */
export function clearTimer(timerId) {
  requireBridge().clearTimer(timerId);
}

/** Returns runtime metadata for one timer from the installed bridge. */
export function getTimerRuntimeState(timerId) {
  return requireBridge().getTimerRuntimeState(timerId);
}

/** Schedules a cancelable wait through the installed bridge. */
export function scheduleWait(delayMs) {
  return requireBridge().scheduleWait(delayMs);
}

/** Reconciles timer runtime state against a new effective timer snapshot. */
export function reconcileTimers(effectiveTimers, onStart) {
  requireBridge().reconcileTimers(effectiveTimers, onStart);
}

export { BRIDGE_UNINSTALLED_ERROR };
