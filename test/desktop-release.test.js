'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const packageMetadata = require('../package.json');
const {
  releaseContract,
  validatePlatformRelease,
} = require('../desktop/validate-release.cjs');

test('desktop release scripts explicitly produce unsigned packages', () => {
  assert.equal(packageMetadata.build.mac.identity, null);
  assert.equal(packageMetadata.build.mac.notarize, false);
  assert.equal(packageMetadata.build.mac.hardenedRuntime, false);
  assert.match(packageMetadata.scripts['desktop:release:mac'],
    /mac\.identity=null/);
  assert.match(packageMetadata.scripts['desktop:release:mac'],
    /mac\.notarize=false/);
  assert.match(packageMetadata.scripts['desktop:release:mac'],
    /mac\.hardenedRuntime=false/);
  assert.doesNotMatch(packageMetadata.scripts['desktop:release:win'],
    /forceCodeSigning=true/);
  assert.doesNotMatch(packageMetadata.scripts['desktop:dist:mac'],
    /forceCodeSigning/);
  assert.doesNotMatch(packageMetadata.scripts['desktop:dist:win'],
    /forceCodeSigning/);
});

test('every Electron package command builds the client through the shared prerequisite', () => {
  const packageScripts = [
    'desktop:pack',
    'desktop:dist',
    'desktop:dist:mac',
    'desktop:dist:win',
    'desktop:dist:linux',
    'desktop:release:mac',
    'desktop:release:win',
    'desktop:release:linux',
    'desktop:steam',
    'desktop:steam:mac',
    'desktop:steam:win',
    'desktop:steam:linux',
  ];

  assert.equal(packageMetadata.scripts['desktop:prepare-client'], 'npm run build');
  for (const script of packageScripts) {
    assert.match(packageMetadata.scripts[script], /^npm run desktop:prepare-client && electron-builder\b/, script);
  }
  assert.equal(packageMetadata.devDependencies['@electron/asar'], '3.4.1');
  assert.ok(packageMetadata.build.files.includes('dist/client/**/*'));
  assert.ok(!packageMetadata.build.files.includes('public/**/*'));
});

test('release validator requires installers, blockmaps, metadata, and checksums', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'darkflow-release-'));
  const version = '9.8.7';
  const contract = releaseContract('win', version);

  try {
    for (const artifact of contract.artifacts) {
      fs.writeFileSync(path.join(directory, artifact), 'artifact\n');
    }
    fs.writeFileSync(path.join(directory, contract.metadata), [
      `version: ${version}`,
      'files:',
      `  - url: ${contract.downloads[0]}`,
      '    sha512: checksum',
      `path: ${contract.downloads[0]}`,
      'sha512: checksum',
      '',
    ].join('\n'));

    assert.doesNotThrow(() =>
      validatePlatformRelease('win', directory, { version }));

    fs.unlinkSync(path.join(directory, `${contract.downloads[0]}.blockmap`));
    assert.throws(() =>
      validatePlatformRelease('win', directory, { version }),
    /missing .*\.blockmap/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
