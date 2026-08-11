import type { GmcpSubscriptionPayload } from "../bus.ts";

/** Re-export bus subscription payload as Darkwind.Client.Subscriptions type. */
export type { GmcpSubscriptionPayload as DarkwindClientSubscriptions };

/** Darkwind.Client.NAWS outbound payload (docs/gmcp-darkwind-client.md:264-268). */
export interface DarkwindClientNaws {
  width: number;
  height: number;
  [key: string]: unknown;
}

/** Darkwind.Session.Recovered inbound payload (docs/gmcp-darkwind-session.md). */
export interface DarkwindSessionRecovered {
  mode: string;
  playerName?: string;
  recoveredAt?: number;
  previousCharacter?: string;
  [key: string]: unknown;
}

/** Darkwind.Client.RefreshMedia carries no payload (docs/gmcp-darkwind-client.md:237-243). */
