import { mount } from "svelte";
import App from "./App.svelte";
import { runTypiaProof } from "./typia-proof";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Phase 0 harness requires a #app element");
}

const proof = runTypiaProof();
mount(App, { target, props: { proof } });
