import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Phase 0 harness requires a #app element");
}

mount(App, { target });
