import typia from "typia";

import { CONFIG_KINDS, type ConfigKind, type ConfigurationSet } from "./configuration.ts";
import type { ApplicationStateV1, ServerProfile } from "./profiles.ts";
import type { SessionDescriptor } from "./session-contract.ts";

export const validateApplicationStateV1 = typia.createValidate<ApplicationStateV1>();
export const parseApplicationStateV1 = typia.json.createValidateParse<ApplicationStateV1>();
export const validateSessionDescriptor = typia.createValidate<SessionDescriptor>();
export const parseSessionDescriptor = typia.json.createValidateParse<SessionDescriptor>();

/** Stable diagnostic emitted by graph validation beyond Typia structural checks. */
export interface GraphValidationIssue {
  path: string;
  code: string;
  message: string;
  expected?: string;
  value?: unknown;
}

/** Non-throwing validation result retaining Typia and graph diagnostics. */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: GraphValidationIssue[];
}

function containsControlOrWhitespace(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || /\s/.test(char)) {
      return true;
    }
  }
  return false;
}

/** Validates a session descriptor structurally without graph checks. */
export function validateSessionDescriptorInput(
  input: unknown,
): ValidationResult<SessionDescriptor> {
  const structural = validateSessionDescriptor(input);
  if (!structural.success) {
    return {
      success: false,
      errors: mapTypiaErrors(structural.errors),
    };
  }

  return { success: true, data: structural.data };
}

/** Parses JSON and validates a session descriptor structurally without graph checks. */
export function parseSessionDescriptorInput(json: string): ValidationResult<SessionDescriptor> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: "$input",
          code: "invalid-json",
          message: error instanceof Error ? error.message : "Invalid JSON document.",
        },
      ],
    };
  }

  return validateSessionDescriptorInput(parsed);
}

/** Validates unknown input through Typia and deterministic graph checks. */
export function validateApplicationState(input: unknown): ValidationResult<ApplicationStateV1> {
  const structural = validateApplicationStateV1(input);
  if (!structural.success) {
    return {
      success: false,
      errors: mapTypiaErrors(structural.errors),
    };
  }

  const graphErrors = validateApplicationStateGraph(structural.data);
  if (graphErrors.length > 0) {
    return { success: false, errors: graphErrors };
  }

  return { success: true, data: structural.data };
}

/** Parses JSON and validates the Phase 1 application graph without throwing. */
export function parseApplicationState(json: string): ValidationResult<ApplicationStateV1> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: "$input",
          code: "invalid-json",
          message: error instanceof Error ? error.message : "Invalid JSON document.",
        },
      ],
    };
  }

  return validateApplicationState(parsed);
}

/** Validates a session descriptor structurally and against a persisted graph. */
export function validateSessionDescriptorAgainstState(
  state: ApplicationStateV1,
  input: unknown,
): ValidationResult<SessionDescriptor> {
  const structural = validateSessionDescriptor(input);
  if (!structural.success) {
    return {
      success: false,
      errors: mapTypiaErrors(structural.errors),
    };
  }

  const graphErrors = validateSessionDescriptorGraph(state, structural.data);
  if (graphErrors.length > 0) {
    return { success: false, errors: graphErrors };
  }

  return { success: true, data: structural.data };
}

/** Parses JSON and validates a session descriptor against a persisted graph. */
export function parseSessionDescriptorAgainstState(
  state: ApplicationStateV1,
  json: string,
): ValidationResult<SessionDescriptor> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: "$input",
          code: "invalid-json",
          message: error instanceof Error ? error.message : "Invalid JSON document.",
        },
      ],
    };
  }

  return validateSessionDescriptorAgainstState(state, parsed);
}

function mapTypiaErrors(errors: typia.IValidation.IError[]): GraphValidationIssue[] {
  return errors.map((error) => ({
    path: error.path,
    code: "structural-validation",
    message: `Expected ${error.expected}.`,
    expected: error.expected,
    value: error.value,
  }));
}

function validateApplicationStateGraph(state: ApplicationStateV1): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];

  if (state.schemaVersion !== 1) {
    issues.push({
      path: "$input.schemaVersion",
      code: "invalid-schema-version",
      message: "schemaVersion must be exactly 1.",
      expected: "1",
      value: state.schemaVersion,
    });
  }

  issues.push(...validateCollectionKeys("$input.serverProfiles", state.serverProfiles));
  issues.push(...validateCollectionKeys("$input.characterProfiles", state.characterProfiles));
  issues.push(...validateCollectionKeys("$input.configurationSets", state.configurationSets));

  for (const server of Object.values(state.serverProfiles)) {
    issues.push(...validateServerProfile(`$input.serverProfiles.${server.id}`, server));
  }

  for (const character of Object.values(state.characterProfiles)) {
    const basePath = `$input.characterProfiles.${character.id}`;

    if (!state.serverProfiles[character.serverProfileId]) {
      issues.push({
        path: `${basePath}.serverProfileId`,
        code: "dangling-server-reference",
        message: "Character profile references a missing server profile.",
        value: character.serverProfileId,
      });
    }

    for (const kind of CONFIG_KINDS) {
      issues.push(
        ...validateConfigSetReferences(
          `${basePath}.configSetRefs.${kind}`,
          kind,
          character.configSetRefs[kind],
          state.configurationSets,
        ),
      );
    }
  }

  if (
    state.defaults.defaultCharacterProfileId !== undefined &&
    !state.characterProfiles[state.defaults.defaultCharacterProfileId]
  ) {
    issues.push({
      path: "$input.defaults.defaultCharacterProfileId",
      code: "dangling-character-reference",
      message: "Application defaults reference a missing character profile.",
      value: state.defaults.defaultCharacterProfileId,
    });
  }

  for (const set of Object.values(state.configurationSets)) {
    if (!Number.isInteger(set.revision) || set.revision < 1) {
      issues.push({
        path: `$input.configurationSets.${set.id}.revision`,
        code: "invalid-revision",
        message: "Configuration set revision must be a positive integer.",
        value: set.revision,
      });
    }
  }

  return issues;
}

function validateSessionDescriptorGraph(
  state: ApplicationStateV1,
  descriptor: SessionDescriptor,
): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const character = state.characterProfiles[descriptor.characterProfileId];

  if (!character) {
    issues.push({
      path: "$input.characterProfileId",
      code: "dangling-character-reference",
      message: "Session descriptor references a missing character profile.",
      value: descriptor.characterProfileId,
    });
    return issues;
  }

  if (!state.serverProfiles[descriptor.serverProfileId]) {
    issues.push({
      path: "$input.serverProfileId",
      code: "dangling-server-reference",
      message: "Session descriptor references a missing server profile.",
      value: descriptor.serverProfileId,
    });
  }

  if (character.serverProfileId !== descriptor.serverProfileId) {
    issues.push({
      path: "$input.serverProfileId",
      code: "session-server-mismatch",
      message: "Session descriptor server profile must match the character profile server.",
      expected: character.serverProfileId,
      value: descriptor.serverProfileId,
    });
  }

  return issues;
}

function validateCollectionKeys<T extends { id: string }>(
  basePath: string,
  collection: Record<string, T>,
): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];

  for (const [key, record] of Object.entries(collection)) {
    if (key !== record.id) {
      issues.push({
        path: `${basePath}.${key}`,
        code: "collection-key-id-mismatch",
        message: "Collection map key must equal the record id.",
        expected: record.id,
        value: key,
      });
    }
  }

  return issues;
}

function validateServerProfile(basePath: string, server: ServerProfile): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];

  if (containsControlOrWhitespace(server.worldKey)) {
    issues.push({
      path: `${basePath}.worldKey`,
      code: "invalid-world-key",
      message: "World key must not contain whitespace or control characters.",
      value: server.worldKey,
    });
  }

  if (containsControlOrWhitespace(server.host)) {
    issues.push({
      path: `${basePath}.host`,
      code: "invalid-host",
      message: "Host must not contain whitespace or control characters.",
      value: server.host,
    });
  }

  return issues;
}

function validateConfigSetReferences(
  basePath: string,
  kind: ConfigKind,
  references: readonly string[],
  configurationSets: Record<string, ConfigurationSet>,
): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const seen = new Set<string>();

  references.forEach((reference, index) => {
    const path = `${basePath}[${index}]`;

    if (seen.has(reference)) {
      issues.push({
        path,
        code: "duplicate-config-reference",
        message: "Configuration set references must be unique within a kind.",
        value: reference,
      });
      return;
    }
    seen.add(reference);

    const set = configurationSets[reference];
    if (!set) {
      issues.push({
        path,
        code: "dangling-config-reference",
        message: "Character profile references a missing configuration set.",
        value: reference,
      });
      return;
    }

    if (set.kind !== kind) {
      issues.push({
        path,
        code: "cross-kind-config-reference",
        message: "Configuration set kind must match the reference list.",
        expected: kind,
        value: set.kind,
      });
    }
  });

  return issues;
}

/** Exported for transformed-test fixtures that assert graph codes directly. */
export const graphValidation = {
  validateApplicationStateGraph,
  validateSessionDescriptorGraph,
};
