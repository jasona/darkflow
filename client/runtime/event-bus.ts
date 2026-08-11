import type { SessionId } from "../model/ids.ts";
import type { SessionDiagnostics } from "./diagnostics.ts";
import type { SessionEvent, SessionEventHandler, Unsubscribe } from "./events.ts";

/** Per-session event bus with handler isolation and session-bound routing. */
export interface SessionEventBus {
  readonly disposed: boolean;
  subscribe<TType extends string, TPayload>(
    type: TType,
    handler: SessionEventHandler<TType, TPayload>,
  ): Unsubscribe;
  publish<TType extends string, TPayload>(type: TType, payload: TPayload): void;
  dispatch<TType extends string, TPayload>(event: SessionEvent<TType, TPayload>): void;
  dispose(): void;
}

const noopUnsubscribe: Unsubscribe = () => {};

/** Creates a session-scoped event bus backed by shared diagnostics counters. */
export function createSessionEventBus(
  sessionId: SessionId,
  diagnostics: SessionDiagnostics,
): SessionEventBus {
  return new SessionEventBusImpl(sessionId, diagnostics);
}

class SessionEventBusImpl implements SessionEventBus {
  readonly #sessionId: SessionId;
  #diagnostics: SessionDiagnostics;
  #disposed = false;
  #handlers = new Map<string, Set<SessionEventHandler<string, unknown>>>();

  constructor(sessionId: SessionId, diagnostics: SessionDiagnostics) {
    this.#sessionId = sessionId;
    this.#diagnostics = diagnostics;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  subscribe<TType extends string, TPayload>(
    type: TType,
    handler: SessionEventHandler<TType, TPayload>,
  ): Unsubscribe {
    if (this.#disposed) {
      this.#diagnostics.recordRejectedResource();
      return noopUnsubscribe;
    }

    let handlers = this.#handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(type, handlers);
    }

    const wrapped = handler as SessionEventHandler<string, unknown>;
    handlers.add(wrapped);

    return () => {
      handlers?.delete(wrapped);
      if (handlers && handlers.size === 0) {
        this.#handlers.delete(type);
      }
    };
  }

  publish<TType extends string, TPayload>(type: TType, payload: TPayload): void {
    this.dispatch({
      sessionId: this.#sessionId,
      type,
      payload,
    });
  }

  dispatch<TType extends string, TPayload>(event: SessionEvent<TType, TPayload>): void {
    if (this.#disposed) {
      this.#diagnostics.recordSuppressedEvent();
      return;
    }

    if (event.sessionId !== this.#sessionId) {
      this.#diagnostics.recordMisroutedEvent();
      return;
    }

    const handlers = this.#handlers.get(event.type);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const snapshot = [...handlers];
    for (const handler of snapshot) {
      try {
        handler(event as SessionEvent<string, unknown>);
      } catch (error) {
        console.error(`Session event handler failed for ${event.type}`, error);
        this.#diagnostics.recordHandlerFailure();
      }
    }
  }

  dispose(): void {
    if (this.#disposed) {
      this.#diagnostics.recordDuplicateDisposal();
      return;
    }

    this.#disposed = true;
    this.#handlers.clear();
  }
}
