import { dom } from './state.js';
import { aliasManager } from './alias-manager.js';
import {
  executeAutomationSteps,
  registerTimerAutomation,
} from './automation-executor.js';
import { getAutomationScriptDiagnostics } from './automation-script-core.mjs';
import {
  getActiveCharacterProfileId,
  getEffectiveDefinitions,
  isConfigurationCompatActive,
  removeLocalDefinitionByIdentity,
  replaceLocalDefinitions,
  setLocalDefinitionEnabledByIdentity,
  subscribe,
  upsertLocalDefinitionByIdentity,
} from './session-compat/configuration.js';
import {
  clearTimer as bridgeClearTimer,
  getTimerRuntimeState,
  isAutomationCompatActive,
  reconcileTimers as bridgeReconcileTimers,
  scheduleTimer as bridgeScheduleTimer,
  scheduleWait,
} from './session-compat/automation.js';

const TIMER_STORAGE_KEY = 'darkwind-client-timers-v1';
const MIN_TIMER_MS = 1000;
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
const MAX_WAIT_SECONDS = 24 * 60 * 60;

function createId() {
  return 'timer-' + Math.random().toString(36).slice(2, 10);
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeDurationMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 60 * 1000;
  return Math.max(MIN_TIMER_MS, Math.min(MAX_TIMER_MS, Math.round(number)));
}

function normalizeWaitSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(MAX_WAIT_SECONDS, number));
}

function normalizeMode(mode) {
  return mode === 'enable' || mode === 'disable' ? mode : 'toggle';
}

function normalizeTimerControlMode(mode) {
  return mode === 'stop' || mode === 'reset' || mode === 'run' ? mode : 'start';
}

function normalizeVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(1, number));
}

function emitTimerDataChanged(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('darkwind:timer-data-changed', {
    detail: detail || null,
  }));
}

function normalizeStep(step) {
  if (!step || typeof step !== 'object') return null;
  const type = typeof step.type === 'string' ? step.type : 'send_command';

  if (type === 'set_variable') {
    const name = normalizeWhitespace(step.name);
    return name
      ? { type, name, template: String(step.template || '') }
      : null;
  }

  if (type === 'show_message') {
    return { type, template: String(step.template || '') };
  }

  if (type === 'script') {
    return { type, script: String(step.script || '') };
  }

  if (type === 'wait') {
    return { type, seconds: normalizeWaitSeconds(step.seconds) };
  }

  if (type === 'set_alias_enabled'
    || type === 'set_trigger_enabled'
    || type === 'set_timer_enabled') {
    return {
      type,
      mode: normalizeMode(step.mode),
      target: String(step.target || ''),
      targetId: String(step.targetId || ''),
    };
  }

  if (type === 'control_timer') {
    return {
      type,
      mode: normalizeTimerControlMode(step.mode),
      target: String(step.target || ''),
      targetId: String(step.targetId || ''),
    };
  }

  if (type === 'run_alias') {
    return { type, template: String(step.template || '') };
  }

  if (type === 'call_function') {
    return {
      type,
      target: String(step.target || ''),
      targetId: String(step.targetId || ''),
      template: String(step.template || ''),
    };
  }

  if (type === 'play_sound') {
    return {
      type,
      category: normalizeWhitespace(step.category),
      sound: normalizeWhitespace(step.sound),
      volume: normalizeVolume(step.volume),
    };
  }

  return { type: 'send_command', template: String(step.template || '') };
}

function normalizeTimer(timer) {
  if (!timer || typeof timer !== 'object') return null;
  const name = normalizeWhitespace(timer.name);
  if (!name) return null;

  const steps = Array.isArray(timer.steps)
    ? timer.steps.map(normalizeStep).filter(Boolean)
    : [];

  return {
    id: typeof timer.id === 'string' && timer.id ? timer.id : createId(),
    enabled: timer.enabled !== false,
    name,
    description: String(timer.description || ''),
    group: normalizeWhitespace(timer.group),
    durationMs: normalizeDurationMs(timer.durationMs),
    recurring: Boolean(timer.recurring),
    autoStart: Boolean(timer.autoStart),
    steps: steps.length ? steps : [{ type: 'send_command', template: '' }],
  };
}

function normalizeScope(scope) {
  const timers = Array.isArray(scope && scope.timers)
    ? scope.timers.map(normalizeTimer).filter(Boolean)
    : [];
  return { timers };
}

function normalizeData(data) {
  const scopes = {};
  if (data && typeof data === 'object' && data.scopes && typeof data.scopes === 'object') {
    for (const [scopeKey, scope] of Object.entries(data.scopes)) {
      scopes[scopeKey] = normalizeScope(scope);
    }
  }
  return { scopes };
}

function cloneTimer(timer) {
  return {
    ...timer,
    steps: timer.steps.map((step) => ({ ...step })),
  };
}

function formatTimerName(timer) {
  return String(timer && timer.name || '').trim();
}

function timerIdentityKey(name) {
  return normalizeWhitespace(name).toLowerCase();
}

function getEffectiveTimerEntries() {
  return getEffectiveDefinitions('timers');
}

function getEffectiveTimerDefinitions() {
  return getEffectiveTimerEntries().map((entry) => cloneTimer(entry.definition));
}

/** Releases any live reconciliation subscription before optionally re-establishing it. */
function syncReconciliationSubscription() {
  if (timerManager._reconciliationUnsubscribe) {
    timerManager._reconciliationUnsubscribe();
    timerManager._reconciliationUnsubscribe = null;
  }

  if (!isAutomationCompatActive() || !isConfigurationCompatActive()) {
    return;
  }

  timerManager._reconciliationUnsubscribe = subscribe(() => {
    const scopeKey = timerManager.getActiveScopeKey();
    bridgeReconcileTimers(getEffectiveTimerDefinitions(), (timer) => {
      timerManager._scheduleTimer(scopeKey, timer);
    });
  });
}

export const timerManager = {
  _data: { scopes: {} },
  _runtime: new Map(),
  _reconciliationUnsubscribe: null,
  _sendCommand: null,
  _appendMessage: null,

  init() {
    try {
      const raw = localStorage.getItem(TIMER_STORAGE_KEY);
      if (raw) {
        this._data = normalizeData(JSON.parse(raw));
        return;
      }
    } catch (error) {
      console.warn('Failed to load timers', error);
    }

    this._data = { scopes: {} };
  },

  configureRuntime(options = {}) {
    this._sendCommand = typeof options.sendCommand === 'function' ? options.sendCommand : this._sendCommand;
    this._appendMessage = typeof options.appendMessage === 'function' ? options.appendMessage : this._appendMessage;
  },

  _save(detail = null) {
    try {
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(this._data));
      emitTimerDataChanged({
        scopeKey: detail && detail.scopeKey ? detail.scopeKey : this.getActiveScopeKey(),
        ...detail,
      });
    } catch (error) {
      console.warn('Failed to save timers', error);
    }
  },

  getActiveScopeKey() {
    if (isConfigurationCompatActive()) {
      return getActiveCharacterProfileId();
    }
    const host = normalizeWhitespace(dom.host && dom.host.value ? dom.host.value : '').toLowerCase() || 'default';
    const port = normalizeWhitespace(dom.port && dom.port.value ? dom.port.value : '') || '4242';
    const sel = dom.protocolSelect && dom.protocolSelect.value;
    const protocol = (sel === 'wss' || sel === 'telnets') ? 'wss' : 'ws';
    return protocol + '://' + host + ':' + port;
  },

  _ensureScope(scopeKey) {
    if (!this._data.scopes[scopeKey]) {
      this._data.scopes[scopeKey] = { timers: [] };
    }
    return this._data.scopes[scopeKey];
  },

  _runtimeScope(scopeKey) {
    if (!this._runtime.has(scopeKey)) this._runtime.set(scopeKey, new Map());
    return this._runtime.get(scopeKey);
  },

  getScopeSnapshot(scopeKey = this.getActiveScopeKey()) {
    if (isConfigurationCompatActive()) {
      return {
        timers: getEffectiveTimerDefinitions(),
      };
    }
    const scope = normalizeScope(this._ensureScope(scopeKey));
    return {
      timers: scope.timers.map(cloneTimer),
    };
  },

  saveScope(scopeKey, scope) {
    if (isConfigurationCompatActive()) {
      syncReconciliationSubscription();
      replaceLocalDefinitions('timers', normalizeScope(scope).timers);
      emitTimerDataChanged({ scopeKey });
      return;
    }
    this._data.scopes[scopeKey] = normalizeScope(scope);
    this._save({ scopeKey });
    this.reconcileRuntime(scopeKey);
  },

  createEmptyTimer() {
    return {
      id: createId(),
      enabled: true,
      name: '',
      description: '',
      group: '',
      durationMs: 60 * 1000,
      recurring: false,
      autoStart: false,
      steps: [{ type: 'send_command', template: '' }],
    };
  },

  findTimerByName(name, scopeKey = this.getActiveScopeKey()) {
    const normalized = timerIdentityKey(name);
    if (!normalized) return null;
    if (isConfigurationCompatActive()) {
      const entry = getEffectiveTimerEntries().find(
        (item) => timerIdentityKey(item.definition.name) === normalized,
      );
      return entry ? cloneTimer(entry.definition) : null;
    }
    return this._ensureScope(scopeKey).timers.find((timer) => (
      normalizeWhitespace(timer.name).toLowerCase() === normalized
    )) || null;
  },

  findTimerById(id, scopeKey = this.getActiveScopeKey()) {
    const key = String(id || '');
    if (!key) return null;
    if (isConfigurationCompatActive()) {
      const entry = getEffectiveTimerEntries().find((item) => item.definition.id === key);
      return entry ? cloneTimer(entry.definition) : null;
    }
    return this._ensureScope(scopeKey).timers.find((timer) => timer.id === key) || null;
  },

  setEnabledByTarget(name, enabled, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerByName(name, scopeKey);
    if (!timer) return { target: null, enabled: null };
    return this.setEnabledById(timer.id, enabled, scopeKey);
  },

  setEnabledById(id, enabled, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerById(id, scopeKey);
    if (!timer) return { target: null, enabled: null };
    const nextEnabled = enabled !== false;
    if (isConfigurationCompatActive()) {
      syncReconciliationSubscription();
      const changed = setLocalDefinitionEnabledByIdentity('timers', timerIdentityKey(timer.name), nextEnabled);
      if (changed && !nextEnabled) this.stopTimerById(timer.id, scopeKey);
      if (changed) emitTimerDataChanged({ scopeKey });
      return { target: timer, enabled: changed ? nextEnabled : timer.enabled };
    }
    timer.enabled = nextEnabled;
    if (!timer.enabled) this.stopTimerById(timer.id, scopeKey, { silent: true });
    this._save({ scopeKey });
    return { target: timer, enabled: timer.enabled };
  },

  toggleEnabledById(id, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerById(id, scopeKey);
    if (!timer) return { target: null, enabled: null };
    return this.setEnabledById(id, timer.enabled === false, scopeKey);
  },

  toggleEnabledByTarget(name, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerByName(name, scopeKey);
    if (!timer) return { target: null, enabled: null };
    return this.toggleEnabledById(timer.id, scopeKey);
  },

  _clearRuntimeTimer(scopeKey, timerId) {
    if (isAutomationCompatActive()) {
      bridgeClearTimer(timerId);
      return;
    }
    const runtimeScope = this._runtimeScope(scopeKey);
    const runtime = runtimeScope.get(timerId);
    if (runtime && runtime.handle) clearTimeout(runtime.handle);
    runtimeScope.delete(timerId);
  },

  _scheduleTimer(scopeKey, timer) {
    this._clearRuntimeTimer(scopeKey, timer.id);
    if (!timer || timer.enabled === false) return { target: timer || null, running: false };

    if (isAutomationCompatActive()) {
      bridgeScheduleTimer(timer.id, timer.durationMs, () => this._fireTimer(scopeKey, timer.id));
      return { target: timer, running: true };
    }

    const runtime = {
      handle: null,
      startedAt: Date.now(),
      fireAt: Date.now() + timer.durationMs,
    };
    runtime.handle = setTimeout(() => this._fireTimer(scopeKey, timer.id), timer.durationMs);
    this._runtimeScope(scopeKey).set(timer.id, runtime);
    return { target: timer, running: true };
  },

  _fireTimer(scopeKey, timerId) {
    this._clearRuntimeTimer(scopeKey, timerId);
    const timer = this.findTimerById(timerId, scopeKey);
    if (!timer || timer.enabled === false) return;

    const result = this._executeTimer(scopeKey, timer);
    const reschedule = () => {
      if (timer.recurring && timer.enabled !== false) {
        this._scheduleTimer(scopeKey, timer);
      }
    };
    if (result && result.completion) result.completion.finally(reschedule);
    else reschedule();
  },

  _executeTimer(scopeKey, timer) {
    const executionContext = {
      appendMessage: this._appendMessage,
      sendCommand: this._sendCommand,
      scopeKey,
      templateContext: {
        args: [timer.name],
        remainder: timer.name,
        variables: aliasManager.getAutomationVariables(scopeKey),
      },
      source: {
        prefix: 'Timer',
        description: 'timer "' + timer.name + '"',
      },
      aliasContext: {
        depth: 0,
        trail: [],
      },
    };
    if (isAutomationCompatActive()) {
      executionContext.scheduleWait = (delayMs) => scheduleWait(delayMs);
    }
    return executeAutomationSteps(timer.steps, executionContext);
  },

  startTimerById(id, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerById(id, scopeKey);
    if (!timer || timer.enabled === false) return { target: timer || null, running: false };
    return this._scheduleTimer(scopeKey, timer);
  },

  startTimerByName(name, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerByName(name, scopeKey);
    if (!timer || timer.enabled === false) return { target: timer || null, running: false };
    return this._scheduleTimer(scopeKey, timer);
  },

  stopTimerById(id, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerById(id, scopeKey);
    if (!timer) return { target: null, running: false };
    this._clearRuntimeTimer(scopeKey, timer.id);
    return { target: timer, running: false };
  },

  stopTimerByName(name, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerByName(name, scopeKey);
    if (!timer) return { target: null, running: false };
    return this.stopTimerById(timer.id, scopeKey);
  },

  resetTimerById(id, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerById(id, scopeKey);
    if (!timer || timer.enabled === false) return { target: timer || null, running: false };
    return this._scheduleTimer(scopeKey, timer);
  },

  resetTimerByName(name, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerByName(name, scopeKey);
    if (!timer || timer.enabled === false) return { target: timer || null, running: false };
    return this.resetTimerById(timer.id, scopeKey);
  },

  runTimerById(id, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerById(id, scopeKey);
    if (!timer || timer.enabled === false) return { target: timer || null, running: false };
    this._executeTimer(scopeKey, timer);
    return {
      target: timer,
      running: Boolean(this._runtimeScope(scopeKey).get(timer.id)),
    };
  },

  runTimerByName(name, scopeKey = this.getActiveScopeKey()) {
    const timer = this.findTimerByName(name, scopeKey);
    if (!timer || timer.enabled === false) return { target: timer || null, running: false };
    return this.runTimerById(timer.id, scopeKey);
  },

  startAutoTimers(scopeKey = this.getActiveScopeKey()) {
    syncReconciliationSubscription();
    const timers = isConfigurationCompatActive()
      ? getEffectiveTimerDefinitions()
      : this._ensureScope(scopeKey).timers;
    timers
      .filter((timer) => timer.enabled !== false && timer.autoStart)
      .forEach((timer) => this.startTimerById(timer.id, scopeKey));
  },

  stopAllTimers(scopeKey = null) {
    if (isAutomationCompatActive()) {
      const timers = isConfigurationCompatActive()
        ? getEffectiveTimerDefinitions()
        : (scopeKey ? this._ensureScope(scopeKey).timers : Object.values(this._data.scopes).flatMap((scope) => scope.timers));
      timers.forEach((timer) => bridgeClearTimer(timer.id));
      return;
    }

    if (scopeKey) {
      const runtimeScope = this._runtimeScope(scopeKey);
      for (const runtime of runtimeScope.values()) {
        if (runtime && runtime.handle) clearTimeout(runtime.handle);
      }
      runtimeScope.clear();
      return;
    }

    for (const key of this._runtime.keys()) {
      this.stopAllTimers(key);
    }
  },

  reconcileRuntime(scopeKey = this.getActiveScopeKey()) {
    syncReconciliationSubscription();
    if (isAutomationCompatActive() && isConfigurationCompatActive()) {
      bridgeReconcileTimers(getEffectiveTimerDefinitions(), (timer) => {
        this._scheduleTimer(scopeKey, timer);
      });
      return;
    }
    const timers = this._ensureScope(scopeKey).timers;
    const ids = new Set(timers.filter((timer) => timer.enabled !== false).map((timer) => timer.id));
    const runtimeScope = this._runtimeScope(scopeKey);
    for (const timerId of Array.from(runtimeScope.keys())) {
      if (!ids.has(timerId)) this._clearRuntimeTimer(scopeKey, timerId);
    }
  },

  getRuntimeState(scopeKey = this.getActiveScopeKey()) {
    if (isAutomationCompatActive()) {
      const timers = isConfigurationCompatActive()
        ? getEffectiveTimerDefinitions()
        : this._ensureScope(scopeKey).timers;
      const result = {};
      for (const timer of timers) {
        const runtime = getTimerRuntimeState(timer.id);
        if (!runtime) continue;
        result[timer.id] = {
          running: true,
          startedAt: runtime.startedAt,
          fireAt: runtime.fireAt,
          remainingMs: Math.max(0, runtime.fireAt - Date.now()),
        };
      }
      return result;
    }
    const runtimeScope = this._runtimeScope(scopeKey);
    const result = {};
    for (const [timerId, runtime] of runtimeScope.entries()) {
      result[timerId] = {
        running: Boolean(runtime && runtime.handle),
        startedAt: runtime.startedAt,
        fireAt: runtime.fireAt,
        remainingMs: Math.max(0, runtime.fireAt - Date.now()),
      };
    }
    return result;
  },

  getTimerDiagnostics(scope, timerId) {
    const timers = Array.isArray(scope && scope.timers) ? scope.timers : [];
    const timer = timers.find((item) => item.id === timerId);
    if (!timer) return [];

    const diagnostics = [];
    const name = normalizeWhitespace(timer.name);
    if (!name) diagnostics.push('Timer name is required.');

    const duplicate = timers.find((item) => (
      item.id !== timer.id
      && normalizeWhitespace(item.name).toLowerCase() === name.toLowerCase()
    ));
    if (name && duplicate) diagnostics.push('Timer name conflicts with another timer in this scope.');

    const durationMs = Number(timer.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < MIN_TIMER_MS) {
      diagnostics.push('Timer duration must be at least 1 second.');
    }

    if (!Array.isArray(timer.steps) || !timer.steps.length) {
      diagnostics.push('At least one step is required.');
      return diagnostics;
    }

    for (let index = 0; index < timer.steps.length; index++) {
      const step = timer.steps[index];
      if (!step || !step.type) {
        diagnostics.push('Step ' + (index + 1) + ' is invalid.');
        continue;
      }
      if (step.type === 'set_variable' && !normalizeWhitespace(step.name)) {
        diagnostics.push('Step ' + (index + 1) + ' must choose a variable name.');
      }
      if ((step.type === 'send_command' || step.type === 'show_message' || step.type === 'set_variable')
        && !String(step.template || '').trim()) {
        diagnostics.push('Step ' + (index + 1) + ' must have content.');
      }
      if (step.type === 'wait') {
        const seconds = Number(step.seconds);
        if (!Number.isFinite(seconds) || seconds < 0) {
          diagnostics.push('Step ' + (index + 1) + ' wait time must be 0 seconds or more.');
        }
      }
      if (step.type === 'script') {
        const scriptDiagnostics = getAutomationScriptDiagnostics(step.script || '');
        scriptDiagnostics.forEach((message) => {
          diagnostics.push('Step ' + (index + 1) + ': ' + message);
        });
      }
      if ((step.type === 'set_alias_enabled'
        || step.type === 'set_trigger_enabled'
        || step.type === 'set_timer_enabled'
        || step.type === 'control_timer')
        && !String(step.targetId || '').trim() && !String(step.target || '').trim()) {
        diagnostics.push('Step ' + (index + 1) + ' must select a target.');
      }
      if (step.type === 'run_alias' && !String(step.template || '').trim()) {
        diagnostics.push('Step ' + (index + 1) + ' must choose an alias command.');
      }
      if (step.type === 'call_function'
        && !String(step.targetId || '').trim() && !String(step.target || '').trim()) {
        diagnostics.push('Step ' + (index + 1) + ' must select a function.');
      }
    }

    return diagnostics;
  },

  describeTimer(timer) {
    if (!timer) return '';
    return formatTimerName(timer) + ' every ' + Math.round(timer.durationMs / 1000) + 's';
  },

  syncReconciliationSubscription,
};

registerTimerAutomation(timerManager);
