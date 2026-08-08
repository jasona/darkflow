#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageMetadata = JSON.parse(
  await fs.readFile(path.join(repoRoot, "package.json"), "utf8"),
);
const targetDir = path.resolve(repoRoot, process.argv[2] ?? "dist/client");
const targetPath = path.join(targetDir, "version.json");
const temporaryPath = path.join(
  targetDir,
  `.version.json.${process.pid}.${Date.now()}.tmp`,
);

await fs.mkdir(targetDir, { recursive: true });
try {
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify({ version: packageMetadata.version }, null, 2)}\n`,
    { flag: "wx" },
  );
  await fs.rename(temporaryPath, targetPath);
} finally {
  await fs.rm(temporaryPath, { force: true });
}

console.log(
  `write-client-version: wrote ${path.relative(repoRoot, targetPath)} (${packageMetadata.version})`,
);
