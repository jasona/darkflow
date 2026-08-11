import type { SessionEventBus } from "../runtime/event-bus.ts";
import type { ResourceScope } from "../runtime/resource-scope.ts";
import type { Disposer } from "../runtime/resource-scope.ts";
import type { TransportHealth } from "./health.ts";
import { buildConnectionUrl, buildTransportLadder } from "./urls.ts";
import type {
  TransportEndpoint,
  TransportName,
  TransportReconnectStatusPayload,
  WebSocketLike,
} from "./types.ts";

export const WS_FORCE_RECONNECT_DELAY_MS = 250;
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30000;
export const UPGRADE_PROBE_DELAY_MS = 4000;
export const UPGRADE_PROBE_RETRY_MS = 15000;
export const HANDSHAKE_RESEND_DELAY_MS = 3000;
export const LOST_TRANSMISSION_PATTERN = /\*\*\* Text lost in transmission \*\*\*/;
export const LOST_TRANSMISSION_RECOVERY_DELAY_MS = 750;
export const LOST_TRANSMISSION_RECOVERY_COOLDOWN_MS = 30000;

/** Dependencies shared by reconnect timer state machines. */
export interface ReconnectDeps {
  scope: ResourceScope;
  eventBus: SessionEventBus;
  getEndpoint: () => TransportEndpoint;
  getAutoReconnect: () => boolean;
  isLoggedIntoCharacter: () => boolean;
  getCurrentSocket: () => WebSocketLike | null;
  isSocketOpen: (socket: WebSocketLike | null) => boolean;
  onRetry: () => void;
  onUpgrade: (reason: string) => void;
  appOrigin: string;
  webSocketFactory: (url: string) => WebSocketLike;
  now?: () => number;
}

/** Mutable ladder and reconnect attempt state for one transport session. */
export interface ReconnectState {
  reconnectAttempts: number;
  transportIndex: number;
  activeLadder: TransportName[] | null;
  ladderSelection: string | null;
  cycleRungsTried: number;
}

/** Timer handles owned by the reconnect controller. */
export interface ReconnectTimers {
  reconnectRelease: Disposer | null;
  upgradeProbeRelease: Disposer | null;
  upgradeProbeSocketRelease: Disposer | null;
  handshakeGuardRelease: Disposer | null;
  lostTransmissionRelease: Disposer | null;
}

/** Session-scoped reconnect, ladder cycling, and guard timer controller. */
export interface ReconnectController {
  state: ReconnectState;
  timers: ReconnectTimers;
  currentTransport(): TransportName | null;
  nextTransport(): TransportName;
  resetTransportLadder(): void;
  advanceTransport(reason: string): void;
  emitReconnectStatus(detail: Partial<TransportReconnectStatusPayload>): void;
  hasPendingReconnect(): boolean;
  cancelReconnectTimer(): void;
  computeBackoffDelay(): number;
  handleRungFailure(reason: string): boolean;
  scheduleReconnect(): void;
  scheduleRetry(delayMs: number, reason: string): void;
  scheduleUpgradeProbe(
    forWs: WebSocketLike,
    delayMs: number | undefined,
    connectedVia: TransportName,
  ): void;
  cancelUpgradeProbe(): void;
  scheduleHandshakeGuard(forWs: WebSocketLike, health: TransportHealth): void;
  cancelHandshakeGuard(): void;
  scheduleLostTransmissionRecovery(text: string, health: TransportHealth): void;
  cancelLostTransmissionRecovery(): void;
  cancelAllTimers(): void;
}

/** Computes exponential reconnect delay capped at RECONNECT_MAX_MS. */
export function computeReconnectDelay(attempts: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** (attempts - 1), RECONNECT_MAX_MS);
}

/** Creates reconnect/ladder/guard state machines bound to one session scope. */
export function createReconnectController(deps: ReconnectDeps): ReconnectController {
  const now = deps.now ?? Date.now;
  const state: ReconnectState = {
    reconnectAttempts: 0,
    transportIndex: 0,
    activeLadder: null,
    ladderSelection: null,
    cycleRungsTried: 0,
  };
  const timers: ReconnectTimers = {
    reconnectRelease: null,
    upgradeProbeRelease: null,
    upgradeProbeSocketRelease: null,
    handshakeGuardRelease: null,
    lostTransmissionRelease: null,
  };
  let lastLostTransmissionRecoveryAt = 0;

  const controller: ReconnectController = {
    state,
    timers,

    currentTransport() {
      if (!state.activeLadder || state.activeLadder.length === 0) {
        return null;
      }
      return state.activeLadder[state.transportIndex % state.activeLadder.length] ?? null;
    },

    nextTransport() {
      const endpoint = deps.getEndpoint();
      const selected = endpoint.protocol || "wss";
      if (
        !state.activeLadder ||
        state.ladderSelection !== selected ||
        state.cycleRungsTried === 0
      ) {
        state.activeLadder = buildTransportLadder(selected);
        state.ladderSelection = selected;
        if (state.cycleRungsTried === 0) {
          state.transportIndex = 0;
        }
      }
      return state.activeLadder[state.transportIndex % state.activeLadder.length] ?? "wss";
    },

    resetTransportLadder() {
      state.transportIndex = 0;
      state.cycleRungsTried = 0;
    },

    advanceTransport(reason) {
      if (!state.activeLadder || state.activeLadder.length < 2) {
        return;
      }
      const from = controller.currentTransport();
      state.transportIndex = (state.transportIndex + 1) % state.activeLadder.length;
      const to = controller.currentTransport();
      deps.eventBus.publish("transport:transport-fallback", { from, to, reason });
    },

    emitReconnectStatus(detail) {
      const payload: TransportReconnectStatusPayload = {
        status: detail.status ?? "idle",
        attempt: state.reconnectAttempts,
        transport: detail.transport ?? controller.currentTransport(),
        ...(detail.delayMs !== undefined ? { delayMs: detail.delayMs } : {}),
        ...(detail.nextAttemptAt !== undefined ? { nextAttemptAt: detail.nextAttemptAt } : {}),
        ...(detail.reason !== undefined ? { reason: detail.reason } : {}),
        ...(detail.url !== undefined ? { url: detail.url } : {}),
        ...(detail.userDisconnected !== undefined
          ? { userDisconnected: detail.userDisconnected }
          : {}),
      };
      deps.eventBus.publish("transport:reconnect-status", payload);
    },

    hasPendingReconnect() {
      return timers.reconnectRelease !== null;
    },

    cancelReconnectTimer() {
      if (timers.reconnectRelease) {
        timers.reconnectRelease();
        timers.reconnectRelease = null;
      }
    },

    computeBackoffDelay() {
      return computeReconnectDelay(state.reconnectAttempts);
    },

    handleRungFailure(reason) {
      state.cycleRungsTried += 1;
      if (state.activeLadder && state.cycleRungsTried < state.activeLadder.length) {
        controller.advanceTransport(reason);
        controller.scheduleRetry(WS_FORCE_RECONNECT_DELAY_MS, reason);
        return true;
      }
      state.cycleRungsTried = 0;
      return false;
    },

    scheduleReconnect() {
      if (timers.reconnectRelease) {
        return;
      }
      state.reconnectAttempts += 1;
      const delay = controller.computeBackoffDelay();
      controller.emitReconnectStatus({
        status: "scheduled",
        delayMs: delay,
        nextAttemptAt: now() + delay,
      });
      timers.reconnectRelease = deps.scope.setTimeout(() => {
        timers.reconnectRelease = null;
        deps.onRetry();
      }, delay);
    },

    scheduleRetry(delayMs, reason) {
      controller.cancelReconnectTimer();
      controller.emitReconnectStatus({
        status: "scheduled",
        delayMs,
        nextAttemptAt: now() + delayMs,
        reason,
      });
      timers.reconnectRelease = deps.scope.setTimeout(() => {
        timers.reconnectRelease = null;
        deps.onRetry();
      }, delayMs);
    },

    cancelUpgradeProbe() {
      if (timers.upgradeProbeRelease) {
        timers.upgradeProbeRelease();
        timers.upgradeProbeRelease = null;
      }
      if (timers.upgradeProbeSocketRelease) {
        timers.upgradeProbeSocketRelease();
        timers.upgradeProbeSocketRelease = null;
      }
    },

    scheduleUpgradeProbe(forWs, delayMs, connectedVia) {
      controller.cancelUpgradeProbe();
      timers.upgradeProbeRelease = deps.scope.setTimeout(() => {
        timers.upgradeProbeRelease = null;
        const current = deps.getCurrentSocket();
        if (current !== forWs || !deps.isSocketOpen(current)) {
          return;
        }
        if (deps.isLoggedIntoCharacter()) {
          return;
        }

        const endpoint = deps.getEndpoint();
        const selected = endpoint.protocol || "wss";
        const ladder = buildTransportLadder(selected);
        const top = ladder[0];
        if (!top || top === connectedVia) {
          return;
        }
        if (top !== "ws" && top !== "wss") {
          return;
        }

        let probe: WebSocketLike;
        try {
          probe = deps.webSocketFactory(
            buildConnectionUrl({ ...endpoint, protocol: top }, deps.appOrigin),
          );
        } catch {
          controller.scheduleUpgradeProbe(forWs, UPGRADE_PROBE_RETRY_MS, connectedVia);
          return;
        }

        timers.upgradeProbeSocketRelease = deps.scope.own("socket", () => {
          try {
            probe.close(1000, "probe-cancel");
          } catch {
            // Ignore close failures on cancelled probes.
          }
        });

        probe.onopen = () => {
          try {
            probe.close(1000, "upgrade-probe");
          } catch {
            // Ignore close failures after a successful probe.
          }
          if (timers.upgradeProbeSocketRelease) {
            timers.upgradeProbeSocketRelease();
            timers.upgradeProbeSocketRelease = null;
          }
          const live = deps.getCurrentSocket();
          if (live !== forWs || !deps.isSocketOpen(live)) {
            return;
          }
          if (deps.isLoggedIntoCharacter()) {
            return;
          }
          deps.eventBus.publish("transport:upgrade-available", { from: connectedVia, to: top });
          controller.resetTransportLadder();
          deps.onUpgrade(`upgrading to ${top}`);
        };

        probe.onerror = () => {
          if (timers.upgradeProbeSocketRelease) {
            timers.upgradeProbeSocketRelease();
            timers.upgradeProbeSocketRelease = null;
          }
          const live = deps.getCurrentSocket();
          if (live === forWs && deps.isSocketOpen(live) && !deps.isLoggedIntoCharacter()) {
            controller.scheduleUpgradeProbe(forWs, UPGRADE_PROBE_RETRY_MS, connectedVia);
          }
        };
      }, delayMs ?? UPGRADE_PROBE_DELAY_MS);
    },

    cancelHandshakeGuard() {
      if (timers.handshakeGuardRelease) {
        timers.handshakeGuardRelease();
        timers.handshakeGuardRelease = null;
      }
    },

    scheduleHandshakeGuard(forWs, health) {
      controller.cancelHandshakeGuard();
      timers.handshakeGuardRelease = deps.scope.setTimeout(() => {
        timers.handshakeGuardRelease = null;
        const current = deps.getCurrentSocket();
        if (current !== forWs || !deps.isSocketOpen(current)) {
          return;
        }
        const openAt = health.lastOpenAt || 0;
        const gmcpAt = health.lastInboundGmcpAt || 0;
        if (gmcpAt >= openAt) {
          return;
        }
        health.pushEvent("handshake-resend", {
          msSinceOpen: now() - openAt,
          hadText: (health.lastInboundTextAt || 0) >= openAt,
        });
        deps.eventBus.publish("transport:handshake-guard-elapsed", {
          msSinceOpen: now() - openAt,
          hadText: (health.lastInboundTextAt || 0) >= openAt,
        });
      }, HANDSHAKE_RESEND_DELAY_MS);
    },

    cancelLostTransmissionRecovery() {
      if (timers.lostTransmissionRelease) {
        timers.lostTransmissionRelease();
        timers.lostTransmissionRelease = null;
      }
    },

    scheduleLostTransmissionRecovery(text, health) {
      if (!LOST_TRANSMISSION_PATTERN.test(String(text || ""))) {
        return;
      }
      if (!deps.isSocketOpen(deps.getCurrentSocket())) {
        return;
      }

      const at = now();
      if (
        timers.lostTransmissionRelease ||
        (lastLostTransmissionRecoveryAt > 0 &&
          at - lastLostTransmissionRecoveryAt < LOST_TRANSMISSION_RECOVERY_COOLDOWN_MS)
      ) {
        return;
      }

      health.pushEvent("lost-transmission-detected", {
        msSinceLastRecovery: lastLostTransmissionRecoveryAt
          ? at - lastLostTransmissionRecoveryAt
          : null,
      });
      deps.eventBus.publish("transport:lost-transmission-detected", {
        msSinceLastRecovery: lastLostTransmissionRecoveryAt
          ? at - lastLostTransmissionRecoveryAt
          : null,
      });

      timers.lostTransmissionRelease = deps.scope.setTimeout(() => {
        timers.lostTransmissionRelease = null;
        lastLostTransmissionRecoveryAt = now();
        if (!deps.isSocketOpen(deps.getCurrentSocket())) {
          return;
        }
        health.pushEvent("lost-transmission-recovery", {});
      }, LOST_TRANSMISSION_RECOVERY_DELAY_MS);
    },

    cancelAllTimers() {
      controller.cancelReconnectTimer();
      controller.cancelUpgradeProbe();
      controller.cancelHandshakeGuard();
      controller.cancelLostTransmissionRecovery();
    },
  };

  return controller;
}
