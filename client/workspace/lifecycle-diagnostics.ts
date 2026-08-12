export interface LifecycleDiagnosticsSnapshot {
  mounts: number;
  layouts: number;
  updates: number;
  unmounts: number;
  duplicateDisposals: number;
  liveRoots: number;
  liveHosts: number;
  liveSubscriptions: number;
  liveObservers: number;
  liveListeners: number;
  liveTerminalIslands: number;
  pendingUnmounts: number;
  ownedDom: number;
  rootIds: readonly string[];
  terminalIds: readonly string[];
}

type ResourceKind = "subscription" | "observer" | "listener" | "terminal";

interface RootAllocation {
  host: HTMLElement;
  panelId: string;
}

const diagnosticsByHost = new WeakMap<HTMLElement, LifecycleDiagnostics>();

/**
 * Tracks only resources owned by the Phase 0 workspace adapter and fixtures.
 * It deliberately has no Dockview dependency so callers can use it as a
 * vendor-neutral leak assertion surface.
 */
export class LifecycleDiagnostics {
  #mounts = 0;
  #layouts = 0;
  #updates = 0;
  #unmounts = 0;
  #duplicateDisposals = 0;
  #roots = new Map<string, RootAllocation>();
  #hosts = new Set<HTMLElement>();
  #mountCounts = new Map<string, number>();
  #resources: Record<ResourceKind, Set<symbol>> = {
    subscription: new Set(),
    observer: new Set(),
    listener: new Set(),
    terminal: new Set(),
  };
  #terminalIds = new Set<string>();
  #pendingUnmounts = new Set<Promise<void>>();

  registerHost(host: HTMLElement): void {
    diagnosticsByHost.set(host, this);
    this.#hosts.add(host);
  }

  unregisterHost(host: HTMLElement): void {
    diagnosticsByHost.delete(host);
    this.#hosts.delete(host);
  }

  mountRoot(panelId: string, host: HTMLElement): void {
    this.#mounts += 1;
    this.#mountCounts.set(panelId, (this.#mountCounts.get(panelId) ?? 0) + 1);
    this.#roots.set(panelId, { host, panelId });
  }

  recordLayout(): void {
    this.#layouts += 1;
  }

  updateRoot(): void {
    this.#updates += 1;
  }

  unmountRoot(panelId: string): void {
    if (!this.#roots.delete(panelId)) {
      this.#duplicateDisposals += 1;
      return;
    }

    this.#unmounts += 1;
  }

  recordDuplicateDisposal(): void {
    this.#duplicateDisposals += 1;
  }

  mountCount(panelId: string): number {
    return this.#mountCounts.get(panelId) ?? 0;
  }

  trackResource(kind: Exclude<ResourceKind, "terminal">): () => void {
    const token = Symbol(kind);
    const resources = this.#resources[kind];
    resources.add(token);

    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      resources.delete(token);
    };
  }

  trackTerminalIsland(panelId: string): () => void {
    const token = Symbol("terminal");
    this.#resources.terminal.add(token);
    this.#terminalIds.add(panelId);

    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      this.#resources.terminal.delete(token);
      this.#terminalIds.delete(panelId);
    };
  }

  trackUnmount(unmount: Promise<void>): Promise<void> {
    this.#pendingUnmounts.add(unmount);
    void unmount.then(
      () => this.#pendingUnmounts.delete(unmount),
      () => this.#pendingUnmounts.delete(unmount),
    );
    return unmount;
  }

  snapshot(): LifecycleDiagnosticsSnapshot {
    return {
      mounts: this.#mounts,
      layouts: this.#layouts,
      updates: this.#updates,
      unmounts: this.#unmounts,
      duplicateDisposals: this.#duplicateDisposals,
      liveRoots: this.#roots.size,
      liveHosts: this.#hosts.size,
      liveSubscriptions: this.#resources.subscription.size,
      liveObservers: this.#resources.observer.size,
      liveListeners: this.#resources.listener.size,
      liveTerminalIslands: this.#resources.terminal.size,
      pendingUnmounts: this.#pendingUnmounts.size,
      ownedDom: this.#roots.size,
      rootIds: [...this.#roots.keys()].sort(),
      terminalIds: [...this.#terminalIds].sort(),
    };
  }

  async whenIdle(): Promise<void> {
    while (this.#pendingUnmounts.size > 0) {
      await Promise.all([...this.#pendingUnmounts]);
    }
  }
}

export function findLifecycleDiagnostics(element: HTMLElement): LifecycleDiagnostics | undefined {
  let current: HTMLElement | null = element;

  while (current) {
    const diagnostics = diagnosticsByHost.get(current);
    if (diagnostics) {
      return diagnostics;
    }

    current = current.parentElement;
  }

  return undefined;
}
