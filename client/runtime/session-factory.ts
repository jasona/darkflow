import { resolveEffectiveConfiguration } from "../configuration/resolve.ts";
import { subscribe } from "../configuration/service.ts";
import { createSessionGmcpBus, type SessionGmcpBus } from "../gmcp/bus.ts";
import type { CoreHello } from "../gmcp/contracts/core.ts";
import type { CharacterProfileId, ServerProfileId, UuidFactory } from "../model/ids.ts";
import { createSessionId } from "../model/ids.ts";
import type { ApplicationStateV1 } from "../model/profiles.ts";
import type { SessionRegistry } from "../model/session-contract.ts";
import { createSessionTransport } from "../transport/connection.ts";
import type { SessionTransport } from "../transport/types.ts";
import type { WebSocketLike } from "../transport/types.ts";
import type { TransportEndpoint } from "../transport/types.ts";
import { SessionDiagnostics } from "./diagnostics.ts";
import { createSessionEventBus } from "./event-bus.ts";
import { createResourceScope } from "./resource-scope.ts";
import { createSessionRuntimeState } from "./runtime-state.ts";
import { createAutomationRuntimeState, type AutomationRuntimeState } from "./automation-runtime.ts";
import { createSession, type Session } from "./session.ts";
import type { SessionEventBus } from "./event-bus.ts";
import type { ResourceScope } from "./resource-scope.ts";

/** Wiring handles exposed to Phase 1 compatibility facades; not part of the public Session API. */
export interface SessionFacadeHandles {
  gmcp: SessionGmcpBus;
  transport: SessionTransport;
  scope: ResourceScope;
  automationRuntime: AutomationRuntimeState;
  eventBus: SessionEventBus;
  /** Read-only lifecycle counters exposed to compatibility diagnostics. */
  getLifecycleDiagnostics(): ReturnType<SessionDiagnostics["snapshot"]>;
  /** Updates the live transport endpoint read on each connect attempt. */
  setConnectionEndpoint(endpoint: TransportEndpoint): void;
  /** Returns the migrated server profile endpoint before toolbar overrides. */
  getBaselineEndpoint(): TransportEndpoint;
}

/** Injected dependencies required to construct a session from application state. */
export interface SessionFactoryDeps {
  uuidFactory: UuidFactory;
  registry: SessionRegistry;
  getAutoReconnect: () => boolean;
  getClientInfo: () => CoreHello;
  appOrigin: string;
  webSocketFactory: (url: string) => WebSocketLike;
  onlineTarget: { addEventListener(type: string, listener: () => void): void };
  now?: () => number;
  onText: (text: string) => void;
}

/** Result of attempting to create a session from validated application state. */
export type SessionFactoryResult =
  | { success: true; data: Session; handles: SessionFacadeHandles }
  | {
      success: false;
      code: "unknown-server-profile" | "unknown-character-profile" | "character-server-mismatch";
      message: string;
    };

/** Validates profiles, claims the registry, and composes a live session. */
export function createSessionFromState(
  state: ApplicationStateV1,
  serverProfileId: ServerProfileId,
  characterProfileId: CharacterProfileId,
  deps: SessionFactoryDeps,
): SessionFactoryResult {
  const serverProfile = state.serverProfiles[serverProfileId];
  if (serverProfile === undefined) {
    return {
      success: false,
      code: "unknown-server-profile",
      message: `Server profile ${serverProfileId} is not present in the application graph.`,
    };
  }

  const characterProfile = state.characterProfiles[characterProfileId];
  if (characterProfile === undefined) {
    return {
      success: false,
      code: "unknown-character-profile",
      message: `Character profile ${characterProfileId} is not present in the application graph.`,
    };
  }

  if (characterProfile.serverProfileId !== serverProfileId) {
    return {
      success: false,
      code: "character-server-mismatch",
      message: `Character profile ${characterProfileId} does not belong to server profile ${serverProfileId}.`,
    };
  }

  const resolved = resolveEffectiveConfiguration(state, characterProfileId);
  if (!resolved.success || resolved.data === undefined) {
    return {
      success: false,
      code: "unknown-character-profile",
      message: `Character profile ${characterProfileId} could not resolve effective configuration.`,
    };
  }

  const sessionId = createSessionId(deps.uuidFactory);
  const descriptor = {
    sessionId,
    serverProfileId,
    characterProfileId,
  };

  deps.registry.claim(descriptor);

  const diagnostics = new SessionDiagnostics(sessionId);
  const scope = createResourceScope(sessionId, diagnostics);
  const eventBus = createSessionEventBus(sessionId, diagnostics);

  const compositionRefs: {
    transport: SessionTransport | null;
    runtimeState: ReturnType<typeof createSessionRuntimeState> | null;
  } = {
    transport: null,
    runtimeState: null,
  };

  const gmcp = createSessionGmcpBus(
    sessionId,
    (bytes) => compositionRefs.transport!.send(bytes),
    diagnostics,
  );

  const baselineEndpoint: TransportEndpoint = {
    host: serverProfile.host,
    port: String(serverProfile.port),
    protocol: serverProfile.protocol,
  };
  const connectionEndpoint: TransportEndpoint = { ...baselineEndpoint };

  const transport = createSessionTransport(
    sessionId,
    scope,
    eventBus,
    diagnostics,
    {
      getEndpoint: () => ({ ...connectionEndpoint }),
      getAutoReconnect: deps.getAutoReconnect,
      isLoggedIntoCharacter: () => compositionRefs.runtimeState!.isLoggedIntoCharacter(),
      onText: deps.onText,
      onGmcpFrame: (packageName, data) => {
        gmcp.dispatch(packageName, data);
      },
    },
    {
      appOrigin: deps.appOrigin,
      webSocketFactory: deps.webSocketFactory,
      onlineTarget: deps.onlineTarget,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    },
  );
  compositionRefs.transport = transport;

  const runtimeState = createSessionRuntimeState(resolved.data);
  compositionRefs.runtimeState = runtimeState;

  const automationRuntime = createAutomationRuntimeState(scope);

  const unsubscribeConfiguration = subscribe(characterProfileId, (snapshot) => {
    runtimeState.setEffectiveConfiguration(snapshot);
  });

  const session = createSession({
    descriptor,
    registry: deps.registry,
    scope,
    eventBus,
    diagnostics,
    transport,
    gmcp,
    runtimeState,
    getClientInfo: deps.getClientInfo,
    unsubscribeConfiguration,
  });

  return {
    success: true,
    data: session,
    handles: {
      gmcp,
      transport,
      scope,
      automationRuntime,
      eventBus,
      getLifecycleDiagnostics() {
        return diagnostics.snapshot();
      },
      setConnectionEndpoint(endpoint: TransportEndpoint) {
        connectionEndpoint.host = endpoint.host;
        connectionEndpoint.port = endpoint.port;
        connectionEndpoint.protocol = endpoint.protocol;
      },
      getBaselineEndpoint() {
        return { ...baselineEndpoint };
      },
    },
  };
}
