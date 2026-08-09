/** Comm.Channel message shape (docs/gmcp-comm.md:23-37). */
export interface CommChannelMessage {
  channel?: string;
  chan?: string;
  talker?: string;
  player?: string;
  text?: string;
  msg?: string;
  [key: string]: unknown;
}

/** Comm.Channel.List entry (docs/gmcp-comm.md:50-53). */
export interface CommChannelEntry {
  name?: string;
  caption?: string;
  command?: string;
  [key: string]: unknown;
}

/** Comm.Channel.List payload (docs/gmcp-comm.md:46-54). */
export type CommChannelList = CommChannelEntry[];

/** Comm.Channel.Players roster entry (docs/gmcp-comm.md:63-64). */
export interface CommChannelPlayer {
  name: string;
  [key: string]: unknown;
}

/** Comm.Channel.Players inbound payload (docs/gmcp-comm.md:63-64). */
export type CommChannelPlayers = CommChannelPlayer[];

/** Comm.Channel.Start/End payload (docs/gmcp-comm.md:68-70). */
export type CommChannelState = string | { channel?: string; name?: string };
