import { gmcp } from './gmcp.js';
import { dom } from './state.js';
import { renderAnnouncementMarkdown } from './announcement-markdown.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

const PKG_LIST = 'Darkwind.Announcements.List';
const PKG_NEW = 'Darkwind.Announcements.New';
const PKG_UPDATE = 'Darkwind.Announcements.Update';
const PKG_STATE = 'Darkwind.Announcements.State';
const PKG_MARK_READ = 'Darkwind.Announcements.MarkRead';

function formatTimestamp(epochSeconds) {
  if (!epochSeconds) return '';
  try {
    return new Date(epochSeconds * 1000).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch (_error) {
    return String(epochSeconds);
  }
}

function cloneItems(items) {
  return Array.isArray(items) ? items.map(item => ({ ...item })) : [];
}

function upsertItem(items, item) {
  if (!Array.isArray(items)) return item ? [{ ...item }] : [];
  if (!item || typeof item.id !== 'number') return items.map(entry => ({ ...entry }));
  const next = [];
  let found = false;
  for (const entry of items) {
    if (!entry || typeof entry.id !== 'number') continue;
    if (entry.id === item.id) {
      next.push({ ...item });
      found = true;
    } else {
      next.push({ ...entry });
    }
  }
  if (!found) next.unshift({ ...item });
  return next;
}

function removeItem(items, id) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item && item.id !== id)
    .map(item => ({ ...item }));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const announcementsManager = {
  state: {
    active: [],
    archived: [],
    unreadCount: 0,
    selectedId: null,
    filter: 'active',
    pendingReadIds: new Set(),
  },

  els: {
    overlay: null,
    listPane: null,
    detailPane: null,
    badge: null,
    subtitle: null,
    activeBtn: null,
    archivedBtn: null,
  },

  init() {
    return installControllerLifecycle(this, 'announcements', gmcp, (scopedGmcp) => {
      this.mount();
      this.bindButton();
      scopedGmcp.on(PKG_LIST, (data) => this.handleList(data));
      scopedGmcp.on(PKG_NEW, (data) => this.handleNew(data));
      scopedGmcp.on(PKG_UPDATE, (data) => this.handleUpdate(data));
      scopedGmcp.on(PKG_STATE, (data) => this.handleState(data));
      this.render();
    }, () => this.close());
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  mount() {
    if (this.els.overlay || !dom.announcementsBtn) return;

    dom.announcementsBtn.title = 'Announcements';
    dom.announcementsBtn.classList.remove('disabled');

    const buttonWrap = document.createElement('span');
    buttonWrap.className = 'toolbar-btn-wrap';
    dom.announcementsBtn.parentNode.insertBefore(buttonWrap, dom.announcementsBtn);
    buttonWrap.appendChild(dom.announcementsBtn);

    const badge = document.createElement('span');
    badge.className = 'toolbar-count-badge';
    badge.style.display = 'none';
    buttonWrap.appendChild(badge);

    const overlay = document.createElement('div');
    overlay.className = 'announcements-overlay';

    const modal = document.createElement('div');
    modal.className = 'announcements-modal';

    const header = document.createElement('div');
    header.className = 'announcements-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'announcements-title-wrap';

    const title = document.createElement('div');
    title.className = 'announcements-title';
    title.textContent = 'Announcements';

    const subtitle = document.createElement('div');
    subtitle.className = 'announcements-subtitle';

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const controls = document.createElement('div');
    controls.className = 'announcements-controls';

    const filter = document.createElement('div');
    filter.className = 'announcements-filter';

    const activeBtn = document.createElement('button');
    activeBtn.className = 'announcements-filter-btn active';
    activeBtn.type = 'button';
    activeBtn.textContent = 'Active';
    activeBtn.addEventListener('click', () => this.setFilter('active'));

    const archivedBtn = document.createElement('button');
    archivedBtn.className = 'announcements-filter-btn';
    archivedBtn.type = 'button';
    archivedBtn.textContent = 'Archived';
    archivedBtn.addEventListener('click', () => this.setFilter('archived'));

    filter.appendChild(activeBtn);
    filter.appendChild(archivedBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'announcements-close';
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', () => this.close());

    controls.appendChild(filter);
    controls.appendChild(closeBtn);

    header.appendChild(titleWrap);
    header.appendChild(controls);

    const body = document.createElement('div');
    body.className = 'announcements-body';

    const listPane = document.createElement('div');
    listPane.className = 'announcements-list-pane';

    const detailPane = document.createElement('div');
    detailPane.className = 'announcements-detail-pane';

    body.appendChild(listPane);
    body.appendChild(detailPane);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.close();
    });

    this._controllerLifecycle.listen(document, 'keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('open')) {
        this.close();
      }
    });

    this.els = {
      overlay,
      listPane,
      detailPane,
      badge,
      subtitle,
      activeBtn,
      archivedBtn,
    };
  },

  bindButton() {
    if (!dom.announcementsBtn) return;
    this._controllerLifecycle.listen(dom.announcementsBtn, 'click', () => this.open());
  },

  currentItems() {
    return this.state.filter === 'archived'
      ? this.state.archived
      : this.state.active;
  },

  applyPendingReads() {
    if (!this.state.pendingReadIds.size) return;

    const applyTo = (item) => {
      if (item && this.state.pendingReadIds.has(item.id)) {
        item.isRead = true;
      }
    };

    this.state.active.forEach(applyTo);
    this.state.archived.forEach(applyTo);
    this.state.unreadCount = this.state.active.filter(item => item && !item.isRead).length;
  },

  setFilter(filter) {
    this.state.filter = filter === 'archived' ? 'archived' : 'active';
    this.ensureSelection();
    this.render();
  },

  ensureSelection() {
    const items = this.currentItems();
    if (!items.length) {
      this.state.selectedId = null;
      return;
    }

    if (!items.some(item => item.id === this.state.selectedId)) {
      this.state.selectedId = items[0].id;
    }
  },

  selectedItem() {
    return this.currentItems().find(item => item.id === this.state.selectedId) || null;
  },

  open() {
    if (!this.els.overlay) return;
    gmcp.sendSubscriptions({
      reason: 'modal-open',
      full: false,
      features: { announcementsList: true },
    });
    this.ensureSelection();
    this.els.overlay.classList.add('open');
    this.render();
  },

  close() {
    if (!this.els.overlay) return;
    this.els.overlay.classList.remove('open');
  },

  handleList(data) {
    this.state.active = cloneItems(data && data.active);
    this.state.archived = cloneItems(data && data.archived);
    this.state.unreadCount = Number(data && data.unreadCount) || 0;
    this.applyPendingReads();
    this.ensureSelection();
    this.render();
  },

  handleNew(data) {
    if (data && data.item) {
      this.state.active = upsertItem(this.state.active, data.item);
      this.state.archived = removeItem(this.state.archived, data.item.id);
    }

    if (data && data.unreadCount !== undefined) {
      this.state.unreadCount = Number(data.unreadCount) || 0;
    } else {
      this.state.unreadCount += 1;
    }

    this.ensureSelection();
    this.render();
  },

  handleUpdate(data) {
    const item = data && data.item;
    const bucket = data && data.bucket;
    if (!item || typeof item.id !== 'number') {
      if (data && data.unreadCount !== undefined) {
        this.state.unreadCount = Number(data.unreadCount) || 0;
        this.renderBadge();
      }
      return;
    }

    if (bucket === 'archived') {
      this.state.archived = upsertItem(this.state.archived, item);
      this.state.active = removeItem(this.state.active, item.id);
    } else {
      this.state.active = upsertItem(this.state.active, item);
      this.state.archived = removeItem(this.state.archived, item.id);
    }

    if (data && data.unreadCount !== undefined) {
      this.state.unreadCount = Number(data.unreadCount) || 0;
    }
    if (item.isRead) {
      this.state.pendingReadIds.delete(item.id);
    }
    this.applyPendingReads();

    this.ensureSelection();
    this.render();
  },

  handleState(data) {
    this.state.unreadCount = Number(data && data.unreadCount) || 0;
    this.renderBadge();
  },

  selectAnnouncement(id) {
    this.state.selectedId = id;
    this.markSelectedRead();
    this.render();
  },

  markSelectedRead() {
    const item = this.selectedItem();
    if (!item || item.isRead) return;

    item.isRead = true;
    this.state.pendingReadIds.add(item.id);
    if (item.status !== 'archived' && this.state.unreadCount > 0) {
      this.state.unreadCount -= 1;
    }
    gmcp.send(PKG_MARK_READ, { id: item.id });
    this.renderBadge();
  },

  render() {
    this.renderBadge();
    this.renderHeader();
    this.renderList();
    this.renderDetail();
  },

  renderBadge() {
    if (!dom.announcementsBtn || !this.els.badge) return;

    const count = this.state.unreadCount;
    dom.announcementsBtn.classList.toggle('has-alert', count > 0);
    this.els.badge.style.display = count > 0 ? 'block' : 'none';
    this.els.badge.textContent = count > 99 ? '99+' : String(count);
  },

  renderHeader() {
    if (!this.els.subtitle) return;

    this.els.subtitle.textContent = this.state.active.length + ' active, '
      + this.state.archived.length + ' archived, '
      + this.state.unreadCount + ' unread';
    this.els.activeBtn.classList.toggle('active', this.state.filter === 'active');
    this.els.archivedBtn.classList.toggle('active', this.state.filter === 'archived');
  },

  renderList() {
    if (!this.els.listPane) return;

    const items = this.currentItems();
    if (!items.length) {
      this.els.listPane.innerHTML = '<div class="announcements-list-empty">No announcements in this view.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'announcement-row' + (item.id === this.state.selectedId ? ' active' : '');
      row.addEventListener('click', () => this.selectAnnouncement(item.id));

      const rowHeader = document.createElement('div');
      rowHeader.className = 'announcement-row-header';

      const rowTitle = document.createElement('div');
      rowTitle.className = 'announcement-row-title';
      rowTitle.textContent = item.title || 'Untitled Announcement';

      rowHeader.appendChild(rowTitle);
      if (!item.isRead) {
        const unreadDot = document.createElement('span');
        unreadDot.className = 'announcement-unread-dot';
        rowHeader.appendChild(unreadDot);
      }

      const meta = document.createElement('div');
      meta.className = 'announcement-row-meta';
      meta.innerHTML = '<span class="announcement-row-author">' + escapeHtml(item.author || 'Unknown') + '</span>'
        + '<span>' + escapeHtml(formatTimestamp(item.createdAt)) + '</span>';

      const summary = document.createElement('div');
      summary.className = 'announcement-row-summary';
      summary.textContent = item.summary || '';

      row.appendChild(rowHeader);
      row.appendChild(meta);
      row.appendChild(summary);
      frag.appendChild(row);
    }

    this.els.listPane.innerHTML = '';
    this.els.listPane.appendChild(frag);
  },

  renderDetail() {
    if (!this.els.detailPane) return;

    const item = this.selectedItem();
    if (!item) {
      this.els.detailPane.innerHTML = '<div class="announcements-detail-empty">Select an announcement to read it.</div>';
      return;
    }

    this.markSelectedRead();

    const wrapper = document.createElement('div');
    wrapper.className = 'announcements-detail';

    const header = document.createElement('div');
    header.className = 'announcement-detail-header';
    header.innerHTML = '<div class="announcement-detail-title">' + escapeHtml(item.title) + '</div>'
      + '<div class="announcement-detail-meta"><span><strong>By</strong> ' + escapeHtml(item.author || 'Unknown') + '</span>'
      + '<span>' + escapeHtml(formatTimestamp(item.createdAt)) + '</span></div>';

    const summary = document.createElement('div');
    summary.className = 'announcement-detail-summary';
    summary.textContent = item.summary || '';

    const markdown = document.createElement('div');
    markdown.className = 'announcement-markdown';
    markdown.innerHTML = renderAnnouncementMarkdown(item.markdown || '');

    wrapper.appendChild(header);
    wrapper.appendChild(summary);
    wrapper.appendChild(markdown);

    this.els.detailPane.innerHTML = '';
    this.els.detailPane.appendChild(wrapper);
  },
};
