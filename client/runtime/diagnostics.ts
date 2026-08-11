import type { SessionId } from "../model/ids.ts";

/** Resource kinds owned by a session resource scope. */
export type ResourceKind =
  | "timer"
  | "animationFrame"
  | "subscription"
  | "observer"
  | "listener"
  | "childScope"
  | "socket"
  | "teardown";

/** Read model for session-scoped lifecycle and routing diagnostics. */
export interface SessionDiagnosticsSnapshot {
  sessionId: SessionId;
  liveTimers: number;
  liveAnimationFrames: number;
  liveSubscriptions: number;
  liveObservers: number;
  liveListeners: number;
  liveChildScopes: number;
  liveSockets: number;
  liveTeardowns: number;
  duplicateDisposals: number;
  rejectedResources: number;
  handlerFailures: number;
  suppressedEvents: number;
  misroutedEvents: number;
}

/**
 * Tracks live session resources and routing/disposal failure counters for
 * runtime primitives and their composing callers.
 */
export class SessionDiagnostics {
  readonly #sessionId: SessionId;
  #duplicateDisposals = 0;
  #rejectedResources = 0;
  #handlerFailures = 0;
  #suppressedEvents = 0;
  #misroutedEvents = 0;
  #resources: Record<ResourceKind, Set<symbol>> = {
    timer: new Set(),
    animationFrame: new Set(),
    subscription: new Set(),
    observer: new Set(),
    listener: new Set(),
    childScope: new Set(),
    socket: new Set(),
    teardown: new Set(),
  };

  constructor(sessionId: SessionId) {
    this.#sessionId = sessionId;
  }

  trackAcquire(kind: ResourceKind): void {
    this.#resources[kind].add(Symbol(kind));
  }

  trackRelease(kind: ResourceKind): void {
    const resources = this.#resources[kind];
    const token = resources.values().next().value;
    if (token !== undefined) {
      resources.delete(token);
    }
  }

  recordDuplicateDisposal(): void {
    this.#duplicateDisposals += 1;
  }

  recordRejectedResource(): void {
    this.#rejectedResources += 1;
  }

  recordHandlerFailure(): void {
    this.#handlerFailures += 1;
  }

  recordSuppressedEvent(): void {
    this.#suppressedEvents += 1;
  }

  recordMisroutedEvent(): void {
    this.#misroutedEvents += 1;
  }

  snapshot(): SessionDiagnosticsSnapshot {
    return {
      sessionId: this.#sessionId,
      liveTimers: this.#resources.timer.size,
      liveAnimationFrames: this.#resources.animationFrame.size,
      liveSubscriptions: this.#resources.subscription.size,
      liveObservers: this.#resources.observer.size,
      liveListeners: this.#resources.listener.size,
      liveChildScopes: this.#resources.childScope.size,
      liveSockets: this.#resources.socket.size,
      liveTeardowns: this.#resources.teardown.size,
      duplicateDisposals: this.#duplicateDisposals,
      rejectedResources: this.#rejectedResources,
      handlerFailures: this.#handlerFailures,
      suppressedEvents: this.#suppressedEvents,
      misroutedEvents: this.#misroutedEvents,
    };
  }
}
