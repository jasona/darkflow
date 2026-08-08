import { expect, test as base, type CDPSession, type Locator, type Page } from "@playwright/test";
import type { PanelObservation, PanelSpec } from "./workspace-test-bridge";

interface RuntimeFixtures {
  runtimeErrors: string[];
}

const test = base.extend<RuntimeFixtures>({
  runtimeErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    await use(errors);
    expect(errors).toEqual([]);
  },
});

function panelDragHandle(page: Page, panelId: string): Locator {
  return page.locator(`[data-panel-drag-handle][data-panel-id="${panelId}"]`);
}

function floatingDragHandle(page: Page, panelId: string): Locator {
  return page.locator(`[data-floating-drag-handle][data-panel-id="${panelId}"]`);
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/** Drive Dockview's pointer drag source with touch-typed CDP mouse events. */
async function dispatchPointerTouch(
  session: CDPSession,
  type: "mousePressed" | "mouseMoved" | "mouseReleased",
  point: { x: number; y: number },
  pressed: boolean,
): Promise<void> {
  await session.send("Input.dispatchMouseEvent", {
    type,
    x: point.x,
    y: point.y,
    button: "left",
    buttons: pressed ? 1 : 0,
    // @ts-expect-error CDP accepts touch pointerType; Playwright typings omit it.
    pointerType: "touch",
    clickCount: type === "mousePressed" ? 1 : 0,
  });
}

async function touchDrag(
  page: Page,
  source: Locator,
  target: { x: number; y: number },
  holdMilliseconds: number,
): Promise<void> {
  const start = await center(source);
  const end = { x: target.x, y: target.y };
  const session = await page.context().newCDPSession(page);
  try {
    await dispatchPointerTouch(session, "mousePressed", start, true);
    await page.waitForTimeout(holdMilliseconds);
    for (let step = 1; step <= 6; step += 1) {
      const progress = step / 6;
      await dispatchPointerTouch(
        session,
        "mouseMoved",
        {
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        },
        true,
      );
      await page.waitForTimeout(25);
    }
    await dispatchPointerTouch(session, "mouseReleased", end, false);
  } finally {
    await session.detach();
  }
}

async function observePanel(page: Page, id: string): Promise<PanelObservation> {
  const observation = await page.evaluate(
    (panelId) => window.__darkflowWorkspace.panel(panelId),
    id,
  );
  expect(observation, `expected panel ${id} to exist`).not.toBeNull();
  return observation as PanelObservation;
}

test("touch gestures distinguish taps, swipes, docking, and floating movement", async ({
  page,
  runtimeErrors,
}) => {
  void runtimeErrors;
  await page.goto("/phase0/");
  const workspace = page.getByTestId("workspace-host");
  await expect(workspace).toBeVisible();
  await workspace.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      workspace.evaluate((host) => {
        const bounds = host.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      }),
    )
    .toBe(true);
  await page.waitForFunction(() => typeof window.__darkflowWorkspace?.upsert === "function");

  const first: PanelSpec = {
    id: "touch-first",
    kind: "lifecycle",
    title: "Touch first",
    state: { value: "first" },
  };
  const second: PanelSpec = {
    id: "touch-second",
    kind: "lifecycle",
    title: "Touch second",
    state: { value: "second" },
    placement: { kind: "grid", direction: "below", referencePanelId: first.id },
  };
  const floating: PanelSpec = {
    id: "touch-floating",
    kind: "terminal",
    title: "Touch floating",
    state: { label: "floating" },
    placement: {
      kind: "floating",
      bounds: { left: 24, top: 24, width: 280, height: 220 },
    },
  };
  await page.evaluate(
    (specs) => {
      for (const spec of specs) window.__darkflowWorkspace.upsert(spec);
    },
    [first, second],
  );

  const firstHandle = panelDragHandle(page, first.id);
  const secondHandle = panelDragHandle(page, second.id);
  await expect(firstHandle).toBeVisible();
  await expect(secondHandle).toBeVisible();

  await firstHandle.tap();
  await expect
    .poll(() => page.evaluate((id) => window.__darkflowWorkspace.panel(id)?.active, first.id))
    .toBe(true);

  const beforeSwipe = await observePanel(page, first.id);
  const swipeStart = await center(firstHandle);
  await touchDrag(page, firstHandle, { x: swipeStart.x + 70, y: swipeStart.y }, 40);
  const afterSwipe = await observePanel(page, first.id);
  expect(afterSwipe.groupId).toBe(beforeSwipe.groupId);
  expect(afterSwipe.panelIndex).toBe(beforeSwipe.panelIndex);
  expect(afterSwipe.floating).toBe(beforeSwipe.floating);

  const firstBounds = (await observePanel(page, first.id)).bounds;
  const dockTarget = {
    x: firstBounds.left + firstBounds.width / 2,
    y: firstBounds.top + firstBounds.height / 2,
  };
  await touchDrag(page, secondHandle, dockTarget, 300);
  await expect
    .poll(async () => {
      const [left, moved] = await Promise.all([
        observePanel(page, first.id),
        observePanel(page, second.id),
      ]);
      return moved.groupId === left.groupId;
    })
    .toBe(true);

  await page.evaluate((panel) => window.__darkflowWorkspace.upsert(panel), floating);
  const beforeFloatingMove = await observePanel(page, floating.id);
  expect(beforeFloatingMove.floating).toBe(true);
  const floatingHandle = floatingDragHandle(page, floating.id);
  await expect(floatingHandle).toBeVisible();
  const floatingMoveTarget = {
    x: beforeFloatingMove.bounds.left + beforeFloatingMove.bounds.width - 48,
    y: beforeFloatingMove.bounds.top + beforeFloatingMove.bounds.height - 48,
  };
  await touchDrag(page, floatingHandle, floatingMoveTarget, 300);
  await expect
    .poll(async () => {
      const moved = await observePanel(page, floating.id);
      return {
        floating: moved.floating,
        leftChanged: Math.abs(moved.bounds.left - beforeFloatingMove.bounds.left) >= 30,
        topChanged: Math.abs(moved.bounds.top - beforeFloatingMove.bounds.top) >= 20,
      };
    })
    .toEqual({ floating: true, leftChanged: true, topChanged: true });

  await page.evaluate(() => window.__darkflowWorkspace.dispose());
  await expect
    .poll(() => page.evaluate(() => window.__darkflowWorkspace.diagnostics()))
    .toMatchObject({
      liveRoots: 0,
      liveHosts: 0,
      subscriptions: 0,
      observers: 0,
      listeners: 0,
      terminalIslands: 0,
      ownedDom: 0,
      duplicateDisposals: 0,
    });
});
