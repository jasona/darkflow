'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedAppUrl,
  isSafeExternalUrl,
  isSteamDistribution,
  selectDesktopServeMode,
} = require('../desktop/runtime.cjs');

test('desktop serve mode uses built assets only for packaged or explicit built launches', () => {
  assert.equal(selectDesktopServeMode({ isPackaged: true, argv: [] }), 'built');
  assert.equal(selectDesktopServeMode({ isPackaged: false, argv: ['electron', '.', '--built-client'] }), 'built');
  assert.equal(selectDesktopServeMode({ isPackaged: false, argv: ['electron', '.'] }), 'legacy');
  assert.equal(selectDesktopServeMode({
    isPackaged: false,
    argv: ['electron', '.'],
    env: { NODE_ENV: 'production' },
  }), 'legacy');
});

test('Steam distribution is detected from build metadata, environment, or arguments', () => {
  assert.equal(isSteamDistribution({ distribution: 'steam', argv: [], env: {} }), true);
  assert.equal(isSteamDistribution({ distribution: 'direct', argv: [], env: { DARKFLOW_DISTRIBUTION: 'steam' } }), true);
  assert.equal(isSteamDistribution({ distribution: 'direct', argv: [], env: { SteamAppId: '123' } }), true);
  assert.equal(isSteamDistribution({ distribution: 'direct', argv: ['--steam'], env: {} }), true);
  assert.equal(isSteamDistribution({ distribution: 'direct', argv: [], env: {} }), false);
});

test('app navigation stays on the exact loopback origin', () => {
  const origin = 'http://127.0.0.1:43123';
  assert.equal(isAllowedAppUrl(`${origin}/settings`, origin), true);
  assert.equal(isAllowedAppUrl('http://127.0.0.1:43124/', origin), false);
  assert.equal(isAllowedAppUrl('https://play.darkwind.ai/', origin), false);
  assert.equal(isAllowedAppUrl('not a url', origin), false);
});

test('external links are limited to browser and email protocols', () => {
  assert.equal(isSafeExternalUrl('https://play.darkwind.ai/'), true);
  assert.equal(isSafeExternalUrl('http://example.com/'), true);
  assert.equal(isSafeExternalUrl('mailto:support@example.com'), true);
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
});
