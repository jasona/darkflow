import { aliasManager, tokenizeInput } from './alias-manager.js';
import { triggerManager } from './trigger-manager.js';
import { functionManager } from './function-manager.js';
import { isKnownSound, soundManager } from './sound-manager.js';
import {
  evaluateArithmeticExpression,
  isArithmeticExpressionCandidate,
} from './alias-expression-core.mjs';
import {
  evaluateAutomationCondition,
  parseAutomationScript,
} from './automation-script-core.mjs';

let timerAutomation = null;
const MAX_WHILE_ITERATIONS = 100;
const MAX_WAIT_SECONDS = 24 * 60 * 60;

export function registerTimerAutomation(manager) {
  timerAutomation = manager || null;
}

function normalizeMode(mode) {
  return mode === 'enable' || mode === 'disable' ? mode : 'toggle';
}

function warn(appendMessage, prefix, message) {
  if (typeof appendMessage === 'function') {
    appendMessage(prefix + ': ' + message);
  }
}

function notify(appendMessage, prefix, message) {
  if (typeof appendMessage === 'function') {
    appendMessage(prefix + ': ' + message);
  }
}

function resolveAutomationValue(value, templateContext, options = {}) {
  if (!options.preservePositionalTokens) {
    return aliasManager.resolveTemplate(value, templateContext);
  }

  const placeholders = [];
  const protectedValue = String(value || '').replace(/%[0-9]/g, (match) => {
    const token = '\uE000' + placeholders.length + '\uE001';
    placeholders.push(match);
    return token;
  });
  const resolved = aliasManager.resolveTemplate(protectedValue, templateContext);

  return {
    ...resolved,
    text: resolved.text.replace(/\uE000([0-9]+)\uE001/g, (match, index) => (
      placeholders[Number(index)] || match
    )),
  };
}

function describeMode(mode) {
  if (mode === 'enable') return 'Enable';
  if (mode === 'disable') return 'Disable';
  return 'Toggle';
}

function describeTimerAction(mode) {
  if (mode === 'stop') return 'Stop';
  if (mode === 'reset') return 'Reset';
  if (mode === 'run') return 'Run';
  return 'Start';
}

function normalizeWaitSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(MAX_WAIT_SECONDS, number));
}

function waitResult(seconds, context) {
  const delayMs = Math.round(normalizeWaitSeconds(seconds) * 1000);
  if (delayMs <= 0) {
    return { sent: false, localOnly: true, handled: true };
  }
  const scheduleWaitFn = context && typeof context.scheduleWait === 'function'
    ? context.scheduleWait
    : null;
  if (scheduleWaitFn) {
    return {
      sent: false,
      localOnly: true,
      handled: true,
      pending: true,
      completion: scheduleWaitFn(delayMs),
    };
  }
  return {
    sent: false,
    localOnly: true,
    handled: true,
    pending: true,
    completion: new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }),
  };
}

function combineResults(one, two) {
  return {
    sent: Boolean((one && one.sent) || (two && two.sent)),
    localOnly: Boolean((one && one.localOnly) || (two && two.localOnly)),
    handled: Boolean((one && one.handled) || (two && two.handled)),
    pending: Boolean((one && one.pending) || (two && two.pending)),
    completion: two && two.completion ? two.completion : one && one.completion,
    control: two && two.control ? two.control : one && one.control,
  };
}

function getRequiredField(step) {
  if (step.type === 'wait') return 'seconds';
  if (step.type === 'set_alias_enabled'
    || step.type === 'set_trigger_enabled'
    || step.type === 'set_timer_enabled'
    || step.type === 'control_timer') {
    return 'target';
  }
  return 'template';
}

function getStepResult(step, source, templateContext, appendMessage) {
  const field = getRequiredField(step);
  const resolved = resolveAutomationValue(step[field], templateContext, {
    preservePositionalTokens: field === 'target',
  });
  const shouldWarn = step.type !== 'show_message';

  if (shouldWarn && resolved.missingVariables.length) {
    warn(
      appendMessage,
      source.prefix,
      'Missing variable'
      + (resolved.missingVariables.length === 1 ? '' : 's')
      + ' ' + resolved.missingVariables.map((name) => '$' + name).join(', ')
      + ' in ' + source.description + '.'
    );
    return { resolved, ok: false };
  }

  if (shouldWarn && resolved.errors.length) {
    warn(
      appendMessage,
      source.prefix,
      'Template error in ' + source.description + ': ' + resolved.errors.join(' ')
    );
    return { resolved, ok: false };
  }

  return { resolved, ok: true };
}

function maybeEvaluateSetValue(step, resolved, templateContext) {
  if (step.type !== 'set_variable') return resolved;
  const expression = String(resolved.text || '').trim();
  if (!isArithmeticExpressionCandidate(expression)) return resolved;

  const result = evaluateArithmeticExpression(expression, {
    ...templateContext,
    variables: {},
  });
  return {
    ...resolved,
    text: result.text,
    errors: [...resolved.errors, ...result.errors],
  };
}

function setAutomationEnabled(manager, target, mode, scopeKey) {
  if (mode === 'enable') return manager.setEnabledByTarget(target, true, scopeKey);
  if (mode === 'disable') return manager.setEnabledByTarget(target, false, scopeKey);
  return manager.toggleEnabledByTarget(target, scopeKey);
}

function setAutomationEnabledById(manager, id, mode, scopeKey) {
  if (mode === 'enable') return manager.setEnabledById(id, true, scopeKey);
  if (mode === 'disable') return manager.setEnabledById(id, false, scopeKey);
  return manager.toggleEnabledById(id, scopeKey);
}

function controlTimerById(manager, id, mode, scopeKey) {
  if (mode === 'stop') return manager.stopTimerById(id, scopeKey);
  if (mode === 'reset') return manager.resetTimerById(id, scopeKey);
  if (mode === 'run') return manager.runTimerById(id, scopeKey);
  return manager.startTimerById(id, scopeKey);
}

function controlTimerByTarget(manager, target, mode, scopeKey) {
  if (mode === 'stop') return manager.stopTimerByName(target, scopeKey);
  if (mode === 'reset') return manager.resetTimerByName(target, scopeKey);
  if (mode === 'run') return manager.runTimerByName(target, scopeKey);
  return manager.startTimerByName(target, scopeKey);
}

// Steps written by the picker UI reference their target by id; resolve those
// directly. Legacy steps (pattern text or templates) fall through to the
// template-resolution path below.
function executeTargetIdStep(step, context) {
  const { appendMessage, scopeKey, source } = context;
  if (step.type === 'set_timer_enabled' || step.type === 'control_timer') {
    if (!timerAutomation) {
      warn(appendMessage, source.prefix, 'Timer automation is not available.');
      return { sent: false, localOnly: true, handled: true };
    }

    const isEnableStep = step.type === 'set_timer_enabled';
    const mode = isEnableStep ? normalizeMode(step.mode)
      : (step.mode === 'stop' || step.mode === 'reset' || step.mode === 'run' ? step.mode : 'start');
    const result = isEnableStep
      ? setAutomationEnabledById(timerAutomation, step.targetId, mode, scopeKey)
      : controlTimerById(timerAutomation, step.targetId, mode, scopeKey);
    if (!result.target) {
      warn(appendMessage, source.prefix, 'Timer referenced by ' + source.description + ' no longer exists.');
      return { sent: false, localOnly: true, handled: true };
    }
    const label = step.type === 'set_timer_enabled' || step.type === 'control_timer'
      ? result.target.name
      : result.target.description || result.target.name;
    const action = isEnableStep
      ? (result.enabled ? 'enabled' : 'disabled')
      : (mode === 'stop' ? 'stopped' : mode === 'reset' ? 'reset' : mode === 'run' ? 'run' : 'started');
    notify(appendMessage, source.prefix, 'Timer "' + label + '" ' + action + '.');
    return { sent: false, localOnly: true, handled: true };
  }

  const isTrigger = step.type === 'set_trigger_enabled';
  const manager = isTrigger ? triggerManager : aliasManager;
  const noun = isTrigger ? 'Trigger' : 'Alias';

  const result = setAutomationEnabledById(manager, step.targetId, normalizeMode(step.mode), scopeKey);
  if (!result.target) {
    warn(appendMessage, source.prefix, noun + ' referenced by ' + source.description + ' no longer exists.');
    return { sent: false, localOnly: true, handled: true };
  }
  const label = result.target.description
    || (isTrigger ? result.target.pattern : result.target.trigger);
  notify(appendMessage, source.prefix, noun + ' "' + label + '" ' + (result.enabled ? 'enabled' : 'disabled') + '.');
  return { sent: false, localOnly: true, handled: true };
}

function refreshScriptVariables(context) {
  context.templateContext = {
    ...context.templateContext,
    variables: aliasManager.getAutomationVariables(context.scopeKey),
  };
}

function warnScriptDiagnostics(context, line, diagnostics) {
  if (!Array.isArray(diagnostics) || !diagnostics.length) return;
  diagnostics.forEach((message) => {
    warn(context.appendMessage, context.source.prefix, 'Script line ' + line + ': ' + message);
  });
}

function executeScriptNodes(nodes, context) {
  let sent = false;
  let localOnly = false;
  let handled = false;
  let control = null;

  const list = Array.isArray(nodes) ? nodes : [];

  for (let nodeIndex = 0; nodeIndex < list.length; nodeIndex++) {
    const node = list[nodeIndex];
    if (!node || typeof node !== 'object') continue;

    if (node.type === 'break' || node.type === 'continue') {
      return { sent, localOnly: true, handled: true, control: node.type };
    }

    if (node.type === 'action') {
      refreshScriptVariables(context);
      const result = executeAutomationStep(node.step, {
        ...context,
        source: {
          ...context.source,
          description: context.source.description + ' script line ' + node.line,
        },
      });
      sent = sent || result.sent;
      localOnly = localOnly || result.localOnly || result.handled;
      handled = handled || result.handled;
      if (result.pending && result.completion) {
        const partial = { sent, localOnly, handled: handled || localOnly || sent, pending: true };
        partial.completion = result.completion.then(() => {
          const rest = executeScriptNodes(list.slice(nodeIndex + 1), context);
          if (rest && rest.completion) return rest.completion.then((done) => combineResults(partial, done || rest));
          return combineResults(partial, rest);
        });
        return partial;
      }
      if (result.control) {
        return { sent, localOnly, handled: handled || localOnly || sent, control: result.control };
      }
      continue;
    }

    if (node.type === 'if') {
      let branchTaken = false;
      for (const branch of node.branches || []) {
        refreshScriptVariables(context);
        const condition = evaluateAutomationCondition(
          branch.condition,
          context.templateContext,
          (template, templateContext) => aliasManager.resolveTemplate(template, templateContext)
        );
        if (condition.diagnostics.length) {
          warnScriptDiagnostics(context, branch.line, condition.diagnostics);
        }
        if (!condition.value) continue;

        const result = executeScriptNodes(branch.steps, context);
        sent = sent || result.sent;
        localOnly = localOnly || result.localOnly || result.handled;
        handled = handled || result.handled;
        if (result.pending && result.completion) {
          const partial = { sent, localOnly, handled: handled || localOnly || sent, pending: true };
          partial.completion = result.completion.then(() => {
            const rest = executeScriptNodes(list.slice(nodeIndex + 1), context);
            if (rest && rest.completion) return rest.completion.then((done) => combineResults(partial, done || rest));
            return combineResults(partial, rest);
          });
          return partial;
        }
        if (result.control) {
          return { sent, localOnly, handled: handled || localOnly || sent, control: result.control };
        }
        branchTaken = true;
        break;
      }

      if (!branchTaken && Array.isArray(node.elseSteps)) {
        const result = executeScriptNodes(node.elseSteps, context);
        sent = sent || result.sent;
        localOnly = localOnly || result.localOnly || result.handled;
        handled = handled || result.handled;
        if (result.pending && result.completion) {
          const partial = { sent, localOnly, handled: handled || localOnly || sent, pending: true };
          partial.completion = result.completion.then(() => {
            const rest = executeScriptNodes(list.slice(nodeIndex + 1), context);
            if (rest && rest.completion) return rest.completion.then((done) => combineResults(partial, done || rest));
            return combineResults(partial, rest);
          });
          return partial;
        }
        if (result.control) {
          return { sent, localOnly, handled: handled || localOnly || sent, control: result.control };
        }
      }
      continue;
    }

    if (node.type === 'while') {
      let iterations = 0;
      while (true) {
        refreshScriptVariables(context);
        const condition = evaluateAutomationCondition(
          node.condition,
          context.templateContext,
          (template, templateContext) => aliasManager.resolveTemplate(template, templateContext)
        );
        if (condition.diagnostics.length) {
          warnScriptDiagnostics(context, node.line, condition.diagnostics);
          handled = true;
          break;
        }
        if (!condition.value) break;

        iterations++;
        if (iterations > MAX_WHILE_ITERATIONS) {
          warn(
            context.appendMessage,
            context.source.prefix,
            'While loop iteration limit of ' + MAX_WHILE_ITERATIONS + ' reached in ' + context.source.description + '.'
          );
          return { sent, localOnly: true, handled: true, control: 'abort' };
        }

        const result = executeScriptNodes(node.steps, context);
        sent = sent || result.sent;
        localOnly = localOnly || result.localOnly || result.handled;
        handled = handled || result.handled;
        control = result.control || null;
        if (result.pending && result.completion) {
          const partial = { sent, localOnly, handled: handled || localOnly || sent, pending: true };
          partial.completion = result.completion.then(() => {
            const resumed = executeScriptNodes([{ ...node, line: node.line }], context);
            if (resumed && resumed.completion) return resumed.completion.then((done) => {
              if (done && done.control) return combineResults(partial, done);
              const rest = executeScriptNodes(list.slice(nodeIndex + 1), context);
              if (rest && rest.completion) return rest.completion.then((doneRest) => combineResults(combineResults(partial, done), doneRest || rest));
              return combineResults(combineResults(partial, done), rest);
            });
            if (resumed && resumed.control) return combineResults(partial, resumed);
            const rest = executeScriptNodes(list.slice(nodeIndex + 1), context);
            if (rest && rest.completion) return rest.completion.then((doneRest) => combineResults(combineResults(partial, resumed), doneRest || rest));
            return combineResults(combineResults(partial, resumed), rest);
          });
          return partial;
        }
        if (control === 'break') break;
        if (control === 'continue') continue;
        if (control) return { sent, localOnly, handled: handled || localOnly || sent, control };
      }
    }
  }

  return { sent, localOnly, handled: handled || localOnly || sent };
}

function executeScriptStep(step, context) {
  const parsed = parseAutomationScript(step.script || '');
  if (parsed.diagnostics.length) {
    parsed.diagnostics.forEach((message) => {
      warn(context.appendMessage, context.source.prefix, 'Script error in ' + context.source.description + ': ' + message);
    });
    return { sent: false, localOnly: true, handled: true };
  }

  return executeScriptNodes(parsed.ast, context);
}

function executeFunctionStep(step, context) {
  const {
    appendMessage,
    scopeKey,
    templateContext,
    source,
    functionContext,
  } = context;
  const targetId = String(step.targetId || '');
  let fn = targetId ? functionManager.findFunctionById(targetId, scopeKey) : null;
  let targetName = String(step.target || '').trim();

  if (!fn && targetName) {
    const resolvedTarget = resolveAutomationValue(targetName, templateContext, { preservePositionalTokens: true });
    if (resolvedTarget.missingVariables.length || resolvedTarget.errors.length) {
      warn(appendMessage, source.prefix, 'Unable to resolve function target in ' + source.description + '.');
      return { sent: false, localOnly: true, handled: true };
    }
    targetName = resolvedTarget.text.trim();
    fn = functionManager.findFunctionByName(targetName, scopeKey);
  }

  if (!fn) {
    warn(appendMessage, source.prefix, 'Function "' + (targetName || targetId || 'unknown') + '" is not defined.');
    return { sent: false, localOnly: true, handled: true };
  }

  if (fn.enabled === false) {
    warn(appendMessage, source.prefix, 'Function "' + fn.name + '" is disabled.');
    return { sent: false, localOnly: true, handled: true };
  }

  const currentFunctionContext = functionContext || { depth: 0, trail: [] };
  const depth = currentFunctionContext.depth || 0;
  const trail = Array.isArray(currentFunctionContext.trail) ? currentFunctionContext.trail : [];
  if (depth >= functionManager.getMaxFunctionDepth()) {
    warn(appendMessage, source.prefix, 'Function depth limit reached while calling "' + fn.name + '".');
    return { sent: false, localOnly: true, handled: true };
  }
  if (trail.includes(fn.id)) {
    warn(appendMessage, source.prefix, 'Function recursion detected for "' + fn.name + '".');
    return { sent: false, localOnly: true, handled: true };
  }

  const resolvedArgs = resolveAutomationValue(step.template || '', templateContext);
  if (resolvedArgs.missingVariables.length || resolvedArgs.errors.length) {
    warn(appendMessage, source.prefix, 'Template error in function call "' + fn.name + '".');
    return { sent: false, localOnly: true, handled: true };
  }

  const argText = resolvedArgs.text.trim();
  const args = tokenizeInput(argText).map((token) => token.value);
  const parsed = parseAutomationScript(fn.script || '');
  if (parsed.diagnostics.length) {
    parsed.diagnostics.forEach((message) => {
      warn(appendMessage, source.prefix, 'Script error in function "' + fn.name + '": ' + message);
    });
    return { sent: false, localOnly: true, handled: true };
  }

  return executeScriptNodes(parsed.ast, {
    ...context,
    templateContext: {
      args,
      remainder: argText,
      variables: aliasManager.getAutomationVariables(scopeKey),
    },
    source: {
      prefix: source.prefix,
      description: 'function "' + fn.name + '"',
    },
    functionContext: {
      depth: depth + 1,
      trail: [...trail, fn.id],
    },
  });
}

function executeAutomationStep(step, context) {
  const {
    appendMessage,
    sendCommand,
    scopeKey,
    templateContext,
    source,
    aliasContext,
    expandCommandsAsAliases,
  } = context;

  if (step.type === 'script') {
    return executeScriptStep(step, context);
  }

  if (step.type === 'call_function') {
    return executeFunctionStep(step, context);
  }

  if (step.type === 'play_sound') {
    if (!isKnownSound(step.category, step.sound)) {
      warn(appendMessage, source.prefix, 'Sound "' + [step.category, step.sound].filter(Boolean).join('/') + '" is not defined.');
      return { sent: false, localOnly: true, handled: true };
    }
    soundManager.play(step.category, step.sound, step.volume);
    return { sent: false, localOnly: true, handled: true };
  }

  if ((step.type === 'set_trigger_enabled' || step.type === 'set_alias_enabled')
    && String(step.targetId || '')) {
    return executeTargetIdStep(step, context);
  }

  if ((step.type === 'set_timer_enabled' || step.type === 'control_timer')
    && String(step.targetId || '')) {
    return executeTargetIdStep(step, context);
  }

  let { resolved, ok } = getStepResult(step, source, templateContext, appendMessage);
  if (!ok) return { sent: false, localOnly: true, handled: true };
  resolved = maybeEvaluateSetValue(step, resolved, templateContext);
  if (resolved.errors.length) {
    warn(appendMessage, source.prefix, 'Template error in ' + source.description + ': ' + resolved.errors.join(' '));
    return { sent: false, localOnly: true, handled: true };
  }

  if (step.type === 'wait') {
    return waitResult(resolved.text, context);
  }

  if (step.type === 'set_variable') {
    const didSet = aliasManager.setVariable(step.name, resolved.text, scopeKey);
    return { sent: false, localOnly: didSet, handled: true };
  }

  if (step.type === 'show_message') {
    if (typeof appendMessage === 'function') appendMessage(resolved.text);
    return { sent: false, localOnly: true, handled: true };
  }

  if (step.type === 'set_trigger_enabled') {
    const target = resolved.text.trim();
    if (!target) {
      warn(appendMessage, source.prefix, 'Trigger target is empty in ' + source.description + '.');
      return { sent: false, localOnly: true, handled: true };
    }
    const result = setAutomationEnabled(triggerManager, target, normalizeMode(step.mode), scopeKey);
    if (!result.target) {
      warn(appendMessage, source.prefix, 'Trigger "' + target + '" is not defined.');
      return { sent: false, localOnly: true, handled: true };
    }
    notify(appendMessage, source.prefix, 'Trigger "' + target + '" ' + (result.enabled ? 'enabled' : 'disabled') + '.');
    return { sent: false, localOnly: true, handled: true };
  }

  if (step.type === 'set_alias_enabled') {
    const target = resolved.text.trim();
    if (!target) {
      warn(appendMessage, source.prefix, 'Alias target is empty in ' + source.description + '.');
      return { sent: false, localOnly: true, handled: true };
    }
    const result = setAutomationEnabled(aliasManager, target, normalizeMode(step.mode), scopeKey);
    if (!result.target) {
      warn(appendMessage, source.prefix, 'Alias "' + target + '" is not defined.');
      return { sent: false, localOnly: true, handled: true };
    }
    notify(appendMessage, source.prefix, 'Alias "' + target + '" ' + (result.enabled ? 'enabled' : 'disabled') + '.');
    return { sent: false, localOnly: true, handled: true };
  }

  if (step.type === 'set_timer_enabled') {
    if (!timerAutomation) {
      warn(appendMessage, source.prefix, 'Timer automation is not available.');
      return { sent: false, localOnly: true, handled: true };
    }
    const target = resolved.text.trim();
    if (!target) {
      warn(appendMessage, source.prefix, 'Timer target is empty in ' + source.description + '.');
      return { sent: false, localOnly: true, handled: true };
    }
    const result = setAutomationEnabled(timerAutomation, target, normalizeMode(step.mode), scopeKey);
    if (!result.target) {
      warn(appendMessage, source.prefix, 'Timer "' + target + '" is not defined.');
      return { sent: false, localOnly: true, handled: true };
    }
    notify(appendMessage, source.prefix, 'Timer "' + target + '" ' + (result.enabled ? 'enabled' : 'disabled') + '.');
    return { sent: false, localOnly: true, handled: true };
  }

  if (step.type === 'control_timer') {
    if (!timerAutomation) {
      warn(appendMessage, source.prefix, 'Timer automation is not available.');
      return { sent: false, localOnly: true, handled: true };
    }
    const target = resolved.text.trim();
    const mode = step.mode === 'stop' || step.mode === 'reset' || step.mode === 'run' ? step.mode : 'start';
    if (!target) {
      warn(appendMessage, source.prefix, 'Timer target is empty in ' + source.description + '.');
      return { sent: false, localOnly: true, handled: true };
    }
    const result = controlTimerByTarget(timerAutomation, target, mode, scopeKey);
    if (!result.target) {
      warn(appendMessage, source.prefix, 'Timer "' + target + '" is not defined or is disabled.');
      return { sent: false, localOnly: true, handled: true };
    }
    notify(appendMessage, source.prefix, 'Timer "' + target + '" '
      + (mode === 'stop' ? 'stopped' : mode === 'reset' ? 'reset' : mode === 'run' ? 'run' : 'started') + '.');
    return { sent: false, localOnly: true, handled: true };
  }

  const command = resolved.text.trim();
  if (!command) return { sent: false, localOnly: false, handled: true };

  if (step.type === 'run_alias') {
    return executeAliasLine(command, {
      appendMessage,
      sendCommand,
      scopeKey,
      depth: aliasContext ? aliasContext.depth : 0,
      trail: aliasContext ? aliasContext.trail : [],
      isRoot: false,
      aliasOnly: true,
      warningPrefix: source.prefix,
    });
  }

  if (expandCommandsAsAliases) {
    return executeAliasLine(command, {
      appendMessage,
      sendCommand,
      scopeKey,
      depth: aliasContext ? aliasContext.depth : 0,
      trail: aliasContext ? aliasContext.trail : [],
      isRoot: false,
    });
  }

  if (typeof sendCommand !== 'function' || !sendCommand(command)) {
    warn(appendMessage, source.prefix, 'Unable to send "' + command + '" because you are not connected.');
    return { sent: false, localOnly: true, handled: true };
  }

  return { sent: true, localOnly: false, handled: true };
}

export function executeAutomationSteps(steps, context = {}) {
  let sent = false;
  let localOnly = false;
  let handled = false;
  const list = Array.isArray(steps) ? steps : [];

  for (let index = 0; index < list.length; index++) {
    const step = list[index];
    const result = executeAutomationStep(step, context);
    sent = sent || result.sent;
    localOnly = localOnly || result.localOnly || result.handled;
    handled = handled || result.handled;
    if (result.pending && result.completion) {
      const partial = { sent, localOnly, handled, pending: true };
      partial.completion = result.completion.then(() => {
        const rest = executeAutomationSteps(list.slice(index + 1), context);
        if (rest && rest.completion) return rest.completion.then((done) => combineResults(partial, done || rest));
        return combineResults(partial, rest);
      });
      return partial;
    }
  }

  return { sent, localOnly, handled };
}

export function executeAliasLine(text, context = {}) {
  const scopeKey = context.scopeKey || aliasManager.getActiveScopeKey();
  const depth = context.depth || 0;
  const trail = Array.isArray(context.trail) ? context.trail : [];
  const isRoot = context.isRoot === true;
  const aliasOnly = context.aliasOnly === true;
  const appendMessage = context.appendMessage;
  const sendCommand = context.sendCommand;
  const warningPrefix = context.warningPrefix || 'Alias';
  const match = aliasManager.matchAlias(text, scopeKey);
  let sent = false;
  let localOnly = false;
  let handled = false;

  if (!match) {
    if (aliasOnly) {
      warn(appendMessage, warningPrefix, 'Alias "' + String(text || '').trim() + '" is not defined or is disabled.');
      return { sent: false, localOnly: true, handled: false };
    }

    if (typeof sendCommand !== 'function' || !sendCommand(text)) {
      if (!isRoot) {
        warn(appendMessage, warningPrefix, 'Unable to send "' + text + '" because you are not connected.');
      }
      return { sent: false, localOnly: false, handled: false };
    }
    return { sent: true, localOnly: false, handled: false };
  }

  handled = true;

  if (depth >= aliasManager.getMaxAliasDepth()) {
    warn(appendMessage, warningPrefix, 'Alias depth limit reached while expanding "' + match.alias.trigger + '".');
    return { sent: false, localOnly: true, handled: true };
  }

  if (trail.includes(match.alias.id)) {
    warn(appendMessage, warningPrefix, 'Alias recursion detected for "' + match.alias.trigger + '".');
    return { sent: false, localOnly: true, handled: true };
  }

  for (let index = 0; index < match.alias.steps.length; index++) {
    const step = match.alias.steps[index];
    const variables = aliasManager.getAutomationVariables(scopeKey);
    const result = executeAutomationStep(step, {
      appendMessage,
      sendCommand,
      scopeKey,
      templateContext: {
        args: match.args,
        remainder: match.remainder,
        variables,
      },
      source: {
        prefix: warningPrefix,
        description: 'alias "' + match.alias.trigger + '"',
      },
      aliasContext: {
        depth: depth + 1,
        trail: [...trail, match.alias.id],
      },
      expandCommandsAsAliases: true,
    });

    sent = sent || result.sent;
    localOnly = localOnly || result.localOnly || result.handled;
    if (result.pending && result.completion) {
      const partial = { sent, localOnly, handled, pending: true };
      partial.completion = result.completion.then(() => {
        const continuationAlias = {
          ...match.alias,
          steps: match.alias.steps.slice(index + 1),
        };
        const continuationResult = executeAutomationSteps(continuationAlias.steps, {
          appendMessage,
          sendCommand,
          scopeKey,
          templateContext: {
            args: match.args,
            remainder: match.remainder,
            variables: aliasManager.getAutomationVariables(scopeKey),
          },
          source: {
            prefix: warningPrefix,
            description: 'alias "' + match.alias.trigger + '"',
          },
          aliasContext: {
            depth: depth + 1,
            trail: [...trail, match.alias.id],
          },
          expandCommandsAsAliases: true,
        });
        if (continuationResult && continuationResult.completion) {
          return continuationResult.completion.then((done) => combineResults(partial, done || continuationResult));
        }
        return combineResults(partial, continuationResult);
      });
      return partial;
    }
  }

  return { sent, localOnly, handled };
}

export function executeTriggerMatches(matches, scopeKey, options = {}) {
  if (!Array.isArray(matches) || !matches.length) return;

  const appendMessage = options.appendMessage;
  const sendCommand = options.sendCommand;

  for (const match of matches) {
    const executionContext = {
      appendMessage,
      sendCommand,
      scopeKey,
      templateContext: {
        args: match.captures,
        remainder: match.fullMatch,
        variables: aliasManager.getAutomationVariables(scopeKey),
      },
      source: {
        prefix: 'Trigger',
        description: 'pattern "' + match.trigger.pattern + '"',
      },
      aliasContext: {
        depth: 0,
        trail: [],
      },
    };
    if (typeof options.scheduleWait === 'function') {
      executionContext.scheduleWait = options.scheduleWait;
    }
    executeAutomationSteps(match.trigger.steps || [], executionContext);
  }
}

export function getAutomationStepLabel(step) {
  if (!step || typeof step !== 'object') return 'Step';
  if (step.type === 'script') return 'Run script';
  if (step.type === 'set_variable') return 'Set $' + (step.name || '');
  if (step.type === 'show_message') return 'Show';
  if (step.type === 'set_trigger_enabled') return describeMode(normalizeMode(step.mode)) + ' trigger';
  if (step.type === 'set_alias_enabled') return describeMode(normalizeMode(step.mode)) + ' alias';
  if (step.type === 'set_timer_enabled') return describeMode(normalizeMode(step.mode)) + ' timer';
  if (step.type === 'control_timer') return describeTimerAction(step.mode) + ' timer';
  if (step.type === 'run_alias') return 'Run alias';
  if (step.type === 'call_function') return 'Call function';
  if (step.type === 'play_sound') return 'Play sound';
  if (step.type === 'wait') return 'Wait';
  return 'Send';
}
