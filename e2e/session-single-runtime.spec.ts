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

test("session disposal tears down legacy GMCP controllers and blocks late dispatch", async ({
  page,
}) => {
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

  const result = await page.evaluate(async () => {
    const controllerBridge = (
      window as unknown as {
        __darkflowPhase1ControllerBridge?: {
          getControllerDiagnostics(): {
            activeControllers: number;
            session: Record<string, number>;
          };
        };
      }
    ).__darkflowPhase1ControllerBridge;
    const runtimeBridge = (
      window as unknown as {
        __darkflowPhase1RuntimeBridge?: {
          gmcpDispatch(packageName: string, data: unknown): void;
        };
      }
    ).__darkflowPhase1RuntimeBridge;
    const before = controllerBridge?.getControllerDiagnostics();

    runtimeBridge?.gmcpDispatch("Darkwind.Broadcast.Show", {
      title: "Lifecycle fixture",
      message: "visible before disposal",
      durationMs: 60_000,
    });
    const overlay = document.querySelector(".broadcast-overlay");
    const openedBeforeDispose = overlay?.classList.contains("open") ?? false;

    const runtime = (
      window as unknown as {
        __darkflowPhase1Runtime?: { session: { dispose(): void } };
      }
    ).__darkflowPhase1Runtime;
    runtime?.session.dispose();

    runtimeBridge?.gmcpDispatch("Darkwind.Broadcast.Show", {
      title: "Late fixture",
      message: "must remain hidden",
      durationMs: 60_000,
    });
    const after = controllerBridge?.getControllerDiagnostics();
    return {
      before,
      after,
      openedBeforeDispose,
      openedAfterDispose: overlay?.classList.contains("open") ?? false,
    };
  });

  expect(result.openedBeforeDispose).toBe(true);
  expect(result.openedAfterDispose).toBe(false);
  expect(result.before?.activeControllers).toBe(26);
  expect(result.before?.session.liveSubscriptions).toBeGreaterThanOrEqual(109);
  expect(result.after?.activeControllers).toBe(0);
  expect(result.after?.session).toMatchObject({
    liveTimers: 0,
    liveAnimationFrames: 0,
    liveSubscriptions: 0,
    liveObservers: 0,
    liveListeners: 0,
    liveChildScopes: 0,
    liveSockets: 0,
    liveTeardowns: 0,
    handlerFailures: 0,
  });
});
