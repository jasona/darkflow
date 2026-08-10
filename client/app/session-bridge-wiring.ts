import type { CoreHello } from "../gmcp/contracts/core.ts";
import { identityKeyForDefinition } from "../configuration/identity.ts";
import { resolveEffectiveConfiguration } from "../configuration/resolve.ts";
import {
  replaceLocalDefinitions as serviceReplaceLocalDefinitions,
  subscribe as serviceSubscribe,
} from "../configuration/service.ts";
import type { ConfigKind } from "../model/configuration.ts";
import type { CharacterProfileId } from "../model/ids.ts";
import type { ApplicationStateV1 } from "../model/profiles.ts";
import { computeActiveScopeKey, type ConfigJson } from "../storage/config-validator.ts";
import { readState, type StorageLike } from "../storage/repository.ts";
import type { SessionGmcpBus } from "../gmcp/bus.ts";
import type { Session } from "../runtime/session.ts";
import type { SessionFacadeHandles } from "../runtime/session-factory.ts";
import type { TransportReconnectStatusPayload } from "../transport/types.ts";
import type { TransportState } from "../transport/types.ts";
import {
  resolveLegacyToolbarEndpoint,
  readLiveToolbarEndpointInput,
  type LegacyToolbarEndpointInput,
} from "../transport/urls.ts";

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSED = 3;

/** Mutable legacy state object synchronized from the active session transport. */
export interface LegacyStateMirror {
  ws: WebSocketProxy | null;
  connectionPending: boolean;
  connectTime: number | null;
  bytesSent: number;
  bytesReceived: number;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  userDisconnected: boolean;
  wsHealth: Record<string, unknown>;
}

/** WebSocket-shaped proxy forwarding to one session transport. */
export interface WebSocketProxy {
  readyState: number;
  bufferedAmount: number;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

/** Legacy toolbar inputs used to mirror connection.js endpoint reads. */
export interface LegacyConnectionDom {
  host: { value: string } | null;
  port: { value: string } | null;
  protocolSelect: { value: string } | null;
}
/** Legacy DOM helpers used to mirror toolbar connection state. */
export interface LegacyConnectionUi {
  setConnectionState(state: TransportState): void;
  emitReconnectStatus(detail: Record<string, unknown>): void;
}

/** Builds the configuration compatibility bridge for one active character. */
export function buildConfigurationCompatBridge(
  storage: StorageLike,
  characterProfileId: CharacterProfileId,
) {
  return {
    getActiveCharacterProfileId(): CharacterProfileId {
      return characterProfileId;
    },
    getEffectiveDefinitions(kind: ConfigKind) {
      const state = readState(storage);
      if (!state.success || state.data === undefined) {
        throw new Error("Phase 1 session graph is not present in storage.");
      }
      const resolved = resolveEffectiveConfiguration(state.data, characterProfileId);
      if (!resolved.success || resolved.data === undefined) {
        throw new Error("Effective configuration could not be resolved.");
      }
      return resolved.data[kind];
    },
    replaceLocalDefinitions(kind: ConfigKind, definitions: unknown[]) {
      const result = serviceReplaceLocalDefinitions(
        storage,
        characterProfileId,
        kind,
        definitions as never,
      );
      if (!result.success) {
        throw new Error(`${result.code}: ${result.message}`);
      }
    },
    upsertLocalDefinitionByIdentity(kind: ConfigKind, definition: Record<string, unknown>) {
      const state = readState(storage);
      if (!state.success || state.data === undefined) {
        throw new Error("Phase 1 session graph is not present in storage.");
      }
      const character = state.data.characterProfiles[characterProfileId];
      if (!character) {
        throw new Error(
          `Character profile ${characterProfileId} is not present in the application graph.`,
        );
      }
      const locals = structuredClone(character.localDefinitions[kind] as unknown[]);
      const identityKey = identityKeyForDefinition(kind, definition);
      const index = locals.findIndex(
        (item) => identityKeyForDefinition(kind, item) === identityKey,
      );
      if (index >= 0) {
        locals[index] = structuredClone(definition);
      } else {
        locals.push(structuredClone(definition));
      }
      this.replaceLocalDefinitions(kind, locals);
    },
    removeLocalDefinitionByIdentity(kind: ConfigKind, identityKey: string) {
      const state = readState(storage);
      if (!state.success || state.data === undefined) {
        throw new Error("Phase 1 session graph is not present in storage.");
      }
      const character = state.data.characterProfiles[characterProfileId];
      if (!character) {
        throw new Error(
          `Character profile ${characterProfileId} is not present in the application graph.`,
        );
      }
      const before = character.localDefinitions[kind] as unknown[];
      const after = before.filter((item) => identityKeyForDefinition(kind, item) !== identityKey);
      if (after.length === before.length) {
        return false;
      }
      this.replaceLocalDefinitions(kind, after);
      return true;
    },
    setLocalDefinitionEnabledByIdentity(kind: ConfigKind, identityKey: string, enabled: boolean) {
      const state = readState(storage);
      if (!state.success || state.data === undefined) {
        throw new Error("Phase 1 session graph is not present in storage.");
      }
      const character = state.data.characterProfiles[characterProfileId];
      if (!character) {
        throw new Error(
          `Character profile ${characterProfileId} is not present in the application graph.`,
        );
      }
      const locals = structuredClone(character.localDefinitions[kind] as unknown[]);
      const item = locals.find((entry) => identityKeyForDefinition(kind, entry) === identityKey) as
        { enabled?: boolean } | undefined;
      if (!item) {
        return false;
      }
      item.enabled = enabled !== false;
      this.replaceLocalDefinitions(kind, locals);
      return true;
    },
    subscribe(listener: () => void) {
      return serviceSubscribe(characterProfileId, listener);
    },
  };
}

/** Builds the automation compatibility bridge from session-owned runtime state. */
export function buildAutomationCompatBridge(handles: SessionFacadeHandles) {
  const runtime = handles.automationRuntime;
  return {
    getVariable: (name: string) => runtime.getVariable(name),
    setVariable: (name: string, value: string) => runtime.setVariable(name, value),
    removeVariable: (name: string) => runtime.removeVariable(name),
    listVariableNames: () => runtime.listVariableNames(),
    getAutomationVariables: () => runtime.getAutomationVariables(),
    setGmcpVariable: (packageName: string, data: unknown) =>
      runtime.setGmcpVariable(packageName, data),
    resetGmcpVariables: () => runtime.resetGmcpVariables(),
    getGmcpVariables: () => runtime.getGmcpVariables(),
    listGmcpVariables: () => runtime.listGmcpVariables(),
    scheduleTimer: (timerId: string, durationMs: number, onFire: () => void) =>
      runtime.scheduleTimer(timerId, durationMs, onFire),
    clearTimer: (timerId: string) => runtime.clearTimer(timerId),
    getTimerRuntimeState: (timerId: string) => runtime.getTimerRuntimeState(timerId),
    scheduleWait: (delayMs: number) => runtime.scheduleWait(delayMs),
    reconcileTimers: (
      effectiveTimers: Parameters<typeof runtime.reconcileTimers>[0],
      onStart: Parameters<typeof runtime.reconcileTimers>[1],
    ) => runtime.reconcileTimers(effectiveTimers, onStart),
  };
}

/** Builds controller child scopes without exposing the root session scope to legacy code. */
export function buildControllerCompatBridge(handles: SessionFacadeHandles) {
  return {
    createScope(onDisposeStart: () => void) {
      const child = handles.scope.createChildScope();
      let disposed = false;
      const releaseStart = handles.scope.own("teardown", () => {
        if (disposed) return;
        disposed = true;
        onDisposeStart();
      });

      return {
        own: child.own.bind(child),
        setTimeout: child.setTimeout.bind(child),
        setInterval: child.setInterval.bind(child),
        requestAnimationFrame: child.requestAnimationFrame.bind(child),
        dispose() {
          if (disposed) return;
          releaseStart();
          child.dispose();
        },
      };
    },
    getDiagnostics: () => handles.getLifecycleDiagnostics(),
  };
}

function readyStateFromSnapshot(snapshot: { readyStateName: string; readyState: number }): number {
  if (typeof snapshot.readyState === "number") {
    return snapshot.readyState;
  }
  switch (snapshot.readyStateName) {
    case "connecting":
      return WS_CONNECTING;
    case "open":
      return WS_OPEN;
    default:
      return WS_CLOSED;
  }
}

/** Builds the session runtime bridge and legacy state mirror for one live session. */
export function buildSessionRuntimeCompatBridge(
  session: Session,
  handles: SessionFacadeHandles,
  legacyState: LegacyStateMirror,
  connectionUi: LegacyConnectionUi,
  getClientInfo: () => CoreHello,
  legacyDom?: LegacyConnectionDom,
) {
  const { transport, gmcp, scope, eventBus } = handles;
  let activeLegacyState = legacyState;
  let activeLegacyDom = legacyDom;
  let bytesReceived = 0;
  let syncRelease: (() => void) | null = null;
  let lastConnectionState: TransportState | null = null;
  let legacyUiReady = false;
  let inboundExpectRelease: (() => void) | null = null;

  const proxy: WebSocketProxy = {
    readyState: WS_CLOSED,
    bufferedAmount: 0,
    send(data) {
      const payload =
        typeof data === "string"
          ? data
          : data instanceof Uint8Array
            ? data
            : new Uint8Array(data as ArrayBuffer);
      transport.send(payload);
    },
    close(code, reason) {
      void code;
      void reason;
      transport.disconnect();
    },
  };

  const reconnectListeners = new Set<(detail: TransportReconnectStatusPayload) => void>();
  const connectionStateListeners = new Set<(state: TransportState) => void>();

  function mirrorHealthSnapshot(): void {
    const snapshot = transport.getHealthSnapshot();
    proxy.readyState = readyStateFromSnapshot(snapshot);
    proxy.bufferedAmount = snapshot.bufferedAmount;

    activeLegacyState.connectionPending = snapshot.connectionPending;
    activeLegacyState.connectTime = snapshot.connectTime;
    activeLegacyState.reconnectAttempts = snapshot.reconnectAttempts;
    activeLegacyState.reconnectTimer = null;
    activeLegacyState.bytesReceived = bytesReceived;

    activeLegacyState.wsHealth.currentUrl = snapshot.url;
    activeLegacyState.wsHealth.lastOpenAt = snapshot.lastOpenAt;
    activeLegacyState.wsHealth.lastInboundAt = snapshot.lastInboundAt;
    activeLegacyState.wsHealth.lastInboundTextAt = snapshot.lastInboundTextAt;
    activeLegacyState.wsHealth.lastInboundGmcpAt = snapshot.lastInboundGmcpAt;
    activeLegacyState.wsHealth.lastOutboundAt = snapshot.lastOutboundAt;
    activeLegacyState.wsHealth.lastCommandAt = snapshot.lastCommandAt;
    activeLegacyState.wsHealth.lastErrorAt = snapshot.lastErrorAt;
    activeLegacyState.wsHealth.lastCloseAt = snapshot.lastCloseAt;
    activeLegacyState.wsHealth.lastHandlerErrorAt = snapshot.lastHandlerErrorAt;
    activeLegacyState.wsHealth.lastBufferedAmount = snapshot.lastBufferedAmount;
    activeLegacyState.wsHealth.maxBufferedAmount = snapshot.maxBufferedAmount;
    activeLegacyState.wsHealth.stalledAt = snapshot.stalledAt;
    activeLegacyState.wsHealth.forcedReconnects = snapshot.forcedReconnects;
    activeLegacyState.wsHealth.recentCommandTimes = Array.from(
      { length: snapshot.recentCommandCount },
      () => snapshot.lastCommandAt ?? Date.now(),
    );
    activeLegacyState.wsHealth.events = [...snapshot.events];
  }

  function resetByteCounters(): void {
    bytesReceived = 0;
    activeLegacyState.bytesSent = 0;
    activeLegacyState.bytesReceived = 0;
  }

  function applyConnectionState(next: TransportState): void {
    if (!legacyUiReady) {
      return;
    }
    if (lastConnectionState === next) {
      return;
    }
    lastConnectionState = next;
    connectionUi.setConnectionState(next);
    for (const listener of connectionStateListeners) {
      listener(next);
    }
  }

  function cancelInboundExpectTimer(): void {
    if (inboundExpectRelease) {
      inboundExpectRelease();
      inboundExpectRelease = null;
    }
  }

  function startFacadeSync(): void {
    activeLegacyState.ws = proxy;
    mirrorHealthSnapshot();

    const unsubInboundBytes = eventBus.subscribe("transport:inbound-bytes", (event) => {
      const payload = event.payload as { kind: "text" | "gmcp"; size: number };
      bytesReceived += payload.size;
      activeLegacyState.bytesReceived = bytesReceived;
      cancelInboundExpectTimer();
    });

    const unsubReconnect = eventBus.subscribe("transport:reconnect-status", (event) => {
      const payload = event.payload as TransportReconnectStatusPayload;
      mirrorHealthSnapshot();
      connectionUi.emitReconnectStatus({ ...payload });
      for (const listener of reconnectListeners) {
        listener(payload);
      }
      if (payload.status === "connected") {
        resetByteCounters();
        applyConnectionState("connected");
      } else if (payload.status === "connecting") {
        applyConnectionState("connecting");
      } else if (payload.status === "idle") {
        applyConnectionState("disconnected");
      }
    });

    const unsubMirror = scope.setInterval(() => {
      mirrorHealthSnapshot();
      applyConnectionState(transport.state);
    }, 250);

    syncRelease = () => {
      unsubInboundBytes();
      unsubReconnect();
      unsubMirror();
      cancelInboundExpectTimer();
      activeLegacyState.ws = null;
      syncRelease = null;
      legacyUiReady = false;
      lastConnectionState = null;
    };
  }

  function markLegacyUiReady(): void {
    if (legacyUiReady) {
      return;
    }
    legacyUiReady = true;
    lastConnectionState = null;
    mirrorHealthSnapshot();
    applyConnectionState(transport.state);
  }

  function stopFacadeSync(): void {
    syncRelease?.();
    syncRelease = null;
    activeLegacyState.ws = null;
  }

  scope.own("subscription", () => {
    stopFacadeSync();
  });

  function readToolbarEndpointInput(): LegacyToolbarEndpointInput | null {
    const live = readLiveToolbarEndpointInput();
    if (live) {
      return live;
    }
    if (!activeLegacyDom) {
      return null;
    }
    return {
      host: activeLegacyDom.host?.value ?? "",
      port: activeLegacyDom.port?.value ?? "",
      protocol: activeLegacyDom.protocolSelect?.value ?? "",
    };
  }

  function syncEndpointFromToolbar(): void {
    const toolbar = readToolbarEndpointInput();
    const endpoint = resolveLegacyToolbarEndpoint(handles.getBaselineEndpoint(), toolbar);
    handles.setConnectionEndpoint(endpoint);
  }

  function bindLegacyUiTargets(nextState: LegacyStateMirror, nextDom: LegacyConnectionDom): void {
    activeLegacyState = nextState;
    activeLegacyDom = nextDom;
    if (syncRelease) {
      activeLegacyState.ws = proxy;
    }
  }

  return {
    bindLegacyUiTargets,
    connect: () => {
      activeLegacyState.userDisconnected = false;
      syncEndpointFromToolbar();
      transport.connect();
      mirrorHealthSnapshot();
      applyConnectionState(transport.state);
    },
    disconnect: () => {
      activeLegacyState.userDisconnected = true;
      transport.disconnect();
      mirrorHealthSnapshot();
      applyConnectionState("disconnected");
      connectionUi.emitReconnectStatus({ status: "idle", userDisconnected: true });
    },
    retryNow: () => {
      activeLegacyState.userDisconnected = false;
      syncEndpointFromToolbar();
      transport.retryNow();
      mirrorHealthSnapshot();
    },
    forceReconnect: (reason: string) => {
      syncEndpointFromToolbar();
      transport.forceReconnect(reason);
      mirrorHealthSnapshot();
    },
    ensureConnected: () => {
      activeLegacyState.userDisconnected = false;
      if (transport.state === "connected" || transport.state === "connecting") {
        return;
      }
      syncEndpointFromToolbar();
      transport.connect();
      mirrorHealthSnapshot();
    },
    expectInboundWithin: (ms: number, reason?: string) => {
      cancelInboundExpectTimer();
      const since = transport.getHealthSnapshot().lastInboundAt || 0;
      inboundExpectRelease = scope.setTimeout(() => {
        inboundExpectRelease = null;
        if (transport.state !== "connected") {
          return;
        }
        if ((transport.getHealthSnapshot().lastInboundAt || 0) > since) {
          return;
        }
        transport.forceReconnect(reason || "no response to client request");
        mirrorHealthSnapshot();
      }, ms);
    },
    sendPayload: (payload: string | Uint8Array, metadata?: Record<string, unknown>) => {
      const sent = transport.send(payload, metadata);
      mirrorHealthSnapshot();
      return sent;
    },
    getWebSocketProxy: () => proxy,
    getHealthSnapshot: () => transport.getHealthSnapshot(),
    getConnectionState: () => transport.state,
    getSessionId: () => session.sessionId,
    subscribeReconnectStatus: (listener: (detail: TransportReconnectStatusPayload) => void) => {
      reconnectListeners.add(listener);
      return () => reconnectListeners.delete(listener);
    },
    subscribeConnectionState: (listener: (state: TransportState) => void) => {
      connectionStateListeners.add(listener);
      return () => connectionStateListeners.delete(listener);
    },
    gmcpOn: (packageName: string, callback: (...args: unknown[]) => void) => {
      gmcp.on(packageName, callback as never);
    },
    gmcpOff: (packageName: string, callback: (...args: unknown[]) => void) => {
      gmcp.off(packageName, callback as never);
    },
    gmcpDispatch: (packageName: string, data: unknown) => {
      gmcp.dispatch(packageName, data);
    },
    gmcpSend: (packageName: string, data?: unknown) => {
      const payload = data !== undefined ? packageName + " " + JSON.stringify(data) : packageName;
      return transport.send(new TextEncoder().encode(payload), {
        kind: "gmcp",
        size: payload.length,
        preview: packageName,
      });
    },
    gmcpServerSupportsPackage: (packageName: string) => gmcp.serverSupportsPackage(packageName),
    gmcpSendHandshake: () => gmcp.sendHandshake(getClientInfo()),
    gmcpReset: () => {
      (gmcp as SessionGmcpBus & { reset(): void }).reset();
    },
    gmcpSendSubscriptions: (payload?: Record<string, unknown>) => gmcp.sendSubscriptions(payload),
    gmcpRequestMediaRefresh: () => gmcp.requestMediaRefresh(),
    gmcpRequestChannelPlayers: () => gmcp.requestChannelPlayers(),
    gmcpEnableChannel: (channel: string) => gmcp.enableChannel(channel),
    gmcpRestartHandshake: (payload?: Record<string, unknown>) => gmcp.restartHandshake(payload),
    startFacadeSync,
    stopFacadeSync,
    markLegacyUiReady,
    gmcpIsEnabled: () => gmcp.enabled,
  };
}

/** Resolves the active character profile id from validated application state. */
export function resolveActiveCharacterProfileId(
  state: ApplicationStateV1,
  urlSearchParams: URLSearchParams,
  configJson: ConfigJson,
): CharacterProfileId {
  const defaultId = state.defaults.defaultCharacterProfileId;
  if (defaultId && state.characterProfiles[defaultId]) {
    return defaultId;
  }

  const scopeKey = computeActiveScopeKey({ urlSearchParams, config: configJson });
  for (const character of Object.values(state.characterProfiles)) {
    const server = state.serverProfiles[character.serverProfileId];
    if (!server) {
      continue;
    }
    const bucket = server.protocol === "wss" || server.protocol === "telnets" ? "wss" : "ws";
    const candidate = `${bucket}://${server.host}:${server.port}`;
    if (candidate === scopeKey) {
      return character.id;
    }
  }

  const first = Object.values(state.characterProfiles)[0];
  if (!first) {
    throw new Error("No character profiles are present in the application graph.");
  }
  return first.id;
}
