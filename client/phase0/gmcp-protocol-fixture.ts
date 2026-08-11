/** Disposable Phase 0 protocol fixture; not a real Darkwind GMCP contract. */

export interface Phase0RoomInfoExit {
  direction: string;
  destination: number;
}

export interface Phase0RoomInfo {
  id: number;
  name: string;
  area: string;
  exits: Phase0RoomInfoExit[];
  terrain?: string;
}
