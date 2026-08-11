import { gmcp } from './gmcp.js';
import { panelManager } from './panel-manager.js';
import {
  clamp,
  expectedPlaybackPosition,
  normalizePlaylistState,
  shouldCorrectDrift,
} from './room-playlist-core.mjs';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

const PKG_STATE = 'Darkwind.Room.Playlist.State';
const PKG_OPEN = 'Darkwind.Room.Playlist.Open';
const PKG_ACTION = 'Darkwind.Room.Playlist.Action';
const PKG_REPORT = 'Darkwind.Room.Playlist.Report';
const SETTINGS_KEY = 'darkwind-room-playlist-settings';
const DRIFT_INTERVAL_MS = 5000;

let youtubeApiPromise = null;

function loadYouTubeApi() {
  if (window.YT && typeof window.YT.Player === 'function') return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function() {
      if (typeof previousReady === 'function') previousReady();
      if (window.YT && typeof window.YT.Player === 'function') resolve(window.YT);
      else reject(new Error('YouTube player API did not initialize'));
    };

    let script = document.querySelector('script[data-darkflow-youtube-api]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.darkflowYoutubeApi = '1';
      script.onerror = () => reject(new Error('Unable to load the YouTube player API'));
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      autoJoin: !!saved.autoJoin,
      volume: clamp(saved.volume === undefined ? 70 : saved.volume, 0, 100),
    };
  } catch (error) {
    return { autoJoin: false, volume: 70 };
  }
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export const roomPlaylistManager = {
  state: normalizePlaylistState(null),
  settings: readSettings(),
  listening: false,
  player: null,
  playerReady: false,
  bodyEl: null,
  els: null,
  serverClockOffset: 0,
  scheduledStartTimer: null,
  driftTimer: null,
  appliedEntryKey: '',
  readyReportKey: '',
  initialized: false,
  playerGeneration: 0,
  statusMessage: '',

  init() {
    return installControllerLifecycle(this, 'room-playlist', gmcp, (scopedGmcp, lifecycle) => {
      this.initialized = true;
      scopedGmcp.on(PKG_STATE, (data) => this.receiveState(data));
      scopedGmcp.on(PKG_OPEN, (data) => this.receiveOpen(data));
      scopedGmcp.on('Room.Info', (data) => this.handleRoomInfo(data));
      lifecycle.listen(document, 'dw:connectionstate', (event) => {
        if (!event.detail || event.detail.state !== 'connected') this.stopPlayback();
      });
      const closeHandler = () => {
        this.leave({ persist: true });
        return true;
      };
      panelManager.registerPanelCloseHandler('roomPlaylist', closeHandler);
      lifecycle.own('teardown', () => {
        panelManager.unregisterPanelCloseHandler('roomPlaylist', closeHandler);
      });
    }, () => {
      this.stopPlayback();
      this.playerGeneration += 1;
      this.initialized = false;
    });
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (error) { /* storage may be unavailable */ }
  },

  serverNow() {
    return Date.now() / 1000 - this.serverClockOffset;
  },

  receiveState(data) {
    const receivedAt = Date.now() / 1000;
    const next = normalizePlaylistState(data);
    if (next.server_time > 0) this.serverClockOffset = receivedAt - next.server_time;

    const priorRoomId = this.state.room_id;
    this.state = next;
    if (!next.enabled) {
      this.stopPlayback();
      this.bodyEl = null;
      this.els = null;
    } else if (priorRoomId !== next.room_id) {
      this.appliedEntryKey = '';
      this.readyReportKey = '';
    }

    document.dispatchEvent(new CustomEvent('darkflow:room-playlist-state', {
      detail: next,
    }));

    if (next.enabled && this.settings.autoJoin && !this.listening) {
      this.join({ trustedGesture: false });
    } else if (this.listening) {
      this.applyAuthoritativeState();
    }
    this.render();
  },

  receiveOpen(data) {
    this.receiveState(data);
    if (!this.state.enabled) return;
    document.dispatchEvent(new CustomEvent('darkflow:room-playlist-open', {
      detail: this.state,
    }));
  },

  handleRoomInfo(data) {
    if (!this.state.enabled || !data || data.num === undefined) return;
    if (String(data.num) === String(this.state.room_id)) return;
    this.stopPlayback();
    this.statusMessage = 'You left the jukebox room.';
    this.render();
  },

  attachPanel(bodyEl, data) {
    if (data) this.state = normalizePlaylistState(data);
    if (!bodyEl) return;

    const needsMount = this.bodyEl !== bodyEl || !bodyEl.dataset.roomPlaylistMounted;
    this.bodyEl = bodyEl;
    if (needsMount) this.mount();
    this.render();
    if (this.listening) this.ensurePlayer().then(() => this.applyAuthoritativeState()).catch(() => {});
  },

  mount() {
    if (!this.bodyEl) return;
    this.playerGeneration += 1;
    this.player = null;
    this.playerReady = false;
    this.appliedEntryKey = '';
    this.bodyEl.dataset.roomPlaylistMounted = '1';
    this.bodyEl.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'room-playlist';
    const offline = document.createElement('div');
    offline.className = 'room-playlist-offline';
    offline.textContent = 'There is no shared jukebox in this room.';
    const playerWrap = document.createElement('div');
    playerWrap.className = 'room-playlist-player';
    const playerHost = document.createElement('div');
    playerHost.id = `room-playlist-player-${this.playerGeneration}`;
    const gate = document.createElement('div');
    gate.className = 'room-playlist-gate';
    const gateTitle = document.createElement('div');
    gateTitle.className = 'room-playlist-title';
    gateTitle.textContent = 'Shared Jukebox';
    const gateText = document.createElement('div');
    gateText.className = 'room-playlist-subtitle';
    const joinButton = document.createElement('button');
    joinButton.type = 'button';
    joinButton.className = 'room-playlist-button';
    joinButton.textContent = 'Listen in sync';
    gate.append(gateTitle, gateText, joinButton);
    playerWrap.append(playerHost, gate);

    const now = document.createElement('div');
    now.className = 'room-playlist-now';
    const nowTitle = document.createElement('div');
    nowTitle.className = 'room-playlist-now-title';
    const nowMeta = document.createElement('div');
    nowMeta.className = 'room-playlist-now-meta';
    now.append(nowTitle, nowMeta);

    const controls = document.createElement('div');
    controls.className = 'room-playlist-controls';
    const leaveButton = document.createElement('button');
    leaveButton.type = 'button';
    leaveButton.className = 'room-playlist-button';
    leaveButton.textContent = 'Stop listening';
    const skipButton = document.createElement('button');
    skipButton.type = 'button';
    skipButton.className = 'room-playlist-button';
    skipButton.textContent = 'Vote to skip';
    const modPause = document.createElement('button');
    modPause.type = 'button';
    modPause.className = 'room-playlist-button';
    const modSkip = document.createElement('button');
    modSkip.type = 'button';
    modSkip.className = 'room-playlist-button';
    modSkip.textContent = 'Skip now';
    const volumeLabel = document.createElement('label');
    volumeLabel.className = 'room-playlist-volume';
    volumeLabel.append('Volume ');
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.value = String(this.settings.volume);
    volumeLabel.appendChild(volume);
    controls.append(leaveButton, skipButton, modPause, modSkip, volumeLabel);

    const status = document.createElement('div');
    status.className = 'room-playlist-status';
    status.setAttribute('aria-live', 'polite');

    const addForm = document.createElement('form');
    addForm.className = 'room-playlist-add';
    const addInput = document.createElement('input');
    addInput.type = 'url';
    addInput.placeholder = 'Paste a YouTube URL';
    addInput.setAttribute('aria-label', 'YouTube video URL');
    const addButton = document.createElement('button');
    addButton.type = 'submit';
    addButton.textContent = 'Add';
    addForm.append(addInput, addButton);

    const queue = document.createElement('div');
    queue.className = 'room-playlist-queue';
    const queueHeading = document.createElement('div');
    queueHeading.className = 'room-playlist-queue-heading';
    queueHeading.textContent = 'Up next';
    const queueItems = document.createElement('div');
    queue.append(queueHeading, queueItems);

    root.append(offline, playerWrap, now, controls, status, addForm, queue);
    this.bodyEl.appendChild(root);
    this.els = {
      root, offline, playerWrap, playerHost, gate, gateTitle, gateText, joinButton,
      nowTitle, nowMeta, leaveButton, skipButton, modPause, modSkip,
      volume, status, addForm, addInput, addButton, queueItems,
    };

    joinButton.addEventListener('click', () => this.join({ trustedGesture: true }));
    leaveButton.addEventListener('click', () => this.leave({ persist: true }));
    skipButton.addEventListener('click', () => this.sendAction('vote_skip'));
    modPause.addEventListener('click', () => {
      const statusName = this.state.playback ? this.state.playback.status : 'stopped';
      this.sendAction(statusName === 'playing' ? 'pause' : 'resume');
    });
    modSkip.addEventListener('click', () => this.sendAction('skip'));
    volume.addEventListener('input', () => {
      this.settings.volume = clamp(volume.value, 0, 100);
      this.saveSettings();
      if (this.playerReady && this.player) this.player.setVolume(this.settings.volume);
    });
    addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const url = addInput.value.trim();
      if (!url) return;
      if (this.sendAction('add', { url })) addInput.value = '';
    });
    queueItems.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const number = Number(button.dataset.number);
      const action = button.dataset.action;
      if (action === 'remove') this.sendAction('remove', { number });
      if (action === 'up' && number > 1) this.sendAction('move', { from: number, to: number - 1 });
      if (action === 'down') this.sendAction('move', { from: number, to: number + 1 });
    });
  },

  join({ trustedGesture = false } = {}) {
    if (!this.state.enabled) return;
    this.listening = true;
    this.settings.autoJoin = true;
    this.saveSettings();
    this.statusMessage = trustedGesture ? 'Joining the shared playback…' : 'Restoring shared playback…';
    this.render();
    this.ensurePlayer()
      .then(() => {
        this.statusMessage = '';
        this.applyAuthoritativeState();
      })
      .catch(() => {
        this.listening = false;
        this.settings.autoJoin = false;
        this.saveSettings();
        this.statusMessage = 'Playback could not start. Select Listen in sync to try again.';
        this.render();
      });
  },

  leave({ persist = true } = {}) {
    this.listening = false;
    if (persist) {
      this.settings.autoJoin = false;
      this.saveSettings();
    }
    this.stopPlayback();
    this.statusMessage = 'Playback stopped.';
    this.render();
  },

  stopPlayback() {
    this.clearScheduledStart();
    this.stopDriftTimer();
    if (this.player && this.playerReady && typeof this.player.stopVideo === 'function') {
      try { this.player.stopVideo(); } catch (error) { /* stale iframe */ }
    }
    this.listening = false;
    this.appliedEntryKey = '';
  },

  ensurePlayer() {
    if (!this.els || !this.els.playerHost) return Promise.reject(new Error('Jukebox panel is unavailable'));
    if (this.player && this.playerReady) return Promise.resolve(this.player);
    const generation = this.playerGeneration;
    return loadYouTubeApi().then((YT) => new Promise((resolve, reject) => {
      if (generation !== this.playerGeneration || !this.els || !this.els.playerHost) {
        reject(new Error('Jukebox panel changed'));
        return;
      }
      if (this.player) {
        if (this.playerReady) resolve(this.player);
        else reject(new Error('YouTube player is still initializing'));
        return;
      }
      this.player = new YT.Player(this.els.playerHost.id, {
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          controls: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            if (generation !== this.playerGeneration) return;
            this.playerReady = true;
            event.target.setVolume(this.settings.volume);
            resolve(event.target);
          },
          onStateChange: (event) => this.handlePlayerState(event),
          onError: (event) => this.handlePlayerError(event),
          onAutoplayBlocked: () => this.handleAutoplayBlocked(),
        },
      });
    }));
  },

  clearScheduledStart() {
    if (this.scheduledStartTimer) clearTimeout(this.scheduledStartTimer);
    this.scheduledStartTimer = null;
  },

  applyAuthoritativeState() {
    if (!this.listening || !this.playerReady || !this.player || !this.state.enabled) return;
    const playback = this.state.playback;
    const current = playback && playback.current;
    this.clearScheduledStart();
    if (!current) {
      this.player.stopVideo();
      this.appliedEntryKey = '';
      this.stopDriftTimer();
      this.render();
      return;
    }

    const entryKey = `${this.state.room_id}:${current.id}`;
    const expected = expectedPlaybackPosition(this.state, this.serverNow());
    const isNewEntry = this.appliedEntryKey !== entryKey;
    this.appliedEntryKey = entryKey;

    if (playback.status === 'playing') {
      const startAt = Number(playback.start_at) || 0;
      const delayMs = Math.max(0, (startAt - this.serverNow()) * 1000);
      if (isNewEntry || delayMs > 50) {
        this.player.cueVideoById({ videoId: current.video_id, startSeconds: expected });
      } else if (shouldCorrectDrift(this.player.getCurrentTime(), expected)) {
        this.player.seekTo(expected, true);
      }
      if (delayMs > 50) {
        this.scheduledStartTimer = setTimeout(() => {
          if (!this.listening || this.appliedEntryKey !== entryKey) return;
          const startPosition = expectedPlaybackPosition(this.state, this.serverNow());
          this.player.seekTo(startPosition, true);
          this.player.playVideo();
        }, delayMs);
      } else {
        this.player.playVideo();
      }
      this.startDriftTimer();
    } else {
      if (isNewEntry) this.player.cueVideoById({ videoId: current.video_id, startSeconds: expected });
      else if (shouldCorrectDrift(this.player.getCurrentTime(), expected)) this.player.seekTo(expected, true);
      this.player.pauseVideo();
      this.stopDriftTimer();
    }
    this.render();
  },

  startDriftTimer() {
    if (this.driftTimer) return;
    this.driftTimer = setInterval(() => this.reconcileDrift(), DRIFT_INTERVAL_MS);
  },

  stopDriftTimer() {
    if (this.driftTimer) clearInterval(this.driftTimer);
    this.driftTimer = null;
  },

  reconcileDrift() {
    if (!this.listening || !this.playerReady || !this.state.enabled ||
        !this.state.playback || this.state.playback.status !== 'playing') return;
    const expected = expectedPlaybackPosition(this.state, this.serverNow());
    const actual = this.player.getCurrentTime();
    if (shouldCorrectDrift(actual, expected)) this.player.seekTo(expected, true);
    const playerState = this.player.getPlayerState();
    if (window.YT && playerState !== window.YT.PlayerState.PLAYING &&
        this.serverNow() >= this.state.playback.start_at) {
      this.player.playVideo();
    }
    this.render();
  },

  handlePlayerState(event) {
    if (!window.YT || !this.state.enabled || !this.state.playback || !this.state.playback.current) return;
    if (event.data === window.YT.PlayerState.PLAYING) {
      if (this.state.playback.status !== 'playing') {
        this.player.pauseVideo();
        return;
      }
      this.reportReady();
      this.startDriftTimer();
    } else if (event.data === window.YT.PlayerState.ENDED) {
      this.sendReport('ended');
    }
  },

  reportReady() {
    const current = this.state.playback && this.state.playback.current;
    if (!current || !this.playerReady) return;
    const key = `${this.state.room_id}:${current.id}:${this.state.revision}`;
    if (this.readyReportKey === key) return;
    const videoData = this.player.getVideoData ? this.player.getVideoData() : {};
    const sent = this.sendReport('ready', {
      title: videoData && videoData.title ? videoData.title : current.title,
      duration: Math.round(this.player.getDuration ? this.player.getDuration() : 0),
    });
    if (sent) this.readyReportKey = key;
  },

  handlePlayerError(event) {
    this.statusMessage = `This video could not play (YouTube error ${event.data}).`;
    this.sendReport('error', { code: Number(event.data) || 0 });
    this.render();
  },

  handleAutoplayBlocked() {
    this.listening = false;
    this.settings.autoJoin = false;
    this.saveSettings();
    this.stopDriftTimer();
    this.statusMessage = 'Your browser blocked autoplay. Select Listen in sync to begin.';
    this.render();
  },

  sendAction(action, extra = {}) {
    if (!this.state.enabled) return false;
    return gmcp.send(PKG_ACTION, {
      room_id: this.state.room_id,
      revision: this.state.revision,
      action,
      ...extra,
    });
  },

  sendReport(report, extra = {}) {
    const current = this.state.playback && this.state.playback.current;
    if (!this.state.enabled || !current) return false;
    return gmcp.send(PKG_REPORT, {
      room_id: this.state.room_id,
      revision: this.state.revision,
      entry_id: current.id,
      report,
      ...extra,
    });
  },

  render() {
    if (!this.els || !this.bodyEl) return;
    const state = this.state;
    if (!state.enabled) {
      this.els.root.classList.add('room-playlist-disabled');
      this.els.offline.hidden = false;
      return;
    }
    this.els.root.classList.remove('room-playlist-disabled');
    this.els.offline.hidden = true;
    const playback = state.playback;
    const current = playback.current;
    const expected = expectedPlaybackPosition(state, this.serverNow());
    this.els.gate.hidden = this.listening;
    this.els.gateTitle.textContent = state.name;
    this.els.gateText.textContent = current
      ? `Join everyone listening to “${current.title}” at the shared playhead.`
      : 'The queue is empty. Add a YouTube video to get things started.';
    this.els.joinButton.disabled = !current;
    this.els.leaveButton.hidden = !this.listening;
    this.els.skipButton.disabled = !current;
    this.els.skipButton.textContent = `Vote to skip (${state.skip_votes}/${state.skip_needed})`;
    this.els.nowTitle.textContent = current ? current.title : 'Nothing playing';
    this.els.nowMeta.textContent = current
      ? `${formatTime(expected)}${current.duration ? ` / ${formatTime(current.duration)}` : ''} · added by ${current.added_by}`
      : 'Add a video below to begin the shared playlist.';
    this.els.status.textContent = this.statusMessage || (this.listening
      ? 'Listening at the room’s synchronized playhead.'
      : 'Playback is opt-in. The queue remains shared for everyone here.');
    this.els.addForm.hidden = !(state.permissions && state.permissions.add);
    const moderator = !!(state.permissions && state.permissions.moderate);
    this.els.modPause.hidden = !moderator;
    this.els.modSkip.hidden = !moderator;
    this.els.modPause.textContent = playback.status === 'playing' ? 'Pause all' : 'Resume all';
    this.els.modPause.disabled = !current;
    this.els.modSkip.disabled = !current;

    this.els.queueItems.textContent = '';
    if (!state.queue.length) {
      const empty = document.createElement('div');
      empty.className = 'room-playlist-empty';
      empty.textContent = 'No videos are waiting.';
      this.els.queueItems.appendChild(empty);
      return;
    }
    state.queue.forEach((entry, index) => {
      const number = index + 1;
      const row = document.createElement('div');
      row.className = 'room-playlist-queue-item';
      const indexEl = document.createElement('div');
      indexEl.className = 'room-playlist-queue-index';
      indexEl.textContent = String(number);
      const copy = document.createElement('div');
      copy.className = 'room-playlist-queue-copy';
      const title = document.createElement('div');
      title.className = 'room-playlist-queue-title';
      title.textContent = entry.title;
      title.title = entry.title;
      const meta = document.createElement('div');
      meta.className = 'room-playlist-queue-meta';
      meta.textContent = `added by ${entry.added_by}`;
      copy.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'room-playlist-queue-actions';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'room-playlist-button';
      remove.dataset.action = 'remove';
      remove.dataset.number = String(number);
      remove.textContent = 'Remove';
      remove.hidden = !entry.can_remove;
      actions.appendChild(remove);
      if (moderator) {
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'room-playlist-button';
        up.dataset.action = 'up';
        up.dataset.number = String(number);
        up.textContent = '↑';
        up.disabled = number === 1;
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'room-playlist-button';
        down.dataset.action = 'down';
        down.dataset.number = String(number);
        down.textContent = '↓';
        down.disabled = number === state.queue.length;
        actions.append(up, down);
      }
      row.append(indexEl, copy, actions);
      this.els.queueItems.appendChild(row);
    });
  },
};
