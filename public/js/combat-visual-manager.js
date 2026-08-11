import { gmcp } from './gmcp.js';
import { panelManager } from './panel-manager.js';
import { state as appState } from './state.js';
import {
  clearCurrentCombatEvent,
  createCombatVisualState,
  prefersReducedCombatMotion,
  reduceCombatEvents,
  reduceCombatState,
  takeNextCombatEvent,
} from './combat-visual-core.mjs';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

const COMBAT_BEAT_MS = 440;
// Reduced motion removes movement, not information. Keep the static result and
// damage treatment visible for the same readable beat as the animated version.
const COMBAT_REDUCED_BEAT_MS = 440;

function mediaQueryForReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch (error) {
    return null;
  }
}

export const combatVisualManager = {
  model: createCombatVisualState(),
  initialized: false,
  renderHealthy: false,
  advertisedReady: false,
  autoOpenedEncounter: '',
  manuallyClosedEncounter: '',
  _animationTimer: null,
  _motionQuery: null,
  _panelLifecycleHandler: null,

  init() {
    return installControllerLifecycle(this, 'combat-visual', gmcp, (scopedGmcp, lifecycle) => {
      this._motionQuery = mediaQueryForReducedMotion();
      this.model = createCombatVisualState({
        reducedMotion: prefersReducedCombatMotion(
          typeof window !== 'undefined' ? window.matchMedia.bind(window) : null,
        ),
      });
      this._panelLifecycleHandler = (detail) => this._handlePanelLifecycle(detail);
      panelManager.registerPanelLifecycleHandler('enemy', this._panelLifecycleHandler);
      lifecycle.own('teardown', () => {
        panelManager.unregisterPanelLifecycleHandler('enemy', this._panelLifecycleHandler);
      });

      scopedGmcp.on('Darkwind.Combat.State', (data) => this.handleState(data));
      scopedGmcp.on('Darkwind.Combat.Events', (data) => this.handleEvents(data));
      // Accept the singular spelling defensively for mixed development builds.
      scopedGmcp.on('Darkwind.Combat.Event', (data) => this.handleEvents({
        epoch: data && data.epoch,
        encounter_id: data && data.encounter_id,
        first_seq: data && data.seq,
        last_seq: data && data.seq,
        events: data ? [data] : [],
      }));

      if (this._motionQuery) {
        const onMotionChange = lifecycle.guard((event) => {
          this.model = { ...this.model, reducedMotion: !!event.matches };
          this._publishModel('motion-change');
        });
        if (this._motionQuery.addEventListener) {
          this._motionQuery.addEventListener('change', onMotionChange);
          lifecycle.own('listener', () => this._motionQuery.removeEventListener('change', onMotionChange));
        } else if (this._motionQuery.addListener) {
          this._motionQuery.addListener(onMotionChange);
          lifecycle.own('listener', () => this._motionQuery.removeListener(onMotionChange));
        }
      }

      this.initialized = true;
      this._syncReadiness('combat-manager-init');
    }, () => {
      this._clearTimers();
      panelManager.setCombatVisualState(null);
      this._motionQuery = null;
      this._panelLifecycleHandler = null;
      this.initialized = false;
    });
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  handleState(payload) {
    if (!this.initialized) this.init();
    const previous = this.model;
    const next = reduceCombatState(previous, payload);
    if (next === previous) return;

    const newEncounter = next.epoch !== previous.epoch
      || next.encounterId !== previous.encounterId;
    const visualStopped = previous.visualEnabled && !next.visualEnabled;

    this.model = next;
    if (newEncounter) {
      this._clearTimers();
      this.manuallyClosedEncounter = '';
      this.autoOpenedEncounter = '';
    }

    if (!next.visualEnabled) {
      this.renderHealthy = false;
      this._syncReadiness('visual-disabled');
      panelManager.setPanelTitle('enemy', 'Enemy');
      panelManager.setCombatVisualState(null);
      if (visualStopped) panelManager.syncEnemyPanelVisibility();
      this.autoOpenedEncounter = '';
      this.manuallyClosedEncounter = '';
      return;
    }

    panelManager.setPanelTitle('enemy', 'Combat');

    if (next.active) {
      if (this.manuallyClosedEncounter !== next.encounterId) {
        const presentation = panelManager.getPanelPresentationState('enemy');
        const needsEncounterPresentation =
          this.autoOpenedEncounter !== next.encounterId;
        const mobileNeedsActivation = !!(
          newEncounter
          && presentation.mobileMode
          && (!presentation.mobileSheetOpen || !presentation.mobilePanelActive)
        );
        if (needsEncounterPresentation
            || !presentation.visible
            || mobileNeedsActivation) {
          this.autoOpenedEncounter = next.encounterId;
          panelManager.prepareCombatVisualLayout();
          panelManager.showEnemyPanelForCombat();
        } else {
          panelManager.prepareCombatVisualLayout();
        }
      }
      this._publishModel(newEncounter ? 'encounter-start' : 'state-update');
      return;
    }

    this._publishModel('encounter-end');
    this._finishEncounterPresentation();
  },

  handleEvents(payload) {
    if (!this.initialized) this.init();
    const next = reduceCombatEvents(this.model, payload);
    if (next === this.model) return;
    this.model = next;
    this._drainAnimationQueue();
  },

  _publishModel(reason) {
    if (!this.model.visualEnabled) return;
    try {
      this.renderHealthy = panelManager.setCombatVisualState(this.model) !== false;
    } catch (error) {
      this.renderHealthy = false;
      console.error('Combat visual renderer failed', error);
      panelManager.showCombatVisualError();
    }
    this._syncReadiness(reason);
  },

  _drainAnimationQueue() {
    if (this._animationTimer || !this.model.visualEnabled) return;
    const taken = takeNextCombatEvent(this.model);
    this.model = taken.state;
    if (!taken.event) {
      this._publishModel('events-drained');
      return;
    }

    this._publishModel('combat-beat');
    const duration = this.model.reducedMotion ? COMBAT_REDUCED_BEAT_MS : COMBAT_BEAT_MS;
    this._animationTimer = setTimeout(() => {
      this._animationTimer = null;
      this.model = clearCurrentCombatEvent(this.model);
      this._publishModel('combat-beat-end');
      this._drainAnimationQueue();
    }, duration);
  },

  _handlePanelLifecycle(detail = {}) {
    if (!this.initialized || detail.id !== 'enemy') return;
    if (!this.model.visualEnabled) return;

    const encounterId = this.model.encounterId;
    if ((detail.reason === 'close'
        || detail.reason === 'hide'
        || detail.reason === 'mobile-sheet-close')
        && this.model.active
        && encounterId
        && detail.reason !== 'combat-auto-hide') {
      this.manuallyClosedEncounter = encounterId;
    }

    if (!detail.ready) {
      this._syncReadiness('combat-pane-' + (detail.reason || 'unavailable'));
      return;
    }

    if (this.manuallyClosedEncounter === encounterId) {
      this.manuallyClosedEncounter = '';
    }
    this._publishModel('combat-pane-' + (detail.reason || 'ready'));
  },

  _syncReadiness(reason) {
    const presentation = panelManager.getPanelPresentationState('enemy');
    const ready = !!(
      this.initialized
      && !appState.zorkOnlyMode
      && this.model.visualEnabled
      && this.renderHealthy
      && presentation.ready
      && this.manuallyClosedEncounter !== this.model.encounterId
    );

    if (ready === this.advertisedReady) return;
    const sent = gmcp.sendSubscriptions({
      reason,
      features: { combatPane: ready },
    });

    // A disconnect already makes server-side readiness unusable. Keep our
    // local state false even though there is no socket on which to send it.
    if (!ready || sent) this.advertisedReady = ready;
    if (ready && sent) {
      gmcp.send('Darkwind.Combat.Resync');
    }
  },

  _finishEncounterPresentation() {
    if (this.autoOpenedEncounter !== this.model.encounterId) return;
    this._clearTimers();
    panelManager.hideEnemyPanelAfterCombat();
    panelManager.setPanelTitle('enemy', 'Enemy');
    this.renderHealthy = false;
    this._syncReadiness('combat-ended');
    this.autoOpenedEncounter = '';
  },

  _clearTimers() {
    if (this._animationTimer) {
      clearTimeout(this._animationTimer);
      this._animationTimer = null;
    }
  },

  handleDisconnect() {
    this._clearTimers();
    if (this.autoOpenedEncounter) panelManager.hideEnemyPanelAfterCombat();
    this.model = createCombatVisualState({
      reducedMotion: this._motionQuery ? !!this._motionQuery.matches : false,
    });
    this.renderHealthy = false;
    this.advertisedReady = false;
    this.autoOpenedEncounter = '';
    this.manuallyClosedEncounter = '';
    panelManager.setCombatVisualState(null);
    panelManager.setPanelTitle('enemy', 'Enemy');
  },
};
