import { dom } from './state.js';
import { FG_NAMES, BRIGHT_FG_NAMES, COLOR_256 } from './constants.js';
import {
  getActiveCharacterProfileId,
  getEffectiveDefinitions,
  isConfigurationCompatActive,
  removeLocalDefinitionByIdentity,
  replaceLocalDefinitions,
  upsertLocalDefinitionByIdentity,
} from './session-compat/configuration.js';

const HIGHLIGHT_STORAGE_KEY = 'darkwind-client-highlights-v1';
const COLOR_INDEX_BY_NAME = FG_NAMES.reduce((map, name, index) => {
  map[name] = index;
  return map;
}, {});
const BRIGHT_COLOR_INDEX_BY_NAME = BRIGHT_FG_NAMES.reduce((map, name, index) => {
  map[name] = index;
  return map;
}, {});
const COLOR_SUGGESTIONS = FG_NAMES.concat(BRIGHT_FG_NAMES, [
  'ansi-16',
  'ansi-17',
  'ansi-18',
  'ansi-19',
  'ansi-20',
  'ansi-21',
  'ansi-27',
  'ansi-33',
  'ansi-39',
  'ansi-45',
  'ansi-196',
  'ansi-197',
  'ansi-198',
  'ansi-199',
  'ansi-200',
  'ansi-201',
  'ansi-208',
  'ansi-214',
  'ansi-220',
  'ansi-202',
  'ansi-226',
  'ansi-190',
  'ansi-154',
  'ansi-46',
  'ansi-82',
  'ansi-118',
  'ansi-120',
  'ansi-51',
  'ansi-87',
  'ansi-123',
  'ansi-159',
  'ansi-93',
  'ansi-99',
  'ansi-129',
  'ansi-135',
  'ansi-165',
  'ansi-171',
  'ansi-177',
  'ansi-183',
  'ansi-189',
  'ansi-203',
  'ansi-209',
  'ansi-215',
  'ansi-221',
  'ansi-227',
  'ansi-231',
  'ansi-232',
  'ansi-233',
  'ansi-234',
  'ansi-235',
  'ansi-236',
  'ansi-237',
  'ansi-238',
  'ansi-239',
  'ansi-240',
  'ansi-241',
  'ansi-242',
  'ansi-243',
  'ansi-244',
  'ansi-245',
  'ansi-246',
  'ansi-247',
  'ansi-248',
  'ansi-249',
  'ansi-250',
  'ansi-251',
  'ansi-252',
  'ansi-253',
  'ansi-254',
  'ansi-255',
  '#ff4d4f',
  '#ff8800',
  '#facc15',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#38bdf8',
  '#60a5fa',
  '#a78bfa',
  '#d946ef',
  '#f472b6',
  '#f8fafc',
  '#94a3b8',
  '#1e293b',
  '#111827',
  '#2d1117',
  '#102a1f',
  '#0f2438',
]);

function createId() {
  return 'highlight-' + Math.random().toString(36).slice(2, 10);
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function emitHighlightDataChanged(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('darkwind:highlight-data-changed', {
    detail: detail || null,
  }));
}

function normalizeStyle(style) {
  if (!style || typeof style !== 'object') {
    return { fg: 'yellow', bg: 'black', bold: false };
  }

  const fg = normalizeColorToken(style.fg) || 'yellow';
  const bg = normalizeColorToken(style.bg) || 'black';

  return {
    fg,
    bg,
    bold: Boolean(style.bold),
  };
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const patternSource = String(rule.patternSource || '').trim();
  if (!patternSource) return null;

  return {
    id: typeof rule.id === 'string' && rule.id ? rule.id : createId(),
    enabled: rule.enabled !== false,
    patternSource,
    ignoreCase: Boolean(rule.ignoreCase),
    description: String(rule.description || ''),
    group: String(rule.group || '').trim().replace(/\s+/g, ' '),
    style: normalizeStyle(rule.style),
  };
}

function normalizeScope(scope) {
  const rules = Array.isArray(scope && scope.rules)
    ? scope.rules.map(normalizeRule).filter(Boolean)
    : [];

  return { rules };
}

function highlightIdentityKey(patternSource) {
  return String(patternSource || '').trim();
}

function cloneHighlightRule(rule) {
  return {
    ...rule,
    style: { ...rule.style },
  };
}

function getEffectiveHighlightEntries() {
  return getEffectiveDefinitions('highlights');
}

function getEffectiveHighlightRules() {
  return getEffectiveHighlightEntries().map((entry) => cloneHighlightRule(entry.definition));
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

function compileRule(rule) {
  try {
    return {
      regex: new RegExp(rule.patternSource, 'g' + (rule.ignoreCase ? 'i' : '')),
      error: null,
    };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : 'Invalid regex.',
    };
  }
}

function cloneStyle(style) {
  return {
    bold: Boolean(style && style.bold),
    italic: Boolean(style && style.italic),
    fraktur: Boolean(style && style.fraktur),
    underline: Boolean(style && style.underline),
    doubleUnderline: Boolean(style && style.doubleUnderline),
    strikethrough: Boolean(style && style.strikethrough),
    overline: Boolean(style && style.overline),
    hidden: Boolean(style && style.hidden),
    inverse: Boolean(style && style.inverse),
    blink: Boolean(style && style.blink),
    fg: style && style.fg ? { ...style.fg } : null,
    bg: style && style.bg ? { ...style.bg } : null,
  };
}

function buildAnsiColor(name) {
  const color = parseColorToken(name);
  if (!color) return null;
  if (color.type === 'standard' || color.type === 'bright' || color.type === '256') {
    return color;
  }
  return { type: 'rgb', r: color.r, g: color.g, b: color.b };
}

function mergeHighlightStyle(baseStyle, highlightStyle) {
  const merged = cloneStyle(baseStyle || {});
  merged.bold = Boolean(highlightStyle.bold);
  merged.fg = buildAnsiColor(highlightStyle.fg);
  merged.bg = buildAnsiColor(highlightStyle.bg);
  return merged;
}

function stylesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyRulesToLine(line, compiledRules) {
  if (!line || !line.text || !Array.isArray(line.fragments) || !compiledRules.length) {
    return line;
  }

  const owners = new Array(line.text.length).fill(-1);
  let hasMatches = false;

  compiledRules.forEach((entry, entryIndex) => {
    if (!entry.regex) return;

    entry.regex.lastIndex = 0;
    let match = entry.regex.exec(line.text);

    while (match) {
      const matchedText = String(match[0] || '');
      if (!matchedText.length) {
        entry.regex.lastIndex += 1;
        match = entry.regex.exec(line.text);
        continue;
      }

      const start = match.index;
      const end = start + matchedText.length;
      let applied = false;
      for (let index = start; index < end; index++) {
        if (owners[index] !== -1) continue;
        owners[index] = entryIndex;
        applied = true;
      }
      hasMatches = hasMatches || applied;
      match = entry.regex.exec(line.text);
    }
  });

  if (!hasMatches) return line;

  const nextFragments = [];
  let textIndex = 0;

  for (const fragment of line.fragments) {
    const text = String(fragment.text || '');
    if (!text.length) continue;

    let segmentText = '';
    let segmentStyle = null;
    let segmentHref = null;

    for (const ch of text) {
      const ownerIndex = owners[textIndex];
      const nextStyle = ownerIndex === -1
        ? cloneStyle(fragment.style || {})
        : mergeHighlightStyle(fragment.style || {}, compiledRules[ownerIndex].style);
      const nextHref = fragment.href || null;

      if (segmentText && stylesEqual(segmentStyle, nextStyle) && segmentHref === nextHref) {
        segmentText += ch;
      } else {
        if (segmentText) {
          nextFragments.push({ text: segmentText, style: segmentStyle, href: segmentHref });
        }
        segmentText = ch;
        segmentStyle = nextStyle;
        segmentHref = nextHref;
      }

      textIndex++;
    }

    if (segmentText) {
      nextFragments.push({ text: segmentText, style: segmentStyle, href: segmentHref });
    }
  }

  return {
    ...line,
    fragments: nextFragments,
  };
}

function parseTintinStyle(styleText) {
  const tokens = normalizeWhitespace(styleText).split(' ').filter(Boolean);
  if (!tokens.length) {
    return { style: null, error: 'Highlight style is required.' };
  }

  const colors = [];
  let bold = false;

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === 'b') {
      bold = true;
      continue;
    }
    const color = normalizeColorToken(normalized);
    if (!color) {
      return { style: null, error: 'Unknown color "' + token + '".' };
    }
    colors.push(color);
  }

  if (colors.length === 0) {
    return { style: null, error: 'Highlight style must include at least one color.' };
  }
  if (colors.length > 2) {
    return { style: null, error: 'Highlight style can only include foreground and background colors.' };
  }

  return {
    style: {
      fg: colors[0],
      bg: colors[1] || 'black',
      bold,
    },
    error: null,
  };
}

function formatTintinStyle(style) {
  const tokens = [style.fg];
  if (style.bold) tokens.push('b');
  if (style.bg) tokens.push(style.bg);
  return tokens.join(' ');
}

function normalizeColorToken(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return '';
  if (parseColorToken(token)) return token;
  return '';
}

function parseColorToken(value) {
  const token = String(value || '').trim().toLowerCase();
  let match;

  if (COLOR_INDEX_BY_NAME[token] !== undefined) {
    return { type: 'standard', index: COLOR_INDEX_BY_NAME[token] };
  }
  if (BRIGHT_COLOR_INDEX_BY_NAME[token] !== undefined) {
    return { type: 'bright', index: BRIGHT_COLOR_INDEX_BY_NAME[token] };
  }
  match = token.match(/^(?:ansi|xterm)-([0-9]{1,3})$/);
  if (match) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index >= 0 && index <= 255) {
      return { type: '256', index };
    }
    return null;
  }
  match = token.match(/^#([0-9a-f]{6})$/);
  if (match) {
    return {
      type: 'rgb',
      r: parseInt(match[1].slice(0, 2), 16),
      g: parseInt(match[1].slice(2, 4), 16),
      b: parseInt(match[1].slice(4, 6), 16),
    };
  }
  return null;
}

function colorTokenToCss(value) {
  const color = parseColorToken(value);
  if (!color) return '';
  if (color.type === 'standard') return COLOR_256[color.index] || '';
  if (color.type === 'bright') return COLOR_256[color.index + 8] || '';
  if (color.type === '256') return COLOR_256[color.index] || '';
  if (color.type === 'rgb') {
    return '#' + [color.r, color.g, color.b].map((part) => part.toString(16).padStart(2, '0')).join('');
  }
  return '';
}

export const highlightManager = {
  _data: { scopes: {} },

  init() {
    try {
      const raw = localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
      if (raw) {
        this._data = normalizeData(JSON.parse(raw));
        return;
      }
    } catch (error) {
      console.warn('Failed to load highlights', error);
    }

    this._data = { scopes: {} };
  },

  _save(detail = null) {
    try {
      localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify(this._data));
      emitHighlightDataChanged({
        scopeKey: detail && detail.scopeKey ? detail.scopeKey : this.getActiveScopeKey(),
        ...detail,
      });
    } catch (error) {
      console.warn('Failed to save highlights', error);
    }
  },

  getActiveScopeKey() {
    if (isConfigurationCompatActive()) {
      return getActiveCharacterProfileId();
    }
    const host = normalizeWhitespace(dom.host && dom.host.value ? dom.host.value : '').toLowerCase() || 'default';
    const port = normalizeWhitespace(dom.port && dom.port.value ? dom.port.value : '') || '4242';
    // Preserve existing scope keys: secure (wss/telnets) → 'wss', plain → 'ws'.
    const sel = dom.protocolSelect && dom.protocolSelect.value;
    const protocol = (sel === 'wss' || sel === 'telnets') ? 'wss' : 'ws';
    return protocol + '://' + host + ':' + port;
  },

  _ensureScope(scopeKey) {
    if (!this._data.scopes[scopeKey]) {
      this._data.scopes[scopeKey] = { rules: [] };
    }
    return this._data.scopes[scopeKey];
  },

  getScopeSnapshot(scopeKey = this.getActiveScopeKey()) {
    if (isConfigurationCompatActive()) {
      return {
        rules: getEffectiveHighlightRules(),
      };
    }
    const scope = normalizeScope(this._ensureScope(scopeKey));
    return {
      rules: scope.rules.map((rule) => cloneHighlightRule(rule)),
    };
  },

  getScopeSnapshotWithSource(scopeKey = this.getActiveScopeKey()) {
    if (isConfigurationCompatActive()) {
      return {
        rules: getEffectiveHighlightEntries().map((entry) => ({
          ...cloneHighlightRule(entry.definition),
          source: entry.source,
        })),
      };
    }
    const scope = normalizeScope(this._ensureScope(scopeKey));
    return {
      rules: scope.rules.map((rule) => cloneHighlightRule(rule)),
    };
  },

  saveScope(scopeKey, scope) {
    if (isConfigurationCompatActive()) {
      replaceLocalDefinitions('highlights', normalizeScope(scope).rules);
      emitHighlightDataChanged({ scopeKey });
      return;
    }
    this._data.scopes[scopeKey] = normalizeScope(scope);
    this._save({ scopeKey });
  },

  createEmptyRule() {
    return {
      id: createId(),
      enabled: true,
      patternSource: '',
      ignoreCase: false,
      description: '',
      group: '',
      style: {
        fg: 'yellow',
        bg: 'black',
        bold: false,
      },
    };
  },

  findRuleByPattern(patternSource, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = highlightIdentityKey(patternSource);
    if (!normalizedPattern) return null;
    if (isConfigurationCompatActive()) {
      const entry = getEffectiveHighlightEntries().find(
        (item) => highlightIdentityKey(item.definition.patternSource) === normalizedPattern,
      );
      return entry ? cloneHighlightRule(entry.definition) : null;
    }
    return this._ensureScope(scopeKey).rules.find((rule) => rule.patternSource === normalizedPattern) || null;
  },

  findRuleByPatternWithSource(patternSource, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = highlightIdentityKey(patternSource);
    if (!normalizedPattern) return null;
    if (isConfigurationCompatActive()) {
      const entry = getEffectiveHighlightEntries().find(
        (item) => highlightIdentityKey(item.definition.patternSource) === normalizedPattern,
      );
      if (!entry) return null;
      return {
        ...cloneHighlightRule(entry.definition),
        source: entry.source,
      };
    }
    const rule = this.findRuleByPattern(patternSource, scopeKey);
    return rule ? cloneHighlightRule(rule) : null;
  },

  upsertSimpleRule(patternSource, styleText, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = highlightIdentityKey(patternSource);
    if (!normalizedPattern) {
      return { rule: null, error: 'Highlight pattern is required.' };
    }

    const parsedStyle = parseTintinStyle(styleText);
    if (parsedStyle.error) {
      return { rule: null, error: parsedStyle.error };
    }

    const existing = this.findRuleByPattern(normalizedPattern, scopeKey);
    const rule = existing || this.createEmptyRule();

    rule.enabled = true;
    rule.patternSource = normalizedPattern;
    rule.ignoreCase = false;
    rule.style = parsedStyle.style;

    const compiled = compileRule(rule);
    if (compiled.error) {
      return { rule: null, error: compiled.error };
    }

    if (isConfigurationCompatActive()) {
      const normalizedRule = normalizeRule(rule);
      if (!normalizedRule) {
        return { rule: null, error: 'Highlight pattern is required.' };
      }
      upsertLocalDefinitionByIdentity('highlights', normalizedRule);
      emitHighlightDataChanged({ scopeKey });
    } else {
      const scope = this._ensureScope(scopeKey);
      if (!existing) {
        scope.rules.push(rule);
      }
      this._save({ scopeKey });
    }

    return {
      rule: cloneHighlightRule(rule),
      error: null,
    };
  },

  removeRuleByPattern(patternSource, scopeKey = this.getActiveScopeKey()) {
    const normalizedPattern = highlightIdentityKey(patternSource);
    if (!normalizedPattern) return false;

    if (isConfigurationCompatActive()) {
      const removed = removeLocalDefinitionByIdentity('highlights', normalizedPattern);
      if (removed) emitHighlightDataChanged({ scopeKey });
      return removed;
    }

    const scope = this._ensureScope(scopeKey);
    const nextRules = scope.rules.filter((rule) => rule.patternSource !== normalizedPattern);
    if (nextRules.length === scope.rules.length) return false;
    scope.rules = nextRules;
    this._save({ scopeKey });
    return true;
  },

  getRuleDiagnostics(scope, ruleId) {
    const rules = Array.isArray(scope && scope.rules) ? scope.rules : [];
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) return [];

    const diagnostics = [];
    if (!String(rule.patternSource || '').trim()) {
      diagnostics.push('Pattern is required.');
    }

    const duplicate = rules.find((item) => item.id !== rule.id && item.patternSource === rule.patternSource);
    if (duplicate) {
      diagnostics.push('Pattern conflicts with another highlight rule in this scope.');
    }

    const compiled = compileRule(rule);
    if (compiled.error) {
      diagnostics.push(compiled.error);
    }
    if (!normalizeColorToken(rule.style && rule.style.fg)) {
      diagnostics.push('Foreground color is invalid.');
    }
    if (!normalizeColorToken(rule.style && rule.style.bg)) {
      diagnostics.push('Background color is invalid.');
    }

    return diagnostics;
  },

  describeRule(rule) {
    if (!rule) return '';
    return '/' + rule.patternSource + '/ -> ' + formatTintinStyle(rule.style);
  },

  formatRuleStyle(rule) {
    return formatTintinStyle(rule.style);
  },

  getCompiledRules(scopeKey = this.getActiveScopeKey(), scopeOverride = null) {
    const rules = scopeOverride
      ? normalizeScope(scopeOverride).rules
      : (isConfigurationCompatActive()
        ? getEffectiveHighlightRules()
        : this._ensureScope(scopeKey).rules);
    return rules
      .filter((rule) => rule.enabled !== false)
      .map((rule) => {
        const compiled = compileRule(rule);
        return {
          ...rule,
          regex: compiled.regex,
          error: compiled.error,
        };
      })
      .filter((rule) => rule.regex);
  },

  applyHighlightsToLines(lines, scopeKey = this.getActiveScopeKey()) {
    const compiledRules = this.getCompiledRules(scopeKey);
    if (!compiledRules.length || !Array.isArray(lines) || !lines.length) return lines;
    return lines.map((line) => applyRulesToLine(line, compiledRules));
  },

  applyHighlightsToText(text, rules) {
    const compiledRules = Array.isArray(rules)
      ? rules
        .map((rule) => {
          const compiled = compileRule(rule);
          return {
            ...rule,
            regex: compiled.regex,
            error: compiled.error,
          };
        })
        .filter((rule) => rule.enabled !== false && rule.regex)
      : this.getCompiledRules(this.getActiveScopeKey());

    const line = {
      id: 'preview',
      text: String(text || ''),
      cssClass: '',
      height: 0,
      fragments: [{ text: String(text || ''), style: {} }],
    };

    return applyRulesToLine(line, compiledRules).fragments;
  },

  normalizeColorToken,

  isValidColorToken(value) {
    return Boolean(normalizeColorToken(value));
  },

  colorTokenToCss,

  getColorSuggestions() {
    return COLOR_SUGGESTIONS.slice();
  },
};

export { parseTintinStyle };
