import type { Writable } from "svelte/store";

/** Connects the HMR boundary to the phase 0 probe store. */
export function bindHmrProbe(hmrProbe: Writable<string>): void;
