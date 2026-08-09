import type { SessionId } from "../model/ids.ts";

/** Supported WebSocket/telnet transport rung names. */
export type TransportName = "ws" | "wss" | "telnet" | "telnets";

/** Host/port/protocol tuple read fresh on every connect attempt. */
export interface TransportEndpoint {
  host: string;
  port: string;
  protocol: TransportName;
}

/** Three-value connection lifecycle state matching legacy setConnectionState. */
export type TransportState = "connecting" | "connected" | "disconnected";

/** Four-value reconnect lifecycle status matching legacy emitReconnectStatus. */
export type TransportReconnectStatus = "connecting" | "scheduled" | "connected" | "idle";

/** Payload published on transport:reconnect-status session events. */
export interface TransportReconnectStatusPayload {
  status: TransportReconnectStatus;
  attempt: number;
  transport: TransportName | null;
  delayMs?: number;
  nextAttemptAt?: number;
  reason?: string;
  url?: string;
  userDisconnected?: boolean;
}

/** Minimal WebSocket surface used by session transport and test fixtures. */
export interface WebSocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  binaryType: string;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

/** Read model mirroring legacy getWsDebugSnapshot minus openWindows. */
export interface TransportHealthSnapshot {
  url: string | null;
  readyState: number;
  readyStateName: string;
  connectionPending: boolean;
  reconnectAttempts: number;
  connectTime: number | null;
  lastOpenAt: number | null;
  lastInboundAt: number | null;
  lastInboundTextAt: number | null;
  lastInboundGmcpAt: number | null;
  lastOutboundAt: number | null;
  lastCommandAt: number | null;
  lastErrorAt: number | null;
  lastCloseAt: number | null;
  lastHandlerErrorAt: number | null;
  bufferedAmount: number;
  lastBufferedAmount: number;
  maxBufferedAmount: number;
  stalledAt: number | null;
  forcedReconnects: number;
  recentCommandCount: number;
  events: ReadonlyArray<{ ts: string; type: string; detail: unknown }>;
}

/** Optional metadata attached to outbound send accounting. */
export interface SendMetadata {
  kind?: string;
  size?: number;
  preview?: string;
}

/** Injected callbacks supplying live config and inbound frame dispatch. */
export interface SessionTransportCallbacks {
  getEndpoint(): TransportEndpoint;
  getAutoReconnect(): boolean;
  isLoggedIntoCharacter(): boolean;
  onText(text: string): void;
  onGmcpFrame(packageName: string, data: unknown): void;
}

/** Session-scoped transport replacing legacy module-global connection state. */
export interface SessionTransport {
  readonly sessionId: SessionId;
  readonly state: TransportState;
  connect(): void;
  disconnect(): void;
  retryNow(): void;
  forceReconnect(reason: string): void;
  send(payload: string | Uint8Array, metadata?: SendMetadata): boolean;
  getHealthSnapshot(): TransportHealthSnapshot;
  dispose(): void;
}
