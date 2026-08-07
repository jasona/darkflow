const fs = require("fs");
const path = require("path");

/** Attaches Vite middleware and HMR to Darkflow's existing HTTP server. */
async function attachDevClient({ app, server, root }) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: path.join(root, "vite.config.ts"),
    appType: "custom",
    logLevel: process.env.DARKFLOW_VITE_LOG || "info",
    server: {
      middlewareMode: true,
      ws: { server },
      watch:
        process.env.DARKFLOW_VITE_POLL === "1"
          ? { usePolling: true }
          : undefined,
    },
  });

  if (vite.config.base !== "/") {
    await vite.close();
    throw new Error(
      `Vite shared-origin HMR requires base "/", received "${vite.config.base}"`,
    );
  }

  app.use(vite.middlewares);
  app.get(["/phase0/", "/phase0/index.html"], async (req, res, next) => {
    try {
      const file = path.join(root, "client", "phase0", "index.html");
      const html = await vite.transformIndexHtml(
        "/phase0/index.html",
        await fs.promises.readFile(file, "utf8"),
      );
      res.set("Cache-Control", "no-store").type("html").send(html);
    } catch (error) {
      vite.ssrFixStacktrace?.(error);
      next(error);
    }
  });

  return {
    close: () => vite.close(),
    claimsUpgrade(req) {
      const protocol = req.headers["sec-websocket-protocol"];
      const { pathname } = new URL(req.url, "http://localhost");
      return (
        (protocol === "vite-hmr" || protocol === "vite-ping") &&
        pathname === vite.config.base
      );
    },
    viteServer: vite,
  };
}

module.exports = { attachDevClient };
