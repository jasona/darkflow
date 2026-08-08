'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');
const packageMetadata = require('../package.json');
const {
  locatePackagedResources,
  validateDesktopPackage,
  validateUpdateMetadata,
} = require('../desktop/validate-package.cjs');

async function createFixture({
  omitClient = false,
  forbiddenPath = '',
  version = packageMetadata.version,
  updateMetadata = true,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'darkflow-package-'));
  const sourceClientDir = path.join(root, 'source-client');
  const appDir = path.join(root, 'app');
  const resourcesDir = path.join(root, 'linux-unpacked', 'resources');
  fs.mkdirSync(path.join(sourceClientDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(sourceClientDir, 'index.html'), '<!doctype html>\n');
  fs.writeFileSync(path.join(sourceClientDir, 'assets', 'app.js'), 'export {};\n');

  for (const entry of [
    'desktop/main.cjs',
    'desktop/preload.cjs',
    'desktop/runtime.cjs',
    'desktop/updater.cjs',
    'lib/client-artifact.js',
    'lib/telnet-parser.js',
    'server.js',
  ]) {
    const target = path.join(appDir, entry);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${entry}\n`);
  }
  for (const entry of ['index.html', 'assets/app.js']) {
    if (omitClient && entry === 'assets/app.js') continue;
    const target = path.join(appDir, 'dist', 'client', entry);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceClientDir, entry), target);
  }
  if (forbiddenPath) {
    const target = path.join(appDir, forbiddenPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'forbidden\n');
  }
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: packageMetadata.name,
    version,
    main: packageMetadata.main,
    darkflowDistribution: 'direct',
  }));

  fs.mkdirSync(resourcesDir, { recursive: true });
  await asar.createPackage(appDir, path.join(resourcesDir, 'app.asar'));
  if (updateMetadata) {
    fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), [
      'provider: github',
      'owner: jasona',
      'repo: darkflow',
      '',
    ].join('\n'));
  }
  return { root, sourceClientDir };
}

test('package validator accepts a complete built-client ASAR and updater metadata', async () => {
  const fixture = await createFixture();
  try {
    const result = validateDesktopPackage(fixture.root, { sourceClientDir: fixture.sourceClientDir });
    assert.equal(result.clientFileCount, 2);
    assert.match(result.appAsar, /app\.asar$/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('package validator rejects missing client files', async () => {
  const fixture = await createFixture({ omitClient: true });
  try {
    assert.throws(() => validateDesktopPackage(fixture.root, { sourceClientDir: fixture.sourceClientDir }),
      /Missing: dist\/client\/assets\/app\.js/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('package validator rejects source paths, version mismatches, and missing updater metadata', async (t) => {
  await t.test('forbidden source path', async () => {
    const fixture = await createFixture({ forbiddenPath: 'public/index.html' });
    try {
      assert.throws(() => validateDesktopPackage(fixture.root, { sourceClientDir: fixture.sourceClientDir }),
        /forbidden source paths: public\/index\.html/);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test('version mismatch', async () => {
    const fixture = await createFixture({ version: '0.0.0' });
    try {
      assert.throws(() => validateDesktopPackage(fixture.root, { sourceClientDir: fixture.sourceClientDir }),
        /package\.json version must be/);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test('missing updater metadata', async () => {
    const fixture = await createFixture({ updateMetadata: false });
    try {
      assert.throws(() => validateDesktopPackage(fixture.root, { sourceClientDir: fixture.sourceClientDir }),
        /updater metadata is missing/);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test('package resource discovery rejects missing and ambiguous archives', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'darkflow-package-layout-'));
  try {
    assert.throws(() => locatePackagedResources(root), /No app\.asar/);
    for (const directory of ['one/resources', 'two/resources']) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
      fs.writeFileSync(path.join(root, directory, 'app.asar'), 'fixture');
    }
    assert.throws(() => locatePackagedResources(root), /Multiple app\.asar/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('directory-only macOS packages use the verified Electron Builder publish config equivalent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'darkflow-mac-update-'));
  const resourcesDir = path.join(root, 'Darkwind.app', 'Contents', 'Resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  try {
    assert.throws(() => validateUpdateMetadata(resourcesDir, { owner: 'jasona', repo: 'darkflow' }),
      /updater metadata is missing/);
    assert.equal(
      validateUpdateMetadata(resourcesDir, { owner: 'jasona', repo: 'darkflow' }, { allowDirectoryOnlyMac: true }),
      'electron-builder build.publish (directory-only macOS equivalent)',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
