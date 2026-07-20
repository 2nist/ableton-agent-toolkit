import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { vitePluginSaveSandboxLayout } from "@devkit/puck-engine";

const CATALOG_DIR = path.join(import.meta.dirname, "scripts", "output", "catalog");

/**
 * Dev-only review affordance: exposes the real catalog data (179 songs,
 * gitignored build output from the JCRD+lyrics ingestion pipeline) so
 * `CatalogBrowser` can list and one-click-import them, instead of the
 * native file picker's one-at-a-time friction. `configureServer` only
 * runs under `vite dev` — Vite never calls it during `vite build`, so
 * this has no production footprint at all.
 */
function catalogBrowserPlugin(): Plugin {
  return {
    name: "catalog-browser-dev-endpoint",
    configureServer(server) {
      server.middlewares.use("/__catalog/index", (_req, res) => {
        if (!fs.existsSync(CATALOG_DIR)) {
          res.setHeader("Content-Type", "application/json");
          res.end("[]");
          return;
        }
        const files = fs.readdirSync(CATALOG_DIR).filter((f) => f.endsWith(".json")).sort();
        const index = files.map((file) => {
          const song = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, file), "utf8"));
          return { file, title: song.title as string, sections: (song.sections as unknown[]).length };
        });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(index));
      });

      server.middlewares.use("/__catalog/file", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const file = url.searchParams.get("name") ?? "";
        // Reject anything that isn't a bare filename -- no traversal
        // outside CATALOG_DIR via "../" or an absolute path.
        if (!file || file.includes("/") || file.includes("..")) {
          res.statusCode = 400;
          res.end("invalid file name");
          return;
        }
        const filePath = path.join(CATALOG_DIR, file);
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(fs.readFileSync(filePath, "utf8"));
      });
    },
  };
}

export default defineConfig({
  plugins: [vitePluginSaveSandboxLayout(), react(), catalogBrowserPlugin()],
  server: {
    port: 5183,
  },
});
