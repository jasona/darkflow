// ide-manager.js - GMCP glue for the in-browser IDE
// Lazy-loads the CodeMirror editor on first use and routes GMCP messages.

import { gmcp } from './gmcp.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';
import { state } from './state.js';
import { panelManager } from './panel-manager.js';

const DW_IDE_OPEN = 'Darkwind.IDE.Open';
const DW_IDE_OPEN_START = 'Darkwind.IDE.OpenStart';
const DW_IDE_OPEN_CHUNK = 'Darkwind.IDE.OpenChunk';
const DW_IDE_OPEN_FINISH = 'Darkwind.IDE.OpenFinish';
const DW_IDE_SAVE = 'Darkwind.IDE.Save';
const DW_IDE_SAVE_START = 'Darkwind.IDE.SaveStart';
const DW_IDE_SAVE_CHUNK = 'Darkwind.IDE.SaveChunk';
const DW_IDE_SAVE_FINISH = 'Darkwind.IDE.SaveFinish';
const DW_IDE_SAVE_ABORT = 'Darkwind.IDE.SaveAbort';
const DW_IDE_SAVE_RESULT = 'Darkwind.IDE.SaveResult';
const DW_IDE_CLOSE = 'Darkwind.IDE.Close';

const IDE_CHUNK_SIZE = 32 * 1024;
const IDE_INLINE_SAVE_LIMIT = 256 * 1024;
const IDE_SAVE_BUFFERED_LIMIT = 32 * 1024;
const IDE_SAVE_BACKPRESSURE_DELAY_MS = 8;

const textEncoder = new TextEncoder();

function createSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'ide-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

async function sha1Hex(text) {
  if (!window.crypto || !window.crypto.subtle) return '';
  const digest = await window.crypto.subtle.digest('SHA-1', textEncoder.encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function chunkString(content) {
  const chunks = [];
  for (let i = 0; i < content.length; i += IDE_CHUNK_SIZE) {
    chunks.push(content.slice(i, i + IDE_CHUNK_SIZE));
  }
  return chunks.length ? chunks : [''];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSaveBackpressure() {
  while (state.ws && state.ws.bufferedAmount > IDE_SAVE_BUFFERED_LIMIT) {
    await sleep(IDE_SAVE_BACKPRESSURE_DELAY_MS);
  }
}

export const ideManager = {
  editor: null,
  loadPromise: null,
  openTransfers: new Map(),

  init() {
    return installControllerLifecycle(this, 'ide', gmcp, (scopedGmcp, lifecycle) => {
      const closeHandler = () => this.handlePaneClose();
      panelManager.registerPanelCloseHandler('ide', closeHandler);
      lifecycle.own('teardown', () => panelManager.unregisterPanelCloseHandler('ide', closeHandler));
      scopedGmcp.on(DW_IDE_OPEN, (data) => this.handleOpen(data));
      scopedGmcp.on(DW_IDE_OPEN_START, (data) => this.handleOpenStart(data));
      scopedGmcp.on(DW_IDE_OPEN_CHUNK, (data) => this.handleOpenChunk(data));
      scopedGmcp.on(DW_IDE_OPEN_FINISH, (data) => this.handleOpenFinish(data));
      scopedGmcp.on(DW_IDE_SAVE_RESULT, (data) => this.handleSaveResult(data));
    }, () => {
      this.openTransfers.clear();
      if (this.editor) this.editor.close(true);
      this.editor = null;
      this.loadPromise = null;
    });
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  async ensureEditor() {
    if (this.editor) return this.editor;
    const lifecycle = this._controllerLifecycle;
    if (!lifecycle || lifecycle.disposed) return null;
    this.showLoading();
    try {
      if (!this.loadPromise) {
        this.loadPromise = import('./ide-editor.js');
      }
      const mod = await this.loadPromise;
      if (lifecycle.disposed || this._controllerLifecycle !== lifecycle) return null;
      this.editor = mod.ideEditor;
      await this.editor.init();
      if (lifecycle.disposed || this._controllerLifecycle !== lifecycle) {
        this.editor.close(true);
        this.editor = null;
        return null;
      }
      return this.editor;
    } catch (e) {
      console.error('[IDE] Failed to load editor:', e);
      throw e;
    } finally {
      if (!lifecycle.disposed && this._controllerLifecycle === lifecycle) this.hideLoading();
    }
  },

  ensurePane() {
    if (panelManager.state.panels.ide && panelManager.state.panels.ide.collapsed) {
      panelManager.state.panels.ide.collapsed = false;
    }
    panelManager.openPanel('ide');
    const panel = panelManager.panels.ide;
    if (panelManager._bringPanelToFront) panelManager._bringPanelToFront('ide');
    return panel && panel.bodyEl ? panel.bodyEl : null;
  },

  handlePaneClose() {
    if (!this.editor || !this.editor.view) return true;
    this.editor.tryClose();
    return false;
  },

  closePane() {
    if (panelManager._closePanelNow) panelManager._closePanelNow('ide');
  },

  async handleOpen(data) {
    let editor;
    try {
      editor = await this.ensureEditor();
    } catch (_error) {
      return;
    }
    if (!editor) return;

    const hostEl = this.ensurePane();
    if (!hostEl) return;

    editor.open(data, {
      onSave: (path, content) => this.sendSave(path, content),
      onClose: (path) => {
        gmcp.send(DW_IDE_CLOSE, { path });
        this.closePane();
        const input = document.getElementById('command-input');
        if (input) input.focus();
      },
    }, hostEl);
  },

  handleOpenStart(data) {
    if (!data || !data.session) return;
    const chunks = Number(data.chunks || 0);
    if (!Number.isInteger(chunks) || chunks < 1) return;
    this.openTransfers.set(data.session, {
      data: { ...data, content: '' },
      chunks: new Array(chunks),
      received: 0,
    });
    this.showLoading('Loading large file...');
  },

  handleOpenChunk(data) {
    if (!data || !data.session) return;
    const transfer = this.openTransfers.get(data.session);
    if (!transfer) return;
    const index = Number(data.index);
    if (!Number.isInteger(index) || index < 0 || index >= transfer.chunks.length) return;
    if (transfer.chunks[index] === undefined) transfer.received += 1;
    transfer.chunks[index] = typeof data.content === 'string' ? data.content : '';
    this.showLoading('Loading large file ' + transfer.received + '/' + transfer.chunks.length + '...');
  },

  async handleOpenFinish(data) {
    if (!data || !data.session) return;
    const transfer = this.openTransfers.get(data.session);
    if (!transfer) return;
    this.openTransfers.delete(data.session);
    this.hideLoading();

    if (transfer.chunks.some((chunk) => chunk === undefined)) {
      console.error('[IDE] Missing chunk for open transfer', data.session);
      return;
    }

    const content = transfer.chunks.join('');
    if (Number.isInteger(transfer.data.totalLength) && content.length !== transfer.data.totalLength) {
      console.error('[IDE] Open transfer length mismatch', data.session);
      return;
    }

    await this.handleOpen({ ...transfer.data, content });
  },

  async sendSave(path, content) {
    if (content.length <= IDE_INLINE_SAVE_LIMIT) {
      if (!gmcp.send(DW_IDE_SAVE, { path, content })) {
        throw new Error('Socket is not connected.');
      }
      return;
    }

    const session = createSessionId();
    const chunks = chunkString(content);
    const hash = await sha1Hex(content);

    if (!gmcp.send(DW_IDE_SAVE_START, {
      session,
      path,
      chunks: chunks.length,
      totalLength: content.length,
      hash,
    })) {
      throw new Error('Socket is not connected.');
    }

    for (let index = 0; index < chunks.length; index++) {
      if (this.editor) {
        this.editor.handleTransferProgress('Saving chunk ' + (index + 1) + '/' + chunks.length + '...');
      }
      if (!gmcp.send(DW_IDE_SAVE_CHUNK, {
        session,
        index,
        content: chunks[index],
      })) {
        gmcp.send(DW_IDE_SAVE_ABORT, { session, reason: 'send-failed' });
        throw new Error('Socket disconnected before save completed.');
      }
      await waitForSaveBackpressure();
      await sleep(0);
    }

    if (!gmcp.send(DW_IDE_SAVE_FINISH, { session })) {
      gmcp.send(DW_IDE_SAVE_ABORT, { session, reason: 'finish-failed' });
      throw new Error('Socket disconnected before save completed.');
    }
    if (this.editor) this.editor.handleTransferProgress('Finishing save...');
  },

  handleSaveResult(data) {
    if (this.editor) {
      this.editor.handleSaveResult(data);
    }
  },

  showLoading(message = 'Loading editor...') {
    let el = document.getElementById('ide-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ide-loading';
      el.className = 'ide-loading';
      el.innerHTML = '<div class="ide-loading-spinner"></div><div class="ide-loading-text"></div>';
      document.body.appendChild(el);
    }
    const text = el.querySelector('.ide-loading-text');
    if (text) text.textContent = message;
    el.style.display = 'flex';
  },

  hideLoading() {
    const el = document.getElementById('ide-loading');
    if (el) el.style.display = 'none';
  },
};
