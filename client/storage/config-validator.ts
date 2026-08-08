import typia from "typia";

import type { ValidationResult } from "../model/validators.ts";

/** `/config.json` payload shape served by `server.js`. */
export interface ConfigJson {
  host: string;
  port: number;
  wss: boolean;
  gameName: string;
  hiddenPanels: string[];
}

export const validateConfigJson = typia.createValidate<ConfigJson>();
export const parseConfigJson = typia.json.createValidateParse<ConfigJson>();

/** Default config used when `/config.json` is missing or invalid. */
export const DEFAULT_CONFIG_JSON: ConfigJson = {
  host: "",
  port: 4242,
  wss: true,
  gameName: "",
  hiddenPanels: [],
};

/** Injected inputs for active-scope computation without DOM or fetch. */
export interface ActiveScopeInput {
  urlSearchParams: URLSearchParams;
  protocolOverride?: string | undefined;
  config: ConfigJson;
}

const SUPPORTED_PROTOCOLS = new Set(["ws", "wss", "telnet", "telnets"]);

/**
 * Replicates `public/js/app.js:445-461` protocol/host/port precedence, then
 * collapses to the two-bucket scope key from `public/js/alias-manager.js:288-295`.
 */
export function computeActiveScopeKey(input: ActiveScopeInput): string {
  const { urlSearchParams, protocolOverride, config } = input;

  let proto = urlSearchParams.get("type");
  if (!proto && urlSearchParams.has("wss")) {
    proto = urlSearchParams.get("wss") !== "0" ? "wss" : "ws";
  }
  if (!proto && protocolOverride) {
    proto = protocolOverride;
  }
  if (!proto) {
    proto = config.wss !== undefined && !config.wss ? "ws" : "wss";
  }
  if (!proto || !SUPPORTED_PROTOCOLS.has(proto)) {
    proto = "wss";
  }

  const host = normalizeScopeHost(urlSearchParams.get("host") || config.host || "");
  const port = normalizeScopePort(urlSearchParams.get("port") || String(config.port) || "4242");

  const bucket = proto === "wss" || proto === "telnets" ? "wss" : "ws";
  return `${bucket}://${host}:${port}`;
}

/** Validates unknown config input and falls back to defaults on failure. */
export function validateConfigJsonInput(input: unknown): ValidationResult<ConfigJson> {
  const result = validateConfigJson(input);
  if (!result.success) {
    return {
      success: false,
      errors: result.errors.map((error) => ({
        path: error.path,
        code: "structural-validation",
        message: `Expected ${error.expected}.`,
        expected: error.expected,
        value: error.value,
      })),
    };
  }
  return { success: true, data: result.data };
}

/** Parses JSON config text and falls back structurally on failure. */
export function parseConfigJsonInput(json: string): ValidationResult<ConfigJson> {
  const parsed = parseConfigJson(json);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.errors.map((error) => ({
        path: error.path,
        code: "structural-validation",
        message: `Expected ${error.expected}.`,
        expected: error.expected,
        value: error.value,
      })),
    };
  }
  return { success: true, data: parsed.data };
}

function normalizeWhitespace(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeScopeHost(value: string): string {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized || "default";
}

function normalizeScopePort(value: string): string {
  const normalized = normalizeWhitespace(value);
  return normalized || "4242";
}
