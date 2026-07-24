import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
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
            let title = file;
            let sections = 0;
            if (info.category === "blueprint") {
              try {
                const raw = fs.readFileSync(fullPath, "utf8");
                const song = JSON.parse(raw);
                title = (song.title as string) ?? file;
                sections = Array.isArray(song.sections) ? song.sections.length : 0;
              } catch { /* keep filename */ }
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
          res.end(JSON.stringify({ title: oembed.title, artist: oembed.author_name, videoId }));
        } catch {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Failed to fetch YouTube metadata" }));
        }
      });
    },
  };
}

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
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        const bodyBuffer = Buffer.concat(chunks);
        const CHORDMINI_URL = process.env.CHORDMINI_URL ?? "http://localhost:5000/analyze";

        try {
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

/**
 * YouTube audio download endpoint — wraps yt-dlp to extract audio from a
 * YouTube video and return it as raw bytes. Runs only under `vite dev`.
 */
function youtubeDownloadPlugin(): Plugin {
  return {
    name: "youtube-download-dev-endpoint",
    configureServer(server) {
      server.middlewares.use("/__youtube-download", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const videoId = url.searchParams.get("videoId") ?? "";
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid video ID" }));
          return;
        }

        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

        // Spawn yt-dlp: download best audio, convert to mp3, pipe to stdout
        // -f bestaudio: best audio-only format
        // --extract-audio --audio-format mp3: convert to mp3
        // --audio-quality 192k: good quality without massive files
        // -o -: output to stdout
        const proc = execFile("yt-dlp", [
          "-f", "bestaudio",
          "--extract-audio",
          "--audio-format", "mp3",
          "--audio-quality", "192k",
          "-o", "-",
          "--no-playlist",
          ytUrl,
        ], {
          timeout: 120_000, // 2 minute timeout for download
          maxBuffer: 200 * 1024 * 1024, // 200MB max buffer
        });

        const chunks: Buffer[] = [];
        proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
        let stderr = "";

        proc.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("error", () => {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: "yt-dlp not found. Install it: brew install yt-dlp",
          }));
        });

        proc.on("close", (code) => {
          if (code !== 0) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: `yt-dlp exited with code ${code}: ${stderr.slice(0, 200)}` }));
            return;
          }
          const audio = Buffer.concat(chunks);
          if (audio.length === 0) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Download produced empty audio" }));
            return;
          }
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Content-Length", audio.length.toString());
          res.end(audio);
        });
      });
    },
  };
}

/**
 * One-click YouTube → full BlueprintSong import.
 *
 * Orchestrates: metadata → audio download → ChordMiniApp analysis →
 * LRCLIB lyrics → BlueprintSong assembly. The browser sends a video ID
 * and receives a complete BlueprintSong JSON ready for `importSong()`.
 * Each step is streamed as SSE progress events so the browser can show
 * real-time status.
 */
function youtubeFullImportPlugin(): Plugin {
  return {
    name: "youtube-full-import-endpoint",
    configureServer(server) {
      server.middlewares.use("/__youtube-full-import", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        // Read videoId from JSON body
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        let videoId: string;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          videoId = body.videoId;
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Expected JSON body with videoId" }));
          return;
        }

        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid video ID" }));
          return;
        }

        // SSE streaming for progress updates
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const send = (event: string, data: Record<string, unknown>) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
          // Step 1: Fetch YouTube metadata
          send("progress", { step: "metadata", message: "Fetching YouTube metadata…" });
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
          const oembedRes = await fetch(oembedUrl);
          if (!oembedRes.ok) {
            send("error", { error: "Video not found or unavailable" });
            res.end();
            return;
          }
          const oembed = await oembedRes.json() as { title: string; author_name: string };
          send("progress", { step: "metadata", message: `Found: "${oembed.title}" by ${oembed.author_name}`, title: oembed.title, artist: oembed.author_name });

          // Step 2: Download audio via yt-dlp (reuse the download endpoint logic)
          send("progress", { step: "download", message: "Downloading audio…" });
          const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
            const proc = execFile("yt-dlp", [
              "-f", "bestaudio",
              "--extract-audio",
              "--audio-format", "mp3",
              "--audio-quality", "192k",
              "-o", "-",
              "--no-playlist",
              ytUrl,
            ], { timeout: 120_000, maxBuffer: 200 * 1024 * 1024 });

            const parts: Buffer[] = [];
            proc.stdout?.on("data", (chunk: Buffer) => parts.push(chunk));
            proc.on("error", () => reject(new Error("yt-dlp not found. Install: brew install yt-dlp")));
            proc.on("close", (code) => {
              if (code !== 0) {
                reject(new Error(`yt-dlp exited with code ${code}`));
              } else {
                const buf = Buffer.concat(parts);
                if (buf.length === 0) reject(new Error("Download produced empty audio"));
                else resolve(buf);
              }
            });
          });
          send("progress", { step: "download", message: `Audio downloaded (${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB)` });

          // Step 3: ChordMiniApp analysis
          send("progress", { step: "analyze", message: "Analyzing with ChordMiniApp…" });
          const CHORDMINI_URL = process.env.CHORDMINI_URL ?? "http://localhost:5000/analyze";
          let chordMiniData: Record<string, unknown>;
          try {
            const analyzeRes = await fetch(CHORDMINI_URL, {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: audioBuffer,
            });
            if (!analyzeRes.ok) {
              send("error", { error: `ChordMiniApp returned ${analyzeRes.status}. Make sure the Python server is running.` });
              res.end();
              return;
            }
            chordMiniData = await analyzeRes.json();
          } catch {
            send("error", { error: "Could not reach ChordMiniApp at " + (process.env.CHORDMINI_URL ?? "localhost:5000") });
            res.end();
            return;
          }

          const chordCount = Array.isArray(chordMiniData.chords) ? chordMiniData.chords.length : 0;
          const segmentCount = Array.isArray(chordMiniData.segments) ? chordMiniData.segments.length : 0;
          send("progress", {
            step: "analyze",
            message: `Analysis complete: ${chordCount} chords, ${segmentCount} segments, key: ${chordMiniData.key ?? "?"}, BPM: ${chordMiniData.bpm ?? "?"}`,
            ...chordMiniData,
          });

          // Step 4: LRCLIB lyrics
          send("progress", { step: "lyrics", message: "Searching for synced lyrics…" });
          let lrclibData: Record<string, unknown> | null = null;
          try {
            const lrclibParams = new URLSearchParams({ track_name: oembed.title });
            if (oembed.author_name) lrclibParams.set("artist_name", oembed.author_name);
            const lrclibRes = await fetch(`https://lrclib.net/api/search?${lrclibParams}`);
            if (lrclibRes.ok) {
              const results = await lrclibRes.json() as Array<Record<string, unknown>>;
              const synced = results.find((r) => r.syncedLyrics);
              if (synced) {
                lrclibData = synced;
                send("progress", { step: "lyrics", message: "Synced lyrics found" });
              } else if (results.length > 0) {
                lrclibData = results[0];
                send("progress", { step: "lyrics", message: "Plain lyrics found (no timestamps)" });
              } else {
                send("progress", { step: "lyrics", message: "No lyrics found on LRCLIB" });
              }
            }
          } catch {
            send("progress", { step: "lyrics", message: "LRCLIB search failed (network?)" });
          }

          // Step 5: Assemble complete BlueprintSong
          send("progress", { step: "assemble", message: "Building song blueprint…" });

          // Send the final result with all pieces
          send("result", {
            title: oembed.title,
            artist: oembed.author_name,
            chordMiniData,
            lrclibData,
          });

          res.end();
        } catch (err) {
          send("error", { error: err instanceof Error ? err.message : "Import failed" });
          res.end();
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
    youtubeDownloadPlugin(),
    youtubeFullImportPlugin(),
  ],
  server: {
    port: 5183,
  },
});