import { state, dom } from './state.js';
import { appendEcho, appendSystemMessage, clearOutput } from './output.js';
import { MAX_HISTORY, HISTORY_STORAGE_KEY, LEGACY_SESSION_KEY } from './constants.js';
import { trackCommand } from './map-data.js';
import { initCompletion, requestCompletion, resetCompletionState } from './completion.js';
import { settingsManager } from './settings-manager.js';
import { sendSocketPayload } from './connection.js';
import { aliasManager, tokenizeInput } from './alias-manager.js';
import { highlightManager } from './highlight-manager.js';
import { triggerManager } from './trigger-manager.js';
import { gmcp } from './gmcp.js';
import { panelManager } from './panel-manager.js';
import { exitSplitScrollback, scrollActiveOutputByPage } from './output.js';

let commandHistory = [];
let historyIndex = 0;
let currentInput = '';
let _saveTimer = null;

const DIRECTION_ALIASES = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  u: 'up',
  d: 'down',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
};

function normalizeOutboundCommand(text) {
  const command = String(text || '');
  const trimmed = command.trim().toLowerCase();
  return DIRECTION_ALIASES[trimmed] || command;
}

function previewOutboundCommand(text) {
  const preview = String(text || '').replace(/\s+/g, ' ').trim();
  if (!preview) return '(empty command)';
  return preview.length > 80 ? preview.slice(0, 77) + '...' : preview;
}

function warnDisconnectedSend(text) {
  if (state.disconnectedSendWarningShown) return;
  state.disconnectedSendWarningShown = true;
  appendSystemMessage('Not connected — message not sent: ' + previewOutboundCommand(text));
}

function sendRawCommand(text) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    warnDisconnectedSend(text);
    return false;
  }

  const command = normalizeOutboundCommand(text);

  trackCommand(command);
  if (!sendSocketPayload(command, {
    kind: 'command',
    size: command.length,
    preview: command.slice(0, 80),
  })) {
    return false;
  }
  state.bytesSent += command.length;
  return true;
}

export function sendAutomaticCommand(text, options = {}) {
  const command = String(text || '');
  if (!sendRawCommand(command)) return false;

  if (options.echo !== false) {
    appendEcho(command);
  }

  return true;
}

function pushHistory(text) {
  if (!text) return;
  commandHistory.push(text);
  if (commandHistory.length > MAX_HISTORY) {
    commandHistory = commandHistory.slice(-MAX_HISTORY);
  }
  saveHistory();
}

function finishSubmittedInput(text) {
  resetCompletionState();
  historyIndex = commandHistory.length;
  currentInput = '';
  dom.commandInput.focus();

  if (settingsManager.get('repeatLastCommand')) {
    dom.commandInput.value = text;
    dom.commandInput.select();
  } else {
    dom.commandInput.value = '';
  }
}

function appendAliasWarning(message) {
  appendSystemMessage('Alias: ' + message);
}

function appendHighlightWarning(message) {
  appendSystemMessage('Highlight: ' + message);
}

function appendTriggerWarning(message) {
  appendSystemMessage('Trigger: ' + message);
}

function formatAliasVariableValue(value) {
  const text = String(value ?? '');
  return /\s/.test(text) ? '"' + text.replace(/"/g, '\\"') + '"' : text;
}

function formatAliasStepTemplate(template) {
  const text = String(template ?? '');
  return /\s/.test(text) ? '"' + text.replace(/"/g, '\\"') + '"' : text;
}

function parseBraceArguments(text, command) {
  const prefix = '/' + command;
  const remainder = String(text || '').trim().slice(prefix.length).trim();
  if (!remainder) return [];

  const values = [];
  let index = 0;

  while (index < remainder.length) {
    while (index < remainder.length && /\s/.test(remainder[index])) index++;
    if (index >= remainder.length) break;
    if (remainder[index] !== '{') return null;

    index++;
    let value = '';
    let depth = 1;

    while (index < remainder.length) {
      const ch = remainder[index];
      if (ch === '{') {
        depth++;
        value += ch;
        index++;
        continue;
      }
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          index++;
          break;
        }
        value += ch;
        index++;
        continue;
      }
      value += ch;
      index++;
    }

    if (depth !== 0) return null;
    values.push(value);
  }

  return values;
}

function handleAliasSlashCommand(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) return null;

  const tokens = tokenizeInput(trimmed);
  if (!tokens.length) return null;

  const command = tokens[0].lower;
  const scopeKey = aliasManager.getActiveScopeKey();

  if (command === '/vars') {
    const scope = aliasManager.getScopeSnapshot(scopeKey);
    const entries = Object.entries(scope.variables).sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) {
      appendSystemMessage('Alias vars: none set for this server.');
    } else {
      appendSystemMessage(
        'Alias vars: ' + entries.map(([name, value]) => '$' + name + '=' + formatAliasVariableValue(value)).join(', ')
      );
    }
    return { handled: true, localOnly: true };
  }

  if (command === '/var' || command === '/variable') {
    const name = tokens[1] ? tokens[1].value : '';
    if (!name) {
      appendAliasWarning('Usage: /var <name> <value>, /var <name>, or /vars');
      return { handled: true, localOnly: true };
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      appendAliasWarning('Variable names must start with a letter or underscore and use only letters, digits, and underscores.');
      return { handled: true, localOnly: true };
    }

    if (!tokens[2]) {
      const existing = aliasManager.getVariable(name, scopeKey);
      if (existing === undefined) {
        appendSystemMessage('Alias var: $' + name + ' is not set.');
      } else {
        appendSystemMessage('Alias var: $' + name + ' = ' + formatAliasVariableValue(existing));
      }
      return { handled: true, localOnly: true };
    }

    const value = tokens.slice(2).map((token) => token.value).join(' ');
    aliasManager.setVariable(name, value, scopeKey);
    appendSystemMessage('Alias var set: $' + name + ' = ' + formatAliasVariableValue(value));
    return { handled: true, localOnly: true };
  }

  if (command === '/alias') {
    const scope = aliasManager.getScopeSnapshot(scopeKey);
    const trigger = tokens[1] ? tokens[1].value : '';

    if (!trigger) {
      const aliases = scope.aliases
        .slice()
        .sort((a, b) => a.trigger.localeCompare(b.trigger));
      if (!aliases.length) {
        appendSystemMessage('Aliases: none set for this server.');
      } else {
        appendSystemMessage(
          'Aliases: ' + aliases.map((alias) => alias.trigger).join(', ')
        );
      }
      return { handled: true, localOnly: true };
    }

    if (!tokens[2]) {
      const alias = aliasManager.findAliasByTrigger(trigger, scopeKey);
      if (!alias) {
        appendSystemMessage('Alias: "' + trigger + '" is not defined.');
        return { handled: true, localOnly: true };
      }

      if (alias.steps.length === 1 && alias.steps[0].type === 'send_command') {
        appendSystemMessage(
          'Alias: ' + alias.trigger + ' -> ' + formatAliasStepTemplate(alias.steps[0].template)
        );
      } else {
        appendSystemMessage(
          'Alias: ' + alias.trigger + ' is defined with ' + alias.steps.length + ' step'
          + (alias.steps.length === 1 ? '' : 's')
          + '. Edit it in Settings for full details.'
        );
      }
      return { handled: true, localOnly: true };
    }

    const template = tokens.slice(2).map((token) => token.value).join(' ').trim();
    if (!template) {
      appendAliasWarning('Usage: /alias <trigger> <command>');
      return { handled: true, localOnly: true };
    }

    aliasManager.upsertSimpleAlias(trigger, template, scopeKey);
    appendSystemMessage(
      'Alias set: ' + trigger + ' -> ' + formatAliasStepTemplate(template)
    );
    return { handled: true, localOnly: true };
  }

  if (command === '/highlight') {
    const scope = highlightManager.getScopeSnapshot(scopeKey);
    const args = parseBraceArguments(trimmed, 'highlight');
    if (args === null) {
      appendHighlightWarning('Usage: /highlight {pattern} {foreground [b] background}');
      return { handled: true, localOnly: true };
    }

    if (!args.length) {
      const rules = scope.rules.slice();
      if (!rules.length) {
        appendSystemMessage('Highlights: none set for this server.');
      } else {
        appendSystemMessage(
          'Highlights: ' + rules.map((rule) => highlightManager.describeRule(rule)).join(' | ')
        );
      }
      return { handled: true, localOnly: true };
    }

    if (args.length === 1) {
      const rule = highlightManager.findRuleByPattern(args[0], scopeKey);
      if (!rule) {
        appendSystemMessage('Highlight: "' + args[0] + '" is not defined.');
      } else {
        appendSystemMessage('Highlight: ' + highlightManager.describeRule(rule));
      }
      return { handled: true, localOnly: true };
    }

    const result = highlightManager.upsertSimpleRule(args[0], args[1], scopeKey);
    if (result.error) {
      appendHighlightWarning(result.error);
    } else {
      appendSystemMessage('Highlight set: ' + highlightManager.describeRule(result.rule));
    }
    return { handled: true, localOnly: true };
  }

  if (command === '/trigger') {
    const scope = triggerManager.getScopeSnapshot(scopeKey);
    const args = parseBraceArguments(trimmed, 'trigger');
    if (args === null) {
      appendTriggerWarning('Usage: /trigger {pattern} {command}');
      return { handled: true, localOnly: true };
    }

    if (!args.length) {
      const triggers = scope.triggers.slice();
      if (!triggers.length) {
        appendSystemMessage('Triggers: none set for this server.');
      } else {
        appendSystemMessage(
          'Triggers: ' + triggers.map((trigger) => triggerManager.describeTrigger(trigger)).join(' | ')
        );
      }
      return { handled: true, localOnly: true };
    }

    if (args.length === 1) {
      const trigger = triggerManager.findTriggerByPattern(args[0], scopeKey);
      if (!trigger) {
        appendSystemMessage('Trigger: "' + args[0] + '" is not defined.');
      } else {
        appendSystemMessage('Trigger: ' + triggerManager.describeTrigger(trigger));
      }
      return { handled: true, localOnly: true };
    }

    const result = triggerManager.upsertSimpleTrigger(args[0], args[1], scopeKey);
    if (result.error) {
      appendTriggerWarning(result.error);
    } else {
      appendSystemMessage('Trigger set: ' + triggerManager.describeTrigger(result.trigger));
    }
    return { handled: true, localOnly: true };
  }

  if (command === '/unvar' || command === '/unsetvar' || command === '/unsetvariable') {
    const name = tokens[1] ? tokens[1].value : '';
    if (!name) {
      appendAliasWarning('Usage: /unvar <name>');
      return { handled: true, localOnly: true };
    }

    const existing = aliasManager.getVariable(name, scopeKey);
    if (existing === undefined) {
      appendSystemMessage('Alias var: $' + name + ' was not set.');
    } else {
      aliasManager.removeVariable(name, scopeKey);
      appendSystemMessage('Alias var cleared: $' + name);
    }
    return { handled: true, localOnly: true };
  }

  if (command === '/unalias') {
    const trigger = tokens[1] ? tokens[1].value : '';
    if (!trigger) {
      appendAliasWarning('Usage: /unalias <trigger>');
      return { handled: true, localOnly: true };
    }

    if (!aliasManager.removeAliasByTrigger(trigger, scopeKey)) {
      appendSystemMessage('Alias: "' + trigger + '" was not defined.');
    } else {
      appendSystemMessage('Alias cleared: ' + trigger);
    }
    return { handled: true, localOnly: true };
  }

  if (command === '/unhighlight') {
    const args = parseBraceArguments(trimmed, 'unhighlight');
    if (args === null || args.length !== 1) {
      appendHighlightWarning('Usage: /unhighlight {pattern}');
      return { handled: true, localOnly: true };
    }

    if (!highlightManager.removeRuleByPattern(args[0], scopeKey)) {
      appendSystemMessage('Highlight: "' + args[0] + '" was not defined.');
    } else {
      appendSystemMessage('Highlight cleared: ' + args[0]);
    }
    return { handled: true, localOnly: true };
  }

  if (command === '/untrigger') {
    const args = parseBraceArguments(trimmed, 'untrigger');
    if (args === null || args.length !== 1) {
      appendTriggerWarning('Usage: /untrigger {pattern}');
      return { handled: true, localOnly: true };
    }

    if (!triggerManager.removeTriggerByPattern(args[0], scopeKey)) {
      appendSystemMessage('Trigger: "' + args[0] + '" was not defined.');
    } else {
      appendSystemMessage('Trigger cleared: ' + args[0]);
    }
    return { handled: true, localOnly: true };
  }

  return null;
}

function executeAliasLine(text, context = {}) {
  const scopeKey = context.scopeKey || aliasManager.getActiveScopeKey();
  const depth = context.depth || 0;
  const trail = Array.isArray(context.trail) ? context.trail : [];
  const isRoot = context.isRoot === true;
  const match = aliasManager.matchAlias(text, scopeKey);
  let sent = false;
  let localOnly = false;
  let handled = false;

  if (!match) {
    if (!sendRawCommand(text)) {
      if (!isRoot) {
        appendAliasWarning('Unable to send "' + text + '" because you are not connected.');
      }
      return { sent: false, localOnly: false, handled: false };
    }
    return { sent: true, localOnly: false, handled: false };
  }

  handled = true;

  if (depth >= aliasManager.getMaxAliasDepth()) {
    appendAliasWarning('Alias depth limit reached while expanding "' + match.alias.trigger + '".');
    return { sent: false, localOnly: true, handled: true };
  }

  if (trail.includes(match.alias.id)) {
    appendAliasWarning('Alias recursion detected for "' + match.alias.trigger + '".');
    return { sent: false, localOnly: true, handled: true };
  }

  for (const step of match.alias.steps) {
    const variables = aliasManager.getScopeSnapshot(scopeKey).variables;
    const resolved = aliasManager.resolveTemplate(step.template, {
      args: match.args,
      remainder: match.remainder,
      variables,
    });

    if ((step.type === 'send_command' || step.type === 'set_variable') && resolved.missingVariables.length) {
      appendAliasWarning(
        'Missing variable' + (resolved.missingVariables.length === 1 ? '' : 's') + ' '
        + resolved.missingVariables.map((name) => '$' + name).join(', ')
        + ' in alias "' + match.alias.trigger + '".'
      );
      localOnly = true;
      continue;
    }

    if (step.type === 'set_variable') {
      if (aliasManager.setVariable(step.name, resolved.text, scopeKey)) {
        localOnly = true;
      }
      continue;
    }

    if (step.type === 'show_message') {
      appendSystemMessage(resolved.text);
      localOnly = true;
      continue;
    }

    const nextText = resolved.text.trim();
    if (!nextText) continue;
    const result = executeAliasLine(nextText, {
      scopeKey,
      depth: depth + 1,
      trail: [...trail, match.alias.id],
      isRoot: false,
    });
    sent = sent || result.sent;
    localOnly = localOnly || result.localOnly || result.handled;
  }

  return { sent, localOnly, handled };
}

export function sendCommandText(text) {
  const trimmed = String(text || '');
  const slashCommandResult = handleAliasSlashCommand(trimmed);
  const aliasResult = slashCommandResult || executeAliasLine(trimmed, { isRoot: true });

  if (!aliasResult.handled && !aliasResult.sent) return false;

  pushHistory(trimmed);
  appendEcho(trimmed);
  finishSubmittedInput(trimmed);
  return aliasResult.sent || aliasResult.localOnly || aliasResult.handled;
}

function getMappedCommand(event) {
  if (!settingsManager.get('keyMapperEnabled')) return null;

  const mappings = settingsManager.get('keyMappings');
  if (!Array.isArray(mappings) || mappings.length === 0) return null;

  for (let index = mappings.length - 1; index >= 0; index--) {
    const mapping = mappings[index];
    if (!mapping || !mapping.command) continue;
    if (mapping.code && mapping.code === event.code) return mapping.command;
    if (!mapping.code && mapping.legacyKey && mapping.legacyKey === event.key) return mapping.command;
    if (mapping.legacyKey && mapping.legacyKey === event.key) return mapping.command;
  }

  return null;
}

function isBlockedEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target === dom.commandInput) return false;
  if (target.closest('.ide-overlay, .cm-editor, .cm-content')) return true;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

function handleMappedKey(event) {
  if (event.defaultPrevented || event.repeat) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;

  const command = getMappedCommand(event);
  if (!command) return false;
  if (isBlockedEditableTarget(event.target)) return false;

  event.preventDefault();
  event.stopPropagation();
  sendCommandText(command);
  return true;
}

export function loadHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (stored) {
      commandHistory = JSON.parse(stored);
    } else {
      const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
      if (legacy) {
        commandHistory = JSON.parse(legacy);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(commandHistory));
      }
    }
  } catch(e) { /* ignore */ }
  historyIndex = commandHistory.length;
}

export function saveHistory() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(commandHistory));
    } catch(e) { /* ignore */ }
  }, 500);
}

export function saveHistoryNow() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(commandHistory));
  } catch(e) { /* ignore */ }
}

export function sendCommand() {
  return sendCommandText(dom.commandInput.value);
}

export function initInput() {
  initCompletion();

  dom.commandInput.addEventListener('keydown', function(e) {
    if (handleMappedKey(e)) {
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      sendCommand();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      requestCompletion(commandHistory);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      resetCompletionState();
      if (commandHistory.length === 0) return;
      if (historyIndex === commandHistory.length) {
        currentInput = dom.commandInput.value;
      }
      if (historyIndex > 0) {
        historyIndex--;
        dom.commandInput.value = commandHistory[historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      resetCompletionState();
      if (historyIndex < commandHistory.length) {
        historyIndex++;
        if (historyIndex === commandHistory.length) {
          dom.commandInput.value = currentInput;
        } else {
          dom.commandInput.value = commandHistory[historyIndex];
        }
      }
    } else if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') {
      resetCompletionState();
    }
  });

  dom.sendBtn.addEventListener('click', sendCommand);

  dom.outputShell.addEventListener('click', function(event) {
    if (!(event.target instanceof HTMLElement)) return;
    if (!event.target.closest('.output-pane')) return;
    if (!window.getSelection().toString()) {
      dom.commandInput.focus();
    }
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.defaultPrevented) return;
    if (isBlockedEditableTarget(e.target)) return;

    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      clearOutput();
    } else if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      panelManager.resetData({ preservePanels: ['chat'] });
      if (gmcp.restartHandshake({ panels: panelManager.getSubscriptionPanels() })) {
        panelManager.refreshMediaPanels();
      }
    } else if (e.key === 'Escape') {
      if (exitSplitScrollback()) {
        e.preventDefault();
        dom.commandInput.focus();
        return;
      }
      resetCompletionState();
      dom.commandInput.value = '';
      dom.commandInput.focus();
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      scrollActiveOutputByPage(-0.8);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      scrollActiveOutputByPage(0.8);
    }

    if (handleMappedKey(e)) return;

    // Auto-focus: redirect printable keys to command input
    if (document.activeElement === dom.commandInput) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length === 1) {
      dom.commandInput.focus();
    }
  });
}
