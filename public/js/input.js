import { state, dom } from './state.js';
import {
  appendEcho,
  appendSystemMessage,
  clearOutput,
  exitSplitScrollback,
  returnOutputToLive,
  resumeOutputForManualCommand,
  scrollActiveOutputByPage,
} from './output.js';
import { MAX_HISTORY, HISTORY_STORAGE_KEY, LEGACY_SESSION_KEY } from './constants.js';
import { initCompletion, requestCompletion, resetCompletionState } from './completion.js';
import { settingsManager } from './settings-manager.js';
import { sendSocketPayload } from './connection.js';
import { aliasManager, tokenizeInput } from './alias-manager.js';
import { highlightManager } from './highlight-manager.js';
import { triggerManager } from './trigger-manager.js';
import { gmcp } from './gmcp.js';
import { panelManager } from './panel-manager.js';
import { executeAliasLine } from './automation-executor.js';
import { replaceEmojiAliases } from './emoji-manager.js';
import { handleEmojiPickerKeydown, initEmojiPicker } from './emoji-picker.js';
import { handleMentionPickerKeydown, initMentionPicker } from './mention-picker.js';
import { isSocketOpen } from './socket-state.js';

let commandHistory = [];
let historyIndex = 0;
let currentInput = '';
let _saveTimer = null;
let batchDrawer = null;
let batchTextarea = null;
let batchSubmitButton = null;

const BATCH_COMMAND_DELAY_MS = 75;

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

function sendRawCommand(text) {
  if (!isSocketOpen(state.ws)) {
    appendSystemMessage('Not connected.');
    return false;
  }

  const command = normalizeOutboundCommand(text);

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

function extractBatchCommands(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function getPastedInputValue(pastedText) {
  const input = dom.commandInput;
  const value = String(input.value || '');
  const start = input.selectionStart == null ? value.length : input.selectionStart;
  const end = input.selectionEnd == null ? start : input.selectionEnd;
  return value.slice(0, start) + pastedText + value.slice(end);
}

function closeBatchDrawer() {
  if (batchDrawer) {
    batchDrawer.remove();
    batchDrawer = null;
  }
  batchTextarea = null;
  batchSubmitButton = null;
  if (dom.commandInput) dom.commandInput.focus();
}

function sendBatchCommands(commands, index = 0) {
  if (index >= commands.length) {
    return;
  }

  sendCommandText(commands[index]);
  if (index + 1 < commands.length) {
    setTimeout(() => sendBatchCommands(commands, index + 1), BATCH_COMMAND_DELAY_MS);
  }
}

function submitBatchDrawer() {
  if (!batchTextarea) return;

  const commands = extractBatchCommands(batchTextarea.value);
  if (!commands.length) {
    closeBatchDrawer();
    return;
  }

  if (batchSubmitButton) batchSubmitButton.disabled = true;
  closeBatchDrawer();
  sendBatchCommands(commands);
}

function openBatchDrawer(commands) {
  const inputBar = document.getElementById('input-bar');
  const drawer = document.createElement('section');
  const header = document.createElement('div');
  const title = document.createElement('div');
  const hint = document.createElement('div');
  const textarea = document.createElement('textarea');
  const actions = document.createElement('div');
  const cancelButton = document.createElement('button');
  const submitButton = document.createElement('button');

  if (!inputBar || !inputBar.parentNode) return;
  if (batchDrawer) closeBatchDrawer();

  drawer.id = 'command-batch-drawer';
  drawer.setAttribute('aria-label', 'Multiline command input');
  header.className = 'command-batch-header';
  title.className = 'command-batch-title';
  hint.className = 'command-batch-hint';
  textarea.id = 'command-batch-input';
  actions.className = 'command-batch-actions';
  cancelButton.type = 'button';
  cancelButton.className = 'command-batch-btn command-batch-cancel';
  submitButton.type = 'button';
  submitButton.className = 'command-batch-btn command-batch-submit';

  title.textContent = 'Command Batch';
  hint.textContent = 'One command per line';
  textarea.value = commands.join('\n');
  textarea.spellcheck = false;
  textarea.autocomplete = 'off';
  cancelButton.textContent = 'Cancel';
  submitButton.textContent = 'Submit';

  header.appendChild(title);
  header.appendChild(hint);
  actions.appendChild(cancelButton);
  actions.appendChild(submitButton);
  drawer.appendChild(header);
  drawer.appendChild(textarea);
  drawer.appendChild(actions);

  drawer.addEventListener('pointerdown', event => {
    event.stopPropagation();
  });
  drawer.addEventListener('click', event => {
    event.stopPropagation();
  });
  cancelButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    closeBatchDrawer();
  });
  submitButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    submitBatchDrawer();
  });
  textarea.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBatchDrawer();
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      submitBatchDrawer();
    }
  });

  inputBar.parentNode.insertBefore(drawer, inputBar);
  batchDrawer = drawer;
  batchTextarea = textarea;
  batchSubmitButton = submitButton;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function handleCommandPaste(event) {
  const pastedText = event.clipboardData ? event.clipboardData.getData('text') : '';
  const nextValue = getPastedInputValue(pastedText);
  const commands = extractBatchCommands(nextValue);

  if (commands.length < 2) return;

  event.preventDefault();
  resetCompletionState();
  dom.commandInput.value = '';
  openBatchDrawer(commands);
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

function startsWithSlashCommand(text, command) {
  const trimmed = String(text || '').trim().toLowerCase();
  return trimmed === '/' + command || trimmed.startsWith('/' + command + ' ');
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
    if (startsWithSlashCommand(trimmed, 'alias regex')) {
      const args = parseBraceArguments(trimmed, 'alias regex');
      if (args === null || (args.length !== 0 && args.length !== 1 && args.length !== 2)) {
        appendAliasWarning('Usage: /alias regex {pattern} {command}');
        return { handled: true, localOnly: true };
      }

      if (!args.length) {
        const aliases = scope.aliases
          .filter((alias) => alias.isRegex)
          .slice()
          .sort((a, b) => a.trigger.localeCompare(b.trigger));
        appendSystemMessage(aliases.length
          ? 'Regex aliases: ' + aliases.map((alias) => alias.trigger).join(', ')
          : 'Regex aliases: none set for this server.');
        return { handled: true, localOnly: true };
      }

      if (args.length === 1) {
        const alias = scope.aliases.find((item) => item.isRegex && item.trigger === String(args[0] || '').trim());
        if (!alias) {
          appendSystemMessage('Alias: regex "' + args[0] + '" is not defined.');
          return { handled: true, localOnly: true };
        }
        appendSystemMessage(
          'Alias: /' + alias.trigger + '/ -> '
          + (alias.steps.length === 1 && alias.steps[0].type === 'send_command'
            ? formatAliasStepTemplate(alias.steps[0].template)
            : alias.steps.length + ' step' + (alias.steps.length === 1 ? '' : 's'))
        );
        return { handled: true, localOnly: true };
      }

      const result = aliasManager.upsertSimpleAlias(args[0], args[1], scopeKey, { isRegex: true, ignoreCase: true });
      if (result && result.error) {
        appendAliasWarning(result.error);
      } else {
        appendSystemMessage('Regex alias set: /' + args[0] + '/ -> ' + formatAliasStepTemplate(args[1]));
      }
      return { handled: true, localOnly: true };
    }

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

    const result = aliasManager.upsertSimpleAlias(trigger, template, scopeKey);
    if (result && result.error) {
      appendAliasWarning(result.error);
    } else {
      appendSystemMessage(
        'Alias set: ' + trigger + ' -> ' + formatAliasStepTemplate(template)
      );
    }
    return { handled: true, localOnly: true };
  }

  if (command === '/highlight') {
    const scope = highlightManager.getScopeSnapshot(scopeKey);
    const args = parseBraceArguments(trimmed, 'highlight');
    if (args === null) {
      appendHighlightWarning('Usage: /highlight {pattern} {foreground [b] background}; colors support red, bright-red, ansi-196, or #ff8800.');
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
    if (startsWithSlashCommand(trimmed, 'trigger regex')) {
      const args = parseBraceArguments(trimmed, 'trigger regex');
      if (args === null) {
        appendTriggerWarning('Usage: /trigger regex {pattern} {command}');
        return { handled: true, localOnly: true };
      }

      if (!args.length) {
        const triggers = scope.triggers.filter((trigger) => trigger.isRegex).slice();
        appendSystemMessage(triggers.length
          ? 'Regex triggers: ' + triggers.map((trigger) => triggerManager.describeTrigger(trigger)).join(' | ')
          : 'Regex triggers: none set for this server.');
        return { handled: true, localOnly: true };
      }

      if (args.length === 1) {
        const trigger = scope.triggers.find((item) => item.isRegex && item.pattern === String(args[0] || '').trim());
        if (!trigger) {
          appendSystemMessage('Trigger: regex "' + args[0] + '" is not defined.');
        } else {
          appendSystemMessage('Trigger: ' + triggerManager.describeTrigger(trigger));
        }
        return { handled: true, localOnly: true };
      }

      const result = triggerManager.upsertSimpleTrigger(args[0], args[1], scopeKey, { isRegex: true, ignoreCase: false });
      if (result.error) {
        appendTriggerWarning(result.error);
      } else {
        appendSystemMessage('Trigger set: ' + triggerManager.describeTrigger(result.trigger));
      }
      return { handled: true, localOnly: true };
    }

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
    if (startsWithSlashCommand(trimmed, 'unalias regex')) {
      const args = parseBraceArguments(trimmed, 'unalias regex');
      if (args === null || args.length !== 1) {
        appendAliasWarning('Usage: /unalias regex {pattern}');
        return { handled: true, localOnly: true };
      }
      if (!aliasManager.removeAliasByTrigger(args[0], scopeKey)) {
        appendSystemMessage('Alias: regex "' + args[0] + '" was not defined.');
      } else {
        appendSystemMessage('Regex alias cleared: ' + args[0]);
      }
      return { handled: true, localOnly: true };
    }

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
    if (startsWithSlashCommand(trimmed, 'untrigger regex')) {
      const args = parseBraceArguments(trimmed, 'untrigger regex');
      if (args === null || args.length !== 1) {
        appendTriggerWarning('Usage: /untrigger regex {pattern}');
        return { handled: true, localOnly: true };
      }
      if (!triggerManager.removeTriggerByPattern(args[0], scopeKey)) {
        appendSystemMessage('Trigger: regex "' + args[0] + '" was not defined.');
      } else {
        appendSystemMessage('Regex trigger cleared: ' + args[0]);
      }
      return { handled: true, localOnly: true };
    }

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

export function sendCommandText(text) {
  const trimmed = replaceEmojiAliases(String(text || ''));
  const slashCommandResult = handleAliasSlashCommand(trimmed);
  const aliasResult = slashCommandResult || executeAliasLine(trimmed, {
    isRoot: true,
    appendMessage: appendSystemMessage,
    sendCommand: sendRawCommand,
  });

  if (!aliasResult.handled && !aliasResult.sent) return false;

  resumeOutputForManualCommand();
  pushHistory(trimmed);
  // Echo non-empty commands only. Empty Enter sends "" to the server
  // (pager-enter behavior); the cursor-advance "echo" is implicit in
  // the server's next prompt arriving on a fresh line, which is
  // guaranteed by closeOpenOutputLine() in sendSocketPayload. Matches
  // standard telnet/MUD client behavior (RFC 854, PuTTY, Mudlet).
  if (trimmed !== '') appendEcho(trimmed);
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
  if (target.closest('.dw-modal-overlay, .dw-modal')) return true;
  if (target.closest('.gmcp-panel-widget[data-panel-id="ide"], .cm-editor, .cm-content')) return true;
  if (target.closest('.fishing-stage')) return true;
  if (target.closest('.linux-rescue-overlay')) return true;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

function isSettingsShortcut(event) {
  return (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === ',' || event.code === 'Comma');
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
  initEmojiPicker(dom.commandInput);
  initMentionPicker(dom.commandInput);

  dom.commandInput.addEventListener('keydown', function(e) {
    if (handleMentionPickerKeydown(e)) {
      return;
    } else if (handleEmojiPickerKeydown(e)) {
      return;
    } else if (handleMappedKey(e)) {
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
  dom.commandInput.addEventListener('paste', handleCommandPaste);

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

    if (isSettingsShortcut(e)) {
      e.preventDefault();
      settingsManager.open();
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      clearOutput();
    } else if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      panelManager.resetData({ preservePanels: ['chat'] });
      if (gmcp.restartHandshake({ panels: panelManager.getSubscriptionPanels() })) {
        panelManager.refreshMediaPanels();
      }
    } else if (e.key === 'Escape') {
      if (returnOutputToLive() || exitSplitScrollback()) {
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
