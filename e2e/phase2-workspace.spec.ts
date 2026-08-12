import { expect, test, type Page } from "@playwright/test";

async function disposeSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { __darkflowPhase1Runtime: { session: { dispose(): void } } }
    ).__darkflowPhase1Runtime.session.dispose();
  });
}

async function openWorkspace(page: Page): Promise<void> {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/phase2/");
  await expect(page.getByTestId("phase2-shell")).toHaveCount(1);
  await expect(page.getByTestId("workspace-host")).toBeVisible();
  await expect(page.locator("[data-terminal-identity]")).toHaveCount(1);
  expect(requests).not.toContain("/js/app.js");
}

test("Phase 2 persists and restores one real-session workspace", async ({ page }) => {
  await openWorkspace(page);

  const terminal = page.locator("[data-terminal-identity]");
  const terminalIdentity = await terminal.getAttribute("data-terminal-identity");
  await terminal.focus();
  await page.getByRole("button", { name: "Focus terminal" }).click();
  await expect(terminal).toBeFocused();

  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByRole("button", { name: "Open panel" })).toBeVisible();
  await expect(page.getByTestId("workspace-status")).toHaveText("Workspace saved");
  expect(await terminal.getAttribute("data-terminal-identity")).toBe(terminalIdentity);

  const saved = await page.evaluate(() => {
    const runtime = (
      window as unknown as { __darkflowPhase1Runtime: { characterProfileId: string } }
    ).__darkflowPhase1Runtime;
    const state = JSON.parse(localStorage.getItem("darkflow-session-core-v1") ?? "{}");
    return state.characterProfiles[runtime.characterProfileId].workspace;
  });
  expect(saved.version).toBe(2);
  expect(saved.payload.dockview.version).toBe(1);

  await page.reload();
  await expect(page.getByTestId("workspace-status")).toHaveText("Workspace restored");
  await expect(page.locator("[data-terminal-identity]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Open panel" })).toBeVisible();

  await disposeSession(page);
  await expect(page.getByTestId("phase2-shell")).toHaveCount(0);
  await expect(page.locator('[data-workspace-owned="true"]')).toHaveCount(0);
});

test("Phase 2 recovers from a malformed layout and reports a storage failure", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByTestId("workspace-status")).toHaveText("Workspace saved");
  await page.evaluate(() => {
    const runtime = (
      window as unknown as { __darkflowPhase1Runtime: { characterProfileId: string } }
    ).__darkflowPhase1Runtime;
    const state = JSON.parse(localStorage.getItem("darkflow-session-core-v1") ?? "{}");
    state.characterProfiles[runtime.characterProfileId].workspace.payload.dockview.layout = {
      malformed: true,
    };
    localStorage.setItem("darkflow-session-core-v1", JSON.stringify(state));
  });

  await page.reload();
  await expect(page.getByTestId("workspace-status")).toContainText("using the default layout");
  await expect(page.locator("[data-terminal-identity]")).toHaveCount(1);

  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByTestId("workspace-status")).toHaveText("Workspace saved");
  await page.evaluate(() => {
    const runtime = (
      window as unknown as { __darkflowPhase1Runtime: { characterProfileId: string } }
    ).__darkflowPhase1Runtime;
    const state = JSON.parse(localStorage.getItem("darkflow-session-core-v1") ?? "{}");
    state.characterProfiles[runtime.characterProfileId].workspace.payload.dockview.layout = {};
    localStorage.setItem("darkflow-session-core-v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByTestId("workspace-status")).toContainText("using the default layout");
  await expect(page.locator("[data-terminal-identity]")).toHaveCount(1);

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "darkflow-session-core-v1") throw new Error("storage fixture failure");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByTestId("workspace-status")).toContainText("storage fixture failure");
});
