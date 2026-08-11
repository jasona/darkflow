import { validateHmrRoom } from "./hmr-validators.ts";

let probe;

/** Connects the HMR boundary to the Svelte store owned by hmr-probe.ts. */
export function bindHmrProbe(hmrProbe) {
  probe = hmrProbe;
  probe.set(String(validateHmrRoom({ id: 1 }).success));
}

if (import.meta.hot) {
  import.meta.hot.accept("./hmr-validators.ts", (mod) => {
    if (mod && probe) probe.set(String(mod.validateHmrRoom({ id: 1 }).success));
  });
}
