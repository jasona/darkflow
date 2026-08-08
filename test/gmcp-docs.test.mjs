import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(repoRoot, 'docs');
const gmcpSource = readFileSync(join(repoRoot, 'public/js/gmcp.js'), 'utf8');
const gmcpIndex = readFileSync(join(docsDir, 'gmcp-darkwind-index.md'), 'utf8');

function filesUnder(directory, predicate) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path, predicate));
    else if (predicate(path)) files.push(path);
  }
  return files;
}

function advertisedSupportStrings() {
  const match = gmcpSource.match(/this\.send\('Core\.Supports\.Set',\s*\[([\s\S]*?)\]\);/);
  assert.ok(match, 'Core.Supports.Set handshake list was not found');
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

test('GMCP index lists every advertised support string', () => {
  const supportStrings = advertisedSupportStrings();
  assert.ok(supportStrings.length > 20, 'unexpectedly short GMCP support list');
  for (const supportString of supportStrings) {
    assert.ok(
      gmcpIndex.includes('`' + supportString + '`'),
      `missing advertised support string in GMCP index: ${supportString}`,
    );
  }
  assert.equal(gmcpIndex.includes('`Darkwind.MapData 1` |'), false);
});

test('GMCP documentation names every package literal used by the client', () => {
  const clientFiles = filesUnder(join(repoRoot, 'public/js'), (path) => /\.(?:js|mjs)$/.test(path));
  const packagePattern = /['"`]((?:(?:Core|Char|Room|Comm|Darkwind)(?:\.[A-Z][A-Za-z0-9]*)+)|Group|Game)['"`]/g;
  const packages = new Set();

  for (const file of clientFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(packagePattern)) packages.add(match[1]);
  }

  const documentation = filesUnder(docsDir, (path) => /^gmcp-.*\.md$/.test(path.slice(docsDir.length + 1)))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  for (const packageName of [...packages].sort()) {
    assert.ok(
      documentation.includes(packageName),
      `missing package name in GMCP documentation: ${packageName}`,
    );
  }
});

test('documentation Markdown links resolve inside the repository', () => {
  const markdownFiles = filesUnder(docsDir, (path) => {
    if (!path.endsWith('.md')) return false;
    const relative = path.slice(docsDir.length + 1);
    return !relative.startsWith('plans/');
  });
  for (const sourcePath of markdownFiles) {
    const relativePath = sourcePath.slice(repoRoot.length + 1);
    const source = readFileSync(sourcePath, 'utf8');
    for (const match of source.matchAll(/\]\(([^)]+\.md(?:#[^)]+)?)\)/g)) {
      const target = match[1].split('#')[0];
      if (/^[a-z]+:/i.test(target) || target.startsWith('/')) continue;
      const resolved = resolve(dirname(sourcePath), target);
      assert.doesNotThrow(
        () => statSync(resolved),
        `${relativePath} links to missing file: ${target}`,
      );
    }
  }
});
