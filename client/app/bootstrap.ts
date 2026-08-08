import typia from "typia";

/** Temporary Phase 1 bootstrap diagnostic exposed until Step 13 cutover. */
interface BootstrapDiagnostic {
  phase: "bootstrapping" | "legacy-loaded";
}

const validateBootstrapDiagnostic = typia.createValidate<BootstrapDiagnostic>();

declare global {
  interface Window {
    __darkflowPhase1Bootstrap?: BootstrapDiagnostic;
  }
}

const bootstrapping: BootstrapDiagnostic = { phase: "bootstrapping" };
if (!validateBootstrapDiagnostic(bootstrapping).success) {
  throw new Error("Bootstrap diagnostic validation failed before legacy import");
}

window.__darkflowPhase1Bootstrap = bootstrapping;

const legacyAppEntry = "/js/app.js";
await import(/* @vite-ignore */ legacyAppEntry);

const legacyLoaded: BootstrapDiagnostic = { phase: "legacy-loaded" };
if (!validateBootstrapDiagnostic(legacyLoaded).success) {
  throw new Error("Bootstrap diagnostic validation failed after legacy import");
}

window.__darkflowPhase1Bootstrap = legacyLoaded;
