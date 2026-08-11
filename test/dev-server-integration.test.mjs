import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

process.env.MCP_ENABLED = "0";
process.env.DARKFLOW_VITE_POLL = "1";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  root,
  "client",
  "phase0",
  "hmr-protocol-fixture.ts",
);
const { app, getServeInfo, startServer, stopServer } =
  await import("../server.js");

/** Waits for a WebSocket message matching the supplied predicate. */
function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const observed = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for matching WebSocket message: ${observed.join(", ")}`,
        ),
      );
    }, 30_000);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      observed.push(message.type);
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

/** Removes Vite's cache-busting query string before transformed-module comparison. */
function withoutHmrTimestamp(source) {
  return source.replace(/\?t=\d+/g, "");
}

/** Refetches a transformed validator until Typia's asynchronous cache refresh completes. */
async function waitForValidatorChange(origin, previous) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const source = await (
      await fetch(`${origin}/phase0/hmr-validators.ts`)
    ).text();
    if (withoutHmrTimestamp(source) !== previous)
      return withoutHmrTimestamp(source);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for transformed validator change");
}

test(
  "dev server preserves route ordering, cookies, and shared HMR upgrades",
  { timeout: 120_000 },
  async (t) => {
    const originalDesktop = process.env.DARKFLOW_DESKTOP;
    const originalToken = process.env.DARKFLOW_DESKTOP_TOKEN;
    const originalFixture = await fs.readFile(fixturePath, "utf8");
    let hmrSocket;
    try {
      const address = await startServer({
        port: 0,
        host: "127.0.0.1",
        mode: "dev",
      });
      const origin = `http://127.0.0.1:${address.port}`;

      const rootResponse = await fetch(`${origin}/`);
      assert.equal(rootResponse.status, 200);
      const rootHtml = await rootResponse.text();
      assert.match(rootHtml, /\/@vite\/client/);
      assert.match(rootHtml, /\/app\/bootstrap\.ts/);
      assert.doesNotMatch(rootHtml, /js\/app\.js/);

      const indexResponse = await fetch(`${origin}/index.html`);
      assert.equal(indexResponse.status, 200);
      const indexHtml = await indexResponse.text();
      assert.match(indexHtml, /\/@vite\/client/);
      assert.match(indexHtml, /\/app\/bootstrap\.ts/);

      const bootstrapResponse = await fetch(`${origin}/app/bootstrap.ts`);
      assert.equal(bootstrapResponse.status, 200);
      assert.match(
        bootstrapResponse.headers.get("content-type") || "",
        /javascript/,
      );
      assert.doesNotMatch(
        await bootstrapResponse.text(),
        /no transform has been configured/,
      );

      const configResponse = await fetch(`${origin}/config.json`);
      assert.equal(configResponse.status, 200);
      assert.deepEqual(Object.keys(await configResponse.json()).sort(), [
        "gameName",
        "hiddenPanels",
        "host",
        "port",
        "wss",
      ]);

      const versionResponse = await fetch(`${origin}/api/version`);
      assert.equal(versionResponse.status, 200);
      assert.match(
        versionResponse.headers.get("cache-control") || "",
        /no-store/,
      );

      const pingResponse = await fetch(`${origin}/ping`);
      assert.equal(pingResponse.status, 204);

      const howlerResponse = await fetch(`${origin}/vendor/howler.core.min.js`);
      assert.equal(howlerResponse.status, 200);
      assert.match(
        howlerResponse.headers.get("content-type") || "",
        /javascript/,
      );

      const phaseResponse = await fetch(`${origin}/phase0/`);
      assert.equal(phaseResponse.status, 200);
      assert.match(await phaseResponse.text(), /\/@vite\/client/);

      const phaseWithoutSlashResponse = await fetch(`${origin}/phase0`);
      assert.equal(phaseWithoutSlashResponse.status, 200);
      assert.match(await phaseWithoutSlashResponse.text(), /src="\/phase0\/main\.ts"/);

      const clientResponse = await fetch(`${origin}/@vite/client`);
      assert.equal(clientResponse.status, 200);
      assert.match(
        clientResponse.headers.get("content-type") || "",
        /javascript/,
      );

      for (const endpoint of ["/phase0/", "/@vite/client"]) {
        const response = await fetch(`${origin}${endpoint}`, {
          headers: { Host: `localhost:${address.port}` },
        });
        assert.equal(response.status, 200);
      }

      const missingResponse = await fetch(`${origin}/definitely-not-a-route`);
      assert.equal(missingResponse.status, 404);
      assert.match(await missingResponse.text(), /Cannot GET/);

      app.get("/__late-mount-probe", (req, res) =>
        res.status(200).send("mounted"),
      );
      const lateMountResponse = await fetch(`${origin}/__late-mount-probe`);
      assert.equal(lateMountResponse.status, 200);
      assert.equal(await lateMountResponse.text(), "mounted");
      assert.equal(getServeInfo().mode, "dev");
      assert.equal(typeof getServeInfo().mcp?.mounted, "boolean");
      if (!getServeInfo().mcp?.mounted)
        assert.equal(typeof getServeInfo().mcp.reason, "string");

      process.env.DARKFLOW_DESKTOP = "1";
      process.env.DARKFLOW_DESKTOP_TOKEN = "dev-server-test-token";
      for (const endpoint of ["/", "/index.html", "/phase0/", "/@vite/client"]) {
        const denied = await fetch(`${origin}${endpoint}`);
        assert.equal(denied.status, 403);
        const allowed = await fetch(`${origin}${endpoint}`, {
          headers: { Cookie: "darkflow-desktop-token=dev-server-test-token" },
        });
        assert.equal(allowed.status, 200);
      }
      if (originalDesktop === undefined) delete process.env.DARKFLOW_DESKTOP;
      else process.env.DARKFLOW_DESKTOP = originalDesktop;
      if (originalToken === undefined)
        delete process.env.DARKFLOW_DESKTOP_TOKEN;
      else process.env.DARKFLOW_DESKTOP_TOKEN = originalToken;

      const pingSocket = new WebSocket(
        `ws://127.0.0.1:${address.port}/`,
        "vite-ping",
      );
      await once(pingSocket, "open");
      const [pingCode] = await once(pingSocket, "close");
      assert.equal(pingCode, 1000);

      const unmatched = new WebSocket(`ws://127.0.0.1:${address.port}/nope`);
      await assert.rejects(
        once(unmatched, "open"),
        /Unexpected server response: 400/,
      );

      hmrSocket = new WebSocket(`ws://127.0.0.1:${address.port}/`, "vite-hmr");
      const connected = waitForMessage(
        hmrSocket,
        (message) => message.type === "connected",
      );
      await once(hmrSocket, "open");
      await connected;

      await (await fetch(`${origin}/phase0/main.ts`)).text();
      await (await fetch(`${origin}/phase0/hmr-probe.ts`)).text();
      await (await fetch(`${origin}/phase0/hmr-accept.js`)).text();
      const before = await (
        await fetch(`${origin}/phase0/hmr-validators.ts`)
      ).text();
      assert.match(originalFixture, /id: number/);
      const changedUpdate = waitForMessage(
        hmrSocket,
        (message) =>
          message.type === "update" &&
          message.updates?.some((entry) =>
            entry.acceptedPath.endsWith("hmr-validators.ts"),
          ),
      );
      await fs.writeFile(
        fixturePath,
        originalFixture.replace("id: number", "id: string"),
      );
      const update = await changedUpdate;
      assert.ok(
        update.updates.some((entry) =>
          entry.acceptedPath.endsWith("hmr-validators.ts"),
        ),
      );
      const changed = await waitForValidatorChange(origin, before);
      assert.notEqual(changed, before);
      const restoredUpdate = waitForMessage(
        hmrSocket,
        (message) =>
          message.type === "update" &&
          message.updates?.some((entry) =>
            entry.acceptedPath.endsWith("hmr-validators.ts"),
          ),
      );
      await fs.writeFile(fixturePath, originalFixture);
      await restoredUpdate;
      const restored = await waitForValidatorChange(origin, changed);
      assert.equal(restored, before);
    } finally {
      hmrSocket?.terminate();
      await fs.writeFile(fixturePath, originalFixture);
      if (originalDesktop === undefined) delete process.env.DARKFLOW_DESKTOP;
      else process.env.DARKFLOW_DESKTOP = originalDesktop;
      if (originalToken === undefined)
        delete process.env.DARKFLOW_DESKTOP_TOKEN;
      else process.env.DARKFLOW_DESKTOP_TOKEN = originalToken;
      await stopServer();
    }
  },
);
