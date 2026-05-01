const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
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
const PORT = process.env.PORT || 3000;

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

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// /proxy : WebSocket ↔ TCP/TLS bridge for connecting to non-WebSocket MUDs.
//
// Browser opens   ws[s]://<this-server>/proxy?host=X&port=Y&tls=0|1
// We open         net.connect({host, port}) or tls.connect(...)
// and pipe bytes both ways unmodified.
//
// v1: open relay with logging. Future: allowlist (see docs).
// ─────────────────────────────────────────────────────────────────────────────

// Telnet IAC parser with GMCP bridging.
// - Strips IAC sequences from upstream bytes so they don't pollute output.
// - Accepts GMCP (option 201): WILL/DO GMCP gets reciprocated, all other
//   WILL/DO get replies DONT/WONT so MUDs don't stall waiting.
// - Extracts IAC SB 201 <payload> IAC SE blocks as separate gmcpFrames so
//   the proxy can ship them to the browser as binary WS frames.
// - Discards every other SB block (MCCP, MSDP, MSSP, ...) silently.
// - Buffers partial IAC sequences across chunk boundaries.
// Construct with onGmcpAgreed() callback to be notified when GMCP
// negotiation completes (so buffered browser->MUD GMCP can be flushed).
const IAC = 0xFF, DONT = 0xFE, DO = 0xFD, WONT = 0xFC, WILL = 0xFB;
const SB = 0xFA, SE = 0xF0;
const TELOPT_GMCP = 0xC9; // 201

function makeTelnetParser({ onGmcpAgreed } = {}) {
  let pending = Buffer.alloc(0);
  let gmcpAgreed = false;

  function parse(chunk) {
    const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    pending = Buffer.alloc(0);
    const out = [];
    const reply = [];
    const gmcpFrames = [];
    let i = 0;
    while (i < buf.length) {
      const b = buf[i];
      if (b !== IAC) {
        out.push(b);
        i++;
        continue;
      }
      if (i + 1 >= buf.length) { pending = buf.slice(i); break; }
      const cmd = buf[i + 1];
      if (cmd === IAC) {
        out.push(IAC);
        i += 2;
        continue;
      }
      if (cmd === WILL || cmd === WONT || cmd === DO || cmd === DONT) {
        if (i + 2 >= buf.length) { pending = buf.slice(i); break; }
        const opt = buf[i + 2];
        if (opt === TELOPT_GMCP) {
          if (cmd === WILL) {
            reply.push(IAC, DO, opt);
            if (!gmcpAgreed) {
              gmcpAgreed = true;
              if (typeof onGmcpAgreed === 'function') onGmcpAgreed();
            }
          } else if (cmd === DO) {
            reply.push(IAC, WILL, opt);
          }
          // WONT/DONT GMCP: nothing to reply; gmcpAgreed stays false.
        } else {
          if (cmd === WILL) reply.push(IAC, DONT, opt);
          else if (cmd === DO) reply.push(IAC, WONT, opt);
        }
        i += 3;
        continue;
      }
      if (cmd === SB) {
        // Find matching IAC SE; inside SB, IAC IAC is an escaped 0xFF byte.
        let j = i + 2;
        let end = -1;
        while (j < buf.length - 1) {
          if (buf[j] === IAC) {
            if (buf[j + 1] === IAC) { j += 2; continue; }
            if (buf[j + 1] === SE) { end = j + 2; break; }
          }
          j++;
        }
        if (end < 0) { pending = buf.slice(i); break; }
        // Extract GMCP payload if this was an SB GMCP block.
        if (i + 2 < buf.length && buf[i + 2] === TELOPT_GMCP) {
          const payload = [];
          for (let k = i + 3; k < end - 2; k++) {
            if (buf[k] === IAC && buf[k + 1] === IAC) { payload.push(IAC); k++; }
            else payload.push(buf[k]);
          }
          gmcpFrames.push(Buffer.from(payload));
        }
        i = end;
        continue;
      }
      // Other 2-byte commands (NOP, GA, etc.): consume both.
      i += 2;
    }
    return {
      text: Buffer.from(out),
      reply: reply.length ? Buffer.from(reply) : null,
      gmcpFrames,
    };
  }

  return { parse, isGmcpAgreed: () => gmcpAgreed };
}

// Wrap a GMCP payload as an IAC SB 201 ... IAC SE block.
// Any 0xFF byte in the payload is escaped as IAC IAC.
function wrapGmcp(payload) {
  const escaped = [];
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === IAC) escaped.push(IAC, IAC);
    else escaped.push(payload[i]);
  }
  return Buffer.concat([
    Buffer.from([IAC, SB, TELOPT_GMCP]),
    Buffer.from(escaped),
    Buffer.from([IAC, SE]),
  ]);
}

// Cap on the pending GMCP buffer (browser->MUD) before negotiation completes,
// to bound memory if a non-GMCP MUD is connected.
const MAX_PENDING_GMCP_BYTES = 64 * 1024;

const LOG_DIR = path.join(__dirname, 'log');
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
const wss = new WebSocketServer({ server, path: '/proxy' });

wss.on('connection', (ws, req) => {
  const reqUrl = new URL(req.url, 'http://localhost');
  const host = reqUrl.searchParams.get('host');
  const port = parseInt(reqUrl.searchParams.get('port'), 10);
  const useTls = reqUrl.searchParams.get('tls') === '1';
  const sourceIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

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
      try { ws.send(text.toString('utf-8')); }
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

server.listen(PORT, () => {
  console.log(`Darkflow listening on port ${PORT}`);
  console.log(`Proxy endpoint: ws[s]://<host>:${PORT}/proxy?host=X&port=Y&tls=0|1`);
});
