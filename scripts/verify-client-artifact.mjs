#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import clientArtifact from "../lib/client-artifact.js";

const { ClientArtifactError, validateClientArtifact } = clientArtifact;
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageMetadata = JSON.parse(
  await fs.readFile(path.join(repoRoot, "package.json"), "utf8"),
);
const artifactDir = path.join(repoRoot, "dist", "client");

try {
  const metadata = await validateClientArtifact({
    artifactDir,
    publicDir: path.join(repoRoot, "public"),
    expectedVersion: packageMetadata.version,
  });
  console.log(
    `verify-client-artifact: validated ${path.relative(repoRoot, artifactDir)} (${metadata.version})`,
  );
} catch (error) {
  if (error instanceof ClientArtifactError) {
    console.error(`verify-client-artifact: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
