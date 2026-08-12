import { expect, test } from "@playwright/test";

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
