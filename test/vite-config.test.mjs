import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfigFromFile, resolveConfig } from "vite";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("vite build config keeps the Phase 0 artifact contract", async () => {
  const loaded = await loadConfigFromFile(
    { command: "build", mode: "production" },
    undefined,
    repoRoot,
  );
  assert.ok(loaded, "vite.config.ts must load");
  const config = await resolveConfig(loaded.config, "build");

  assert.ok(
    config.root.endsWith(`${path.sep}client`),
    `unexpected root: ${config.root}`,
  );
  assert.equal(config.publicDir, path.join(repoRoot, "public"));
  assert.equal(
    path.resolve(config.root, config.build.outDir),
    path.join(repoRoot, "dist", "client"),
  );
  assert.equal(config.build.emptyOutDir, true);

  const input =
    config.build.rolldownOptions?.input ?? config.build.rollupOptions?.input;
  const expectedRootEntry = path.join(repoRoot, "client", "index.html");
  const expectedPhase0Entry = path.join(
    repoRoot,
    "client",
    "phase0",
    "index.html",
  );
  assert.equal(typeof input, "object");
  assert.equal(input.root, expectedRootEntry);
  assert.equal(input.phase0, expectedPhase0Entry);

  const plugins = config.plugins;
  const ttscIndex = plugins.findIndex(
    (plugin) => plugin.name === "ttsc-unplugin",
  );
  const svelteIndex = plugins.findIndex((plugin) =>
    plugin.name?.startsWith("vite-plugin-svelte"),
  );
  assert.ok(ttscIndex >= 0, "ttsc-unplugin missing from resolved plugins");
  assert.ok(
    svelteIndex >= 0,
    "vite-plugin-svelte missing from resolved plugins",
  );
  assert.ok(
    ttscIndex < svelteIndex,
    "ttsc-unplugin must run before vite-plugin-svelte",
  );
});
