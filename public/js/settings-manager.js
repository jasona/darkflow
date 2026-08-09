import { state, dom } from './state.js';
import { DEFAULT_OUTPUT_SCROLLBACK_PRESET } from './constants.js';
import {
  appendSystemMessage,
  closeOpenOutputLine,
  sendTerminalGeometry,
  setOutputScrollbackBehavior,
  setOutputScrollbackPreset,
  setOutputSplitRatio,
} from './output.js';
import { aliasManager } from './alias-manager.js';
import { highlightManager } from './highlight-manager.js';
import { triggerManager } from './trigger-manager.js';
import { timerManager } from './timer-manager.js';
import { functionManager } from './function-manager.js';
import { panelManager } from './panel-manager.js';
import { PRODUCT_NAME } from './brand.js';
import { soundManager, SOUND_CATEGORIES, SOUND_CATEGORY_INFO } from './sound-manager.js';
import { applyTheme, convertVsCodeTheme, BUILTIN_THEMES, DEFAULT_THEME_KEY } from './theme-manager.js';
import {
  applyBackground,
  BACKGROUND_PRESETS,
  DEFAULT_BACKGROUND_KEY,
  NO_BACKGROUND_KEY,
  normalizeBackgroundKey,
} from './background-manager.js';
import { createAutomationEditor } from './settings-automation.js';
import { listGmcpVariables } from './gmcp-variables.js';
import {
  createDefaultVisualEffectPreferences,
  normalizeVisualEffectPreferences,
  VISUAL_EFFECT_OPTIONS,
} from './visual-effects-settings.mjs';
import {
  getEffectiveDefinitions,
  isConfigurationCompatActive,
  replaceLocalDefinitions,
} from './session-compat/configuration.js';

const SETTINGS_STORAGE_KEY = 'darkwind-client-settings';
const ALIAS_STORAGE_KEY = 'darkwind-client-aliases-v1';
const HIGHLIGHT_STORAGE_KEY = 'darkwind-client-highlights-v1';
const TRIGGER_STORAGE_KEY = 'darkwind-client-triggers-v1';
const TIMER_STORAGE_KEY = 'darkwind-client-timers-v1';
const FUNCTION_STORAGE_KEY = 'darkwind-client-functions-v1';
const MIN_TERMINAL_WIDTH_COLUMNS = 40;
const MAX_TERMINAL_WIDTH_COLUMNS = 240;

function formatKeyCodeLabel(code) {
  const value = String(code || '').trim();
  if (!value) return '';

  if (/^Digit[0-9]$/.test(value)) return value.slice(-1);
  if (/^Numpad[0-9]$/.test(value)) return 'Num ' + value.slice(-1);
  if (value === 'NumpadDecimal') return 'Num .';
  if (value === 'NumpadAdd') return 'Num +';
  if (value === 'NumpadSubtract') return 'Num -';
  if (value === 'NumpadMultiply') return 'Num *';
  if (value === 'NumpadDivide') return 'Num /';
  if (value === 'NumpadEnter') return 'Num Enter';
  if (value === 'Space') return 'Space';
  if (value.startsWith('Arrow')) return value.slice(5);
  if (/^Key[A-Z]$/.test(value)) return value.slice(3);
  if (/^F[0-9]{1,2}$/.test(value)) return value;

  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function normalizeLegacyKeyToCode(key) {
  const value = String(key || '').trim();
  if (!value) return '';
  if (/^[0-9]$/.test(value)) return 'Digit' + value;
  if (/^[a-zA-Z]$/.test(value)) return 'Key' + value.toUpperCase();
  if (value === ' ') return 'Space';
  if (value === 'ArrowUp' || value === 'ArrowDown' || value === 'ArrowLeft' || value === 'ArrowRight') return value;
  if (value === 'Enter' || value === 'Escape' || value === 'Tab' || value === 'Backspace' || value === 'Delete') return value;
  return '';
}

// The settings window is a floating, draggable, resizable panel (not a
// blocking modal) so triggers/aliases can be edited and tested while playing.
// Its geometry and last-open section persist per browser.
const SETTINGS_WINDOW_STATE_KEY = 'darkwind-settings-window';
const SETTINGS_WINDOW_MIN_W = 560;
const SETTINGS_WINDOW_MIN_H = 380;

function loadSettingsWindowState() {
  try {
    const raw = localStorage.getItem(SETTINGS_WINDOW_STATE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

function saveSettingsWindowState(patch) {
  try {
    const next = Object.assign(loadSettingsWindowState(), patch || {});
    localStorage.setItem(SETTINGS_WINDOW_STATE_KEY, JSON.stringify(next));
  } catch (e) {
    // localStorage unavailable; the window just won't remember its spot.
  }
}

// Saved (or default) geometry, clamped so the window always lands on-screen
// even after a monitor/viewport change.
function settingsWindowGeometry() {
  const saved = loadSettingsWindowState();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const availableW = Math.max(0, vw - 8);
  const availableH = Math.max(0, vh - 8);
  let w = Number(saved.w) || Math.min(1000, vw - 28);
  let h = Number(saved.h) || Math.min(700, vh - 130);
  w = Math.min(availableW, Math.max(SETTINGS_WINDOW_MIN_W, w));
  h = Math.min(availableH, Math.max(SETTINGS_WINDOW_MIN_H, h));
  let x = Number.isFinite(Number(saved.x)) && saved.x !== null && saved.x !== undefined
    ? Number(saved.x) : (vw - w - 14);
  let y = Number.isFinite(Number(saved.y)) && saved.y !== null && saved.y !== undefined
    ? Number(saved.y) : 54;
  x = Math.max(0, Math.min(x, vw - w));
  y = Math.max(0, Math.min(y, vh - h));
  return { x, y, w, h, tab: typeof saved.tab === 'string' ? saved.tab : 'connection' };
}

export const settingsManager = {
  _defaults: {
    autoReconnect: true,
    repeatLastCommand: true,
    keyMapperEnabled: false,
    keyMappings: [],
    aliasTabCompletionEnabled: true,
    historyTabCompletionEnabled: false,
    emojiPickerEnabled: true,
    lagMonitorEnabled: true,
    scrollbackBehavior: 'pause',
    scrollbackSplitRatio: 0.6,
    outputScrollbackPreset: DEFAULT_OUTPUT_SCROLLBACK_PRESET,
    screenReaderMode: false,
    visualEffectsEnabled: false,
    visualEffectPreferences: createDefaultVisualEffectPreferences(),
    terminalWidthColumns: null,
    workspaceLayout: 'classic',
    paneGridSnapEnabled: false,
    settingsBackupPromptEnabled: true,
    theme: DEFAULT_THEME_KEY,
    customThemes: {},
    background: DEFAULT_BACKGROUND_KEY,
  },
  _settings: {},
  _draftSettings: {},
  _aliasScopeKey: '',
  _draftAliasScope: null,
  _highlightScopeKey: '',
  _draftHighlightScope: null,
  _triggerScopeKey: '',
  _draftTriggerScope: null,
  _timerScopeKey: '',
  _draftTimerScope: null,
  _functionScopeKey: '',
  _draftFunctionScope: null,
  _overlay: null,
  _escHandler: null,
  _dataSyncHandler: null,
  _refreshEditors: null,
  _activateTab: null,
  _currentSettingsTab: 'connection',
  _clearSettingsSearch: null,
  _pendingAliasSelection: null,
  _footerStatusEl: null,
  _previousFocusEl: null,
  _modalKeyHandler: null,
  _activeEditFocusScope: null,
  _settingsSessionBaseline: '',
  _backupClosePromptEl: null,
  _applyingDraftChanges: false,
  _footerStatusTimer: null,

  init() {
    this._settings = { ...this._defaults };

    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (!Object.prototype.hasOwnProperty.call(parsed, 'background')) {
            parsed.background = NO_BACKGROUND_KEY;
          }
          this._settings = { ...this._settings, ...parsed };
        }
      }
    } catch (error) {
      console.warn('Failed to load client settings', error);
    }

    this._settings = this._normalizeSettings(this._settings);
    state.settings = { ...this._settings };
    setOutputScrollbackBehavior(this._settings.scrollbackBehavior);
    setOutputSplitRatio(this._settings.scrollbackSplitRatio);
    setOutputScrollbackPreset(this._settings.outputScrollbackPreset);
    panelManager.setWorkspaceLayout(this._settings.workspaceLayout, { initializing: true });
    panelManager.setPaneGridSnapEnabled(this._settings.paneGridSnapEnabled, { initializing: true });
    sendTerminalGeometry(false);
    this._applyActiveTheme();
    this._applyActiveBackground();
  },

  get(key) {
    if (key === 'keyMappings') {
      return this._resolveKeyMappings();
    }
    if (Object.prototype.hasOwnProperty.call(this._settings, key)) {
      return this._settings[key];
    }
    return this._defaults[key];
  },

  set(key, value) {
    this._applySettings({ [key]: value });
  },

  open() {
    this.close({ skipBackupPrompt: true });
    this._previousFocusEl = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this._draftSettings = {
      ...this._settings,
      keyMappings: this._resolveKeyMappings().map((mapping) => ({
        code: mapping.code || '',
        label: mapping.label || formatKeyCodeLabel(mapping.code || ''),
        legacyKey: mapping.legacyKey || '',
        command: mapping.command,
      })),
    };
    this._aliasScopeKey = aliasManager.getActiveScopeKey();
    this._draftAliasScope = aliasManager.getScopeSnapshot(this._aliasScopeKey);
    this._highlightScopeKey = highlightManager.getActiveScopeKey();
    this._draftHighlightScope = highlightManager.getScopeSnapshot(this._highlightScopeKey);
    this._triggerScopeKey = triggerManager.getActiveScopeKey();
    this._draftTriggerScope = triggerManager.getScopeSnapshot(this._triggerScopeKey);
    this._timerScopeKey = timerManager.getActiveScopeKey();
    this._draftTimerScope = timerManager.getScopeSnapshot(this._timerScopeKey);
    this._functionScopeKey = functionManager.getActiveScopeKey();
    this._draftFunctionScope = functionManager.getScopeSnapshot(this._functionScopeKey);
    this._settingsSessionBaseline = this._getCurrentSettingsSessionFingerprint();

    const overlay = this._buildModal();
    const modalKeyHandler = (event) => this._handleModalKeydown(event);

    document.addEventListener('keydown', modalKeyHandler, true);
    const dataSyncHandler = (event) => {
      const detail = event && event.detail ? event.detail : {};
      let refreshed = false;
      const isHighlightEvent = event && event.type === 'darkwind:highlight-data-changed';
      const isTriggerEvent = event && event.type === 'darkwind:trigger-data-changed';
      const isTimerEvent = event && event.type === 'darkwind:timer-data-changed';
      const isFunctionEvent = event && event.type === 'darkwind:function-data-changed';
      const isGmcpVariableEvent = event && event.type === 'darkwind:gmcp-variables-changed';

      if (!this._overlay || !this._refreshEditors) return;
      if (this._applyingDraftChanges) return;
      if (isGmcpVariableEvent && this._currentSettingsTab === 'variables') {
        refreshed = true;
      }
      if (isHighlightEvent && (!detail.scopeKey || detail.scopeKey === this._highlightScopeKey)) {
        this._draftHighlightScope = highlightManager.getScopeSnapshot(this._highlightScopeKey);
        refreshed = true;
      }
      if (isTriggerEvent && (!detail.scopeKey || detail.scopeKey === this._triggerScopeKey)) {
        this._draftTriggerScope = triggerManager.getScopeSnapshot(this._triggerScopeKey);
        refreshed = true;
      }
      if (isTimerEvent && (!detail.scopeKey || detail.scopeKey === this._timerScopeKey)) {
        this._draftTimerScope = timerManager.getScopeSnapshot(this._timerScopeKey);
        refreshed = true;
      }
      if (isFunctionEvent && (!detail.scopeKey || detail.scopeKey === this._functionScopeKey)) {
        this._draftFunctionScope = functionManager.getScopeSnapshot(this._functionScopeKey);
        refreshed = true;
      }
      if (refreshed) this._refreshEditors();
    };
    window.addEventListener('darkwind:highlight-data-changed', dataSyncHandler);
    window.addEventListener('darkwind:trigger-data-changed', dataSyncHandler);
    window.addEventListener('darkwind:timer-data-changed', dataSyncHandler);
    window.addEventListener('darkwind:function-data-changed', dataSyncHandler);
    window.addEventListener('darkwind:gmcp-variables-changed', dataSyncHandler);
    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._escHandler = modalKeyHandler;
    this._modalKeyHandler = modalKeyHandler;
    this._dataSyncHandler = dataSyncHandler;
    this._focusSettingsControl('settings-tab-' + settingsWindowGeometry().tab);
  },

  close(options = {}) {
    if (!options.skipBackupPrompt && this._shouldPromptForSettingsBackup()) {
      this._showSettingsBackupPrompt();
      return false;
    }

    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler, true);
      this._escHandler = null;
    }
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    if (this._dataSyncHandler) {
      window.removeEventListener('darkwind:highlight-data-changed', this._dataSyncHandler);
      window.removeEventListener('darkwind:trigger-data-changed', this._dataSyncHandler);
      window.removeEventListener('darkwind:timer-data-changed', this._dataSyncHandler);
      window.removeEventListener('darkwind:function-data-changed', this._dataSyncHandler);
      window.removeEventListener('darkwind:gmcp-variables-changed', this._dataSyncHandler);
      this._dataSyncHandler = null;
    }
    this._draftSettings = {};
    this._draftAliasScope = null;
    this._aliasScopeKey = '';
    this._draftHighlightScope = null;
    this._highlightScopeKey = '';
    this._draftTriggerScope = null;
    this._triggerScopeKey = '';
    this._draftTimerScope = null;
    this._timerScopeKey = '';
    this._draftFunctionScope = null;
    this._functionScopeKey = '';
    this._refreshEditors = null;
    this._activateTab = null;
    this._currentSettingsTab = 'connection';
    this._clearSettingsSearch = null;
    this._pendingAliasSelection = null;
    if (this._footerStatusTimer) {
      clearTimeout(this._footerStatusTimer);
      this._footerStatusTimer = null;
    }
    this._footerStatusEl = null;
    this._modalKeyHandler = null;
    this._activeEditFocusScope = null;
    this._settingsSessionBaseline = '';
    this._backupClosePromptEl = null;
    this._applyingDraftChanges = false;
    const previous = this._previousFocusEl;
    this._previousFocusEl = null;
    if (previous && document.contains(previous)) {
      previous.focus();
    }
    return true;
  },

  _save() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this._settings));
    } catch (error) {
      console.warn('Failed to save client settings', error);
    }
  },

  _publishSettingsChanged() {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
    document.dispatchEvent(new CustomEvent('darkwind:settings-changed', {
      detail: { ...this._settings },
    }));
  },

  _applySettings(nextSettings) {
    this._settings = this._normalizeSettings({
      ...this._settings,
      ...nextSettings,
    });
    state.settings = { ...this._settings };
    setOutputScrollbackBehavior(this._settings.scrollbackBehavior);
    setOutputSplitRatio(this._settings.scrollbackSplitRatio);
    setOutputScrollbackPreset(this._settings.outputScrollbackPreset);
    panelManager.setWorkspaceLayout(this._settings.workspaceLayout);
    panelManager.setPaneGridSnapEnabled(this._settings.paneGridSnapEnabled);
    sendTerminalGeometry(true);
    this._applyActiveTheme();
    this._applyActiveBackground();
    this._save();
    this._publishSettingsChanged();
  },

  // --- Theming -------------------------------------------------------------

  _resolveTheme(key) {
    const custom = this._settings.customThemes && this._settings.customThemes[key];
    if (custom) return custom;
    return BUILTIN_THEMES[key] || BUILTIN_THEMES[DEFAULT_THEME_KEY];
  },

  _applyActiveTheme() {
    try {
      applyTheme(this._resolveTheme(this._settings.theme));
    } catch (error) {
      console.warn('Failed to apply theme', error);
    }
  },

  // Theme changes apply (and persist) immediately, independent of the modal's
  // save/cancel draft, since they are purely visual and low-risk.
  _setTheme(key) {
    this._settings.theme = key;
    if (this._draftSettings) this._draftSettings.theme = key;
    state.settings = { ...this._settings };
    this._applyActiveTheme();
    this._save();
  },

  _applyActiveBackground() {
    try {
      applyBackground(this._settings.background);
    } catch (error) {
      console.warn('Failed to apply background', error);
    }
  },

  _setBackground(key) {
    this._settings.background = normalizeBackgroundKey(key);
    if (this._draftSettings) this._draftSettings.background = this._settings.background;
    state.settings = { ...this._settings };
    this._applyActiveBackground();
    this._save();
  },

  _setFooterStatus(message, isError = false, autoClearMs = 0) {
    if (this._footerStatusTimer) {
      clearTimeout(this._footerStatusTimer);
      this._footerStatusTimer = null;
    }
    if (!this._footerStatusEl) return;
    this._footerStatusEl.textContent = message || '';
    this._footerStatusEl.classList.toggle('error', Boolean(message) && isError);
    if (message && !isError && autoClearMs > 0) {
      this._footerStatusTimer = setTimeout(() => {
        this._footerStatusTimer = null;
        if (!this._footerStatusEl) return;
        if (this._footerStatusEl.textContent !== message) return;
        this._footerStatusEl.textContent = '';
        this._footerStatusEl.classList.remove('error');
      }, autoClearMs);
    }
  },

  _getFocusableSettingsControls() {
    if (!this._overlay) return [];
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(this._overlay.querySelectorAll(selector))
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        if (el.hidden) return false;
        if (el.tabIndex < 0) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        if (el.offsetParent === null && el !== document.activeElement) return false;
        return true;
      });
  },

  _focusSettingsControl(key) {
    if (!key) return;
    requestAnimationFrame(() => {
      if (!this._overlay) return;
      const escaped = window.CSS && typeof window.CSS.escape === 'function'
        ? window.CSS.escape(key)
        : String(key).replace(/"/g, '\\"');
      const target = this._overlay.querySelector('[data-focus-key="' + escaped + '"]');
      if (target && target instanceof HTMLElement) {
        target.focus();
      }
    });
  },

  _focusSettingsTextControl(key, selectionStart, selectionEnd) {
    if (!key) return;
    requestAnimationFrame(() => {
      if (!this._overlay) return;
      const escaped = window.CSS && typeof window.CSS.escape === 'function'
        ? window.CSS.escape(key)
        : String(key).replace(/"/g, '\\"');
      const target = this._overlay.querySelector('[data-focus-key="' + escaped + '"]');
      if (target && target instanceof HTMLElement) {
        target.focus();
        if (typeof target.setSelectionRange === 'function' &&
          typeof selectionStart === 'number') {
          target.setSelectionRange(selectionStart, selectionEnd || selectionStart);
        }
      }
    });
  },

  _handleModalKeydown(event) {
    if (!this._overlay) return;
    if (!this._overlay.contains(event.target)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      // Esc in a non-empty settings search clears the search first; a second
      // Esc closes the window.
      if (event.target instanceof HTMLElement &&
        event.target.dataset.focusKey === 'settings-search' &&
        event.target.value && this._clearSettingsSearch) {
        this._clearSettingsSearch();
        return;
      }
      this.close();
      return;
    }
  },

  _getEditScopeName(target) {
    if (!(target instanceof HTMLElement)) return '';
    const scopeRoot = target.closest('[data-edit-focus-scope]');
    if (scopeRoot && scopeRoot instanceof HTMLElement) {
      return scopeRoot.dataset.editFocusScope || '';
    }
    if (target.dataset.focusKey === 'settings-save') {
      return this._activeEditFocusScope || '';
    }
    return '';
  },

  _getEditScopeControls(scopeName) {
    if (!this._overlay || !scopeName) return [];
    const escaped = window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(scopeName)
      : String(scopeName).replace(/"/g, '\\"');
    const scopedRoots = Array.from(this._overlay.querySelectorAll('[data-edit-focus-scope="' + escaped + '"]'))
      .filter((el) => el instanceof HTMLElement);
    const scopedControls = [];

    scopedRoots.forEach((root) => {
      scopedControls.push(...Array.from(root.querySelectorAll([
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'a[href]',
      ].join(','))));
    });

    const save = this._overlay.querySelector('[data-focus-key="settings-save"]');
    if (save) scopedControls.push(save);

    return scopedControls
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        if (el.hidden) return false;
        if (el.tabIndex < 0) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        if (el.offsetParent === null && el !== document.activeElement) return false;
        return true;
      });
  },

  _handleEditScopeTab(event) {
    const scopeName = this._getEditScopeName(event.target);
    if (!scopeName) return false;

    const controls = this._getEditScopeControls(scopeName);
    if (!controls.length) return false;

    this._activeEditFocusScope = scopeName;
    const current = document.activeElement;
    let index = controls.indexOf(current);
    if (index < 0) index = event.shiftKey ? 0 : -1;
    const nextIndex = event.shiftKey
      ? (index <= 0 ? controls.length - 1 : index - 1)
      : (index >= controls.length - 1 ? 0 : index + 1);

    event.preventDefault();
    controls[nextIndex].focus();
    return true;
  },

  _applyDraftChanges(closeAfterApply = false) {
    this._applyingDraftChanges = true;
    try {
      this._syncDraftVariablesFromSteps();
      if (isConfigurationCompatActive()) {
        const draftKeyMappings = this._toBridgeKeyMappings(this._draftSettings.keyMappings);
        replaceLocalDefinitions('keyMappings', draftKeyMappings);
        const { keyMappings, ...otherDraftSettings } = this._draftSettings;
        this._applySettings(otherDraftSettings);
      } else {
        this._applySettings(this._draftSettings);
      }
      triggerManager.saveScope(this._triggerScopeKey, this._draftTriggerScope);
      timerManager.saveScope(this._timerScopeKey, this._draftTimerScope);
      functionManager.saveScope(this._functionScopeKey, this._draftFunctionScope);
      highlightManager.saveScope(this._highlightScopeKey, this._draftHighlightScope);
      aliasManager.saveScope(this._aliasScopeKey, this._draftAliasScope);
      this._setFooterStatus('Settings applied.', false, 10000);
    } finally {
      this._applyingDraftChanges = false;
    }
    if (closeAfterApply) this.close();
  },

  _getCurrentSettingsSessionFingerprint() {
    const settings = this._draftSettings && Object.keys(this._draftSettings).length
      ? this._draftSettings
      : this._settings;
    const sessionState = {
      settings: this._normalizeSettings(settings),
      aliasScopeKey: this._aliasScopeKey,
      aliasScope: this._draftAliasScope,
      highlightScopeKey: this._highlightScopeKey,
      highlightScope: this._draftHighlightScope,
      triggerScopeKey: this._triggerScopeKey,
      triggerScope: this._draftTriggerScope,
      timerScopeKey: this._timerScopeKey,
      timerScope: this._draftTimerScope,
      functionScopeKey: this._functionScopeKey,
      functionScope: this._draftFunctionScope,
      sound: soundManager.getSettings(),
    };
    return JSON.stringify(sessionState);
  },

  _shouldPromptForSettingsBackup() {
    if (!this._overlay || !this._settings.settingsBackupPromptEnabled) return false;
    if (!this._settingsSessionBaseline) return false;

    try {
      return this._getCurrentSettingsSessionFingerprint() !== this._settingsSessionBaseline;
    } catch (error) {
      return false;
    }
  },

  _dismissSettingsBackupPrompt() {
    if (this._backupClosePromptEl) {
      this._backupClosePromptEl.remove();
      this._backupClosePromptEl = null;
    }
  },

  _showSettingsBackupPrompt() {
    if (!this._overlay) return;
    if (this._backupClosePromptEl) {
      const primary = this._backupClosePromptEl.querySelector('[data-backup-action="download"]');
      if (primary instanceof HTMLElement) primary.focus();
      return;
    }

    const prompt = document.createElement('div');
    prompt.className = 'settings-backup-prompt';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const title = document.createElement('div');
    title.className = 'settings-label';
    title.textContent = 'Download a settings backup?';

    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = 'Your settings changed in this session. Save a JSON backup before closing.';

    copy.appendChild(title);
    copy.appendChild(description);

    const actions = document.createElement('div');
    actions.className = 'settings-backup-actions';

    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'dw-button dw-button-secondary';
    continueBtn.textContent = 'Continue editing';
    continueBtn.addEventListener('click', () => this._dismissSettingsBackupPrompt());

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'dw-button dw-button-secondary';
    skipBtn.textContent = 'Skip';
    skipBtn.addEventListener('click', () => this.close({ skipBackupPrompt: true }));

    const neverBtn = document.createElement('button');
    neverBtn.type = 'button';
    neverBtn.className = 'dw-button dw-button-secondary';
    neverBtn.textContent = 'Never ask again';
    neverBtn.addEventListener('click', () => {
      this._draftSettings.settingsBackupPromptEnabled = false;
      this._applySettings({ settingsBackupPromptEnabled: false });
      this.close({ skipBackupPrompt: true });
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'dw-button dw-button-primary';
    downloadBtn.dataset.backupAction = 'download';
    downloadBtn.textContent = 'Download backup';
    downloadBtn.addEventListener('click', () => {
      this._downloadSettingsBundle();
      this.close({ skipBackupPrompt: true });
    });

    actions.appendChild(continueBtn);
    actions.appendChild(skipBtn);
    actions.appendChild(neverBtn);
    actions.appendChild(downloadBtn);
    prompt.appendChild(copy);
    prompt.appendChild(actions);

    const footer = this._overlay.querySelector('.settings-modal-footer');
    if (footer && footer.parentElement) {
      footer.parentElement.insertBefore(prompt, footer);
    } else {
      this._overlay.appendChild(prompt);
    }
    this._backupClosePromptEl = prompt;
    downloadBtn.focus();
  },

  _syncDraftVariablesFromSteps() {
    if (!this._draftAliasScope || !this._draftAliasScope.variables) return;
    const stepLists = [];
    if (Array.isArray(this._draftAliasScope.aliases)) {
      stepLists.push(...this._draftAliasScope.aliases.map((alias) => alias.steps || []));
    }
    if (this._draftTriggerScope && Array.isArray(this._draftTriggerScope.triggers)) {
      stepLists.push(...this._draftTriggerScope.triggers.map((trigger) => trigger.steps || []));
    }
    if (this._draftTimerScope && Array.isArray(this._draftTimerScope.timers)) {
      stepLists.push(...this._draftTimerScope.timers.map((timer) => timer.steps || []));
    }

    stepLists.forEach((steps) => {
      steps.forEach((step) => {
        const name = String(step && step.type === 'set_variable' ? step.name || '' : '').trim();
        if (name && !Object.prototype.hasOwnProperty.call(this._draftAliasScope.variables, name)) {
          this._draftAliasScope.variables[name] = '';
        }
      });
    });
  },

  _buildSettingsBundle() {
    this._syncDraftVariablesFromSteps();
    const aliasData = JSON.parse(JSON.stringify(aliasManager._data || { scopes: {} }));
    const highlightData = JSON.parse(JSON.stringify(highlightManager._data || { scopes: {} }));
    const triggerData = JSON.parse(JSON.stringify(triggerManager._data || { scopes: {} }));
    const timerData = JSON.parse(JSON.stringify(timerManager._data || { scopes: {} }));
    const functionData = JSON.parse(JSON.stringify(functionManager._data || { scopes: {} }));

    if (this._aliasScopeKey && this._draftAliasScope) {
      aliasData.scopes = aliasData.scopes || {};
      aliasData.scopes[this._aliasScopeKey] = JSON.parse(JSON.stringify(this._draftAliasScope));
    }
    if (this._highlightScopeKey && this._draftHighlightScope) {
      highlightData.scopes = highlightData.scopes || {};
      highlightData.scopes[this._highlightScopeKey] = JSON.parse(JSON.stringify(this._draftHighlightScope));
    }
    if (this._triggerScopeKey && this._draftTriggerScope) {
      triggerData.scopes = triggerData.scopes || {};
      triggerData.scopes[this._triggerScopeKey] = JSON.parse(JSON.stringify(this._draftTriggerScope));
    }
    if (this._timerScopeKey && this._draftTimerScope) {
      timerData.scopes = timerData.scopes || {};
      timerData.scopes[this._timerScopeKey] = JSON.parse(JSON.stringify(this._draftTimerScope));
    }
    if (this._functionScopeKey && this._draftFunctionScope) {
      functionData.scopes = functionData.scopes || {};
      functionData.scopes[this._functionScopeKey] = JSON.parse(JSON.stringify(this._draftFunctionScope));
    }

    return {
      format: 'darkwind-client-settings-export',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      clientVersion: state.clientVersion || 'unknown',
      data: {
        settings: this._normalizeSettings(this._draftSettings || this._settings),
        aliases: aliasData,
        highlights: highlightData,
        triggers: triggerData,
        timers: timerData,
        functions: functionData,
        panels: panelManager.exportState(),
        sound: soundManager.getSettings(),
      },
    };
  },

  _downloadSettingsBundle() {
    const bundle = this._buildSettingsBundle();
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = bundle.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
    link.href = url;
    link.download = 'darkflow-settings-' + timestamp + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this._setFooterStatus('Settings exported.');
  },

  _applyImportedBundle(bundle) {
    if (!bundle || typeof bundle !== 'object' || bundle.format !== 'darkwind-client-settings-export') {
      throw new Error('That file is not a Darkflow settings export.');
    }
    if (!bundle.data || typeof bundle.data !== 'object') {
      throw new Error('That settings export is missing its data payload.');
    }

    const nextSettings = this._normalizeSettings(bundle.data.settings || this._defaults);
    this._settings = nextSettings;
    state.settings = { ...nextSettings };
    this._save();
    setOutputScrollbackBehavior(nextSettings.scrollbackBehavior);
    setOutputSplitRatio(nextSettings.scrollbackSplitRatio);
    setOutputScrollbackPreset(nextSettings.outputScrollbackPreset);
    panelManager.setWorkspaceLayout(nextSettings.workspaceLayout);
    panelManager.setPaneGridSnapEnabled(nextSettings.paneGridSnapEnabled);
    sendTerminalGeometry(true);
    this._applyActiveTheme();
    this._applyActiveBackground();
    this._publishSettingsChanged();

    try {
      localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(bundle.data.aliases || { scopes: {} }));
      localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify(bundle.data.highlights || { scopes: {} }));
      localStorage.setItem(TRIGGER_STORAGE_KEY, JSON.stringify(bundle.data.triggers || { scopes: {} }));
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(bundle.data.timers || { scopes: {} }));
      localStorage.setItem(FUNCTION_STORAGE_KEY, JSON.stringify(bundle.data.functions || { scopes: {} }));
      soundManager.importSettings(bundle.data.sound || {});
    } catch (error) {
      throw new Error('Unable to write imported client data to local storage.');
    }

    aliasManager.init();
    highlightManager.init();
    triggerManager.init();
    timerManager.init();
    functionManager.init();

    window.dispatchEvent(new CustomEvent('darkwind:alias-data-changed', { detail: {} }));
    window.dispatchEvent(new CustomEvent('darkwind:highlight-data-changed', { detail: {} }));
    window.dispatchEvent(new CustomEvent('darkwind:trigger-data-changed', { detail: {} }));
    window.dispatchEvent(new CustomEvent('darkwind:timer-data-changed', { detail: {} }));
    window.dispatchEvent(new CustomEvent('darkwind:function-data-changed', { detail: {} }));

    panelManager.applyImportedState(bundle.data.panels || { docks: { left: false, right: false }, panels: {} });

    this.close();
    this.open();
    this._setFooterStatus('Settings imported.');
  },

  _promptImportSettingsBundle() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        this._applyImportedBundle(parsed);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to import that settings file.';
        this._setFooterStatus(message, true);
      }
    });
    input.click();
  },

  _normalizeSettings(settings) {
    return {
      autoReconnect: settings.autoReconnect !== false,
      repeatLastCommand: settings.repeatLastCommand !== false,
      keyMapperEnabled: Boolean(settings.keyMapperEnabled),
      keyMappings: this._normalizeKeyMappings(settings.keyMappings),
      aliasTabCompletionEnabled: settings.aliasTabCompletionEnabled !== false,
      historyTabCompletionEnabled: Boolean(settings.historyTabCompletionEnabled),
      emojiPickerEnabled: settings.emojiPickerEnabled !== false,
      lagMonitorEnabled: settings.lagMonitorEnabled !== false,
      scrollbackBehavior: this._normalizeScrollbackBehavior(settings.scrollbackBehavior),
      scrollbackSplitRatio: this._normalizeSplitRatio(settings.scrollbackSplitRatio),
      outputScrollbackPreset: this._normalizeOutputScrollbackPreset(settings.outputScrollbackPreset),
      tabObservabilityEnabled: Boolean(settings.tabObservabilityEnabled),
      screenReaderMode: Boolean(settings.screenReaderMode),
      visualEffectsEnabled: Boolean(settings.visualEffectsEnabled),
      visualEffectPreferences: normalizeVisualEffectPreferences(settings.visualEffectPreferences),
      terminalWidthColumns: this._normalizeTerminalWidthColumns(settings.terminalWidthColumns),
      workspaceLayout: settings.workspaceLayout === 'floating' ? 'floating' : 'classic',
      paneGridSnapEnabled: Boolean(settings.paneGridSnapEnabled),
      settingsBackupPromptEnabled: settings.settingsBackupPromptEnabled !== false,
      theme: typeof settings.theme === 'string' && settings.theme ? settings.theme : DEFAULT_THEME_KEY,
      customThemes: (settings.customThemes && typeof settings.customThemes === 'object') ? settings.customThemes : {},
      background: normalizeBackgroundKey(settings.background),
    };
  },

  _normalizeTerminalWidthColumns(value) {
    if (value === null || value === undefined || value === '') return null;

    const number = Number(value);
    if (!Number.isFinite(number)) return null;

    return Math.max(
      MIN_TERMINAL_WIDTH_COLUMNS,
      Math.min(MAX_TERMINAL_WIDTH_COLUMNS, Math.round(number))
    );
  },

  _syncScreenReaderServerSetting() {
    const command = 'set screenreader on';
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      this._setFooterStatus('Connect before syncing the game screen reader setting.', true);
      return;
    }

    try {
      state.ws.send(command);
      closeOpenOutputLine();
      state.bytesSent += command.length;
      appendSystemMessage('Sent to game: ' + command);
      this._setFooterStatus('Game screen reader setting synced.');
    } catch (error) {
      this._setFooterStatus('Unable to sync the game screen reader setting.', true);
    }
  },

  _normalizeScrollbackBehavior(value) {
    return value === 'split' ? 'split' : 'pause';
  },

  _normalizeSplitRatio(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) return 0.6;
    return Math.max(0.2, Math.min(0.8, ratio));
  },

  _normalizeOutputScrollbackPreset(preset) {
    if (preset === 'low' || preset === 'high') return preset;
    return DEFAULT_OUTPUT_SCROLLBACK_PRESET;
  },

  _createSelectRow(labelText, descriptionText, value, options, onChange) {
    const row = document.createElement('div');
    row.className = 'settings-select-row';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = labelText;

    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = descriptionText;

    const select = document.createElement('select');
    select.className = 'dw-select';
    for (const option of options) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      if (option.value === value) el.selected = true;
      select.appendChild(el);
    }
    select.addEventListener('change', () => onChange(select.value));

    copy.appendChild(label);
    copy.appendChild(description);
    row.appendChild(copy);
    row.appendChild(select);

    return row;
  },

  _themeOptionList() {
    const builtins = Object.values(BUILTIN_THEMES).map((t) => ({ value: t.key, label: t.label }));
    const customs = Object.entries(this._settings.customThemes || {}).map(([key, t]) => ({
      value: key,
      label: (t && t.label ? t.label : key) + ' (imported)',
    }));
    return [...builtins, ...customs];
  },

  _createThemeRow() {
    const row = document.createElement('div');
    row.className = 'settings-select-row';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';
    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = 'Theme';
    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = 'Recolor the terminal and interface. Import any VS Code theme (.json) to add your own. Applies immediately.';
    copy.appendChild(label);
    copy.appendChild(description);

    const controls = document.createElement('div');
    controls.className = 'settings-theme-controls';

    const select = document.createElement('select');
    select.className = 'dw-select';
    const rebuildOptions = () => {
      select.innerHTML = '';
      for (const opt of this._themeOptionList()) {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label;
        if (opt.value === this._settings.theme) el.selected = true;
        select.appendChild(el);
      }
    };
    rebuildOptions();
    select.addEventListener('change', () => this._setTheme(select.value));

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'dw-button';
    importBtn.textContent = 'Import theme…';
    importBtn.addEventListener('click', () => this._promptImportTheme(rebuildOptions));

    controls.appendChild(select);
    controls.appendChild(importBtn);
    row.appendChild(copy);
    row.appendChild(controls);
    return row;
  },

  _createBackgroundPicker() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-background-picker';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = 'Background';

    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = 'Curated Darkflow artwork.';

    copy.appendChild(label);
    copy.appendChild(description);

    const gallery = document.createElement('div');
    gallery.className = 'settings-background-gallery';
    gallery.setAttribute('role', 'radiogroup');
    gallery.setAttribute('aria-label', 'Background');

    const buttons = [];
    const syncSelection = () => {
      const activeKey = normalizeBackgroundKey(this._settings.background);
      for (const button of buttons) {
        const active = button.dataset.backgroundKey === activeKey;
        button.classList.toggle('active', active);
        button.setAttribute('aria-checked', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
      }
    };

    for (const preset of BACKGROUND_PRESETS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-background-option';
      button.classList.toggle('is-none', preset.key === NO_BACKGROUND_KEY);
      button.dataset.backgroundKey = preset.key;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-label', preset.label + '. ' + preset.description);
      button.title = preset.description;

      const preview = document.createElement('span');
      preview.className = 'settings-background-preview';
      preview.setAttribute('aria-hidden', 'true');
      if (preset.thumbnail) {
        const image = document.createElement('img');
        image.src = preset.thumbnail;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        preview.appendChild(image);
      }

      const check = document.createElement('span');
      check.className = 'settings-background-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '\u2713';

      const optionLabel = document.createElement('span');
      optionLabel.className = 'settings-background-label';
      optionLabel.textContent = preset.label;

      button.appendChild(preview);
      button.appendChild(check);
      button.appendChild(optionLabel);
      button.addEventListener('click', () => {
        this._setBackground(preset.key);
        syncSelection();
      });

      buttons.push(button);
      gallery.appendChild(button);
    }

    gallery.addEventListener('keydown', (event) => {
      const current = buttons.indexOf(event.target);
      if (current < 0) return;
      let next = current;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % buttons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[next].click();
      buttons[next].focus();
    });

    syncSelection();
    wrapper.appendChild(copy);
    wrapper.appendChild(gallery);
    return wrapper;
  },

  _promptImportTheme(onAdded) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        const theme = convertVsCodeTheme(json, {
          label: (json && json.name) || file.name.replace(/\.json$/i, ''),
        });
        let key = theme.key || 'imported';
        const base = key;
        let n = 2;
        while (BUILTIN_THEMES[key] || (this._settings.customThemes && this._settings.customThemes[key])) {
          key = base + '-' + n++;
        }
        theme.key = key;
        this._settings.customThemes = { ...(this._settings.customThemes || {}), [key]: theme };
        if (this._draftSettings) this._draftSettings.customThemes = this._settings.customThemes;
        this._setTheme(key);
        if (typeof onAdded === 'function') onAdded();
        this._setFooterStatus('Imported theme "' + theme.label + '".');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to import that theme file.';
        this._setFooterStatus(message, true);
      }
    });
    input.click();
  },

  _createNumberRow(labelText, descriptionText, value, options, onChange) {
    const row = document.createElement('div');
    row.className = 'settings-select-row';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const label = document.createElement('label');
    label.className = 'settings-label';
    label.textContent = labelText;

    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = descriptionText;

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'dw-input';
    input.value = value === null || value === undefined ? '' : String(value);
    input.placeholder = options.placeholder || '';
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = String(options.step || 1);
    input.addEventListener('input', () => onChange(input.value));

    copy.appendChild(label);
    copy.appendChild(description);
    row.appendChild(copy);
    row.appendChild(input);

    return row;
  },

  _normalizeKeyMappings(mappings) {
    if (!Array.isArray(mappings)) return [];

    return mappings
      .map((mapping) => {
        if (!mapping || typeof mapping !== 'object') return null;
        const code = typeof mapping.code === 'string' ? mapping.code.trim() : '';
        const legacyKey = typeof mapping.key === 'string' ? mapping.key.trim() : '';
        const command = typeof mapping.command === 'string' ? mapping.command.trim() : '';
        const normalizedCode = code || normalizeLegacyKeyToCode(legacyKey);
        if (!normalizedCode || !command) return null;
        const label = typeof mapping.label === 'string' && mapping.label.trim()
          ? mapping.label.trim()
          : formatKeyCodeLabel(normalizedCode);
        return {
          code: normalizedCode,
          label,
          command,
          legacyKey: code ? '' : legacyKey,
        };
      })
      .filter(Boolean);
  },

  _resolveKeyMappings() {
    if (isConfigurationCompatActive()) {
      return getEffectiveDefinitions('keyMappings')
        .filter(({ definition }) => definition.enabled !== false)
        .map(({ definition }) => ({
          code: definition.code || '',
          label: definition.label || formatKeyCodeLabel(definition.code || ''),
          legacyKey: definition.legacyKey || '',
          command: definition.command,
        }));
    }
    return this._settings.keyMappings;
  },

  _toBridgeKeyMappings(mappings) {
    const normalized = this._normalizeKeyMappings(mappings);
    const priorDefinitions = isConfigurationCompatActive()
      ? getEffectiveDefinitions('keyMappings').map((entry) => entry.definition)
      : [];
    const priorByCode = new Map(
      priorDefinitions.map((definition) => [definition.code.trim(), definition]),
    );

    // Reuse a prior definition's id only when its code matches exactly, never
    // by array position - an index-based fallback can hand one row's stable
    // id to an unrelated row whenever a save both removes a row and edits
    // another row's code, producing duplicate ids across key mappings.
    const usedIds = new Set();
    let nextGeneratedIndex = 1;
    const generateId = () => {
      let candidate;
      do {
        candidate = `keymap-${nextGeneratedIndex}`;
        nextGeneratedIndex += 1;
      } while (usedIds.has(candidate));
      return candidate;
    };

    return normalized.map((mapping) => {
      const code = mapping.code.trim();
      const prior = priorByCode.get(code);
      const id = prior && prior.id ? prior.id : generateId();
      usedIds.add(id);
      return {
        id,
        enabled: true,
        code: mapping.code,
        label: mapping.label,
        legacyKey: mapping.legacyKey,
        command: mapping.command,
      };
    });
  },

  _createCheckboxRow(labelText, descriptionText, checked, onChange) {
    const row = document.createElement('label');
    row.className = 'settings-checkbox-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = labelText;

    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = descriptionText;

    copy.appendChild(label);
    copy.appendChild(description);
    row.appendChild(input);
    row.appendChild(copy);

    return row;
  },

  _createVisualEffectsSettings() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-visual-effects';

    wrapper.appendChild(this._createCheckboxRow(
      'Game visual effects',
      'Enable visual presentation across the game. Individual effects can be selected below without changing game text, controls, or combatbrief settings.',
      !!this._draftSettings.visualEffectsEnabled,
      (checked) => {
        this._draftSettings.visualEffectsEnabled = checked;
      }
    ));

    const details = document.createElement('details');
    details.className = 'settings-visual-effects-details';

    const summary = document.createElement('summary');
    summary.className = 'settings-visual-effects-summary';

    const summaryLabel = document.createElement('span');
    summaryLabel.textContent = 'Individual effects';

    const summaryStatus = document.createElement('span');
    summaryStatus.className = 'settings-visual-effects-count';

    const effectsList = document.createElement('div');
    effectsList.className = 'settings-visual-effects-list';

    const updateSummary = () => {
      const preferences = normalizeVisualEffectPreferences(
        this._draftSettings.visualEffectPreferences
      );
      const enabledCount = VISUAL_EFFECT_OPTIONS.filter(
        (option) => preferences[option.key]
      ).length;
      summaryStatus.textContent = enabledCount + ' of ' + VISUAL_EFFECT_OPTIONS.length + ' enabled';
    };

    summary.appendChild(summaryLabel);
    summary.appendChild(summaryStatus);
    details.appendChild(summary);

    const preferences = normalizeVisualEffectPreferences(
      this._draftSettings.visualEffectPreferences
    );
    this._draftSettings.visualEffectPreferences = preferences;

    for (const option of VISUAL_EFFECT_OPTIONS) {
      const row = this._createCheckboxRow(
        option.label,
        option.description,
        preferences[option.key],
        (checked) => {
          this._draftSettings.visualEffectPreferences = {
            ...normalizeVisualEffectPreferences(this._draftSettings.visualEffectPreferences),
            [option.key]: checked,
          };
          updateSummary();
        }
      );
      row.classList.add('settings-visual-effect-row');
      effectsList.appendChild(row);
    }

    updateSummary();
    details.appendChild(effectsList);
    wrapper.appendChild(details);
    return wrapper;
  },

  _createAudioSettingsPanel() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-mapper-editor';
    const settings = soundManager.getSettings();

    wrapper.appendChild(this._createCheckboxRow(
      'Enable audio',
      'Allow game-triggered sound effects in this browser.',
      !!settings.enabled,
      (checked) => soundManager.setEnabled(checked)
    ));

    const volumeRow = document.createElement('div');
    volumeRow.className = 'settings-select-row';
    const copy = document.createElement('div');
    copy.className = 'settings-copy';
    const label = document.createElement('div');
    label.className = 'settings-label';
    label.textContent = 'Master volume';
    const description = document.createElement('p');
    description.className = 'dw-paragraph';
    description.textContent = 'Controls the overall level for every audio category.';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(settings.volume * 100));
    slider.className = 'sound-settings-volume';
    slider.setAttribute('data-1p-ignore', 'true');
    slider.setAttribute('data-op-ignore', 'true');
    const value = document.createElement('span');
    value.className = 'settings-connection-value';
    value.textContent = slider.value + '%';
    slider.addEventListener('input', () => {
      value.textContent = slider.value + '%';
      soundManager.setVolume(Number(slider.value) / 100);
    });
    copy.appendChild(label);
    copy.appendChild(description);
    volumeRow.appendChild(copy);
    volumeRow.appendChild(slider);
    volumeRow.appendChild(value);
    wrapper.appendChild(volumeRow);

    const categories = document.createElement('div');
    categories.className = 'settings-sound-categories';
    for (const category of SOUND_CATEGORIES) {
      const info = SOUND_CATEGORY_INFO[category];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sound-widget-category';
      button.dataset.category = category;
      button.setAttribute('aria-pressed', settings.categoryEnabled[category] ? 'true' : 'false');
      button.classList.toggle('enabled', !!settings.categoryEnabled[category]);
      button.classList.toggle('disabled', !settings.categoryEnabled[category]);
      button.innerHTML = '<span class="sound-widget-category-icon">' + info.icon + '</span>' +
        '<span class="sound-widget-category-label">' + info.label + '</span>';
      button.addEventListener('click', () => {
        soundManager.toggleCategory(category);
        const next = soundManager.getSettings().categoryEnabled[category];
        button.classList.toggle('enabled', !!next);
        button.classList.toggle('disabled', !next);
        button.setAttribute('aria-pressed', next ? 'true' : 'false');
      });
      categories.appendChild(button);
    }
    wrapper.appendChild(categories);

    return wrapper;
  },

  _createKeyMappingsEditor() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-mapper-editor';
    wrapper.dataset.editFocusScope = 'key-mapping-editor';

    const helpText = document.createElement('p');
    helpText.className = 'dw-paragraph settings-helper-text';
    helpText.textContent = 'Press a key in the Key field to capture it. Top-row numbers and numpad numbers are treated as different keys.';

    const list = document.createElement('div');
    list.className = 'settings-mapping-list';

    const ensureMappings = () => {
      if (!Array.isArray(this._draftSettings.keyMappings)) {
        this._draftSettings.keyMappings = [];
      }
      return this._draftSettings.keyMappings;
    };

    const addRow = (mapping, focusNew) => {
      const mappings = ensureMappings();
      mappings.push(mapping);

      const row = document.createElement('div');
      row.className = 'settings-mapping-row';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'dw-input settings-key-input';
      keyInput.placeholder = 'Press a key';
      keyInput.readOnly = true;
      keyInput.value = mapping.label || formatKeyCodeLabel(mapping.code);
      keyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') return;

        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'Backspace' || event.key === 'Delete') {
          mapping.code = '';
          mapping.label = '';
          mapping.legacyKey = '';
          keyInput.value = '';
          return;
        }

        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;

        mapping.code = event.code;
        mapping.label = formatKeyCodeLabel(event.code);
        mapping.legacyKey = '';
        keyInput.value = mapping.label;
      });

      const commandInput = document.createElement('input');
      commandInput.type = 'text';
      commandInput.className = 'dw-input settings-command-input';
      commandInput.placeholder = 'Command to send';
      commandInput.value = mapping.command;
      commandInput.addEventListener('input', () => {
        mapping.command = commandInput.value;
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        const index = mappings.indexOf(mapping);
        if (index !== -1) mappings.splice(index, 1);
        row.remove();
        addBtn.focus();
      });

      row.appendChild(keyInput);
      row.appendChild(commandInput);
      row.appendChild(removeBtn);
      list.appendChild(row);
      if (focusNew) requestAnimationFrame(() => keyInput.focus());
    };

    const savedMappings = ensureMappings().map((mapping) => ({
      code: mapping.code,
      label: mapping.label,
      legacyKey: mapping.legacyKey,
      command: mapping.command,
    }));
    this._draftSettings.keyMappings = [];
    savedMappings.forEach((mapping) => addRow(mapping));

    const actions = document.createElement('div');
    actions.className = 'settings-inline-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'dw-button dw-button-secondary settings-add-mapping';
    addBtn.type = 'button';
    addBtn.dataset.focusKey = 'key-mapping-add';
    addBtn.textContent = 'Add mapping';
    addBtn.addEventListener('click', () => addRow({ code: '', label: '', legacyKey: '', command: '' }, true));

    actions.appendChild(addBtn);
    wrapper.appendChild(helpText);
    wrapper.appendChild(list);
    wrapper.appendChild(actions);

    return wrapper;
  },

  _createColorSelect(value, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-color-input-row';
    const input = document.createElement('input');
    const swatch = document.createElement('span');
    const datalistId = 'highlight-color-suggestions';
    let datalist = document.getElementById(datalistId);

    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = datalistId;
      highlightManager.getColorSuggestions().forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);
      });
      document.body.appendChild(datalist);
    }

    const sync = () => {
      const normalized = highlightManager.normalizeColorToken(input.value);
      const cssColor = highlightManager.colorTokenToCss(input.value);
      input.classList.toggle('settings-input-invalid', Boolean(input.value.trim()) && !normalized);
      swatch.style.backgroundColor = cssColor || 'transparent';
      swatch.title = normalized || 'Invalid color';
      onChange(normalized || input.value.trim().toLowerCase());
    };

    input.type = 'text';
    input.className = 'dw-input';
    input.value = value || '';
    input.placeholder = 'yellow, bright-cyan, ansi-214, #38bdf8';
    input.setAttribute('list', datalistId);
    input.addEventListener('input', sync);
    input.addEventListener('blur', () => {
      const normalized = highlightManager.normalizeColorToken(input.value);
      if (normalized && input.value !== normalized) {
        input.value = normalized;
      }
      sync();
    });

    swatch.className = 'settings-color-swatch';
    wrapper.appendChild(input);
    wrapper.appendChild(swatch);
    sync();
    return wrapper;
  },

  _createHighlightEditor() {
    return createAutomationEditor(this, 'highlight');
  },

  _createVariablesEditor() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-aliases-editor';

    const toolbar = document.createElement('div');
    toolbar.className = 'settings-automation-toolbar';
    const toolbarHint = document.createElement('p');
    toolbarHint.className = 'dw-paragraph settings-helper-text';
    toolbarHint.textContent = 'Persistent variables back aliases like $pack. Aliases can also write to them with Set variable steps.';
    const scopeChip = document.createElement('span');
    scopeChip.className = 'settings-scope-chip';
    scopeChip.textContent = this._aliasScopeKey;
    scopeChip.title = 'Variables are saved with aliases for each server connection target. Active scope: ' + this._aliasScopeKey;
    toolbar.appendChild(toolbarHint);
    toolbar.appendChild(scopeChip);
    wrapper.appendChild(toolbar);

    const variableCard = document.createElement('div');
    variableCard.className = 'settings-mapper-editor settings-alias-variable-card';
    variableCard.dataset.editFocusScope = 'variables-editor';
    wrapper.appendChild(variableCard);

    const gmcpVariableCard = document.createElement('div');
    gmcpVariableCard.className = 'settings-mapper-editor settings-alias-variable-card';
    wrapper.appendChild(gmcpVariableCard);

    const renderGmcpVariables = () => {
      gmcpVariableCard.textContent = '';

      const title = document.createElement('div');
      title.className = 'settings-label';
      title.textContent = 'GMCP variables';

      const hint = document.createElement('p');
      hint.className = 'dw-paragraph settings-helper-text';
      hint.textContent = 'Live runtime variables from GMCP messages. They are available to automations, clear on reconnect, and are not saved.';

      gmcpVariableCard.appendChild(title);
      gmcpVariableCard.appendChild(hint);

      const entries = listGmcpVariables();
      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty settings-alias-variable-empty';
        empty.textContent = 'No GMCP variables have been received yet.';
        gmcpVariableCard.appendChild(empty);
        return;
      }

      const list = document.createElement('div');
      list.className = 'settings-alias-variable-list';

      entries.slice(0, 200).forEach(({ name, value }) => {
        const rowWrap = document.createElement('div');
        rowWrap.className = 'settings-alias-variable-row-wrap';

        const row = document.createElement('div');
        row.className = 'settings-alias-variable-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'dw-input';
        nameInput.value = name;
        nameInput.readOnly = true;

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'dw-input';
        valueInput.value = value;
        valueInput.readOnly = true;

        row.appendChild(nameInput);
        row.appendChild(valueInput);
        rowWrap.appendChild(row);
        list.appendChild(rowWrap);
      });

      gmcpVariableCard.appendChild(list);

      if (entries.length > 200) {
        const clipped = document.createElement('p');
        clipped.className = 'dw-paragraph settings-helper-text';
        clipped.textContent = 'Showing first 200 of ' + entries.length + ' live GMCP variables.';
        gmcpVariableCard.appendChild(clipped);
      }
    };

    const render = () => {
      this._syncDraftVariablesFromSteps();
      variableCard.textContent = '';

      const usageDetails = aliasManager.collectAliasUsageDetails(this._draftAliasScope);
      const entries = Object.entries(this._draftAliasScope.variables).sort((a, b) => a[0].localeCompare(b[0]));

      const actions = document.createElement('div');
      actions.className = 'settings-inline-actions';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'dw-button dw-button-secondary';
      addBtn.dataset.focusKey = 'variable-add';
      addBtn.textContent = 'Add variable';
      addBtn.addEventListener('click', () => {
        let index = 1;
        let nextName = 'var' + index;
        while (Object.prototype.hasOwnProperty.call(this._draftAliasScope.variables, nextName)) {
          index++;
          nextName = 'var' + index;
        }
        this._draftAliasScope.variables[nextName] = '';
        render();
        this._focusSettingsControl('variable-name-' + nextName);
      });

      actions.appendChild(addBtn);

      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-alias-empty settings-alias-variable-empty';

        const emptyText = document.createElement('div');
        emptyText.textContent = 'No variables yet. Add one here, or open Aliases and write a Set variable step.';

        const openAliasesBtn = document.createElement('button');
        openAliasesBtn.type = 'button';
        openAliasesBtn.className = 'dw-button dw-button-secondary';
        openAliasesBtn.textContent = 'Open Aliases';
        openAliasesBtn.addEventListener('click', () => {
          if (this._activateTab) this._activateTab('aliases');
          this._focusSettingsControl('alias-search');
        });

        empty.appendChild(emptyText);
        empty.appendChild(openAliasesBtn);
        variableCard.appendChild(empty);
        variableCard.appendChild(actions);
        renderGmcpVariables();
        return;
      }

      const list = document.createElement('div');
      list.className = 'settings-alias-variable-list';

      const addVariableRow = (name, value) => {
        let currentName = name;
        let expanded = false;
        const rowWrap = document.createElement('div');
        rowWrap.className = 'settings-alias-variable-row-wrap';

        const row = document.createElement('div');
        row.className = 'settings-alias-variable-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'dw-input';
        nameInput.dataset.focusKey = 'variable-name-' + name;
        nameInput.placeholder = 'pack';
        nameInput.value = name;

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'dw-input';
        valueInput.placeholder = 'mule';
        valueInput.value = value;

        const usageButton = document.createElement('button');
        usageButton.type = 'button';
        usageButton.className = 'dw-button dw-button-secondary settings-alias-usage-btn';
        const references = usageDetails.get(name) || [];
        usageButton.textContent = references.length + ' reference' + (references.length === 1 ? '' : 's');
        usageButton.disabled = !references.length;

        const usageList = document.createElement('div');
        usageList.className = 'settings-alias-usage-list';

        const renderUsageList = () => {
          usageList.textContent = '';
          if (!expanded || !references.length) return;
          references.forEach((alias) => {
            const aliasBtn = document.createElement('button');
            aliasBtn.type = 'button';
            aliasBtn.className = 'settings-alias-usage-item';
            aliasBtn.textContent = alias.description
              ? alias.description + ' (' + alias.trigger + ')'
              : alias.trigger;
            aliasBtn.addEventListener('click', () => {
              this._pendingAliasSelection = alias.id;
              if (this._activateTab) this._activateTab('aliases');
              this._focusSettingsControl('alias-row-' + alias.id);
            });
            usageList.appendChild(aliasBtn);
          });
        };

        usageButton.addEventListener('click', () => {
          expanded = !expanded;
          renderUsageList();
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dw-button dw-button-secondary settings-row-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          delete this._draftAliasScope.variables[currentName];
          render();
          this._focusSettingsControl('variable-add');
        });

        const sync = () => {
          const normalizedName = nameInput.value.trim();
          if (normalizedName !== currentName) {
            delete this._draftAliasScope.variables[currentName];
            currentName = normalizedName;
          }
          if (!normalizedName) return;
          this._draftAliasScope.variables[normalizedName] = valueInput.value;
        };

        nameInput.addEventListener('input', sync);
        valueInput.addEventListener('input', sync);

        row.appendChild(nameInput);
        row.appendChild(valueInput);
        row.appendChild(usageButton);
        row.appendChild(removeBtn);
        rowWrap.appendChild(row);
        rowWrap.appendChild(usageList);
        list.appendChild(rowWrap);
      };

      entries.forEach(([name, value]) => addVariableRow(name, value));
      variableCard.appendChild(list);
      variableCard.appendChild(actions);
      renderGmcpVariables();
    };

    render();
    return wrapper;
  },

  _createAliasEditor() {
    return createAutomationEditor(this, 'alias');
  },

  _createTriggerEditor() {
    return createAutomationEditor(this, 'trigger');
  },

  _createTimerEditor() {
    return createAutomationEditor(this, 'timer');
  },

  _createFunctionEditor() {
    return createAutomationEditor(this, 'function');
  },

  _createAboutPanel() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-about';

    const hero = document.createElement('div');
    hero.className = 'settings-about-hero';

    const mark = document.createElement('img');
    mark.className = 'settings-about-mark';
    mark.src = 'assets/brand/darkflow-app-icon.png';
    mark.alt = PRODUCT_NAME + ' app icon';

    const copy = document.createElement('div');
    copy.className = 'settings-copy';

    const name = document.createElement('div');
    name.className = 'settings-about-title';
    name.textContent = PRODUCT_NAME;

    const siteLink = document.createElement('a');
    siteLink.className = 'settings-about-extlink';
    siteLink.href = 'https://darkflow.darkwind.ai';
    siteLink.target = '_blank';
    siteLink.rel = 'noopener noreferrer';
    siteLink.title = 'Open ' + PRODUCT_NAME + ' site';
    siteLink.setAttribute('aria-label', 'Open ' + PRODUCT_NAME + ' site');
    siteLink.appendChild(this._externalLinkIcon());
    name.appendChild(siteLink);

    const tagline = document.createElement('div');
    tagline.className = 'settings-about-tagline';
    tagline.appendChild(document.createTextNode('Web-based MUD client - built for '));
    const darkwindLink = document.createElement('a');
    darkwindLink.href = 'https://play.darkwind.ai';
    darkwindLink.target = '_blank';
    darkwindLink.rel = 'noopener noreferrer';
    darkwindLink.className = 'settings-about-link';
    darkwindLink.textContent = 'Darkwind';
    tagline.appendChild(darkwindLink);

    copy.appendChild(name);
    copy.appendChild(tagline);
    hero.appendChild(mark);
    hero.appendChild(copy);
    wrapper.appendChild(hero);

    const infoGrid = document.createElement('div');
    infoGrid.className = 'settings-about-grid';

    const addInfo = (label, valueNode) => {
      const card = document.createElement('div');
      card.className = 'settings-connection-card';

      const labelEl = document.createElement('div');
      labelEl.className = 'settings-label';
      labelEl.textContent = label;

      const valueEl = document.createElement('div');
      valueEl.className = 'settings-connection-value';
      if (typeof valueNode === 'string') valueEl.textContent = valueNode;
      else valueEl.appendChild(valueNode);

      card.appendChild(labelEl);
      card.appendChild(valueEl);
      infoGrid.appendChild(card);
    };

    addInfo('Client version', state.clientVersion || 'unknown');

    const gmcpLink = document.createElement('a');
    gmcpLink.href = 'https://github.com/jasona/darkflow/tree/main/docs';
    gmcpLink.target = '_blank';
    gmcpLink.rel = 'noopener noreferrer';
    gmcpLink.className = 'settings-about-link';
    gmcpLink.textContent = 'See custom GMCP extensions';
    gmcpLink.appendChild(this._externalLinkIcon());
    addInfo('GMCP packages', gmcpLink);

    wrapper.appendChild(infoGrid);

    return wrapper;
  },

  _externalLinkIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'settings-about-extlink-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML =
      '<path fill="currentColor" d="M9 2h5v5h-1.5V4.56L7.78 9.28 6.72 8.22 11.44 3.5H9V2z"/>' +
      '<path fill="currentColor" d="M3 4h4v1.5H4.5v6h6V9H12v4H3V4z"/>';
    return svg;
  },

  _buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'dw-modal-overlay settings-overlay';
    overlay.addEventListener('focusin', (event) => {
      const scopeRoot = event.target instanceof HTMLElement
        ? event.target.closest('[data-edit-focus-scope]')
        : null;
      if (scopeRoot && scopeRoot instanceof HTMLElement) {
        this._activeEditFocusScope = scopeRoot.dataset.editFocusScope || null;
      } else if (!(event.target instanceof HTMLElement) ||
        event.target.dataset.focusKey !== 'settings-save') {
        this._activeEditFocusScope = null;
      }
    });

    const modal = document.createElement('div');
    modal.className = 'dw-modal settings-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'settings-modal-title');

    const header = document.createElement('div');
    header.className = 'dw-modal-header';

    const title = document.createElement('span');
    title.className = 'dw-modal-title';
    title.id = 'settings-modal-title';
    title.textContent = 'Settings';

    const dragHint = document.createElement('span');
    dragHint.className = 'settings-drag-hint';
    dragHint.textContent = 'drag to move - drag corner to resize';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dw-modal-close';
    closeBtn.setAttribute('aria-label', 'Close settings');
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(title);
    header.appendChild(dragHint);
    header.appendChild(closeBtn);

    // ── Floating window behavior ────────────────────────────────────────
    // The settings window is positioned, draggable by its header, resizable
    // via the native corner grip, and remembers its geometry across opens.
    const geo = settingsWindowGeometry();
    modal.style.left = geo.x + 'px';
    modal.style.top = geo.y + 'px';
    modal.style.width = geo.w + 'px';
    modal.style.height = geo.h + 'px';

    const saveGeometry = () => {
      saveSettingsWindowState({
        x: modal.offsetLeft,
        y: modal.offsetTop,
        w: modal.offsetWidth,
        h: modal.offsetHeight,
      });
    };

    let dragFrom = null;
    header.addEventListener('pointerdown', (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('button')) return;
      dragFrom = {
        dx: event.clientX - modal.offsetLeft,
        dy: event.clientY - modal.offsetTop,
      };
      try { header.setPointerCapture(event.pointerId); } catch (e) { /* ok */ }
      event.preventDefault();
    });
    header.addEventListener('pointermove', (event) => {
      if (!dragFrom) return;
      const x = Math.max(0, Math.min(
        event.clientX - dragFrom.dx,
        window.innerWidth - modal.offsetWidth
      ));
      const y = Math.max(0, Math.min(
        event.clientY - dragFrom.dy,
        window.innerHeight - modal.offsetHeight
      ));
      modal.style.left = x + 'px';
      modal.style.top = y + 'px';
    });
    const endDrag = () => {
      if (!dragFrom) return;
      dragFrom = null;
      saveGeometry();
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    if (typeof ResizeObserver === 'function') {
      let resizeSaveTimer = null;
      const ro = new ResizeObserver(() => {
        if (resizeSaveTimer) clearTimeout(resizeSaveTimer);
        resizeSaveTimer = setTimeout(() => {
          resizeSaveTimer = null;
          if (document.contains(modal)) saveGeometry();
        }, 250);
      });
      ro.observe(modal);
    }

    const body = document.createElement('div');
    body.className = 'dw-modal-body settings-modal-body';

    const tabs = document.createElement('div');
    tabs.className = 'settings-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-orientation', 'vertical');
    tabs.setAttribute('aria-label', 'Settings sections');

    const tabPanels = document.createElement('div');
    tabPanels.className = 'settings-tab-panels';

    const tabButtons = new Map();
    const tabContents = new Map();
    const tabOrder = [];
    let renderAliasesSection = null;
    let renderFunctionsSection = null;
    let renderVariablesSection = null;
    let currentTabKey = 'connection';

    // Search across every section: while a query is active, all sections are
    // shown stacked with non-matching rows hidden; clearing restores the
    // selected section.
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'settings-search-input';
    searchInput.placeholder = 'Search settings...';
    searchInput.setAttribute('aria-label', 'Search settings');
    searchInput.dataset.focusKey = 'settings-search';

    const restoreSectionRows = () => {
      for (const panel of tabContents.values()) {
        for (const child of panel.children) child.style.display = '';
      }
    };
    const clearSearch = () => {
      if (!searchInput.value) return;
      searchInput.value = '';
      restoreSectionRows();
      activateTab(currentTabKey);
    };
    this._clearSettingsSearch = clearSearch;

    const applySearch = () => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) {
        restoreSectionRows();
        activateTab(currentTabKey);
        return;
      }
      for (const [tabKey, btn] of tabButtons) {
        btn.classList.toggle('active', false);
        btn.setAttribute('aria-selected', 'false');
      }
      for (const panel of tabContents.values()) {
        let matches = 0;
        for (const child of panel.children) {
          if (child.tagName === 'H3') continue;
          const hit = (child.textContent || '').toLowerCase().includes(q);
          child.style.display = hit ? '' : 'none';
          if (hit) matches++;
        }
        // Keep the section heading when anything below it matched.
        for (const child of panel.children) {
          if (child.tagName === 'H3') child.style.display = matches ? '' : 'none';
        }
        panel.hidden = !matches;
        panel.style.display = matches ? 'flex' : 'none';
      }
    };
    searchInput.addEventListener('input', applySearch);

    const activateTab = (key) => {
      if (searchInput.value) {
        searchInput.value = '';
        restoreSectionRows();
      }
      currentTabKey = key;
      this._currentSettingsTab = key;
      saveSettingsWindowState({ tab: key });
      if (key === 'aliases' && renderAliasesSection) renderAliasesSection();
      if (key === 'functions' && renderFunctionsSection) renderFunctionsSection();
      if (key === 'variables' && renderVariablesSection) renderVariablesSection();
      for (const [tabKey, btn] of tabButtons) {
        btn.classList.toggle('active', tabKey === key);
        btn.setAttribute('aria-selected', tabKey === key ? 'true' : 'false');
        btn.tabIndex = tabKey === key ? 0 : -1;
      }
      for (const [tabKey, panel] of tabContents) {
        panel.hidden = tabKey !== key;
        panel.style.display = tabKey === key ? 'flex' : 'none';
      }
    };
    this._activateTab = activateTab;
    const createTab = (key, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-tab-btn';
      btn.id = 'settings-tab-' + key;
      btn.dataset.focusKey = 'settings-tab-' + key;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', 'settings-panel-' + key);
      btn.setAttribute('aria-selected', 'false');
      btn.tabIndex = -1;
      btn.textContent = label;
      btn.addEventListener('click', () => activateTab(key));
      btn.addEventListener('keydown', (event) => {
        const index = tabOrder.indexOf(key);
        let nextIndex = -1;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          nextIndex = (index + 1) % tabOrder.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          nextIndex = (index - 1 + tabOrder.length) % tabOrder.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = tabOrder.length - 1;
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activateTab(key);
          return;
        }
        if (nextIndex < 0) return;
        event.preventDefault();
        const nextKey = tabOrder[nextIndex];
        activateTab(nextKey);
        const nextBtn = tabButtons.get(nextKey);
        if (nextBtn) nextBtn.focus();
      });
      tabButtons.set(key, btn);
      tabOrder.push(key);
      tabs.appendChild(btn);

      const panel = document.createElement('section');
      panel.id = 'settings-panel-' + key;
      panel.className = 'settings-section';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'settings-tab-' + key);
      panel.hidden = true;
      panel.style.display = 'none';
      tabContents.set(key, panel);
      tabPanels.appendChild(panel);
      return panel;
    };

    const addNavGroup = (label) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'settings-nav-group';
      groupEl.textContent = label;
      tabs.appendChild(groupEl);
    };

    addNavGroup('Client');
    const connectionSection = createTab('connection', 'Connection');
    const appearanceSection = createTab('appearance', 'Appearance');
    const terminalSection = createTab('terminal', 'Terminal');
    const audioSection = createTab('audio', 'Audio');
    const controlsSection = createTab('controls', 'Controls');

    addNavGroup('Automation');
    const aliasesSection = createTab('aliases', 'Aliases');
    const triggersSection = createTab('triggers', 'Triggers');
    const timersSection = createTab('timers', 'Timers');
    const functionsSection = createTab('functions', 'Functions');
    const highlightsSection = createTab('highlights', 'Highlights');
    const variablesSection = createTab('variables', 'Variables');

    addNavGroup('Help');
    const aboutSection = createTab('about', 'About');

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'dw-heading';
    sectionTitle.textContent = 'Connection';

    connectionSection.appendChild(sectionTitle);
    connectionSection.appendChild(this._createCheckboxRow(
      'Auto-reconnect',
      'Reconnect automatically after unexpected connection loss.',
      !!this._draftSettings.autoReconnect,
      (checked) => {
        this._draftSettings.autoReconnect = checked;
      }
    ));

    connectionSection.appendChild(this._createCheckboxRow(
      'Monitor connection health',
      'Measure latency in the background and show it in the status bar; the Connection panel breaks lag down into network, server, and local causes.',
      this._draftSettings.lagMonitorEnabled !== false,
      (checked) => {
        this._draftSettings.lagMonitorEnabled = checked;
      }
    ));

    if (state.ws) {
      const connectionDetails = document.createElement('div');
      connectionDetails.className = 'settings-connection-card';

      const detailsLabel = document.createElement('div');
      detailsLabel.className = 'settings-label';
      detailsLabel.textContent = 'Current connection';

      const proto = dom.protocolSelect ? dom.protocolSelect.value : 'wss';
      const detailsValue = document.createElement('div');
      detailsValue.className = 'settings-connection-value';
      detailsValue.textContent = proto + '://' + (dom.host.value || 'localhost') + ':' + (dom.port.value || '4242');

      const disconnectBtn = document.createElement('button');
      disconnectBtn.className = 'dw-button settings-disconnect-btn';
      disconnectBtn.textContent = 'Disconnect';
      disconnectBtn.addEventListener('click', () => {
        state.userDisconnected = true;
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        if (state.ws) {
          state.ws.close(1000, 'User disconnect');
        }
        this.close();
      });

      connectionDetails.appendChild(detailsLabel);
      connectionDetails.appendChild(detailsValue);
      connectionDetails.appendChild(disconnectBtn);
      connectionSection.appendChild(connectionDetails);
    }

    const appearanceTitle = document.createElement('h3');
    appearanceTitle.className = 'dw-heading';
    appearanceTitle.textContent = 'Appearance';

    appearanceSection.appendChild(appearanceTitle);
    appearanceSection.appendChild(this._createThemeRow());
    appearanceSection.appendChild(this._createBackgroundPicker());

    const visualsTitle = document.createElement('h3');
    visualsTitle.className = 'dw-heading';
    visualsTitle.textContent = 'Visual effects';
    appearanceSection.appendChild(visualsTitle);
    appearanceSection.appendChild(this._createVisualEffectsSettings());

    const terminalTitle = document.createElement('h3');
    terminalTitle.className = 'dw-heading';
    terminalTitle.textContent = 'Terminal';

    terminalSection.appendChild(terminalTitle);
    terminalSection.appendChild(this._createSelectRow(
      'Scrollback memory',
      'Choose how much terminal history to retain before the oldest lines are discarded.',
      this._draftSettings.outputScrollbackPreset,
      [
        { value: 'low', label: 'Low (5,000 lines)' },
        { value: 'normal', label: 'Normal (10,000 lines)' },
        { value: 'high', label: 'High (20,000 lines)' },
      ],
      (value) => {
        this._draftSettings.outputScrollbackPreset = value;
      }
    ));
    terminalSection.appendChild(this._createSelectRow(
      'Scrollback mode',
      'Choose whether scrolling back pauses the terminal or opens a split view with live output below.',
      this._draftSettings.scrollbackBehavior,
      [
        { value: 'pause', label: 'Pause terminal' },
        { value: 'split', label: 'Split history + live' },
      ],
      (value) => {
        this._draftSettings.scrollbackBehavior = value;
      }
    ));
    terminalSection.appendChild(this._createNumberRow(
      'Screen width',
      'Leave blank for automatic pane width, or enter a fixed column width for server-side wrapping.',
      this._draftSettings.terminalWidthColumns,
      {
        min: MIN_TERMINAL_WIDTH_COLUMNS,
        max: MAX_TERMINAL_WIDTH_COLUMNS,
        step: 1,
        placeholder: 'Auto',
      },
      (value) => {
        this._draftSettings.terminalWidthColumns = value;
      }
    ));
    appearanceSection.appendChild(this._createSelectRow(
      'Workspace layout',
      'Choose the classic fixed terminal and sidebars, or a floating workspace where the terminal and panes can all move and dock.',
      this._draftSettings.workspaceLayout,
      [
        { value: 'classic', label: 'Classic terminal + sidebars' },
        { value: 'floating', label: 'Floating workspace' },
      ],
      (value) => {
        this._draftSettings.workspaceLayout = value;
      }
    ));
    appearanceSection.appendChild(this._createCheckboxRow(
      'Snap floating panes to grid',
      'Align floating pane positions and resized pane dimensions to a 16px grid.',
      !!this._draftSettings.paneGridSnapEnabled,
      (checked) => {
        this._draftSettings.paneGridSnapEnabled = checked;
      }
    ));
    const resetLayoutCard = document.createElement('div');
    resetLayoutCard.className = 'settings-connection-card';
    const resetLayoutLabel = document.createElement('div');
    resetLayoutLabel.className = 'settings-label';
    resetLayoutLabel.textContent = 'Pane layout';
    const resetLayoutCopy = document.createElement('p');
    resetLayoutCopy.className = 'dw-paragraph';
    resetLayoutCopy.textContent = 'Reset saved pane, dock, and terminal window positions for the current browser.';
    const resetLayoutBtn = document.createElement('button');
    resetLayoutBtn.className = 'dw-button dw-button-secondary';
    resetLayoutBtn.type = 'button';
    resetLayoutBtn.textContent = 'Reset layout';
    resetLayoutBtn.addEventListener('click', () => {
      const confirmed = window.confirm('Reset saved pane and terminal layout for this browser?');
      if (!confirmed) return;
      panelManager.resetLayoutState();
      this._setFooterStatus('Layout reset.');
    });
    resetLayoutCard.appendChild(resetLayoutLabel);
    resetLayoutCard.appendChild(resetLayoutCopy);
    resetLayoutCard.appendChild(resetLayoutBtn);
    appearanceSection.appendChild(resetLayoutCard);
    terminalSection.appendChild(this._createCheckboxRow(
      'Screen reader announcements',
      'Mirror new terminal lines into a hidden polite live region for browser screen readers.',
      !!this._draftSettings.screenReaderMode,
      (checked) => {
        this._draftSettings.screenReaderMode = checked;
      }
    ));
    const screenReaderSyncCard = document.createElement('div');
    screenReaderSyncCard.className = 'settings-connection-card';
    const screenReaderSyncLabel = document.createElement('div');
    screenReaderSyncLabel.className = 'settings-label';
    screenReaderSyncLabel.textContent = 'Game screen reader setting';
    const screenReaderSyncCopy = document.createElement('p');
    screenReaderSyncCopy.className = 'dw-paragraph';
    screenReaderSyncCopy.textContent = 'This sends set screenreader on to the game. It changes your saved MUD setting only when you press the button.';
    const screenReaderSyncBtn = document.createElement('button');
    screenReaderSyncBtn.className = 'dw-button dw-button-secondary';
    screenReaderSyncBtn.type = 'button';
    screenReaderSyncBtn.textContent = 'Sync now';
    screenReaderSyncBtn.disabled = !state.ws || state.ws.readyState !== WebSocket.OPEN;
    screenReaderSyncBtn.addEventListener('click', () => this._syncScreenReaderServerSetting());
    screenReaderSyncCard.appendChild(screenReaderSyncLabel);
    screenReaderSyncCard.appendChild(screenReaderSyncCopy);
    screenReaderSyncCard.appendChild(screenReaderSyncBtn);
    terminalSection.appendChild(screenReaderSyncCard);
    const audioTitle = document.createElement('h3');
    audioTitle.className = 'dw-heading';
    audioTitle.textContent = 'Audio';
    audioSection.appendChild(audioTitle);
    audioSection.appendChild(this._createAudioSettingsPanel());

    const controlsTitle = document.createElement('h3');
    controlsTitle.className = 'dw-heading';
    controlsTitle.textContent = 'Controls';

    controlsSection.appendChild(controlsTitle);
    controlsSection.appendChild(this._createCheckboxRow(
      'Keep last command selected after send',
      'Keep the last command in the input selected so Enter repeats it and typing replaces it.',
      !!this._draftSettings.repeatLastCommand,
      (checked) => {
        this._draftSettings.repeatLastCommand = checked;
      }
    ));
    controlsSection.appendChild(this._createCheckboxRow(
      'Use aliases for Tab completion',
      'Complete matching client aliases before falling back to command history or server-side Tab completion.',
      !!this._draftSettings.aliasTabCompletionEnabled,
      (checked) => {
        this._draftSettings.aliasTabCompletionEnabled = checked;
      }
    ));
    controlsSection.appendChild(this._createCheckboxRow(
      'Use command history for Tab completion',
      'Try recent commands with the same verb before falling back to server-side Tab completion.',
      !!this._draftSettings.historyTabCompletionEnabled,
      (checked) => {
        this._draftSettings.historyTabCompletionEnabled = checked;
      }
    ));
    controlsSection.appendChild(this._createCheckboxRow(
      'Show emoji picker',
      'Show emoji suggestions when typing a colon followed by an emoji name.',
      this._draftSettings.emojiPickerEnabled !== false,
      (checked) => {
        this._draftSettings.emojiPickerEnabled = checked;
      }
    ));

    const keyMapperFields = this._createKeyMappingsEditor();
    keyMapperFields.style.display = this._draftSettings.keyMapperEnabled ? 'flex' : 'none';

    controlsSection.appendChild(this._createCheckboxRow(
      'Enable custom key mappings',
      'Bind keys like ArrowUp or 1 to send commands immediately without pressing Enter.',
      !!this._draftSettings.keyMapperEnabled,
      (checked) => {
        this._draftSettings.keyMapperEnabled = checked;
        keyMapperFields.style.display = checked ? 'flex' : 'none';
      }
    ));
    controlsSection.appendChild(keyMapperFields);
    controlsSection.appendChild(this._createCheckboxRow(
      'Send tab-away / tab-back on tab changes',
      'Automatically notifies the game when this browser tab becomes inactive or active again.',
      !!this._draftSettings.tabObservabilityEnabled,
      (checked) => {
        this._draftSettings.tabObservabilityEnabled = checked;
      }
    ));
    controlsSection.appendChild(this._createCheckboxRow(
      'Prompt to export changed settings',
      'Ask to download a backup when settings changed during the session and the settings panel is closed.',
      !!this._draftSettings.settingsBackupPromptEnabled,
      (checked) => {
        this._draftSettings.settingsBackupPromptEnabled = checked;
      }
    ));

    const triggersTitle = document.createElement('h3');
    triggersTitle.className = 'dw-heading';
    triggersTitle.textContent = 'Triggers';
    triggersSection.appendChild(triggersTitle);
    triggersSection.appendChild(this._createTriggerEditor());

    const timersTitle = document.createElement('h3');
    timersTitle.className = 'dw-heading';
    timersTitle.textContent = 'Timers';
    timersSection.appendChild(timersTitle);
    timersSection.appendChild(this._createTimerEditor());

    renderFunctionsSection = () => {
      functionsSection.textContent = '';
      const functionsTitle = document.createElement('h3');
      functionsTitle.className = 'dw-heading';
      functionsTitle.textContent = 'Functions';
      functionsSection.appendChild(functionsTitle);
      functionsSection.appendChild(this._createFunctionEditor());
    };
    renderFunctionsSection();

    const highlightsTitle = document.createElement('h3');
    highlightsTitle.className = 'dw-heading';
    highlightsTitle.textContent = 'Highlights';
    highlightsSection.appendChild(highlightsTitle);
    highlightsSection.appendChild(this._createHighlightEditor());

    renderAliasesSection = () => {
      aliasesSection.textContent = '';
      const aliasesTitle = document.createElement('h3');
      aliasesTitle.className = 'dw-heading';
      aliasesTitle.textContent = 'Aliases';
      aliasesSection.appendChild(aliasesTitle);
      aliasesSection.appendChild(this._createAliasEditor());
    };
    renderAliasesSection();

    renderVariablesSection = () => {
      variablesSection.textContent = '';
      const variablesTitle = document.createElement('h3');
      variablesTitle.className = 'dw-heading';
      variablesTitle.textContent = 'Variables';
      variablesSection.appendChild(variablesTitle);
      variablesSection.appendChild(this._createVariablesEditor());
    };
    renderVariablesSection();

    const aboutTitle = document.createElement('h3');
    aboutTitle.className = 'dw-heading';
    aboutTitle.textContent = 'About';
    aboutSection.appendChild(aboutTitle);
    aboutSection.appendChild(this._createAboutPanel());

    this._refreshEditors = () => {
      triggersSection.textContent = '';
      const nextTriggersTitle = document.createElement('h3');
      nextTriggersTitle.className = 'dw-heading';
      nextTriggersTitle.textContent = 'Triggers';
      triggersSection.appendChild(nextTriggersTitle);
      triggersSection.appendChild(this._createTriggerEditor());

      timersSection.textContent = '';
      const nextTimersTitle = document.createElement('h3');
      nextTimersTitle.className = 'dw-heading';
      nextTimersTitle.textContent = 'Timers';
      timersSection.appendChild(nextTimersTitle);
      timersSection.appendChild(this._createTimerEditor());

      highlightsSection.textContent = '';
      const nextHighlightsTitle = document.createElement('h3');
      nextHighlightsTitle.className = 'dw-heading';
      nextHighlightsTitle.textContent = 'Highlights';
      highlightsSection.appendChild(nextHighlightsTitle);
      highlightsSection.appendChild(this._createHighlightEditor());

      if (renderFunctionsSection) renderFunctionsSection();
      if (renderAliasesSection) renderAliasesSection();
      if (renderVariablesSection) renderVariablesSection();
    };

    activateTab(tabButtons.has(geo.tab) ? geo.tab : 'connection');

    const sidebar = document.createElement('div');
    sidebar.className = 'settings-sidebar';
    const searchWrap = document.createElement('div');
    searchWrap.className = 'settings-search';
    searchWrap.appendChild(searchInput);
    sidebar.appendChild(searchWrap);
    sidebar.appendChild(tabs);

    const main = document.createElement('div');
    main.className = 'settings-main';
    main.appendChild(tabPanels);

    body.appendChild(sidebar);
    body.appendChild(main);

    const footer = document.createElement('div');
    footer.className = 'settings-modal-footer';

    const footerStatus = document.createElement('div');
    footerStatus.className = 'settings-footer-status';
    this._footerStatusEl = footerStatus;

    const exportBtn = document.createElement('button');
    exportBtn.className = 'dw-button dw-button-secondary';
    exportBtn.textContent = 'Export settings';
    exportBtn.addEventListener('click', () => this._downloadSettingsBundle());

    const importBtn = document.createElement('button');
    importBtn.className = 'dw-button dw-button-secondary';
    importBtn.textContent = 'Import settings';
    importBtn.addEventListener('click', () => this._promptImportSettingsBundle());

    const closePanelBtn = document.createElement('button');
    closePanelBtn.className = 'dw-button dw-button-secondary';
    closePanelBtn.textContent = 'Close';
    closePanelBtn.addEventListener('click', () => this.close());

    const applyBtn = document.createElement('button');
    applyBtn.className = 'dw-button dw-button-secondary';
    applyBtn.dataset.focusKey = 'settings-apply';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => this._applyDraftChanges(false));

    const saveBtn = document.createElement('button');
    saveBtn.className = 'dw-button dw-button-primary';
    saveBtn.dataset.focusKey = 'settings-save';
    saveBtn.textContent = 'Save & Close';
    saveBtn.addEventListener('click', () => this._applyDraftChanges(true));

    footer.appendChild(footerStatus);
    footer.appendChild(exportBtn);
    footer.appendChild(importBtn);
    footer.appendChild(closePanelBtn);
    footer.appendChild(applyBtn);
    footer.appendChild(saveBtn);
    main.appendChild(footer);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    return overlay;
  },
};
