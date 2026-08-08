/** Primary Phase 1 session graph local-storage key. */
export const SESSION_CORE_STORAGE_KEY = "darkflow-session-core-v1";

/** Diagnostic-only migration provenance local-storage key. */
export const SESSION_MIGRATION_PROVENANCE_KEY = "darkflow-session-migration-v1";

/** Fixed provisional world key written for every migrated server profile. */
export const LEGACY_MIGRATION_WORLD_KEY = "legacy-migration:unconfirmed";

/** Theme fallback matching legacy `DEFAULT_THEME_KEY`. */
export const DEFAULT_THEME_KEY = "darkflow-default";

/** Records how legacy data was converted into the Phase 1 graph. */
export interface MigrationProvenance {
  schemaVersion: 1;
  migratedAt: string;
  sourceScopeKeys: string[];
  activeScopeKey: string;
  skippedLegacyKeys: Array<{ key: string; reason: string }>;
}
