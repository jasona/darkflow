import { gmcp } from './gmcp.js';
import { createControllerLifecycle, disposeControllerLifecycle } from './session-compat/controllers.js';
import { state as appState } from './state.js';
import {
  createVisualEffectsState,
  createVisualWorldState,
  deriveRoomVisualContext,
  reduceHealthState,
  reduceVisualEffectEvents,
  reduceVisualWorldState,
  normalizeVisualPreview,
} from './visual-effects-core.mjs';
import {
  createDefaultVisualEffectPreferences,
  normalizeVisualEffectPreferences,
  visualEffectsSubscriptionEnabled,
} from './visual-effects-settings.mjs';

const SETTINGS_CHANGED_EVENT = 'darkwind:settings-changed';
const CONNECTION_STATE_EVENT = 'dw:connectionstate';
const ROOT_ID = 'visual-effects-root';
const PREVIEW_TTL_MS = 5000;
const WORLD_TRANSITION_MS = 1250;
const PREVIEW_CLASSES = [
  'is-preview-planet',
  'is-preview-terrain',
  'is-preview-low-health',
  'is-preview-transition',
];
const MOTION_CLASSES = {
  incoming: 'dw-visual-impact-shake',
  outgoing: 'dw-visual-attack-lunge',
};
const TRANSIENT_EFFECT_KEYS = {
  incoming: 'incomingDamage',
  outgoing: 'outgoingDamage',
  spell: 'spellCasts',
};
const PREVIEW_EFFECT_KEYS = {
  planet: 'planetAmbience',
  terrain: 'terrainAmbience',
  'low-health': 'lowHealth',
  transition: 'worldTransitions',
};
const EFFECT_CONFIG = {
  incoming: {
    activeClass: 'is-incoming-damage',
    classPrefix: 'is-incoming-intensity-',
    duration: 420,
    cooldown: 600,
  },
  outgoing: {
    activeClass: 'is-outgoing-damage',
    classPrefix: 'is-outgoing-intensity-',
    duration: 360,
    cooldown: 420,
  },
  spell: {
    activeClass: 'is-spell-cast',
    classPrefix: 'is-spell-',
    duration: 620,
    durationByValue: {
      fire: 1150,
      cold: 1450,
      lightning: 980,
    },
    cooldown: 320,
  },
};
const PLANET_CLASSES = ['darkwind', 'dailos', 'markas', 'tekal']
  .map((planet) => 'is-planet-' + planet);
const TERRAIN_CLASSES = [
  'arctic', 'city', 'coast', 'desert', 'forest', 'inside', 'jungle',
  'mountain', 'plains', 'road', 'swamp', 'underground', 'underwater', 'water',
].map((terrain) => 'is-terrain-' + terrain);

function reducedMotionQuery() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch (error) {
    return null;
  }
}

function safeIntensity(value) {
  return Math.max(1, Math.min(3, Math.round(Number(value) || 1)));
}

function newestStrongest(effects) {
  return effects.reduce((selected, effect) => {
    if (!selected) return effect;
    if (effect.intensity > selected.intensity) return effect;
    if (effect.intensity === selected.intensity && effect.seq > selected.seq) return effect;
    return selected;
  }, null);
}

export const visualEffectsManager = {
  initialized: false,
  model: createVisualEffectsState(),
  worldModel: createVisualWorldState(),
  fallbackWorld: createVisualWorldState(),
  health: reduceHealthState(),
  enabled: false,
  effectPreferences: createDefaultVisualEffectPreferences(),
  reducedMotion: false,
  root: null,
  _authoritativeWorld: false,
  _effectTimers: {},
  _motionTargets: {},
  _motionQuery: null,
  _worldTimer: null,
  _preview: null,
  _previewTimer: null,
  _lastEffectAt: {
    incoming: Number.NEGATIVE_INFINITY,
    outgoing: Number.NEGATIVE_INFINITY,
    spell: Number.NEGATIVE_INFINITY,
  },

  init() {
    if (this._controllerLifecycle) return this._controllerLifecycle.dispose;
    const lifecycle = createControllerLifecycle('visual-effects', () => {
      this._clearAllVisuals();
      this._motionQuery = null;
      this.initialized = false;
      this._controllerLifecycle = null;
    });
    this._controllerLifecycle = lifecycle;
    const scopedGmcp = lifecycle.bindGmcp(gmcp);

    this.root = typeof document !== 'undefined'
      ? document.getElementById(ROOT_ID)
      : null;
    this._motionQuery = reducedMotionQuery();
    this.reducedMotion = !!(this._motionQuery && this._motionQuery.matches);
    this.enabled = !!(appState.settings && appState.settings.visualEffectsEnabled);
    this.effectPreferences = normalizeVisualEffectPreferences(
      appState.settings && appState.settings.visualEffectPreferences
    );

    scopedGmcp.on('Darkwind.Visual.Events', (payload) => this.handleEvents(payload));
    // Accept the singular spelling defensively for mixed development builds.
    scopedGmcp.on('Darkwind.Visual.Event', (event) => this.handleEvents({
      epoch: event && event.epoch,
      first_seq: event && event.seq,
      last_seq: event && event.seq,
      events: event ? [event] : [],
    }));
    scopedGmcp.on('Darkwind.Visual.State', (payload) => this.handleWorldState(payload));
    scopedGmcp.on('Darkwind.Visual.Preview', (payload) => this.handlePreview(payload));
    scopedGmcp.on('Char.Vitals', (payload) => this.handleVitals(payload));
    scopedGmcp.on('Room.Info', (payload) => this.handleRoomInfo(payload));
    scopedGmcp.on('Darkwind.Session.Recovered', () => this.handleSessionRecovered());

    if (typeof document !== 'undefined') {
      lifecycle.listen(document, SETTINGS_CHANGED_EVENT, (event) => {
        this.handleSettingsChanged(event && event.detail);
      });
      lifecycle.listen(document, CONNECTION_STATE_EVENT, (event) => {
        if (event && event.detail && event.detail.state === 'disconnected') {
          this.handleDisconnect();
        }
      });
      lifecycle.listen(document, 'visibilitychange', () => {
        if (document.hidden) {
          this._clearTransientEffects();
          this._clearPreview();
        }
      });
    }

    if (this._motionQuery) {
      const onMotionChange = (event) => {
        this.reducedMotion = !!event.matches;
        if (this.root) {
          this.root.classList.toggle('is-reduced-motion', this.reducedMotion);
        }
        if (this.reducedMotion) this._clearMotion();
      };
      if (this._motionQuery.addEventListener) {
        this._motionQuery.addEventListener('change', onMotionChange);
        lifecycle.own('listener', () => this._motionQuery.removeEventListener('change', onMotionChange));
      } else if (this._motionQuery.addListener) {
        this._motionQuery.addListener(onMotionChange);
        lifecycle.own('listener', () => this._motionQuery.removeListener(onMotionChange));
      }
    }

    if (this.root) {
      this.root.classList.toggle('is-reduced-motion', this.reducedMotion);
      this.root.hidden = !this.enabled;
      if (this.enabled) {
        this._applyWorldContext(this._currentWorld());
        this._applyHealth();
      }
    }

    this.initialized = true;
    this._syncSubscription('visual-effects-init');
    return lifecycle.dispose;
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  isEnabled() {
    return this.enabled;
  },

  isEffectEnabled(key) {
    return this.enabled && this.effectPreferences[key] !== false;
  },

  isSubscriptionEnabled(settings = null) {
    if (settings) return visualEffectsSubscriptionEnabled(settings);
    return visualEffectsSubscriptionEnabled({
      visualEffectsEnabled: this.enabled,
      visualEffectPreferences: this.effectPreferences,
    });
  },

  handleSettingsChanged(settings) {
    const previousSubscription = this.isSubscriptionEnabled();
    const nextEnabled = !!(settings && settings.visualEffectsEnabled);
    const nextPreferences = normalizeVisualEffectPreferences(
      settings && settings.visualEffectPreferences
    );
    const changed = nextEnabled !== this.enabled;
    const preferencesChanged = Object.keys(nextPreferences).some(
      (key) => nextPreferences[key] !== this.effectPreferences[key]
    );
    this.enabled = nextEnabled;
    this.effectPreferences = nextPreferences;

    if (this.root) this.root.hidden = !this.enabled;
    if (!this.enabled) {
      this.model = createVisualEffectsState();
      this._resetCooldowns();
      this._clearAllVisuals();
    } else if (this.root) {
      if (preferencesChanged) this._clearAllVisuals();
      this._applyWorldContext(this._currentWorld());
      this._applyHealth();
    }

    if (changed || previousSubscription !== this.isSubscriptionEnabled()) {
      this._syncSubscription('visual-effects-setting');
    }
  },

  handleEvents(payload) {
    if (!this.initialized) this.init();
    if (!this.enabled) return;

    const reduced = reduceVisualEffectEvents(this.model, payload);
    this.model = reduced.state;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!reduced.effects.length) return;

    const incoming = newestStrongest(reduced.effects.filter(
      (effect) => effect.kind === 'damage' && effect.perspective === 'incoming',
    ));
    const outgoing = newestStrongest(reduced.effects.filter(
      (effect) => effect.kind === 'damage' && effect.perspective === 'outgoing',
    ));
    const spells = reduced.effects.filter((effect) => effect.kind === 'spell-cast');
    const spell = spells.length ? spells[spells.length - 1] : null;

    if (incoming) this.playIncomingDamage(incoming.intensity);
    if (outgoing) this.playOutgoingDamage(outgoing.intensity);
    if (spell) this.playSpellCast(spell.palette, spell.intensity);
  },

  handleWorldState(payload) {
    if (!this.initialized) this.init();
    const reduced = reduceVisualWorldState(this.worldModel, payload);
    if (!reduced.accepted) return;
    this.worldModel = reduced.state;
    this._authoritativeWorld = true;
    if (this.enabled && !this._hasWorldPreview()) {
      this._applyWorldContext(
        this.worldModel,
        this.worldModel.reason === 'wayshard',
      );
    }
  },

  handleRoomInfo(payload) {
    if (!this.initialized) this.init();
    this.fallbackWorld = deriveRoomVisualContext(payload);
    if (this.enabled && !this._authoritativeWorld && !this._hasWorldPreview()) {
      this._applyWorldContext(this.fallbackWorld);
    }
  },

  handleVitals(payload) {
    if (!this.initialized) this.init();
    this.health = reduceHealthState(this.health, payload);
    if (this.enabled) this._applyHealth();
  },

  handlePreview(payload) {
    if (!this.initialized) this.init();

    const preview = normalizeVisualPreview(payload);
    if (!preview) return false;
    if (preview.kind === 'clear') {
      this._clearPreview();
      return true;
    }
    if (!this.isEffectEnabled(PREVIEW_EFFECT_KEYS[preview.kind]) || !this.root) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;

    this._clearPreview();
    this._preview = preview;
    this.root.hidden = false;

    if (preview.kind === 'planet') {
      this.root.classList.remove(...PLANET_CLASSES);
      this.root.classList.add('is-preview-planet', 'is-planet-' + preview.value);
    } else if (preview.kind === 'terrain') {
      this.root.classList.remove(...TERRAIN_CLASSES);
      this.root.classList.add('is-preview-terrain', 'is-terrain-' + preview.value);
    } else if (preview.kind === 'low-health') {
      this.root.classList.add('is-preview-low-health');
    } else if (preview.kind === 'transition') {
      this.root.classList.remove('is-preview-transition');
      void this.root.offsetWidth;
      this.root.classList.add('is-preview-transition');
    }

    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      this._clearPreview();
    }, PREVIEW_TTL_MS);
    return true;
  },

  playIncomingDamage(intensity = 2) {
    return this._playTransient('incoming', safeIntensity(intensity));
  },

  playOutgoingDamage(intensity = 2) {
    return this._playTransient('outgoing', safeIntensity(intensity));
  },

  playSpellCast(palette = 'arcane', intensity = 2) {
    const allowed = [
      'arcane', 'cold', 'divine', 'fire', 'healing', 'lightning', 'nature', 'shadow',
    ];
    if (!allowed.includes(palette)) return false;
    return this._playTransient('spell', palette, safeIntensity(intensity));
  },

  _playTransient(type, value, intensity = value) {
    if (!this.initialized) this.init();
    if (!this.isEffectEnabled(TRANSIENT_EFFECT_KEYS[type])
        || !this.root
        || !EFFECT_CONFIG[type]) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;

    const now = this._now();
    if ((now - this._lastEffectAt[type]) < EFFECT_CONFIG[type].cooldown) return false;
    this._lastEffectAt[type] = now;
    this._clearTransient(type);

    const config = EFFECT_CONFIG[type];
    const modifier = type === 'spell'
      ? config.classPrefix + value
      : config.classPrefix + safeIntensity(value);
    this.root.hidden = false;
    // Force the browser to restart this category's animation without disturbing
    // persistent planet, terrain, or low-health layers.
    void this.root.offsetWidth;
    this.root.classList.add(config.activeClass, modifier);
    if (type === 'spell') {
      this.root.style && this.root.style.setProperty(
        '--visual-spell-intensity',
        String(0.72 + (safeIntensity(intensity) * 0.09)),
      );
    }

    if (!this.reducedMotion && MOTION_CLASSES[type]) {
      this._motionTargets[type] = this._findMotionTargets();
      for (const target of this._motionTargets[type]) {
        target.classList.add(MOTION_CLASSES[type]);
      }
    }

    const duration = config.durationByValue && config.durationByValue[value]
      ? config.durationByValue[value]
      : config.duration;
    this._effectTimers[type] = setTimeout(() => {
      delete this._effectTimers[type];
      this._clearTransient(type);
    }, duration);
    return true;
  },

  _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  },

  _findMotionTargets() {
    if (typeof document === 'undefined') return [];
    const floating = document.body
      && document.body.classList
      && document.body.classList.contains('floating-workspace-mode');
    if (floating && typeof document.querySelectorAll === 'function') {
      return Array.from(document.querySelectorAll('.terminal-panel-widget'));
    }
    const main = document.getElementById('main-content');
    return main ? [main] : [];
  },

  _clearMotion(type) {
    const types = type ? [type] : Object.keys(MOTION_CLASSES);
    for (const currentType of types) {
      const motionClass = MOTION_CLASSES[currentType];
      for (const target of this._motionTargets[currentType] || []) {
        if (target && target.classList) target.classList.remove(motionClass);
      }
      this._motionTargets[currentType] = [];
    }
  },

  _clearTransient(type) {
    const config = EFFECT_CONFIG[type];
    if (!config) return;
    if (this._effectTimers[type]) {
      clearTimeout(this._effectTimers[type]);
      delete this._effectTimers[type];
    }
    if (this.root && this.root.classList) {
      this.root.classList.remove(config.activeClass);
      if (type === 'spell') {
        for (const palette of [
          'arcane', 'cold', 'divine', 'fire', 'healing', 'lightning', 'nature', 'shadow',
        ]) {
          this.root.classList.remove(config.classPrefix + palette);
        }
      } else {
        for (let intensity = 1; intensity <= 3; intensity += 1) {
          this.root.classList.remove(config.classPrefix + intensity);
        }
      }
    }
    this._clearMotion(type);
  },

  _clearTransientEffects() {
    for (const type of Object.keys(EFFECT_CONFIG)) this._clearTransient(type);
  },

  _hasWorldPreview() {
    return !!(this._preview
      && (this._preview.kind === 'planet' || this._preview.kind === 'terrain'));
  },

  _clearPreview(restore = true) {
    if (this._previewTimer) {
      clearTimeout(this._previewTimer);
      this._previewTimer = null;
    }
    this._preview = null;
    if (this.root && this.root.classList) {
      this.root.classList.remove(...PREVIEW_CLASSES);
      if (restore && this.enabled) {
        this._applyWorldContext(this._currentWorld());
        this._applyHealth();
      }
    }
  },

  _currentWorld() {
    return this._authoritativeWorld ? this.worldModel : this.fallbackWorld;
  },

  _applyWorldContext(context, animate = false) {
    if (!this.root || !this.root.classList) return;
    this.root.classList.remove(...PLANET_CLASSES, ...TERRAIN_CLASSES);
    if (this.isEffectEnabled('planetAmbience') && context && context.planet) {
      this.root.classList.add('is-planet-' + context.planet);
    }
    if (this.isEffectEnabled('terrainAmbience')
        && context
        && context.terrains
        && context.terrains[0]) {
      this.root.classList.add('is-terrain-' + context.terrains[0]);
    }
    if (this.isEffectEnabled('worldTransitions')
        && animate
        && context
        && context.reason === 'wayshard') {
      this.root.classList.remove('is-world-transition');
      void this.root.offsetWidth;
      this.root.classList.add('is-world-transition');
      if (this._worldTimer) clearTimeout(this._worldTimer);
      this._worldTimer = setTimeout(() => {
        this._worldTimer = null;
        if (this.root) this.root.classList.remove('is-world-transition');
      }, WORLD_TRANSITION_MS);
    }
  },

  _applyHealth() {
    if (!this.root || !this.root.classList) return;
    this.root.classList.toggle(
      'is-low-health',
      this.isEffectEnabled('lowHealth') && !!this.health.lowHealth
    );
  },

  _clearPersistentVisuals() {
    if (!this.root || !this.root.classList) return;
    this.root.classList.remove(...PLANET_CLASSES, ...TERRAIN_CLASSES);
    this.root.classList.remove('is-low-health', 'is-world-transition');
    if (this._worldTimer) {
      clearTimeout(this._worldTimer);
      this._worldTimer = null;
    }
  },

  _clearAllVisuals() {
    this._clearPreview(false);
    this._clearTransientEffects();
    this._clearPersistentVisuals();
  },

  _resetCooldowns() {
    for (const type of Object.keys(EFFECT_CONFIG)) {
      this._lastEffectAt[type] = Number.NEGATIVE_INFINITY;
    }
  },

  _syncSubscription(reason) {
    gmcp.sendSubscriptions({
      reason,
      features: { visualEffects: this.isSubscriptionEnabled() },
    });
  },

  handleDisconnect() {
    this.model = createVisualEffectsState();
    this.worldModel = createVisualWorldState();
    this.fallbackWorld = createVisualWorldState();
    this.health = reduceHealthState();
    this._authoritativeWorld = false;
    this._resetCooldowns();
    this._clearAllVisuals();
  },

  handleSessionRecovered() {
    this.handleDisconnect();
    this._syncSubscription('session-recovered');
  },
};
