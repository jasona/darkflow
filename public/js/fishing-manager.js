// fishing-manager.js - the interactive fishing mini-game pane.
// Server protocol: Darkwind.Fishing.* (see darkwind-nextgen
// objects/professions/fishing_d.c). The server owns species selection and
// rewards; this module runs the real-time reel fight (fishing-core.mjs)
// and reports the outcome.

import { gmcp } from './gmcp.js';
import { panelManager } from './panel-manager.js';
import { soundManager } from './sound-manager.js';
import { createFightSim, computeAccuracy, castPowerAt, PROGRESS_START } from './fishing-core.mjs';

const REEL_LOOP_ID = 'fishing-reel';

const PKG = {
  OPEN: 'Darkwind.Fishing.Open',
  CAST: 'Darkwind.Fishing.Cast',
  BITE: 'Darkwind.Fishing.Bite',
  HOOK: 'Darkwind.Fishing.Hook',
  FIGHT: 'Darkwind.Fishing.Fight',
  RESULT: 'Darkwind.Fishing.Result',
  CAUGHT: 'Darkwind.Fishing.Caught',
  ESCAPED: 'Darkwind.Fishing.Escaped',
  ART: 'Darkwind.Fishing.Art',
  CANCEL: 'Darkwind.Fishing.Cancel',
  END: 'Darkwind.Fishing.End',
};

const RARITY_COLORS = {
  common: 'var(--df-text)',
  uncommon: '#4caf50',
  rare: '#42a5f5',
  epic: '#ab47bc',
  legendary: '#ffb300',
};

const ESCAPE_TEXT = {
  snap: 'SNAP! The line breaks and whips back over your head.',
  slack: 'The line goes slack... the fish wriggles free.',
  timeout: 'Too slow! The fish makes off with your bait.',
  implausible: 'The fish slips away in a blur.',
};

const FISH_SILHOUETTE_SVG =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 40">' +
    '<path fill="currentColor" opacity="0.55" d="M8 20c8-10 20-14 30-10l10-8v10c4 2 7 5 8 8-1 3-4 6-8 8v10l-10-8c-10 4-22 0-30-10z"/>' +
    '<circle cx="42" cy="17" r="2" fill="var(--df-panel, #111)"/></svg>'
  );

export const fishingManager = {
  session: null,      // { id, terrain, skill, baited, sceneArtUrl }
  phase: 'idle',      // idle|ready|casting|waiting|bite|fight|caught|escaped
  sim: null,
  held: false,
  _rafId: 0,
  _lastTs: 0,
  _castStart: 0,
  _biteTimer: 0,
  _bodyEl: null,
  els: null,
  artCache: {},       // species id -> url

  init() {
    gmcp.on(PKG.OPEN, (data) => this._onOpen(data));
    gmcp.on(PKG.BITE, (data) => this._onBite(data));
    gmcp.on(PKG.FIGHT, (data) => this._onFight(data));
    gmcp.on(PKG.CAUGHT, (data) => this._onCaught(data));
    gmcp.on(PKG.ESCAPED, (data) => this._onEscaped(data));
    gmcp.on(PKG.ART, (data) => this._onArt(data));
    gmcp.on(PKG.END, (data) => this._onEnd(data));

    panelManager.registerPanelCloseHandler('fishing', () => {
      if (this.session) gmcp.send(PKG.CANCEL, { session: this.session.id });
      this._reset('idle');
      return true;
    });
  },

  // ---- GMCP handlers -------------------------------------------------

  _onOpen(data) {
    if (!data || !data.session) return;
    this.session = {
      id: data.session,
      terrain: data.terrain || 'water',
      skill: data.skill || 0,
      baited: !!data.baited,
      sceneArtUrl: data.sceneArtUrl || null,
    };
    this._reset(this.session.baited ? 'ready' : 'nobait');
    // createPanel only invokes the renderer when gmcpData[id] is set.
    panelManager.gmcpData.fishing = { session: this.session.id };
    panelManager.openPanel('fishing');
    panelManager._renderPanel('fishing');
    this._render();
  },

  _onBite(data) {
    if (!this._isCurrent(data) || this.phase !== 'waiting') return;
    this.phase = 'bite';
    this._biteTimer = data.windowMs || 2500;
    this._biteWindow = this._biteTimer;
    soundManager.play('fishing', 'splash');
    this._render();
    this._startLoop();
  },

  _onFight(data) {
    if (!this._isCurrent(data)) return;
    this.phase = 'fight';
    this.held = false;
    this._tensionWarned = false;
    this.fightParams = data.params || {};
    this.sim = createFightSim(this.fightParams, data.seed || 1);
    this.fightMeta = data.fish || {};
    this._burst();
    soundManager.loop('fishing', 'reel', REEL_LOOP_ID, 0.6);
    this._render();
    if (this.els) this.els.bar.style.height = (this.fightParams.barSize || 20) + '%';
    this._startLoop();
  },

  _onCaught(data) {
    if (!this._isCurrent(data)) return;
    this._stopLoop();
    soundManager.stopById(REEL_LOOP_ID);
    this.phase = 'caught';
    this.lastCatch = data.fish || {};
    this.lastRewards = data.rewards || {};
    if (this.lastCatch.id && this.lastCatch.artUrl) {
      this.artCache[this.lastCatch.id] = this.lastCatch.artUrl;
    }
    soundManager.play('fishing', 'catch');
    if (this.lastCatch.pristine) soundManager.play('fishing', 'pristine');
    this.session.baited = false;
    this._render();
  },

  _onEscaped(data) {
    if (!this._isCurrent(data)) return;
    this._stopLoop();
    soundManager.stopById(REEL_LOOP_ID);
    this.phase = 'escaped';
    this.escapeReason = data.reason || 'slack';
    if (this.escapeReason === 'snap') {
      soundManager.play('fishing', 'snap');
      this._shake();
    } else {
      soundManager.play('fishing', 'slack');
    }
    this.session.baited = false;
    this._render();
  },

  _onArt(data) {
    if (!data || !data.species || !data.artUrl) return;
    this.artCache[data.species] = data.artUrl;
    if (this.phase === 'caught' && this.lastCatch && this.lastCatch.id === data.species) {
      this.lastCatch.artUrl = data.artUrl;
      this._render();
    }
  },

  _onEnd(data) {
    if (!this._isCurrent(data)) return;
    this._reset('idle');
    this.endMessage = (data && data.message) || '';
    this._render();
  },

  _isCurrent(data) {
    return data && this.session && data.session === this.session.id;
  },

  _reset(phase) {
    this._stopLoop();
    soundManager.stopById(REEL_LOOP_ID);
    this.phase = phase;
    this.sim = null;
    this.held = false;
    if (phase === 'idle') this.session = null;
  },

  // ---- Outbound ------------------------------------------------------

  _sendCast(power) {
    if (!this.session) return;
    gmcp.send(PKG.CAST, { session: this.session.id, power });
    soundManager.play('fishing', 'cast');
    this.phase = 'waiting';
    this.session.baited = false;
    this._render();
  },

  _sendHook() {
    if (!this.session || this.phase !== 'bite') return;
    gmcp.send(PKG.HOOK, { session: this.session.id });
    soundManager.play('fishing', 'hook');
    this.phase = 'hooking';
    this._render();
  },

  _sendResult(outcome) {
    if (!this.session || !this.sim) return;
    const st = this.sim.getState();
    gmcp.send(PKG.RESULT, {
      session: this.session.id,
      outcome,
      fightMs: Math.round(st.elapsedMs),
      accuracy: Math.round(computeAccuracy(st) * 1000) / 1000,
      tensionPeak: Math.round(st.tensionPeak),
    });
  },

  // ---- Render --------------------------------------------------------

  render(bodyEl) {
    this._bodyEl = bodyEl;
    if (!bodyEl._fishingBuilt) {
      this._build(bodyEl);
      bodyEl._fishingBuilt = true;
    }
    this._render();
  },

  _build(bodyEl) {
    bodyEl.innerHTML = '';
    bodyEl.classList.add('fishing-body');

    const stage = document.createElement('div');
    stage.className = 'fishing-stage';
    stage.tabIndex = 0;
    stage.dataset.terrain = '';

    stage.innerHTML = `
      <button type="button" class="fishing-close" title="Stop fishing">&#x2715;</button>
      <img class="fishing-scene" alt="" draggable="false">
      <div class="fishing-water"></div>
      <div class="fishing-bobber"><div class="fishing-bobber-top"></div></div>
      <div class="fishing-splashfx"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      <div class="fishing-exclaim">!</div>
      <div class="fishing-bitebar"><div class="fishing-bitebar-fill"></div></div>
      <div class="fishing-fightview">
        <div class="fishing-track">
          <div class="fishing-fish"><img src="${FISH_SILHOUETTE_SVG}" alt="" draggable="false"></div>
          <div class="fishing-bar"></div>
        </div>
        <div class="fishing-meters">
          <div class="fishing-meter fishing-progress"><div class="fishing-meter-fill"></div><span>Catch</span></div>
          <div class="fishing-meter fishing-tension"><div class="fishing-meter-fill"></div><span>Tension</span></div>
        </div>
      </div>
      <div class="fishing-trophy">
        <img class="fishing-trophy-art" alt="" draggable="false">
        <div class="fishing-trophy-name"></div>
        <div class="fishing-trophy-details"></div>
        <div class="fishing-trophy-status"></div>
      </div>
      <div class="fishing-message"></div>
      <div class="fishing-powerwrap">
        <div class="fishing-power"><div class="fishing-power-fill"></div></div>
        <button type="button" class="fishing-cast-btn">Hold to Cast</button>
      </div>
      <div class="fishing-status"></div>
    `;
    bodyEl.appendChild(stage);

    this.els = {
      stage,
      closeBtn: stage.querySelector('.fishing-close'),
      scene: stage.querySelector('.fishing-scene'),
      bobber: stage.querySelector('.fishing-bobber'),
      splashfx: stage.querySelector('.fishing-splashfx'),
      exclaim: stage.querySelector('.fishing-exclaim'),
      bitebar: stage.querySelector('.fishing-bitebar'),
      bitebarFill: stage.querySelector('.fishing-bitebar-fill'),
      fightview: stage.querySelector('.fishing-fightview'),
      fish: stage.querySelector('.fishing-fish'),
      bar: stage.querySelector('.fishing-bar'),
      progressFill: stage.querySelector('.fishing-progress .fishing-meter-fill'),
      tensionFill: stage.querySelector('.fishing-tension .fishing-meter-fill'),
      trophy: stage.querySelector('.fishing-trophy'),
      trophyArt: stage.querySelector('.fishing-trophy-art'),
      trophyName: stage.querySelector('.fishing-trophy-name'),
      trophyDetails: stage.querySelector('.fishing-trophy-details'),
      trophyStatus: stage.querySelector('.fishing-trophy-status'),
      message: stage.querySelector('.fishing-message'),
      powerWrap: stage.querySelector('.fishing-powerwrap'),
      powerFill: stage.querySelector('.fishing-power-fill'),
      castBtn: stage.querySelector('.fishing-cast-btn'),
      status: stage.querySelector('.fishing-status'),
    };

    // Cast: hold the button, release to send with the oscillating power.
    const castDown = (ev) => {
      if (this.phase !== 'ready') return;
      ev.preventDefault();
      this.phase = 'casting';
      this._castStart = performance.now();
      this.els.castBtn.setPointerCapture?.(ev.pointerId);
      this._render();
      this._startLoop();
    };
    const castUp = (ev) => {
      if (this.phase !== 'casting') return;
      ev.preventDefault();
      this._stopLoop();
      this._sendCast(castPowerAt(performance.now() - this._castStart));
    };
    this.els.castBtn.addEventListener('pointerdown', castDown);
    this.els.castBtn.addEventListener('pointerup', castUp);
    this.els.castBtn.addEventListener('pointercancel', castUp);

    // Close: ends the session (the panel close handler sends Cancel).
    this.els.closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      panelManager.closePanel('fishing');
    });

    // Stage input: hook taps and fight hold/release.
    stage.addEventListener('pointerdown', (ev) => {
      if (ev.target === this.els.castBtn || ev.target === this.els.closeBtn) return;
      stage.focus();
      if (this.phase === 'bite') { ev.preventDefault(); this._sendHook(); return; }
      if (this.phase === 'fight') { ev.preventDefault(); this.held = true; }
    });
    const release = () => { if (this.phase === 'fight') this.held = false; };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerleave', release);

    // Optional keyboard: Space acts as tap/hold while the stage has focus.
    stage.addEventListener('keydown', (ev) => {
      if (ev.code !== 'Space') return;
      ev.preventDefault();
      if (ev.repeat) return;
      if (this.phase === 'bite') this._sendHook();
      else if (this.phase === 'fight') this.held = true;
    });
    stage.addEventListener('keyup', (ev) => {
      if (ev.code !== 'Space') return;
      ev.preventDefault();
      if (this.phase === 'fight') this.held = false;
    });
  },

  _render() {
    if (!this.els) return;
    const e = this.els;
    const phase = this.phase;

    e.stage.dataset.phase = phase;
    e.stage.dataset.terrain = this.session ? this.session.terrain : '';

    if (this.session && this.session.sceneArtUrl) {
      if (e.scene.src !== this.session.sceneArtUrl) e.scene.src = this.session.sceneArtUrl;
      e.scene.style.display = '';
    } else {
      e.scene.style.display = 'none';
    }

    e.bobber.style.display = (phase === 'waiting' || phase === 'bite') ? '' : 'none';
    e.exclaim.style.display = phase === 'bite' ? '' : 'none';
    e.bitebar.style.display = phase === 'bite' ? '' : 'none';
    if (phase === 'bite') e.bitebarFill.style.width = '100%';
    e.fightview.style.display = (phase === 'fight' || phase === 'hooking') ? '' : 'none';
    e.trophy.style.display = phase === 'caught' ? '' : 'none';
    e.powerWrap.style.display = (phase === 'ready' || phase === 'casting') ? '' : 'none';

    const messages = {
      idle: this.endMessage || 'Find some water, then type "fish" to open a session.',
      nobait: 'Your hook is bare. Use "bait hook" first, then "fish" again.',
      ready: 'Hold the button to charge your cast; release to let fly.',
      casting: '',
      waiting: 'Your line drifts on the ' + (this.session ? this.session.terrain : 'water') + '...',
      bite: 'HOOK IT! Tap now!',
      hooking: 'Setting the hook...',
      fight: '',
      caught: '',
      escaped: ESCAPE_TEXT[this.escapeReason] || ESCAPE_TEXT.slack,
    };
    e.message.textContent = messages[phase] ?? '';

    if (phase === 'caught' && this.lastCatch) {
      const f = this.lastCatch;
      const color = RARITY_COLORS[f.rarity] || RARITY_COLORS.common;
      e.trophy.style.setProperty('--fishing-rarity', color);
      e.trophy.classList.toggle('pristine', !!f.pristine);
      e.trophyArt.src = f.artUrl || this.artCache[f.id] || FISH_SILHOUETTE_SVG;
      e.trophyName.textContent = f.name || 'A fish';
      const bits = [
        (f.rarity || 'common').toUpperCase(),
        f.sizeCm ? f.sizeCm + ' cm' : '',
        f.weightKg ? f.weightKg + ' kg' : '',
        'quality ' + (f.quality ?? '?'),
        f.pristine ? 'PRISTINE' : '',
      ].filter(Boolean);
      e.trophyDetails.textContent = bits.join(' | ');
      const r = this.lastRewards || {};
      let status = r.skillup ? 'Your fishing skill rises to ' + r.newSkill + '!' : '';
      if (r.reagent) status += (status ? ' ' : '') + '+' + r.reagent.amount + ' ' + r.reagent.name;
      // Rewards live inside the trophy card so they never overlap its border.
      e.trophyStatus.textContent = status;
      e.trophyStatus.style.display = status ? '' : 'none';
      e.status.textContent = '';
    } else if (phase === 'escaped' || phase === 'idle' || phase === 'nobait') {
      e.status.textContent = this.session && !this.session.baited && phase === 'escaped'
        ? 'Re-bait your hook to try again.' : '';
    } else {
      e.status.textContent = '';
    }
  },

  // ---- Game loop -------------------------------------------------------

  _startLoop() {
    if (this._rafId) return;
    this._lastTs = performance.now();
    const tick = (ts) => {
      this._rafId = 0;
      const dt = Math.min(100, ts - this._lastTs);
      this._lastTs = ts;

      if (this.phase === 'casting') {
        const p = castPowerAt(ts - this._castStart);
        this.els.powerFill.style.height = p + '%';
        this.els.powerFill.classList.toggle('hot', p > 70);
      } else if (this.phase === 'bite') {
        this._biteTimer -= dt;
        if (this._biteWindow > 0) {
          const pct = Math.max(0, (this._biteTimer / this._biteWindow) * 100);
          this.els.bitebarFill.style.width = pct + '%';
        }
        if (this._biteTimer <= 0) {
          // Server will confirm the timeout; stop animating locally.
          this._stopLoop();
          return;
        }
      } else if (this.phase === 'fight' && this.sim) {
        const outcome = this.sim.step(dt, this.held);
        this._paintFight();
        if (outcome) {
          this._sendResult(outcome);
          this.phase = 'resolving';
          this._stopLoop();
          return;
        }
      } else {
        this._stopLoop();
        return;
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  },

  _stopLoop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
  },

  _paintFight() {
    const st = this.sim.getState();
    const e = this.els;
    const trackH = e.fish.parentElement.clientHeight || 200;
    const barPx = (st.barPos / 100) * trackH;
    const fishPx = (st.fishPos / 100) * trackH;

    e.fish.style.transform = 'translateY(' + (trackH - fishPx) + 'px) translateY(-50%)';
    e.bar.style.transform = 'translateY(' + (trackH - barPx) + 'px) translateY(-50%)';
    e.progressFill.style.width = st.progress + '%';
    e.tensionFill.style.width = st.tension + '%';
    e.tensionFill.classList.toggle('warn', st.tension > 60);
    e.tensionFill.classList.toggle('hot', st.tension > 85);
    e.stage.classList.toggle('fish-running', st.running);

    // Creak once per excursion into the danger zone.
    if (st.tension > 85 && !this._tensionWarned) {
      this._tensionWarned = true;
      soundManager.play('fishing', 'tension');
    } else if (st.tension < 70 && this._tensionWarned) {
      this._tensionWarned = false;
    }
  },

  // ---- One-shot FX -----------------------------------------------------

  _burst() {
    const fx = this.els && this.els.splashfx;
    if (!fx) return;
    fx.classList.remove('burst');
    void fx.offsetWidth; // restart the animation
    fx.classList.add('burst');
  },

  _shake() {
    const stage = this.els && this.els.stage;
    if (!stage) return;
    stage.classList.remove('fishing-shake');
    void stage.offsetWidth;
    stage.classList.add('fishing-shake');
    setTimeout(() => stage.classList.remove('fishing-shake'), 600);
  },
};
