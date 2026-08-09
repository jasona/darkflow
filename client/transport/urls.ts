import type { TransportEndpoint, TransportName } from "./types.ts";

/** Default transport fallback ladder in priority order. */
export const TRANSPORT_LADDER: readonly TransportName[] = ["wss", "ws", "telnets", "telnet"];

/** Builds the active transport ladder for a selected protocol and page scheme. */
export function buildTransportLadder(
  selected: string,
  pageProtocol: string = globalThis.location?.protocol ?? "http:",
): TransportName[] {
  let ladder = TRANSPORT_LADDER.filter(
    (transport) => !(pageProtocol === "https:" && transport === "ws"),
  );
  if (ladder.includes(selected as TransportName)) {
    ladder = [selected as TransportName].concat(
      ladder.filter((transport) => transport !== selected),
    );
  }
  return ladder;
}

const SUPPORTED_PROTOCOLS = new Set<TransportName>(["ws", "wss", "telnet", "telnets"]);

/** Toolbar host/port/protocol values read from legacy connect fields. */
export interface LegacyToolbarEndpointInput {
  host?: string | null;
  port?: string | null;
  protocol?: string | null;
}

/** Reads live toolbar connect fields from the page DOM when available. */
export function readLiveToolbarEndpointInput(): LegacyToolbarEndpointInput | null {
  if (typeof document === "undefined") {
    return null;
  }

  const hostEl = document.getElementById("host");
  const portEl = document.getElementById("port");
  const protocolEl = document.getElementById("protocol-select");
  if (!hostEl && !portEl && !protocolEl) {
    return null;
  }

  return {
    host: hostEl && "value" in hostEl ? String(hostEl.value) : "",
    port: portEl && "value" in portEl ? String(portEl.value) : "",
    protocol: protocolEl && "value" in protocolEl ? String(protocolEl.value) : "",
  };
}

/** Resolves scope-key and profile host sentinels to a connectable hostname. */
export function resolveConnectionHost(host: string): string {
  const normalized = String(host || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "default") {
    return "localhost";
  }
  return String(host).trim();
}

/**
 * Replicates legacy `connection.js` host/port/protocol reads, falling back to the
 * migrated server profile when toolbar fields are unavailable (SSR/tests).
 */
export function resolveLegacyToolbarEndpoint(
  fallback: TransportEndpoint,
  toolbar?: LegacyToolbarEndpointInput | null,
): TransportEndpoint {
  if (toolbar === undefined || toolbar === null) {
    return {
      host: resolveConnectionHost(fallback.host),
      port: fallback.port || "4242",
      protocol: fallback.protocol,
    };
  }

  const host = String(toolbar.host ?? "").trim() || "localhost";
  const port = String(toolbar.port ?? "").trim() || "4242";
  let protocol = String(toolbar.protocol ?? "").trim() || fallback.protocol || "wss";
  if (!SUPPORTED_PROTOCOLS.has(protocol as TransportName)) {
    protocol = fallback.protocol || "wss";
  }

  return {
    host,
    port,
    protocol: protocol as TransportName,
  };
}

/** Builds the WebSocket URL for a transport endpoint and app origin. */
export function buildConnectionUrl(endpoint: TransportEndpoint, appOrigin: string): string {
  const host = resolveConnectionHost(endpoint.host);
  const port = endpoint.port || "4242";
  const protocol = endpoint.protocol;

  if (protocol === "ws" || protocol === "wss") {
    return `${protocol}://${host}:${port}/`;
  }

  const originUrl = new URL(appOrigin);
  const proxyScheme = originUrl.protocol === "https:" ? "wss" : "ws";
  const tls = protocol === "telnets" ? "1" : "0";
  return (
    `${proxyScheme}://${originUrl.host}/proxy` +
    `?host=${encodeURIComponent(host)}` +
    `&port=${encodeURIComponent(port)}` +
    `&tls=${tls}`
  );
}
