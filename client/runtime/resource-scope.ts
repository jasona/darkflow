import type { SessionId } from "../model/ids.ts";
import type { SessionDiagnostics } from "./diagnostics.ts";
import type { ResourceKind } from "./diagnostics.ts";

/** Releases one owned resource without disposing the whole scope. */
export type Disposer = () => void;

/** Session-scoped owner for timers, subscriptions, child scopes, and teardown hooks. */
export interface ResourceScope {
  readonly disposed: boolean;
  own(kind: Exclude<ResourceKind, "timer" | "animationFrame">, disposer: () => void): Disposer;
  setTimeout(callback: () => void, delayMs: number): Disposer;
  setInterval(callback: () => void, delayMs: number): Disposer;
  requestAnimationFrame(callback: () => void): Disposer;
  createChildScope(): ResourceScope;
  dispose(): void;
}

interface ScopeEntry {
  kind: ResourceKind;
  disposer: () => void;
  released: boolean;
}

const noopDisposer: Disposer = () => {};

/** Creates a session resource scope backed by shared diagnostics counters. */
export function createResourceScope(
  sessionId: SessionId,
  diagnostics: SessionDiagnostics,
): ResourceScope {
  void sessionId;
  return new ResourceScopeImpl(diagnostics);
}

class ResourceScopeImpl implements ResourceScope {
  #diagnostics: SessionDiagnostics;
  #disposed = false;
  #entries: ScopeEntry[] = [];

  constructor(diagnostics: SessionDiagnostics) {
    this.#diagnostics = diagnostics;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  own(kind: Exclude<ResourceKind, "timer" | "animationFrame">, disposer: () => void): Disposer {
    if (this.#disposed) {
      disposer();
      this.#diagnostics.recordRejectedResource();
      return noopDisposer;
    }

    return this.#register(kind, disposer);
  }

  setTimeout(callback: () => void, delayMs: number): Disposer {
    if (this.#disposed) {
      this.#diagnostics.recordRejectedResource();
      return noopDisposer;
    }

    const release = this.#register("timer", () => {
      globalThis.clearTimeout(timerId);
    });

    const timerId = globalThis.setTimeout(() => {
      if (this.#disposed) {
        return;
      }

      release();
      callback();
    }, delayMs);

    return release;
  }

  setInterval(callback: () => void, delayMs: number): Disposer {
    if (this.#disposed) {
      this.#diagnostics.recordRejectedResource();
      return noopDisposer;
    }

    const intervalId = globalThis.setInterval(() => {
      if (this.#disposed) {
        return;
      }

      callback();
    }, delayMs);

    return this.#register("timer", () => {
      globalThis.clearInterval(intervalId);
    });
  }

  requestAnimationFrame(callback: () => void): Disposer {
    if (this.#disposed) {
      this.#diagnostics.recordRejectedResource();
      return noopDisposer;
    }

    const release = this.#register("animationFrame", () => {
      globalThis.cancelAnimationFrame(frameId);
    });

    const frameId = globalThis.requestAnimationFrame(() => {
      if (this.#disposed) {
        return;
      }

      release();
      callback();
    });

    return release;
  }

  createChildScope(): ResourceScope {
    if (this.#disposed) {
      this.#diagnostics.recordRejectedResource();
      return createRejectedResourceScope(this.#diagnostics);
    }

    const child = new ResourceScopeImpl(this.#diagnostics);
    let unlinked = false;

    const parentEntry: ScopeEntry = {
      kind: "childScope",
      released: false,
      disposer: () => {
        if (!child.disposed) {
          child.#disposeInternal();
        }
      },
    };

    const unlinkFromParent = (): void => {
      if (unlinked) {
        return;
      }

      unlinked = true;
      const index = this.#entries.indexOf(parentEntry);
      if (index >= 0) {
        this.#entries.splice(index, 1);
      }
      if (!parentEntry.released) {
        parentEntry.released = true;
        this.#diagnostics.trackRelease("childScope");
      }
    };

    this.#entries.push(parentEntry);
    this.#diagnostics.trackAcquire("childScope");

    const originalDispose = child.dispose.bind(child);
    child.dispose = (): void => {
      unlinkFromParent();
      originalDispose();
    };

    return child;
  }

  dispose(): void {
    if (this.#disposed) {
      this.#diagnostics.recordDuplicateDisposal();
      return;
    }

    this.#disposeInternal();
  }

  #disposeInternal(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;

    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      const entry = this.#entries[index];
      if (!entry || entry.released) {
        continue;
      }

      entry.released = true;
      try {
        entry.disposer();
      } catch {
        this.#diagnostics.recordHandlerFailure();
      }
      this.#diagnostics.trackRelease(entry.kind);
    }
  }

  #register(kind: ResourceKind, disposer: () => void): Disposer {
    const entry: ScopeEntry = {
      kind,
      disposer,
      released: false,
    };
    this.#entries.push(entry);
    this.#diagnostics.trackAcquire(kind);

    return () => {
      if (entry.released || this.#disposed) {
        return;
      }

      entry.released = true;
      try {
        disposer();
      } catch {
        this.#diagnostics.recordHandlerFailure();
      }
      this.#diagnostics.trackRelease(kind);
    };
  }
}

/** No-op scope returned when a disposed parent rejects child creation. */
function createRejectedResourceScope(diagnostics: SessionDiagnostics): ResourceScope {
  return {
    disposed: true,
    own(_kind, disposer) {
      disposer();
      diagnostics.recordRejectedResource();
      return noopDisposer;
    },
    setTimeout() {
      diagnostics.recordRejectedResource();
      return noopDisposer;
    },
    setInterval() {
      diagnostics.recordRejectedResource();
      return noopDisposer;
    },
    requestAnimationFrame() {
      diagnostics.recordRejectedResource();
      return noopDisposer;
    },
    createChildScope() {
      diagnostics.recordRejectedResource();
      return createRejectedResourceScope(diagnostics);
    },
    dispose() {
      diagnostics.recordDuplicateDisposal();
    },
  };
}
