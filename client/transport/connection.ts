import type { SessionId } from "../model/ids.ts";
import type { SessionDiagnostics } from "../runtime/diagnostics.ts";
import type { SessionEventBus } from "../runtime/event-bus.ts";
import type { ResourceScope } from "../runtime/resource-scope.ts";
import type { Disposer } from "../runtime/resource-scope.ts";
import { WS_FORCE_RECONNECT_DELAY_MS, createReconnectController } from "./reconnect.ts";
import { WS_HEALTH_INTERVAL_MS, createTransportHealth } from "./health.ts";
import { buildConnectionUrl, buildTransportLadder } from "./urls.ts";
import type {
  SessionTransport,
  SessionTransportCallbacks,
  TransportState,
  WebSocketLike,
} from "./types.ts";

const gmcpTextDecoder = new TextDecoder();

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

/** Decodes a binary GMCP wire frame into package name and parsed payload. */
export function decodeGmcpWireFrame(bytes: Uint8Array): { packageName: string; data: unknown } {
  const text = gmcpTextDecoder.decode(bytes);
  const spaceIdx = text.indexOf(" ");
  if (spaceIdx === -1) {
    return { packageName: text, data: undefined };
  }
  const packageName = text.substring(0, spaceIdx);
  const remainder = text.substring(spaceIdx + 1);
  try {
    return { packageName, data: JSON.parse(remainder) };
  } catch {
    return { packageName, data: remainder };
  }
}

function getSocketReadyState(socket: WebSocketLike | null): number {
  return socket && typeof socket.readyState === "number" ? socket.readyState : WS_CLOSED;
}

function isSocketOpen(socket: WebSocketLike | null): boolean {
  return getSocketReadyState(socket) === WS_OPEN;
}

function isSocketConnecting(socket: WebSocketLike | null): boolean {
  return getSocketReadyState(socket) === WS_CONNECTING;
}

function isSocketClosingOrClosed(socket: WebSocketLike | null): boolean {
  const readyState = getSocketReadyState(socket);
  return readyState === WS_CLOSING || readyState === WS_CLOSED;
}

function socketReadyStateName(socket: WebSocketLike | null): string {
  switch (getSocketReadyState(socket)) {
    case WS_CONNECTING:
      return "connecting";
    case WS_OPEN:
      return "open";
    case WS_CLOSING:
      return "closing";
    case WS_CLOSED:
      return "closed";
    default:
      return "unknown";
  }
}

/** Creates a session-scoped transport composing URL, health, and reconnect modules. */
export function createSessionTransport(
  sessionId: SessionId,
  scope: ResourceScope,
  eventBus: SessionEventBus,
  diagnostics: SessionDiagnostics,
  callbacks: SessionTransportCallbacks,
  options: {
    appOrigin?: string;
    now?: () => number;
    webSocketFactory?: (url: string) => WebSocketLike;
    onlineTarget?: { addEventListener(type: string, listener: () => void): void };
  } = {},
): SessionTransport {
  const now = options.now ?? Date.now;
  const appOrigin = options.appOrigin ?? globalThis.location?.origin ?? "http://localhost:3000";
  const webSocketFactory =
    options.webSocketFactory ??
    ((url: string) => new globalThis.WebSocket(url) as unknown as WebSocketLike);
  const onlineTarget = options.onlineTarget ?? globalThis.window;

  const health = createTransportHealth(now);
  let transportState: TransportState = "disconnected";
  let socket: WebSocketLike | null = null;
  let socketRelease: Disposer | null = null;
  let connectionPending = false;
  let userDisconnected = false;
  let connectTime: number | null = null;
  let watchdogRelease: Disposer | null = null;
  let disposed = false;

  const reconnect = createReconnectController({
    scope,
    eventBus,
    getEndpoint: () => callbacks.getEndpoint(),
    getAutoReconnect: () => callbacks.getAutoReconnect(),
    isLoggedIntoCharacter: () => callbacks.isLoggedIntoCharacter(),
    getCurrentSocket: () => socket,
    isSocketOpen,
    onRetry: () => {
      connectInternal();
    },
    onUpgrade: (reason) => {
      forceReconnectInternal(reason);
    },
    appOrigin,
    webSocketFactory,
    now,
  });

  function setTransportState(next: TransportState): void {
    transportState = next;
  }

  function stopWatchdog(): void {
    if (watchdogRelease) {
      watchdogRelease();
      watchdogRelease = null;
    }
  }

  function releaseSocket(): void {
    if (socketRelease) {
      socketRelease();
      socketRelease = null;
    }
    socket = null;
  }

  function resetSocketState(): void {
    reconnect.cancelAllTimers();
    stopWatchdog();
    releaseSocket();
    connectTime = null;
    health.resetSocketFields();
  }

  function emitIdleIfNeeded(): void {
    reconnect.emitReconnectStatus({ status: "idle" });
  }

  function maybeScheduleReconnect(reason?: string): void {
    if (userDisconnected || !callbacks.getAutoReconnect()) {
      emitIdleIfNeeded();
      return;
    }
    reconnect.scheduleReconnect();
    void reason;
  }

  function finalizeDisconnect(): void {
    resetSocketState();
    setTransportState("disconnected");
  }

  function forceReconnectInternal(reason: string): void {
    const staleSocket = socket;
    health.pushEvent("force-reconnect", { reason });
    health.forcedReconnects += 1;
    finalizeDisconnect();

    if (staleSocket) {
      try {
        staleSocket.close(4000, "client-reconnect");
      } catch (error) {
        health.pushEvent("force-reconnect-close-error", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    reconnect.cancelReconnectTimer();
    reconnect.scheduleRetry(WS_FORCE_RECONNECT_DELAY_MS, reason);
  }

  function startWatchdog(): void {
    stopWatchdog();
    watchdogRelease = scope.setInterval(() => {
      if (!isSocketOpen(socket)) {
        return;
      }
      const stallReason = health.evaluateStall(socket, now());
      if (stallReason) {
        forceReconnectInternal(
          stallReason === "buffer-backlog" ? "buffer backlog" : "no inbound traffic",
        );
      }
    }, WS_HEALTH_INTERVAL_MS);
  }

  function connectInternal(): void {
    if (disposed) {
      return;
    }
    if (socket && isSocketClosingOrClosed(socket)) {
      releaseSocket();
    }
    if (socket || connectionPending) {
      return;
    }

    connectionPending = true;
    userDisconnected = false;

    try {
      if (socket && isSocketClosingOrClosed(socket)) {
        releaseSocket();
      }
      if (socket) {
        if (isSocketConnecting(socket) || isSocketOpen(socket)) {
          return;
        }
        return;
      }

      const endpoint = callbacks.getEndpoint();
      const selected = endpoint.protocol || "wss";
      const transport = reconnect.nextTransport();
      const url = buildConnectionUrl(endpoint, appOrigin);

      setTransportState("connecting");
      reconnect.emitReconnectStatus({ status: "connecting", transport, url });

      let ws: WebSocketLike;
      let attemptOpened = false;
      try {
        ws = webSocketFactory(url);
      } catch (error) {
        health.pushEvent("connect-error", {
          url,
          message: error instanceof Error ? error.message : String(error),
        });
        setTransportState("disconnected");
        if (reconnect.handleRungFailure("constructor failure")) {
          return;
        }
        maybeScheduleReconnect();
        return;
      }

      socket = ws;
      socketRelease = scope.own("socket", () => {
        try {
          ws.close(1000, "transport-dispose");
        } catch {
          // Ignore close failures during disposal.
        }
      });
      health.currentUrl = url;
      health.pushEvent("connect-attempt", { url, transport });
      connectionPending = false;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (socket !== ws || disposed) {
          return;
        }
        attemptOpened = true;
        setTransportState("connected");
        connectTime = now();
        reconnect.state.reconnectAttempts = 0;
        reconnect.resetTransportLadder();
        health.lastOpenAt = now();
        health.stalledAt = null;
        health.recordBufferedAmount(socket);
        health.pushEvent("open", { url, transport });
        reconnect.emitReconnectStatus({ status: "connected", transport, url });
        reconnect.scheduleHandshakeGuard(ws, health);
        if (transport !== buildTransportLadder(selected)[0]) {
          reconnect.scheduleUpgradeProbe(ws, undefined, transport);
        }
        startWatchdog();
      };

      ws.onmessage = (event: MessageEvent) => {
        if (socket !== ws || disposed) {
          return;
        }

        const at = now();
        try {
          if (typeof event.data === "string") {
            eventBus.publish("transport:inbound-bytes", {
              kind: "text",
              size: event.data.length,
            });
            health.recordInboundText(at);
            callbacks.onText(event.data);
            reconnect.scheduleLostTransmissionRecovery(event.data, health);
          } else {
            const arr = new Uint8Array(event.data as ArrayBuffer);
            const { packageName, data } = decodeGmcpWireFrame(arr);
            eventBus.publish("transport:inbound-bytes", {
              kind: "gmcp",
              size: arr.byteLength,
            });
            health.recordInboundGmcp(at);
            callbacks.onGmcpFrame(packageName, data);
          }
          health.recordBufferedAmount(socket);
        } catch (error) {
          health.lastHandlerErrorAt = at;
          health.pushEvent("message-handler-error", {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
          });
          diagnostics.recordHandlerFailure();
        }
      };

      ws.onerror = () => {
        if (socket !== ws || disposed) {
          return;
        }
        health.lastErrorAt = now();
        health.pushEvent("error", {
          readyState: ws.readyState,
          bufferedAmount: ws.bufferedAmount || 0,
        });
      };

      ws.onclose = (event: CloseEvent) => {
        health.lastCloseAt = now();
        health.pushEvent("close", {
          code: event.code,
          reason: event.reason || "",
          wasClean: !!event.wasClean,
        });

        if (socket !== ws || disposed) {
          return;
        }

        finalizeDisconnect();

        if (
          !attemptOpened &&
          !userDisconnected &&
          callbacks.getAutoReconnect() &&
          reconnect.handleRungFailure(`failed before open (code ${event.code})`)
        ) {
          return;
        }

        maybeScheduleReconnect(`close code ${event.code}`);
      };
    } finally {
      connectionPending = false;
    }
  }

  if (onlineTarget && typeof onlineTarget.addEventListener === "function") {
    const onOnline = (): void => {
      if (disposed || userDisconnected) {
        return;
      }
      if (isSocketOpen(socket) || isSocketConnecting(socket)) {
        return;
      }
      if (!callbacks.getAutoReconnect() && !reconnect.hasPendingReconnect()) {
        return;
      }
      transport.retryNow();
    };
    onlineTarget.addEventListener("online", onOnline);
    scope.own("listener", () => {
      if ("removeEventListener" in onlineTarget) {
        (
          onlineTarget as { removeEventListener(type: string, listener: () => void): void }
        ).removeEventListener("online", onOnline);
      }
    });
  }

  const transport: SessionTransport = {
    sessionId,
    get state() {
      return transportState;
    },

    connect() {
      connectInternal();
    },

    disconnect() {
      userDisconnected = true;
      reconnect.cancelReconnectTimer();
      reconnect.emitReconnectStatus({ status: "idle", userDisconnected: true });
      if (socket) {
        try {
          socket.close(1000, "User disconnect");
        } catch {
          // Ignore user-initiated close failures.
        }
      }
    },

    retryNow() {
      reconnect.cancelReconnectTimer();
      userDisconnected = false;
      if (isSocketOpen(socket) || isSocketConnecting(socket)) {
        return;
      }
      connectInternal();
    },

    forceReconnect(reason: string) {
      forceReconnectInternal(reason);
    },

    send(payload, metadata) {
      const liveSocket = socket;
      if (liveSocket === null || !isSocketOpen(liveSocket)) {
        return false;
      }

      const kind = metadata?.kind ?? "generic";
      try {
        health.noteOutboundActivity(kind, metadata, liveSocket);
        liveSocket.send(payload);
        health.recordBufferedAmount(liveSocket);
        return true;
      } catch (error) {
        health.lastErrorAt = now();
        health.pushEvent("send-error", {
          kind,
          message: error instanceof Error ? error.message : String(error),
        });
        diagnostics.recordHandlerFailure();
        eventBus.publish("transport:send-error", {
          kind,
          message: error instanceof Error ? error.message : String(error),
        });
        forceReconnectInternal("send failure");
        return false;
      }
    },

    getHealthSnapshot() {
      return health.snapshot({
        readyState: getSocketReadyState(socket),
        readyStateName: socketReadyStateName(socket),
        connectionPending,
        reconnectAttempts: reconnect.state.reconnectAttempts,
        connectTime,
        bufferedAmount: socket ? socket.bufferedAmount || 0 : 0,
      });
    },

    dispose() {
      if (disposed) {
        diagnostics.recordDuplicateDisposal();
        return;
      }
      disposed = true;
      finalizeDisconnect();
      scope.dispose();
    },
  };

  return transport;
}
