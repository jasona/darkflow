import { expect, test } from "@playwright/test";
import { TransportFixtureOwner } from "./fixtures/transport-fixtures";

const cycleCount = 25;
const zeroSessionResources = {
  liveAnimationFrames: 0,
  liveChildScopes: 0,
  liveListeners: 0,
  liveObservers: 0,
  liveSockets: 0,
  liveSubscriptions: 0,
  liveTeardowns: 0,
  liveTimers: 0,
};

let fixtures: TransportFixtureOwner;

test.beforeAll(async () => {
  fixtures = await TransportFixtureOwner.start();
});

test.afterAll(async () => {
  await fixtures.close();
});

test("25 connect and disposal cycles release every session browser resource", async ({ page }) => {
  test.setTimeout(180_000);
  const endpoint = fixtures.endpoints.ws;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("darkwind-client-settings", JSON.stringify({ autoReconnect: false }));
  });

  for (let cycle = 1; cycle <= cycleCount; cycle++) {
    await page.goto("/");
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __darkflowPhase1Bootstrap?: { phase: string };
                }
              ).__darkflowPhase1Bootstrap?.phase,
          ),
        { message: `cycle ${cycle} bootstrap` },
      )
      .toBe("legacy-loaded");

    await page.getByLabel("Host").fill("127.0.0.1");
    await page.getByLabel("Port").fill(String(endpoint.port));
    await page.getByLabel("Connection protocol").selectOption("ws");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect.poll(() => endpoint.activeSocketCount()).toBe(1);
    await expect(page.locator("#status-connection")).toContainText("Connected");

    endpoint.sendText(`cycle ${cycle} output`);
    const commandCountBefore = endpoint.commands.length;
    const result = await page.evaluate((cycleIndex) => {
      const runtimeWindow = window as unknown as {
        __darkflowPhase1ControllerBridge?: {
          getControllerDiagnostics(): {
            activeControllers: number;
            session: Record<string, number>;
          };
        };
        __darkflowPhase1Runtime?: { session: { dispose(): void } };
        __darkflowPhase1RuntimeBridge?: {
          disconnect(): void;
          gmcpDispatch(packageName: string, data: unknown): void;
        };
      };
      const input = document.querySelector("#command-input") as HTMLInputElement;
      const transfer = new DataTransfer();
      transfer.setData("text", `look\nlate-batch-${cycleIndex}`);
      input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
      (document.querySelector(".command-batch-submit") as HTMLButtonElement)?.click();
      document.dispatchEvent(new CustomEvent("darkflow:map-source-changed"));
      window.dispatchEvent(new CustomEvent("darkflow:output-layout-changed"));

      runtimeWindow.__darkflowPhase1RuntimeBridge?.disconnect();
      runtimeWindow.__darkflowPhase1Runtime?.session.dispose();
      runtimeWindow.__darkflowPhase1Runtime?.session.dispose();

      const snapshot = () => ({
        batchDrawer: Boolean(document.querySelector("#command-batch-drawer")),
        connectionOverlay: Boolean(document.querySelector(".dw-conn-overlay")),
        output: document.querySelector("#output-shell")?.innerHTML ?? "",
        panelCount: document.querySelectorAll(".gmcp-panel-widget").length,
        rfcDebug: Boolean(document.querySelector(".rfc2549-debug-panel")),
        status: document.querySelector("#status-connection")?.textContent ?? "",
      });
      const beforeLateEvents = snapshot();

      input.value = `late-enter-${cycleIndex}`;
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(
        new CustomEvent("dw:reconnectstatus", {
          detail: { status: "scheduled", nextAttemptAt: Date.now() + 10_000 },
        }),
      );
      document.dispatchEvent(new CustomEvent("darkflow:map-source-changed"));
      window.dispatchEvent(new CustomEvent("darkflow:output-layout-changed"));
      window.dispatchEvent(new Event("online"));
      runtimeWindow.__darkflowPhase1RuntimeBridge?.gmcpDispatch("Darkwind.Broadcast.Show", {
        title: "late",
        message: "must not render",
        durationMs: 60_000,
      });

      return {
        beforeLateEvents,
        diagnostics: runtimeWindow.__darkflowPhase1ControllerBridge?.getControllerDiagnostics(),
        history: JSON.parse(localStorage.getItem("darkwind-cmd-history") ?? "[]") as string[],
      };
    }, cycle);

    await expect.poll(() => endpoint.activeSocketCount()).toBe(0);
    await page.waitForTimeout(1_100);
    const afterLateEvents = await page.evaluate(() => ({
      batchDrawer: Boolean(document.querySelector("#command-batch-drawer")),
      connectionOverlay: Boolean(document.querySelector(".dw-conn-overlay")),
      output: document.querySelector("#output-shell")?.innerHTML ?? "",
      panelCount: document.querySelectorAll(".gmcp-panel-widget").length,
      rfcDebug: Boolean(document.querySelector(".rfc2549-debug-panel")),
      status: document.querySelector("#status-connection")?.textContent ?? "",
    }));
    expect(afterLateEvents, `cycle ${cycle} late DOM mutation`).toEqual(result.beforeLateEvents);
    expect(result.diagnostics?.activeControllers, `cycle ${cycle} controllers`).toBe(0);
    expect(result.diagnostics?.session, `cycle ${cycle} resources`).toMatchObject(
      zeroSessionResources,
    );
    expect(result.diagnostics?.session.rejectedResources, `cycle ${cycle} rejected resources`).toBe(
      0,
    );
    expect(result.diagnostics?.session.handlerFailures, `cycle ${cycle} handler failures`).toBe(0);
    expect(result.history.at(-1), `cycle ${cycle} history flush`).toBe("look");
    expect(endpoint.commands.slice(commandCountBefore), `cycle ${cycle} late send`).not.toContain(
      `late-batch-${cycle}`,
    );
    expect(pageErrors, `cycle ${cycle} page errors`).toEqual([]);
  }
});
