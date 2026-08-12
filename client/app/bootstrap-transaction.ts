import typia from "typia";

import {
  buildAutomationCompatBridge,
  buildConfigurationCompatBridge,
  buildControllerCompatBridge,
  buildSessionRuntimeCompatBridge,
  resolveActiveCharacterProfileId,
  type LegacyStateMirror,
} from "./session-bridge-wiring.ts";
import { createSessionRegistry } from "../runtime/session-registry.ts";
import { createSessionFromState } from "../runtime/session-factory.ts";
import type { Session } from "../runtime/session.ts";
import {
  DEFAULT_CONFIG_JSON,
  validateConfigJsonInput,
  type ConfigJson,
} from "../storage/config-validator.ts";
import { migrateLegacyData } from "../storage/legacy-migration.ts";
import { readState, type StorageLike } from "../storage/repository.ts";
import type { CharacterProfileId, ServerProfileId } from "../model/ids.ts";
import type { TransportState } from "../transport/types.ts";

/** Temporary Phase 1 bootstrap diagnostic exposed until later cutover steps finish. */
export interface BootstrapDiagnostic {
  phase: "bootstrapping" | "legacy-loaded" | "client-loaded";
}

/** Extended diagnostic published when a live session is installed at boot. */
export interface SessionBootstrapDiagnostic {
  phase: "session-ready";
  sessionId: string;
  characterProfileId: CharacterProfileId;
  serverProfileId: ServerProfileId;
}

/** Window-owned runtime record preventing same-document double session creation. */
export interface Phase1RuntimeRecord {
  session: Session;
  characterProfileId: CharacterProfileId;
  serverProfileId: ServerProfileId;
  shell: ShellBootstrap;
  clientLoaded: boolean;
}

/** Values a shell needs at its public session boundary. */
export interface ShellBootstrap {
  gameName: string;
  themeKey: string;
  shouldAutoConnect: boolean;
  zorkOnly: boolean;
}

/** Installed bridge handles retained for transactional reset on partial boot failure. */
export interface InstalledCompatBridges {
  configuration: unknown;
  automation: unknown;
  runtime: unknown;
  controllers: unknown;
}

const validateBootstrapDiagnostic = typia.createValidate<BootstrapDiagnostic>();

export interface CompatModule {
  installConfigurationCompatBridge?: (bridge: unknown) => void;
  installAutomationCompatBridge?: (bridge: unknown) => void;
  installSessionRuntimeBridge?: (bridge: unknown) => void;
  installControllerCompatBridge?: (bridge: unknown) => void;
  resetConfigurationCompatBridgeForTests: () => void;
  resetAutomationCompatBridgeForTests: () => void;
  resetSessionRuntimeBridgeForTests: () => void;
  resetControllerCompatBridgeForTests: () => void;
}

export interface BootstrapLegacyState extends LegacyStateMirror {
  settings: { autoReconnect?: boolean };
  clientVersion: string;
  terminalGeometry?: { columns?: number; rows?: number };
}

export interface LegacyConnectionUi {
  setConnectionState: (state: TransportState) => void;
  emitReconnectStatus(detail: Record<string, unknown>): void;
}

export interface BootTransactionDeps {
  storage: StorageLike;
  urlSearchParams: URLSearchParams;
  uuidFactory: () => string;
  fetchConfig: () => Promise<unknown>;
  importModule: <T = Record<string, unknown>>(entry: string) => Promise<T>;
  loadClient: (record: Phase1RuntimeRecord) => Promise<void>;
  setBootstrapPhase: (phase: BootstrapDiagnostic["phase"]) => void;
  readRuntimeSlot: () => Phase1RuntimeRecord | null;
  writeRuntimeSlot: (record: Phase1RuntimeRecord) => void;
  clearRuntimeSlot: () => void;
  publishSessionDiagnostic: (diagnostic: SessionBootstrapDiagnostic) => void;
  clearSessionDiagnostic: () => void;
  webSocketFactory: (url: string) => WebSocket;
  onlineTarget: { addEventListener(type: string, listener: () => void): void };
  appOrigin: string;
  launchUrl: string;
  onText: (text: string) => void;
  /** When set, invoked after session creation to simulate partial boot failure. */
  injectPostCreateFailure?: () => void;
}

export interface BootTransactionResult {
  kind: "created" | "reused";
  record: Phase1RuntimeRecord;
}

/** Reads the persistent same-document runtime slot, ignoring disposed sessions. */
export function readPhase1RuntimeSlot(
  target: Window & { __darkflowPhase1Runtime?: Phase1RuntimeRecord },
): Phase1RuntimeRecord | null {
  const record = target.__darkflowPhase1Runtime;
  if (!record || record.session.disposed) {
    return null;
  }
  return record;
}

/** Writes the persistent same-document runtime slot. */
export function writePhase1RuntimeSlot(
  target: Window & { __darkflowPhase1Runtime?: Phase1RuntimeRecord },
  record: Phase1RuntimeRecord,
): void {
  target.__darkflowPhase1Runtime = record;
}

/** Clears the persistent same-document runtime slot. */
export function clearPhase1RuntimeSlot(
  target: Window & { __darkflowPhase1Runtime?: Phase1RuntimeRecord },
): void {
  delete target.__darkflowPhase1Runtime;
}

/** Resets every installed compatibility bridge. */
export function resetInstalledCompatBridges(
  configCompat: CompatModule,
  automationCompat: CompatModule,
  runtimeCompat: CompatModule,
  controllerCompat: CompatModule,
): void {
  configCompat.resetConfigurationCompatBridgeForTests();
  automationCompat.resetAutomationCompatBridgeForTests();
  runtimeCompat.resetSessionRuntimeBridgeForTests();
  controllerCompat.resetControllerCompatBridgeForTests();
}

/** Validates and publishes the coarse bootstrap phase diagnostic. */
export function publishBootstrapPhase(
  target: Window & { __darkflowPhase1Bootstrap?: BootstrapDiagnostic },
  phase: BootstrapDiagnostic["phase"],
): void {
  const diagnostic: BootstrapDiagnostic = { phase };
  if (!validateBootstrapDiagnostic(diagnostic).success) {
    throw new Error("Bootstrap diagnostic validation failed");
  }
  target.__darkflowPhase1Bootstrap = diagnostic;
}

/** Defers telnet text delivery until legacy initOutput has bound appendOutput. */
export function createDeferredTextOutputSink() {
  let appendOutput: ((text: string) => void) | null = null;
  const pending: string[] = [];

  return {
    deliver(text: string): void {
      if (appendOutput) {
        appendOutput(text);
        return;
      }
      pending.push(text);
    },
    bind(nextAppendOutput: (text: string) => void): void {
      appendOutput = nextAppendOutput;
      for (const text of pending) {
        nextAppendOutput(text);
      }
      pending.length = 0;
    },
  };
}

function isTruthyUrlValue(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  return ["", "1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isZorkOnlyLaunch(params: URLSearchParams, launchUrl: string): boolean {
  const mode = (params.get("mode") || params.get("game") || "").trim().toLowerCase();
  return (
    mode === "zork" ||
    isTruthyUrlValue(params.get("zork")) ||
    isTruthyUrlValue(params.get("zorkOnly")) ||
    isTruthyUrlValue(params.get("zorkOnlyMode")) ||
    isTruthyUrlValue(params.get("ZorkOnlyMode")) ||
    launchUrl.toLowerCase().includes("zork")
  );
}

/** Runs the idempotent Phase 1 boot transaction for tests and browser bootstrap. */
export async function runBootTransaction(
  deps: BootTransactionDeps,
): Promise<BootTransactionResult> {
  const existing = deps.readRuntimeSlot();
  if (existing) {
    if (!existing.clientLoaded) {
      await deps.loadClient(existing);
      existing.clientLoaded = true;
      deps.writeRuntimeSlot(existing);
    }
    return { kind: "reused", record: existing };
  }

  deps.setBootstrapPhase("bootstrapping");

  const textOutputSink = createDeferredTextOutputSink();

  const configCompat = await deps.importModule<CompatModule>("/js/session-compat/configuration.js");
  const automationCompat = await deps.importModule<CompatModule>(
    "/js/session-compat/automation.js",
  );
  const runtimeCompat = await deps.importModule<CompatModule>("/js/session-compat/runtime.js");
  const controllerCompat = await deps.importModule<CompatModule>(
    "/js/session-compat/controllers.js",
  );

  let createdSession: Session | null = null;

  try {
    const configRaw = await deps.fetchConfig();
    const configResult = validateConfigJsonInput(configRaw);
    const config: ConfigJson =
      configResult.success && configResult.data ? configResult.data : DEFAULT_CONFIG_JSON;

    const migration = migrateLegacyData(
      deps.storage,
      config,
      deps.urlSearchParams,
      deps.uuidFactory,
    );
    if (!migration.success) {
      throw new Error(migration.message);
    }

    const stateResult = readState(deps.storage);
    if (!stateResult.success || stateResult.data === undefined) {
      throw new Error("Phase 1 session graph is not present after migration.");
    }

    const applicationState = stateResult.data;
    const characterProfileId = resolveActiveCharacterProfileId(
      applicationState,
      deps.urlSearchParams,
      config,
    );
    const characterProfile = applicationState.characterProfiles[characterProfileId];
    if (!characterProfile) {
      throw new Error(
        `Character profile ${characterProfileId} is not present in the application graph.`,
      );
    }
    const serverProfileId = characterProfile.serverProfileId;
    const zorkOnly = isZorkOnlyLaunch(deps.urlSearchParams, deps.launchUrl);

    const [{ state, dom }, connectionModule, gmcpVariables] = await Promise.all([
      deps.importModule<{
        state: BootstrapLegacyState;
        dom: import("./session-bridge-wiring.ts").LegacyConnectionDom;
      }>("/js/state.js"),
      deps.importModule<{ setConnectionState: (state: TransportState) => void }>(
        "/js/connection.js",
      ),
      deps.importModule<{ registerGmcpVariables: (packageName: string, data: unknown) => void }>(
        "/js/gmcp-variables.js",
      ),
    ]);

    const registry = createSessionRegistry();
    const sessionResult = createSessionFromState(
      applicationState,
      serverProfileId,
      characterProfileId,
      {
        uuidFactory: deps.uuidFactory,
        registry,
        getAutoReconnect: () => state.settings.autoReconnect !== false,
        getClientInfo: () => ({
          client: "Darkflow",
          version: state.clientVersion || "unknown",
          width: state.terminalGeometry?.columns || 75,
          height: state.terminalGeometry?.rows || 24,
        }),
        appOrigin: deps.appOrigin,
        webSocketFactory: deps.webSocketFactory,
        onlineTarget: deps.onlineTarget,
        onText: (text: string) => {
          textOutputSink.deliver(text);
          deps.onText(text);
        },
      },
    );

    if (!sessionResult.success) {
      throw new Error(sessionResult.message);
    }

    createdSession = sessionResult.data;
    const { handles } = sessionResult;

    deps.injectPostCreateFailure?.();

    const connectionUi: LegacyConnectionUi = {
      setConnectionState: connectionModule.setConnectionState,
      emitReconnectStatus(detail: Record<string, unknown>) {
        if (typeof document === "undefined") {
          return;
        }
        document.dispatchEvent(
          new CustomEvent("dw:reconnectstatus", {
            detail: {
              attempt: state.reconnectAttempts,
              ...detail,
            },
          }),
        );
      },
    };

    const configurationBridge = buildConfigurationCompatBridge(deps.storage, characterProfileId);
    const automationBridge = buildAutomationCompatBridge(handles);
    const runtimeBridge = buildSessionRuntimeCompatBridge(
      createdSession,
      handles,
      state,
      connectionUi,
      () => ({
        client: "Darkflow",
        version: state.clientVersion || "unknown",
        width: state.terminalGeometry?.columns || 75,
        height: state.terminalGeometry?.rows || 24,
      }),
      dom,
    );
    const controllerBridge = buildControllerCompatBridge(handles);

    const registerGmcpVariables = gmcpVariables.registerGmcpVariables;
    handles.gmcp.on("*", registerGmcpVariables);
    handles.scope.own("listener", () => {
      handles.gmcp.off("*", registerGmcpVariables);
    });

    configCompat.installConfigurationCompatBridge?.(configurationBridge);
    automationCompat.installAutomationCompatBridge?.(automationBridge);
    runtimeCompat.installSessionRuntimeBridge?.({
      ...runtimeBridge,
      bindTextOutput: (appendOutput: (text: string) => void) => {
        textOutputSink.bind(appendOutput);
      },
    });
    controllerCompat.installControllerCompatBridge?.(controllerBridge);

    const record: Phase1RuntimeRecord = {
      session: createdSession,
      characterProfileId,
      serverProfileId,
      shell: {
        gameName: config.gameName,
        themeKey: applicationState.defaults.themeKey,
        shouldAutoConnect: zorkOnly || Boolean(deps.urlSearchParams.get("host") || config.host),
        zorkOnly,
      },
      clientLoaded: false,
    };
    deps.writeRuntimeSlot(record);
    deps.publishSessionDiagnostic({
      phase: "session-ready",
      sessionId: createdSession.sessionId,
      characterProfileId,
      serverProfileId,
    });

    await deps.loadClient(record);
    record.clientLoaded = true;
    deps.writeRuntimeSlot(record);

    return { kind: "created", record };
  } catch (error) {
    resetInstalledCompatBridges(configCompat, automationCompat, runtimeCompat, controllerCompat);

    if (createdSession && !createdSession.disposed) {
      createdSession.dispose();
    }

    deps.clearRuntimeSlot();
    deps.clearSessionDiagnostic();

    throw error;
  }
}
