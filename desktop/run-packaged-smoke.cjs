'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const packageMetadata = require('../package.json');

function executableCandidates(packageRoot, {
  platform = process.platform,
  arch = process.arch,
  productName = packageMetadata.build?.productName || packageMetadata.desktopName || 'Darkwind',
} = {}) {
  const root = path.resolve(packageRoot);
  if (platform === 'linux') {
    return [
      path.join(root, `linux-${arch}-unpacked`, 'darkwind'),
      path.join(root, 'linux-unpacked', 'darkwind'),
    ];
  }
  if (platform === 'win32') {
    return [
      path.join(root, `win-${arch}-unpacked`, `${productName}.exe`),
      path.join(root, 'win-unpacked', `${productName}.exe`),
    ];
  }
  if (platform === 'darwin') {
    const executable = path.join(`${productName}.app`, 'Contents', 'MacOS', productName);
    return [
      path.join(root, `mac-${arch}`, executable),
      path.join(root, 'mac-universal', executable),
      path.join(root, 'mac', executable),
    ];
  }
  throw new Error(`Unsupported packaged Electron platform: ${platform}`);
}

function locatePackagedExecutable(packageRoot, options = {}) {
  const candidates = [...new Set(executableCandidates(packageRoot, options))];
  const matches = candidates.filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (matches.length === 0) {
    throw new Error(`No unpacked Electron executable was found. Checked: ${candidates.join(', ')}`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple unpacked Electron executables matched: ${matches.join(', ')}`);
  }
  return matches[0];
}

async function runPackagedSmoke(packageRoot, {
  platform = process.platform,
  arch = process.arch,
  timeoutMs = 120_000,
  env = process.env,
} = {}) {
  const executable = locatePackagedExecutable(packageRoot, { platform, arch });
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'darkflow-packaged-smoke-'));
  let output = '';
  let timer;
  let timedOut = false;

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(executable, [
        '--smoke-test',
        `--user-data-dir=${profileDirectory}`,
      ], {
        env: { ...env, DARKFLOW_DESKTOP_PORT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        process.stdout.write(chunk);
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
        process.stderr.write(chunk);
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
    });
    if (timedOut) {
      throw new Error(`Packaged Electron smoke timed out after ${timeoutMs}ms. Output:\n${output}`);
    }
    if (result.code !== 0) {
      throw new Error(`Packaged Electron smoke exited with code ${result.code} signal ${result.signal || 'none'}. Output:\n${output}`);
    }
    if (!output.includes('[desktop-smoke]')) {
      throw new Error(`Packaged Electron smoke did not report its result. Output:\n${output}`);
    }
    return { executable, output };
  } finally {
    clearTimeout(timer);
    fs.rmSync(profileDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runPackagedSmoke(process.argv[2] || path.join(__dirname, '..', 'dist', 'desktop'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  executableCandidates,
  locatePackagedExecutable,
  runPackagedSmoke,
};
