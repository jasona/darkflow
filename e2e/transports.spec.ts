import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import {
  localhostCertificatePath,
  TransportFixtureOwner,
  type TransportEndpoint,
  type TransportName,
} from "./fixtures/transport-fixtures";

interface WsEvent {
  detail: {
    transport?: string;
    url?: string;
  };
  type: string;
}

interface WsDebugSnapshot {
  events: WsEvent[];
  lastHandlerErrorAt: number | null;
  lastInboundGmcpAt: number | null;
  readyStateName: string;
  url: string;
}

interface WsDebugWindow extends Window {
  wsDebug: {
    snapshot(): WsDebugSnapshot;
  };
}

const appOrigin = "http://127.0.0.1:3124";
const transports: TransportName[] = ["ws", "wss", "telnet", "telnets"];
const transportLabels: Record<TransportName, string> = {
  telnet: "t",
  telnets: "ts",
  ws: "ws",
  wss: "wss",
};

let fixtures: TransportFixtureOwner;

test.beforeAll(async () => {
  fixtures = await TransportFixtureOwner.start();
});

test.afterAll(async () => {
  await fixtures.close();
});

test("localhost fixture certificate remains valid for at least one year", () => {
  const certificate = new X509Certificate(readFileSync(localhostCertificatePath));
  const oneYearFromNow = Date.now() + 365 * 24 * 60 * 60 * 1000;

  expect(Date.parse(certificate.validTo)).toBeGreaterThan(oneYearFromNow);
  expect(certificate.subjectAltName).toContain("DNS:localhost");
  expect(certificate.subjectAltName).toContain("IP Address:127.0.0.1");
});

for (const transport of transports) {
  test(`${transport} uses the selected local transport without fallback`, async ({ page }) => {
    const endpoint = fixtures.endpoints[transport];
    const websocketUrls: string[] = [];
    const runtimeErrors: string[] = [];

    page.on("websocket", (socket) => websocketUrls.push(socket.url()));
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("darkwind-client-settings", JSON.stringify({ autoReconnect: false }));
    });

    const configResponse = page.waitForResponse(
      (response) => response.url().endsWith("/config.json") && response.ok(),
    );
    await page.goto("/?debugWs=1");
    await configResponse;
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as unknown as { wsDebug?: { snapshot?: unknown } }).wsDebug?.snapshot),
        ),
      )
      .toBe(true);
    await connectThroughPublicControls(page, endpoint);

    const expectedUrl = transportUrl(endpoint);
    await expect
      .poll(() => readWsSnapshot(page))
      .toMatchObject({ readyStateName: "open", url: expectedUrl });
    await expect(page.locator("#status-connection")).toContainText(
      `Connected [${transportLabels[transport]}]`,
    );
    await expect(page.getByLabel("Terminal output", { exact: true })).toContainText(
      endpoint.prompt,
    );

    await page.getByLabel("Command input").fill("look");
    await page.getByLabel("Command input").press("Enter");
    const expectedCommand = transport === "ws" || transport === "wss" ? "look" : "look\r\n";
    await expect.poll(() => endpoint.commands).toEqual([expectedCommand]);
    await expect(page.getByLabel("Terminal output", { exact: true })).toContainText(endpoint.reply);

    const snapshot = await readWsSnapshot(page);
    const attempts = snapshot.events.filter((event) => event.type === "connect-attempt");
    const opens = snapshot.events.filter((event) => event.type === "open");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      detail: { transport, url: expectedUrl },
      type: "connect-attempt",
    });
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      detail: { transport, url: expectedUrl },
      type: "open",
    });
    expect(snapshot.events.filter((event) => event.type === "transport-fallback")).toEqual([]);
    expect(snapshot.lastInboundGmcpAt).not.toBeNull();
    expect(snapshot.lastHandlerErrorAt).toBeNull();
    expect(websocketUrls).toEqual([expectedUrl]);
    expect(websocketUrls.some((url) => url.includes("darkwind.ai"))).toBe(false);
    expect(runtimeErrors).toEqual([]);

    await page.close();
    await expect.poll(() => endpoint.activeSocketCount()).toBe(0);
  });

  test(`${transport} Phase 2 controls use one session transport without fallback`, async ({
    page,
  }) => {
    const endpoint = fixtures.endpoints[transport];
    const websocketUrls: string[] = [];
    const runtimeErrors: string[] = [];

    page.on("websocket", (socket) => websocketUrls.push(socket.url()));
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.goto("/phase2/");
    await connectThroughPublicControls(page, endpoint);

    const expectedUrl = transportUrl(endpoint);
    await expect
      .poll(() => readPhase2HealthSnapshot(page))
      .toMatchObject({ readyStateName: "open", url: expectedUrl });
    await expect(page.locator('[role="status"]')).toHaveText(`Connected via ${transport}`);
    await expect.poll(() => endpoint.activeSocketCount()).toBe(1);

    const snapshot = await readPhase2HealthSnapshot(page);
    const attempts = snapshot.events.filter((event) => event.type === "connect-attempt");
    const opens = snapshot.events.filter((event) => event.type === "open");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      detail: { transport, url: expectedUrl },
      type: "connect-attempt",
    });
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      detail: { transport, url: expectedUrl },
      type: "open",
    });
    expect(snapshot.events.filter((event) => event.type === "send-generic")).toHaveLength(3);
    expect(snapshot.lastInboundGmcpAt).not.toBeNull();
    expect(snapshot.lastHandlerErrorAt).toBeNull();
    expect(websocketUrls).toEqual([expectedUrl]);
    expect(websocketUrls.some((url) => url.includes("darkwind.ai"))).toBe(false);
    expect(runtimeErrors).toEqual([]);

    await page.close();
    await expect.poll(() => endpoint.activeSocketCount()).toBe(0);
  });
}

async function connectThroughPublicControls(
  page: Page,
  endpoint: TransportEndpoint,
): Promise<void> {
  await page.getByLabel("Host").fill("127.0.0.1");
  await page.getByLabel("Port").fill(String(endpoint.port));
  await page.getByLabel("Connection protocol").selectOption(endpoint.protocol);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}

function transportUrl(endpoint: TransportEndpoint): string {
  if (endpoint.protocol === "ws" || endpoint.protocol === "wss") {
    return `${endpoint.protocol}://127.0.0.1:${endpoint.port}/`;
  }

  const tls = endpoint.protocol === "telnets" ? "1" : "0";
  return `${appOrigin.replace("http", "ws")}/proxy?host=127.0.0.1&port=${endpoint.port}&tls=${tls}`;
}

async function readWsSnapshot(page: Page): Promise<WsDebugSnapshot> {
  return page.evaluate(() => (window as unknown as WsDebugWindow).wsDebug.snapshot());
}

async function readPhase2HealthSnapshot(page: Page): Promise<WsDebugSnapshot> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __darkflowPhase1Runtime: { session: { getHealthSnapshot(): WsDebugSnapshot } };
      }
    ).__darkflowPhase1Runtime.session.getHealthSnapshot(),
  );
}
