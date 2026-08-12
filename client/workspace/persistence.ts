import type { JsonValue } from "../model/configuration.ts";
import type { CharacterProfileId } from "../model/ids.ts";
import type {
  ApplicationStateV1,
  WorkspaceSnapshot as CharacterWorkspaceSnapshot,
} from "../model/profiles.ts";
import { commit, readState, type StorageLike } from "../storage/repository.ts";

import type { WorkspaceSnapshot as DockviewWorkspaceSnapshot } from "./workspace.ts";

export type LoadCharacterWorkspaceResult =
  | { success: true; snapshot: DockviewWorkspaceSnapshot; recovered: false }
  | { success: true; snapshot: null; recovered: true; message: string }
  | {
      success: false;
      code: "missing-state" | "unknown-character";
      message: string;
    };

export type SaveCharacterWorkspaceResult =
  | { success: true }
  | {
      success: false;
      code: "missing-state" | "unknown-character" | "validation-failed" | "storage-failed";
      message: string;
    };

type JsonObject = Record<string, JsonValue>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDockviewSnapshot(
  value: unknown,
): value is DockviewWorkspaceSnapshot & { layout: JsonObject } {
  return isObject(value) && value.version === 1 && isObject(value.layout);
}

function isCharacterWorkspaceSnapshot(value: unknown): value is CharacterWorkspaceSnapshot {
  return (
    isObject(value) &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version >= 1 &&
    isObject(value.payload)
  );
}

function readPersistedDockviewWorkspace(workspace: CharacterWorkspaceSnapshot): {
  dockview: DockviewWorkspaceSnapshot;
  legacy: CharacterWorkspaceSnapshot;
} | null {
  if (workspace.version !== 2) {
    return null;
  }

  const { dockview, legacy } = workspace.payload;
  if (!isDockviewSnapshot(dockview) || !isCharacterWorkspaceSnapshot(legacy)) {
    return null;
  }

  return { dockview, legacy };
}

/** Loads one character's valid Dockview layout or requests a recoverable default. */
export function loadCharacterWorkspace(
  storage: StorageLike,
  characterProfileId: CharacterProfileId,
): LoadCharacterWorkspaceResult {
  const readResult = readState(storage);
  if (!readResult.success || readResult.data === undefined) {
    return {
      success: false,
      code: "missing-state",
      message: "Phase 1 session graph is not present in storage.",
    };
  }

  const character = readResult.data.characterProfiles[characterProfileId];
  if (character === undefined) {
    return {
      success: false,
      code: "unknown-character",
      message: "Character profile is not present in the application graph.",
    };
  }

  const persisted = readPersistedDockviewWorkspace(character.workspace);
  if (persisted === null) {
    return {
      success: true,
      snapshot: null,
      recovered: true,
      message: "Saved workspace is incompatible; using the default layout.",
    };
  }

  return { success: true, snapshot: persisted.dockview, recovered: false };
}

/** Commits one character's Dockview layout while retaining one reversible fallback. */
export function saveCharacterWorkspace(
  storage: StorageLike,
  characterProfileId: CharacterProfileId,
  snapshot: DockviewWorkspaceSnapshot,
): SaveCharacterWorkspaceResult {
  const readResult = readState(storage);
  if (!readResult.success || readResult.data === undefined) {
    return {
      success: false,
      code: "missing-state",
      message: "Phase 1 session graph is not present in storage.",
    };
  }

  const state: ApplicationStateV1 = readResult.data;
  const character = state.characterProfiles[characterProfileId];
  if (character === undefined) {
    return {
      success: false,
      code: "unknown-character",
      message: "Character profile is not present in the application graph.",
    };
  }

  if (!isDockviewSnapshot(snapshot)) {
    return {
      success: false,
      code: "validation-failed",
      message: "Refusing to commit an invalid Dockview workspace snapshot.",
    };
  }

  const persisted = readPersistedDockviewWorkspace(character.workspace);
  const legacy = persisted?.legacy ?? character.workspace;
  const workspace: CharacterWorkspaceSnapshot = {
    version: 2,
    payload: {
      dockview: { version: snapshot.version, layout: snapshot.layout },
      legacy: { version: legacy.version, payload: legacy.payload },
    },
  };
  const nextState: ApplicationStateV1 = {
    ...state,
    characterProfiles: {
      ...state.characterProfiles,
      [characterProfileId]: { ...character, workspace },
    },
  };

  const commitResult = commit(storage, nextState);
  return commitResult.success
    ? commitResult
    : { success: false, code: commitResult.code, message: commitResult.message };
}
