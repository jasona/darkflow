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

/** Builds the WebSocket URL for a transport endpoint and app origin. */
export function buildConnectionUrl(endpoint: TransportEndpoint, appOrigin: string): string {
  const host = endpoint.host || "localhost";
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
