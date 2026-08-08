const fs = require("fs");
const path = require("path");

class ClientArtifactError extends Error {
  constructor(violations) {
    super(
      `Invalid client artifact:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    this.name = "ClientArtifactError";
    this.code = "ERR_CLIENT_ARTIFACT_INVALID";
    this.violations = [...violations];
  }
}

async function isDirectory(directory) {
  try {
    return (await fs.promises.stat(directory)).isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function isFile(file) {
  try {
    return (await fs.promises.stat(file)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function collectFiles(directory, relativeDirectory = "") {
  const currentDirectory = path.join(directory, relativeDirectory);
  const entries = await fs.promises.readdir(currentDirectory, {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function referencedJavaScriptPaths(html) {
  const references = [];
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;

  for (const match of html.matchAll(scriptPattern)) {
    let url;
    try {
      url = new URL(match[1], "https://client-artifact.invalid/phase0/index.html");
    } catch {
      continue;
    }

    if (
      url.origin === "https://client-artifact.invalid" &&
      url.pathname.endsWith(".js")
    ) {
      try {
        const reference = path.posix
          .normalize(decodeURIComponent(url.pathname))
          .replace(/^\/+/, "");
        if (reference !== ".." && !reference.startsWith("../")) {
          references.push(reference);
        }
      } catch {
        // An invalid URL encoding cannot name a build output.
      }
    }
  }

  return references;
}

async function validateVersionFile({ artifactDir, expectedVersion, violations }) {
  const versionPath = path.join(artifactDir, "version.json");
  if (!(await isFile(versionPath))) {
    violations.push("missing required file: version.json");
    return undefined;
  }

  let metadata;
  try {
    metadata = JSON.parse(await fs.promises.readFile(versionPath, "utf8"));
  } catch (error) {
    violations.push(`malformed version.json: ${error.message}`);
    return undefined;
  }

  if (
    metadata === null ||
    Array.isArray(metadata) ||
    typeof metadata !== "object" ||
    typeof metadata.version !== "string" ||
    Object.keys(metadata).length !== 1
  ) {
    violations.push(
      'invalid version.json: expected exactly { "version": "<version>" }',
    );
    return undefined;
  }

  if (metadata.version !== expectedVersion) {
    violations.push(
      `version mismatch: expected ${expectedVersion}, received ${metadata.version}`,
    );
  }

  return metadata.version;
}

async function validatePhase0Bundle({ artifactDir, violations }) {
  const entryPath = path.join(artifactDir, "phase0", "index.html");
  if (!(await isFile(entryPath))) {
    violations.push("missing required file: phase0/index.html");
    return;
  }

  const html = await fs.promises.readFile(entryPath, "utf8");
  const references = referencedJavaScriptPaths(html);
  const phase0BundleReferences = references.filter((reference) =>
    /^assets\/phase0-[A-Za-z0-9_-]{8,}\.js$/.test(reference),
  );

  if (phase0BundleReferences.length === 0) {
    violations.push(
      "phase0/index.html does not reference the Vite Phase 0 JavaScript bundle",
    );
    return;
  }

  for (const reference of phase0BundleReferences) {
    if (!(await isFile(path.join(artifactDir, reference)))) {
      violations.push(
        `missing referenced Phase 0 JavaScript bundle: ${reference}`,
      );
    }
  }
}

async function validatePublicParity({ artifactDir, publicDir, violations }) {
  if (!(await isDirectory(publicDir))) {
    violations.push(`missing public directory: ${publicDir}`);
    return;
  }

  const publicFiles = await collectFiles(publicDir);
  for (const relativePath of publicFiles) {
    if (relativePath === "version.json") continue;

    const artifactPath = path.join(artifactDir, relativePath);
    if (!(await isFile(artifactPath))) {
      violations.push(`missing copied public file: ${relativePath}`);
      continue;
    }

    const [source, artifact] = await Promise.all([
      fs.promises.readFile(path.join(publicDir, relativePath)),
      fs.promises.readFile(artifactPath),
    ]);
    if (!source.equals(artifact)) {
      violations.push(`copied public file differs: ${relativePath}`);
    }
  }
}

async function validateClientArtifact({ artifactDir, publicDir, expectedVersion }) {
  if (!path.isAbsolute(artifactDir) || !path.isAbsolute(publicDir)) {
    throw new TypeError("artifactDir and publicDir must be absolute paths");
  }
  if (typeof expectedVersion !== "string" || expectedVersion.length === 0) {
    throw new TypeError("expectedVersion must be a non-empty string");
  }

  if (!(await isDirectory(artifactDir))) {
    throw new ClientArtifactError([
      `missing artifact directory: ${artifactDir}`,
    ]);
  }

  const violations = [];
  if (!(await isFile(path.join(artifactDir, "index.html")))) {
    violations.push("missing required file: index.html");
  }

  const version = await validateVersionFile({
    artifactDir,
    expectedVersion,
    violations,
  });
  await validatePhase0Bundle({ artifactDir, violations });
  await validatePublicParity({ artifactDir, publicDir, violations });

  if (violations.length > 0) {
    throw new ClientArtifactError(violations);
  }

  return Object.freeze({ version });
}

module.exports = {
  ClientArtifactError,
  validateClientArtifact,
};
