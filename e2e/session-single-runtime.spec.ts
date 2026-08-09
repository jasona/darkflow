import { expect, test } from "@playwright/test";

test("single session runtime bootstraps before legacy managers", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#toolbar")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __darkflowPhase1Bootstrap?: { phase: string } })
            .__darkflowPhase1Bootstrap?.phase,
      ),
    )
    .toBe("legacy-loaded");

  const sessionDiagnostic = await page.evaluate(
    () =>
      (
        window as unknown as {
          __darkflowPhase1Session?: {
            phase: string;
            sessionId: string;
            characterProfileId: string;
            serverProfileId: string;
          };
        }
      ).__darkflowPhase1Session,
  );

  expect(sessionDiagnostic?.phase).toBe("session-ready");
  expect(typeof sessionDiagnostic?.sessionId).toBe("string");
  expect(typeof sessionDiagnostic?.characterProfileId).toBe("string");
  expect(typeof sessionDiagnostic?.serverProfileId).toBe("string");

  const debugSnapshot = await page.evaluate(() => {
    const wsDebug = (
      window as unknown as {
        wsDebug?: { snapshot?: () => { sessionId?: string } };
      }
    ).wsDebug;
    return wsDebug?.snapshot?.() ?? {};
  });

  expect(debugSnapshot.sessionId).toBe(sessionDiagnostic?.sessionId);
});

test("session runtime survives reload without duplicate bootstrap failure", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __darkflowPhase1Bootstrap?: { phase: string } })
            .__darkflowPhase1Bootstrap?.phase,
      ),
    )
    .toBe("legacy-loaded");

  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __darkflowPhase1Bootstrap?: { phase: string } })
            .__darkflowPhase1Bootstrap?.phase,
      ),
    )
    .toBe("legacy-loaded");
});
