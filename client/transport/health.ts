import type { TransportHealthSnapshot } from "./types.ts";
import type { WebSocketLike } from "./types.ts";

export const WS_DIAG_LIMIT = 100;
export const WS_HEALTH_INTERVAL_MS = 5000;
export const WS_STALL_WINDOW_MS = 8000;
export const WS_STALL_COMMAND_BURST_MS = 4000;
export const WS_STALL_COMMAND_BURST_COUNT = 3;
export const WS_STALLED_BUFFERED_THRESHOLD = 64 * 1024;

interface HealthEvent {
  ts: string;
  type: string;
  detail: unknown;
}

/** Mutable per-session transport health tracker replacing legacy state.wsHealth. */
export interface TransportHealth {
  currentUrl: string | null;
  lastOpenAt: number | null;
  lastInboundAt: number | null;
  lastInboundTextAt: number | null;
  lastInboundGmcpAt: number | null;
  lastOutboundAt: number | null;
  lastCommandAt: number | null;
  lastErrorAt: number | null;
  lastCloseAt: number | null;
  lastHandlerErrorAt: number | null;
  lastBufferedAmount: number;
  maxBufferedAmount: number;
  stalledAt: number | null;
  forcedReconnects: number;
  recentCommandTimes: number[];
  events: HealthEvent[];
  pushEvent(type: string, detail: unknown): void;
  trimCommandBurst(now: number): void;
  recordBufferedAmount(socket: WebSocketLike | null): number;
  noteOutboundActivity(
    kind: string,
    metadata: { size?: number; preview?: string } | undefined,
    socket: WebSocketLike | null,
  ): void;
  recordInboundText(now: number): void;
  recordInboundGmcp(now: number): void;
  evaluateStall(
    socket: WebSocketLike | null,
    now: number,
  ): "command-burst" | "buffer-backlog" | null;
  resetSocketFields(): void;
  snapshot(options: {
    readyState: number;
    readyStateName: string;
    connectionPending: boolean;
    reconnectAttempts: number;
    connectTime: number | null;
    bufferedAmount: number;
  }): TransportHealthSnapshot;
}

/** Creates an instance-scoped health tracker with an injectable clock. */
export function createTransportHealth(now: () => number = Date.now): TransportHealth {
  const health: TransportHealth = {
    currentUrl: null,
    lastOpenAt: null,
    lastInboundAt: null,
    lastInboundTextAt: null,
    lastInboundGmcpAt: null,
    lastOutboundAt: null,
    lastCommandAt: null,
    lastErrorAt: null,
    lastCloseAt: null,
    lastHandlerErrorAt: null,
    lastBufferedAmount: 0,
    maxBufferedAmount: 0,
    stalledAt: null,
    forcedReconnects: 0,
    recentCommandTimes: [],
    events: [],

    pushEvent(type, detail) {
      health.events.push({
        ts: new Date(now()).toISOString(),
        type,
        detail,
      });
      if (health.events.length > WS_DIAG_LIMIT) {
        health.events = health.events.slice(-WS_DIAG_LIMIT);
      }
    },

    trimCommandBurst(at) {
      health.recentCommandTimes = health.recentCommandTimes.filter(
        (timestamp) => at - timestamp <= WS_STALL_COMMAND_BURST_MS,
      );
    },

    recordBufferedAmount(socket) {
      const bufferedAmount = socket ? socket.bufferedAmount || 0 : 0;
      health.lastBufferedAmount = bufferedAmount;
      health.maxBufferedAmount = Math.max(health.maxBufferedAmount || 0, bufferedAmount);
      return bufferedAmount;
    },

    noteOutboundActivity(kind, metadata, socket) {
      const at = now();
      const detail = metadata ?? {};

      health.lastOutboundAt = at;
      health.recordBufferedAmount(socket);

      if (kind === "command") {
        health.lastCommandAt = at;
        health.recentCommandTimes.push(at);
        health.trimCommandBurst(at);
      }

      health.pushEvent(`send-${kind}`, {
        size: detail.size ?? 0,
        preview: detail.preview ?? "",
        bufferedAmount: health.lastBufferedAmount,
      });
    },

    recordInboundText(at) {
      health.lastInboundAt = at;
      health.lastInboundTextAt = at;
      health.stalledAt = null;
    },

    recordInboundGmcp(at) {
      health.lastInboundAt = at;
      health.lastInboundGmcpAt = at;
      health.stalledAt = null;
    },

    evaluateStall(socket, at) {
      health.trimCommandBurst(at);
      const bufferedAmount = health.recordBufferedAmount(socket);
      const inboundAt = health.lastInboundAt || 0;
      const commandBurstActive = health.recentCommandTimes.length >= WS_STALL_COMMAND_BURST_COUNT;
      const latestCommandAt = health.lastCommandAt || 0;
      const noInboundSinceLatestCommand = latestCommandAt > 0 && inboundAt < latestCommandAt;
      const stalledByCommandBurst =
        commandBurstActive &&
        noInboundSinceLatestCommand &&
        at - latestCommandAt >= WS_STALL_WINDOW_MS;
      const stalledByBufferedBacklog =
        bufferedAmount >= WS_STALLED_BUFFERED_THRESHOLD &&
        at - (health.lastOutboundAt || at) >= WS_STALL_WINDOW_MS &&
        at - inboundAt >= WS_STALL_WINDOW_MS;

      if (stalledByCommandBurst || stalledByBufferedBacklog) {
        if (!health.stalledAt) {
          health.stalledAt = at;
          health.pushEvent("stalled", {
            bufferedAmount,
            commandBurstCount: health.recentCommandTimes.length,
            msSinceLastInbound: inboundAt ? at - inboundAt : null,
            msSinceLastCommand: latestCommandAt ? at - latestCommandAt : null,
          });
        }
        return stalledByBufferedBacklog ? "buffer-backlog" : "command-burst";
      }

      health.stalledAt = null;
      return null;
    },

    resetSocketFields() {
      health.currentUrl = null;
      health.stalledAt = null;
      health.recentCommandTimes = [];
    },

    snapshot(options) {
      return {
        url: health.currentUrl,
        readyState: options.readyState,
        readyStateName: options.readyStateName,
        connectionPending: options.connectionPending,
        reconnectAttempts: options.reconnectAttempts,
        connectTime: options.connectTime,
        lastOpenAt: health.lastOpenAt,
        lastInboundAt: health.lastInboundAt,
        lastInboundTextAt: health.lastInboundTextAt,
        lastInboundGmcpAt: health.lastInboundGmcpAt,
        lastOutboundAt: health.lastOutboundAt,
        lastCommandAt: health.lastCommandAt,
        lastErrorAt: health.lastErrorAt,
        lastCloseAt: health.lastCloseAt,
        lastHandlerErrorAt: health.lastHandlerErrorAt,
        bufferedAmount: options.bufferedAmount,
        lastBufferedAmount: health.lastBufferedAmount,
        maxBufferedAmount: health.maxBufferedAmount,
        stalledAt: health.stalledAt,
        forcedReconnects: health.forcedReconnects,
        recentCommandCount: health.recentCommandTimes.length,
        events: health.events.slice(-50),
      };
    },
  };

  return health;
}
