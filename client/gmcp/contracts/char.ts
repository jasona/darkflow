/** Char.Vitals snapshot or delta (docs/gmcp-char.md:44-70). */
export interface CharVitals {
  hp?: number;
  maxhp?: number;
  mhp?: number;
  sp?: number;
  maxsp?: number;
  mana?: number;
  mmana?: number;
  maxmana?: number;
  maxmp?: number;
  mmp?: number;
  mp?: number;
  fp?: number;
  maxfp?: number;
  move?: number;
  mmove?: number;
  maxmove?: number;
  level_pct?: number;
  carry?: number;
  maxcarry?: number;
  encumberance_label?: string;
  opponent?: CharEnemy;
  string?: string;
  avatar_charge?: number;
  avatar_active?: number;
  divine_patron?: string;
  [key: string]: unknown;
}

/** Char.Status identity/status delta (docs/gmcp-char.md:74-78). */
export interface CharStatus {
  name?: string;
  fullname?: string;
  race?: string;
  class?: string;
  level?: number;
  xp?: number;
  nl?: number;
  align?: string;
  title?: string;
  gender?: string;
  gold?: number;
  bank?: number;
  dead?: string;
  drunk?: string;
  invis?: string;
  sit?: string;
  viking?: string;
  [key: string]: unknown;
}

/** Char.StatusVars free-form metadata (docs/gmcp-char.md:80-82). */
export type CharStatusVars = Record<string, unknown>;

/** Char.Stats current attributes (docs/gmcp-char.md:84-86). */
export interface CharStats {
  str?: number;
  int?: number;
  wis?: number;
  dex?: number;
  con?: number;
  chr?: number;
  [key: string]: unknown;
}

/** Char.RealStats base attributes (docs/gmcp-char.md:85-86). */
export interface CharRealStats {
  realstr?: number;
  realint?: number;
  realwis?: number;
  realdex?: number;
  realcon?: number;
  realchr?: number;
  [key: string]: unknown;
}

/** Char.Worth gold and bank values (docs/gmcp-char.md:91-93). */
export interface CharWorth {
  gold?: number;
  bank?: number;
  [key: string]: unknown;
}

/** Char.Enemy native Darkwind shape (docs/gmcp-char.md:99-109). */
export interface CharEnemy {
  enemy_name?: string;
  enemy_curhp?: number;
  enemy_maxhp?: number;
  enemy_cursp?: number;
  enemy_maxsp?: number;
  enemy_hp_string?: string;
  enemy_is_npc?: number;
  enemy_image?: string;
  [key: string]: unknown;
}

/** Inventory item entry (docs/gmcp-char.md:138-140). */
export interface CharItem {
  id: string;
  name?: string;
  attrib?: string;
  [key: string]: unknown;
}

/** Char.Items.List payload (docs/gmcp-char.md:135-142). */
export interface CharItemsList {
  location: string;
  items: CharItem[];
}

/** Char.Items.Add/Remove/Update payload (docs/gmcp-char.md:144-147). */
export interface CharItemsMutation {
  location: string;
  item: CharItem;
}

/** Char.Defences entry (docs/gmcp-char.md:151-159). */
export interface CharDefence {
  name: string;
  desc?: string;
  kind?: string;
  duration?: number;
  remaining?: number;
  [key: string]: unknown;
}

/** Char.Defences.List payload (docs/gmcp-char.md:162-164). */
export type CharDefencesList = CharDefence[];

/** Char.Defences.Remove payload (docs/gmcp-char.md:163-164). */
export type CharDefencesRemove = string | { name: string };
