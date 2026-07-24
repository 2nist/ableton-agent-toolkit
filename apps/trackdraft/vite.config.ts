import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { vitePluginSaveSandboxLayout } from "@devkit/puck-engine";

const CATALOG_DIR = path.join(import.meta.dirname, "scripts", "output", "catalog");

function fileTypeInfo(file: string): { category: string; loadable: boolean } {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".json":
      return { category: "blueprint", loadable: true };
    case ".jcrd":
      return { category: "jcrd", loadable: true };
    case ".mp3":
    case ".wav":
    case ".aif":
    case ".aiff":
    case ".flac":
    case ".ogg":
      return { category: "audio", loadable: true };
    case ".mid":
    case ".midi":
      return { category: "midi", loadable: true };
    case ".txt":
    case ".lrc":
    case ".md":
      return { category: "lyrics", loadable: true };
    case ".als":
    case ".ablx":
      return { category: "ableton", loadable: false };
    default:
      return { category: "unknown", loadable: false };
  }
}

/**
 * Dev-only local directory browser. Resolves paths relative to the project
 * root (for shorthand like `scripts/output`) OR accepts absolute paths
 * (for external dirs like `/Users/.../Mcgill Dir`). The user explicitly
 * configures these paths, so no allowlist is needed in dev mode.
 */
function localDirPlugin(): Plugin {
  return {
    name: "local-dir-dev-endpoint",
    configureServer(server) {
      server.middlewares.use("/__local-browse", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const dirParam = url.searchParams.get("dir") ?? "";
        if (!dirParam) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Missing 'dir' parameter" }));
          return;
        }
        // If the param looks like an absolute path, use it directly.
        // Otherwise resolve relative to project root.
        const resolved = path.isAbsolute(dirParam)
          ? dirParam
          : path.resolve(import.meta.dirname, dirParam);

        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: `Directory not found: ${dirParam}` }));
          return;
        }
        try {
          const entries = fs.readdirSync(resolved)
            .filter((f) => !f.startsWith("."))
            .sort();
          const index = entries.map((file) => {
            const fullPath = path.join(resolved, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              return { file, title: file, sections: 0, type: "directory", loadable: false };
            }
            const info = fileTypeInfo(file);
            // Read title from JSON files
            let title = file;
            let sections = 0;
            if (info.category === "blueprint") {
              try {
                const raw = fs.readFileSync(fullPath, "utf8");
                const song = JSON.parse(raw);
                title = (song.title as string) ?? file;
                sections = Array.isArray(song.sections) ? song.sections.length : 0;
              } catch { /* keep filename as title */ }
            }
            return { file, title, sections, type: info.category, loadable: info.loadable };
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(index));
        } catch {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Failed to read directory" }));
        }
      });

      // Serve a single file — JSON gets parsed as text, binary files served raw
      server.middlewares.use("/__local-file", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const dirParam = url.searchParams.get("dir") ?? "";
        const fileParam = url.searchParams.get("file") ?? "";
        if (!dirParam || !fileParam || fileParam.includes("/") || fileParam.includes("..")) {
          res.statusCode = 400;
          res.end("invalid parameters");
          return;
        }
        const resolved = path.isAbsolute(dirParam)
          ? dirParam
          : path.resolve(import.meta.dirname, dirParam);
        const filePath = path.join(resolved, fileParam);
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        if (ext === ".json") {
          res.setHeader("Content-Type", "application/json");
          res.end(fs.readFileSync(filePath, "utf8"));
        } else if ([".mp3", ".wav", ".aif", ".aiff", ".flac", ".ogg"].includes(ext)) {
          res.setHeader("Content-Type", "audio/mpeg");
          res.end(fs.readFileSync(filePath));
        } else if ([".mid", ".midi"].includes(ext)) {
          res.setHeader("Content-Type", "audio/midi");
          res.end(fs.readFileSync(filePath));
        } else {
          res.setHeader("Content-Type", "text/plain");
          res.end(fs.readFileSync(filePath, "utf8"));
        }
      });
    },
  };
}

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

/**
 * YouTube metadata proxy. Uses YouTube's oEmbed endpoint (no API key needed)
 * to fetch video title and author from a video ID. Runs only under `vite dev`.
 */
function youtubePlugin(): Plugin {
  return {
    name: "youtube-meta-dev-endpoint",
    configureServer(server) {
      server.middlewares.use("/__youtube-meta", async (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const videoId = url.searchParams.get("videoId") ?? "";
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid video ID" }));
          return;
        }
        try {
          // YouTube oEmbed — publicly accessible, no API key required
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
          const oembedRes = await fetch(oembedUrl);
          if (!oembedRes.ok) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Video not found or unavailable" }));
            return;
          }
          const oembed = await oembedRes.json() as { title: string; author_name: string };
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              title: oembed.title,
              artist: oembed.author_name,
              videoId,
            }),
          );
        } catch {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Failed to fetch YouTube metadata" }));
        }
      });
    },
  };
}

/**
 * ChordMiniApp proxy — accepts an audio file upload from the browser,
 * proxies it to the Python ChordMiniApp server, and returns a BlueprintSong
 * JSON ready for import. Only runs under `vite dev`.
 */
function chordMiniAppPlugin(): Plugin {
  return {
    name: "chordmini-proxy-dev-endpoint",
    configureServer(server) {
      server.middlewares.use("/__chordmini-analyze", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        // Read the raw request body (multipart or binary audio)
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        const bodyBuffer = Buffer.concat(chunks);

        const CHORDMINI_URL = process.env.CHORDMINI_URL ?? "http://localhost:5000/analyze";

        try {
          // Proxy to ChordMiniApp Python server
          const proxyRes = await fetch(CHORDMINI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: bodyBuffer,
          });

          if (!proxyRes.ok) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: `ChordMiniApp returned ${proxyRes.status}` }));
            return;
          }

          const json = await proxyRes.json();
          // Return the raw analysis JSON — the browser will convert it to BlueprintSong
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(json));
        } catch {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: "Could not reach ChordMiniApp. Make sure the Python server is running at " +
              (process.env.CHORDMINI_URL ?? "localhost:5000"),
          }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    vitePluginSaveSandboxLayout(),
    react(),
    localDirPlugin(),
    catalogBrowserPlugin(),
    youtubePlugin(),
    chordMiniAppPlugin(),
  ],
  server: {
    port: 5183,
  },
});