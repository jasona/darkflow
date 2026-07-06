const SOUND_STORAGE_KEY = 'darkwind-sound-settings';
const SOUND_ASSET_ROOT = '/assets/sounds/';
const AUDIO_UNLOCK_FALLBACK_SOUND = '/assets/sounds/quest-accept.mp3';
const DEFAULT_VOLUME = 0.7;
const SUPPRESSED_SOUND_CATEGORIES = new Set(['discussion']);

export const SOUND_CATEGORIES = [
  'combat',
  'spell',
  'skill',
  'potion',
  'quest',
  'celebration',
  'discussion',
  'alert',
  'ambient',
  'fishing',
  'ui',
];

export const SOUND_CATEGORY_INFO = {
  combat: { icon: '\u2694\uFE0F', label: 'Combat' },
  spell: { icon: '\u2728', label: 'Spell' },
  skill: { icon: '\uD83D\uDCAA', label: 'Skill' },
  potion: { icon: '\uD83E\uDDEA', label: 'Potion' },
  quest: { icon: '\uD83D\uDCDC', label: 'Quest' },
  celebration: { icon: '\uD83C\uDF89', label: 'Celebration' },
  discussion: { icon: '\uD83D\uDCAC', label: 'Discuss' },
  alert: { icon: '\u26A0\uFE0F', label: 'Alert' },
  ambient: { icon: '\uD83C\uDF3F', label: 'Ambient' },
  fishing: { icon: '\uD83C\uDFA3', label: 'Fishing' },
  ui: { icon: '\uD83D\uDDB1\uFE0F', label: 'Interface' },
};

const DEFAULT_CATEGORY_ENABLED = {
  combat: true,
  spell: true,
  skill: true,
  potion: true,
  quest: true,
  celebration: true,
  discussion: true,
  alert: true,
  ambient: true,
  fishing: true,
  ui: true,
};

export const SOUND_MAP = {
  'combat/hit': '/assets/sounds/combat-hit.mp3',
  'combat/miss': '/assets/sounds/combat-miss.mp3',
  'combat/critical': '/assets/sounds/combat-critical.mp3',
  'combat/block': '/assets/sounds/combat-block.mp3',
  'combat/parry': '/assets/sounds/combat-parry.mp3',
  'combat/riposte': '/assets/sounds/combat-parry.mp3',
  'combat/dodge': '/assets/sounds/combat-miss.mp3',
  'combat/absorb': '/assets/sounds/combat-block.mp3',
  'combat/start': '/assets/sounds/combat-start.mp3',
  'combat/victory': '/assets/sounds/combat-victory.mp3',
  'combat/death': '/assets/sounds/combat-death.mp3',
  'combat/stun': '/assets/sounds/combat-stun.mp3',
  'combat/thorns': '/assets/sounds/combat-thorns.mp3',
  'combat/combat-music': '/assets/sounds/combat-music.mp3',
  'spell/cast': '/assets/sounds/spell-cast.mp3',
  'spell/fire': '/assets/sounds/spell-fire.mp3',
  'spell/ice': '/assets/sounds/spell-ice.mp3',
  'spell/lightning': '/assets/sounds/spell-lightning.mp3',
  'spell/heal': '/assets/sounds/spell-heal.mp3',
  'spell/buff': '/assets/sounds/spell-buff.mp3',
  'skill/use': '/assets/sounds/skill-use.mp3',
  'skill/success': '/assets/sounds/skill-success.mp3',
  'skill/fail': '/assets/sounds/skill-fail.mp3',
  'potion/drink': '/assets/sounds/potion-drink.mp3',
  'potion/heal': '/assets/sounds/potion-heal.mp3',
  'potion/mana': '/assets/sounds/potion-mana.mp3',
  'quest/accept': '/assets/sounds/quest-accept.mp3',
  'quest/complete': '/assets/sounds/quest-complete.mp3',
  'quest/update': '/assets/sounds/quest-update.mp3',
  'celebration/level-up': '/assets/sounds/celebration-levelup.mp3',
  'celebration/achievement': '/assets/sounds/celebration-achievement.mp3',
  'discussion/tell': '/assets/sounds/discussion-tell.mp3',
  'discussion/say': '/assets/sounds/discussion-tell.mp3',
  'discussion/channel': '/assets/sounds/discussion-tell.mp3',
  'alert/low-hp': '/assets/sounds/alert-low-hp.mp3',
  'alert/incoming': '/assets/sounds/alert-incoming.mp3',
  'alert/ping': '/assets/sounds/alert-ping.mp3',
  'alert/warning': '/assets/sounds/alert-warning.mp3',
  'ambient/rain': '/assets/sounds/ambient-rain.mp3',
  'ambient/fire': '/assets/sounds/ambient-fire.mp3',
  'ambient/wind': '/assets/sounds/ambient-wind.mp3',
  'ambient/combat-music': '/assets/sounds/ambient-combat-music.mp3',
  'fishing/cast': '/assets/sounds/fishing-cast.mp3',
  'fishing/splash': '/assets/sounds/fishing-splash.mp3',
  'fishing/hook': '/assets/sounds/fishing-hook.mp3',
  'fishing/reel': '/assets/sounds/fishing-reel.mp3',
  'fishing/tension': '/assets/sounds/fishing-tension.mp3',
  'fishing/catch': '/assets/sounds/fishing-catch.mp3',
  'fishing/pristine': '/assets/sounds/fishing-pristine.mp3',
  'fishing/snap': '/assets/sounds/fishing-snap.mp3',
  'fishing/slack': '/assets/sounds/fishing-slack.mp3',
  'ui/click': '/assets/sounds/ui-click.mp3',
  'ui/open': '/assets/sounds/ui-open.mp3',
  'ui/close': '/assets/sounds/ui-close.mp3',
};

function formatSoundLabel(sound) {
  return String(sound || '')
    .split('/')
    .map((part) => part.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()))
    .join(' / ');
}

export function getSoundCatalog() {
  return Object.entries(SOUND_MAP).map(([key, path]) => {
    const slashIndex = key.indexOf('/');
    const category = slashIndex === -1 ? '' : key.slice(0, slashIndex);
    const sound = slashIndex === -1 ? key : key.slice(slashIndex + 1);
    const categoryInfo = SOUND_CATEGORY_INFO[category] || { label: category };
    return {
      category,
      sound,
      label: categoryInfo.label + ' / ' + formatSoundLabel(sound),
      path,
      suppressed: SUPPRESSED_SOUND_CATEGORIES.has(category),
    };
  });
}

export function isKnownSound(category, sound) {
  return Object.prototype.hasOwnProperty.call(SOUND_MAP, category + '/' + sound);
}

function clampVolume(value, fallback = 0.7) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

class SoundManager {
  constructor() {
    this.settings = this._loadSettings();
    this.audioCache = new Map();
    this.oneShotSounds = new Set();
    this.loopingSounds = new Map();
    this.loopMetadata = new Map();
    this.pendingSounds = [];
    this.pendingLoops = [];
    this.audioUnlocked = false;
    this.isPageVisible = !document.hidden;
    this.listeners = new Set();
    this.suppressionWarnings = new Set();
    this.audioUnlockAttempts = 0;
    this.audioUnlockInFlight = false;
    this.audioUnlockWarningShown = false;
    this.lastPlayResult = null;
    this._setupAudioUnlock();
    this._setupVisibilityHandling();
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _emitChange() {
    for (const callback of this.listeners) callback(this.getSettings());
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem(SOUND_STORAGE_KEY);
      if (raw) return this._normalizeSettings(JSON.parse(raw));
    } catch (error) {
      console.warn('Failed to load sound settings', error);
    }
    return this._normalizeSettings({});
  }

  _saveSettings() {
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.warn('Failed to save sound settings', error);
    }
    this._emitChange();
  }

  _normalizeSettings(settings) {
    return {
      enabled: settings.enabled !== false,
      volume: clampVolume(settings.volume, DEFAULT_VOLUME),
      categoryEnabled: {
        ...DEFAULT_CATEGORY_ENABLED,
        ...(settings.categoryEnabled && typeof settings.categoryEnabled === 'object'
          ? settings.categoryEnabled
          : {}),
      },
    };
  }

  _setupAudioUnlock() {
    const events = ['click', 'touchstart', 'touchend', 'keydown'];
    const unlockAudio = (event) => {
      if (this.audioUnlocked) return;
      if (!event.isTrusted) return;
      this.audioUnlockAttempts += 1;
      if (this.audioUnlockAttempts >= 20 && !this.audioUnlockWarningShown) {
        this.audioUnlockWarningShown = true;
        console.warn('[SoundManager] Audio unlock has not succeeded after 20 trusted events; keeping unlock listeners active');
      }

      this.unlockFromUserGesture().then((unlocked) => {
        if (unlocked) events.forEach((name) => document.removeEventListener(name, unlockAudio, true));
      });
    };
    events.forEach((name) => document.addEventListener(name, unlockAudio, true));
  }

  unlockFromUserGesture() {
    if (this.audioUnlocked) return Promise.resolve(true);
    if (this.audioUnlockInFlight) return Promise.resolve(false);
    this.audioUnlockInFlight = true;

    const silentAudio = new Audio();
    silentAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    silentAudio.volume = 0.01;

    return silentAudio.play().then(() => {
      this.audioUnlockInFlight = false;
      this._onAudioUnlocked();
      return true;
    }).catch((error) => {
      this.audioUnlockInFlight = false;
      return this._unlockWithQueuedAudio(error);
    });
  }

  _setupVisibilityHandling() {
    document.addEventListener('visibilitychange', () => {
      this.isPageVisible = !document.hidden;
      if (!this.isPageVisible) {
        this.stopAll(false);
        this.pendingSounds = [];
      } else if (this.settings.enabled) {
        this._resumeLoops();
      }
    });
  }

  _onAudioUnlocked() {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    this._drainPendingAudio();
    this._emitChange();
  }

  _drainPendingAudio() {
    const sounds = this.pendingSounds.splice(0);
    const loops = this.pendingLoops.splice(0);
    for (const item of sounds) this.play(item.category, item.sound, item.volume);
    for (const item of loops) this.loop(item.category, item.sound, item.id, item.volume);
  }

  _unlockWithQueuedAudio(unlockError) {
    const pending = this.pendingSounds.shift();
    if (!pending) {
      return this._unlockWithFallbackAudio(unlockError);
    }

    const audio = this._getAudio(pending.category, pending.sound);
    const playback = audio.cloneNode(true);
    playback.volume = clampVolume((pending.volume === undefined ? 1 : pending.volume) * this.settings.volume, 1);

    return playback.play().then(() => {
      this.audioUnlocked = true;
      this._trackOneShot(playback, pending.category, pending.sound);
      this._drainPendingAudio();
      this._emitChange();
      return true;
    }).catch((playError) => {
      this.pendingSounds.unshift(pending);
      console.warn('[SoundManager] Audio unlock failed', {
        unlockError,
        playError,
        pending,
        settings: this.getSettings(),
      });
      return false;
    });
  }

  _unlockWithFallbackAudio(unlockError) {
    const fallbackAudio = new Audio(AUDIO_UNLOCK_FALLBACK_SOUND);
    fallbackAudio.volume = 0.001;
    return fallbackAudio.play().then(() => {
      this.audioUnlocked = true;
      this._trackOneShot(fallbackAudio, 'quest', 'accept');
      this._drainPendingAudio();
      this._emitChange();
      return true;
    }).catch((playError) => {
      if (!this.audioUnlockWarningShown) {
        this.audioUnlockWarningShown = true;
        console.warn('[SoundManager] Audio unlock failed', {
          unlockError,
          playError,
          fallback: AUDIO_UNLOCK_FALLBACK_SOUND,
          settings: this.getSettings(),
        });
      }
      return false;
    });
  }

  _isCategory(category) {
    return SOUND_CATEGORIES.includes(category);
  }

  _resolveSoundPath(category, sound) {
    const key = category + '/' + sound;
    if (SOUND_MAP[key]) return SOUND_MAP[key];
    if (sound.endsWith('.mp3')) return SOUND_ASSET_ROOT + sound;
    if (sound.includes('/')) return SOUND_ASSET_ROOT + sound + '.mp3';
    return SOUND_ASSET_ROOT + category + '-' + sound + '.mp3';
  }

  _getAudio(category, sound) {
    const key = category + '/' + sound;
    if (this.audioCache.has(key)) return this.audioCache.get(key);
    const audio = new Audio(this._resolveSoundPath(category, sound));
    audio.preload = 'auto';
    this.audioCache.set(key, audio);
    return audio;
  }

  _shouldPlay(category) {
    return this.settings.enabled && this.settings.categoryEnabled[category];
  }

  isSuppressed(category) {
    return SUPPRESSED_SOUND_CATEGORIES.has(category);
  }

  _warnSuppressed(reason, category, sound) {
    const key = reason + ':' + category + '/' + sound;
    if (this.suppressionWarnings.has(key)) return;
    this.suppressionWarnings.add(key);
    console.warn('[SoundManager] Sound suppressed: ' + reason, {
      category,
      sound,
      settings: this.getSettings(),
    });
  }

  play(category, sound, volume) {
    if (!this._isCategory(category) || !sound) {
      this._warnSuppressed('invalid sound request', category, sound);
      return;
    }
    if (this.isSuppressed(category)) return;
    if (!this.settings.enabled) {
      this._warnSuppressed('audio disabled', category, sound);
      return;
    }
    if (!this.settings.categoryEnabled[category]) {
      this._warnSuppressed('category disabled', category, sound);
      return;
    }
    if (this.settings.volume <= 0 || volume === 0) {
      this._warnSuppressed('volume is zero', category, sound);
      return;
    }
    if (!this.isPageVisible) {
      this._warnSuppressed('page hidden', category, sound);
      return;
    }
    if (!this.audioUnlocked) {
      this.pendingSounds.push({ category, sound, volume });
      this._emitChange();
      return;
    }
    const audio = this._getAudio(category, sound);
    const playback = audio.cloneNode(true);
    playback.volume = clampVolume((volume === undefined ? 1 : volume) * this.settings.volume, 1);
    this._trackOneShot(playback, category, sound);
    playback.play().then(() => {
      this.lastPlayResult = {
        ok: true,
        category,
        sound,
        src: playback.currentSrc || playback.src,
        volume: playback.volume,
        at: new Date().toISOString(),
      };
    }).catch((error) => {
      this.oneShotSounds.delete(playback);
      this.lastPlayResult = {
        ok: false,
        category,
        sound,
        src: playback.currentSrc || playback.src,
        volume: playback.volume,
        errorName: error && error.name,
        errorMessage: error && error.message,
        at: new Date().toISOString(),
      };
      if (error && error.name !== 'NotAllowedError') {
        console.warn('Failed to play sound ' + category + '/' + sound, error);
      }
    });
  }

  _trackOneShot(audio, category, sound) {
    this.oneShotSounds.add(audio);
    const cleanup = () => this.oneShotSounds.delete(audio);
    audio.addEventListener('ended', cleanup, { once: true });
    audio.addEventListener('pause', () => {
      if (audio.ended) cleanup();
    });
    audio.addEventListener('error', cleanup, { once: true });
    this.lastPlayResult = {
      ok: null,
      category,
      sound,
      src: audio.currentSrc || audio.src,
      volume: audio.volume,
      at: new Date().toISOString(),
    };
  }

  loop(category, sound, id, volume) {
    if (!this._isCategory(category) || !sound || !id) return;
    if (this.isSuppressed(category)) return;
    this.loopMetadata.set(id, { category, sound, volume });
    if (!this._shouldPlay(category) || !this.isPageVisible) return;
    if (!this.audioUnlocked) {
      this.pendingLoops = this.pendingLoops.filter((item) => item.id !== id);
      this.pendingLoops.push({ category, sound, id, volume });
      this._emitChange();
      return;
    }
    this.stopById(id, false);
    const audio = this._getAudio(category, sound);
    const playback = audio.cloneNode(true);
    playback.volume = clampVolume((volume === undefined ? 1 : volume) * this.settings.volume, 1);
    playback.loop = true;
    this.loopingSounds.set(id, playback);
    playback.play().catch((error) => {
      this.loopingSounds.delete(id);
      if (error && error.name !== 'NotAllowedError') {
        console.warn('Failed to loop sound ' + category + '/' + sound, error);
      }
    });
  }

  stopById(id, clearMetadata = true) {
    const audio = this.loopingSounds.get(id);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      this.loopingSounds.delete(id);
    }
    this.pendingLoops = this.pendingLoops.filter((item) => item.id !== id);
    if (clearMetadata) this.loopMetadata.delete(id);
  }

  stopCategory(category, clearMetadata = true) {
    for (const [id, audio] of this.loopingSounds.entries()) {
      const metadata = this.loopMetadata.get(id);
      if (metadata && metadata.category === category) {
        audio.pause();
        audio.currentTime = 0;
        this.loopingSounds.delete(id);
        if (clearMetadata) this.loopMetadata.delete(id);
      }
    }
    this.pendingLoops = this.pendingLoops.filter((item) => item.category !== category);
  }

  stop(category, id) {
    if (id) this.stopById(id);
    else this.stopCategory(category);
  }

  stopAll(clearMetadata = true) {
    for (const audio of this.loopingSounds.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
    this.loopingSounds.clear();
    this.pendingLoops = [];
    if (clearMetadata) this.loopMetadata.clear();
  }

  _resumeLoops() {
    for (const [id, metadata] of this.loopMetadata.entries()) {
      if (this.settings.categoryEnabled[metadata.category]) {
        this.loop(metadata.category, metadata.sound, id, metadata.volume);
      }
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if ((message.type === 'play' || message.type === 'loop') && this.isSuppressed(message.category)) {
      return false;
    }
    if (message.type === 'play') {
      this.play(message.category, message.sound, message.volume);
      return true;
    }
    if (message.type === 'loop') {
      this.loop(message.category, message.sound, message.id, message.volume);
      return true;
    }
    if (message.type === 'stop') {
      this.stop(message.category, message.id);
      return true;
    }
    return false;
  }

  getSettings() {
    return {
      enabled: this.settings.enabled,
      volume: this.settings.volume,
      categoryEnabled: { ...this.settings.categoryEnabled },
      audioUnlocked: this.audioUnlocked,
      pendingCount: this.pendingSounds.length + this.pendingLoops.length,
    };
  }

  isAudioUnlocked() {
    return this.audioUnlocked;
  }

  getDebugSnapshot() {
    return {
      ...this.getSettings(),
      pageVisible: this.isPageVisible,
      audioUnlockAttempts: this.audioUnlockAttempts,
      audioUnlockInFlight: this.audioUnlockInFlight,
      pendingSounds: this.pendingSounds.slice(),
      pendingLoops: this.pendingLoops.slice(),
      cachedSounds: Array.from(this.audioCache.keys()),
      activeOneShots: this.oneShotSounds.size,
      loops: Array.from(this.loopingSounds.keys()),
      lastPlayResult: this.lastPlayResult,
    };
  }

  resolveDebugPath(category, sound) {
    return this._resolveSoundPath(category, sound);
  }

  importSettings(settings) {
    this.settings = this._normalizeSettings(settings || {});
    if (!this.settings.enabled) this.stopAll(false);
    else this._resumeLoops();
    this._saveSettings();
  }

  setEnabled(enabled) {
    this.settings.enabled = !!enabled;
    if (!this.settings.enabled) this.stopAll(false);
    else this._resumeLoops();
    this._saveSettings();
  }

  toggleEnabled() {
    this.setEnabled(!this.settings.enabled);
  }

  setVolume(volume) {
    this.settings.volume = clampVolume(volume);
    for (const [id, audio] of this.loopingSounds.entries()) {
      const metadata = this.loopMetadata.get(id);
      audio.volume = clampVolume((metadata && metadata.volume !== undefined ? metadata.volume : 1) * this.settings.volume, 1);
    }
    this._saveSettings();
  }

  setCategoryEnabled(category, enabled) {
    if (!this._isCategory(category)) return;
    this.settings.categoryEnabled[category] = !!enabled;
    if (!enabled) this.stopCategory(category, false);
    else if (this.settings.enabled) this._resumeLoops();
    this._saveSettings();
  }

  toggleCategory(category) {
    this.setCategoryEnabled(category, !this.settings.categoryEnabled[category]);
  }

  resetSettings() {
    this.settings = this._normalizeSettings({});
    this.suppressionWarnings.clear();
    this._saveSettings();
  }
}

export const soundManager = new SoundManager();
