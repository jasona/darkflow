"use strict";

process.env.MCP_ENABLED = "0";
process.env.DARKFLOW_DESKTOP = "0";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const net = require("node:net");
const test = require("node:test");
const WebSocket = require("ws");
const { startServer, stopServer } = require("../server.js");

/** Opens a WebSocket and resolves after its HTTP upgrade succeeds. */
async function openSocket(url) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  return socket;
}

test("proxy upgrades share the server without swallowing other paths", async (t) => {
  const received = [];
  const fixtureSockets = new Set();
  const fixture = net.createServer((socket) => {
    fixtureSockets.add(socket);
    socket.once("close", () => fixtureSockets.delete(socket));
    socket.on("data", (chunk) => {
      received.push(chunk);
      if (Buffer.concat(received).includes(Buffer.from("look\r\n"))) {
        socket.write("fixture reply");
      }
    });
  });
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  t.after(async () => {
    for (const socket of fixtureSockets) socket.destroy();
    await new Promise((resolve) => fixture.close(resolve));
    await stopServer();
  });

  const fixtureAddress = fixture.address();
  const address = await startServer({ port: 0, host: "127.0.0.1", mode: "dev" });
  const proxy = await openSocket(
    `ws://127.0.0.1:${address.port}/proxy?host=127.0.0.1&port=${fixtureAddress.port}`,
  );
  t.after(() => proxy.terminate());

  proxy.send("look");
  const [reply, isBinary] = await once(proxy, "message");
  assert.equal(isBinary, false);
  assert.equal(reply.toString(), "fixture reply");
  assert.match(Buffer.concat(received).toString("utf8"), /look\r\n/);

  const unmatched = new WebSocket(`ws://127.0.0.1:${address.port}/`);
  await assert.rejects(
    once(unmatched, "open"),
    /Unexpected server response: 400/,
  );

  const invalidArgs = await openSocket(`ws://127.0.0.1:${address.port}/proxy`);
  const [code, reason] = await once(invalidArgs, "close");
  assert.equal(code, 1008);
  assert.equal(reason.toString(), "invalid host/port");
});
