import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : !!force;
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }

  contains(name) {
    return this.values.has(name);
  }
}

const root = {
  hidden: true,
  classList: new FakeClassList(),
  offsetWidth: 1200,
  style: {
    values: new Map(),
    setProperty(name, value) {
      this.values.set(name, value);
    },
  },
};
const main = {
  classList: new FakeClassList(),
};
const documentListeners = new Map();

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

globalThis.document = {
  hidden: false,
  visibilityState: 'visible',
  addEventListener(name, listener) {
    if (!documentListeners.has(name)) documentListeners.set(name, []);
    documentListeners.get(name).push(listener);
  },
  removeEventListener() {},
  dispatchEvent(event) {
    for (const listener of documentListeners.get(event.type) || []) listener(event);
    return true;
  },
  getElementById(id) {
    if (id === 'visual-effects-root') return root;
    if (id === 'main-content') return main;
    return null;
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  body: {
    classList: new FakeClassList(),
    appendChild() {},
  },
};

globalThis.window = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) { return callback(); },
  dispatchEvent() {},
  matchMedia() {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  },
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};
globalThis.Image = function Image() {};
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  disconnect() {}
};

const { visualEffectsManager } = await import('../public/js/visual-effects-manager.js');
const {
  createVisualEffectsState,
  createVisualWorldState,
  reduceHealthState,
} = await import('../public/js/visual-effects-core.mjs');
const { gmcp, normalizeSubscriptionPayload } = await import('../public/js/gmcp.js');
const { settingsManager } = await import('../public/js/settings-manager.js');
const { state } = await import('../public/js/state.js');
const {
  createDefaultVisualEffectPreferences,
} = await import('../public/js/visual-effects-settings.mjs');

test('visual effects stay opt-in, combine persistent state with bounded event cues, and clean up safely', () => {
  const originalSendSubscriptions = gmcp.sendSubscriptions;
  const originalNow = visualEffectsManager._now;
  const originalSettings = state.settings;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const subscriptions = [];
  const timers = new Map();
  let timerId = 0;
  let clock = 1000;

  const runTimers = () => {
    const entries = Array.from(timers.values());
    timers.clear();
    for (const entry of entries) entry.callback();
  };

  try {
    globalThis.setTimeout = (callback, delay) => {
      timerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    };
    globalThis.clearTimeout = (id) => timers.delete(id);
    gmcp.sendSubscriptions = (payload) => {
      subscriptions.push(payload);
      return true;
    };
    visualEffectsManager._now = () => clock;
    root.classList.values.clear();
    main.classList.values.clear();
    root.hidden = true;
    visualEffectsManager.initialized = false;
    visualEffectsManager.model = createVisualEffectsState();
    visualEffectsManager.worldModel = createVisualWorldState();
    visualEffectsManager.fallbackWorld = createVisualWorldState();
    visualEffectsManager.health = reduceHealthState();
    visualEffectsManager.enabled = false;
    visualEffectsManager.effectPreferences = createDefaultVisualEffectPreferences();
    visualEffectsManager.reducedMotion = false;
    visualEffectsManager.root = null;
    visualEffectsManager._authoritativeWorld = false;
    visualEffectsManager._effectTimers = {};
    visualEffectsManager._motionTargets = {};
    visualEffectsManager._worldTimer = null;
    visualEffectsManager._preview = null;
    visualEffectsManager._previewTimer = null;
    visualEffectsManager._resetCooldowns();
    state.settings = {
      ...state.settings,
      visualEffectsEnabled: true,
      visualEffectPreferences: createDefaultVisualEffectPreferences(),
    };

    visualEffectsManager.init();

    assert.equal(normalizeSubscriptionPayload().features.visualEffects, false);
    assert.equal(subscriptions.at(-1).features.visualEffects, true);
    assert.equal(root.hidden, false);

    gmcp.dispatch('Room.Info', {
      num: 100,
      planet: 'darkwind',
      environment: 'forest',
    });
    gmcp.dispatch('Room.Info', {
      num: 101,
      planet: 'tekal',
      environment: 'arctic',
    });
    assert.equal(root.classList.contains('is-planet-tekal'), true);
    assert.equal(root.classList.contains('is-terrain-arctic'), true);
    assert.equal(root.classList.contains('is-world-transition'), false,
      'Room.Info fallback updates ambience without inferring wayshard travel');
    assert.equal(visualEffectsManager._worldTimer, null);

    gmcp.dispatch('darkwind.visual.state', {
      epoch: 'connection-a',
      seq: 1,
      reason: 'move',
      planet: { id: 'markas' },
      terrains: ['desert', 'outside'],
      room_id: '/room/red-dunes',
    });
    assert.equal(root.classList.contains('is-planet-markas'), true);
    assert.equal(root.classList.contains('is-terrain-desert'), true);
    assert.equal(root.classList.contains('is-world-transition'), false,
      'ordinary room movement updates ambience without a portal transition');
    assert.equal(visualEffectsManager._worldTimer, null);

    gmcp.dispatch('darkwind.visual.state', {
      epoch: 'connection-a',
      seq: 2,
      reason: 'wayshard',
      planet: { id: 'markas' },
      terrains: ['desert', 'outside'],
      room_id: '/room/red-dunes',
    });
    assert.equal(root.classList.contains('is-world-transition'), true);
    assert.equal(timers.get(visualEffectsManager._worldTimer).delay, 1250,
      'wayshard travel starts the full transition even without an ambience change');

    gmcp.dispatch('Room.Info', {
      num: 200,
      planet: 'tekal',
      environment: 'arctic',
    });
    assert.equal(root.classList.contains('is-planet-markas'), true,
      'authoritative Visual.State wins over Room.Info fallback');
    assert.equal(root.classList.contains('is-terrain-arctic'), false);

    gmcp.dispatch('Char.Vitals', { hp: 40, maxhp: 100 });
    assert.equal(root.classList.contains('is-low-health'), true);

    gmcp.dispatch('darkwind.visual.events', {
      epoch: 'connection-a',
      events: [
        { seq: 1, kind: 'damage', perspective: 'incoming', cue: 'impact', intensity: 3 },
        { seq: 2, kind: 'damage', perspective: 'outgoing', cue: 'impact', intensity: 2 },
        { seq: 3, kind: 'spell-cast', perspective: 'self', cue: 'cast', school: 'fire', intensity: 3 },
      ],
    });

    assert.equal(root.classList.contains('is-incoming-damage'), true);
    assert.equal(root.classList.contains('is-incoming-intensity-3'), true);
    assert.equal(root.classList.contains('is-outgoing-damage'), true);
    assert.equal(root.classList.contains('is-outgoing-intensity-2'), true);
    assert.equal(root.classList.contains('is-spell-cast'), true);
    assert.equal(root.classList.contains('is-spell-fire'), true);
    assert.equal(main.classList.contains('dw-visual-impact-shake'), true);
    assert.equal(main.classList.contains('dw-visual-attack-lunge'), true);
    assert.equal(
      timers.get(visualEffectsManager._effectTimers.spell).delay,
      1150,
      'fire remains active for its elemental cleanup duration',
    );

    runTimers();
    assert.equal(root.classList.contains('is-incoming-damage'), false);
    assert.equal(root.classList.contains('is-outgoing-damage'), false);
    assert.equal(root.classList.contains('is-spell-cast'), false);
    assert.equal(root.classList.contains('is-spell-fire'), false);
    assert.equal(root.classList.contains('is-low-health'), true,
      'transient cleanup does not cancel the persistent health pulse');
    assert.equal(root.classList.contains('is-planet-markas'), true,
      'transient cleanup does not hide persistent ambience');
    assert.equal(root.hidden, false);

    clock = 1320;
    assert.equal(visualEffectsManager.playSpellCast('cold', 2), true);
    const coldTimer = visualEffectsManager._effectTimers.spell;
    assert.equal(root.classList.contains('is-spell-cold'), true);
    assert.equal(root.classList.contains('is-spell-fire'), false);
    assert.equal(timers.get(coldTimer).delay, 1450,
      'frost remains active for its elemental cleanup duration');

    clock = 1639;
    assert.equal(visualEffectsManager.playSpellCast('lightning', 2), false,
      'the shared spell channel remains rate-limited until its cooldown elapses');
    assert.equal(visualEffectsManager._effectTimers.spell, coldTimer);
    assert.equal(root.classList.contains('is-spell-cold'), true,
      'a rejected elemental cue does not replace the active palette');

    clock = 1640;
    assert.equal(visualEffectsManager.playSpellCast('lightning', 3), true);
    const lightningTimer = visualEffectsManager._effectTimers.spell;
    assert.notEqual(lightningTimer, coldTimer);
    assert.equal(timers.has(coldTimer), false,
      'restarting the spell channel cancels its previous cleanup callback');
    assert.equal(root.classList.contains('is-spell-cold'), false);
    assert.equal(root.classList.contains('is-spell-lightning'), true);
    assert.equal(timers.get(lightningTimer).delay, 980,
      'lightning remains active for its elemental cleanup duration');

    runTimers();
    assert.equal(root.classList.contains('is-spell-cast'), false);
    assert.equal(root.classList.contains('is-spell-lightning'), false);

    gmcp.dispatch('darkwind.visual.preview', {
      kind: 'planet',
      value: 'tekal',
      duration: 60000,
      selector: 'body',
      url: 'https://untrusted.invalid/planet.png',
    });
    const planetPreviewTimer = visualEffectsManager._previewTimer;
    assert.deepEqual(visualEffectsManager._preview, { kind: 'planet', value: 'tekal' });
    assert.equal(root.classList.contains('is-preview-planet'), true,
      'planet previews opt into the emphasized short-form presentation');
    assert.equal(root.classList.contains('is-planet-tekal'), true);
    assert.equal(root.classList.contains('is-planet-markas'), false);
    assert.equal(root.classList.contains('is-terrain-desert'), true,
      'a planet preview preserves the current rendered terrain');
    assert.equal(timers.get(planetPreviewTimer).delay, 5000,
      'the client owns the fixed preview lifetime');
    assert.equal(visualEffectsManager.worldModel.planet, 'markas',
      'previewing never mutates authoritative world state');

    gmcp.dispatch('darkwind.visual.state', {
      epoch: 'connection-a',
      seq: 3,
      reason: 'move',
      planet: 'markas',
      terrains: ['forest'],
      room_id: '/room/deep-wood',
    });
    assert.equal(visualEffectsManager.worldModel.terrains[0], 'forest',
      'authoritative state continues reducing behind a preview');
    assert.equal(root.classList.contains('is-planet-tekal'), true);
    assert.equal(root.classList.contains('is-terrain-desert'), true,
      'a world preview remains stable until cleanup');

    const planetPreviewEntry = timers.get(planetPreviewTimer);
    timers.delete(planetPreviewTimer);
    planetPreviewEntry.callback();
    assert.equal(visualEffectsManager._preview, null);
    assert.equal(visualEffectsManager._previewTimer, null);
    assert.equal(root.classList.contains('is-preview-planet'), false);
    assert.equal(root.classList.contains('is-planet-markas'), true);
    assert.equal(root.classList.contains('is-terrain-forest'), true,
      'preview timeout restores the newest authoritative world');

    gmcp.dispatch('Char.Vitals', { hp: 70, maxhp: 100 });
    gmcp.dispatch('Darkwind.Visual.Preview', { kind: 'low-health' });
    const healthPreviewTimer = visualEffectsManager._previewTimer;
    assert.equal(root.classList.contains('is-preview-low-health'), true);
    assert.equal(root.classList.contains('is-low-health'), false);
    assert.equal(visualEffectsManager.health.lowHealth, false,
      'low-health preview does not mutate cached vitals');
    gmcp.dispatch('Darkwind.Visual.Preview', { kind: 'clear' });
    assert.equal(root.classList.contains('is-preview-low-health'), false);
    assert.equal(timers.has(healthPreviewTimer), false,
      'explicit clear cancels preview cleanup');

    gmcp.dispatch('Darkwind.Visual.Preview', {
      kind: 'low-health',
      value: 'server-selected-class',
    });
    assert.equal(visualEffectsManager._preview, null,
      'value-bearing low-health previews are rejected');

    gmcp.dispatch('Darkwind.Visual.Preview', { kind: 'transition' });
    const transitionPreviewTimer = visualEffectsManager._previewTimer;
    assert.equal(root.classList.contains('is-preview-transition'), true);
    document.hidden = true;
    document.dispatchEvent(new CustomEvent('visibilitychange'));
    assert.equal(root.classList.contains('is-preview-transition'), false);
    assert.equal(timers.has(transitionPreviewTimer), false,
      'hiding the page clears preview state and its timer');
    assert.equal(root.classList.contains('is-planet-markas'), true);
    assert.equal(root.classList.contains('is-terrain-forest'), true);
    document.hidden = false;

    clock = 1200;
    assert.equal(visualEffectsManager.playIncomingDamage(), false,
      'incoming vignette remains rate-limited during burst combat');
    clock = 1601;
    assert.equal(visualEffectsManager.playIncomingDamage(1), true);
    assert.equal(root.classList.contains('is-incoming-intensity-1'), true);
    visualEffectsManager._clearTransientEffects();

    visualEffectsManager.reducedMotion = true;
    clock = 2202;
    assert.equal(visualEffectsManager.playIncomingDamage(2), true);
    assert.equal(root.classList.contains('is-incoming-damage'), true);
    assert.equal(main.classList.contains('dw-visual-impact-shake'), false);
    visualEffectsManager._clearTransientEffects();

    gmcp.dispatch('Char.Vitals', { hp: 41 });
    assert.equal(root.classList.contains('is-low-health'), false);
    gmcp.dispatch('Char.Vitals', { hp: 0 });
    assert.equal(root.classList.contains('is-low-health'), false,
      'zero HP never pulses as low-but-alive');
    gmcp.dispatch('Char.Vitals', { hp: 30 });
    assert.equal(root.classList.contains('is-low-health'), true);

    const selectivePreferences = {
      ...createDefaultVisualEffectPreferences(),
      planetAmbience: false,
      lowHealth: false,
      incomingDamage: false,
      spellCasts: false,
    };
    visualEffectsManager.handleSettingsChanged({
      visualEffectsEnabled: true,
      visualEffectPreferences: selectivePreferences,
    });
    assert.equal(root.classList.contains('is-planet-markas'), false);
    assert.equal(root.classList.contains('is-terrain-forest'), true);
    assert.equal(root.classList.contains('is-low-health'), false);
    clock = 5000;
    assert.equal(visualEffectsManager.playIncomingDamage(3), false);
    assert.equal(visualEffectsManager.playOutgoingDamage(3), true);
    assert.equal(visualEffectsManager.playSpellCast('fire', 3), false);
    visualEffectsManager._clearTransientEffects();
    assert.equal(visualEffectsManager.handlePreview({ kind: 'planet', value: 'tekal' }), false);
    assert.equal(visualEffectsManager.handlePreview({ kind: 'terrain', value: 'arctic' }), true);
    visualEffectsManager.handlePreview({ kind: 'clear' });

    const lowHealthOnly = Object.fromEntries(
      Object.keys(createDefaultVisualEffectPreferences()).map((key) => [key, key === 'lowHealth'])
    );
    visualEffectsManager.handleSettingsChanged({
      visualEffectsEnabled: true,
      visualEffectPreferences: lowHealthOnly,
    });
    assert.equal(subscriptions.at(-1).features.visualEffects, false,
      'low health is derived from Char.Vitals and does not require the visual event stream');
    assert.equal(root.classList.contains('is-low-health'), true);
    assert.equal(root.classList.contains('is-terrain-forest'), false);
    assert.equal(visualEffectsManager.playOutgoingDamage(3), false);

    visualEffectsManager.handleSettingsChanged({
      visualEffectsEnabled: true,
      visualEffectPreferences: createDefaultVisualEffectPreferences(),
    });
    assert.equal(subscriptions.at(-1).features.visualEffects, true);
    assert.equal(root.classList.contains('is-planet-markas'), true);
    assert.equal(root.classList.contains('is-terrain-forest'), true);
    assert.equal(root.classList.contains('is-low-health'), true);

    gmcp.dispatch('Darkwind.Visual.Preview', { kind: 'terrain', value: 'arctic' });
    const disablePreviewTimer = visualEffectsManager._previewTimer;
    assert.equal(root.classList.contains('is-preview-terrain'), true,
      'terrain previews opt into the emphasized short-form presentation');
    assert.equal(root.classList.contains('is-terrain-arctic'), true);
    visualEffectsManager.handleSettingsChanged({ visualEffectsEnabled: false });
    assert.equal(root.hidden, true);
    assert.equal(visualEffectsManager._preview, null);
    assert.equal(timers.has(disablePreviewTimer), false);
    assert.equal(root.classList.contains('is-preview-terrain'), false);
    assert.equal(root.classList.contains('is-low-health'), false);
    assert.equal(root.classList.contains('is-planet-markas'), false);
    assert.equal(subscriptions.at(-1).features.visualEffects, false);

    visualEffectsManager.handleSettingsChanged({ visualEffectsEnabled: true });
    assert.equal(root.hidden, false);
    assert.equal(root.classList.contains('is-low-health'), true,
      'latest vitals remain warm while presentation is disabled');
    assert.equal(root.classList.contains('is-planet-markas'), true,
      'latest world state remains warm while presentation is disabled');
    assert.equal(root.classList.contains('is-terrain-forest'), true);

    gmcp.dispatch('Darkwind.Visual.Preview', { kind: 'planet', value: 'tekal' });
    const disconnectPreviewTimer = visualEffectsManager._previewTimer;
    visualEffectsManager.handleDisconnect();
    assert.equal(visualEffectsManager._preview, null);
    assert.equal(timers.has(disconnectPreviewTimer), false);
    assert.equal(root.classList.contains('is-low-health'), false);
    assert.equal(root.classList.contains('is-planet-markas'), false);

    gmcp.dispatch('Room.Info', {
      num: 201,
      planet: 'tekal',
      environment: 'arctic mountain and forest',
    });
    assert.equal(root.classList.contains('is-planet-tekal'), true);
    assert.equal(root.classList.contains('is-terrain-forest'), true,
      'Room.Info fallback follows shared map terrain priority');

    gmcp.dispatch('Darkwind.Visual.Preview', { kind: 'terrain', value: 'arctic' });
    const recoveryPreviewTimer = visualEffectsManager._previewTimer;
    gmcp.dispatch('darkwind.session.recovered', { mode: 'switch' });
    assert.equal(visualEffectsManager._preview, null);
    assert.equal(timers.has(recoveryPreviewTimer), false);
    assert.equal(root.classList.contains('is-preview-low-health'), false);
    assert.equal(root.classList.contains('is-preview-transition'), false);
    assert.equal(root.classList.contains('is-preview-planet'), false);
    assert.equal(root.classList.contains('is-preview-terrain'), false);
    assert.equal(root.classList.contains('is-planet-tekal'), false);
    assert.equal(subscriptions.at(-1).reason, 'session-recovered');
    assert.equal(subscriptions.at(-1).features.visualEffects, true);

    assert.equal(settingsManager._normalizeSettings({}).visualEffectsEnabled, false);
    assert.equal(settingsManager._normalizeSettings({
      visualEffectsEnabled: true,
    }).visualEffectsEnabled, true);
    const normalizedSettings = settingsManager._normalizeSettings({
      visualEffectsEnabled: true,
      visualEffectPreferences: {
        incomingDamage: false,
        unknownEffect: false,
      },
    });
    assert.equal(normalizedSettings.visualEffectPreferences.incomingDamage, false);
    assert.equal(normalizedSettings.visualEffectPreferences.planetAmbience, true);
    assert.equal(Object.hasOwn(
      normalizedSettings.visualEffectPreferences,
      'unknownEffect'
    ), false);
  } finally {
    visualEffectsManager._clearAllVisuals();
    visualEffectsManager.initialized = false;
    visualEffectsManager.model = createVisualEffectsState();
    visualEffectsManager.worldModel = createVisualWorldState();
    visualEffectsManager.fallbackWorld = createVisualWorldState();
    visualEffectsManager.health = reduceHealthState();
    visualEffectsManager.enabled = false;
    visualEffectsManager.effectPreferences = createDefaultVisualEffectPreferences();
    visualEffectsManager.reducedMotion = false;
    visualEffectsManager.root = null;
    visualEffectsManager._authoritativeWorld = false;
    visualEffectsManager._effectTimers = {};
    visualEffectsManager._motionTargets = {};
    visualEffectsManager._worldTimer = null;
    visualEffectsManager._preview = null;
    visualEffectsManager._previewTimer = null;
    visualEffectsManager._resetCooldowns();
    visualEffectsManager._now = originalNow;
    gmcp.sendSubscriptions = originalSendSubscriptions;
    state.settings = originalSettings;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('visual overlay is non-interactive, accessible, motion-aware, and has no preview control', () => {
  const css = readFileSync(
    new URL('../public/css/visual-effects.css', import.meta.url),
    'utf8',
  );
  const html = readFileSync(
    new URL('../client/index.html', import.meta.url),
    'utf8',
  );
  const settingsSource = readFileSync(
    new URL('../public/js/settings-manager.js', import.meta.url),
    'utf8',
  );
  const managerSource = readFileSync(
    new URL('../public/js/visual-effects-manager.js', import.meta.url),
    'utf8',
  );
  const effectAssets = [
    ['../public/assets/effects/flame-01.png', 1024, 1536],
    ['../public/assets/effects/frost-edge-overlay.png', 1536, 1024],
    ['../public/assets/effects/lightning-01.png', 1024, 1536],
  ].map(([assetPath, width, height]) => ({
    bytes: readFileSync(new URL(assetPath, import.meta.url)),
    width,
    height,
  }));

  assert.match(html, /id="visual-effects-root" aria-hidden="true" hidden/);
  assert.match(html, /class="visual-effects-low-health"/);
  assert.match(html, /class="visual-effects-spell-cast"/);
  assert.match(html, /class="visual-effects-fire"/);
  assert.equal((html.match(/class="visual-fire-flame"/g) || []).length, 12);
  assert.match(html, /class="visual-effects-frost"/);
  assert.match(html, /class="visual-effects-lightning"/);
  assert.equal((html.match(/class="visual-lightning-arc"/g) || []).length, 6);
  assert.match(css, /#visual-effects-root\s*\{[\s\S]*?z-index:\s*12000/);
  assert.match(css, /#visual-effects-root\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(css,
    /is-planet-darkwind \.visual-effects-planet,\s*#visual-effects-root\.is-planet-dailos \.visual-effects-planet,\s*#visual-effects-root\.is-planet-markas \.visual-effects-planet,\s*#visual-effects-root\.is-planet-tekal \.visual-effects-planet\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?clamp\([\s\S]*?var\(--visual-planet-edge\)/,
    'live planet ambience must not be attenuated by a second layer opacity');
  const planetEdgeColors = [];
  for (const planet of ['darkwind', 'dailos', 'markas', 'tekal']) {
    const planetBlocks = Array.from(css.matchAll(new RegExp(
      `#visual-effects-root\\.is-planet-${planet} \\.visual-effects-planet\\s*\\{([\\s\\S]*?)\\}`,
      'g',
    )));
    const planetBlock = planetBlocks
      .map((match) => match[1])
      .find((block) => block.includes('--visual-preview-accent'));
    assert.ok(planetBlock, `${planet} is missing its live ambience treatment`);
    assert.ok((planetBlock.match(/radial-gradient/g) || []).length >= 2,
      `${planet} ambience must remain edge-focused`);
    const edgeColor = planetBlock.match(/--visual-planet-edge:\s*([^;]+);/)?.[1];
    assert.ok(edgeColor, `${planet} is missing its normal-strength edge color`);
    planetEdgeColors.push(edgeColor);
  }
  assert.equal(new Set(planetEdgeColors).size, 4,
    'each planet must retain a visually distinct edge color');
  assert.match(css, /darkflow-low-health-pulse\s+3\.6s/);
  assert.match(css,
    /#visual-effects-root\.is-preview-low-health \.visual-effects-low-health\s*\{[\s\S]*?darkflow-low-health-preview 1\.8s/);
  assert.match(css,
    /#visual-effects-root\.is-preview-planet \.visual-effects-planet\s*\{[\s\S]*?darkflow-ambience-preview 5s/);
  assert.match(css,
    /#visual-effects-root\.is-preview-terrain \.visual-effects-terrain\s*\{[\s\S]*?darkflow-ambience-preview 5s/);
  assert.match(css,
    /#visual-effects-root\.is-preview-low-health \.visual-effects-low-health/);
  assert.match(css,
    /#visual-effects-root\.is-preview-transition::before\s*\{[\s\S]*?darkflow-transition-preview 1250ms/);
  assert.match(css,
    /#visual-effects-root\.is-preview-transition::after\s*\{[\s\S]*?darkflow-transition-seam 1250ms/);
  assert.match(css, /#visual-effects-root\.is-world-transition::before,/);
  assert.match(css, /#visual-effects-root\.is-world-transition::after,/);
  assert.match(managerSource, /const PREVIEW_TTL_MS = 5000/);
  assert.match(css,
    /#visual-effects-root\.is-spell-cast\.is-spell-fire \.visual-effects-fire\s*\{[\s\S]*?darkflow-fire-edge-bloom 1150ms/);
  assert.match(css,
    /#visual-effects-root\.is-spell-cast\.is-spell-cold \.visual-effects-frost\s*\{[\s\S]*?darkflow-frost-over 1450ms/);
  assert.match(css,
    /#visual-effects-root\.is-spell-cast\.is-spell-lightning \.visual-effects-lightning\s*\{[\s\S]*?darkflow-lightning-field 980ms/);
  assert.match(css,
    /\.visual-fire-flame\s*\{[\s\S]*?url\("\.\.\/assets\/effects\/flame-01\.png"\)/);
  assert.match(css,
    /\.visual-effects-frost\s*\{[\s\S]*?url\("\.\.\/assets\/effects\/frost-edge-overlay\.png"\)/);
  assert.match(css,
    /\.visual-lightning-arc\s*\{[\s\S]*?url\("\.\.\/assets\/effects\/lightning-01\.png"\)/);
  assert.doesNotMatch(css, /repeating-conic-gradient/);
  for (const asset of effectAssets) {
    assert.deepEqual(
      Array.from(asset.bytes.subarray(0, 8)),
      [137, 80, 78, 71, 13, 10, 26, 10],
      'effect asset has an invalid PNG signature',
    );
    assert.equal(asset.bytes.readUInt32BE(16), asset.width);
    assert.equal(asset.bytes.readUInt32BE(20), asset.height);
    assert.equal(asset.bytes[24], 8, 'effect asset must remain 8-bit');
    assert.equal(asset.bytes[25], 6, 'effect asset must remain RGBA');
    assert.ok(asset.bytes.length < 5 * 1024 * 1024,
      'effect asset exceeded the five-megabyte budget');
  }
  for (const keyframe of [
    'darkflow-fire-edge-bloom',
    'darkflow-fire-flame-rise',
    'darkflow-frost-over',
    'darkflow-lightning-field',
    'darkflow-lightning-flash',
    'darkflow-lightning-arc',
    'darkflow-ambience-preview',
    'darkflow-transition-preview',
    'darkflow-transition-seam',
    'darkflow-low-health-preview',
  ]) {
    assert.match(css, new RegExp('@keyframes\\s+' + keyframe));
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const reducedMotionClassCss = css.slice(
    css.indexOf('#visual-effects-root.is-reduced-motion .visual-effects-spell-cast > div'),
    css.indexOf('@media (prefers-reduced-motion: reduce)'),
  );
  const reducedMotionMediaCss = css.slice(
    css.indexOf('@media (prefers-reduced-motion: reduce)'),
    css.indexOf('@media (forced-colors: active)'),
  );
  for (const hook of [
    '.visual-effects-spell-cast > div',
    '.visual-fire-flame',
    '.visual-lightning-arc',
    '.visual-effects-lightning::before',
  ]) {
    assert.match(reducedMotionClassCss, new RegExp(hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(reducedMotionMediaCss, new RegExp(hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(reducedMotionClassCss, /animation:\s*none/);
  assert.match(reducedMotionClassCss,
    /\.is-reduced-motion\.is-preview-transition::before\s*\{[\s\S]*?animation:\s*none/);
  assert.match(reducedMotionMediaCss, /animation:\s*none/);
  assert.match(reducedMotionMediaCss,
    /\.is-preview-transition::before\s*\{[\s\S]*?animation:\s*none/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.dw-visual-impact-shake\s*\{[\s\S]*?160ms/);
  assert.doesNotMatch(settingsSource, /Preview incoming damage|darkwind:visual-effects-preview/);
});
