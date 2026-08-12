import { mount, unmount } from "svelte";

import App from "./App.svelte";
import {
  clearPhase1RuntimeSlot,
  publishBootstrapPhase,
  readPhase1RuntimeSlot,
  runBootTransaction,
  writePhase1RuntimeSlot,
  type Phase1RuntimeRecord,
  type SessionBootstrapDiagnostic,
} from "./bootstrap-transaction.ts";
import {
  DEFAULT_CONFIG_JSON,
  validateConfigJsonInput,
  type ConfigJson,
} from "../storage/config-validator.ts";
import type { TransportEndpoint, TransportName } from "../transport/types.ts";

declare global {
  interface Window {
    __darkflowPhase1Bootstrap?: import("./bootstrap-transaction.ts").BootstrapDiagnostic;
    __darkflowPhase1Session?: SessionBootstrapDiagnostic;
    __darkflowPhase1Runtime?: Phase1RuntimeRecord;
  }
}

function importPublicModule<T = Record<string, unknown>>(entry: string): Promise<T> {
  return import(/* @vite-ignore */ entry) as Promise<T>;
}

const protocols = new Set<TransportName>(["ws", "wss", "telnet", "telnets"]);

function isProtocol(value: string | null): value is TransportName {
  return value !== null && protocols.has(value as TransportName);
}

function resolvePhase2Endpoint(
  baseline: TransportEndpoint,
  config: ConfigJson,
  params: URLSearchParams,
  storage: Storage,
  zorkOnly: boolean,
): TransportEndpoint {
  if (zorkOnly) {
    return { host: "darkwind.ai", port: "4244", protocol: "telnet" };
  }

  let protocol = params.get("type");
  if (!protocol && params.has("wss")) protocol = params.get("wss") !== "0" ? "wss" : "ws";
  if (!isProtocol(protocol)) {
    try {
      protocol = storage.getItem("darkflow-protocol");
    } catch {
      protocol = null;
    }
  }
  if (!isProtocol(protocol)) {
    protocol = config.host ? (config.wss ? "wss" : "ws") : baseline.protocol;
  }

  return {
    host: params.get("host")?.trim() || config.host.trim() || baseline.host,
    port:
      params.get("port")?.trim() || (config.host ? String(config.port) : baseline.port) || "4242",
    protocol: isProtocol(protocol) ? protocol : baseline.protocol,
  };
}

function renderBootError(target: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const title = document.createElement("h1");
  title.textContent = "Darkflow could not start";
  const detail = document.createElement("p");
  detail.textContent = message;
  const alert = document.createElement("main");
  alert.setAttribute("role", "alert");
  alert.append(title, detail);
  target.replaceChildren(alert);
}

const target = document.getElementById("app");
if (!target) {
  throw new Error("Phase 2 shell requires an #app element");
}

const urlSearchParams = new URLSearchParams(globalThis.location?.search ?? "");
let config = DEFAULT_CONFIG_JSON;

try {
  await runBootTransaction({
    storage: globalThis.localStorage,
    urlSearchParams,
    uuidFactory: () => crypto.randomUUID(),
    fetchConfig: async () => {
      const configResponse = await fetch("/config.json");
      const result = validateConfigJsonInput(configResponse.ok ? await configResponse.json() : {});
      config = result.success && result.data ? result.data : DEFAULT_CONFIG_JSON;
      return config;
    },
    importModule: importPublicModule,
    loadClient: async (record) => {
      const endpoint = resolvePhase2Endpoint(
        record.session.getConnectionSnapshot().endpoint,
        config,
        urlSearchParams,
        globalThis.localStorage,
        record.shell.zorkOnly,
      );
      const root = mount(App, {
        target,
        props: { endpoint, session: record.session, shell: record.shell },
      });
      record.session.onDispose(() => unmount(root));
      publishBootstrapPhase(window, "client-loaded");
    },
    setBootstrapPhase: (phase) => publishBootstrapPhase(window, phase),
    readRuntimeSlot: () => readPhase1RuntimeSlot(window),
    writeRuntimeSlot: (record) => writePhase1RuntimeSlot(window, record),
    clearRuntimeSlot: () => clearPhase1RuntimeSlot(window),
    publishSessionDiagnostic: (diagnostic) => {
      window.__darkflowPhase1Session = diagnostic;
    },
    clearSessionDiagnostic: () => {
      delete window.__darkflowPhase1Session;
    },
    webSocketFactory: (url) => new WebSocket(url),
    onlineTarget: globalThis.window,
    appOrigin: globalThis.location?.origin ?? "http://localhost:3000",
    launchUrl: globalThis.location?.href ?? "",
    onText: () => {},
  });
} catch (error) {
  renderBootError(target, error);
}
