/** Room.Info payload (docs/gmcp-room.md:18-41). */
export interface RoomInfo {
  num?: string | number;
  id?: string | number;
  name?: string;
  area?: string;
  zone?: string;
  environment?: string;
  terrain?: string;
  env?: string;
  coords?: { x?: number; y?: number; z?: number };
  coord_x?: number;
  coord_y?: number;
  coord_z?: number;
  exits?: Record<string, string | number>;
  exit_states?: Record<string, string>;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Room player entry (docs/gmcp-room.md:57-59). */
export interface RoomPlayer {
  name: string;
  fullname?: string;
  [key: string]: unknown;
}

/** Room.Players payload (docs/gmcp-room.md:54-60). */
export type RoomPlayers = RoomPlayer[];

/** Room.AddPlayer payload (docs/gmcp-room.md:62). */
export type RoomAddPlayer = RoomPlayer;

/** Room.RemovePlayer payload (docs/gmcp-room.md:62-63). */
export type RoomRemovePlayer = string | { name: string };
