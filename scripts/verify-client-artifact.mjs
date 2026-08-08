#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import clientArtifact from "../lib/client-artifact.js";

const {
  ClientArtifactError,
  validateClientArtifact,
  validateClientSourceParity,
} = clientArtifact;
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageMetadata = JSON.parse(
  await fs.readFile(path.join(repoRoot, "package.json"), "utf8"),
);
const artifactDir = path.join(repoRoot, "dist", "client");

try {
  let metadata;
  const violations = [];
  const validations = [
    async () => {
      metadata = await validateClientArtifact({
        artifactDir,
        expectedVersion: packageMetadata.version,
      });
    },
    async () => {
      await validateClientSourceParity({
        artifactDir,
        publicDir: path.join(repoRoot, "public"),
      });
    },
  ];

  for (const validate of validations) {
    try {
      await validate();
    } catch (error) {
      if (!(error instanceof ClientArtifactError)) throw error;
      violations.push(...error.violations);
    }
  }

  if (violations.length > 0) {
    throw new ClientArtifactError(violations);
  }

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
