import { writable } from "svelte/store";
import { bindHmrProbe } from "./hmr-accept.js";

export const hmrProbe = writable("pending");
bindHmrProbe(hmrProbe);
