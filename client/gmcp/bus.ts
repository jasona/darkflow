import type { SessionId } from "../model/ids.ts";
import type { SessionDiagnostics } from "../runtime/diagnostics.ts";
import { canonicalPackageName, normalizeGmcpFrame, normalizeSupportsPayload } from "./frame.ts";
import type { CoreHello } from "./contracts/core.ts";
import { lookupGmcpValidator } from "./contracts/validators.ts";

const GMCP_MEDIA_REFRESH_PACKAGE = "Darkwind.Client.RefreshMedia";
const GMCP_SUBSCRIPTIONS_PACKAGE = "Darkwind.Client.Subscriptions";
const gmcpTextEncoder = new TextEncoder();

/** Client support packages sent during handshake (public/js/gmcp.js:137-179). */
export const CLIENT_SUPPORTS_SET: readonly string[] = [
  "Char 1",
  "Char.Vitals 1",
  "Char.Status 1",
  "Char.StatusVars 1",
  "Char.Stats 1",
  "Char.RealStats 1",
  "Char.Worth 1",
  "Char.Enemy 1",
  "Char.Items 1",
  "Char.Defences 1",
  "Room 1",
  "Comm 1",
  "Comm.Channel 1",
  "Group 1",
  "Game 1",
  "Darkwind.Char.Avatar 1",
  "Darkwind.Combat 1",
  "Darkwind.Tutorial 1",
  "Darkwind.Visual 1",
  "Darkwind.Room.Image 1",
  "Darkwind.Divine 1",
  "Darkwind.Sky 1",
  "Darkwind.GuildVitals 2",
  "Darkwind.XPMon 1",
  "Darkwind.Client.Subscriptions 1",
  "Darkwind.Client.NAWS 1",
  "Darkwind.Window 1",
  "Darkwind.Snoop 1",
  "Darkwind.IDE 2",
  "Darkwind.MapData2 2",
  "Darkwind.Completion 1",
  "Darkwind.Quests 1",
  "Darkwind.Achievements 1",
  "Darkwind.Announcements 1",
  "Darkwind.Giphy 1",
  "Darkwind.Sound 1",
  "Darkwind.Broadcast 1",
  "Darkwind.LinuxRescue 1",
  "Darkwind.Lag 1",
  "Darkwind.Fishing 1",
  "Darkwind.Cyberware 1",
  "Darkwind.StreetSamurai 1",
  "Darkwind.Room.Playlist 1",
];

/** Subscription payload merged and sent after handshake. */
export interface GmcpSubscriptionPayload {
  reason: string;
  full: boolean;
  panels: Record<string, unknown>;
  features: Record<string, unknown>;
}

/** Wildcard handler receives package name then payload. */
export type GmcpWildcardHandler = (packageName: string, data: unknown) => void;

/** Package handler receives payload then package name. */
export type GmcpPackageHandler = (data: unknown, packageName: string) => void;

/** Session-scoped GMCP bus with validation, supports tracking, and send helpers. */
export interface SessionGmcpBus {
  readonly sessionId: SessionId;
  readonly enabled: boolean;
  on(packageName: string, handler: GmcpWildcardHandler | GmcpPackageHandler): void;
  off(packageName: string, handler: GmcpWildcardHandler | GmcpPackageHandler): void;
  dispatch(packageName: string, data: unknown): void;
  serverSupportsPackage(packageName: string): boolean;
  sendHandshake(clientInfo: CoreHello): boolean;
  sendSubscriptions(payload?: Partial<GmcpSubscriptionPayload>): boolean;
  requestMediaRefresh(): boolean;
  requestChannelPlayers(): boolean;
  enableChannel(channel: string): boolean;
  restartHandshake(payload?: Partial<GmcpSubscriptionPayload>): boolean;
}

/** Creates a session-scoped GMCP bus backed by an injected byte send sink. */
export function createSessionGmcpBus(
  sessionId: SessionId,
  sendSink: (bytes: Uint8Array) => boolean,
  diagnostics: SessionDiagnostics,
): SessionGmcpBus {
  return new SessionGmcpBusImpl(sessionId, sendSink, diagnostics);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSupports(payload: unknown): Record<string, string | number> {
  const normalized = normalizeSupportsPayload(payload);
  const supports: Record<string, string | number> = {};
  if (Array.isArray(normalized)) {
    for (const item of normalized) {
      if (typeof item !== "string") {
        continue;
      }
      const parts = item.trim().split(/\s+/);
      if (parts[0]) {
        supports[parts[0]] = parts[1] || "1";
      }
    }
  } else if (isObject(normalized)) {
    for (const [name, version] of Object.entries(normalized)) {
      if (typeof version === "string" || typeof version === "number") {
        supports[name] = version || "1";
      } else {
        supports[name] = "1";
      }
    }
  }
  return supports;
}

/** Normalizes subscription payload defaults matching legacy gmcp.js. */
export function normalizeSubscriptionPayload(
  payload: Partial<GmcpSubscriptionPayload> = {},
): GmcpSubscriptionPayload {
  return {
    reason: payload.reason ?? "visibility-sync",
    full: !!payload.full,
    panels: payload.panels && typeof payload.panels === "object" ? { ...payload.panels } : {},
    features: {
      announcementsBadge: true,
      enemyAutoOpen: true,
      combatPane: false,
      visualEffects: false,
      tutorialPane: false,
      windows: true,
      ide: true,
      completion: true,
      giphy: true,
      broadcast: true,
      ...(payload.features && typeof payload.features === "object" ? payload.features : {}),
    },
  };
}

class SessionGmcpBusImpl implements SessionGmcpBus {
  readonly sessionId: SessionId;
  #sendSink: (bytes: Uint8Array) => boolean;
  #diagnostics: SessionDiagnostics;
  #enabled = false;
  #handlers: Record<string, Array<GmcpWildcardHandler | GmcpPackageHandler>> = {};
  #subscriptions: GmcpSubscriptionPayload = normalizeSubscriptionPayload();
  #serverSupports: Record<string, string | number> = {};
  #lastClientInfo: CoreHello = {
    client: "Darkflow",
    version: "unknown",
    width: 75,
    height: 24,
  };

  constructor(
    sessionId: SessionId,
    sendSink: (bytes: Uint8Array) => boolean,
    diagnostics: SessionDiagnostics,
  ) {
    this.sessionId = sessionId;
    this.#sendSink = sendSink;
    this.#diagnostics = diagnostics;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  on(packageName: string, handler: GmcpWildcardHandler | GmcpPackageHandler): void {
    const canonical = canonicalPackageName(packageName);
    if (!this.#handlers[canonical]) {
      this.#handlers[canonical] = [];
    }
    this.#handlers[canonical].push(handler);
  }

  off(packageName: string, handler: GmcpWildcardHandler | GmcpPackageHandler): void {
    const canonical = canonicalPackageName(packageName);
    if (!this.#handlers[canonical]) {
      return;
    }
    this.#handlers[canonical] = this.#handlers[canonical].filter((cb) => cb !== handler);
  }

  dispatch(packageName: string, data: unknown): void {
    const normalized = normalizeGmcpFrame(packageName, data);
    packageName = normalized.packageName;
    data = normalized.data;

    const validator = lookupGmcpValidator(packageName);
    if (validator) {
      const result = validator(data);
      if (!result.success) {
        this.#diagnostics.recordSuppressedEvent();
        return;
      }
    }

    if (packageName === "Core.Supports.Set") {
      this.#serverSupports = normalizeSupports(data);
    } else if (packageName === "Core.Supports.Add") {
      this.#serverSupports = {
        ...this.#serverSupports,
        ...normalizeSupports(data),
      };
    } else if (packageName === "Core.Supports.Remove") {
      const removed = normalizeSupports(data);
      for (const name of Object.keys(removed)) {
        delete this.#serverSupports[name];
      }
    }

    const wildcardHandlers = this.#handlers["*"];
    if (wildcardHandlers) {
      for (const cb of [...wildcardHandlers]) {
        try {
          (cb as GmcpWildcardHandler)(packageName, data);
        } catch (error) {
          console.error(`GMCP wildcard handler failed for ${packageName}`, error);
          this.#diagnostics.recordHandlerFailure();
        }
      }
    }

    const packageHandlers = this.#handlers[packageName];
    if (packageHandlers) {
      for (const cb of [...packageHandlers]) {
        try {
          (cb as GmcpPackageHandler)(data, packageName);
        } catch (error) {
          console.error(`GMCP handler failed for ${packageName}`, error);
          this.#diagnostics.recordHandlerFailure();
        }
      }
    }
  }

  serverSupportsPackage(packageName: string): boolean {
    return !!this.#serverSupports[canonicalPackageName(packageName)];
  }

  send(packageName: string, data?: unknown): boolean {
    const payload = data !== undefined ? packageName + " " + JSON.stringify(data) : packageName;
    return this.#sendSink(gmcpTextEncoder.encode(payload));
  }

  sendHandshake(clientInfo: CoreHello): boolean {
    this.#lastClientInfo = clientInfo;
    this.send("Core.Hello", clientInfo);
    this.send("Core.Supports.Set", [...CLIENT_SUPPORTS_SET]);
    this.#enabled = true;
    return true;
  }

  reset(): void {
    this.#enabled = false;
    this.#serverSupports = {};
    this.#subscriptions = normalizeSubscriptionPayload();
    const setHandlers = this.#handlers["Core.Supports.Set"];
    if (setHandlers) {
      for (const cb of [...setHandlers]) {
        try {
          (cb as GmcpPackageHandler)({}, "Core.Supports.Set");
        } catch (error) {
          console.error("GMCP handler failed for Core.Supports.Set", error);
          this.#diagnostics.recordHandlerFailure();
        }
      }
    }
  }

  sendSubscriptions(payload: Partial<GmcpSubscriptionPayload> = {}): boolean {
    const subscriptions = normalizeSubscriptionPayload({
      ...this.#subscriptions,
      ...payload,
      panels: payload.panels ?? this.#subscriptions.panels,
      features: {
        ...this.#subscriptions.features,
        ...(payload.features ?? {}),
      },
    });
    const sent = this.send(GMCP_SUBSCRIPTIONS_PACKAGE, subscriptions);
    if (!sent) {
      return false;
    }
    this.#subscriptions = subscriptions;
    if (payload.features && payload.features.announcementsList) {
      this.#subscriptions.features.announcementsList = false;
    }
    return true;
  }

  requestMediaRefresh(): boolean {
    return this.send(GMCP_MEDIA_REFRESH_PACKAGE);
  }

  requestChannelPlayers(): boolean {
    return this.send("Comm.Channel.Players", {});
  }

  enableChannel(channel: string): boolean {
    const name = typeof channel === "string" ? channel.trim() : "";
    if (!name) {
      return false;
    }
    return this.send("Comm.Channel.Enable", name);
  }

  restartHandshake(payload: Partial<GmcpSubscriptionPayload> = {}): boolean {
    const subscriptions = normalizeSubscriptionPayload({
      ...this.#subscriptions,
      ...payload,
      panels: payload.panels ?? this.#subscriptions.panels,
      features: {
        ...this.#subscriptions.features,
        ...(payload.features ?? {}),
      },
    });
    this.reset();
    this.sendHandshake(this.#lastClientInfo);
    this.sendSubscriptions({
      ...subscriptions,
      reason: payload.reason ?? "ctrl-k",
      full: true,
    });
    this.requestMediaRefresh();
    return true;
  }
}
