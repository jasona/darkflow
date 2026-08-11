import typia from "typia";

import {
  parseApplicationState,
  validateApplicationState,
  type ValidationResult,
} from "../model/validators.ts";
import type { ApplicationStateV1 } from "../model/profiles.ts";
import type { MigrationProvenance } from "./schema.ts";

export const validateMigrationProvenance = typia.createValidate<MigrationProvenance>();
export const parseMigrationProvenance = typia.json.createValidateParse<MigrationProvenance>();

export { parseApplicationState, validateApplicationState, type ValidationResult };
export type { ApplicationStateV1 };
