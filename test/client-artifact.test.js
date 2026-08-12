const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  ClientArtifactError,
  validateClientArtifact,
  validateClientSourceParity,
} = require("../lib/client-artifact");
const packageMetadata = require("../package.json");

const repoRoot = path.resolve(__dirname, "..");
const writerPath = path.join(repoRoot, "scripts", "write-client-version.mjs");

const ROOT_BUNDLE = "assets/root-AbCd1234.js";
const ROOT_BUNDLE_CONTENTS = [
  'window.__darkflowPhase1Bootstrap = { phase: "legacy-loaded" };',
  'import("/js/app.js");',
  "export {};",
].join("\n");

async function createFixture(t, version = "1.2.3") {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "darkflow-client-artifact-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const publicDir = path.join(root, "public");
  const artifactDir = path.join(root, "client");
  await fs.mkdir(path.join(publicDir, "assets"), { recursive: true });
  await fs.mkdir(path.join(artifactDir, "assets"), { recursive: true });
  await fs.mkdir(path.join(artifactDir, "phase0"), { recursive: true });

  const publicFiles = {
    "assets/logo.txt": "logo bytes\n",
  };
  await Promise.all(
    Object.entries(publicFiles).map(([relativePath, contents]) =>
      fs.writeFile(path.join(publicDir, relativePath), contents),
    ),
  );
  await Promise.all([
    fs.writeFile(path.join(artifactDir, "assets", "logo.txt"), "logo bytes\n"),
    fs.writeFile(
      path.join(artifactDir, "index.html"),
      `<script type="module" src="/${ROOT_BUNDLE}"></script>\n`,
    ),
    fs.writeFile(
      path.join(artifactDir, "version.json"),
      JSON.stringify({ version }),
    ),
    fs.writeFile(
      path.join(artifactDir, "phase0", "index.html"),
      '<script type="module" src="/assets/phase0-AbCd1234.js"></script>\n',
    ),
    fs.writeFile(
      path.join(artifactDir, "assets", "phase0-AbCd1234.js"),
      "export const ready = true;\n",
    ),
    fs.writeFile(
      path.join(artifactDir, ROOT_BUNDLE),
      `${ROOT_BUNDLE_CONTENTS}\n`,
    ),
  ]);

  return { root, artifactDir, publicDir, version, rootBundle: ROOT_BUNDLE };
}

async function expectInvalid(options, pattern) {
  await assert.rejects(
    validateClientArtifact(options),
    (error) =>
      error instanceof ClientArtifactError &&
      error.violations.some((violation) => pattern.test(violation)),
  );
}

async function expectInvalidParity(options, pattern) {
  await assert.rejects(
    validateClientSourceParity(options),
    (error) =>
      error instanceof ClientArtifactError &&
      error.violations.some((violation) => pattern.test(violation)),
  );
}

test("accepts a complete client artifact without its public source", async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(fixture.publicDir, { recursive: true });
  const metadata = await validateClientArtifact({
    artifactDir: fixture.artifactDir,
    expectedVersion: fixture.version,
  });
  assert.deepEqual(metadata, { version: fixture.version });
});

test("accepts a root handoff in a preloaded bundle", async (t) => {
  const fixture = await createFixture(t);
  const sharedBundle = "assets/shared-AbCd1234.js";
  await Promise.all([
    fs.writeFile(
      path.join(fixture.artifactDir, "index.html"),
      `<script type="module" src="/${ROOT_BUNDLE}"></script><link rel="modulepreload" href="/${sharedBundle}">\n`,
    ),
    fs.writeFile(path.join(fixture.artifactDir, fixture.rootBundle), "export {};\n"),
    fs.writeFile(path.join(fixture.artifactDir, sharedBundle), `${ROOT_BUNDLE_CONTENTS}\n`),
  ]);

  await validateClientArtifact({
    artifactDir: fixture.artifactDir,
    expectedVersion: fixture.version,
  });
});

test("accepts complete client source parity", async (t) => {
  const fixture = await createFixture(t);
  await validateClientSourceParity({
    artifactDir: fixture.artifactDir,
    publicDir: fixture.publicDir,
  });
});

test("rejects a missing artifact directory", async (t) => {
  const fixture = await createFixture(t);
  await expectInvalid(
    {
      ...fixture,
      artifactDir: path.join(fixture.artifactDir, "missing"),
      expectedVersion: fixture.version,
    },
    /missing artifact directory/,
  );
});

test("rejects a missing required entry", async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(path.join(fixture.artifactDir, "index.html"));
  await expectInvalid(
    { ...fixture, expectedVersion: fixture.version },
    /missing required file: index\.html/,
  );
});

test("rejects missing version metadata", async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(path.join(fixture.artifactDir, "version.json"));
  await expectInvalid(
    { artifactDir: fixture.artifactDir, expectedVersion: fixture.version },
    /missing required file: version\.json/,
  );
});

test("rejects a missing Phase 0 entry", async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(path.join(fixture.artifactDir, "phase0", "index.html"));
  await expectInvalid(
    { artifactDir: fixture.artifactDir, expectedVersion: fixture.version },
    /missing required file: phase0\/index\.html/,
  );
});

test("rejects malformed version metadata", async (t) => {
  const fixture = await createFixture(t);
  await fs.writeFile(path.join(fixture.artifactDir, "version.json"), "{");
  await expectInvalid(
    { ...fixture, expectedVersion: fixture.version },
    /malformed version\.json/,
  );
});

test("rejects version metadata with extra fields", async (t) => {
  const fixture = await createFixture(t);
  await fs.writeFile(
    path.join(fixture.artifactDir, "version.json"),
    JSON.stringify({ version: fixture.version, source: "public" }),
  );
  await expectInvalid(
    { ...fixture, expectedVersion: fixture.version },
    /expected exactly/,
  );
});

test("rejects mismatched version metadata", async (t) => {
  const fixture = await createFixture(t);
  await expectInvalid(
    { ...fixture, expectedVersion: "9.9.9" },
    /version mismatch: expected 9\.9\.9, received 1\.2\.3/,
  );
});

test("source parity reports every incomplete public copy violation", async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(path.join(fixture.artifactDir, "assets", "logo.txt"));
  await fs.writeFile(path.join(fixture.publicDir, "config.json"), "source\n");
  await fs.writeFile(path.join(fixture.artifactDir, "config.json"), "built\n");

  await assert.rejects(
    validateClientSourceParity({
      artifactDir: fixture.artifactDir,
      publicDir: fixture.publicDir,
    }),
    (error) => {
      assert.ok(error instanceof ClientArtifactError);
      assert.ok(
        error.violations.includes("missing copied public file: assets/logo.txt"),
      );
      assert.ok(
        error.violations.includes("copied public file differs: config.json"),
      );
      return true;
    },
  );
});

test("source parity rejects an absent public source tree", async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(fixture.publicDir, { recursive: true });
  await expectInvalidParity(
    { artifactDir: fixture.artifactDir, publicDir: fixture.publicDir },
    /missing public directory/,
  );
});

test("reports every missing referenced Phase 0 JavaScript bundle", async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(
    path.join(fixture.artifactDir, "assets", "phase0-AbCd1234.js"),
  );
  await fs.writeFile(
    path.join(fixture.artifactDir, "phase0", "index.html"),
    [
      '<script type="module" src="/assets/phase0-AbCd1234.js"></script>',
      '<script type="module" src="/assets/phase0-EfGh5678.js"></script>',
    ].join("\n"),
  );

  await assert.rejects(
    validateClientArtifact({
      ...fixture,
      expectedVersion: fixture.version,
    }),
    (error) => {
      assert.ok(error instanceof ClientArtifactError);
      assert.ok(
        error.violations.includes(
          "missing referenced Phase 0 JavaScript bundle: assets/phase0-AbCd1234.js",
        ),
      );
      assert.ok(
        error.violations.includes(
          "missing referenced Phase 0 JavaScript bundle: assets/phase0-EfGh5678.js",
        ),
      );
      return true;
    },
  );
});

test("rejects a direct legacy module tag in the root entry", async (t) => {
  const fixture = await createFixture(t);
  await fs.writeFile(
    path.join(fixture.artifactDir, "index.html"),
    '<script type="module" src="/js/app.js"></script>\n',
  );

  await expectInvalid(
    { ...fixture, expectedVersion: fixture.version },
    /directly loads \/js\/app\.js/,
  );
});

test("rejects a raw TypeScript root entry", async (t) => {
  const fixture = await createFixture(t);
  await fs.writeFile(
    path.join(fixture.artifactDir, "index.html"),
    '<script type="module" src="/app/bootstrap.ts"></script>\n',
  );

  await expectInvalid(
    { ...fixture, expectedVersion: fixture.version },
    /directly loads a TypeScript entry/,
  );
});

test("rejects a missing root bundle reference", async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(path.join(fixture.artifactDir, fixture.rootBundle));
  await expectInvalid(
    { ...fixture, expectedVersion: fixture.version },
    /missing referenced JavaScript bundle: assets\/root-AbCd1234\.js/,
  );
});

test("rejects a generated root bundle without the legacy runtime handoff", async (t) => {
  const fixture = await createFixture(t);
  await fs.writeFile(
    path.join(fixture.artifactDir, fixture.rootBundle),
    'window.__darkflowPhase1Bootstrap = { phase: "legacy-loaded" };\n',
  );

  await expectInvalid(
    { ...fixture, expectedVersion: fixture.version },
    /missing legacy runtime handoff/,
  );
});

test("rejects a copied legacy script as the Phase 0 bundle", async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.join(fixture.artifactDir, "js"));
  await fs.writeFile(
    path.join(fixture.artifactDir, "js", "map-speedwalk.js"),
    "export const ready = true;\n",
  );
  await fs.writeFile(
    path.join(fixture.artifactDir, "phase0", "index.html"),
    '<script type="module" src="/js/map-speedwalk.js"></script>\n',
  );

  await expectInvalid(
    { ...fixture, expectedVersion: fixture.version },
    /does not reference the Vite Phase 0 JavaScript bundle/,
  );
});

test("writer atomically replaces version metadata from package.json", async (t) => {
  const fixture = await createFixture(t, "stale");
  const result = spawnSync(process.execPath, [writerPath, fixture.artifactDir], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const metadata = JSON.parse(
    await fs.readFile(path.join(fixture.artifactDir, "version.json"), "utf8"),
  );
  assert.deepEqual(metadata, { version: packageMetadata.version });
  assert.deepEqual(
    (await fs.readdir(fixture.artifactDir)).filter((entry) =>
      entry.includes(".tmp"),
    ),
    [],
  );
});

test("build verifier aggregates runtime and source parity violations", async (t) => {
  const fixture = await createFixture(t);
  const verifierRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "darkflow-client-verifier-"),
  );
  t.after(() => fs.rm(verifierRoot, { recursive: true, force: true }));

  await Promise.all([
    fs.mkdir(path.join(verifierRoot, "scripts"), { recursive: true }),
    fs.mkdir(path.join(verifierRoot, "lib"), { recursive: true }),
    fs.mkdir(path.join(verifierRoot, "dist"), { recursive: true }),
  ]);
  await Promise.all([
    fs.copyFile(
      path.join(repoRoot, "scripts", "verify-client-artifact.mjs"),
      path.join(verifierRoot, "scripts", "verify-client-artifact.mjs"),
    ),
    fs.copyFile(
      path.join(repoRoot, "lib", "client-artifact.js"),
      path.join(verifierRoot, "lib", "client-artifact.js"),
    ),
    fs.cp(fixture.publicDir, path.join(verifierRoot, "public"), {
      recursive: true,
    }),
    fs.cp(fixture.artifactDir, path.join(verifierRoot, "dist", "client"), {
      recursive: true,
    }),
    fs.writeFile(
      path.join(verifierRoot, "package.json"),
      JSON.stringify({ version: fixture.version }),
    ),
  ]);
  await fs.rm(path.join(verifierRoot, "dist", "client", "index.html"));
  await fs.writeFile(
    path.join(verifierRoot, "dist", "client", "assets", "logo.txt"),
    "changed bytes\n",
  );

  const result = spawnSync(
    process.execPath,
    [path.join(verifierRoot, "scripts", "verify-client-artifact.mjs")],
    { cwd: verifierRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /missing required file: index\.html/);
  assert.match(result.stderr, /copied public file differs: assets\/logo\.txt/);
});
