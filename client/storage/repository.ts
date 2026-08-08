import {
  SESSION_CORE_STORAGE_KEY,
  SESSION_MIGRATION_PROVENANCE_KEY,
  type MigrationProvenance,
} from "./schema.ts";
import {
  parseApplicationState,
  validateApplicationState,
  validateMigrationProvenance,
  type ApplicationStateV1,
  type ValidationResult,
} from "./validators.ts";

/** Minimal Web Storage surface used by repository and migration code. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Result of committing the Phase 1 graph to storage. */
export type CommitResult =
  | { success: true }
  | { success: false; code: "validation-failed" | "storage-failed"; message: string };

/** Reads and validates the persisted Phase 1 application graph. */
export function readState(storage: StorageLike): ValidationResult<ApplicationStateV1> {
  const raw = storage.getItem(SESSION_CORE_STORAGE_KEY);
  if (raw === null) {
    return {
      success: false,
      errors: [
        {
          path: SESSION_CORE_STORAGE_KEY,
          code: "missing-state",
          message: "Phase 1 session graph is not present in storage.",
        },
      ],
    };
  }
  return parseApplicationState(raw);
}

/** Returns true only when the persisted graph is present and fully valid. */
export function hasValidState(storage: StorageLike): boolean {
  return readState(storage).success;
}

/** Re-validates and atomically commits the Phase 1 graph with one setItem call. */
export function commit(storage: StorageLike, state: ApplicationStateV1): CommitResult {
  const validation = validateApplicationState(state);
  if (!validation.success) {
    return {
      success: false,
      code: "validation-failed",
      message: "Refusing to commit an invalid application graph.",
    };
  }

  try {
    storage.setItem(SESSION_CORE_STORAGE_KEY, JSON.stringify(validation.data));
    return { success: true };
  } catch (error) {
    return {
      success: false,
      code: "storage-failed",
      message: error instanceof Error ? error.message : "Storage write failed.",
    };
  }
}

/** Best-effort provenance write that never throws and never affects commit. */
export function writeProvenance(storage: StorageLike, provenance: MigrationProvenance): void {
  const validation = validateMigrationProvenance(provenance);
  if (!validation.success) {
    return;
  }

  try {
    storage.setItem(SESSION_MIGRATION_PROVENANCE_KEY, JSON.stringify(validation.data));
  } catch {
    /* diagnostic-only write */
  }
}
