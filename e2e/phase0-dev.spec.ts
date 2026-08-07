import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(
  root,
  "client",
  "phase0",
  "hmr-protocol-fixture.ts",
);

test("phase 0 harness renders the Typia proof", async ({ page }) => {
  await page.goto("/phase0/");
  await expect(
    page.getByRole("heading", { name: "Darkflow Phase 0 harness" }),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="typia-proof"][data-typia-ok="true"]'),
  ).toBeVisible();
});

test("legacy root renders its client shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#toolbar")).toBeVisible();
});

test("protocol validator HMR preserves window state", async ({ page }) => {
  const originalFixture = await fs.readFile(fixturePath, "utf8");
  try {
    await page.goto("/phase0/");
    const probe = page.getByTestId("hmr-probe");
    await expect(probe).toHaveText("true");
    await page.evaluate(() => {
      (window as unknown as Record<string, string>).__hmrSentinel = "alive";
    });
    await fs.writeFile(
      fixturePath,
      originalFixture.replace("id: number", "id: string"),
    );
    await expect(probe).toHaveText("false");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as Record<string, string>).__hmrSentinel,
        ),
      )
      .toBe("alive");
  } finally {
    await fs.writeFile(fixturePath, originalFixture);
    await expect(page.getByTestId("hmr-probe")).toHaveText("true");
  }
});
