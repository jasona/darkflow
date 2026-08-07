const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const { WebSocketServer } = require('ws');

// Load .env file if it exists (no dependency needed)
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch(e) { /* no .env file, that's fine */ }

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const DESKTOP_COOKIE_NAME = 'darkflow-desktop-token';
const HOWLER_CORE_PATH = require.resolve('howler/dist/howler.core.min.js');
let initPromise = null;
let serveInfo = { mode: null, mcp: null };
let devClient = null;

function hasDesktopSession(req) {
  if (process.env.DARKFLOW_DESKTOP !== '1') return true;
  const expected = process.env.DARKFLOW_DESKTOP_TOKEN || '';
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => (
    part.startsWith(`${DESKTOP_COOKIE_NAME}=`)
  ));
  const actual = cookie ? cookie.slice(DESKTOP_COOKIE_NAME.length + 1) : '';
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (!expected || actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

app.use((req, res, next) => {
  if (hasDesktopSession(req)) return next();
  res.set('Cache-Control', 'no-store');
  return res.status(403).end();
});

// Serve client configuration from environment variables
app.get('/config.json', (req, res) => {
  const hiddenPanels = (process.env.HIDDEN_PANELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  res.json({
    host: process.env.MUD_HOST || '',
    port: parseInt(process.env.MUD_PORT, 10) || 4242,
    wss: process.env.MUD_WSS !== '0',
    gameName: process.env.GAME_NAME || '',
    hiddenPanels,
  });
});

// Client version endpoint (no caching so stale tabs always get current version)
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const versionFile = path.join(__dirname, 'public', 'version.json');
  try {
    const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    res.json(data);
  } catch(e) {
    res.json({ version: 'unknown' });
  }
});

// Tiny latency probe: times the network path to this host WITHOUT the MUD
// driver in the loop, so the client can tell network lag from server lag.
app.get('/ping', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(204).end();
});

app.get('/vendor/howler.core.min.js', (req, res) => {
  res.sendFile(HOWLER_CORE_PATH);
});

// -----------------------------------------------------------------------------
// /proxy : WebSocket <-> TCP/TLS bridge for connecting to non-WebSocket MUDs.
//
// Browser opens   ws[s]://<this-server>/proxy?host=X&port=Y&tls=0|1
// We open         net.connect({host, port}) or tls.connect(...)
// and pipe bytes both ways unmodified.
//
// v1: open relay with logging. Future: allowlist (see docs).
// -----------------------------------------------------------------------------

// Telnet/GMCP parser lives in lib/telnet-parser.js so it can be shared with
// out-of-process tooling (e.g. the headless MUD test harness) without pulling
// in express/ws. Re-exported below for backward compat.
const {
  makeTelnetParser,
  wrapGmcp,
  constants,
} = require('./lib/telnet-parser');
const { IAC, DO, TELOPT_GMCP } = constants;

// Cap on the pending GMCP buffer (browser->MUD) before negotiation completes,
// to bound memory if a non-GMCP MUD is connected.
const MAX_PENDING_GMCP_BYTES = 64 * 1024;

const devMode = process.argv.includes('--dev');
if (devMode && !process.env.DARKFLOW_LOG_DIR) {
  process.env.DARKFLOW_LOG_DIR = path.join(os.tmpdir(), 'darkflow-dev-log');
}
const LOG_DIR = process.env.DARKFLOW_LOG_DIR || path.join(__dirname, 'log');
const PROXY_LOG = path.join(LOG_DIR, 'proxy.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch(e) { /* ignore */ }

function logProxy(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFile(PROXY_LOG, line, (err) => {
    if (err) console.error('[proxy] log write failed:', err.message);
  });
  // Also echo to stdout so docker/journald captures it.
  console.log('[proxy]', line.trim());
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/proxy') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    return;
  }
  if (devClient && devClient.claimsUpgrade(req)) return;
  socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  socket.destroy();
});

wss.on('error', (error) => {
  console.error('[proxy] WebSocket server error:', error.message);
});

wss.on('connection', (ws, req) => {
  const reqUrl = new URL(req.url, 'http://localhost');
  const host = reqUrl.searchParams.get('host');
  const port = parseInt(reqUrl.searchParams.get('port'), 10);
  const useTls = reqUrl.searchParams.get('tls') === '1';
  const sourceIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (process.env.DARKFLOW_DESKTOP === '1') {
    const address = server.address();
    const expectedOrigin = address && typeof address === 'object'
      ? `http://127.0.0.1:${address.port}`
      : '';
    if (req.headers.origin !== expectedOrigin) {
      logProxy({ event: 'reject', reason: 'invalid-origin', sourceIp, origin: req.headers.origin });
      try { ws.close(1008, 'invalid origin'); } catch(e) {}
      return;
    }
    if (!hasDesktopSession(req)) {
      logProxy({ event: 'reject', reason: 'invalid-session', sourceIp });
      try { ws.close(1008, 'invalid session'); } catch(e) {}
      return;
    }
  }

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    logProxy({ event: 'reject', reason: 'invalid-args', sourceIp, host, port });
    try { ws.close(1008, 'invalid host/port'); } catch(e) {}
    return;
  }

  logProxy({ event: 'connect', sourceIp, host, port, tls: useTls });

  // Pending browser->MUD GMCP frames, held until the MUD agrees to GMCP.
  const pendingGmcp = [];
  let pendingGmcpBytes = 0;

  function flushPendingGmcp() {
    while (pendingGmcp.length && !upstream.destroyed) {
      const frame = pendingGmcp.shift();
      pendingGmcpBytes -= frame.length;
      try { upstream.write(wrapGmcp(frame)); }
      catch (err) {
        logProxy({ event: 'gmcp-flush-error', sourceIp, host, port, error: err.message });
      }
    }
  }

  const telnet = makeTelnetParser({
    onGmcpAgreed: () => {
      logProxy({ event: 'gmcp-agreed', sourceIp, host, port, pending: pendingGmcp.length });
      flushPendingGmcp();
    }
  });
  const upstreamTextDecoder = new TextDecoder('utf-8');
  let bytesUp = 0, bytesDown = 0;
  let upstream;
  try {
    upstream = useTls
      ? tls.connect({ host, port, rejectUnauthorized: false, servername: host })
      : net.connect({ host, port });
  } catch (err) {
    logProxy({ event: 'upstream-spawn-error', sourceIp, host, port, error: err.message });
    try { ws.close(1011, 'upstream spawn error'); } catch(e) {}
    return;
  }

  upstream.on('connect', () => {
    logProxy({ event: 'upstream-open', sourceIp, host, port, tls: useTls });
    // Proactively invite GMCP from the MUD. MUDs that don't support it will
    // reply WONT and we proceed text-only; MUDs that do will start emitting
    // SB 201 ... IAC SE blocks. This shaves a round-trip for MUDs that
    // wait for the client to indicate support first.
    try { upstream.write(Buffer.from([IAC, DO, TELOPT_GMCP])); } catch(e) {}
  });
  // tls.connect emits 'secureConnect' once TLS handshake completes
  upstream.on('secureConnect', () => {
    logProxy({ event: 'upstream-secure', sourceIp, host, port });
  });
  upstream.on('data', (chunk) => {
    bytesDown += chunk.length;
    const { text, reply, gmcpFrames } = telnet.parse(chunk);
    // Reply to IAC negotiation (DO/WILL GMCP, DONT/WONT for everything else).
    if (reply && !upstream.destroyed) {
      try { upstream.write(reply); } catch(e) {}
    }
    // Forward game text as a UTF-8 text frame so Darkflow's onmessage routes
    // it to appendOutput() rather than the GMCP dispatcher.
    if (text.length && ws.readyState === ws.OPEN) {
      try {
        const decodedText = upstreamTextDecoder.decode(text, { stream: true });
        if (decodedText.length) ws.send(decodedText);
      }
      catch (err) {
        logProxy({ event: 'ws-send-error', sourceIp, host, port, error: err.message });
      }
    }
    // Forward extracted GMCP frames as binary so the browser's GMCP dispatcher
    // handles them just like Darkwind's WS-native GMCP.
    for (const frame of gmcpFrames) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(frame); }
        catch (err) {
          logProxy({ event: 'ws-gmcp-send-error', sourceIp, host, port, error: err.message });
        }
      }
    }
  });
  upstream.on('error', (err) => {
    logProxy({ event: 'upstream-error', sourceIp, host, port, error: err.message });
    try { ws.close(1011, 'upstream error'); } catch(e) {}
  });
  upstream.on('close', () => {
    logProxy({ event: 'upstream-close', sourceIp, host, port, bytesUp, bytesDown });
    if (ws.readyState === ws.OPEN) {
      const trailingText = upstreamTextDecoder.decode();
      if (trailingText.length) {
        try { ws.send(trailingText); }
        catch (err) {
          logProxy({ event: 'ws-send-error', sourceIp, host, port, error: err.message });
        }
      }
      try { ws.close(1000, 'upstream closed'); } catch(e) {}
    }
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Darkflow GMCP frame. Wrap as IAC SB 201 ... IAC SE for the MUD.
      // If GMCP hasn't been negotiated yet, queue (the MUD might still WILL
      // GMCP shortly after connect). If the MUD never agrees, the queue is
      // capped and frames are dropped silently.
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (telnet.isGmcpAgreed()) {
        bytesUp += buf.length;
        if (!upstream.destroyed) {
          try { upstream.write(wrapGmcp(buf)); }
          catch (err) {
            logProxy({ event: 'upstream-write-error', sourceIp, host, port, error: err.message });
          }
        }
        return;
      }
      // Drop oldest pending frames if cap exceeded.
      while (pendingGmcp.length && pendingGmcpBytes + buf.length > MAX_PENDING_GMCP_BYTES) {
        pendingGmcpBytes -= pendingGmcp[0].length;
        pendingGmcp.shift();
      }
      // If a single frame is bigger than the cap, drop it.
      if (buf.length > MAX_PENDING_GMCP_BYTES) return;
      pendingGmcp.push(buf);
      pendingGmcpBytes += buf.length;
      return;
    }

    // Text frame: a user command. The browser doesn't add a terminator
    // (Darkwind treats the WS frame boundary as the line break) but raw
    // telnet MUDs read from a TCP stream and wait for CRLF. Normalize all
    // line endings to \r\n and ensure a trailing one.
    const raw = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
    const normalized = raw.replace(/\r\n|\r|\n/g, '\r\n');
    const out = normalized.endsWith('\r\n') ? normalized : normalized + '\r\n';
    const buf = Buffer.from(out, 'utf-8');
    bytesUp += buf.length;
    if (!upstream.destroyed) {
      try { upstream.write(buf); }
      catch (err) {
        logProxy({ event: 'upstream-write-error', sourceIp, host, port, error: err.message });
      }
    }
  });
  ws.on('close', () => {
    logProxy({ event: 'client-close', sourceIp, host, port, bytesUp, bytesDown });
    if (!upstream.destroyed) {
      try { upstream.end(); } catch(e) {}
    }
  });
  ws.on('error', (err) => {
    logProxy({ event: 'client-error', sourceIp, host, port, error: err.message });
    if (!upstream.destroyed) {
      try { upstream.destroy(); } catch(e) {}
    }
  });
});

/**
 * Mounts the optional MCP relay before the selected frontend middleware.
 */
async function initializeApp(mode) {
  if (!['legacy', 'dev'].includes(mode)) {
    throw new Error(`Unknown serve mode: ${mode}`);
  }

  const mcpPath = process.env.MCP_PATH || '/mcp';
  if (process.env.MCP_ENABLED === '0') {
    serveInfo.mcp = { mounted: false, path: mcpPath, reason: 'disabled' };
  } else {
    const { pathToFileURL } = require('url');
    const mcpModule = path.join(__dirname, 'mud-test-mcp', 'core', 'mcp.js');
    let timeout;
    try {
      const module = await Promise.race([
        import(pathToFileURL(mcpModule).href),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('mount timed out')), 5000);
        }),
      ]);
      const info = module.attachMcp(app, {
        path: mcpPath,
        token: process.env.MCP_AUTH_TOKEN,
      });
      serveInfo.mcp = { mounted: true, path: info.path, reason: null };
      console.log(`[mcp] mounted at ${info.path}` + (info.authenticated ? ' (bearer auth on)' : ' (open)'));
    } catch (error) {
      serveInfo.mcp = { mounted: false, path: mcpPath, reason: error.message };
      console.warn('[mcp] not mounted:', error.message);
    } finally {
      clearTimeout(timeout);
    }
  }

  app.use(express.static(path.join(__dirname, 'public')));
  if (mode === 'dev') {
    devClient = await require('./lib/dev-client.js').attachDevClient({
      app,
      server,
      root: __dirname,
    });
  }
  serveInfo.mode = mode;
}

/**
 * Starts the shared HTTP server after initializing its selected serve mode.
 */
async function startServer({ port = PORT, host = process.env.HOST, mode = 'legacy' } = {}) {
  if (server.listening) return Promise.resolve(server.address());
  initPromise ??= initializeApp(mode);
  await initPromise;

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address());
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ port, ...(host ? { host } : {}) });
  });
}

/**
 * Stops Vite, proxy clients, and the shared HTTP server.
 */
async function stopServer() {
  await devClient?.close();
  devClient = null;
  initPromise = null;
  serveInfo = { mode: null, mcp: null };
  for (const client of wss.clients) client.terminate();
  if (!server.listening) return;

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

if (require.main === module) {
  startServer({ mode: devMode ? 'dev' : 'legacy' }).then((address) => {
    const port = address && typeof address === 'object' ? address.port : PORT;
    console.log(`Darkflow listening on port ${port}`);
    console.log(`Proxy endpoint: ws[s]://<host>:${port}/proxy?host=X&port=Y&tls=0|1`);
  }).catch((error) => {
    console.error('Darkflow failed to start:', error);
    process.exitCode = 1;
  });
}

/**
 * Returns the selected serve mode and optional MCP mount result.
 */
function getServeInfo() {
  return serveInfo;
}

module.exports = {
  app,
  server,
  startServer,
  stopServer,
  getServeInfo,
  makeTelnetParser,
  wrapGmcp,
  constants,
};
