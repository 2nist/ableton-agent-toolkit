import * as fs from "node:fs";
import * as path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { vitePluginSaveSandboxLayout } from "@devkit/puck-engine";

const CATALOG_DIR = path.join(import.meta.dirname, "scripts", "output", "catalog");

/** Resolve absolute path to yt-dlp binary so execFile works regardless of PATH. */
function resolveYtDlpPath(): string {
  // Common install locations
  const candidates = [
    "/usr/local/bin/yt-dlp",
    "/opt/homebrew/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fallback — try `which yt-dlp`
  try {
    return execFileSync("which", ["yt-dlp"], { encoding: "utf8" }).trim();
  } catch {
    // Last resort — return bare name and let execFile fail with a clear error
    return "yt-dlp";
  }
}

const YT_DLP_PATH = resolveYtDlpPath();

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
    case ".musicxml":
    case ".xml":
      return { category: "musicxml", loadable: true };
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

        // Catch async error events on response — these kill the process if unhandled.
        res.on("error", () => {});

        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

        // Download native m4a audio (no ffmpeg dependency).
        // -f "bestaudio[ext=m4a]/bestaudio/best": prefer native m4a, fall back to best audio
        // -o -: output to stdout
        const proc = execFile(YT_DLP_PATH, [
          "-f", "bestaudio[ext=m4a]/bestaudio/best",
          "-o", "-",
          "--no-playlist",
          ytUrl,
        ], {
          encoding: null, // Node v24+: force raw Buffer on stdout
          timeout: 120_000, // 2 minute timeout for download
          maxBuffer: 200 * 1024 * 1024, // 200MB max buffer
        });

        const chunks: Buffer[] = [];
        proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
        let stderr = "";

        proc.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("error", (err) => {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: `yt-dlp error: ${err.message}` }));
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
          res.setHeader("Content-Type", "audio/mp4");
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

        // SSE streaming for progress updates.
        // Wrap send() so a disconnected client never crashes the server.
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        let streamClosed = false;
        req.on("close", () => { streamClosed = true; });
        // Catch async error events on response — these kill the process if unhandled.
        res.on("error", () => { streamClosed = true; });

        const sendSafe = (event: string, data: Record<string, unknown>) => {
          if (streamClosed) return;
          try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          } catch {
            streamClosed = true;
          }
        };

        const endSafe = () => {
          if (!streamClosed) {
            try { res.end(); } catch { /* stream already gone */ }
            streamClosed = true;
          }
        };

        try {
          // Step 1: Fetch YouTube metadata
          sendSafe("progress", { step: "metadata", message: "Fetching YouTube metadata…" });
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
          const oembedRes = await fetch(oembedUrl);
          if (!oembedRes.ok) {
            sendSafe("error", { error: "Video not found or unavailable" });
            endSafe();
            return;
          }
          const oembed = await oembedRes.json() as { title: string; author_name: string };
          sendSafe("progress", { step: "metadata", message: `Found: "${oembed.title}" by ${oembed.author_name}`, title: oembed.title, artist: oembed.author_name });

          // Step 2: Download audio via yt-dlp
          sendSafe("progress", { step: "download", message: "Downloading audio…" });
          const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
            const proc = execFile(YT_DLP_PATH, [
              "-f", "bestaudio[ext=m4a]/bestaudio/best",
              "-o", "-",
              "--no-playlist",
              ytUrl,
            ], { encoding: null, timeout: 120_000, maxBuffer: 200 * 1024 * 1024 });

            const parts: Buffer[] = [];
            let stderr = "";
            proc.stdout?.on("data", (chunk: Buffer) => parts.push(chunk));
            proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
            proc.on("error", (err) => reject(new Error(`yt-dlp error: ${err.message}`)));
            proc.on("close", (code) => {
              if (code !== 0) {
                const tail = stderr.split("\n").slice(-3).join("; ").slice(0, 300);
                reject(new Error(`yt-dlp exited with code ${code}${tail ? `: ${tail}` : ""}`));
              } else {
                const buf = Buffer.concat(parts);
                if (buf.length === 0) reject(new Error("Download produced empty audio"));
                else resolve(buf);
              }
            });
          });
          sendSafe("progress", { step: "download", message: `Audio downloaded (${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB as m4a)` });

          // Step 2.5: Convert m4a → wav via ffmpeg (ChordMiniApp often can't handle m4a)
          sendSafe("progress", { step: "convert", message: "Converting to WAV for ChordMiniApp…" });
          let audioForAnalysis = audioBuffer;
          try {
            audioForAnalysis = await new Promise<Buffer>((resolve, reject) => {
              const ffmpegProc = execFile("ffmpeg", [
                "-i", "pipe:0",   // read from stdin
                "-f", "wav",       // force WAV output
                "-ar", "44100",    // 44.1kHz sample rate
                "-ac", "1",        // mono
                "pipe:1",          // output to stdout
              ], { encoding: null, timeout: 60_000, maxBuffer: 500 * 1024 * 1024 });

              const parts: Buffer[] = [];
              ffmpegProc.stdout?.on("data", (chunk: Buffer) => parts.push(chunk));
              let ffStderr = "";
              ffmpegProc.stderr?.on("data", (data: Buffer) => { ffStderr += data.toString(); });
              ffmpegProc.on("error", (err) => reject(new Error(`ffmpeg error: ${err.message}`)));
              ffmpegProc.on("close", (code) => {
                if (code !== 0) {
                  console.error(`[youtube-full-import] ffmpeg conversion failed (code ${code}), falling back to raw m4a. stderr: ${ffStderr.slice(0, 200)}`);
                  resolve(audioBuffer); // fall back to raw m4a
                } else {
                  const wav = Buffer.concat(parts);
                  console.error(`[youtube-full-import] ffmpeg: m4a=${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB → wav=${(wav.length / 1024 / 1024).toFixed(1)}MB`);
                  resolve(wav);
                }
              });
              // Pipe m4a to ffmpeg stdin
              ffmpegProc.stdin?.write(audioBuffer);
              ffmpegProc.stdin?.end();
            });
          } catch {
            console.error("[youtube-full-import] ffmpeg unavailable, sending raw m4a to ChordMiniApp");
          }
          sendSafe("progress", { step: "convert", message: `Ready for analysis (${(audioForAnalysis.length / 1024 / 1024).toFixed(1)} MB WAV)` });

          // Step 3: ChordMiniApp analysis
          sendSafe("progress", { step: "analyze", message: "Analyzing with ChordMiniApp…" });
          const CHORDMINI_URL = process.env.CHORDMINI_URL ?? "http://localhost:5000/analyze";
          let chordMiniData: Record<string, unknown>;
          try {
            const analyzeRes = await fetch(CHORDMINI_URL, {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: audioForAnalysis,
            });
            if (!analyzeRes.ok) {
              sendSafe("error", { error: `ChordMiniApp returned ${analyzeRes.status}. Make sure the Python server is running.` });
              endSafe();
              return;
            }
            chordMiniData = await analyzeRes.json();
            // Diagnostic: log raw ChordMiniApp response to server console
            const chordCount = Array.isArray(chordMiniData.chords) ? chordMiniData.chords.length : 0;
            const segmentCount = Array.isArray(chordMiniData.segments) ? chordMiniData.segments.length : 0;
            console.error(`[youtube-full-import] ChordMiniApp raw: key=${chordMiniData.key}, bpm=${chordMiniData.bpm}, scale=${chordMiniData.scale}, chords=${chordCount}, segments=${segmentCount}`);
            if (chordCount === 0 && segmentCount === 0) {
              console.error(`[youtube-full-import] WARNING: ChordMiniApp returned empty analysis. Audio buffer size: ${audioBuffer.length} bytes (${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB). Check that the audio format is supported by ChordMiniApp.`);
            }
          } catch {
            sendSafe("error", { error: "Could not reach ChordMiniApp at " + (process.env.CHORDMINI_URL ?? "localhost:5000") });
            endSafe();
            return;
          }

          const chordCount = Array.isArray(chordMiniData.chords) ? chordMiniData.chords.length : 0;
          const segmentCount = Array.isArray(chordMiniData.segments) ? chordMiniData.segments.length : 0;
          sendSafe("progress", {
            step: "analyze",
            message: `Analysis complete: ${chordCount} chords, ${segmentCount} segments, key: ${chordMiniData.key ?? "?"}, BPM: ${chordMiniData.bpm ?? "?"}`,
            ...chordMiniData,
          });

          // Step 4: LRCLIB lyrics
          sendSafe("progress", { step: "lyrics", message: "Searching for synced lyrics…" });
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
                sendSafe("progress", { step: "lyrics", message: "Synced lyrics found" });
              } else if (results.length > 0) {
                lrclibData = results[0];
                sendSafe("progress", { step: "lyrics", message: "Plain lyrics found (no timestamps)" });
              } else {
                sendSafe("progress", { step: "lyrics", message: "No lyrics found on LRCLIB" });
              }
            }
          } catch {
            sendSafe("progress", { step: "lyrics", message: "LRCLIB search failed (network?)" });
          }

          // Step 5: Assemble complete BlueprintSong
          sendSafe("progress", { step: "assemble", message: "Building song blueprint…" });

          // Send the final result with all pieces
          sendSafe("result", {
            title: oembed.title,
            artist: oembed.author_name,
            chordMiniData,
            lrclibData,
          });

          endSafe();
        } catch (err) {
          sendSafe("error", { error: err instanceof Error ? err.message : "Import failed" });
          endSafe();
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