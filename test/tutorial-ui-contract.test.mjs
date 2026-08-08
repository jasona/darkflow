import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manager = readFileSync(join(root, 'public/js/tutorial-manager.js'), 'utf8');
const styles = readFileSync(join(root, 'public/css/tutorial.css'), 'utf8');
const app = readFileSync(join(root, 'public/js/app.js'), 'utf8');
const connection = readFileSync(join(root, 'public/js/connection.js'), 'utf8');
const html = readFileSync(join(root, 'client/index.html'), 'utf8');

test('tutorial hover is dedicated, accessible, nonmodal, and initialized', () => {
  assert.match(manager, /role', 'complementary'/);
  assert.match(manager, /aria-labelledby', 'tutorial-hover-title'/);
  assert.match(manager, /aria-live', 'polite'/);
  assert.match(manager, /createElement\('progress'/);
  assert.doesNotMatch(manager, /addEventListener\(['"]keydown['"][\s\S]{0,120}Escape/);
  assert.match(app, /tutorialManager\.init\(\)/);
  assert.match(html, /css\/tutorial\.css/);
  assert.doesNotMatch(manager, /panelManager/);
  assert.match(
    manager,
    /action === 'continue'[\s\S]{0,120}pendingAction === 'continue'/,
    'automatic Continue acknowledgement must not render as a separate step',
  );
});

test('connection lifecycle advertises capability, resyncs, and clears stale UI', () => {
  assert.ok(
    [...connection.matchAll(/tutorialPane:\s*tutorialManager\.isReadyForSubscription\(\)/g)].length >= 2,
    'initial and handshake-retry snapshots must both carry tutorial readiness',
  );
  assert.match(connection, /tutorialManager\.handleConnected\(/);
  assert.match(connection, /tutorialManager\.handleDisconnect\(\)/);
  assert.match(manager, /Darkwind\.Tutorial\.Control/);
  assert.match(manager, /_scheduleRenderRecovery\(\)/);
});

test('layer is pointer-transparent, targets are safe, and reduced motion is honored', () => {
  assert.match(styles, /\.tutorial-hover-layer[\s\S]*?pointer-events:\s*none/);
  assert.match(styles, /\.tutorial-hover-card,[\s\S]*?pointer-events:\s*auto/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(manager, /const TARGET_SELECTORS = Object\.freeze/);
  assert.doesNotMatch(manager, /querySelector\(this\.model\.step\.target\)/);
});

test('mobile card leaves terminal visible and exposes touch-sized controls', () => {
  assert.match(manager, /viewportHeight \* 0\.45/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.tutorial-button \{[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.tutorial-icon-button \{[\s\S]*?height:\s*44px/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.tutorial-minimized-chip,[\s\S]*?\.tutorial-command-button \{[\s\S]*?min-height:\s*44px/);
});
