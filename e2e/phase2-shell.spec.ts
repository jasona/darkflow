import { expect, test, type Page } from "@playwright/test";

interface FakeSocketSnapshot {
  readyStates: number[];
  sentCounts: number[];
  urls: string[];
}

test("Phase 2 uses one Svelte shell without loading the legacy client", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/phase2/");

  const shell = page.getByTestId("phase2-shell");
  await expect(shell).toHaveCount(1);
  await expect(shell).toContainText("Phase 2 integration shell");
  await expect(page.getByTestId("phase2-content-host")).toHaveCount(1);
  expect(await shell.getAttribute("data-session-id")).toBeTruthy();
  expect(requests).not.toContain("/js/app.js");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        howl: typeof (window as unknown as { Howl?: unknown }).Howl,
        phase: (window as unknown as { __darkflowPhase1Bootstrap?: { phase: string } })
          .__darkflowPhase1Bootstrap?.phase,
      })),
    )
    .toEqual({ howl: "function", phase: "client-loaded" });

  await page.evaluate(() => {
    (
      window as unknown as { __darkflowPhase1Runtime: { session: { dispose(): void } } }
    ).__darkflowPhase1Runtime.session.dispose();
  });
  await expect(shell).toHaveCount(0);

  await page.goto("/");
  await expect(page.locator("#toolbar")).toBeVisible();
});

test("Phase 2 controls drive connection, reconnect overlay, focus, and disposal", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("darkflow-protocol", "telnet"));
  await installFakeWebSocket(page);
  await page.goto("/phase2/");

  const shell = page.getByTestId("phase2-shell");
  const protocol = page.getByLabel("Connection protocol");
  await expect(protocol).toHaveValue("telnet");
  await expect(protocol.locator("option")).toHaveCount(4);
  await protocol.selectOption("ws");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("darkflow-protocol")))
    .toBe("ws");

  await page.getByLabel("Host").fill("fixture.example");
  await page.getByLabel("Port").fill("4321");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator('[role="status"]')).toHaveText("Connecting via ws");
  expect(await readFakeSockets(page)).toMatchObject({ urls: ["ws://fixture.example:4321/"] });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await controlFakeSocket(page, "open");
  await expect(page.locator('[role="status"]')).toHaveText("Connected via ws");
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();

  await shell.focus();
  await controlFakeSocket(page, "drop");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Connection lost");
  await expect(dialog).toContainText(/Next attempt in [01]s; attempt 1; via ws/);
  await expect(page.getByRole("button", { name: "Retry now" })).toBeFocused();

  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(dialog).toContainText("Reconnecting...");
  await expect.poll(async () => (await readFakeSockets(page)).urls).toHaveLength(2);
  await controlFakeSocket(page, "open");
  await expect(dialog).toHaveCount(0);
  await expect(shell).toBeFocused();

  await controlFakeSocket(page, "drop");
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Stop trying" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(shell).toBeFocused();
  await expect(page.locator('[role="status"]')).toHaveText("Disconnected");

  await page.getByLabel("Host").fill("");
  await page.getByLabel("Port").fill("");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect
    .poll(async () => (await readFakeSockets(page)).urls.at(-1))
    .toBe("ws://localhost:4242/");
  await controlFakeSocket(page, "open");
  await controlFakeSocket(page, "drop");
  await expect(dialog).toBeVisible();
  const socketsBeforeDisposal = (await readFakeSockets(page)).urls.length;
  await disposePhase2Session(page);
  await expect(shell).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(1_100);
  expect((await readFakeSockets(page)).urls).toHaveLength(socketsBeforeDisposal);
});

test("Phase 2 endpoint precedence auto-connects config, URL, and Zork targets", async ({
  page,
}) => {
  await installFakeWebSocket(page);
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        host: "config.example",
        port: 7777,
        wss: true,
        gameName: "Fixture",
        hiddenPanels: [],
      }),
    }),
  );

  await page.goto("/phase2/");
  await expect(page.getByLabel("Host")).toHaveValue("config.example");
  await expect(page.getByLabel("Port")).toHaveValue("7777");
  await expect
    .poll(async () => (await readFakeSockets(page)).urls)
    .toEqual(["wss://config.example:7777/"]);

  await page.goto("/phase2/?host=url.example&port=3131&type=ws");
  await expect(page.getByLabel("Host")).toHaveValue("url.example");
  await expect(page.getByLabel("Port")).toHaveValue("3131");
  await expect(page.getByLabel("Connection protocol")).toHaveValue("ws");
  await expect
    .poll(async () => (await readFakeSockets(page)).urls)
    .toEqual(["ws://url.example:3131/"]);

  await page.goto("/phase2/?zork=1&host=ignored.example&port=1&type=wss");
  await expect(page.getByLabel("Host")).toHaveCount(0);
  await expect(page.getByText("Darkwind connection")).toBeVisible();
  await expect
    .poll(async () => (await readFakeSockets(page)).urls)
    .toEqual(["ws://127.0.0.1:3123/proxy?host=darkwind.ai&port=4244&tls=0"]);
});

async function installFakeWebSocket(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readonly extensions = "";
      readonly protocol = "";
      binaryType: BinaryType = "blob";
      bufferedAmount = 0;
      readyState = FakeWebSocket.CONNECTING;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;
      sent: unknown[] = [];
      url: string;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        sockets.push(this);
      }

      close(code = 1000, reason = ""): void {
        if (this.readyState === FakeWebSocket.CLOSED) return;
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
      }

      send(data: unknown): void {
        this.sent.push(data);
      }

      open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.(new Event("open"));
      }

      drop(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new CloseEvent("close", { code: 1006, reason: "fixture drop" }));
      }
    }

    const sockets: FakeWebSocket[] = [];
    const applicationSockets = () =>
      sockets.filter((socket) => !new URL(socket.url).searchParams.has("token"));
    const control = {
      drop: () => applicationSockets().at(-1)?.drop(),
      open: () => applicationSockets().at(-1)?.open(),
      snapshot: () => ({
        readyStates: applicationSockets().map((socket) => socket.readyState),
        sentCounts: applicationSockets().map((socket) => socket.sent.length),
        urls: applicationSockets().map((socket) => socket.url),
      }),
    };
    (window as unknown as { __phase2SocketControl: typeof control }).__phase2SocketControl =
      control;
    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
}

function readFakeSockets(page: Page): Promise<FakeSocketSnapshot> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __phase2SocketControl: { snapshot(): FakeSocketSnapshot };
      }
    ).__phase2SocketControl.snapshot(),
  );
}

function controlFakeSocket(page: Page, action: "drop" | "open"): Promise<void> {
  return page.evaluate((nextAction) => {
    const control = (
      window as unknown as {
        __phase2SocketControl: { drop(): void; open(): void };
      }
    ).__phase2SocketControl;
    control[nextAction]();
  }, action);
}

function disposePhase2Session(page: Page): Promise<void> {
  return page.evaluate(() => {
    (
      window as unknown as { __darkflowPhase1Runtime: { session: { dispose(): void } } }
    ).__darkflowPhase1Runtime.session.dispose();
  });
}
