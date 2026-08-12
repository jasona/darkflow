import { findLifecycleDiagnostics } from "./lifecycle-diagnostics";

export interface TerminalIslandSnapshot {
  buffer: string;
  identity: string;
  scrollTop: number;
}

export interface TerminalIsland {
  readonly element: HTMLElement;
  append(text: string): void;
  focus(): void;
  replace(text: string): void;
  snapshot(): TerminalIslandSnapshot;
  dispose(): void;
}

export interface TerminalIslandObservation {
  buffer: string;
  connected: boolean;
  focused: boolean;
  identity: string;
  scrollTop: number;
}

let terminalSequence = 0;
const terminalIslands = new Map<string, TerminalIsland>();

/**
 * A deliberately small imperative boundary used to prove that Dockview keeps
 * terminal DOM identity, focus, buffer, and native scroll state intact.
 */
export function createTerminalIsland(host: HTMLElement, panelId: string): TerminalIsland {
  const identity = `terminal-${++terminalSequence}`;
  const viewport = document.createElement("div");
  const output = document.createElement("pre");
  const diagnostics = findLifecycleDiagnostics(host);
  const releaseTerminal = diagnostics?.trackTerminalIsland(panelId);
  let buffer = "";
  let disposed = false;

  viewport.className = "phase0-terminal-island";
  viewport.dataset.panelId = panelId;
  viewport.dataset.terminalIdentity = identity;
  viewport.dataset.testid = "terminal-viewport";
  viewport.dataset.workspaceOwned = "true";
  viewport.tabIndex = 0;
  viewport.style.cssText = "height: 100%; min-height: 0; overflow: auto; white-space: pre-wrap;";
  output.dataset.workspaceOwned = "true";
  output.style.margin = "0";
  viewport.append(output);
  host.append(viewport);

  const render = () => {
    output.textContent = buffer;
  };

  const append = (text: string) => {
    if (disposed || text.length === 0) {
      return;
    }

    buffer += text;
    render();
  };

  const replace = (text: string) => {
    if (disposed || buffer === text) {
      return;
    }

    buffer = text;
    render();
  };

  const island: TerminalIsland = {
    element: viewport,
    append,
    focus: () => viewport.focus({ preventScroll: true }),
    replace,
    snapshot: () => ({ buffer, identity, scrollTop: viewport.scrollTop }),
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      releaseTerminal?.();
      if (terminalIslands.get(panelId) === island) {
        terminalIslands.delete(panelId);
      }
      viewport.remove();
    },
  };

  terminalIslands.set(panelId, island);
  return island;
}

export function appendTerminalIsland(panelId: string, text: string): void {
  terminalIslands.get(panelId)?.append(text);
}

export function focusTerminalIsland(panelId: string): void {
  const island = terminalIslands.get(panelId);
  if (!island) {
    return;
  }

  const restoreFocus = () => {
    if (island.element.isConnected) {
      island.focus();
    }
  };
  restoreFocus();
  queueMicrotask(restoreFocus);
  requestAnimationFrame(restoreFocus);
}

export function scrollTerminalIsland(panelId: string, scrollTop: number): void {
  const island = terminalIslands.get(panelId);
  if (island) {
    island.element.scrollTop = scrollTop;
  }
}

export function inspectTerminalIsland(panelId: string): TerminalIslandObservation | null {
  const island = terminalIslands.get(panelId);
  if (!island) {
    return null;
  }

  const snapshot = island.snapshot();
  return {
    buffer: snapshot.buffer,
    connected: island.element.isConnected,
    focused: document.activeElement === island.element,
    identity: snapshot.identity,
    scrollTop: snapshot.scrollTop,
  };
}
