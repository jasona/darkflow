import {
  clearPhase1RuntimeSlot,
  publishBootstrapPhase,
  readPhase1RuntimeSlot,
  runBootTransaction,
  writePhase1RuntimeSlot,
  type SessionBootstrapDiagnostic,
} from "./bootstrap-transaction.ts";

declare global {
  interface Window {
    __darkflowPhase1Bootstrap?: import("./bootstrap-transaction.ts").BootstrapDiagnostic;
    __darkflowPhase1Session?: SessionBootstrapDiagnostic;
    __darkflowPhase1Runtime?: import("./bootstrap-transaction.ts").Phase1RuntimeRecord;
  }
}

const LEGACY_APP_ENTRY = "/js/app.js";

function importPublicModule<T = Record<string, unknown>>(entry: string): Promise<T> {
  return import(/* @vite-ignore */ entry) as Promise<T>;
}

async function loadLegacyApp(): Promise<void> {
  await importPublicModule(LEGACY_APP_ENTRY);
  publishBootstrapPhase(window, "legacy-loaded");
}

async function bootstrap(): Promise<void> {
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
      loadClient: async () => {
        await loadLegacyApp();
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
    console.error("Phase 1 session bootstrap failed; falling back to legacy runtime.", error);
    await loadLegacyApp();
  }
}

await bootstrap();
