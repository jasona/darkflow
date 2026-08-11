'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  executableCandidates,
  locatePackagedExecutable,
} = require('../desktop/run-packaged-smoke.cjs');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'darkflow-launcher-'));
}

function touch(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, 'executable\n');
}

for (const fixture of [
  { name: 'Linux', platform: 'linux', arch: 'x64', index: 1, suffix: 'linux-unpacked/darkwind' },
  { name: 'Windows', platform: 'win32', arch: 'x64', index: 1, suffix: 'win-unpacked/Darkwind.exe' },
  { name: 'Intel macOS', platform: 'darwin', arch: 'x64', index: 0, suffix: 'mac-x64/Darkwind.app/Contents/MacOS/Darkwind' },
  { name: 'Apple Silicon macOS', platform: 'darwin', arch: 'arm64', index: 0, suffix: 'mac-arm64/Darkwind.app/Contents/MacOS/Darkwind' },
  { name: 'universal macOS', platform: 'darwin', arch: 'x64', index: 1, suffix: 'mac-universal/Darkwind.app/Contents/MacOS/Darkwind' },
]) {
  test(`discovers the ${fixture.name} unpacked executable`, () => {
    const root = temporaryRoot();
    try {
      const candidates = executableCandidates(root, fixture);
      touch(candidates[fixture.index]);
      assert.equal(locatePackagedExecutable(root, fixture), path.join(root, fixture.suffix));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('executable discovery fails clearly for missing and ambiguous layouts', () => {
  const root = temporaryRoot();
  try {
    const options = { platform: 'linux', arch: 'x64' };
    const candidates = executableCandidates(root, options);
    assert.throws(() => locatePackagedExecutable(root, options), /No unpacked Electron executable.*Checked:/);
    candidates.forEach(touch);
    assert.throws(() => locatePackagedExecutable(root, options), /Multiple unpacked Electron executables/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('executable discovery rejects unsupported platforms', () => {
  assert.throws(() => executableCandidates('/tmp/package', { platform: 'aix' }),
    /Unsupported packaged Electron platform: aix/);
});
