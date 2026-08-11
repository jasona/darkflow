import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import WebSocket from "ws";

process.env.MCP_ENABLED = "0";
process.env.DARKFLOW_DESKTOP = "0";

const runFile = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(root, "dist", "client");
const hiddenArtifactDir = path.join(root, "dist", `client.production-server-check-${randomUUID()}`);
const packageMetadata = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const { app, getServeInfo, server, startServer, stopServer } = await import("../server.js");

async function assertResponse(origin, requestPath, expected) {
  const response = await fetch(`${origin}${requestPath}`);
  assert.equal(response.status, expected.status, `${requestPath} returned ${response.status}`);
  if (expected.contentType) {
    assert.match(
      response.headers.get("content-type") || "",
      expected.contentType,
      `${requestPath} returned an unexpected content type`,
    );
  }
  return response;
}

async function assertProxyRejections(origin, port) {
  const invalidArgs = new WebSocket(`${origin.replace("http", "ws")}/proxy`);
  const [invalidCode, invalidReason] = await once(invalidArgs, "close");
  assert.equal(invalidCode, 1008);
  assert.equal(invalidReason.toString(), "invalid host/port");

  const unmatched = new WebSocket(`${origin.replace("http", "ws")}/nope`);
  await assert.rejects(once(unmatched, "open"), /Unexpected server response: 400/);

  process.env.DARKFLOW_DESKTOP = "1";
  process.env.DARKFLOW_DESKTOP_TOKEN = "built-server-test-token";
  try {
    const denied = await fetch(`${origin}/`);
    assert.equal(denied.status, 403);
    assert.match(denied.headers.get("cache-control") || "", /no-store/);

    const allowed = await fetch(`${origin}/`, {
      headers: { Cookie: "darkflow-desktop-token=built-server-test-token" },
    });
    assert.equal(allowed.status, 200);

    const invalidOrigin = new WebSocket(`${origin.replace("http", "ws")}/proxy`, {
      origin: "https://untrusted.example",
    });
    const [originCode, originReason] = await once(invalidOrigin, "close");
    assert.equal(originCode, 1008);
    assert.equal(originReason.toString(), "invalid origin");

    const missingSession = new WebSocket(`${origin.replace("http", "ws")}/proxy`, {
      origin: `http://127.0.0.1:${port}`,
    });
    const [sessionCode, sessionReason] = await once(missingSession, "close");
    assert.equal(sessionCode, 1008);
    assert.equal(sessionReason.toString(), "invalid session");
  } finally {
    process.env.DARKFLOW_DESKTOP = "0";
    delete process.env.DARKFLOW_DESKTOP_TOKEN;
  }
}

async function waitForPing(origin, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${origin}/ping`);
      if (response.status === 204) return;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not respond at ${origin}/ping`);
}

async function assertUnflaggedCliUsesBuiltMode() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve, reject) => {
    listener.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      MCP_ENABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForPing(origin);
    const expectedRootHtml = await fs.readFile(path.join(artifactDir, "index.html"), "utf8");
    const rootResponse = await assertResponse(origin, "/", {
      status: 200,
      contentType: /text\/html/,
    });
    assert.equal(await rootResponse.text(), expectedRootHtml);
    await assertResponse(origin, "/phase0/main.ts", { status: 404 });
    await assertResponse(origin, "/@vite/client", { status: 404 });
    const versionResponse = await assertResponse(origin, "/api/version", {
      status: 200,
      contentType: /json/,
    });
    assert.deepEqual(await versionResponse.json(), {
      version: packageMetadata.version,
    });
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
  }
}

async function assertSourceFreeBuiltRuntime() {
  const runtimeRoot = await fs.mkdtemp(path.join(path.dirname(root), "darkflow-built-runtime-"));
  let runtimeServer;

  try {
    await fs.mkdir(path.join(runtimeRoot, "dist"), { recursive: true });
    await Promise.all([
      fs.copyFile(path.join(root, "server.js"), path.join(runtimeRoot, "server.js")),
      fs.copyFile(path.join(root, "package.json"), path.join(runtimeRoot, "package.json")),
      fs.cp(path.join(root, "lib"), path.join(runtimeRoot, "lib"), {
        recursive: true,
      }),
      fs.cp(artifactDir, path.join(runtimeRoot, "dist", "client"), {
        recursive: true,
      }),
      fs.symlink(path.join(root, "node_modules"), path.join(runtimeRoot, "node_modules")),
    ]);
    await assert.rejects(fs.stat(path.join(runtimeRoot, "public")), {
      code: "ENOENT",
    });

    runtimeServer = (await import(pathToFileURL(path.join(runtimeRoot, "server.js")).href)).default;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const address = await runtimeServer.startServer({
        port: 0,
        host: "127.0.0.1",
        mode: "built",
      });
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      assert.equal(response.status, 200);
      assert.equal(
        await response.text(),
        await fs.readFile(path.join(runtimeRoot, "dist", "client", "index.html"), "utf8"),
      );
      await runtimeServer.stopServer();
    }
  } finally {
    await runtimeServer?.stopServer();
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
}

let artifactHidden = false;
try {
  await assert.rejects(
    startServer({ port: 0, host: "127.0.0.1", mode: "not-a-mode" }),
    /Unknown serve mode: not-a-mode/,
  );
  assert.equal(server.listening, false);
  assert.deepEqual(getServeInfo(), { mode: null, mcp: null });

  const occupiedPort = net.createServer();
  occupiedPort.listen(0, "127.0.0.1");
  await once(occupiedPort, "listening");
  try {
    await assert.rejects(
      startServer({
        port: occupiedPort.address().port,
        host: "127.0.0.1",
        mode: "built",
      }),
      (error) => error.code === "EADDRINUSE",
    );
    assert.equal(server.listening, false);
    assert.deepEqual(getServeInfo(), { mode: null, mcp: null });
  } finally {
    await new Promise((resolve, reject) => {
      occupiedPort.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const address = await startServer({
    port: 0,
    host: "127.0.0.1",
    mode: "built",
  });
  const origin = `http://127.0.0.1:${address.port}`;
  const rootResponse = await assertResponse(origin, "/", {
    status: 200,
    contentType: /text\/html/,
  });
  const rootHtml = await rootResponse.text();
  assert.doesNotMatch(rootHtml, /\/js\/app\.js/);
  assert.doesNotMatch(rootHtml, /\.ts["']/);
  const rootBundle = rootHtml.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(rootBundle, "index.html must reference a generated JavaScript bundle");
  assert.doesNotMatch(rootBundle, /phase0-/);
  await assertResponse(origin, rootBundle, {
    status: 200,
    contentType: /javascript/,
  });
  const rootBundleBody = await (await fetch(`${origin}${rootBundle}`)).text();
  assert.match(rootBundleBody, /__darkflowPhase1Bootstrap/);
  assert.match(rootBundleBody, /\/js\/app\.js/);
  await assertResponse(origin, "/app/bootstrap.ts", { status: 404 });
  assert.deepEqual(getServeInfo(), {
    mode: "built",
    mcp: { mounted: false, path: "/mcp", reason: "disabled" },
  });

  const phaseResponse = await assertResponse(origin, "/phase0/", {
    status: 200,
    contentType: /text\/html/,
  });
  const phaseHtml = await phaseResponse.text();
  const phaseBundle = phaseHtml.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(phaseBundle, "phase0/index.html must reference a JavaScript bundle");
  await assertResponse(origin, phaseBundle, {
    status: 200,
    contentType: /javascript/,
  });
  await assertResponse(origin, "/phase0/main.ts", { status: 404 });
  await assertResponse(origin, "/@vite/client", { status: 404 });

  const configResponse = await assertResponse(origin, "/config.json", {
    status: 200,
    contentType: /json/,
  });
  assert.deepEqual(Object.keys(await configResponse.json()).sort(), [
    "gameName",
    "hiddenPanels",
    "host",
    "port",
    "wss",
  ]);
  const versionResponse = await assertResponse(origin, "/api/version", {
    status: 200,
    contentType: /json/,
  });
  assert.match(versionResponse.headers.get("cache-control") || "", /no-store/);
  assert.deepEqual(await versionResponse.json(), {
    version: packageMetadata.version,
  });
  const pingResponse = await assertResponse(origin, "/ping", { status: 204 });
  assert.match(pingResponse.headers.get("cache-control") || "", /no-store/);
  await assertResponse(origin, "/vendor/howler.core.min.js", {
    status: 200,
    contentType: /javascript/,
  });
  await assertResponse(origin, "/site.webmanifest", {
    status: 200,
    contentType: /json|manifest/,
  });
  await assertResponse(origin, "/css/main.css", {
    status: 200,
    contentType: /text\/css/,
  });
  await assertResponse(origin, "/js/app.js", {
    status: 200,
    contentType: /javascript/,
  });
  await assertResponse(origin, "/assets/brand/darkflow-icon-32.png", {
    status: 200,
    contentType: /image\/png/,
  });
  await assertResponse(origin, "/assets/sounds/bard/harp_A4.mp3", {
    status: 200,
    contentType: /audio\/mpeg/,
  });
  await assertProxyRejections(origin, address.port);

  await stopServer();
  assert.equal(server.listening, false);
  assert.deepEqual(getServeInfo(), { mode: null, mcp: null });

  const artifactStat = await fs.stat(artifactDir);
  const artifactIndex = await fs.readFile(path.join(artifactDir, "index.html"));
  await fs.rename(artifactDir, hiddenArtifactDir);
  artifactHidden = true;
  await assert.rejects(startServer({ port: 0, host: "127.0.0.1", mode: "built" }), /npm run build/);
  assert.equal(server.listening, false);
  assert.deepEqual(getServeInfo(), { mode: null, mcp: null });

  await fs.rename(hiddenArtifactDir, artifactDir);
  artifactHidden = false;
  const restoredStat = await fs.stat(artifactDir);
  assert.equal(restoredStat.ino, artifactStat.ino);
  assert.deepEqual(await fs.readFile(path.join(artifactDir, "index.html")), artifactIndex);

  const retryAddress = await startServer({
    port: 0,
    host: "127.0.0.1",
    mode: "built",
  });
  assert.ok(retryAddress.port > 0);
  await stopServer();

  await assertSourceFreeBuiltRuntime();

  const frontendStackLength = app._router.stack.length;
  const devAddress = await startServer({
    port: 0,
    host: "127.0.0.1",
    mode: "dev",
  });
  const devOrigin = `http://127.0.0.1:${devAddress.port}`;
  const devRootResponse = await assertResponse(devOrigin, "/", {
    status: 200,
    contentType: /text\/html/,
  });
  const devRootHtml = await devRootResponse.text();
  assert.match(devRootHtml, /\/@vite\/client/);
  assert.match(devRootHtml, /\/app\/bootstrap\.ts/);
  await assertResponse(devOrigin, "/app/bootstrap.ts", {
    status: 200,
    contentType: /javascript/,
  });
  await assertResponse(devOrigin, "/phase0/main.ts", { status: 200 });
  await assertResponse(devOrigin, "/@vite/client", { status: 200 });
  await stopServer();
  assert.equal(app._router.stack.length, frontendStackLength);

  const restartedDevAddress = await startServer({
    port: 0,
    host: "127.0.0.1",
    mode: "dev",
  });
  const restartedDevOrigin = `http://127.0.0.1:${restartedDevAddress.port}`;
  await assertResponse(restartedDevOrigin, "/", {
    status: 200,
    contentType: /text\/html/,
  });
  await assertResponse(restartedDevOrigin, "/app/bootstrap.ts", {
    status: 200,
    contentType: /javascript/,
  });
  await assertResponse(restartedDevOrigin, "/phase0/main.ts", { status: 200 });
  await assertResponse(restartedDevOrigin, "/@vite/client", { status: 200 });
  await stopServer();
  assert.equal(app._router.stack.length, frontendStackLength);

  const afterDevAddress = await startServer({
    port: 0,
    host: "127.0.0.1",
    mode: "built",
  });
  const afterDevOrigin = `http://127.0.0.1:${afterDevAddress.port}`;
  await assertResponse(afterDevOrigin, "/app/bootstrap.ts", { status: 404 });
  await assertResponse(afterDevOrigin, "/phase0/main.ts", { status: 404 });
  await assertResponse(afterDevOrigin, "/@vite/client", { status: 404 });
  await assertResponse(afterDevOrigin, "/definitely-not-built", {
    status: 404,
  });
  await stopServer();

  await assertUnflaggedCliUsesBuiltMode();

  console.log("Built production server contract verified");
} finally {
  await stopServer();
  if (artifactHidden) await fs.rename(hiddenArtifactDir, artifactDir);
}
