import { gmcp } from './gmcp.js';
import { dom } from './state.js';
import { flashOutputLine, isOutputLineAvailable, onOutputLine, scrollToOutputLine } from './output.js';
import { messageMentionsPlayer, normalizeMentionText } from './notification-utils.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

const MAX_NOTIFICATIONS = 100;
const RECENT_LINE_LIMIT = 250;
const LINE_MATCH_WINDOW_MS = 10000;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function displayTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_error) {
    return '';
  }
}

function cleanSnippet(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function channelLabel(entry) {
  return entry.channel ? '[' + entry.channel + ']' : '[Channel]';
}

function notificationKey(entry) {
  return [
    cleanSnippet(entry.channel || '').toLowerCase(),
    cleanSnippet(entry.talker || '').toLowerCase(),
    normalizeMentionText(entry.text || ''),
  ].join('\n');
}

export const notificationManager = {
  state: {
    playerName: '',
    notifications: [],
    pendingMentions: [],
    recentLines: [],
    nextId: 1,
    open: false,
  },

  els: {
    wrap: null,
    badge: null,
    menu: null,
    list: null,
  },

  init() {
    return installControllerLifecycle(this, 'notifications', gmcp, (scopedGmcp, lifecycle) => {
      this.mount();
      this.bindButton();
      lifecycle.own('subscription', onOutputLine((line) => this.recordOutputLine(line)));
      scopedGmcp.on('Char.Status', (data) => this.handleStatus(data));
      scopedGmcp.on('Comm.Channel', (data) => this.handleChannelText(data));
      scopedGmcp.on('Comm.Channel.Text', (data) => this.handleChannelText(data));
      this.render();
    }, () => this.resetSession());
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  mount() {
    if (this.els.wrap || !dom.notificationsBtn) return;

    dom.notificationsBtn.title = 'Notifications';
    dom.notificationsBtn.classList.remove('disabled');

    const buttonWrap = document.createElement('span');
    buttonWrap.className = 'toolbar-btn-wrap notification-toolbar-wrap';
    dom.notificationsBtn.parentNode.insertBefore(buttonWrap, dom.notificationsBtn);
    buttonWrap.appendChild(dom.notificationsBtn);

    const badge = document.createElement('span');
    badge.className = 'toolbar-count-badge';
    badge.style.display = 'none';
    buttonWrap.appendChild(badge);

    const menu = document.createElement('div');
    menu.className = 'notifications-menu';

    const header = document.createElement('div');
    header.className = 'notifications-header';

    const title = document.createElement('div');
    title.className = 'notifications-title';
    title.textContent = 'Notifications';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'notifications-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.clearAll();
    });

    header.appendChild(title);
    header.appendChild(clearBtn);

    const list = document.createElement('div');
    list.className = 'notifications-list';

    menu.appendChild(header);
    menu.appendChild(list);
    buttonWrap.appendChild(menu);

    this._controllerLifecycle.listen(document, 'click', (event) => {
      if (!this.els.wrap || this.els.wrap.contains(event.target)) return;
      this.close();
    });

    this._controllerLifecycle.listen(document, 'keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });

    this.els = {
      wrap: buttonWrap,
      badge,
      menu,
      list,
    };
  },

  bindButton() {
    if (!dom.notificationsBtn) return;
    this._controllerLifecycle.listen(dom.notificationsBtn, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    });
  },

  handleStatus(data) {
    const nextName = data && typeof data.name === 'string' ? data.name.trim() : '';
    if (!nextName || nextName === this.state.playerName) return;

    this.state.playerName = nextName;
    this.state.notifications = [];
    this.state.pendingMentions = [];
    this.state.recentLines = [];
    this.state.nextId = 1;
    this.render();
  },

  handleChannelText(data) {
    const payload = data && typeof data === 'object'
      ? data
      : { text: String(data || '') };
    const text = cleanSnippet(payload.text || '');

    if (!messageMentionsPlayer(text, this.state.playerName)) return;

    const notification = {
      id: this.state.nextId++,
      type: 'mention',
      channel: cleanSnippet(payload.channel || ''),
      talker: cleanSnippet(payload.talker || ''),
      text,
      normalizedText: normalizeMentionText(text),
      timestamp: Date.now(),
      read: false,
      lineId: null,
      expired: false,
    };

    const key = notificationKey(notification);
    const now = notification.timestamp;
    const duplicate = this.state.notifications.concat(this.state.pendingMentions)
      .some(entry => notificationKey(entry) === key &&
        (now - (entry.timestamp || 0)) <= LINE_MATCH_WINDOW_MS);
    if (duplicate) return;

    if (this.bindNotificationToLine(notification)) {
      this.addNotification(notification);
      return;
    }

    this.state.pendingMentions.push(notification);
    this.prunePendingMentions();
  },

  recordOutputLine(line) {
    if (!line || !line.id) return;
    const text = cleanSnippet(line.text || '');
    if (!text) return;

    const normalized = normalizeMentionText(text);
    const existing = this.state.recentLines.find(entry => entry.id === line.id);
    if (existing) {
      existing.text = text;
      existing.normalized = normalized;
      existing.timestamp = Date.now();
    } else {
      this.state.recentLines.push({
        id: line.id,
        text,
        normalized,
        timestamp: Date.now(),
      });
      if (this.state.recentLines.length > RECENT_LINE_LIMIT) {
        this.state.recentLines.splice(0, this.state.recentLines.length - RECENT_LINE_LIMIT);
      }
    }

    this.promotePendingMentions();
    for (const notification of this.state.notifications) {
      if (!notification.lineId && this.bindNotificationToLine(notification)) {
        this.flashNotificationLine(notification);
      }
    }
  },

  addNotification(notification) {
    this.flashNotificationLine(notification);
    this.state.notifications.unshift(notification);
    if (this.state.notifications.length > MAX_NOTIFICATIONS) {
      this.state.notifications.length = MAX_NOTIFICATIONS;
    }
    this.render();
  },

  prunePendingMentions() {
    const now = Date.now();
    this.state.pendingMentions = this.state.pendingMentions
      .filter(notification => (now - notification.timestamp) <= LINE_MATCH_WINDOW_MS);
  },

  promotePendingMentions() {
    const remaining = [];

    this.prunePendingMentions();
    for (const notification of this.state.pendingMentions) {
      if (this.bindNotificationToLine(notification)) {
        this.addNotification(notification);
      } else {
        remaining.push(notification);
      }
    }
    this.state.pendingMentions = remaining;
  },

  flashNotificationLine(notification) {
    if (!notification || notification.flashed || !notification.lineId) return;
    if (flashOutputLine(notification.lineId)) notification.flashed = true;
  },

  bindNotificationToLine(notification) {
    if (!notification || !notification.normalizedText) return false;

    const now = Date.now();
    const candidates = this.state.recentLines
      .filter(line => (now - line.timestamp) <= LINE_MATCH_WINDOW_MS)
      .filter(line =>
        line.normalized.includes(notification.normalizedText) ||
        notification.normalizedText.includes(line.normalized)
      );

    if (!candidates.length) return false;
    const match = candidates[candidates.length - 1];
    notification.lineId = match.id;
    notification.expired = false;
    return true;
  },

  unreadCount() {
    return this.state.notifications.filter(item => !item.read).length;
  },

  toggle() {
    if (this.state.open) this.close();
    else this.open();
  },

  open() {
    this.state.open = true;
    this.render();
  },

  close() {
    this.state.open = false;
    this.render();
  },

  clearAll() {
    this.state.notifications = [];
    this.render();
  },

  resetSession() {
    this.state.playerName = '';
    this.state.notifications = [];
    this.state.pendingMentions = [];
    this.state.recentLines = [];
    this.state.nextId = 1;
    this.state.open = false;
    this.render();
  },

  selectNotification(id) {
    const item = this.state.notifications.find(entry => entry.id === id);
    if (!item) return;

    item.read = true;
    if (item.lineId && isOutputLineAvailable(item.lineId) && scrollToOutputLine(item.lineId)) {
      item.expired = false;
      this.close();
    } else {
      item.expired = true;
      this.render();
    }
  },

  render() {
    this.renderBadge();
    this.renderMenu();
  },

  renderBadge() {
    if (!dom.notificationsBtn || !this.els.badge) return;
    const count = this.unreadCount();
    dom.notificationsBtn.classList.toggle('has-alert', count > 0);
    this.els.badge.style.display = count > 0 ? 'block' : 'none';
    this.els.badge.textContent = count > 99 ? '99+' : String(count);
  },

  renderMenu() {
    const toolbar = this.els.wrap && this.els.wrap.closest('#toolbar');
    if (toolbar) toolbar.classList.toggle('notifications-menu-active', this.state.open);
    if (!this.els.menu || !this.els.list) return;

    this.els.menu.classList.toggle('open', this.state.open);
    if (!this.state.open) return;

    if (!this.state.notifications.length) {
      this.els.list.innerHTML = '<div class="notifications-empty">No notifications.</div>';
      return;
    }

    this.els.list.textContent = '';
    for (const item of this.state.notifications) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'notification-row' + (item.read ? '' : ' unread') + (item.expired ? ' expired' : '');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectNotification(item.id);
      });

      const meta = document.createElement('div');
      meta.className = 'notification-meta';
      meta.innerHTML = '<span>' + escapeHtml(channelLabel(item)) + '</span>'
        + (item.talker ? '<span>' + escapeHtml(item.talker) + '</span>' : '')
        + '<span>' + escapeHtml(displayTime(item.timestamp)) + '</span>';

      const body = document.createElement('div');
      body.className = 'notification-body';
      body.textContent = item.text;

      button.appendChild(meta);
      button.appendChild(body);

      if (item.expired) {
        const expired = document.createElement('div');
        expired.className = 'notification-expired';
        expired.textContent = 'Terminal line no longer in scrollback.';
        button.appendChild(expired);
      }

      this.els.list.appendChild(button);
    }
  },
};
