#!/usr/bin/env node
/**
 * Serves a built TrackDraft (`dist/`) as a static site — the portable-bundle
 * server, deliberately dependency-free so it runs on a machine where nothing
 * has been `npm install`ed.
 *
 * Why this exists: `vite preview` is the normal way to look at a build, but it
 * needs the repo's node_modules. Bundles get handed to a different MacBook,
 * so the server has to be plain Node (>=18) + the files themselves.
 *
 * It's a single-page app, so an unknown path without a file extension returns
 * index.html — otherwise a refresh on /song/<id>/workbench 404s.
 *
 * Usage:
 *   node serve.mjs                       # serve ./ on 5183
 *   node serve.mjs --port 5184           # different port
 *   node serve.mjs --dir dist            # serve a subdirectory
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const port = Number(arg("port", "5183"));
const root = resolve(arg("dir", "."));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

/** Resolves a URL path to a file inside `root`, or null if it escapes. */
function resolveInside(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

async function send(res, filePath) {
  const body = await readFile(filePath);
  res.writeHead(200, {
    "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    // No caching: this bundle is for iterating, and a stale asset after a
    // rebuild is far more confusing than a few extra reads.
    "cache-control": "no-store",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const urlPath = (req.url ?? "/") === "/" ? "/index.html" : (req.url ?? "/");
  const filePath = resolveInside(urlPath);

  if (!filePath) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      await send(res, join(filePath, "index.html"));
      return;
    }
    await send(res, filePath);
  } catch {
    // SPA fallback for route-like paths; a missing *asset* should stay a 404
    // so a broken build is visible instead of silently returning HTML.
    if (!extname(filePath)) {
      try {
        await send(res, join(root, "index.html"));
        return;
      } catch {
        // fall through
      }
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`TrackDraft running at http://localhost:${port}`);
  console.log(`  serving ${root}`);
  console.log("  Ctrl+C to stop.");
});
