import { gmcp } from './gmcp.js';
import { dom, state as appState } from './state.js';
import { createControllerLifecycle, disposeControllerLifecycle } from './session-compat/controllers.js';
import {
  buildTutorialAction,
  createTutorialState,
  reduceTutorialState,
  tutorialAnnouncement,
  tutorialProgress,
  tutorialStateKey,
} from './tutorial-core.mjs';

const STATE_PACKAGE = 'Darkwind.Tutorial.State';
const CONTROL_PACKAGE = 'Darkwind.Tutorial.Control';
const ACTION_PACKAGE = 'Darkwind.Tutorial.Action';
const RESYNC_PACKAGE = 'Darkwind.Tutorial.Resync';
const SESSION_RECOVERED_PACKAGE = 'Darkwind.Session.Recovered';
export const TUTORIAL_ACTION_TIMEOUT_MS = 5000;
export const TUTORIAL_RENDER_RECOVERY_DELAYS_MS = Object.freeze([
  500,
  1500,
  3000,
]);

const TARGET_SELECTORS = Object.freeze({
  terminal: ['#output-shell'],
  'command-input': ['#command-input'],
  'panels-menu': ['#panels-menu-btn'],
  'inventory-panel': [
    '.gmcp-panel-widget[data-panel-id="inventory"]',
    '#panels-menu-btn',
  ],
  'vitals-panel': [
    '.gmcp-panel-widget[data-panel-id="vitals"]',
    '#panels-menu-btn',
  ],
  'enemy-panel': [
    '.gmcp-panel-widget[data-panel-id="enemy"]',
    '#panels-menu-btn',
  ],
});

const ACTION_LABELS = Object.freeze({
  continue: 'Continue',
  directions: 'Show directions',
  hint: 'Show hint',
  restart: 'Restart tutorial',
  skip: 'Skip tutorial',
});

const ACTION_ORDER = ['continue', 'directions', 'hint', 'restart', 'skip'];

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function hasVisibleRect(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function resolveTarget(token) {
  const selectors = TARGET_SELECTORS[token] || [];
  let fallback = null;
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!fallback) fallback = element;
    if (hasVisibleRect(element)) return element;
  }
  return fallback;
}

function activeFocusKey(card) {
  const active = document.activeElement;
  if (!active || !card || !card.contains(active)) return '';
  return active.dataset && active.dataset.tutorialFocus
    ? active.dataset.tutorialFocus
    : '';
}

export const tutorialManager = {
  model: createTutorialState(),
  initialized: false,
  renderHealthy: false,
  advertisedReady: false,
  presentationAllowed: true,
  collapsed: false,
  hintVisible: false,
  routeVisible: false,
  skipConfirming: false,
  pendingAction: '',
  lastAnnouncedKey: '',
  _resizeObserver: null,
  _repositionFrame: null,
  _pendingTimer: null,
  _recoveryTimer: null,
  _renderRecoveryAttempt: 0,

  els: {
    layer: null,
    card: null,
    chip: null,
    halo: null,
    live: null,
    chapter: null,
    progress: null,
    progressText: null,
    stepTitle: null,
    task: null,
    exampleWrap: null,
    exampleButton: null,
    hint: null,
    route: null,
    actions: null,
    skipConfirm: null,
  },

  init() {
    if (this._controllerLifecycle) return this._controllerLifecycle.dispose;
    const lifecycle = createControllerLifecycle('tutorial', () => {
      this._clearPendingTimer();
      this._clearRenderRecovery();
      if (this._repositionFrame) cancelAnimationFrame(this._repositionFrame);
      this._repositionFrame = null;
      if (this._resizeObserver) this._resizeObserver.disconnect();
      this._resizeObserver = null;
      this._discardMount();
      this.initialized = false;
      this._controllerLifecycle = null;
    });
    this._controllerLifecycle = lifecycle;
    const scopedGmcp = lifecycle.bindGmcp(gmcp);
    try {
      this.mount();
      this.renderHealthy = !!this.els.card;
    } catch (error) {
      this.renderHealthy = false;
      console.error('Tutorial hover failed to initialize', error);
      this._scheduleRenderRecovery();
    }

    scopedGmcp.on(STATE_PACKAGE, (payload) => this.handleState(payload));
    scopedGmcp.on(CONTROL_PACKAGE, (payload) => this.handleControl(payload));
    scopedGmcp.on(SESSION_RECOVERED_PACKAGE, () => this.handleSessionRecovered());

    if (typeof window !== 'undefined' && window.addEventListener) {
      lifecycle.listen(window, 'resize', () => this.requestReposition());
      lifecycle.listen(window, 'darkflow:output-layout-changed', () => this.requestReposition());
      lifecycle.listen(window, 'darkflow:workspace-layout-changed', () => this.requestReposition());
    }

    if (typeof ResizeObserver === 'function' && dom.outputShell) {
      this._resizeObserver = new ResizeObserver(() => this.requestReposition());
      this._resizeObserver.observe(dom.outputShell);
      lifecycle.ownObserver(this._resizeObserver);
    }

    this.initialized = true;
    this._syncReadiness('tutorial-manager-init');
    return lifecycle.dispose;
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  mount() {
    if (this.els.layer) return;

    const layer = createElement('div', 'tutorial-hover-layer');
    layer.hidden = true;

    const halo = createElement('div', 'tutorial-target-halo');
    halo.hidden = true;
    halo.setAttribute('aria-hidden', 'true');

    const live = createElement('div', 'tutorial-live sr-only');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');

    const card = createElement('aside', 'tutorial-hover-card');
    card.id = 'tutorial-hover';
    card.setAttribute('role', 'complementary');
    card.setAttribute('aria-labelledby', 'tutorial-hover-title');

    const header = createElement('header', 'tutorial-hover-header');
    const headingWrap = createElement('div', 'tutorial-heading-wrap');
    const eyebrow = createElement('span', 'tutorial-eyebrow', 'NEW PLAYER GUIDE');
    const title = createElement('h2', 'tutorial-title', 'Darkwind basics');
    title.id = 'tutorial-hover-title';
    headingWrap.append(eyebrow, title);

    const minimize = createElement('button', 'tutorial-icon-button', '−');
    minimize.type = 'button';
    minimize.title = 'Minimize tutorial';
    minimize.setAttribute('aria-label', 'Minimize tutorial');
    minimize.dataset.tutorialFocus = 'minimize';
    minimize.addEventListener('click', () => this.setCollapsed(true, true));
    header.append(headingWrap, minimize);

    const progressRegion = createElement('div', 'tutorial-progress-region');
    const chapter = createElement('span', 'tutorial-chapter');
    const progressText = createElement('span', 'tutorial-progress-text');
    const progress = createElement('progress', 'tutorial-progress');
    progress.setAttribute('aria-label', 'Tutorial progress');
    progressRegion.append(chapter, progressText, progress);

    const body = createElement('div', 'tutorial-hover-body');
    const stepTitle = createElement('h3', 'tutorial-step-title');
    const task = createElement('p', 'tutorial-task');

    const exampleWrap = createElement('div', 'tutorial-example');
    const exampleLabel = createElement('span', 'tutorial-example-label', 'TRY THIS');
    const exampleButton = createElement('button', 'tutorial-command-button');
    exampleButton.type = 'button';
    exampleButton.dataset.tutorialFocus = 'example';
    exampleButton.title = 'Put this command in the command line';
    exampleButton.addEventListener('click', () => {
      this.fillCommandInput(this.model.step.exampleCommand);
    });
    exampleWrap.append(exampleLabel, exampleButton);

    const hint = createElement('div', 'tutorial-hint');
    hint.setAttribute('role', 'note');

    const route = createElement('div', 'tutorial-route');
    route.setAttribute('role', 'note');

    const skipConfirm = createElement('div', 'tutorial-skip-confirm');
    skipConfirm.hidden = true;
    const skipText = createElement(
      'p',
      'tutorial-skip-copy',
      'Skip the guided tutorial? You can restart it later with tutorial restart.',
    );
    const skipButtons = createElement('div', 'tutorial-skip-actions');
    const keepButton = createElement('button', 'tutorial-button tutorial-button-secondary', 'Keep tutorial');
    keepButton.type = 'button';
    keepButton.dataset.tutorialFocus = 'keep';
    keepButton.addEventListener('click', () => {
      this.skipConfirming = false;
      this._renderSafely();
    });
    const confirmButton = createElement('button', 'tutorial-button tutorial-button-danger', 'Skip tutorial');
    confirmButton.type = 'button';
    confirmButton.dataset.tutorialFocus = 'confirm-skip';
    confirmButton.addEventListener('click', () => this.sendAction('skip', true));
    skipButtons.append(keepButton, confirmButton);
    skipConfirm.append(skipText, skipButtons);

    const actions = createElement('footer', 'tutorial-actions');
    body.append(stepTitle, task, exampleWrap, hint, route, skipConfirm);
    card.append(header, progressRegion, body, actions);

    const chip = createElement('button', 'tutorial-minimized-chip');
    chip.type = 'button';
    chip.hidden = true;
    chip.dataset.tutorialFocus = 'chip';
    chip.setAttribute('aria-label', 'Restore tutorial');
    chip.addEventListener('click', () => this.setCollapsed(false, true));
    const chipMark = createElement('span', 'tutorial-chip-mark', '?');
    chipMark.setAttribute('aria-hidden', 'true');
    const chipText = createElement('span', 'tutorial-chip-text', 'Tutorial');
    chip.append(chipMark, chipText);

    layer.append(halo, card, chip);
    document.body.appendChild(layer);
    document.body.appendChild(live);

    this.els = {
      layer,
      card,
      chip,
      halo,
      live,
      chapter,
      progress,
      progressText,
      stepTitle,
      task,
      exampleWrap,
      exampleButton,
      hint,
      route,
      actions,
      skipConfirm,
    };
  },

  isReadyForSubscription() {
    return !!(
      this.initialized
      && this.renderHealthy
      && !appState.zorkOnlyMode
      && this.els.card
      && this.els.card.isConnected !== false
    );
  },

  handleConnected(reason = 'tutorial-connected') {
    const ready = this.isReadyForSubscription();
    this.advertisedReady = ready;
    if (!this.els.card || this.els.card.isConnected === false) {
      this.renderHealthy = false;
    }
    if (!ready && !appState.zorkOnlyMode) this._scheduleRenderRecovery();
    if (ready) {
      gmcp.send(RESYNC_PACKAGE, {
        epoch: this.model.epoch || '',
        seq: this.model.seq || 0,
        reason,
      });
    }
  },

  handleSessionRecovered() {
    this._syncReadiness('tutorial-session-recovered', true);
  },

  handleState(payload) {
    if (!this.initialized) this.init();
    const previous = this.model;
    const next = reduceTutorialState(previous, payload);
    if (next === previous) return false;

    this.presentationAllowed = true;
    const stepChanged = next.epoch !== previous.epoch
      || next.step.id !== previous.step.id;
    this.model = next;
    this._clearPendingTimer();
    this.pendingAction = '';
    this.skipConfirming = false;
    if (stepChanged) {
      this.hintVisible = false;
      this.routeVisible = false;
    }
    if (next.hintVisible || next.reason === 'hint') this.hintVisible = true;
    if (next.reason === 'directions') this.routeVisible = true;

    if (next.status === 'active') {
      // The server keeps a Continue gate for text clients. Visual clients
      // acknowledge it immediately so each objective is one player-facing step.
      if (next.awaitingContinue
          && next.actions.includes('continue')
          && this.sendAction('continue')) {
        return true;
      }
      this._renderSafely();
      this._announce(next);
      return true;
    }

    this._announce(next);
    this.hide();
    return true;
  },

  handleControl(payload) {
    if (!payload
        || typeof payload !== 'object'
        || Array.isArray(payload)
        || !Object.prototype.hasOwnProperty.call(payload, 'visible')) {
      return false;
    }

    if (![true, false, 1, 0].includes(payload.visible)) return false;
    const visible = payload.visible === true || payload.visible === 1;
    if (!visible) {
      this.presentationAllowed = false;
      this._clearPendingTimer();
      this.pendingAction = '';
      this.skipConfirming = false;
      this.hide();
      return true;
    }

    this.presentationAllowed = true;
    if (this.model.status === 'active') this._renderSafely();
    return true;
  },

  _renderSafely() {
    if (!this.presentationAllowed) {
      this.hide();
      return;
    }
    try {
      this.render();
      if (!this.renderHealthy) {
        this.renderHealthy = true;
        this._syncReadiness('tutorial-render-recovered', true);
      }
      this._clearRenderRecovery();
    } catch (error) {
      this.renderHealthy = false;
      this.hide();
      this._syncReadiness('tutorial-render-error', true);
      console.error('Tutorial hover failed to render', error);
      this._scheduleRenderRecovery();
    }
  },

  render() {
    const model = this.model;
    if (!this.els.layer || model.status !== 'active') {
      this.hide();
      return;
    }

    const focusKey = activeFocusKey(this.els.card);
    const progress = tutorialProgress(model);
    const chapter = model.chapter;

    this.els.chapter.textContent = chapter.title
      ? `Chapter ${chapter.index || 1} of ${chapter.total || 1} · ${chapter.title}`
      : 'Getting started';
    this.els.progressText.textContent = `Step ${progress.value} of ${progress.total}`;
    this.els.progress.max = progress.total;
    this.els.progress.value = progress.value;
    this.els.progress.setAttribute('aria-valuetext', `${progress.percent}% complete`);
    this.els.stepTitle.textContent = model.step.title || 'Your next step';
    this.els.task.textContent = model.step.task;

    const exampleCommand = model.step.exampleCommand;
    this.els.exampleWrap.hidden = !exampleCommand;
    this.els.exampleButton.textContent = exampleCommand;
    this.els.exampleButton.setAttribute(
      'aria-label',
      exampleCommand ? `Put ${exampleCommand} in the command line` : 'Example command',
    );

    const showHint = !!(this.hintVisible && model.step.hint);
    this.els.hint.hidden = !showHint;
    this.els.hint.textContent = showHint
      ? `Hint: ${model.step.hint}${model.step.help ? ` (${model.step.help})` : ''}`
      : '';

    this._renderRoute();
    this._renderActions();

    this.els.layer.hidden = false;
    this.els.layer.classList.add('open');
    this.els.card.hidden = this.collapsed;
    this.els.chip.hidden = !this.collapsed;
    this.els.card.setAttribute('aria-busy', this.pendingAction ? 'true' : 'false');
    this.els.chip.querySelector('.tutorial-chip-text').textContent =
      `Tutorial · ${progress.value}/${progress.total}`;

    this.requestReposition();
    this._updateTargetHalo();

    if (focusKey) {
      const focused = this.els.layer.querySelector(
        `[data-tutorial-focus="${focusKey}"]`,
      );
      if (focused && !focused.hidden && typeof focused.focus === 'function') focused.focus();
    }
  },

  _renderRoute() {
    const route = this.model.route;
    if (!route || !this.routeVisible) {
      this.els.route.hidden = true;
      this.els.route.replaceChildren();
      return;
    }

    const heading = createElement(
      'strong',
      'tutorial-route-title',
      route.place ? `Route to ${route.place}` : 'Directions',
    );
    const copy = createElement('p', 'tutorial-route-copy', route.text);
    const path = createElement('ol', 'tutorial-route-steps');
    for (const direction of route.directions) {
      path.appendChild(createElement('li', '', direction));
    }

    this.els.route.replaceChildren(heading);
    if (route.text) this.els.route.appendChild(copy);
    if (route.directions.length) this.els.route.appendChild(path);
    this.els.route.hidden = false;
  },

  _renderActions() {
    this.els.actions.replaceChildren();
    this.els.skipConfirm.hidden = !this.skipConfirming;
    if (this.skipConfirming) return;

    for (const action of ACTION_ORDER) {
      if (!this.model.actions.includes(action)) continue;
      if (action === 'continue'
          && this.model.awaitingContinue
          && this.pendingAction === 'continue') {
        continue;
      }
      if (action === 'hint' && this.hintVisible) continue;
      const button = createElement(
        'button',
        `tutorial-button tutorial-button-${action}`,
        ACTION_LABELS[action],
      );
      button.type = 'button';
      button.dataset.tutorialAction = action;
      button.dataset.tutorialFocus = `action-${action}`;
      button.disabled = !!this.pendingAction;
      if (action === 'continue') button.classList.add('tutorial-button-primary');
      else if (action === 'skip') button.classList.add('tutorial-button-quiet');
      else button.classList.add('tutorial-button-secondary');
      button.addEventListener('click', () => this.sendAction(action));
      this.els.actions.appendChild(button);
    }
  },

  sendAction(action, confirmed = false) {
    if (this.pendingAction) return false;
    if (action === 'skip' && !confirmed) {
      this.skipConfirming = true;
      this._renderSafely();
      return true;
    }

    const payload = buildTutorialAction(this.model, action);
    if (!payload) return false;

    this.pendingAction = action;
    if (action === 'hint') this.hintVisible = true;
    this._renderSafely();

    const sent = gmcp.send(ACTION_PACKAGE, payload);
    if (!sent) {
      this.pendingAction = '';
      this._renderSafely();
      return false;
    }
    this._pendingTimer = setTimeout(() => {
      this._pendingTimer = null;
      if (this.pendingAction !== action) return;
      this.pendingAction = '';
      this._renderSafely();
      this.requestResync('action-timeout');
    }, TUTORIAL_ACTION_TIMEOUT_MS);
    return true;
  },

  requestResync(reason = 'tutorial-resync') {
    if (!this.isReadyForSubscription()) return false;
    return gmcp.send(RESYNC_PACKAGE, {
      epoch: this.model.epoch || '',
      seq: this.model.seq || 0,
      reason,
    });
  },

  fillCommandInput(command) {
    const value = typeof command === 'string' ? command.trim() : '';
    if (!value || !dom.commandInput) return false;
    dom.commandInput.value = value;
    if (typeof dom.commandInput.dispatchEvent === 'function' && typeof Event === 'function') {
      dom.commandInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (typeof dom.commandInput.focus === 'function') dom.commandInput.focus();
    if (typeof dom.commandInput.setSelectionRange === 'function') {
      dom.commandInput.setSelectionRange(value.length, value.length);
    }
    return true;
  },

  setCollapsed(collapsed, restoreFocus = false) {
    if (this.model.status !== 'active') return;
    this.collapsed = !!collapsed;
    this.skipConfirming = false;
    this._renderSafely();
    if (!this.renderHealthy) return;
    if (!restoreFocus) return;
    const target = this.collapsed ? this.els.chip : this.els.card;
    const button = this.collapsed
      ? target
      : target.querySelector('[data-tutorial-focus="minimize"]');
    if (button && typeof button.focus === 'function') button.focus();
  },

  hide() {
    if (this.els.layer) {
      this.els.layer.hidden = true;
      this.els.layer.classList.remove('open');
    }
    for (const element of [this.els.card, this.els.chip, this.els.halo]) {
      if (element) element.hidden = true;
    }
  },

  handleDisconnect() {
    this._clearPendingTimer();
    this._clearRenderRecovery();
    this.model = createTutorialState();
    this.advertisedReady = false;
    this.presentationAllowed = true;
    this.pendingAction = '';
    this.skipConfirming = false;
    this.hintVisible = false;
    this.routeVisible = false;
    this.lastAnnouncedKey = '';
    this.hide();
  },

  requestReposition() {
    if (this._repositionFrame || !this.els.layer || this.els.layer.hidden) return;
    const run = () => {
      this._repositionFrame = null;
      this.position();
    };
    if (typeof requestAnimationFrame === 'function') {
      this._repositionFrame = requestAnimationFrame(run);
    } else {
      run();
    }
  },

  position() {
    const shell = dom.outputShell;
    if (!shell || typeof shell.getBoundingClientRect !== 'function') return;
    const rect = shell.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const mobile = rect.width < 620 || (
      typeof window !== 'undefined' && window.innerWidth < 700
    );
    const inset = mobile ? 8 : 14;
    const width = mobile
      ? Math.max(1, rect.width - (inset * 2))
      : Math.min(390, Math.max(280, rect.width - (inset * 2)));
    const left = mobile
      ? rect.left + inset
      : Math.max(rect.left + inset, rect.right - width - inset);
    const top = rect.top + inset;
    const viewportHeight = typeof window !== 'undefined' && window.innerHeight
      ? window.innerHeight
      : rect.height;
    const availableHeight = Math.max(1, rect.height - (inset * 2));
    const maxHeight = Math.min(
      availableHeight,
      mobile ? viewportHeight * 0.45 : availableHeight,
    );

    for (const element of [this.els.card, this.els.chip]) {
      element.style.left = `${Math.round(left)}px`;
      element.style.top = `${Math.round(top)}px`;
    }
    this.els.card.style.width = `${Math.round(width)}px`;
    this.els.card.style.maxHeight = `${Math.round(maxHeight)}px`;
    this._updateTargetHalo();
  },

  _updateTargetHalo() {
    const halo = this.els.halo;
    if (!halo || this.collapsed || this.model.status !== 'active') {
      if (halo) halo.hidden = true;
      return;
    }
    const target = resolveTarget(this.model.step.target);
    if (!hasVisibleRect(target)) {
      halo.hidden = true;
      return;
    }
    const rect = target.getBoundingClientRect();
    const gutter = this.model.step.target === 'command-input' ? 4 : 6;
    halo.style.left = `${Math.round(rect.left - gutter)}px`;
    halo.style.top = `${Math.round(rect.top - gutter)}px`;
    halo.style.width = `${Math.round(rect.width + (gutter * 2))}px`;
    halo.style.height = `${Math.round(rect.height + (gutter * 2))}px`;
    halo.hidden = false;
  },

  _announce(model) {
    const key = tutorialStateKey(model);
    if (!key || key === this.lastAnnouncedKey || !this.els.live) return;
    this.lastAnnouncedKey = key;
    this.els.live.textContent = tutorialAnnouncement(model);
  },

  _clearPendingTimer() {
    if (!this._pendingTimer) return;
    clearTimeout(this._pendingTimer);
    this._pendingTimer = null;
  },

  _scheduleRenderRecovery() {
    if (this._recoveryTimer
        || this._renderRecoveryAttempt >= TUTORIAL_RENDER_RECOVERY_DELAYS_MS.length) {
      return;
    }

    const delay = TUTORIAL_RENDER_RECOVERY_DELAYS_MS[this._renderRecoveryAttempt];
    this._renderRecoveryAttempt += 1;
    this._recoveryTimer = setTimeout(() => {
      this._recoveryTimer = null;
      try {
        if (!this.els.card || this.els.card.isConnected === false) {
          this._discardMount();
          this.mount();
        }
        if (!this.els.card || this.els.card.isConnected === false) {
          throw new Error('Tutorial hover mount is unavailable');
        }
        if (this.presentationAllowed && this.model.status === 'active') {
          this.render();
        }
        this.renderHealthy = true;
        this._renderRecoveryAttempt = 0;
        this._syncReadiness('tutorial-render-recovered', true);
      } catch (error) {
        this.renderHealthy = false;
        this.hide();
        console.error('Tutorial hover recovery failed', error);
        this._scheduleRenderRecovery();
      }
    }, delay);
  },

  _clearRenderRecovery() {
    if (this._recoveryTimer) {
      clearTimeout(this._recoveryTimer);
      this._recoveryTimer = null;
    }
    this._renderRecoveryAttempt = 0;
  },

  _discardMount() {
    if (this.els.layer && typeof this.els.layer.remove === 'function') {
      this.els.layer.remove();
    }
    if (this.els.live && typeof this.els.live.remove === 'function') {
      this.els.live.remove();
    }
    for (const key of Object.keys(this.els)) this.els[key] = null;
  },

  _syncReadiness(reason, force = false) {
    const ready = this.isReadyForSubscription();
    if (!force && ready === this.advertisedReady) return;
    const sent = gmcp.sendSubscriptions({
      reason,
      features: { tutorialPane: ready },
    });
    if (!ready || sent) this.advertisedReady = ready;
    if (ready && sent) {
      gmcp.send(RESYNC_PACKAGE, {
        epoch: this.model.epoch || '',
        seq: this.model.seq || 0,
        reason,
      });
    }
  },
};
