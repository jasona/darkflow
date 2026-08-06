#!/usr/bin/env node
/**
 * Scans shipped JavaScript artifacts for untransformed Typia factory calls.
 *
 * Use `npm run build` so postbuild runs this check. Direct `npx vite build`
 * bypasses npm lifecycle hooks and skips the sentinel gate.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TYPIA_NO_TRANSFORM_SENTINEL } from "../test/typia-sentinel.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Recursively collects JavaScript file paths under a directory. */
async function collectJavaScriptFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScriptFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}

const targetDir = path.resolve(repoRoot, process.argv[2] ?? "dist/client");
const files = await collectJavaScriptFiles(targetDir);

if (files.length === 0) {
  console.error(
    `verify-bundle-sentinel: no JavaScript files found under ${targetDir}`,
  );
  process.exit(1);
}

const offenders = [];
for (const filePath of files) {
  const contents = await fs.readFile(filePath, "utf8");
  if (contents.includes(TYPIA_NO_TRANSFORM_SENTINEL)) {
    offenders.push(path.relative(repoRoot, filePath));
  }
}

console.log(
  `verify-bundle-sentinel: scanned ${files.length} JavaScript file(s) under ${path.relative(repoRoot, targetDir)}`,
);

if (offenders.length > 0) {
  console.error("verify-bundle-sentinel: untransformed Typia code detected:");
  for (const offender of offenders) {
    console.error(`  ${offender}`);
  }
  process.exit(1);
}
