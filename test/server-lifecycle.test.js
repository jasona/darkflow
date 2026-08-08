'use strict';

process.env.MCP_ENABLED = '0';
process.env.DARKFLOW_DESKTOP = '1';
process.env.DARKFLOW_DESKTOP_TOKEN = 'desktop-test-token';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { server, startServer, stopServer } = require('../server.js');
const { version: expectedVersion } = require('../public/version.json');
const { version: packageVersion } = require('../package.json');
const packageLock = require('../package-lock.json');

test('web and desktop release versions stay synchronized', () => {
  assert.equal(expectedVersion, packageVersion);
  assert.equal(expectedVersion, packageLock.version);
  assert.equal(expectedVersion, packageLock.packages[''].version);
});

test('Darkflow server can be embedded on an ephemeral loopback port', async (t) => {
  t.after(async () => {
    await stopServer();
  });

  const address = await startServer({ port: 0, host: '127.0.0.1', mode: 'dev' });
  assert.equal(address.address, '127.0.0.1');
  assert.ok(address.port > 0);

  const unauthorized = await fetch(`http://127.0.0.1:${address.port}/api/version`);
  assert.equal(unauthorized.status, 403);

  const response = await fetch(`http://127.0.0.1:${address.port}/api/version`, {
    headers: { Cookie: 'darkflow-desktop-token=desktop-test-token' },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(await response.json(), { version: expectedVersion });
  assert.equal(server.listening, true);

  const howlerResponse = await fetch(`http://127.0.0.1:${address.port}/vendor/howler.core.min.js`, {
    headers: { Cookie: 'darkflow-desktop-token=desktop-test-token' },
  });
  assert.equal(howlerResponse.status, 200);
  assert.match(howlerResponse.headers.get('content-type') || '', /javascript/);
  assert.match(await howlerResponse.text(), /howler\.js v2\.2\.4/);

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/proxy`, {
    origin: 'https://untrusted.example',
  });
  const [code, reason] = await once(socket, 'close');
  assert.equal(code, 1008);
  assert.equal(reason.toString(), 'invalid origin');

  const missingSession = new WebSocket(`ws://127.0.0.1:${address.port}/proxy`, {
    origin: `http://127.0.0.1:${address.port}`,
  });
  const [sessionCode, sessionReason] = await once(missingSession, 'close');
  assert.equal(sessionCode, 1008);
  assert.equal(sessionReason.toString(), 'invalid session');
});
