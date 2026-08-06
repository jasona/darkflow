import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TYPIA_NO_TRANSFORM_SENTINEL } from "./typia-sentinel.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const scriptPath = path.join(repoRoot, "scripts", "verify-bundle-sentinel.mjs");

/** Runs the bundle sentinel script against a directory argument. */
function runSentinel(directory) {
  return spawnSync(process.execPath, [scriptPath, directory], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("bundle sentinel rejects poisoned JavaScript output", async (t) => {
  const fixtureDir = path.join(
    repoRoot,
    "dist",
    `.bundle-sentinel-poison-${process.pid}`,
  );
  t.after(async () => {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.writeFile(
    path.join(fixtureDir, "poison.js"),
    `throw new Error("Error on typia.createValidate(): ${TYPIA_NO_TRANSFORM_SENTINEL}");`,
  );

  const result = runSentinel(fixtureDir);
  assert.notEqual(result.status, 0);
});

test("bundle sentinel accepts clean JavaScript output", async (t) => {
  const fixtureDir = path.join(
    repoRoot,
    "dist",
    `.bundle-sentinel-clean-${process.pid}`,
  );
  t.after(async () => {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.writeFile(
    path.join(fixtureDir, "clean.js"),
    "export const ok = true;",
  );

  const result = runSentinel(fixtureDir);
  assert.equal(result.status, 0);
});

test("bundle sentinel rejects an empty directory", async (t) => {
  const fixtureDir = path.join(
    repoRoot,
    "dist",
    `.bundle-sentinel-empty-${process.pid}`,
  );
  t.after(async () => {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  await fs.mkdir(fixtureDir, { recursive: true });
  const result = runSentinel(fixtureDir);
  assert.notEqual(result.status, 0);
});
