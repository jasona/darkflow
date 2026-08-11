import type { ResourceScope } from "./resource-scope.ts";

const GMCP_VARIABLE_PREFIX = "gmcp";

/** Minimal timer definition shape consumed by reconcileTimers. */
export interface EffectiveTimerDefinition {
  id: string;
  enabled?: boolean;
  autoStart?: boolean;
}

/** Runtime metadata tracked for one scheduled timer id. */
export interface TimerRuntimeState {
  startedAt: number;
  fireAt: number;
}

/** Session-owned automation execution state: variables, GMCP variables, and timers. */
export interface AutomationRuntimeState {
  getVariable(name: string): string | undefined;
  setVariable(name: string, value: string): boolean;
  removeVariable(name: string): void;
  listVariableNames(): string[];
  getAutomationVariables(): Record<string, string>;
  setGmcpVariable(packageName: string, data: unknown): void;
  resetGmcpVariables(): void;
  getGmcpVariables(): Record<string, string>;
  listGmcpVariables(): Array<{ name: string; value: string }>;
  scheduleTimer(timerId: string, durationMs: number, onFire: () => void): void;
  clearTimer(timerId: string): void;
  getTimerRuntimeState(timerId: string): TimerRuntimeState | null;
  scheduleWait(delayMs: number): Promise<void>;
  reconcileTimers(
    effectiveTimers: EffectiveTimerDefinition[],
    onStart: (timer: EffectiveTimerDefinition) => void,
  ): void;
  dispose(): void;
}

interface TimerRegistryEntry {
  startedAt: number;
  fireAt: number;
  disposer: () => void;
}

function normalizeWhitespace(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Mirrors gmcp-variables.js toVariableSegment for identical variable naming. */
function toVariableSegment(value: unknown): string {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Mirrors gmcp-variables.js variableNameFor. */
function variableNameFor(parts: string[]): string {
  return [GMCP_VARIABLE_PREFIX, ...parts].map(toVariableSegment).filter(Boolean).join("_");
}

/** Mirrors gmcp-variables.js serializeValue. */
function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function setGmcpVariableEntry(
  gmcpVariables: Map<string, string>,
  parts: string[],
  value: unknown,
): void {
  const name = variableNameFor(parts);
  if (!name || name === GMCP_VARIABLE_PREFIX) return;
  gmcpVariables.set(name, serializeValue(value));
}

/** Mirrors gmcp-variables.js flattenValue. */
function flattenValue(gmcpVariables: Map<string, string>, parts: string[], value: unknown): void {
  if (value === undefined) return;

  if (value === null || typeof value !== "object") {
    setGmcpVariableEntry(gmcpVariables, parts, value);
    return;
  }

  setGmcpVariableEntry(gmcpVariables, parts, value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenValue(gmcpVariables, [...parts, String(index)], item);
    });
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    flattenValue(gmcpVariables, [...parts, key], item);
  });
}

/** Creates session-owned automation execution state backed by one resource scope. */
export function createAutomationRuntimeState(scope: ResourceScope): AutomationRuntimeState {
  const userVariables = new Map<string, string>();
  const gmcpVariables = new Map<string, string>();
  const timerRegistry = new Map<string, TimerRegistryEntry>();

  const clearTimer = (timerId: string): void => {
    const key = String(timerId || "");
    if (!key) return;
    const entry = timerRegistry.get(key);
    if (!entry) return;
    entry.disposer();
    timerRegistry.delete(key);
  };

  const scheduleTimer = (timerId: string, durationMs: number, onFire: () => void): void => {
    const key = String(timerId || "");
    if (!key) return;

    clearTimer(key);

    const startedAt = Date.now();
    const fireAt = startedAt + durationMs;
    const disposer = scope.setTimeout(() => {
      timerRegistry.delete(key);
      onFire();
    }, durationMs);

    timerRegistry.set(key, { startedAt, fireAt, disposer });
  };

  return {
    getVariable(name: string): string | undefined {
      return userVariables.get(name);
    },

    setVariable(name: string, value: string): boolean {
      const cleanName = normalizeWhitespace(name);
      if (!cleanName) return false;
      userVariables.set(cleanName, String(value ?? ""));
      return true;
    },

    removeVariable(name: string): void {
      if (!name) return;
      userVariables.delete(name);
    },

    listVariableNames(): string[] {
      return Array.from(userVariables.keys()).sort((left, right) => left.localeCompare(right));
    },

    getAutomationVariables(): Record<string, string> {
      const merged: Record<string, string> = {};
      for (const [name, value] of gmcpVariables.entries()) {
        merged[name] = value;
      }
      for (const [name, value] of userVariables.entries()) {
        merged[name] = value;
      }
      return merged;
    },

    setGmcpVariable(packageName: string, data: unknown): void {
      const packageParts = String(packageName || "")
        .split(".")
        .map(toVariableSegment)
        .filter(Boolean);

      if (!packageParts.length) return;
      flattenValue(gmcpVariables, packageParts, data === undefined ? "" : data);
    },

    resetGmcpVariables(): void {
      gmcpVariables.clear();
    },

    getGmcpVariables(): Record<string, string> {
      return Object.fromEntries(gmcpVariables.entries());
    },

    listGmcpVariables(): Array<{ name: string; value: string }> {
      return Array.from(gmcpVariables.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([name, value]) => ({ name, value }));
    },

    scheduleTimer,

    clearTimer,

    getTimerRuntimeState(timerId: string): TimerRuntimeState | null {
      const entry = timerRegistry.get(String(timerId || ""));
      return entry ? { startedAt: entry.startedAt, fireAt: entry.fireAt } : null;
    },

    scheduleWait(delayMs: number): Promise<void> {
      if (delayMs <= 0) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        scope.setTimeout(() => {
          resolve();
        }, delayMs);
      });
    },

    reconcileTimers(
      effectiveTimers: EffectiveTimerDefinition[],
      onStart: (timer: EffectiveTimerDefinition) => void,
    ): void {
      const effectiveById = new Map<string, EffectiveTimerDefinition>();
      for (const timer of effectiveTimers) {
        if (timer && timer.id) {
          effectiveById.set(timer.id, timer);
        }
      }

      for (const timerId of Array.from(timerRegistry.keys())) {
        const definition = effectiveById.get(timerId);
        if (!definition || definition.enabled === false) {
          clearTimer(timerId);
        }
      }

      for (const timer of effectiveTimers) {
        if (!timer || !timer.id || timer.enabled === false || !timer.autoStart) {
          continue;
        }
        if (timerRegistry.has(timer.id)) {
          continue;
        }
        onStart(timer);
      }
    },

    dispose(): void {
      userVariables.clear();
      gmcpVariables.clear();
      timerRegistry.clear();
    },
  };
}
