import typia from "typia";

import { canonicalPackageName } from "../frame.ts";
import type { CoreSupportsPayload } from "./core.ts";
import type {
  CharDefencesList,
  CharDefencesRemove,
  CharDefence,
  CharEnemy,
  CharItemsList,
  CharItemsMutation,
  CharRealStats,
  CharStats,
  CharStatus,
  CharStatusVars,
  CharVitals,
  CharWorth,
} from "./char.ts";
import type {
  CommChannelList,
  CommChannelMessage,
  CommChannelPlayers,
  CommChannelState,
} from "./comm.ts";
import type { RoomAddPlayer, RoomInfo, RoomPlayers, RoomRemovePlayer } from "./room.ts";

export const validateCoreSupports = typia.createValidate<CoreSupportsPayload>();
export const validateCharVitals = typia.createValidate<CharVitals>();
export const validateCharStatus = typia.createValidate<CharStatus>();
export const validateCharStatusVars = typia.createValidate<CharStatusVars>();
export const validateCharStats = typia.createValidate<CharStats>();
export const validateCharRealStats = typia.createValidate<CharRealStats>();
export const validateCharWorth = typia.createValidate<CharWorth>();
export const validateCharEnemy = typia.createValidate<CharEnemy>();
export const validateCharItemsList = typia.createValidate<CharItemsList>();
export const validateCharItemsMutation = typia.createValidate<CharItemsMutation>();
export const validateCharDefencesList = typia.createValidate<CharDefencesList>();
export const validateCharDefence = typia.createValidate<CharDefence>();
export const validateCharDefencesRemove = typia.createValidate<CharDefencesRemove>();
export const validateRoomInfo = typia.createValidate<RoomInfo>();
export const validateRoomPlayers = typia.createValidate<RoomPlayers>();
export const validateRoomAddPlayer = typia.createValidate<RoomAddPlayer>();
export const validateRoomRemovePlayer = typia.createValidate<RoomRemovePlayer>();
export const validateCommChannelMessage = typia.createValidate<CommChannelMessage>();
export const validateCommChannelList = typia.createValidate<CommChannelList>();
export const validateCommChannelPlayers = typia.createValidate<CommChannelPlayers>();
export const validateCommChannelState = typia.createValidate<CommChannelState>();

/** Typia validator invoked by canonical inbound package name. */
export type GmcpPayloadValidator = (input: unknown) => typia.IValidation<unknown>;

const PACKAGE_VALIDATORS: Record<string, GmcpPayloadValidator> = {
  [canonicalPackageName("Core.Supports.Set")]: validateCoreSupports,
  [canonicalPackageName("Core.Supports.Add")]: validateCoreSupports,
  [canonicalPackageName("Core.Supports.Remove")]: validateCoreSupports,
  [canonicalPackageName("Char.Vitals")]: validateCharVitals,
  [canonicalPackageName("Char.Status")]: validateCharStatus,
  [canonicalPackageName("Char.StatusVars")]: validateCharStatusVars,
  [canonicalPackageName("Char.Stats")]: validateCharStats,
  [canonicalPackageName("Char.RealStats")]: validateCharRealStats,
  [canonicalPackageName("Char.Worth")]: validateCharWorth,
  [canonicalPackageName("Char.Enemy")]: validateCharEnemy,
  [canonicalPackageName("Char.Items.List")]: validateCharItemsList,
  [canonicalPackageName("Char.Items.Add")]: validateCharItemsMutation,
  [canonicalPackageName("Char.Items.Remove")]: validateCharItemsMutation,
  [canonicalPackageName("Char.Items.Update")]: validateCharItemsMutation,
  [canonicalPackageName("Char.Defences.List")]: validateCharDefencesList,
  [canonicalPackageName("Char.Defences.Add")]: validateCharDefence,
  [canonicalPackageName("Char.Defences.Remove")]: validateCharDefencesRemove,
  [canonicalPackageName("Room.Info")]: validateRoomInfo,
  [canonicalPackageName("Room.Players")]: validateRoomPlayers,
  [canonicalPackageName("Room.AddPlayer")]: validateRoomAddPlayer,
  [canonicalPackageName("Room.RemovePlayer")]: validateRoomRemovePlayer,
  [canonicalPackageName("Comm.Channel")]: validateCommChannelMessage,
  [canonicalPackageName("Comm.Channel.Text")]: validateCommChannelMessage,
  [canonicalPackageName("Comm.Channel.List")]: validateCommChannelList,
  [canonicalPackageName("Comm.Channel.Players")]: validateCommChannelPlayers,
  [canonicalPackageName("Comm.Channel.Start")]: validateCommChannelState,
  [canonicalPackageName("Comm.Channel.End")]: validateCommChannelState,
};

/** Returns the structural validator for a canonical package name, if modeled. */
export function lookupGmcpValidator(packageName: string): GmcpPayloadValidator | undefined {
  return PACKAGE_VALIDATORS[canonicalPackageName(packageName)];
}

/** Canonical inbound package names with registered validators. */
export const modeledGmcpPackageNames = Object.keys(PACKAGE_VALIDATORS);
