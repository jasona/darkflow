import { gmcp } from './gmcp.js';
import { parseAnsiText, styleToElement } from './ansi.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

const PKG_OPEN = 'Darkwind.Snoop.Open';
const PKG_APPEND = 'Darkwind.Snoop.Append';
const PKG_CLOSE = 'Darkwind.Snoop.Close';
const PKG_STATUS = 'Darkwind.Snoop.Status';
const PKG_COMMAND = 'Darkwind.Snoop.Command';
const PKG_STOP = 'Darkwind.Snoop.Stop';
const PKG_CLOSED = 'Darkwind.Snoop.Closed';
const MAX_LINES = 1000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isScrolledToBottom(node) {
  if (!node) return true;
  return node.scrollHeight - node.scrollTop - node.clientHeight < 32;
}

function appendAnsi(parent, text) {
  const fragments = parseAnsiText(text || '');
  if (!fragments.length) {
    parent.appendChild(document.createTextNode(text || ''));
    return;
  }
  for (const fragment of fragments) {
    const child = styleToElement(fragment.text, fragment.style);
    if (child) parent.appendChild(child);
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value : String(value || '');
}

export const snoopManager = {
  session: null,
  els: null,
  lineCount: 0,

  init() {
    return installControllerLifecycle(this, 'snoop', gmcp, (scopedGmcp) => {
      scopedGmcp.on(PKG_OPEN, data => this.open(data || {}));
      scopedGmcp.on(PKG_APPEND, data => this.append(data || {}));
      scopedGmcp.on(PKG_STATUS, data => this.status(data || {}));
      scopedGmcp.on(PKG_CLOSE, data => this.close(data || {}));
    }, () => this.close({ localOnly: true }));
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  open(data) {
    this.close({ localOnly: true });
    this.session = {
      id: data.id || 'snoop',
      target: data.target || data.targetRealName || 'player',
    };
    this.lineCount = 0;

    const overlay = el('div', 'dw-modal-overlay dw-snoop-overlay');
    const modal = el('section', 'dw-modal dw-snoop-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Snooping ' + this.session.target);

    const header = el('header', 'dw-snoop-header');
    const headerText = el('div', 'dw-snoop-heading');
    headerText.appendChild(el('div', 'dw-snoop-title', 'Snooping: ' + this.session.target));
    headerText.appendChild(el('div', 'dw-snoop-subtitle', 'Observing player activity'));
    const closeButton = el('button', 'dw-snoop-icon-button', 'x');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close snoop window');
    closeButton.title = 'Close snoop window';
    header.appendChild(headerText);
    header.appendChild(closeButton);

    const stream = el('div', 'dw-snoop-stream');
    stream.setAttribute('aria-live', 'polite');
    stream.setAttribute('aria-label', 'Snoop output');

    const controls = el('div', 'dw-snoop-controls');
    const targetRow = this.createCommandRow('target', 'Execute command as ' + this.session.target + '...');
    const selfRow = this.createCommandRow('self', 'Execute command as yourself...');
    controls.appendChild(targetRow.row);
    controls.appendChild(selfRow.row);

    const footer = el('footer', 'dw-snoop-footer');
    const stopButton = el('button', 'dw-snoop-stop', 'Stop Snooping');
    stopButton.type = 'button';
    footer.appendChild(stopButton);

    modal.appendChild(header);
    modal.appendChild(stream);
    modal.appendChild(controls);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    this.els = { overlay, modal, stream, closeButton, stopButton, targetInput: targetRow.input };

    closeButton.addEventListener('click', () => this.requestClose());
    stopButton.addEventListener('click', () => this.requestStop());
    overlay.addEventListener('click', event => {
      if (event.target === overlay) this.requestClose();
    });
    this.keyHandler = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.requestClose();
      }
    };
    document.addEventListener('keydown', this.keyHandler);

    this.status({ text: 'Connected to ' + this.session.target + '.' });
    targetRow.input.focus();
  },

  createCommandRow(mode, placeholder) {
    const row = el('form', 'dw-snoop-command-row');
    const input = el('input', 'dw-snoop-command-input');
    const button = el('button', 'dw-snoop-command-button', 'Execute');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = placeholder;
    button.type = 'submit';
    row.appendChild(input);
    row.appendChild(button);
    row.addEventListener('submit', event => {
      event.preventDefault();
      this.sendCommand(mode, input);
    });
    return { row, input };
  },

  sendCommand(mode, input) {
    const command = (input.value || '').trim();
    if (!command || !this.session) return;
    gmcp.send(PKG_COMMAND, {
      id: this.session.id,
      mode,
      command,
    });
    input.value = '';
  },

  append(data) {
    if (!this.els || !this.els.stream) return;
    const type = data.type || 'output';
    const text = normalizeText(data.text);
    const atBottom = isScrolledToBottom(this.els.stream);

    if (type === 'output') {
      const fragment = document.createDocumentFragment();
      appendAnsi(fragment, text);
      this.els.stream.appendChild(fragment);
    } else {
      const line = el('div', 'dw-snoop-line dw-snoop-line-' + type);
      if (type === 'input') {
        line.appendChild(el('span', 'dw-snoop-prefix', '> '));
        line.appendChild(document.createTextNode(text));
      } else if (type === 'command') {
        line.appendChild(el('span', 'dw-snoop-prefix', '$ '));
        line.appendChild(document.createTextNode(text));
      } else {
        line.textContent = text;
      }
      this.els.stream.appendChild(line);
    }

    this.lineCount++;
    while (this.lineCount > MAX_LINES && this.els.stream.firstChild) {
      this.els.stream.removeChild(this.els.stream.firstChild);
      this.lineCount--;
    }
    if (atBottom) this.els.stream.scrollTop = this.els.stream.scrollHeight;
  },

  status(data) {
    this.append({ type: 'status', text: data.text || '' });
  },

  requestStop() {
    if (this.session) gmcp.send(PKG_STOP, { id: this.session.id });
  },

  requestClose() {
    if (this.session) gmcp.send(PKG_CLOSED, { id: this.session.id });
    this.close({ localOnly: true });
  },

  close(data = {}) {
    if (data.reason && data.reason !== 'closed') {
      this.status({ text: 'Snoop ended: ' + data.reason + '.' });
    }
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    if (this.els && this.els.overlay) {
      this.els.overlay.remove();
    }
    this.els = null;
    this.session = null;
    this.lineCount = 0;
  },
};
