const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  ClientArtifactError,
  validateClientArtifact,
} = require("../lib/client-artifact");
const packageMetadata = require("../package.json");

const repoRoot = path.resolve(__dirname, "..");
const writerPath = path.join(repoRoot, "scripts", "write-client-version.mjs");

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
    "index.html": "legacy entry\n",
    "assets/logo.txt": "logo bytes\n",
  };
  await Promise.all(
    Object.entries(publicFiles).flatMap(([relativePath, contents]) => [
      fs.writeFile(path.join(publicDir, relativePath), contents),
      fs.writeFile(path.join(artifactDir, relativePath), contents),
    ]),
  );
  await Promise.all([
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
  ]);

  return { artifactDir, publicDir, version };
}

async function expectInvalid(options, pattern) {
  await assert.rejects(
    validateClientArtifact(options),
    (error) =>
      error instanceof ClientArtifactError &&
      error.violations.some((violation) => pattern.test(violation)),
  );
}

test("accepts a complete client artifact", async (t) => {
  const fixture = await createFixture(t);
  const metadata = await validateClientArtifact({
    ...fixture,
    expectedVersion: fixture.version,
  });
  assert.deepEqual(metadata, { version: fixture.version });
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

test("reports every incomplete public copy violation", async (t) => {
  const fixture = await createFixture(t);
  await fs.rm(path.join(fixture.artifactDir, "assets", "logo.txt"));
  await fs.writeFile(path.join(fixture.publicDir, "config.json"), "source\n");
  await fs.writeFile(path.join(fixture.artifactDir, "config.json"), "built\n");

  await assert.rejects(
    validateClientArtifact({
      ...fixture,
      expectedVersion: fixture.version,
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
