import { fileURLToPath } from "node:url";
import ttsc from "@ttsc/unplugin/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: "../public",
  appType: "mpa",
  plugins: [ttsc(), svelte()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        root: fileURLToPath(new URL("./client/index.html", import.meta.url)),
        phase0: fileURLToPath(new URL("./client/phase0/index.html", import.meta.url)),
      },
    },
  },
});
