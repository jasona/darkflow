// Shared editor for the automation screens: Aliases, Triggers, Timers and
// Highlights. They get the same layout and interaction model so the
// screens stay consistent by construction:
//
//   [ search | New <noun> | scope chip ]
//   [ ordered list + Up/Down/Duplicate/Delete ][ detail pane ]
//   [ pinned, collapsible test bar ]
//
// The list shows items in array order because order is meaningful in every
// scope: aliases match first-hit-wins, triggers run in order, highlight
// rules apply in order. Groups are rendered as row chips, not sections, so
// reordering stays visually honest.
//
// The host argument is the settingsManager object; the editor reads its
// draft scopes (_draftAliasScope/_draftTriggerScope/_draftTimerScope/_draftHighlightScope)
// and uses its focus helpers so focus survives re-renders.

import { aliasManager } from './alias-manager.js';
import { triggerManager } from './trigger-manager.js';
import { timerManager } from './timer-manager.js';
import { highlightManager } from './highlight-manager.js';
import { functionManager } from './function-manager.js';
import { styleToElement } from './ansi.js';
import { getSoundCatalog, isKnownSound, soundManager, SOUND_CATEGORIES, SOUND_CATEGORY_INFO } from './sound-manager.js';
import { getAutomationStepLabel } from './automation-executor.js';
import {
  evaluateArithmeticExpression,
  isArithmeticExpressionCandidate,
} from './alias-expression-core.mjs';
import {
  evaluateAutomationCondition,
  parseAutomationScript,
} from './automation-script-core.mjs';

const AUTOMATION_UI_KEY = 'darkwind-settings-automation-ui';

function draftAutomationVariables(host) {
  return {
    ...aliasManager.getAutomationVariables(host._aliasScopeKey),
    ...(host._draftAliasScope && host._draftAliasScope.variables
      ? host._draftAliasScope.variables
      : {}),
  };
}

function normalizeAutomationMode(mode) {
  return mode === 'enable' || mode === 'disable' ? mode : 'toggle';
}

function loadAutomationUiState() {
  try {
    const raw = localStorage.getItem(AUTOMATION_UI_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveAutomationUiState(patch) {
  try {
    localStorage.setItem(AUTOMATION_UI_KEY, JSON.stringify({ ...loadAutomationUiState(), ...patch }));
  } catch (e) { /* ignore */ }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function smallButton(label, title, onClick) {
  const btn = el('button', 'dw-button dw-button-secondary settings-step-btn', label);
  btn.type = 'button';
  if (title) btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

function createFlagPill(label, title, checked, onChange, focusKey) {
  const pill = el('label', 'settings-flag-pill' + (checked ? ' on' : ''));
  pill.title = title;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  if (focusKey) input.dataset.focusKey = focusKey;
  input.addEventListener('change', () => onChange(input.checked));
  pill.appendChild(input);
  pill.appendChild(el('span', '', label));
  return pill;
}

function makeSoundKit() {
  const catalog = getSoundCatalog();
  const categories = SOUND_CATEGORIES.filter((category) => (
    catalog.some((sound) => sound.category === category)
  ));
  const first = catalog[0] || { category: 'alert', sound: 'warning' };
  const forCategory = (category) => catalog.filter((item) => item.category === category);
  return {
    categories,
    first,
    forCategory,
    label(category, sound) {
      const match = catalog.find((item) => item.category === category && item.sound === sound);
      if (match) return match.label;
      return [category, sound].filter(Boolean).join(' / ') || 'No sound selected';
    },
    categoryLabel(category) {
      return SOUND_CATEGORY_INFO[category] ? SOUND_CATEGORY_INFO[category].label : category;
    },
    ensure(step) {
      if (!step.category || !forCategory(step.category).length) step.category = first.category;
      if (!step.sound || !isKnownSound(step.category, step.sound)) {
        const sounds = forCategory(step.category);
        step.sound = sounds[0] ? sounds[0].sound : first.sound;
      }
      if (!Number.isFinite(Number(step.volume))) step.volume = 1;
      step.volume = Math.max(0, Math.min(1, Number(step.volume)));
    },
  };
}

// Renders a resolved step row into a preview body; shared by the alias and
// trigger preview renderers for the step types they have in common.
function appendResolvedStepRow(body, prefix, resolved) {
  const row = el('div', 'settings-alias-preview-step', prefix + ': ' + resolved.text);
  let ok = true;
  if (resolved.missingVariables.length) {
    row.classList.add('warning');
    row.textContent += ' (missing ' + resolved.missingVariables.map((name) => '$' + name).join(', ') + ')';
    ok = false;
  } else if (resolved.errors.length) {
    row.classList.add('warning');
    row.textContent += ' (' + resolved.errors.join(' ') + ')';
    ok = false;
  }
  body.appendChild(row);
  return { row, ok };
}

function maybeEvaluateSetPreview(step, resolved) {
  if (step.type !== 'set_variable') return resolved;
  const expression = String(resolved.text || '').trim();
  if (!isArithmeticExpressionCandidate(expression)) return resolved;
  const result = evaluateArithmeticExpression(expression, { args: [], remainder: '', variables: {} });
  return {
    ...resolved,
    text: result.text,
    errors: [...resolved.errors, ...result.errors],
  };
}

// Preview row for an enable/disable/toggle step that references its target
// by id; mutates the preview copy so later steps see the change.
function appendTargetIdPreviewRow(body, step, items, patternOf, options = {}) {
  const target = items.find((item) => item.id === step.targetId);
  const displayName = options.useDescription === false ? '' : String(target && target.description || '').trim();
  const label = target ? (displayName || patternOf(target)) : '';
  const row = el('div', 'settings-alias-preview-step', getAutomationStepLabel(step) + ': ' + label);
  if (!target) {
    row.classList.add('warning');
    row.textContent += '(target no longer exists)';
  } else {
    if (step.type === 'control_timer') {
      row.textContent += ' -> ' + (step.mode === 'stop' ? 'stopped' : step.mode === 'reset' ? 'reset' : step.mode === 'run' ? 'run now' : 'started');
      body.appendChild(row);
      return;
    }
    const mode = normalizeAutomationMode(step.mode);
    target.enabled = mode === 'toggle' ? target.enabled === false : mode === 'enable';
    row.textContent += ' -> ' + (target.enabled === false ? 'disabled' : 'enabled');
  }
  body.appendChild(row);
}

function appendFunctionPreviewRow(body, step, functions, templateContext) {
  const target = step.targetId
    ? functions.find((item) => item.id === step.targetId)
    : functions.find((item) => item.name === String(step.target || '').trim().toLowerCase());
  const resolved = aliasManager.resolveTemplate(step.template || '', templateContext);
  const label = target ? target.name : String(step.target || '').trim();
  const row = el('div', 'settings-alias-preview-step', 'Call function: ' + (label || '(none)'));
  if (!target) {
    row.classList.add('warning');
    row.textContent += ' (function not found)';
  } else if (resolved.missingVariables.length) {
    row.classList.add('warning');
    row.textContent += ' (missing ' + resolved.missingVariables.map((name) => '$' + name).join(', ') + ')';
  } else if (resolved.errors.length) {
    row.classList.add('warning');
    row.textContent += ' (' + resolved.errors.join(' ') + ')';
  } else if (resolved.text.trim()) {
    row.textContent += ' ' + resolved.text.trim();
  }
  body.appendChild(row);
}

function countScriptActions(nodes) {
  let count = 0;
  (nodes || []).forEach((node) => {
    if (node.type === 'action' || node.type === 'break' || node.type === 'continue') count++;
    if (node.type === 'if') {
      (node.branches || []).forEach((branch) => { count += countScriptActions(branch.steps); });
      count += countScriptActions(node.elseSteps);
    }
    if (node.type === 'while') {
      count += countScriptActions(node.steps);
    }
  });
  return count;
}

function appendScriptPreviewRows(body, script, templateContext, renderAction) {
  const parsed = parseAutomationScript(script || '');
  if (parsed.diagnostics.length) {
    parsed.diagnostics.forEach((message) => {
      const row = el('div', 'settings-alias-preview-step warning', 'Script: ' + message);
      body.appendChild(row);
    });
    return;
  }

  const runNodes = (nodes, depth = 0) => {
    for (const node of nodes || []) {
      if (node.type === 'action') {
        renderAction(node.step, depth);
        continue;
      }

      if (node.type === 'break' || node.type === 'continue') {
        const row = el('div', 'settings-alias-preview-step', node.type === 'break' ? 'Break' : 'Continue');
        if (depth) row.style.marginLeft = String(Math.min(depth, 5) * 14) + 'px';
        body.appendChild(row);
        return node.type;
      }

      if (node.type === 'while') {
        for (let iteration = 1; iteration <= 10; iteration++) {
          const result = evaluateAutomationCondition(
            node.condition,
            templateContext,
            (template, context) => aliasManager.resolveTemplate(template, context)
          );
          const row = el('div', 'settings-alias-preview-step',
            'While ' + node.condition + ' -> ' + (result.value ? 'true' : 'false') + ' #' + iteration);
          if (depth) row.style.marginLeft = String(Math.min(depth, 5) * 14) + 'px';
          if (result.diagnostics.length) {
            row.classList.add('warning');
            row.textContent += ' (' + result.diagnostics.join(' ') + ')';
          }
          body.appendChild(row);
          if (!result.value || result.diagnostics.length) break;

          const control = runNodes(node.steps, depth + 1);
          if (control === 'break') break;
          if (control === 'continue') {
            if (iteration === 10) {
              const truncated = el('div', 'settings-alias-preview-step warning',
                'While preview stopped after 10 iterations.');
              if (depth) truncated.style.marginLeft = String(Math.min(depth, 5) * 14) + 'px';
              body.appendChild(truncated);
            }
            continue;
          }
          if (control) return control;
          if (iteration === 10) {
            const truncated = el('div', 'settings-alias-preview-step warning',
              'While preview stopped after 10 iterations.');
            if (depth) truncated.style.marginLeft = String(Math.min(depth, 5) * 14) + 'px';
            body.appendChild(truncated);
          }
        }
        continue;
      }

      if (node.type !== 'if') continue;

      let matched = false;
      for (const branch of node.branches || []) {
        const result = evaluateAutomationCondition(
          branch.condition,
          templateContext,
          (template, context) => aliasManager.resolveTemplate(template, context)
        );
        const row = el('div', 'settings-alias-preview-step',
          'If ' + branch.condition + ' -> ' + (result.value ? 'true' : 'false'));
        if (depth) row.style.marginLeft = String(Math.min(depth, 5) * 14) + 'px';
        if (result.diagnostics.length) {
          row.classList.add('warning');
          row.textContent += ' (' + result.diagnostics.join(' ') + ')';
        }
        body.appendChild(row);
        if (result.value) {
          matched = true;
          const control = runNodes(branch.steps, depth + 1);
          if (control) return control;
          break;
        }
      }

      if (!matched && Array.isArray(node.elseSteps)) {
        const row = el('div', 'settings-alias-preview-step', 'Else -> true');
        if (depth) row.style.marginLeft = String(Math.min(depth, 5) * 14) + 'px';
        body.appendChild(row);
        const control = runNodes(node.elseSteps, depth + 1);
        if (control) return control;
      }
    }
    return null;
  };

  const total = countScriptActions(parsed.ast);
  body.appendChild(el('div', 'settings-alias-preview-match',
    'Script: ' + total + ' possible action' + (total === 1 ? '' : 's')));
  runNodes(parsed.ast);
}

function appendStepsEditor(container, owner, opts, api) {
  container.appendChild(el('div', 'settings-label', 'Steps'));

  const stepList = el('div', 'settings-alias-step-list');
  const itemLabel = (item, patternFor, useDescription) => {
    const name = useDescription === false ? '' : String(item.description || '').trim();
    const pattern = patternFor(item);
    return name ? name + ' (' + pattern + ')' : pattern || '(untitled)';
  };
  const splitAliasInvocation = (template, items, patternFor) => {
    const text = String(template || '').trim();
    let match = null;

    items.forEach((item) => {
      const pattern = String(patternFor(item) || '').trim();
      if (!pattern) return;
      if (text === pattern || text.startsWith(pattern + ' ')) {
        if (!match || pattern.length > String(patternFor(match) || '').length) {
          match = item;
        }
      }
    });

    if (!match) return { item: null, args: '', unresolved: text };

    const pattern = String(patternFor(match) || '').trim();
    return {
      item: match,
      args: text.slice(pattern.length).trim(),
      unresolved: '',
    };
  };
  const targetConfigFor = (type) => {
    if (opts.targetConfigs && opts.targetConfigs[type]) return opts.targetConfigs[type];
    if (type === opts.toggleTargetType) {
      return {
        targetNoun: opts.targetNoun,
        targetItems: opts.targetItems,
        targetPattern: opts.targetPattern,
      };
    }
    return null;
  };
  const isFunctionCallStep = (type) => type === 'call_function';
  const optionValueFor = (step) => (
    targetConfigFor(step.type) && step.mode
      ? step.type + ':' + step.mode
      : step.type
  );

  owner.steps.forEach((step, index) => {
    const card = el('div', 'settings-alias-step-card settings-step-card');
    const head = el('div', 'settings-step-head');
    head.appendChild(el('span', 'settings-step-index', String(index + 1)));

    const typeSelect = el('select', 'dw-select');
    typeSelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-type';
    opts.stepTypes.forEach((option) => {
      const optionEl = el('option', '', option.label);
      optionEl.value = option.value;
      if (optionValueFor(step) === option.value) optionEl.selected = true;
      typeSelect.appendChild(optionEl);
    });
    typeSelect.addEventListener('change', () => {
      const selected = opts.stepTypes.find((option) => option.value === typeSelect.value) || opts.stepTypes[0];
      step.type = selected.type;
      if (selected.mode) step.mode = selected.mode;
      else delete step.mode;
      if (step.type !== 'set_variable') delete step.name;
      if (!targetConfigFor(step.type) && !isFunctionCallStep(step.type)) {
        delete step.target;
        delete step.targetId;
      }
      if (targetConfigFor(step.type) && !step.target) step.target = '';
      if (isFunctionCallStep(step.type) && !step.target) step.target = '';
      if (opts.sounds && step.type === 'play_sound') {
        delete step.template;
        delete step.script;
        opts.sounds.ensure(step);
      } else if (step.type === 'script') {
        delete step.template;
        delete step.category;
        delete step.sound;
        delete step.volume;
        if (!step.script) step.script = '';
      } else {
        delete step.script;
        delete step.category;
        delete step.sound;
        delete step.volume;
        if (!step.template) step.template = '';
      }
      api.render();
    });
    head.appendChild(typeSelect);

    head.appendChild(el('span', 'settings-step-spacer'));

    const upBtn = smallButton('Up', 'Move step up', () => {
      if (index === 0) return;
      const previous = owner.steps[index - 1];
      owner.steps[index - 1] = step;
      owner.steps[index] = previous;
      api.render();
      api.focus(opts.focusPrefix + '-step-' + (index - 1) + '-type');
    });
    upBtn.disabled = index === 0;

    const downBtn = smallButton('Dn', 'Move step down', () => {
      if (index === owner.steps.length - 1) return;
      const next = owner.steps[index + 1];
      owner.steps[index + 1] = step;
      owner.steps[index] = next;
      api.render();
      api.focus(opts.focusPrefix + '-step-' + (index + 1) + '-type');
    });
    downBtn.disabled = index === owner.steps.length - 1;

    const removeBtn = smallButton('X', 'Remove step', () => {
      owner.steps.splice(index, 1);
      if (!owner.steps.length) owner.steps.push({ type: 'send_command', template: '' });
      api.render();
      api.focus(opts.focusPrefix + '-step-' + Math.min(index, owner.steps.length - 1) + '-type');
    });

    head.appendChild(upBtn);
    head.appendChild(downBtn);
    head.appendChild(removeBtn);
    card.appendChild(head);

    if (step.type === 'set_variable') {
      const nameInput = el('input', 'dw-input');
      nameInput.type = 'text';
      nameInput.placeholder = opts.variableNamePlaceholder;
      nameInput.title = 'Variable name to write';
      nameInput.value = step.name || '';
      nameInput.addEventListener('input', () => {
        step.name = nameInput.value;
        api.renderDiagnostics();
      });
      card.appendChild(nameInput);
    }

    if (step.type === 'script') {
      const scriptInput = el('textarea', 'dw-input settings-alias-template settings-step-template');
      scriptInput.placeholder = opts.scriptPlaceholder;
      scriptInput.value = step.script || '';
      scriptInput.rows = 8;
      scriptInput.addEventListener('input', () => {
        step.script = scriptInput.value;
        api.renderDiagnostics();
        api.renderPreview();
      });
      card.appendChild(scriptInput);
    } else if (opts.sounds && step.type === 'play_sound') {
      opts.sounds.ensure(step);
      const soundRow = el('div', 'settings-step-sound-row');

      const categorySelect = el('select', 'dw-select');
      categorySelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-sound-category';
      opts.sounds.categories.forEach((category) => {
        const option = el('option', '', opts.sounds.categoryLabel(category));
        option.value = category;
        if (step.category === category) option.selected = true;
        categorySelect.appendChild(option);
      });
      categorySelect.addEventListener('change', () => {
        step.category = categorySelect.value;
        const sounds = opts.sounds.forCategory(step.category);
        step.sound = sounds[0] ? sounds[0].sound : '';
        api.render();
        api.focus(opts.focusPrefix + '-step-' + index + '-sound-category');
      });
      soundRow.appendChild(categorySelect);

      const soundSelect = el('select', 'dw-select');
      soundSelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-sound';
      opts.sounds.forCategory(step.category).forEach((item) => {
        const option = el('option', '', item.label.replace(opts.sounds.categoryLabel(item.category) + ' / ', ''));
        option.value = item.sound;
        if (step.sound === item.sound) option.selected = true;
        soundSelect.appendChild(option);
      });
      soundSelect.addEventListener('change', () => {
        step.sound = soundSelect.value;
        api.renderPreview();
      });
      soundRow.appendChild(soundSelect);

      const volumeInput = document.createElement('input');
      volumeInput.type = 'range';
      volumeInput.min = '0';
      volumeInput.max = '100';
      volumeInput.value = String(Math.round(step.volume * 100));
      volumeInput.title = 'Volume';
      volumeInput.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-sound-volume';
      const volumeValue = el('span', 'settings-helper-text', Math.round(step.volume * 100) + '%');
      volumeInput.addEventListener('input', () => {
        step.volume = Number(volumeInput.value) / 100;
        volumeValue.textContent = volumeInput.value + '%';
        api.renderPreview();
      });
      soundRow.appendChild(volumeInput);
      soundRow.appendChild(volumeValue);

      soundRow.appendChild(smallButton('Test', 'Play this sound now', () => {
        soundManager.play(step.category, step.sound, step.volume);
      }));
      card.appendChild(soundRow);
    } else if (step.type === 'run_alias') {
      const items = opts.runAliasItems ? opts.runAliasItems() : [];
      const patternFor = opts.runAliasPattern || ((item) => item.trigger);
      const selected = splitAliasInvocation(step.template, items, patternFor);
      const aliasRow = el('div', 'settings-step-sound-row');

      const aliasSelect = el('select', 'dw-select settings-step-target');
      aliasSelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-alias';
      aliasSelect.title = 'Pick the alias this step runs.';

      const placeholder = el('option', '', selected.unresolved
        ? 'Unresolved: ' + selected.unresolved
        : 'Select an alias...');
      placeholder.value = '';
      if (!selected.item) placeholder.selected = true;
      aliasSelect.appendChild(placeholder);
      let argsInput;

      items.forEach((item) => {
        const option = el('option', '', itemLabel(item, patternFor));
        option.value = String(patternFor(item) || '');
        if (selected.item && item.id === selected.item.id) option.selected = true;
        aliasSelect.appendChild(option);
      });

      aliasSelect.addEventListener('change', () => {
        const alias = aliasSelect.value.trim();
        const args = argsInput ? argsInput.value.trim() : selected.args;
        step.template = alias
          ? alias + (args ? ' ' + args : '')
          : '';
        api.render();
        api.focus(opts.focusPrefix + '-step-' + index + '-alias');
      });
      aliasRow.appendChild(aliasSelect);

      argsInput = el('input', 'dw-input');
      argsInput.type = 'text';
      argsInput.placeholder = 'Arguments, e.g. %1';
      argsInput.title = 'Optional arguments passed to the selected alias.';
      argsInput.value = selected.args;
      argsInput.disabled = !selected.item;
      argsInput.addEventListener('input', () => {
        const alias = aliasSelect.value.trim();
        step.template = alias
          ? alias + (argsInput.value.trim() ? ' ' + argsInput.value.trim() : '')
          : '';
        api.renderDiagnostics();
        api.renderPreview();
      });
      aliasRow.appendChild(argsInput);

      card.appendChild(aliasRow);
    } else if (step.type === 'call_function') {
      const items = opts.functionItems ? opts.functionItems() : [];
      const patternFor = opts.functionPattern || ((item) => item.name);
      const selectedId = step.targetId || '';
      const selectedByName = !selectedId && step.target
        ? items.find((item) => patternFor(item) === step.target)
        : null;
      const selected = selectedId
        ? items.find((item) => item.id === selectedId)
        : selectedByName;
      const functionRow = el('div', 'settings-step-sound-row');

      const functionSelect = el('select', 'dw-select settings-step-target');
      functionSelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-function';
      functionSelect.title = 'Pick the function this step calls.';

      const placeholder = el('option', '', step.target && !selected
        ? 'Unresolved: ' + step.target
        : 'Select a function...');
      placeholder.value = '';
      if (!selected) placeholder.selected = true;
      functionSelect.appendChild(placeholder);

      items.forEach((item) => {
        const option = el('option', '', itemLabel(item, patternFor));
        option.value = item.id;
        if (selected && item.id === selected.id) option.selected = true;
        functionSelect.appendChild(option);
      });

      let argsInput;
      functionSelect.addEventListener('change', () => {
        const fn = items.find((item) => item.id === functionSelect.value);
        step.targetId = functionSelect.value;
        step.target = fn ? patternFor(fn) : '';
        step.template = argsInput ? argsInput.value : '';
        api.render();
        api.focus(opts.focusPrefix + '-step-' + index + '-function');
      });
      functionRow.appendChild(functionSelect);

      argsInput = el('input', 'dw-input');
      argsInput.type = 'text';
      argsInput.placeholder = 'Arguments, e.g. %1 $target';
      argsInput.title = 'Optional arguments passed to the selected function.';
      argsInput.value = step.template || '';
      argsInput.disabled = !selected;
      argsInput.addEventListener('input', () => {
        step.template = argsInput.value;
        api.renderDiagnostics();
        api.renderPreview();
      });
      functionRow.appendChild(argsInput);

      card.appendChild(functionRow);
    } else if (targetConfigFor(step.type)) {
      const targetConfig = targetConfigFor(step.type);
      // Pick the target from a dropdown of existing items, shown by name.
      // The step stores the target's id; legacy steps that stored a pattern
      // are preselected when the pattern still matches an item.
      const targetSelect = el('select', 'dw-select settings-step-target');
      targetSelect.dataset.focusKey = opts.focusPrefix + '-step-' + index + '-target';
      targetSelect.title = 'Pick the ' + targetConfig.targetNoun + ' this step controls.';

      const items = targetConfig.targetItems();
      const nameCounts = {};
      items.forEach((item) => {
        const name = targetConfig.useDescription === false ? '' : String(item.description || '').trim();
        if (name) nameCounts[name] = (nameCounts[name] || 0) + 1;
      });
      const legacyMatch = !step.targetId && step.target
        ? items.find((item) => targetConfig.targetPattern(item) === step.target)
        : null;
      const selectedId = step.targetId || (legacyMatch ? legacyMatch.id : '');

      const article = targetConfig.targetNoun === 'alias' ? 'an' : 'a';
      const placeholder = el('option', '', step.target && !selectedId
        ? 'Unresolved: ' + step.target
        : 'Select ' + article + ' ' + targetConfig.targetNoun + '...');
      placeholder.value = '';
      if (!selectedId) placeholder.selected = true;
      targetSelect.appendChild(placeholder);

      items.forEach((item) => {
        const name = targetConfig.useDescription === false ? '' : String(item.description || '').trim();
        const pattern = targetConfig.targetPattern(item);
        let label = name || pattern || '(untitled)';
        if (name && nameCounts[name] > 1) label = name + ' (' + pattern + ')';
        const option = el('option', '', label);
        option.value = item.id;
        if (item.id === selectedId) option.selected = true;
        targetSelect.appendChild(option);
      });

      targetSelect.addEventListener('change', () => {
        step.targetId = targetSelect.value;
        step.target = '';
        // Full render so the diagnostics box reflects the new selection.
        api.render();
        api.focus(opts.focusPrefix + '-step-' + index + '-target');
      });
      card.appendChild(targetSelect);
    } else {
      // Everything else takes a template; for set_variable it is the value
      // to write (the name input above selects the variable).
      const templateInput = el('textarea', 'dw-input settings-alias-template settings-step-template');
      templateInput.placeholder = opts.templatePlaceholder(step);
      templateInput.value = step.template || '';
      templateInput.addEventListener('input', () => {
        step.template = templateInput.value;
        api.renderDiagnostics();
        api.renderPreview();
      });
      card.appendChild(templateInput);
    }

    stepList.appendChild(card);
  });

  container.appendChild(stepList);

  const addRow = el('div', 'settings-add-step-row');
  const addSelect = el('select', 'dw-select settings-add-step');
  addSelect.dataset.focusKey = opts.focusPrefix + '-step-add';
  const placeholderOption = el('option', '', '+ Add step...');
  placeholderOption.value = '';
  addSelect.appendChild(placeholderOption);
  opts.stepTypes.forEach((option) => {
    const optionEl = el('option', '', option.label);
    optionEl.value = option.value;
    addSelect.appendChild(optionEl);
  });
  addSelect.addEventListener('change', () => {
    const selected = opts.stepTypes.find((option) => option.value === addSelect.value);
    addSelect.value = '';
    if (!selected) return;
    const step = { type: selected.type, template: '' };
    if (selected.mode) step.mode = selected.mode;
    if (selected.type === 'set_variable') step.name = '';
    if (targetConfigFor(selected.type)) step.target = '';
    if (selected.type === 'call_function') step.target = '';
    if (selected.type === 'script') {
      delete step.template;
      step.script = '';
    }
    if (opts.sounds && selected.type === 'play_sound') {
      delete step.template;
      step.category = opts.sounds.first.category;
      step.sound = opts.sounds.first.sound;
      step.volume = 1;
    }
    owner.steps.push(step);
    api.render();
    api.focus(opts.focusPrefix + '-step-' + (owner.steps.length - 1) + '-type');
  });
  addRow.appendChild(addSelect);

  const help = el('details', 'settings-syntax-help');
  help.appendChild(el('summary', '', 'Template syntax'));
  help.appendChild(el('p', 'dw-paragraph', opts.syntaxHelp));
  addRow.appendChild(help);
  container.appendChild(addRow);
}

function buildConfig(host, kind) {
  if (kind === 'alias') {
    const sounds = null;
    return {
      kind,
      noun: 'alias',
      plural: 'aliases',
      scopeKey: () => host._aliasScopeKey,
      scopeHint: 'Aliases and variables are saved separately for each server connection target.',
      list: () => host._draftAliasScope.aliases,
      replaceList: (items) => { host._draftAliasScope.aliases = items; },
      create: () => aliasManager.createEmptyAlias(),
      getPattern: (item) => item.trigger,
      setPattern: (item, value) => { item.trigger = value; },
      patternLabel: 'Pattern',
      patternPlaceholder: (item) => (item.isRegex ? '^gi\\s+(.+)$' : 'gi'),
      emptyText: 'No aliases defined for this scope.',
      emptyDetailText: 'Create an alias to start building client-side command shortcuts.',
      nameRequired: true,
      namePlaceholder: 'Give to pack animal',
      haystack: (item) => (item.trigger + ' ' + item.description + ' ' + (item.group || '')).toLowerCase(),
      rowMeta: (item) => (String(item.description || '').trim()
        ? item.trigger
        : (item.isRegex ? 'regex, ' : '') + item.steps.length + ' step' + (item.steps.length === 1 ? '' : 's')),
      diagnostics: (item) => aliasManager.getAliasDiagnostics(host._draftAliasScope, item.id),
      initialSelectedId: () => {
        const pending = host._pendingAliasSelection;
        host._pendingAliasSelection = null;
        return pending;
      },
      flags: (item, api) => [
        createFlagPill('Enabled', 'Disabled aliases stay saved but never match or expand.',
          item.enabled !== false, (checked) => { item.enabled = checked; api.render(); }),
        createFlagPill('Regex', 'Treat the pattern as a JavaScript regular expression. Capture groups become %1-%9.',
          item.isRegex === true, (checked) => { item.isRegex = checked; api.render(); }),
        item.isRegex ? createFlagPill('Ignore case', 'Match without caring about capitalization.',
          item.ignoreCase !== false, (checked) => { item.ignoreCase = checked; api.render(); }) : null,
      ].filter(Boolean),
      renderBody: (item, api, container) => {
        appendStepsEditor(container, item, {
          focusPrefix: 'alias',
          toggleTargetType: 'set_trigger_enabled',
          targetNoun: 'trigger',
          targetItems: () => host._draftTriggerScope.triggers,
          targetPattern: (item) => item.pattern,
          targetConfigs: {
            set_trigger_enabled: {
              targetNoun: 'trigger',
              targetItems: () => host._draftTriggerScope.triggers,
              targetPattern: (item) => item.pattern,
            },
            set_timer_enabled: {
              targetNoun: 'timer',
              targetItems: () => host._draftTimerScope.timers,
              targetPattern: (item) => item.name,
              useDescription: false,
            },
            control_timer: {
              targetNoun: 'timer',
              targetItems: () => host._draftTimerScope.timers,
              targetPattern: (item) => item.name,
              useDescription: false,
            },
          },
          runAliasItems: () => host._draftAliasScope.aliases,
          runAliasPattern: (item) => item.trigger,
          functionItems: () => host._draftFunctionScope.functions,
          functionPattern: (item) => item.name,
          variableNamePlaceholder: 'pack',
          sounds,
          stepTypes: [
            { value: 'send_command', type: 'send_command', label: 'Send command' },
            { value: 'set_variable', type: 'set_variable', label: 'Set variable' },
            { value: 'show_message', type: 'show_message', label: 'Show local message' },
            { value: 'script', type: 'script', label: 'Run script' },
            { value: 'call_function', type: 'call_function', label: 'Call function' },
            { value: 'set_trigger_enabled:toggle', type: 'set_trigger_enabled', mode: 'toggle', label: 'Toggle trigger' },
            { value: 'set_trigger_enabled:enable', type: 'set_trigger_enabled', mode: 'enable', label: 'Enable trigger' },
            { value: 'set_trigger_enabled:disable', type: 'set_trigger_enabled', mode: 'disable', label: 'Disable trigger' },
            { value: 'set_timer_enabled:toggle', type: 'set_timer_enabled', mode: 'toggle', label: 'Toggle timer' },
            { value: 'set_timer_enabled:enable', type: 'set_timer_enabled', mode: 'enable', label: 'Enable timer' },
            { value: 'set_timer_enabled:disable', type: 'set_timer_enabled', mode: 'disable', label: 'Disable timer' },
            { value: 'control_timer:start', type: 'control_timer', mode: 'start', label: 'Start timer' },
            { value: 'control_timer:stop', type: 'control_timer', mode: 'stop', label: 'Stop timer' },
            { value: 'control_timer:reset', type: 'control_timer', mode: 'reset', label: 'Reset timer' },
            { value: 'control_timer:run', type: 'control_timer', mode: 'run', label: 'Run timer now' },
          ],
          scriptPlaceholder: 'while $charges > 0\n  send use wand\n  set $charges = {$charges - 1}\nend',
          templatePlaceholder: (step) => (
            step.type === 'show_message' ? 'Pack animal set to: $pack'
              : step.type === 'set_variable' ? '%0'
                : 'give %0 to $pack'
          ),
          syntaxHelp: 'Simple aliases match command words; %0 is everything after the alias. '
            + 'Regex aliases use JavaScript regular expressions with capture groups as %1-%9. '
            + 'Templates support $name variables and ${lower:%1} or ${lower:$name} for lowercase. '
            + 'Scripts support if/elseif/else/while/end, break, continue, send, show, set $name = value, run_alias, call, and trigger/timer controls.',
        }, api);
      },
      preview: {
        title: 'Test input',
        hint: 'Type a command line to see which alias matches and what it will do.',
        defaultSample: '',
        makeInput: (onInput) => {
          const input = el('input', 'dw-input');
          input.type = 'text';
          input.placeholder = 'Example: gi sword';
          input.addEventListener('input', () => onInput(input.value));
          return input;
        },
        render: (body, sample) => {
          body.textContent = '';
          if (!sample.trim()) return '';
          const match = aliasManager.matchAliasInAliases(sample, host._draftAliasScope.aliases);
          if (!match) {
            body.appendChild(el('div', 'settings-alias-empty', 'No enabled alias matches this input.'));
            return 'no match';
          }
          body.appendChild(el('div', 'settings-alias-preview-match', 'Matches: ' + match.alias.trigger));

          const previewVariables = draftAutomationVariables(host);
          const previewTriggers = host._draftTriggerScope.triggers.map((trigger) => ({ ...trigger }));
          const previewTimers = host._draftTimerScope.timers.map((timer) => ({ ...timer }));

          for (const step of match.alias.steps) {
            const templateContext = { args: match.args, remainder: match.remainder, variables: previewVariables };
            const renderPreviewStep = (previewStep) => {
              if (previewStep.type === 'set_trigger_enabled' && previewStep.targetId) {
                appendTargetIdPreviewRow(body, previewStep, previewTriggers, (item) => item.pattern);
                return;
              }
              if ((previewStep.type === 'set_timer_enabled' || previewStep.type === 'control_timer')
                && previewStep.targetId) {
                appendTargetIdPreviewRow(body, previewStep, previewTimers, (item) => item.name, { useDescription: false });
                return;
              }

              const resolved = aliasManager.resolveTemplate(
                previewStep.type === 'set_trigger_enabled' ? previewStep.target : previewStep.template,
                { args: match.args, remainder: match.remainder, variables: previewVariables }
              );

              if (previewStep.type === 'set_trigger_enabled') {
                const target = resolved.text.trim();
                const mode = normalizeAutomationMode(previewStep.mode);
                const trigger = previewTriggers.find((item) => item.pattern === target);
                const { row, ok } = appendResolvedStepRow(body, getAutomationStepLabel(previewStep), { ...resolved, text: target });
                if (!ok) return;
                if (!target || !trigger) {
                  row.classList.add('warning');
                  row.textContent += target ? ' (trigger not found)' : ' (empty target)';
                } else {
                  trigger.enabled = mode === 'toggle' ? trigger.enabled === false : mode === 'enable';
                  row.textContent += ' -> ' + (trigger.enabled === false ? 'disabled' : 'enabled');
                }
                return;
              }

              let prefix = 'Send';
              if (previewStep.type === 'set_variable') prefix = 'Set $' + previewStep.name;
              if (previewStep.type === 'show_message') prefix = 'Show';
              if (previewStep.type === 'run_alias') prefix = 'Run alias';
              const displayResolved = maybeEvaluateSetPreview(previewStep, resolved);
              const { ok } = appendResolvedStepRow(body, prefix, displayResolved);
              if (ok && previewStep.type === 'set_variable' && previewStep.name) previewVariables[previewStep.name] = displayResolved.text;
            };

            if (step.type === 'script') {
              appendScriptPreviewRows(body, step.script, templateContext, renderPreviewStep);
              continue;
            }

            if ((step.type === 'set_trigger_enabled' || step.type === 'set_timer_enabled' || step.type === 'control_timer')
              && step.targetId) {
              appendTargetIdPreviewRow(body, step,
                step.type === 'set_trigger_enabled' ? previewTriggers : previewTimers,
                (item) => step.type === 'set_trigger_enabled' ? item.pattern : item.name,
                step.type === 'set_trigger_enabled' ? {} : { useDescription: false });
              continue;
            }
            if (step.type === 'call_function') {
              appendFunctionPreviewRow(body, step, host._draftFunctionScope.functions, templateContext);
              continue;
            }

            const resolved = aliasManager.resolveTemplate(
              step.type === 'set_trigger_enabled' ? step.target : step.template,
              { args: match.args, remainder: match.remainder, variables: previewVariables }
            );

            if (step.type === 'set_trigger_enabled') {
              const target = resolved.text.trim();
              const mode = normalizeAutomationMode(step.mode);
              const trigger = previewTriggers.find((item) => item.pattern === target);
              const { row, ok } = appendResolvedStepRow(body, getAutomationStepLabel(step), { ...resolved, text: target });
              if (!ok) continue;
              if (!target || !trigger) {
                row.classList.add('warning');
                row.textContent += target ? ' (trigger not found)' : ' (empty target)';
              } else {
                trigger.enabled = mode === 'toggle' ? trigger.enabled === false : mode === 'enable';
                row.textContent += ' -> ' + (trigger.enabled === false ? 'disabled' : 'enabled');
              }
              continue;
            }

            let prefix = 'Send';
            if (step.type === 'set_variable') prefix = 'Set $' + step.name;
            if (step.type === 'show_message') prefix = 'Show';
            const displayResolved = maybeEvaluateSetPreview(step, resolved);
            const { row, ok } = appendResolvedStepRow(body, prefix, displayResolved);
            if (!ok) continue;
            if (step.type === 'set_variable' && step.name) previewVariables[step.name] = displayResolved.text;
          }
          return 'matches ' + match.alias.trigger;
        },
      },
    };
  }

  if (kind === 'trigger') {
    const sounds = makeSoundKit();
    return {
      kind,
      noun: 'trigger',
      plural: 'triggers',
      scopeKey: () => host._triggerScopeKey,
      scopeHint: 'Triggers are saved separately for each server connection target and react to incoming output lines.',
      list: () => host._draftTriggerScope.triggers,
      replaceList: (items) => { host._draftTriggerScope.triggers = items; },
      create: () => triggerManager.createEmptyTrigger(),
      getPattern: (item) => item.pattern,
      setPattern: (item, value) => { item.pattern = value; },
      patternLabel: 'Pattern',
      patternPlaceholder: (item) => (item.isRegex ? 'You are attacked by (.+)' : 'You are attacked by *'),
      emptyText: 'No triggers defined for this scope.',
      emptyDetailText: 'Create a trigger to react to incoming output lines.',
      nameRequired: true,
      namePlaceholder: 'Attack response',
      haystack: (item) => (item.pattern + ' ' + item.description + ' ' + (item.group || '')).toLowerCase(),
      rowMeta: (item) => {
        if (String(item.description || '').trim()) return item.pattern;
        const prefix = item.isRegex ? 'regex, ' : '';
        if (item.gag) return prefix + 'gag enabled';
        if (item.steps[0] && item.steps[0].type === 'play_sound') {
          return prefix + 'Play sound: ' + sounds.label(item.steps[0].category, item.steps[0].sound);
        }
        return prefix + item.steps.length + ' step' + (item.steps.length === 1 ? '' : 's');
      },
      diagnostics: (item) => triggerManager.getTriggerDiagnostics(host._draftTriggerScope, item.id),
      flags: (item, api) => [
        createFlagPill('Enabled', 'Disabled triggers stay saved but never match incoming output.',
          item.enabled !== false, (checked) => { item.enabled = checked; api.render(); }),
        createFlagPill('Regex', 'Treat the pattern as a JavaScript regular expression. Capture groups become %1-%9.',
          item.isRegex === true, (checked) => { item.isRegex = checked; api.render(); }),
        item.isRegex ? createFlagPill('Ignore case', 'Match without caring about capitalization.',
          item.ignoreCase === true, (checked) => { item.ignoreCase = checked; api.render(); }) : null,
        createFlagPill('Gag line', 'Hide matched lines from the terminal after this trigger runs.',
          item.gag === true, (checked) => { item.gag = checked; api.renderPreview(); }),
      ].filter(Boolean),
      renderBody: (item, api, container) => {
        appendStepsEditor(container, item, {
          focusPrefix: 'trigger',
          toggleTargetType: 'set_alias_enabled',
          targetNoun: 'alias',
          targetItems: () => host._draftAliasScope.aliases,
          targetPattern: (item) => item.trigger,
          targetConfigs: {
            set_alias_enabled: {
              targetNoun: 'alias',
              targetItems: () => host._draftAliasScope.aliases,
              targetPattern: (item) => item.trigger,
            },
            set_timer_enabled: {
              targetNoun: 'timer',
              targetItems: () => host._draftTimerScope.timers,
              targetPattern: (item) => item.name,
              useDescription: false,
            },
            control_timer: {
              targetNoun: 'timer',
              targetItems: () => host._draftTimerScope.timers,
              targetPattern: (item) => item.name,
              useDescription: false,
            },
          },
          runAliasItems: () => host._draftAliasScope.aliases,
          runAliasPattern: (item) => item.trigger,
          functionItems: () => host._draftFunctionScope.functions,
          functionPattern: (item) => item.name,
          variableNamePlaceholder: 'enemy',
          sounds,
          stepTypes: [
            { value: 'send_command', type: 'send_command', label: 'Send command' },
            { value: 'set_variable', type: 'set_variable', label: 'Set variable' },
            { value: 'show_message', type: 'show_message', label: 'Show local message' },
            { value: 'script', type: 'script', label: 'Run script' },
            { value: 'call_function', type: 'call_function', label: 'Call function' },
            { value: 'set_alias_enabled:toggle', type: 'set_alias_enabled', mode: 'toggle', label: 'Toggle alias' },
            { value: 'set_alias_enabled:enable', type: 'set_alias_enabled', mode: 'enable', label: 'Enable alias' },
            { value: 'set_alias_enabled:disable', type: 'set_alias_enabled', mode: 'disable', label: 'Disable alias' },
            { value: 'run_alias', type: 'run_alias', label: 'Run alias' },
            { value: 'play_sound', type: 'play_sound', label: 'Play sound' },
            { value: 'set_timer_enabled:toggle', type: 'set_timer_enabled', mode: 'toggle', label: 'Toggle timer' },
            { value: 'set_timer_enabled:enable', type: 'set_timer_enabled', mode: 'enable', label: 'Enable timer' },
            { value: 'set_timer_enabled:disable', type: 'set_timer_enabled', mode: 'disable', label: 'Disable timer' },
            { value: 'control_timer:start', type: 'control_timer', mode: 'start', label: 'Start timer' },
            { value: 'control_timer:stop', type: 'control_timer', mode: 'stop', label: 'Stop timer' },
            { value: 'control_timer:reset', type: 'control_timer', mode: 'reset', label: 'Reset timer' },
            { value: 'control_timer:run', type: 'control_timer', mode: 'run', label: 'Run timer now' },
          ],
          scriptPlaceholder: 'if %1 matches /orc|goblin/i\n  run_alias assist %1\nelseif $hp < 50\n  send drink healing potion\nelse\n  show Trigger matched: %0\nend',
          templatePlaceholder: (step) => (
            step.type === 'show_message' ? 'Attacker: %1'
              : step.type === 'set_variable' ? '%1'
                : step.type === 'run_alias' ? 'assist %1'
                  : 'kill %1'
          ),
          syntaxHelp: 'Simple patterns support * or %1-%9 as captures. '
            + 'Regex triggers use JavaScript regular expressions with capture groups as %1-%9. '
            + 'Templates support %0 for the full match, $name variables, and ${lower:%1} or ${lower:$name} for lowercase. '
            + 'Scripts support if/elseif/else/while/end, break, continue, send, show, set $name = value, run_alias, call, play_sound, and alias/timer controls.',
        }, api);
      },
      preview: {
        title: 'Test output',
        hint: 'Paste an incoming line to see which triggers match, what they capture, and what they will run.',
        defaultSample: '',
        makeInput: (onInput) => {
          const input = el('textarea', 'dw-input settings-alias-template settings-preview-sample');
          input.placeholder = 'Example incoming line';
          input.addEventListener('input', () => onInput(input.value));
          return input;
        },
        render: (body, sample) => {
          body.textContent = '';
          if (!sample.trim()) return '';
          const result = triggerManager.evaluateLine(sample, host._triggerScopeKey, host._draftTriggerScope);
          if (!result.matches.length) {
            body.appendChild(el('div', 'settings-alias-empty', 'No enabled trigger matches this output.'));
            return 'no match';
          }

          const previewVariables = draftAutomationVariables(host);
          const previewAliases = host._draftAliasScope.aliases.map((alias) => ({
            ...alias,
            steps: alias.steps.map((step) => ({ ...step })),
          }));
          const previewTimers = host._draftTimerScope.timers.map((timer) => ({ ...timer }));

          result.matches.forEach((match) => {
            body.appendChild(el('div', 'settings-alias-preview-match',
              'Matches: ' + match.trigger.pattern + (match.trigger.gag ? ' [gag]' : '')));
            body.appendChild(el('div', 'settings-helper-text', match.captures.length
              ? match.captures.map((value, index) => '%' + (index + 1) + '=' + value).join(' | ')
              : 'No captures'));

            for (const step of match.trigger.steps || []) {
              const templateContext = { args: match.captures, remainder: match.fullMatch, variables: previewVariables };
              const renderPreviewStep = (previewStep) => {
                if (previewStep.type === 'play_sound') {
                  const row = el('div', 'settings-alias-preview-step',
                    getAutomationStepLabel(previewStep) + ': ' + sounds.label(previewStep.category, previewStep.sound));
                  if (!isKnownSound(previewStep.category, previewStep.sound)) {
                    row.classList.add('warning');
                    row.textContent += ' (sound not found)';
                  }
                  body.appendChild(row);
                  return;
                }

                if (previewStep.type === 'set_alias_enabled' && previewStep.targetId) {
                  appendTargetIdPreviewRow(body, previewStep, previewAliases, (item) => item.trigger);
                  return;
                }
                if ((previewStep.type === 'set_timer_enabled' || previewStep.type === 'control_timer')
                  && previewStep.targetId) {
                  appendTargetIdPreviewRow(body, previewStep, previewTimers, (item) => item.name, { useDescription: false });
                  return;
                }
                if (previewStep.type === 'call_function') {
                  appendFunctionPreviewRow(body, previewStep, host._draftFunctionScope.functions, templateContext);
                  return;
                }

                const resolved = aliasManager.resolveTemplate(
                  previewStep.type === 'set_alias_enabled' ? previewStep.target : previewStep.template,
                  { args: match.captures, remainder: match.fullMatch, variables: previewVariables }
                );

                if (previewStep.type === 'set_alias_enabled') {
                  const target = resolved.text.trim();
                  const mode = normalizeAutomationMode(previewStep.mode);
                  const alias = previewAliases.find((item) => (
                    item.trigger.trim().replace(/\s+/g, ' ').toLowerCase() === target.trim().replace(/\s+/g, ' ').toLowerCase()
                  ));
                  const { row, ok } = appendResolvedStepRow(body, getAutomationStepLabel(previewStep), { ...resolved, text: target });
                  if (!ok) return;
                  if (!target || !alias) {
                    row.classList.add('warning');
                    row.textContent += target ? ' (alias not found)' : ' (empty target)';
                  } else {
                    alias.enabled = mode === 'toggle' ? alias.enabled === false : mode === 'enable';
                    row.textContent += ' -> ' + (alias.enabled === false ? 'disabled' : 'enabled');
                  }
                  return;
                }

                if (previewStep.type === 'run_alias') {
                  const { row, ok } = appendResolvedStepRow(body, getAutomationStepLabel(previewStep), resolved);
                  if (!ok) return;
                  const aliasMatch = aliasManager.matchAliasInAliases(resolved.text, previewAliases);
                  if (!aliasMatch) {
                    row.classList.add('warning');
                    row.textContent += ' (no enabled alias matches)';
                  } else {
                    row.textContent += ' -> ' + aliasMatch.alias.trigger;
                  }
                  return;
                }

                let prefix = 'Send';
                if (previewStep.type === 'set_variable') prefix = 'Set $' + previewStep.name;
                if (previewStep.type === 'show_message') prefix = 'Show';
                const displayResolved = maybeEvaluateSetPreview(previewStep, resolved);
                const { ok } = appendResolvedStepRow(body, prefix, displayResolved);
                if (ok && previewStep.type === 'set_variable' && previewStep.name) previewVariables[previewStep.name] = displayResolved.text;
              };

              if (step.type === 'script') {
                appendScriptPreviewRows(body, step.script, templateContext, renderPreviewStep);
                continue;
              }

              if (step.type === 'play_sound') {
                const row = el('div', 'settings-alias-preview-step',
                  getAutomationStepLabel(step) + ': ' + sounds.label(step.category, step.sound));
                if (!isKnownSound(step.category, step.sound)) {
                  row.classList.add('warning');
                  row.textContent += ' (sound not found)';
                }
                body.appendChild(row);
                continue;
              }

              if ((step.type === 'set_alias_enabled' || step.type === 'set_timer_enabled' || step.type === 'control_timer')
                && step.targetId) {
                appendTargetIdPreviewRow(body, step,
                  step.type === 'set_alias_enabled' ? previewAliases : previewTimers,
                  (item) => step.type === 'set_alias_enabled' ? item.trigger : item.name,
                  step.type === 'set_alias_enabled' ? {} : { useDescription: false });
                continue;
              }
              if (step.type === 'call_function') {
                appendFunctionPreviewRow(body, step, host._draftFunctionScope.functions, templateContext);
                continue;
              }

              const resolved = aliasManager.resolveTemplate(
                step.type === 'set_alias_enabled' ? step.target : step.template,
                { args: match.captures, remainder: match.fullMatch, variables: previewVariables }
              );

              if (step.type === 'set_alias_enabled') {
                const target = resolved.text.trim();
                const mode = normalizeAutomationMode(step.mode);
                const alias = previewAliases.find((item) => (
                  item.trigger.trim().replace(/\s+/g, ' ').toLowerCase() === target.trim().replace(/\s+/g, ' ').toLowerCase()
                ));
                const { row, ok } = appendResolvedStepRow(body, getAutomationStepLabel(step), { ...resolved, text: target });
                if (!ok) continue;
                if (!target || !alias) {
                  row.classList.add('warning');
                  row.textContent += target ? ' (alias not found)' : ' (empty target)';
                } else {
                  alias.enabled = mode === 'toggle' ? alias.enabled === false : mode === 'enable';
                  row.textContent += ' -> ' + (alias.enabled === false ? 'disabled' : 'enabled');
                }
                continue;
              }

              if (step.type === 'run_alias') {
                const { row, ok } = appendResolvedStepRow(body, getAutomationStepLabel(step), resolved);
                if (!ok) continue;
                const aliasMatch = aliasManager.matchAliasInAliases(resolved.text, previewAliases);
                if (!aliasMatch) {
                  row.classList.add('warning');
                  row.textContent += ' (no enabled alias matches)';
                } else {
                  row.textContent += ' -> ' + aliasMatch.alias.trigger;
                }
                continue;
              }

              let prefix = 'Send';
              if (step.type === 'set_variable') prefix = 'Set $' + step.name;
              if (step.type === 'show_message') prefix = 'Show';
              const displayResolved = maybeEvaluateSetPreview(step, resolved);
              const { ok } = appendResolvedStepRow(body, prefix, displayResolved);
              if (ok && step.type === 'set_variable' && step.name) previewVariables[step.name] = displayResolved.text;
            }
          });
          return result.matches.length + ' match' + (result.matches.length === 1 ? '' : 'es');
        },
      },
    };
  }

  if (kind === 'timer') {
    const formatDuration = (ms) => {
      const seconds = Math.max(1, Math.round(Number(ms) / 1000));
      if (seconds < 60) return seconds + 's';
      const minutes = Math.floor(seconds / 60);
      const rem = seconds % 60;
      return minutes + 'm' + (rem ? ' ' + rem + 's' : '');
    };

    return {
      kind,
      noun: 'timer',
      plural: 'timers',
      scopeKey: () => host._timerScopeKey,
      scopeHint: 'Timers are saved separately for each server connection target and run while Darkflow is open and connected.',
      list: () => host._draftTimerScope.timers,
      replaceList: (items) => { host._draftTimerScope.timers = items; },
      create: () => timerManager.createEmptyTimer(),
      getPattern: (item) => item.name,
      setPattern: (item, value) => { item.name = value; },
      patternLabel: 'Timer name',
      patternPlaceholder: () => 'rebuff',
      emptyText: 'No timers defined for this scope.',
      emptyDetailText: 'Create a timer to run client-side automation after a delay.',
      showNameField: false,
      nameRequired: false,
      namePlaceholder: 'Optional note shown in the list',
      haystack: (item) => (item.name + ' ' + (item.group || '')).toLowerCase(),
      rowMeta: (item) => formatDuration(item.durationMs)
        + (item.recurring ? ', recurring' : ', once')
        + (item.autoStart ? ', auto-start' : '')
        + ' | ' + item.steps.length + ' step' + (item.steps.length === 1 ? '' : 's'),
      diagnostics: (item) => timerManager.getTimerDiagnostics(host._draftTimerScope, item.id),
      flags: (item, api) => [
        createFlagPill('Enabled', 'Disabled timers stay saved but cannot be started.',
          item.enabled !== false, (checked) => { item.enabled = checked; api.render(); }),
        createFlagPill('Recurring', 'Run again after each successful firing.',
          item.recurring === true, (checked) => { item.recurring = checked; api.render(); }),
        createFlagPill('Auto-start', 'Start this timer automatically when Darkflow connects.',
          item.autoStart === true, (checked) => { item.autoStart = checked; api.render(); }),
      ],
      renderBody: (item, api, container) => {
        const timingGrid = el('div', 'settings-meta-grid');
        const secondsField = el('label', 'dw-field');
        secondsField.appendChild(el('div', 'settings-label', 'Duration seconds'));
        const secondsInput = el('input', 'dw-input');
        secondsInput.type = 'number';
        secondsInput.min = '1';
        secondsInput.step = '1';
        secondsInput.value = String(Math.max(1, Math.round(Number(item.durationMs || 60000) / 1000)));
        secondsInput.addEventListener('input', () => {
          const seconds = Math.max(1, Math.round(Number(secondsInput.value) || 1));
          item.durationMs = seconds * 1000;
          api.renderDiagnostics();
          api.renderPreview();
        });
        secondsInput.addEventListener('blur', () => api.render());
        secondsField.appendChild(secondsInput);
        timingGrid.appendChild(secondsField);
        container.appendChild(timingGrid);

        const controlRow = el('div', 'settings-timer-control-row');
        const status = el('span', 'settings-helper-text', '');
        const showResult = (result, action) => {
          if (!result || !result.target) {
            status.textContent = 'Apply settings before controlling this timer.';
            return;
          }
          status.textContent = 'Timer "' + result.target.name + '" ' + action + '.';
        };
        const controlButton = (label, action, fn) => {
          const btn = smallButton(label, label + ' this timer', () => {
            showResult(fn(item.id, host._timerScopeKey), action);
          });
          return btn;
        };
        controlRow.appendChild(controlButton('Start', 'started', (id, scopeKey) => timerManager.startTimerById(id, scopeKey)));
        controlRow.appendChild(controlButton('Stop', 'stopped', (id, scopeKey) => timerManager.stopTimerById(id, scopeKey)));
        controlRow.appendChild(controlButton('Reset', 'reset', (id, scopeKey) => timerManager.resetTimerById(id, scopeKey)));
        controlRow.appendChild(controlButton('Run now', 'run', (id, scopeKey) => timerManager.runTimerById(id, scopeKey)));
        controlRow.appendChild(status);
        container.appendChild(controlRow);

        appendStepsEditor(container, item, {
          focusPrefix: 'timer',
          targetConfigs: {
            set_alias_enabled: {
              targetNoun: 'alias',
              targetItems: () => host._draftAliasScope.aliases,
              targetPattern: (item) => item.trigger,
            },
            set_trigger_enabled: {
              targetNoun: 'trigger',
              targetItems: () => host._draftTriggerScope.triggers,
              targetPattern: (item) => item.pattern,
            },
            set_timer_enabled: {
              targetNoun: 'timer',
              targetItems: () => host._draftTimerScope.timers,
              targetPattern: (item) => item.name,
              useDescription: false,
            },
            control_timer: {
              targetNoun: 'timer',
              targetItems: () => host._draftTimerScope.timers,
              targetPattern: (item) => item.name,
              useDescription: false,
            },
          },
          runAliasItems: () => host._draftAliasScope.aliases,
          runAliasPattern: (item) => item.trigger,
          functionItems: () => host._draftFunctionScope.functions,
          functionPattern: (item) => item.name,
          variableNamePlaceholder: 'last_timer',
          stepTypes: [
            { value: 'send_command', type: 'send_command', label: 'Send command' },
            { value: 'set_variable', type: 'set_variable', label: 'Set variable' },
            { value: 'show_message', type: 'show_message', label: 'Show local message' },
            { value: 'script', type: 'script', label: 'Run script' },
            { value: 'run_alias', type: 'run_alias', label: 'Run alias' },
            { value: 'call_function', type: 'call_function', label: 'Call function' },
            { value: 'set_alias_enabled:toggle', type: 'set_alias_enabled', mode: 'toggle', label: 'Toggle alias' },
            { value: 'set_alias_enabled:enable', type: 'set_alias_enabled', mode: 'enable', label: 'Enable alias' },
            { value: 'set_alias_enabled:disable', type: 'set_alias_enabled', mode: 'disable', label: 'Disable alias' },
            { value: 'set_trigger_enabled:toggle', type: 'set_trigger_enabled', mode: 'toggle', label: 'Toggle trigger' },
            { value: 'set_trigger_enabled:enable', type: 'set_trigger_enabled', mode: 'enable', label: 'Enable trigger' },
            { value: 'set_trigger_enabled:disable', type: 'set_trigger_enabled', mode: 'disable', label: 'Disable trigger' },
            { value: 'set_timer_enabled:toggle', type: 'set_timer_enabled', mode: 'toggle', label: 'Toggle timer' },
            { value: 'set_timer_enabled:enable', type: 'set_timer_enabled', mode: 'enable', label: 'Enable timer' },
            { value: 'set_timer_enabled:disable', type: 'set_timer_enabled', mode: 'disable', label: 'Disable timer' },
            { value: 'control_timer:start', type: 'control_timer', mode: 'start', label: 'Start timer' },
            { value: 'control_timer:stop', type: 'control_timer', mode: 'stop', label: 'Stop timer' },
            { value: 'control_timer:reset', type: 'control_timer', mode: 'reset', label: 'Reset timer' },
            { value: 'control_timer:run', type: 'control_timer', mode: 'run', label: 'Run timer now' },
          ],
          scriptPlaceholder: 'send cast armor\nshow Rebuff timer fired.\nreset_timer rebuff',
          templatePlaceholder: (step) => (
            step.type === 'show_message' ? 'Timer %0 fired.'
              : step.type === 'set_variable' ? '%0'
                : step.type === 'run_alias' ? 'rebuff'
                  : 'look'
          ),
          syntaxHelp: 'Timer templates use %0 for the timer name plus $name variables. '
            + 'Scripts support if/elseif/else/while/end, break, continue, send, show, set $name = value, run_alias, call, and alias/trigger/timer controls.',
        }, api);
      },
      preview: {
        title: 'Timer preview',
        hint: 'Shows the current timer schedule and actions without starting it.',
        defaultSample: '',
        makeInput: () => {
          const note = el('div', 'settings-helper-text', 'Timer steps run when the countdown fires. Use Start timer from this tab or another automation to begin.');
          return note;
        },
        render: (body, sample, selected) => {
          body.textContent = '';
          if (!selected) return '';
          body.appendChild(el('div', 'settings-alias-preview-match',
            'Runs ' + (selected.recurring ? 'every ' : 'after ') + formatDuration(selected.durationMs)
            + (selected.autoStart ? ' when connected' : ' when started')));
          const previewVariables = draftAutomationVariables(host);
          const templateContext = {
            args: [selected.name],
            remainder: selected.name,
            variables: previewVariables,
          };
          const renderPreviewStep = (step) => {
            if ((step.type === 'set_alias_enabled'
              || step.type === 'set_trigger_enabled'
              || step.type === 'set_timer_enabled'
              || step.type === 'control_timer') && step.targetId) {
              const items = step.type === 'set_alias_enabled'
                ? host._draftAliasScope.aliases
                : step.type === 'set_trigger_enabled'
                  ? host._draftTriggerScope.triggers
                  : host._draftTimerScope.timers;
              appendTargetIdPreviewRow(body, step, items.map((entry) => ({ ...entry })),
                (entry) => step.type === 'set_alias_enabled' ? entry.trigger
                  : step.type === 'set_trigger_enabled' ? entry.pattern
                    : entry.name,
                step.type === 'set_timer_enabled' || step.type === 'control_timer'
                  ? { useDescription: false } : {});
              return;
            }
            if (step.type === 'call_function') {
              appendFunctionPreviewRow(body, step, host._draftFunctionScope.functions, templateContext);
              return;
            }
            const resolved = aliasManager.resolveTemplate(
              step.type === 'set_alias_enabled'
                || step.type === 'set_trigger_enabled'
                || step.type === 'set_timer_enabled'
                || step.type === 'control_timer'
                ? step.target : step.template,
              templateContext
            );
            const label = step.type === 'set_variable' ? 'Set $' + step.name : getAutomationStepLabel(step);
            const displayResolved = maybeEvaluateSetPreview(step, resolved);
            const { ok } = appendResolvedStepRow(body, label, displayResolved);
            if (ok && step.type === 'set_variable' && step.name) previewVariables[step.name] = displayResolved.text;
          };

          for (const step of selected.steps || []) {
            if (step.type === 'script') {
              appendScriptPreviewRows(body, step.script, templateContext, renderPreviewStep);
            } else {
              renderPreviewStep(step);
            }
          }
          return selected.steps.length + ' step' + (selected.steps.length === 1 ? '' : 's');
        },
      },
    };
  }

  if (kind === 'function') {
    return {
      kind,
      noun: 'function',
      plural: 'functions',
      scopeKey: () => host._functionScopeKey,
      scopeHint: 'Functions are saved separately for each server connection target and can be called from aliases, triggers, timers, and scripts.',
      list: () => host._draftFunctionScope.functions,
      replaceList: (items) => { host._draftFunctionScope.functions = items; },
      create: () => functionManager.createEmptyFunction(),
      getPattern: (item) => item.name,
      setPattern: (item, value) => { item.name = String(value || '').trim().toLowerCase(); },
      patternLabel: 'Function name',
      patternPlaceholder: () => 'assist_target',
      emptyText: 'No functions defined for this scope.',
      emptyDetailText: 'Create a function to reuse script logic from aliases, triggers, and timers.',
      nameRequired: false,
      namePlaceholder: 'Optional note shown in the list',
      haystack: (item) => (item.name + ' ' + item.description + ' ' + (item.group || '') + ' ' + item.script).toLowerCase(),
      rowMeta: (item) => {
        const parsed = parseAutomationScript(item.script || '');
        if (parsed.diagnostics.length) return parsed.diagnostics.length + ' script issue' + (parsed.diagnostics.length === 1 ? '' : 's');
        return countScriptActions(parsed.ast) + ' action' + (countScriptActions(parsed.ast) === 1 ? '' : 's');
      },
      diagnostics: (item) => functionManager.getFunctionDiagnostics(host._draftFunctionScope, item.id),
      flags: (item, api) => [
        createFlagPill('Enabled', 'Disabled functions stay saved but cannot be called.',
          item.enabled !== false, (checked) => { item.enabled = checked; api.render(); }),
      ],
      renderBody: (item, api, container) => {
        container.appendChild(el('div', 'settings-label', 'Script'));
        const scriptInput = el('textarea', 'dw-input settings-alias-template settings-step-template');
        scriptInput.placeholder = 'send kill %1\nif $stance == defensive\n  show Using defensive follow-up.\nend';
        scriptInput.value = item.script || '';
        scriptInput.rows = 12;
        scriptInput.addEventListener('input', () => {
          item.script = scriptInput.value;
          api.renderDiagnostics();
          api.renderPreview();
        });
        container.appendChild(scriptInput);

        const help = el('details', 'settings-syntax-help');
        help.appendChild(el('summary', '', 'Function script syntax'));
        help.appendChild(el('p', 'dw-paragraph',
          'Functions receive arguments from the caller as %1-%9 and %0. '
          + 'Scripts support if/elseif/else/while/end, break, continue, send, show, set $name = value, run_alias, call, play_sound, and alias/trigger/timer controls.'));
        container.appendChild(help);
      },
      preview: {
        title: 'Function preview',
        hint: 'Enter sample arguments to see what this function would run.',
        defaultSample: '',
        makeInput: (onInput) => {
          const input = el('input', 'dw-input');
          input.type = 'text';
          input.placeholder = 'Sample args: orc shield';
          input.addEventListener('input', () => onInput(input.value));
          return input;
        },
        render: (body, sample, selected) => {
          body.textContent = '';
          if (!selected) return '';
          const args = String(sample || '').trim()
            ? String(sample || '').trim().split(/\s+/)
            : [];
          const previewVariables = draftAutomationVariables(host);
          const templateContext = {
            args,
            remainder: String(sample || '').trim(),
            variables: previewVariables,
          };
          const renderPreviewStep = (step) => {
            if (step.type === 'call_function') {
              appendFunctionPreviewRow(body, step, host._draftFunctionScope.functions, templateContext);
              return;
            }
            const resolved = aliasManager.resolveTemplate(
              step.type === 'set_alias_enabled'
                || step.type === 'set_trigger_enabled'
                || step.type === 'set_timer_enabled'
                || step.type === 'control_timer'
                ? step.target : step.template,
              templateContext
            );
            const label = step.type === 'set_variable' ? 'Set $' + step.name : getAutomationStepLabel(step);
            const displayResolved = maybeEvaluateSetPreview(step, resolved);
            const { ok } = appendResolvedStepRow(body, label, displayResolved);
            if (ok && step.type === 'set_variable' && step.name) previewVariables[step.name] = displayResolved.text;
          };
          appendScriptPreviewRows(body, selected.script, templateContext, renderPreviewStep);
          const parsed = parseAutomationScript(selected.script || '');
          if (parsed.diagnostics.length) return parsed.diagnostics.length + ' issue' + (parsed.diagnostics.length === 1 ? '' : 's');
          const total = countScriptActions(parsed.ast);
          return total + ' action' + (total === 1 ? '' : 's');
        },
      },
    };
  }

  // kind === 'highlight'
  return {
    kind,
    noun: 'highlight',
    plural: 'highlights',
    scopeKey: () => host._highlightScopeKey,
    scopeHint: 'Highlights are saved separately for each server connection target and recolor incoming terminal output.',
    list: () => host._draftHighlightScope.rules,
    replaceList: (items) => { host._draftHighlightScope.rules = items; },
    create: () => highlightManager.createEmptyRule(),
    getPattern: (item) => item.patternSource,
    setPattern: (item, value) => { item.patternSource = value; },
    patternLabel: 'Pattern (regex)',
    patternPlaceholder: () => 'You have emptied the keg!',
    emptyText: 'No highlight rules defined for this scope.',
    emptyDetailText: 'Create a highlight rule to start coloring matched terminal output.',
    nameRequired: false,
    namePlaceholder: 'Optional note shown in the list',
    haystack: (item) => (item.patternSource + ' ' + (item.description || '') + ' ' + (item.group || '')).toLowerCase(),
    rowMeta: (item) => highlightManager.formatRuleStyle(item) + (item.ignoreCase ? ' | ignore case' : ''),
    diagnostics: (item) => highlightManager.getRuleDiagnostics(host._draftHighlightScope, item.id),
    flags: (item, api) => [
      createFlagPill('Enabled', 'Disabled highlight rules stay saved but never recolor output.',
        item.enabled !== false, (checked) => { item.enabled = checked; api.render(); }),
      createFlagPill('Ignore case', 'Match without caring about capitalization.',
        item.ignoreCase === true, (checked) => { item.ignoreCase = checked; api.render(); }),
    ],
    renderBody: (item, api, container) => {
      container.appendChild(el('div', 'settings-label', 'Style'));
      const styleGrid = el('div', 'settings-highlight-style-grid');

      const fgField = el('label', 'dw-field');
      fgField.appendChild(el('div', 'settings-label', 'Foreground'));
      fgField.appendChild(host._createColorSelect(item.style.fg, (value) => {
        item.style.fg = value;
        api.renderPreview();
      }));
      styleGrid.appendChild(fgField);

      const bgField = el('label', 'dw-field');
      bgField.appendChild(el('div', 'settings-label', 'Background'));
      bgField.appendChild(host._createColorSelect(item.style.bg, (value) => {
        item.style.bg = value;
        api.renderPreview();
      }));
      styleGrid.appendChild(bgField);

      const boldWrap = el('div', 'settings-highlight-bold');
      boldWrap.appendChild(createFlagPill('Bold', 'Force matched text to render bold in addition to the selected colors.',
        item.style.bold === true, (checked) => { item.style.bold = checked; api.renderPreview(); }));
      styleGrid.appendChild(boldWrap);

      container.appendChild(styleGrid);
    },
    preview: {
      title: 'Test output',
      hint: 'Sample terminal text recolored with the current rules.',
      defaultSample: 'You have emptied the keg!',
      makeInput: (onInput) => {
        const input = el('textarea', 'dw-input settings-alias-template settings-preview-sample');
        input.placeholder = 'Sample terminal output';
        input.addEventListener('input', () => onInput(input.value));
        return input;
      },
      render: (body, sample) => {
        body.textContent = '';
        const line = el('div', 'settings-alias-preview-step');
        const fragments = highlightManager.applyHighlightsToText(sample, host._draftHighlightScope.rules);
        fragments.forEach((fragment) => {
          const node = styleToElement(fragment.text, fragment.style || {});
          if (node) line.appendChild(node);
        });
        body.appendChild(line);
        const styled = fragments.some((fragment) => fragment.style);
        return styled ? 'styled' : 'no match';
      },
    },
  };
}

export function createAutomationEditor(host, kind) {
  const cfg = buildConfig(host, kind);
  const focus = (key) => host._focusSettingsControl(key);

  const wrapper = el('div', 'settings-automation');

  // ---- toolbar -------------------------------------------------------
  const toolbar = el('div', 'settings-automation-toolbar');

  const search = el('input', 'dw-input');
  search.type = 'text';
  search.placeholder = 'Search ' + cfg.plural;
  search.dataset.focusKey = cfg.kind + '-search';
  toolbar.appendChild(search);

  const addBtn = el('button', 'dw-button dw-button-secondary', 'New ' + cfg.noun);
  addBtn.type = 'button';
  addBtn.dataset.focusKey = cfg.kind + '-add';
  toolbar.appendChild(addBtn);

  const scopeChip = el('span', 'settings-scope-chip', cfg.scopeKey());
  scopeChip.title = cfg.scopeHint + ' Active scope: ' + cfg.scopeKey();
  toolbar.appendChild(scopeChip);
  wrapper.appendChild(toolbar);

  const groupFilters = el('div', 'settings-automation-group-filters');
  groupFilters.hidden = true;
  wrapper.appendChild(groupFilters);

  // ---- layout --------------------------------------------------------
  const layout = el('div', 'settings-automation-layout');
  const listPane = el('div', 'settings-automation-list-pane');
  listPane.dataset.editFocusScope = cfg.kind + '-editor';
  const list = el('div', 'settings-automation-list');
  const listActions = el('div', 'settings-automation-list-actions');
  listPane.appendChild(list);
  listPane.appendChild(listActions);

  const detail = el('div', 'settings-automation-detail');
  detail.dataset.editFocusScope = cfg.kind + '-editor';

  layout.appendChild(listPane);
  layout.appendChild(detail);
  wrapper.appendChild(layout);

  // ---- preview bar ----------------------------------------------------
  const preview = el('div', 'settings-automation-preview');
  preview.dataset.editFocusScope = cfg.kind + '-editor';
  const previewHead = el('div', 'settings-preview-head');
  const previewTitle = el('span', 'settings-label', cfg.preview.title);
  previewTitle.title = cfg.preview.hint;
  const previewSummary = el('span', 'settings-preview-summary');
  const previewToggle = el('button', 'dw-button dw-button-secondary settings-step-btn');
  previewToggle.type = 'button';
  previewHead.appendChild(previewTitle);
  previewHead.appendChild(previewSummary);
  previewHead.appendChild(previewToggle);
  preview.appendChild(previewHead);

  const previewBody = el('div', 'settings-preview-body');
  let sample = cfg.preview.defaultSample;
  const sampleInput = cfg.preview.makeInput((value) => {
    sample = value;
    renderPreviewBody();
  });
  sampleInput.value = sample;
  const previewResults = el('div', 'settings-alias-preview-results settings-preview-results');
  previewBody.appendChild(sampleInput);
  previewBody.appendChild(previewResults);
  preview.appendChild(previewBody);
  wrapper.appendChild(preview);

  let previewCollapsed = loadAutomationUiState().previewCollapsed === true;
  const syncPreviewCollapsed = () => {
    previewBody.style.display = previewCollapsed ? 'none' : '';
    previewToggle.textContent = previewCollapsed ? 'Show' : 'Hide';
    previewToggle.title = previewCollapsed ? 'Show the test area' : 'Hide the test area';
    previewToggle.setAttribute('aria-expanded', previewCollapsed ? 'false' : 'true');
    preview.classList.toggle('collapsed', previewCollapsed);
  };
  previewToggle.addEventListener('click', () => {
    previewCollapsed = !previewCollapsed;
    saveAutomationUiState({ previewCollapsed });
    syncPreviewCollapsed();
  });
  syncPreviewCollapsed();

  // ---- state -----------------------------------------------------------
  const initialPending = cfg.initialSelectedId ? cfg.initialSelectedId() : null;
  let selectedId = initialPending || (cfg.list()[0] ? cfg.list()[0].id : null);
  let searchTerm = '';
  const checkedGroupKeys = new Set();
  const seenGroupKeys = new Set();

  const ensureSelected = (items = cfg.list()) => {
    if (!items.length) {
      selectedId = null;
      return null;
    }
    const existing = items.find((item) => item.id === selectedId);
    if (existing) return existing;
    selectedId = items[0].id;
    return items[0];
  };

  const selectedIndex = () => cfg.list().findIndex((item) => item.id === selectedId);

  const visibleItems = () => cfg.list().filter((item) => itemMatchesFilters(item));

  const renderPreviewBody = () => {
    const summary = cfg.preview.render(previewResults, sample, ensureSelected(visibleItems()));
    previewSummary.textContent = summary || '';
  };

  const groupLabelFor = (item) => {
    const group = String(item && item.group ? item.group : '').trim();
    return group || 'Ungrouped';
  };

  const groupKeyForLabel = (label) => label.toLowerCase();

  const deriveGroupFilters = () => {
    const groups = new Map();
    cfg.list().forEach((item) => {
      const label = groupLabelFor(item);
      const key = groupKeyForLabel(label);
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(key, { key, label, count: 1 });
      }
    });

    return Array.from(groups.values()).sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
  };

  const syncCheckedGroups = (groups) => {
    const current = new Set(groups.map((group) => group.key));
    Array.from(checkedGroupKeys).forEach((key) => {
      if (!current.has(key)) checkedGroupKeys.delete(key);
    });
    Array.from(seenGroupKeys).forEach((key) => {
      if (!current.has(key)) seenGroupKeys.delete(key);
    });
    groups.forEach((group) => {
      if (seenGroupKeys.has(group.key)) return;
      seenGroupKeys.add(group.key);
      checkedGroupKeys.add(group.key);
    });
  };

  const groupFilterIsActive = (groups) => groups.some((group) => !checkedGroupKeys.has(group.key));

  const itemMatchesFilters = (item) => {
    const groupKey = groupKeyForLabel(groupLabelFor(item));
    const query = searchTerm.trim().toLowerCase();

    return checkedGroupKeys.has(groupKey) && cfg.haystack(item).includes(query);
  };

  const renderGroupFilters = () => {
    const groups = deriveGroupFilters();
    syncCheckedGroups(groups);

    groupFilters.textContent = '';
    if (!groups.length) {
      groupFilters.hidden = true;
      return groups;
    }

    groupFilters.hidden = false;
    groups.forEach((group) => {
      const checked = checkedGroupKeys.has(group.key);
      const pill = el('label', 'settings-flag-pill' + (checked ? ' on' : ''));
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.addEventListener('change', () => {
        if (input.checked) checkedGroupKeys.add(group.key);
        else checkedGroupKeys.delete(group.key);
        pill.classList.toggle('on', input.checked);
        render();
      });
      pill.appendChild(input);
      pill.appendChild(document.createTextNode(group.label + ' (' + group.count + ')'));
      groupFilters.appendChild(pill);
    });

    return groups;
  };

  // ---- list -------------------------------------------------------------
  const renderListActions = () => {
    listActions.textContent = '';
    const items = visibleItems();
    const current = ensureSelected(items);
    const allItems = cfg.list();
    const index = current ? allItems.findIndex((item) => item.id === current.id) : -1;
    const hasSelection = index >= 0;

    const moveBtn = (label, title, offset, disabled) => {
      const btn = smallButton(label, title, () => {
        const current = selectedIndex();
        const target = current + offset;
        if (current < 0 || target < 0 || target >= cfg.list().length) return;
        const arr = cfg.list();
        const other = arr[target];
        arr[target] = arr[current];
        arr[current] = other;
        render();
        focus(cfg.kind + '-row-' + selectedId);
      });
      btn.disabled = disabled;
      return btn;
    };

    listActions.appendChild(moveBtn('Up', 'Move ' + cfg.noun + ' earlier (matches and runs first)', -1, !hasSelection || index <= 0));
    listActions.appendChild(moveBtn('Down', 'Move ' + cfg.noun + ' later', 1, !hasSelection || index >= allItems.length - 1));

    const dupBtn = smallButton('Duplicate', 'Duplicate the selected ' + cfg.noun, () => {
      const current = ensureSelected();
      if (!current) return;
      const clone = JSON.parse(JSON.stringify(current));
      clone.id = cfg.create().id;
      const arr = cfg.list();
      arr.splice(selectedIndex() + 1, 0, clone);
      selectedId = clone.id;
      render();
      focus(cfg.kind + '-pattern');
    });
    dupBtn.disabled = !hasSelection;
    listActions.appendChild(dupBtn);

    const removeBtn = smallButton('Delete', 'Delete the selected ' + cfg.noun, () => {
      const visibleBeforeDelete = visibleItems();
      const current = ensureSelected(visibleBeforeDelete);
      if (!current) return;
      const index2 = visibleBeforeDelete.findIndex((item) => item.id === current.id);
      cfg.replaceList(cfg.list().filter((item) => item.id !== current.id));
      const items2 = visibleItems();
      const next = items2[Math.min(index2, items2.length - 1)];
      selectedId = next ? next.id : null;
      render();
      focus(selectedId ? cfg.kind + '-row-' + selectedId : cfg.kind + '-add');
    });
    removeBtn.classList.add('settings-row-remove');
    removeBtn.disabled = !hasSelection;
    listActions.appendChild(removeBtn);
  };

  const renderList = () => {
    const previousScrollTop = list.scrollTop;
    list.textContent = '';

    const groups = renderGroupFilters();
    const items = cfg.list();
    const filtered = visibleItems();
    ensureSelected(filtered);

    const focusByOffset = (index, offset) => {
      if (!filtered.length) return;
      const nextIndex = Math.max(0, Math.min(filtered.length - 1, index + offset));
      selectedId = filtered[nextIndex].id;
      render();
      focus(cfg.kind + '-row-' + selectedId);
    };

    filtered.forEach((item, index) => {
      const selected = item.id === selectedId;
      const row = el('div', 'settings-alias-list-item' + (selected ? ' active' : ''));
      const selectRow = () => {
        selectedId = item.id;
        render();
      };
      row.addEventListener('click', (event) => {
        if (event.target instanceof HTMLElement && event.target.closest('button,input,select,textarea,a')) return;
        selectRow();
      });

      const rowBtn = el('button', 'settings-alias-list-select');
      rowBtn.type = 'button';
      rowBtn.dataset.focusKey = cfg.kind + '-row-' + item.id;
      rowBtn.tabIndex = selected ? 0 : -1;
      rowBtn.addEventListener('click', selectRow);
      rowBtn.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusByOffset(index, 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusByOffset(index, -1);
        }
      });

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = item.enabled !== false;
      toggle.className = 'settings-alias-list-toggle';
      toggle.dataset.focusKey = cfg.kind + '-toggle-' + item.id;
      toggle.tabIndex = selected ? 0 : -1;
      toggle.title = 'Enable or disable this ' + cfg.noun;
      toggle.addEventListener('change', () => {
        item.enabled = toggle.checked;
        render();
        focus(cfg.kind + '-toggle-' + item.id);
      });
      toggle.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusByOffset(index, 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusByOffset(index, -1);
        }
      });

      const copy = el('div', 'settings-copy');
      const itemName = cfg.showNameField === false ? '' : String(item.description || '').trim();
      copy.appendChild(el('div', 'settings-label', itemName || cfg.getPattern(item) || '(untitled)'));

      const meta = el('div', 'settings-alias-list-meta');
      const group = (item.group || '').trim();
      if (group) meta.appendChild(el('span', 'settings-row-chip', group));
      meta.appendChild(document.createTextNode(cfg.rowMeta(item)));
      copy.appendChild(meta);

      rowBtn.appendChild(copy);
      row.appendChild(rowBtn);
      row.appendChild(toggle);
      list.appendChild(row);
    });

    if (!filtered.length) {
      const filtersActive = Boolean(searchTerm.trim()) || groupFilterIsActive(groups);
      list.appendChild(el('div', 'settings-alias-empty', items.length && filtersActive
        ? 'No ' + cfg.plural + ' match the current filters.'
        : cfg.emptyText));
    }

    renderListActions();
    list.scrollTop = previousScrollTop;
  };

  // ---- detail ------------------------------------------------------------
  const renderDetail = () => {
    detail.textContent = '';
    const item = ensureSelected(visibleItems());
    if (!item) {
      detail.appendChild(el('div', 'settings-alias-empty', cfg.emptyDetailText));
      return;
    }

    const api = {
      render,
      renderPreview: renderPreviewBody,
      renderDiagnostics: () => {},
      focus,
      host,
    };

    const warningBox = el('div', 'settings-alias-diagnostics');
    const renderDiagnostics = () => {
      const diagnostics = cfg.diagnostics(item);
      warningBox.textContent = '';
      diagnostics.forEach((message) => warningBox.appendChild(el('div', '', message)));
      if (diagnostics.length) {
        if (!warningBox.parentElement) detail.insertBefore(warningBox, detail.firstChild);
      } else {
        warningBox.remove();
      }
    };
    api.renderDiagnostics = renderDiagnostics;
    renderDiagnostics();

    const patternField = el('label', 'dw-field');
    patternField.appendChild(el('div', 'settings-label', cfg.patternLabel));
    const patternInput = el('input', 'dw-input');
    patternInput.type = 'text';
    patternInput.dataset.focusKey = cfg.kind + '-pattern';
    patternInput.placeholder = cfg.patternPlaceholder(item);
    patternInput.value = cfg.getPattern(item);
    patternInput.addEventListener('input', () => {
      cfg.setPattern(item, patternInput.value);
      renderDiagnostics();
      renderList();
      renderPreviewBody();
    });
    patternInput.addEventListener('blur', () => render());
    patternField.appendChild(patternInput);
    detail.appendChild(patternField);

    const flagRow = el('div', 'settings-flag-row');
    cfg.flags(item, api).forEach((pill) => flagRow.appendChild(pill));
    detail.appendChild(flagRow);

    const metaGrid = el('div', 'settings-meta-grid');
    if (cfg.showNameField !== false) {
      const nameField = el('label', 'dw-field');
      nameField.appendChild(el('div', 'settings-label', cfg.nameRequired ? 'Name (required)' : 'Name'));
      const nameInput = el('input', 'dw-input');
      nameInput.type = 'text';
      nameInput.dataset.focusKey = cfg.kind + '-name';
      nameInput.placeholder = cfg.namePlaceholder;
      nameInput.value = item.description || '';
      const syncNameValidity = () => {
        nameInput.classList.toggle('settings-input-invalid',
          Boolean(cfg.nameRequired) && !nameInput.value.trim());
      };
      nameInput.addEventListener('input', () => {
        item.description = nameInput.value;
        syncNameValidity();
        renderDiagnostics();
        renderList();
      });
      syncNameValidity();
      nameField.appendChild(nameInput);
      metaGrid.appendChild(nameField);
    }

    const groupField = el('label', 'dw-field');
    groupField.appendChild(el('div', 'settings-label', 'Group'));
    const groupInput = el('input', 'dw-input');
    groupInput.type = 'text';
    groupInput.placeholder = 'Travel, Combat, Loot';
    groupInput.value = item.group || '';
    groupInput.addEventListener('input', () => {
      item.group = groupInput.value;
      render();
    });
    groupField.appendChild(groupInput);
    metaGrid.appendChild(groupField);
    detail.appendChild(metaGrid);

    cfg.renderBody(item, api, detail);
  };

  // ---- wiring -------------------------------------------------------------
  search.addEventListener('input', () => {
    const selectionStart = search.selectionStart;
    const selectionEnd = search.selectionEnd;
    searchTerm = search.value;
    render();
    host._focusSettingsTextControl(cfg.kind + '-search', selectionStart, selectionEnd);
  });

  addBtn.addEventListener('click', () => {
    const item = cfg.create();
    cfg.list().push(item);
    selectedId = item.id;
    render();
    focus(cfg.kind + '-pattern');
  });

  const render = () => {
    ensureSelected();
    search.value = searchTerm;
    renderList();
    renderDetail();
    renderPreviewBody();
  };

  render();
  return wrapper;
}
