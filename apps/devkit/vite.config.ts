import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { vitePluginSaveSandboxLayout } from "@devkit/puck-engine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GENERATED_REGISTRY = path.resolve(__dirname, "src/lib/componentRegistry.generated.ts");
const SANDBOX_LAYOUT = path.resolve(__dirname, "src/data/sandbox-layout.json");
const TRACKDRAFT_SRC = path.resolve(__dirname, "../trackdraft/src");

// ── Option A: Vite middleware REST API ────────────────────────────────────
function devkitApiPlugin(): Plugin {
  return {
    name: "devkit-api",
    configureServer(server) {
      // Read the generated registry file once and parse out the array
      function loadRegistry(): Record<string, unknown>[] | null {
        try {
          const src = fs.readFileSync(GENERATED_REGISTRY, "utf-8");
          // Extract the array from "const registry: ComponentEntry[] = [...]"
          const match = src.match(/const registry[^=]*=\s*(\[[\s\S]*?\]);/);
          if (!match) return null;
          // Use Function to safely evaluate the array literal
          const fn = new Function(`return ${match[1]}`);
          return fn() as Record<string, unknown>[];
        } catch {
          return null;
        }
      }

      function loadGraph(): { nodes: unknown[]; edges: unknown[] } | null {
        const registry = loadRegistry();
        if (!registry) return null;

        const nodes = registry.map((c) => ({
          id: c.name,
          type: "default",
          data: {
            label: c.name,
            category: c.category,
            description: c.description,
          },
        }));

        const nameSet = new Set(registry.map((c) => c.name as string));
        const edges: unknown[] = [];
        for (const c of registry) {
          for (const dep of (c.deps as string[]) ?? []) {
            if (nameSet.has(dep)) {
              edges.push({ source: dep, target: c.name, id: `${dep}→${c.name}` });
            }
          }
        }

        return { nodes, edges };
      }

      function getComponentSource(name: string): string | null {
        const registry = loadRegistry();
        if (!registry) return null;
        const entry = registry.find((c) => c.name === name);
        if (!entry) return null;
        try {
          const filePath = path.join(TRACKDRAFT_SRC, (entry.path as string) + ".tsx");
          return fs.readFileSync(filePath, "utf-8");
        } catch {
          return null;
        }
      }

      function sendJson(res: ServerResponse, data: unknown, status = 200) {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(data));
      }

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        const method = req.method ?? "GET";

        // CORS preflight
        if (method === "OPTIONS") {
          res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
          res.end();
          return;
        }

        // GET /api/health
        if (url === "/api/health") {
          return sendJson(res, { ok: true, timestamp: Date.now() });
        }

        // GET /api/registry
        if (url === "/api/registry") {
          const registry = loadRegistry();
          if (!registry) return sendJson(res, { error: "Registry not found. Run generate first." }, 500);
          return sendJson(res, registry);
        }

        // GET /api/graph
        if (url === "/api/graph") {
          const graph = loadGraph();
          if (!graph) return sendJson(res, { error: "Graph not available." }, 500);
          return sendJson(res, graph);
        }

        // GET /api/component/:name
        const compMatch = url.match(/^\/api\/component\/([^/]+)$/);
        if (compMatch) {
          const name = decodeURIComponent(compMatch[1]);
          const source = getComponentSource(name);
          if (!source) return sendJson(res, { error: `Component "${name}" not found.` }, 404);

          const registry = loadRegistry();
          const entry = registry?.find((c) => c.name === name);

          return sendJson(res, {
            name,
            path: entry?.path,
            category: entry?.category,
            description: entry?.description,
            deps: entry?.deps,
            source,
          });
        }

        // GET /api/component/:name/source (raw source only)
        const srcMatch = url.match(/^\/api\/component\/([^/]+)\/source$/);
        if (srcMatch) {
          const name = decodeURIComponent(srcMatch[1]);
          const source = getComponentSource(name);
          if (!source) return sendJson(res, { error: `Component "${name}" not found.` }, 404);
          res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
          res.end(source);
          return;
        }

        // POST /api/save-sandbox — persist Puck visual layout state
        if (url === "/api/save-sandbox" && method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            try {
              const raw = Buffer.concat(chunks).toString("utf-8");
              const parsed = JSON.parse(raw);
              fs.mkdirSync(path.dirname(SANDBOX_LAYOUT), { recursive: true });
              fs.writeFileSync(SANDBOX_LAYOUT, JSON.stringify(parsed, null, 2), "utf-8");
              console.log("📝 Visual layout state successfully serialized to src/data/sandbox-layout.json");
              return sendJson(res, { success: true });
            } catch (err) {
              return sendJson(res, { error: err instanceof Error ? err.message : "Unknown error" }, 500);
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  // @ts-expect-error vite version mismatch between workspace root and devkit — fine at runtime
  plugins: [devkitApiPlugin(), react()],
  server: {
    port: 5199,
  },
  resolve: {
    alias: {
      "@trackdraft": TRACKDRAFT_SRC,
    },
  },
});