'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');
const packageMetadata = require('../package.json');

function regularFiles(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) {
    throw new Error(`Client artifact directory is missing: ${rootDirectory}`);
  }

  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(path.relative(rootDirectory, absolutePath).split(path.sep).join('/'));
    }
  };
  visit(rootDirectory);
  return files.sort();
}

function findFiles(rootDirectory, basename) {
  if (!fs.existsSync(rootDirectory)) return [];
  const matches = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && entry.name === basename) matches.push(absolutePath);
    }
  };
  visit(rootDirectory);
  return matches.sort();
}

function locatePackagedResources(packageRoot) {
  const archives = findFiles(packageRoot, 'app.asar');
  if (archives.length === 0) {
    throw new Error(`No app.asar was found under ${packageRoot}`);
  }
  if (archives.length > 1) {
    throw new Error(`Multiple app.asar archives were found under ${packageRoot}: ${archives.join(', ')}`);
  }
  return { appAsar: archives[0], resourcesDir: path.dirname(archives[0]) };
}

function normalizeAsarPath(candidate) {
  return candidate.replace(/^[/\\]+/, '').split(path.sep).join('/');
}

function validateUpdateMetadata(resourcesDir, expectedRepository, { allowDirectoryOnlyMac = false } = {}) {
  const metadataPath = path.join(resourcesDir, 'app-update.yml');
  if (!fs.existsSync(metadataPath)) {
    if (allowDirectoryOnlyMac && resourcesDir.includes(`.app${path.sep}Contents${path.sep}Resources`)) {
      return 'electron-builder build.publish (directory-only macOS equivalent)';
    }
    throw new Error(`Packaged updater metadata is missing: ${metadataPath}`);
  }
  const metadata = fs.readFileSync(metadataPath, 'utf8');
  const expectedLines = [
    ['provider', 'github'],
    ['owner', expectedRepository.owner],
    ['repo', expectedRepository.repo],
  ];
  for (const [key, value] of expectedLines) {
    const expression = new RegExp(`^${key}:\\s*["']?${value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}["']?\\s*$`, 'm');
    if (!expression.test(metadata)) {
      throw new Error(`Packaged updater metadata must contain ${key}: ${value}`);
    }
  }
  return metadataPath;
}

function validateDesktopPackage(packageRoot, {
  sourceClientDir = path.join(__dirname, '..', 'dist', 'client'),
  expectedPackage = packageMetadata,
} = {}) {
  const root = path.resolve(packageRoot);
  const { appAsar, resourcesDir } = locatePackagedResources(root);
  const archivePaths = asar.listPackage(appAsar).map(normalizeAsarPath);
  const archiveSet = new Set(archivePaths);

  const sourceFiles = regularFiles(path.resolve(sourceClientDir));
  const expectedClientPaths = sourceFiles.map((entry) => `dist/client/${entry}`);
  const packagedClientPaths = archivePaths
    .filter((entry) => entry.startsWith('dist/client/'))
    .filter((entry) => {
      try {
        return asar.statFile(appAsar, entry).files === undefined;
      } catch (error) {
        return false;
      }
    })
    .sort();

  const missingClientPaths = expectedClientPaths.filter((entry) => !archiveSet.has(entry));
  const extraClientPaths = packagedClientPaths.filter((entry) => !expectedClientPaths.includes(entry));
  if (missingClientPaths.length || extraClientPaths.length) {
    throw new Error([
      'Packaged client does not match dist/client.',
      missingClientPaths.length ? `Missing: ${missingClientPaths.join(', ')}` : '',
      extraClientPaths.length ? `Unexpected: ${extraClientPaths.join(', ')}` : '',
    ].filter(Boolean).join(' '));
  }

  const requiredPaths = [
    'desktop/main.cjs',
    'desktop/preload.cjs',
    'desktop/runtime.cjs',
    'desktop/updater.cjs',
    'lib/client-artifact.js',
    'lib/telnet-parser.js',
    'server.js',
    'package.json',
  ];
  const missingRequiredPaths = requiredPaths.filter((entry) => !archiveSet.has(entry));
  if (missingRequiredPaths.length) {
    throw new Error(`Packaged application is missing required paths: ${missingRequiredPaths.join(', ')}`);
  }

  const forbiddenRoots = ['public/', 'client/', 'scripts/', 'test/', 'e2e/'];
  const forbiddenFiles = ['vite.config.ts', 'playwright.config.ts', 'playwright.production.config.ts'];
  const forbiddenPaths = archivePaths.filter((entry) =>
    forbiddenRoots.some((prefix) => entry.startsWith(prefix))
      || forbiddenFiles.includes(entry)
      || /^tsconfig(?:\.|$)/.test(entry));
  if (forbiddenPaths.length) {
    throw new Error(`Packaged application contains forbidden source paths: ${forbiddenPaths.join(', ')}`);
  }

  const packagedMetadata = JSON.parse(asar.extractFile(appAsar, 'package.json').toString('utf8'));
  const expectedDistribution = expectedPackage.build?.extraMetadata?.darkflowDistribution || 'direct';
  for (const [key, value] of [
    ['name', expectedPackage.name],
    ['version', expectedPackage.version],
    ['main', expectedPackage.main],
    ['darkflowDistribution', expectedDistribution],
  ]) {
    if (packagedMetadata[key] !== value) {
      throw new Error(`Packaged package.json ${key} must be ${JSON.stringify(value)}, received ${JSON.stringify(packagedMetadata[key])}`);
    }
  }

  const publish = expectedPackage.build?.publish?.find((entry) => entry.provider === 'github');
  if (!publish || !publish.owner || !publish.repo) {
    throw new Error('Expected package metadata must define the GitHub publish owner and repository.');
  }
  const updateMetadata = validateUpdateMetadata(resourcesDir, publish, { allowDirectoryOnlyMac: true });

  return {
    appAsar,
    clientFileCount: sourceFiles.length,
    resourcesDir,
    updateMetadata,
  };
}

if (require.main === module) {
  try {
    const packageRoot = process.argv[2] || path.join(__dirname, '..', 'dist', 'desktop');
    const result = validateDesktopPackage(packageRoot);
    console.log(`Validated packaged application at ${result.appAsar} (${result.clientFileCount} client files).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  locatePackagedResources,
  regularFiles,
  validateDesktopPackage,
  validateUpdateMetadata,
};
