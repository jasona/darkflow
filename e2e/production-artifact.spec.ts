import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

interface RuntimeFixtures {
  runtimeErrors: string[];
}

interface ResourceProbe {
  body: string;
  cacheControl: string;
  contentType: string;
  status: number;
}

const appOrigin = "http://127.0.0.1:3124";
const packageMetadata = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { version: string };

const test = base.extend<RuntimeFixtures>({
  runtimeErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).origin !== appOrigin) return;
      errors.push(`request: ${request.url()} (${request.failure()?.errorText ?? "failed"})`);
    });
    await use(errors);
    expect(errors).toEqual([]);
  },
});

async function probe(page: Page, resourcePath: string): Promise<ResourceProbe> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    return {
      body: await response.text(),
      cacheControl: response.headers.get("cache-control") ?? "",
      contentType: response.headers.get("content-type") ?? "",
      status: response.status,
    };
  }, resourcePath);
}

async function expectResource(
  page: Page,
  resourcePath: string,
  contentType: RegExp,
): Promise<ResourceProbe> {
  const response = await probe(page, resourcePath);
  expect(response.status, resourcePath).toBe(200);
  expect(response.contentType, resourcePath).toMatch(contentType);
  return response;
}

test("built artifact renders the legacy client and preserves production contracts", async ({
  page,
  runtimeErrors,
}) => {
  void runtimeErrors;
  await page.addInitScript(() => {
    const attempts: string[] = [];
    Object.defineProperty(window, "__darkflowWebSocketAttempts", { value: attempts });
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(_target, args) {
        attempts.push(String(args[0]));
        throw new Error("Production artifact smoke must not connect to a live MUD");
      },
    });
  });

  await page.goto("/");

  await expect(page).toHaveTitle("Darkflow");
  await expect(page.locator("#toolbar")).toBeVisible();
  await expect(page.locator("#toolbar-brand")).toContainText("Darkflow");
  await expect(page.getByLabel("Terminal output", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Command input")).toBeVisible();
  await expect(page.getByLabel("Host")).toBeVisible();
  await expect(page.getByLabel("Port")).toBeVisible();
  await expect(page.getByLabel("Connection protocol")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __darkflowPhase1Bootstrap?: { phase: string } })
            .__darkflowPhase1Bootstrap?.phase,
      ),
    )
    .toBe("legacy-loaded");

  const controllerDiagnostics = await page.evaluate(() =>
    (
      window as unknown as {
        __darkflowPhase1ControllerBridge?: {
          getControllerDiagnostics(): {
            activeControllers: number;
            session: { liveSubscriptions: number };
          };
        };
      }
    ).__darkflowPhase1ControllerBridge?.getControllerDiagnostics(),
  );
  expect(controllerDiagnostics?.activeControllers).toBe(22);
  expect(controllerDiagnostics?.session.liveSubscriptions).toBeGreaterThanOrEqual(109);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const runtime = window as unknown as Record<string, unknown>;
        return {
          howl: typeof runtime.Howl,
          howler: typeof runtime.Howler,
        };
      }),
    )
    .toEqual({ howl: "function", howler: "object" });

  const rootHtml = await page.content();
  expect(rootHtml).not.toMatch(/\/js\/app\.js/);
  expect(rootHtml).not.toMatch(/\.ts["']/);
  const rootBundle = rootHtml.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  expect(rootBundle, "index.html must reference a generated JavaScript bundle").toBeTruthy();
  expect(rootBundle).not.toMatch(/phase0-/);
  await expectResource(page, rootBundle!, /^(?:text|application)\/javascript\b/);

  const config = await expectResource(page, "/config.json", /^application\/json\b/);
  expect(JSON.parse(config.body)).toMatchObject({ host: "" });

  const version = await expectResource(page, "/api/version", /^application\/json\b/);
  expect(version.cacheControl).toMatch(/no-store/);
  expect(JSON.parse(version.body)).toEqual({ version: packageMetadata.version });

  const ping = await probe(page, "/ping");
  expect(ping.status).toBe(204);
  expect(ping.cacheControl).toMatch(/no-store/);

  await expectResource(page, "/site.webmanifest", /^application\/manifest\+json\b/);
  await expectResource(page, "/css/main.css", /^text\/css\b/);
  await expectResource(page, "/js/app.js", /^(?:text|application)\/javascript\b/);
  await expectResource(page, "/vendor/howler.core.min.js", /^(?:text|application)\/javascript\b/);
  await expectResource(page, "/assets/brand/darkflow-icon-32.png", /^image\/png\b/);
  await expectResource(page, "/assets/sounds/alert-ping.mp3", /^audio\/mpeg\b/);
  await expectResource(page, "/phase0/", /^text\/html\b/);

  expect((await page.request.get(`${appOrigin}/phase0/main.ts`)).status()).toBe(404);
  expect((await page.request.get(`${appOrigin}/app/bootstrap.ts`)).status()).toBe(404);
  expect((await page.request.get(`${appOrigin}/@vite/client`)).status()).toBe(404);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __darkflowWebSocketAttempts: string[] })
          .__darkflowWebSocketAttempts,
    ),
  ).toEqual([]);
});
