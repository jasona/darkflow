import { dom } from './state.js';
import { gmcp } from './gmcp.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';
import { appendSystemMessage } from './output.js';
import { settingsManager } from './settings-manager.js';
import { aliasManager, tokenizeInput } from './alias-manager.js';

const REQUEST_PACKAGE = 'Darkwind.Completion.Request';
const RESULT_PACKAGE = 'Darkwind.Completion.Result';
const completionController = {};

let pendingRequest = null;
let lastAmbiguousSignature = null;
let suppressReset = false;

function signatureFor(line, cursor) {
  return line + '\n' + String(cursor);
}

function formatMatches(matches) {
  const maxWidth = matches.reduce(function(width, match) {
    return Math.max(width, match.length);
  }, 0) + 2;
  const columns = Math.max(1, Math.floor(80 / Math.max(maxWidth, 1)));
  const lines = [];

  for (let index = 0; index < matches.length; index += columns) {
    const row = matches.slice(index, index + columns)
      .map(function(match) {
        return match.padEnd(maxWidth, ' ');
      })
      .join('')
      .trimEnd();
    lines.push(row);
  }

  return lines.join('\n');
}

function clearAmbiguousState() {
  lastAmbiguousSignature = null;
}

function findTokenAtCursor(tokens, cursor) {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (cursor > token.start && cursor <= token.end) {
      return { token, index };
    }
  }
  return null;
}

function applyInputValue(line, cursor) {
  suppressReset = true;
  dom.commandInput.value = line;
  dom.commandInput.setSelectionRange(cursor, cursor);
  suppressReset = false;
}

function buildHistoryCompletion(line, cursor, history) {
  const tokens = tokenizeInput(line);
  if (tokens.length < 2) return null;

  const active = findTokenAtCursor(tokens, cursor);
  if (!active || active.index === 0) return null;

  const activeToken = active.token;
  const partial = line.slice(activeToken.start, cursor);
  const suffix = line.slice(cursor, activeToken.end);
  if (!partial || /\s/.test(partial)) return null;

  const verb = tokens[0].lower;
  const partialLower = partial.toLowerCase();
  const activeIndex = active.index;

  for (let index = history.length - 1; index >= 0; index--) {
    const previousLine = typeof history[index] === 'string' ? history[index] : '';
    if (!previousLine || previousLine === line) continue;

    const previousTokens = tokenizeInput(previousLine);
    if (previousTokens.length <= activeIndex) continue;
    if (previousTokens[0].lower !== verb) continue;

    const candidate = previousTokens[activeIndex].value;
    if (!candidate) continue;
    if (!candidate.toLowerCase().startsWith(partialLower)) continue;
    if (candidate === partial + suffix) continue;

    const nextLine = line.slice(0, activeToken.start) + candidate + line.slice(activeToken.end);
    const nextCursor = activeToken.start + candidate.length;
    return { line: nextLine, cursor: nextCursor };
  }

  return null;
}

function commonPrefix(values) {
  if (!values.length) return '';
  let prefix = values[0];

  for (let index = 1; index < values.length; index++) {
    const value = values[index];
    let offset = 0;
    while (
      offset < prefix.length
      && offset < value.length
      && prefix[offset].toLowerCase() === value[offset].toLowerCase()
    ) {
      offset++;
    }
    prefix = prefix.slice(0, offset);
    if (!prefix) break;
  }

  return prefix;
}

function buildAliasCompletion(line, cursor, repeated = false) {
  const beforeCursor = line.slice(0, cursor);
  const afterCursor = line.slice(cursor);
  const indentMatch = beforeCursor.match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const partial = beforeCursor.slice(indent.length);
  if (!partial || /\s$/.test(partial)) return null;
  if (/["']/.test(partial)) return null;

  const partialLower = partial.toLowerCase();
  const matches = aliasManager.listCompletionTriggers()
    .filter((trigger) => trigger.toLowerCase().startsWith(partialLower));

  if (!matches.length) return null;

  const exactMatch = matches.find((trigger) => trigger.toLowerCase() === partialLower);
  if (exactMatch) {
    return {
      line,
      cursor,
      matches,
      ambiguous: matches.length > 1,
      showMatches: repeated && matches.length > 1,
    };
  }

  const replacement = matches.length === 1 ? matches[0] : commonPrefix(matches);
  if (replacement && replacement.length > partial.length) {
    const nextLine = indent + replacement + afterCursor;
    return {
      line: nextLine,
      cursor: indent.length + replacement.length,
      matches,
      ambiguous: matches.length > 1,
      showMatches: false,
    };
  }

  return {
    line,
    cursor,
    matches,
    ambiguous: matches.length > 1,
    showMatches: repeated && matches.length > 1,
  };
}

function applyCompletionResult(data) {
  let nextLine;
  let nextCursor;
  let matches;
  let ambiguous;
  let request;

  if (!pendingRequest) return;

  request = pendingRequest;
  nextLine = data && typeof data.line === 'string' ? data.line : request.line;
  nextCursor = data && typeof data.cursor === 'number' ? data.cursor : request.cursor;
  matches = data && Array.isArray(data.matches) ? data.matches : [];
  ambiguous = Boolean(data && data.ambiguous) && matches.length > 1;

  pendingRequest = null;

  applyInputValue(nextLine, nextCursor);

  if (ambiguous) {
    lastAmbiguousSignature = signatureFor(nextLine, nextCursor);
    if (request.repeated) {
      appendSystemMessage(formatMatches(matches));
    }
    return;
  }

  clearAmbiguousState();
}

export function initCompletion() {
  return installControllerLifecycle(completionController, 'completion', gmcp, (scopedGmcp, lifecycle) => {
    scopedGmcp.on(RESULT_PACKAGE, applyCompletionResult);
    lifecycle.listen(dom.commandInput, 'input', function() {
      if (suppressReset) return;
      pendingRequest = null;
      clearAmbiguousState();
    });
  }, resetCompletionState);
}

export function disposeCompletion() {
  disposeControllerLifecycle(completionController);
}

export function resetCompletionState() {
  pendingRequest = null;
  clearAmbiguousState();
}

export function requestCompletion(history = []) {
  const line = dom.commandInput.value;
  const cursor = dom.commandInput.selectionStart == null
    ? line.length
    : dom.commandInput.selectionStart;
  const signature = signatureFor(line, cursor);

  if (settingsManager.get('aliasTabCompletionEnabled')) {
    const aliasCompletion = buildAliasCompletion(line, cursor, signature === lastAmbiguousSignature);
    if (aliasCompletion) {
      pendingRequest = null;
      applyInputValue(aliasCompletion.line, aliasCompletion.cursor);
      if (aliasCompletion.ambiguous) {
        lastAmbiguousSignature = signatureFor(aliasCompletion.line, aliasCompletion.cursor);
        if (aliasCompletion.showMatches) {
          appendSystemMessage(formatMatches(aliasCompletion.matches));
        }
      } else {
        clearAmbiguousState();
      }
      return;
    }
  }

  if (settingsManager.get('historyTabCompletionEnabled')) {
    const historyCompletion = buildHistoryCompletion(line, cursor, history);
    if (historyCompletion) {
      pendingRequest = null;
      clearAmbiguousState();
      applyInputValue(historyCompletion.line, historyCompletion.cursor);
      return;
    }
  }

  pendingRequest = {
    line,
    cursor,
    repeated: signature === lastAmbiguousSignature
  };

  gmcp.send(REQUEST_PACKAGE, { line, cursor });
}
