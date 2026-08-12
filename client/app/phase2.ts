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

try {
  await runBootTransaction({
    storage: globalThis.localStorage,
    urlSearchParams: new URLSearchParams(globalThis.location?.search ?? ""),
    uuidFactory: () => crypto.randomUUID(),
    fetchConfig: async () => {
      const configResponse = await fetch("/config.json");
      return configResponse.ok ? await configResponse.json() : {};
    },
    importModule: importPublicModule,
    loadClient: async (record) => {
      const root = mount(App, { target, props: { session: record.session, shell: record.shell } });
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
