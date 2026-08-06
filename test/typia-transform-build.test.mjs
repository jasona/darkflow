import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "vite";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test(
  "Typia validators execute from a minified production bundle",
  { timeout: 120_000 },
  async (t) => {
    const proofModulePath = path.join(
      repoRoot,
      "client",
      "phase0",
      "typia-proof.ts",
    );
    const tmpOut = path.join(repoRoot, "dist", `.typia-proof-${process.pid}`);

    t.after(async () => {
      await fs.rm(tmpOut, { recursive: true, force: true });
    });

    const result = await build({
      configFile: path.join(repoRoot, "vite.config.ts"),
      logLevel: "silent",
      publicDir: false,
      build: {
        outDir: tmpOut,
        emptyOutDir: true,
        rolldownOptions: {
          input: { "typia-proof": proofModulePath },
        },
      },
    });

    assert.equal(Array.isArray(result), false);
    const output = /** @type {import("vite").Rollup.RolldownOutput} */ (result);
    const entryChunk = output.output.find(
      (artifact) =>
        artifact.type === "chunk" &&
        artifact.isEntry === true &&
        artifact.name === "typia-proof",
    );
    assert.ok(entryChunk, "typia-proof entry chunk must exist");

    await fs.writeFile(
      path.join(tmpOut, "package.json"),
      JSON.stringify({ type: "module" }),
    );

    const bundle = await import(
      pathToFileURL(path.join(tmpOut, entryChunk.fileName)).href
    );

    const proof = bundle.runTypiaProof();
    assert.equal(proof.ok, true);
    assert.equal(proof.cases.length, 8);
    assert.ok(
      proof.cases.every((testCase) => testCase.passed),
      `failed cases: ${proof.cases
        .filter((testCase) => !testCase.passed)
        .map((testCase) => testCase.name)
        .join(", ")}`,
    );
  },
);
