import { expect, test as base, type Page } from "@playwright/test";
import type {
  PanelObservation,
  PanelPlacement,
  PanelSpec,
  TerminalObservation,
  WorkspaceSnapshot,
} from "./workspace-test-bridge";

interface RuntimeFixtures {
  runtimeErrors: string[];
}

const test = base.extend<RuntimeFixtures>({
  runtimeErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`console: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    await use(errors);
    expect(errors).toEqual([]);
  },
});

function lifecyclePanel(id: string, value: string, placement?: PanelPlacement): PanelSpec {
  return {
    id,
    kind: "lifecycle",
    title: `Lifecycle ${id}`,
    state: { value },
    ...(placement ? { placement } : {}),
  };
}

function terminalPanel(id: string, placement?: PanelPlacement): PanelSpec {
  return {
    id,
    kind: "terminal",
    title: `Terminal ${id}`,
    state: { label: id },
    ...(placement ? { placement } : {}),
  };
}

async function openWorkspace(page: Page): Promise<void> {
  await page.goto("/phase0/");
  await expect(page.getByTestId("workspace-host")).toBeVisible();
  await expect
    .poll(() =>
      page.getByTestId("workspace-host").evaluate((host) => {
        const bounds = host.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      }),
    )
    .toBe(true);
  await page.waitForFunction(() => typeof window.__darkflowWorkspace?.upsert === "function");
}

async function observePanel(page: Page, id: string): Promise<PanelObservation> {
  const observation = await page.evaluate(
    (panelId) => window.__darkflowWorkspace.panel(panelId),
    id,
  );
  expect(observation, `expected panel ${id} to exist`).not.toBeNull();
  return observation as PanelObservation;
}

async function observeTerminal(page: Page, id: string): Promise<TerminalObservation> {
  const observation = await page.evaluate(
    (panelId) => window.__darkflowWorkspace.terminal(panelId),
    id,
  );
  expect(observation, `expected terminal ${id} to exist`).not.toBeNull();
  return observation as TerminalObservation;
}

async function expectTerminalState(
  page: Page,
  id: string,
  expected: TerminalObservation,
): Promise<void> {
  await expect
    .poll(() => page.evaluate((panelId) => window.__darkflowWorkspace.terminal(panelId), id))
    .toMatchObject({
      identity: expected.identity,
      buffer: expected.buffer,
      focused: true,
      scrollTop: expected.scrollTop,
      connected: true,
    });
}

function layoutShape(
  panel: PanelObservation,
): Omit<PanelObservation, "rootIdentity" | "mountCount"> {
  return {
    title: panel.title,
    groupId: panel.groupId,
    groupIndex: panel.groupIndex,
    panelIndex: panel.panelIndex,
    floating: panel.floating,
    active: panel.active,
    bounds: panel.bounds,
  };
}

function expectRestoredLayout(
  actual: ReturnType<typeof layoutShape>,
  expected: ReturnType<typeof layoutShape>,
): void {
  expect({ ...actual, bounds: undefined }).toEqual({ ...expected, bounds: undefined });
  for (const coordinate of ["left", "top", "width", "height"] as const) {
    expect(
      Math.abs(actual.bounds[coordinate] - expected.bounds[coordinate]),
      `${coordinate}: expected ${expected.bounds[coordinate]}, received ${actual.bounds[coordinate]}`,
    ).toBeLessThanOrEqual(2);
  }
}

test.beforeEach(async ({ page, runtimeErrors }) => {
  void runtimeErrors;
  await openWorkspace(page);
});

test("updates a panel in place and leaves unaffected panels mounted", async ({ page }) => {
  const first = lifecyclePanel("lifecycle-a", "alpha");
  const second = lifecyclePanel("lifecycle-b", "stable", {
    kind: "grid",
    direction: "right",
    referencePanelId: first.id,
  });
  await page.evaluate(
    ([firstPanel, secondPanel]) => {
      window.__darkflowWorkspace.upsert(firstPanel);
      window.__darkflowWorkspace.upsert(secondPanel);
    },
    [first, second] as const,
  );

  const beforeFirst = await observePanel(page, first.id);
  const beforeSecond = await observePanel(page, second.id);
  const beforeDiagnostics = await page.evaluate(() => window.__darkflowWorkspace.diagnostics());

  await page.evaluate((panel) => window.__darkflowWorkspace.upsert(panel), {
    ...first,
    title: "Lifecycle updated",
    state: { value: "bravo" },
    size: { width: 360, height: 240 },
  });

  await expect(
    page.locator(`[data-panel-id="${first.id}"] [data-testid="lifecycle-state"]`),
  ).toContainText("bravo");
  const afterFirst = await observePanel(page, first.id);
  expect(afterFirst.rootIdentity).toBe(beforeFirst.rootIdentity);
  expect(afterFirst.mountCount).toBe(beforeFirst.mountCount);
  expect(afterFirst.title).toBe("Lifecycle updated");
  await expect
    .poll(() => page.evaluate(() => window.__darkflowWorkspace.diagnostics().updates))
    .toBeGreaterThan(beforeDiagnostics.updates);

  await page.evaluate((id) => window.__darkflowWorkspace.remove(id), second.id);
  await expect
    .poll(() => page.evaluate((id) => window.__darkflowWorkspace.panel(id), second.id))
    .toBeNull();
  const survivingFirst = await observePanel(page, first.id);
  expect(survivingFirst.rootIdentity).toBe(beforeFirst.rootIdentity);
  expect(survivingFirst.mountCount).toBe(beforeFirst.mountCount);
  expect(beforeSecond.rootIdentity).not.toBe(beforeFirst.rootIdentity);
});

test("preserves terminal state through docking, floating, resize, save, and restore", async ({
  page,
}) => {
  const left = lifecyclePanel("layout-left", "left");
  const right = lifecyclePanel("layout-right", "right", {
    kind: "grid",
    direction: "right",
    referencePanelId: left.id,
  });
  const terminal = terminalPanel("terminal-main", {
    kind: "grid",
    direction: "below",
    referencePanelId: left.id,
  });
  const panels = [left, right, terminal] as const;
  await page.evaluate((specs) => {
    for (const spec of specs) window.__darkflowWorkspace.upsert(spec);
  }, panels);
  await page.evaluate((id) => {
    const lines = Array.from({ length: 80 }, (_, index) => `line-${index}\n`).join("");
    window.__darkflowWorkspace.appendTerminal(id, lines);
    window.__darkflowWorkspace.scrollTerminal(id, 180);
    window.__darkflowWorkspace.focusTerminal(id);
  }, terminal.id);
  const initialTerminal = await observeTerminal(page, terminal.id);
  expect(initialTerminal.buffer).toContain("line-79");
  expect(initialTerminal.scrollTop).toBeGreaterThan(0);
  expect(initialTerminal.focused).toBe(true);

  await page.evaluate(
    ({ id, referencePanelId }) => {
      window.__darkflowWorkspace.focusTerminal(id);
      window.__darkflowWorkspace.move(id, {
        kind: "grid",
        direction: "below",
        referencePanelId,
      });
    },
    { id: terminal.id, referencePanelId: right.id },
  );
  await expectTerminalState(page, terminal.id, initialTerminal);

  await page.evaluate(
    ({ id, referencePanelId }) => {
      window.__darkflowWorkspace.focusTerminal(id);
      window.__darkflowWorkspace.move(id, {
        kind: "grid",
        direction: "within",
        referencePanelId,
      });
    },
    { id: terminal.id, referencePanelId: right.id },
  );
  await expectTerminalState(page, terminal.id, initialTerminal);
  await page.locator(`[data-panel-drag-handle][data-panel-id="${right.id}"]`).click();
  await expect
    .poll(() => page.evaluate((id) => window.__darkflowWorkspace.panel(id)?.active, right.id))
    .toBe(true);
  await expect
    .poll(() => page.evaluate((id) => window.__darkflowWorkspace.terminal(id), terminal.id))
    .toMatchObject({
      identity: initialTerminal.identity,
      buffer: initialTerminal.buffer,
      scrollTop: initialTerminal.scrollTop,
      connected: true,
    });
  await page.locator(`[data-panel-drag-handle][data-panel-id="${terminal.id}"]`).click();
  await page.evaluate((id) => window.__darkflowWorkspace.focusTerminal(id), terminal.id);
  await expectTerminalState(page, terminal.id, initialTerminal);

  await page.evaluate((id) => {
    window.__darkflowWorkspace.focusTerminal(id);
    window.__darkflowWorkspace.move(id, {
      kind: "floating",
      bounds: { left: 80, top: 70, width: 420, height: 280 },
    });
  }, terminal.id);
  await expectTerminalState(page, terminal.id, initialTerminal);
  expect((await observePanel(page, terminal.id)).floating).toBe(true);

  await page.evaluate((id) => {
    window.__darkflowWorkspace.focusTerminal(id);
    window.__darkflowWorkspace.resize(id, { width: 460, height: 310 });
  }, terminal.id);
  await expectTerminalState(page, terminal.id, initialTerminal);
  await expect
    .poll(() =>
      page.evaluate((id) => window.__darkflowWorkspace.panel(id)?.bounds.width, terminal.id),
    )
    .toBeGreaterThanOrEqual(458);

  const beforeSave = {
    left: layoutShape(await observePanel(page, left.id)),
    right: layoutShape(await observePanel(page, right.id)),
    terminal: layoutShape(await observePanel(page, terminal.id)),
  };
  const snapshot = await page.evaluate(() => window.__darkflowWorkspace.save());
  await page.evaluate(
    ({ terminalId, leftId, rightId }) => {
      window.__darkflowWorkspace.move(terminalId, {
        kind: "grid",
        direction: "within",
        referencePanelId: leftId,
      });
      window.__darkflowWorkspace.move(rightId, {
        kind: "grid",
        direction: "below",
        referencePanelId: leftId,
      });
    },
    { terminalId: terminal.id, leftId: left.id, rightId: right.id },
  );

  const restored = await page.evaluate(
    ({ saved, specs, terminalId }) => {
      window.__darkflowWorkspace.focusTerminal(terminalId);
      return window.__darkflowWorkspace.restore(saved, specs);
    },
    { saved: snapshot, specs: panels, terminalId: terminal.id },
  );
  expect(restored).toBe(true);
  await expectTerminalState(page, terminal.id, initialTerminal);
  await expect
    .poll(() =>
      page.evaluate((id) => window.__darkflowWorkspace.panel(id)?.bounds.width, terminal.id),
    )
    .toBeGreaterThanOrEqual(458);
  expectRestoredLayout(layoutShape(await observePanel(page, left.id)), beforeSave.left);
  expectRestoredLayout(layoutShape(await observePanel(page, right.id)), beforeSave.right);
  expectRestoredLayout(layoutShape(await observePanel(page, terminal.id)), beforeSave.terminal);
});

test("recovers from invalid snapshots and completely tears down owned resources", async ({
  page,
}) => {
  const emptyWorkspace = await page.evaluate(() => window.__darkflowWorkspace.diagnostics());
  const lifecycle = lifecyclePanel("recoverable", "before-invalid");
  const terminal = terminalPanel("recoverable-terminal", {
    kind: "grid",
    direction: "right",
    referencePanelId: lifecycle.id,
  });
  await page.evaluate(
    ([first, second]) => {
      window.__darkflowWorkspace.upsert(first);
      window.__darkflowWorkspace.upsert(second);
    },
    [lifecycle, terminal] as const,
  );
  await page.evaluate(() => window.__darkflowWorkspace.remove("unknown-panel"));

  const malformed = await page.evaluate(
    ({ specs }) =>
      window.__darkflowWorkspace.restore({ version: 1, layout: { malformed: true } }, specs),
    { specs: [lifecycle, terminal] },
  );
  expect(malformed).toBe(false);
  await expect
    .poll(() => page.evaluate(() => window.__darkflowWorkspace.diagnostics()))
    .toMatchObject({
      liveRoots: emptyWorkspace.liveRoots,
      liveHosts: emptyWorkspace.liveHosts,
      subscriptions: emptyWorkspace.subscriptions,
      observers: emptyWorkspace.observers,
      listeners: emptyWorkspace.listeners,
      terminalIslands: emptyWorkspace.terminalIslands,
      ownedDom: emptyWorkspace.ownedDom,
    });
  expect(
    await page.evaluate((id) => window.__darkflowWorkspace.panel(id), lifecycle.id),
  ).toBeNull();

  const incompatible = await page.evaluate(
    (specs) =>
      window.__darkflowWorkspace.restore(
        { version: 2, layout: {} } as unknown as WorkspaceSnapshot,
        specs,
      ),
    [lifecycle],
  );
  expect(incompatible).toBe(false);

  await page.evaluate((panel) => window.__darkflowWorkspace.upsert(panel), {
    ...lifecycle,
    state: { value: "recovered" },
  });
  await expect(
    page.locator(`[data-panel-id="${lifecycle.id}"] [data-testid="lifecycle-state"]`),
  ).toContainText("recovered");

  const cycleStart = await page.evaluate(() => window.__darkflowWorkspace.diagnostics());
  for (let index = 0; index < 25; index += 1) {
    const id = `cycle-${index}`;
    await page.evaluate(
      (panel) => window.__darkflowWorkspace.upsert(panel),
      lifecyclePanel(id, id),
    );
    await page.evaluate((panelId) => window.__darkflowWorkspace.remove(panelId), id);
  }
  const cycleEnd = await page.evaluate(() => window.__darkflowWorkspace.diagnostics());
  expect(cycleEnd.mounts - cycleStart.mounts).toBe(25);
  expect(cycleEnd.unmounts - cycleStart.unmounts).toBe(25);
  expect(cycleEnd.duplicateDisposals).toBe(0);

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
  await expect(page.locator('[data-workspace-owned="true"]')).toHaveCount(0);
  await expect(page.getByTestId("workspace-host")).toBeEmpty();
  expect(await page.evaluate(() => window.__darkflowWorkspace.dispose())).toBeUndefined();

  const disposedErrors = await page.evaluate(
    async (panel) => {
      const errors: string[] = [];
      const capture = async (operation: () => unknown | Promise<unknown>) => {
        try {
          await operation();
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      };
      await capture(() => window.__darkflowWorkspace.upsert(panel));
      await capture(() => window.__darkflowWorkspace.remove(panel.id));
      await capture(() => window.__darkflowWorkspace.save());
      await capture(() => window.__darkflowWorkspace.restore({ version: 1, layout: {} }, [panel]));
      await capture(() => window.__darkflowWorkspace.move(panel.id, { kind: "grid" }));
      await capture(() => window.__darkflowWorkspace.resize(panel.id, { width: 100 }));
      return errors;
    },
    lifecyclePanel("after-dispose", "not-mounted"),
  );
  expect(disposedErrors).toHaveLength(6);
  expect(new Set(disposedErrors).size).toBe(1);
  expect(disposedErrors[0]).toMatch(/disposed/i);
});
