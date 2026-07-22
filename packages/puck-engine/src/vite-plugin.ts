import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Inline Vite plugin that adds a `POST /api/save-sandbox` endpoint to the
 * dev server.  The received JSON body is written to `src/data/sandbox-layout.json`
 * resolved from the app's working directory.
 *
 * Usage in `vite.config.ts`:
 *
 * ```ts
 * import { vitePluginSaveSandboxLayout } from "@devkit/puck-engine";
 * export default defineConfig({
 *   plugins: [vitePluginSaveSandboxLayout(), react()],
 * });
 * ```
 */
export function vitePluginSaveSandboxLayout(): any {
  return {
    name: "puck-engine-save-sandbox",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url = req.url ?? "";
        const method = req.method ?? "GET";

        if (method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          res.end();
          return;
        }

        if (url === "/api/save-sandbox" && method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            try {
              const raw = Buffer.concat(chunks).toString("utf-8");
              const parsed = JSON.parse(raw);
              const targetPath = path.resolve(
                process.cwd(),
                "src",
                "data",
                "sandbox-layout.json",
              );
              fs.mkdirSync(path.dirname(targetPath), { recursive: true });
              fs.writeFileSync(targetPath, JSON.stringify(parsed, null, 2), "utf-8");
              console.log(
                `📝 Visual layout state serialized to ${path.relative(process.cwd(), targetPath)}`,
              );
              res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              });
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              res.writeHead(500, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              });
              res.end(
                JSON.stringify({
                  error: err instanceof Error ? err.message : "Unknown error",
                }),
              );
            }
          });
          return;
        }

        next();
      });
    },
  };
}