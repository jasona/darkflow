import { gmcp } from './gmcp.js';
import { soundManager, SOUND_CATEGORIES, SOUND_CATEGORY_INFO } from './sound-manager.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

const EXPANDED_STORAGE_KEY = 'darkwind-sound-expanded';
const SOUND_PACKAGE = 'Darkwind.Sound';

class SoundPanel {
  constructor() {
    this.root = null;
    this.panel = null;
    this.expanded = false;
    this.currentCategory = null;
    this.activityTimer = null;
    this.activeLoops = new Map();
    this.serverSupported = false;
  }

  init(rootId = 'audio-widget-root') {
    this.root = document.getElementById(rootId);
    if (!this.root) return;
    return installControllerLifecycle(this, 'sound-panel', gmcp, (scopedGmcp, lifecycle) => {
      this.expanded = false;
      this.panel = document.createElement('div');
      this.panel.className = 'sound-widget';
      this.panel.innerHTML = this._buildHtml();
      this.root.appendChild(this.panel);
      this._attachEvents();
      this._setExpanded(this.expanded);
      this._setSupported(scopedGmcp.serverSupportsPackage(SOUND_PACKAGE));
      this.update();

      lifecycle.own('subscription', soundManager.onChange(() => this.update()));
      scopedGmcp.on('Core.Supports.Set', () => this._setSupported(scopedGmcp.serverSupportsPackage(SOUND_PACKAGE)));
      scopedGmcp.on('Core.Supports.Add', () => this._setSupported(scopedGmcp.serverSupportsPackage(SOUND_PACKAGE)));
      scopedGmcp.on('Core.Supports.Remove', () => this._setSupported(scopedGmcp.serverSupportsPackage(SOUND_PACKAGE)));
      scopedGmcp.on('Darkwind.Sound', (message) => this.handleSoundMessage(message));
    }, () => {
      if (this.activityTimer) window.clearTimeout(this.activityTimer);
      this.activityTimer = null;
      this.activeLoops.clear();
      if (this.panel) this.panel.remove();
      this.panel = null;
      this.root = null;
    });
  }

  dispose() {
    disposeControllerLifecycle(this);
  }

  _loadExpandedState() {
    try {
      return localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  _saveExpandedState() {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, String(this.expanded));
    } catch {}
  }

  _buildHtml() {
    return `
      <div class="sound-widget-compact">
        <button class="sound-widget-indicator" type="button" aria-expanded="false" title="Audio controls">
          <span class="sound-widget-indicator-icon">\uD83D\uDD0A</span>
          <span class="sound-widget-indicator-label">Ready</span>
        </button>
        <button class="sound-widget-mute" type="button" title="Toggle audio" aria-label="Toggle audio">
          <span class="sound-widget-mute-icon">\uD83D\uDD0A</span>
        </button>
      </div>
      <div class="sound-widget-expanded" hidden>
        <div class="sound-widget-volume">
          <label for="sound-widget-volume-slider">Volume</label>
          <input id="sound-widget-volume-slider" class="sound-widget-volume-slider" type="range" min="0" max="100" value="70" data-1p-ignore="true" data-op-ignore="true">
          <span class="sound-widget-volume-value">70%</span>
        </div>
        <div class="sound-widget-categories">
          ${SOUND_CATEGORIES.map((category) => `
            <button class="sound-widget-category" type="button" data-category="${category}" title="${SOUND_CATEGORY_INFO[category].label}">
              <span class="sound-widget-category-icon">${SOUND_CATEGORY_INFO[category].icon}</span>
              <span class="sound-widget-category-label">${SOUND_CATEGORY_INFO[category].label}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  _attachEvents() {
    const indicator = this.panel.querySelector('.sound-widget-indicator');
    const mute = this.panel.querySelector('.sound-widget-mute');
    const slider = this.panel.querySelector('.sound-widget-volume-slider');

    indicator.addEventListener('click', () => {
      soundManager.unlockFromUserGesture();
      this._setExpanded(!this.expanded);
    });
    mute.addEventListener('click', (event) => {
      event.stopPropagation();
      soundManager.toggleEnabled();
    });
    slider.addEventListener('input', () => {
      soundManager.setVolume(Number(slider.value) / 100);
    });

    this.panel.querySelectorAll('.sound-widget-category').forEach((button) => {
      button.addEventListener('click', () => {
        soundManager.toggleCategory(button.dataset.category);
      });
    });
  }

  _setExpanded(expanded) {
    this.expanded = !!expanded;
    const expandedEl = this.panel.querySelector('.sound-widget-expanded');
    const indicator = this.panel.querySelector('.sound-widget-indicator');
    const toolbar = this.root.closest('#toolbar');
    expandedEl.hidden = !this.expanded;
    indicator.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
    this.panel.classList.toggle('expanded', this.expanded);
    if (toolbar) toolbar.classList.toggle('audio-menu-active', this.expanded);
    this._saveExpandedState();
  }

  _setSupported(supported) {
    this.serverSupported = !!supported;
    if (!this.serverSupported) this._setExpanded(false);
    this.root.hidden = !this.serverSupported;
    this.panel.hidden = !this.serverSupported;
  }

  update() {
    if (!this.panel) return;
    const settings = soundManager.getSettings();
    const indicatorIcon = this.panel.querySelector('.sound-widget-indicator-icon');
    const indicatorLabel = this.panel.querySelector('.sound-widget-indicator-label');
    const muteIcon = this.panel.querySelector('.sound-widget-mute-icon');
    const slider = this.panel.querySelector('.sound-widget-volume-slider');
    const volumeValue = this.panel.querySelector('.sound-widget-volume-value');
    const volumePct = Math.round(settings.volume * 100);

    muteIcon.textContent = settings.enabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
    slider.value = String(volumePct);
    volumeValue.textContent = volumePct + '%';
    this.panel.classList.toggle('muted', !settings.enabled);
    this.panel.classList.toggle('locked', settings.enabled && !settings.audioUnlocked);

    if (!settings.enabled) {
      indicatorIcon.textContent = '\uD83D\uDD07';
      indicatorLabel.textContent = 'Muted';
    } else if (settings.volume <= 0) {
      indicatorIcon.textContent = '\uD83D\uDD07';
      indicatorLabel.textContent = 'Volume 0%';
    } else if (!settings.audioUnlocked && settings.pendingCount > 0) {
      indicatorIcon.textContent = '\uD83D\uDD0A';
      indicatorLabel.textContent = 'Click to enable';
    } else if (this.currentCategory && SOUND_CATEGORY_INFO[this.currentCategory]) {
      indicatorIcon.textContent = SOUND_CATEGORY_INFO[this.currentCategory].icon;
      indicatorLabel.textContent = SOUND_CATEGORY_INFO[this.currentCategory].label;
    } else {
      indicatorIcon.textContent = '\uD83D\uDD0A';
      indicatorLabel.textContent = 'Ready';
    }

    this.panel.querySelectorAll('.sound-widget-category').forEach((button) => {
      const enabled = !!settings.categoryEnabled[button.dataset.category];
      button.classList.toggle('enabled', enabled);
      button.classList.toggle('disabled', !enabled);
      button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    });
  }

  _showActivity(category, isLoop) {
    if (!SOUND_CATEGORY_INFO[category]) return;
    this.currentCategory = category;
    this.panel.classList.add('active');
    this.update();
    if (this.activityTimer) {
      window.clearTimeout(this.activityTimer);
      this.activityTimer = null;
    }
    if (!isLoop && this.activeLoops.size === 0) {
      this.activityTimer = window.setTimeout(() => {
        this.currentCategory = null;
        this.panel.classList.remove('active');
        this.update();
        this.activityTimer = null;
      }, 2000);
    }
  }

  _clearActivity() {
    if (this.activeLoops.size === 0) {
      this.currentCategory = null;
      this.panel.classList.remove('active');
    } else {
      this.currentCategory = this.activeLoops.values().next().value || null;
    }
    this.update();
  }

  handleSoundMessage(message) {
    if (!message || typeof message !== 'object') return;
    const handled = soundManager.handleMessage(message);
    if (!handled) return;

    if (message.type === 'play') {
      this._showActivity(message.category, false);
    } else if (message.type === 'loop' && message.id) {
      this.activeLoops.set(message.id, message.category);
      this._showActivity(message.category, true);
    } else if (message.type === 'stop') {
      if (message.id) {
        this.activeLoops.delete(message.id);
      } else {
        for (const [id, category] of this.activeLoops.entries()) {
          if (category === message.category) this.activeLoops.delete(id);
        }
      }
      this._clearActivity();
    }
  }
}

export const soundPanel = new SoundPanel();
