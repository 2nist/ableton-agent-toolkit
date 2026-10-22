import express from "express";
import osc from "osc";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  claimOldestCommand,
  createCommandWaker,
  writeCommandFile,
  type QueuedCommand,
} from "./commandQueue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = Number(process.env.TELEMETRY_PORT ?? 5200);
const OSC_IN_PORT = process.env.OSC_IN_PORT || 6000;
// Loopback by default: both the REST command routes and the WebSocket relay
// can drive Live, so LAN exposure is opt-in (`start-all.sh lan` sets
// BRIDGE_HOST=0.0.0.0).
const HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const LAN_EXPOSED = HOST !== "127.0.0.1" && HOST !== "localhost";
// Matches the trackdraft-bridge extension's storageDirectory so "Send to
// Ableton" writes to the same place the extension's picker reads from.
// Pattern: ~/Library/Application Support/Ableton/Extensions Data/{author}.{name}/
// See extensions/trackdraft-bridge/manifest.json (author: "Matthew", name: "TrackDraft Bridge"
// → directory: "matthew.trackdraft-bridge").
const BLUEPRINTS_DIR =
  process.env.BLUEPRINTS_DIRECTORY ||
  path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? "/tmp",
    "Library",
    "Application Support",
    "Ableton",
    "Extensions Data",
    "matthew.trackdraft-bridge",
    "blueprints",
  );

const STORAGE_DIR = path.join(BLUEPRINTS_DIR, "queue");

/** Long-poll waiters for `GET /api/command/next`. Notified by every enqueue,
 *  so a connected extension receives a command immediately instead of on its
 *  next directory scan. */
const commandWaker = createCommandWaker();

/** Longest a `next` request may park. A browser request must stay well under
 *  its own timeout; an extension long-polls far longer (it has nothing else
 *  to do), which is why the cap is generous. */
const MAX_WAIT_MS = 30_000;
const DEFAULT_WAIT_MS = 25_000;

/** Queue a command for the extension and wake any parked long-poll. */
function enqueueCommand(payload: QueuedCommand): string {
  const filename = writeCommandFile(STORAGE_DIR, payload);
  commandWaker.notify();
  return filename;
}

// Shared application telemetry state cache
interface AbletonState {
  bpm: number;
  scale: string;
  rootNote: string;
  timestamp: number;
}

let liveStateCache: AbletonState = {
  bpm: 120.0,
  scale: "Major",
  rootNote: "C",
  timestamp: Date.now(),
};

// Optional listener invoked whenever a fresh M4L telemetry payload arrives
// (wired by cli.ts to push the same state into the WebSocket bridge, so
// browser clients get tempo/key/scale over the single ws:8081 channel).
let onLiveState: ((state: AbletonState) => void) | undefined;

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// A malicious page open in the same browser can POST to localhost. Both
// command routes write files that the extension later executes, so reject
// cross-site origins unless the operator explicitly exposed the bridge to
// the LAN (where the app is served from a non-loopback origin by design).
app.use((req, res, next) => {
  if (req.method !== "POST" || LAN_EXPOSED) return next();
  const origin = req.headers.origin;
  if (!origin || origin === "null" || LOOPBACK_ORIGIN.test(origin)) return next();
  res.status(403).json({ error: "Origin not allowed" });
});

// 1. Initialize OSC over UDP Listener
const udpPort = new osc.UDPPort({
  localAddress: "127.0.0.1",
  localPort: Number(OSC_IN_PORT),
  metadata: true,
});

udpPort.on("message", (oscMsg: any) => {
  if (oscMsg.address === "/live/state" && oscMsg.args?.[0]?.value) {
    try {
      const payload = JSON.parse(oscMsg.args[0].value);
      liveStateCache = {
        bpm: Number(payload.bpm) || liveStateCache.bpm,
        scale: payload.scale || liveStateCache.scale,
        rootNote: payload.rootNote || liveStateCache.rootNote,
        timestamp: Date.now(),
      };
      onLiveState?.(liveStateCache);
    } catch (err) {
      console.error("[OSC-BRIDGE] Failed to parse Max for Live JSON payload:", err);
    }
  }
});

udpPort.on("error", (err: any) => {
  console.error("[OSC-BRIDGE] UDP Port Error:", err);
});

udpPort.open();
console.log(`[OSC-BRIDGE] UDP OSC listener opened on 127.0.0.1:${OSC_IN_PORT}`);

// 2. REST Endpoints for UI Canvas & Puck Resolver
app.get("/api/ableton/state", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.json(liveStateCache);
});

// 2b. Liveness probe — lets the TrackDraft app tell "bridge process down"
//     (connection refused) apart from "bridge up but AbletonOSC/M4L not
//     sending yet" (no fresh live state), so the Studio status widget can
//     show the right hint instead of a bare "waiting…".
app.get("/health", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.json({
    ok: true,
    service: "osc-bridge",
    now: Date.now(),
    liveState: liveStateCache,
  });
});

// 3. UI Command Queue Router -> Writes to Shared Directory
app.post("/api/command", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const commandPayload = req.body;

  if (!commandPayload || !commandPayload.action) {
    return res.status(400).json({ error: "Invalid action blueprint payload" });
  }

  try {
    const filename = enqueueCommand(commandPayload as QueuedCommand);
    console.log(`[OSC-BRIDGE] Written blueprint queue command payload: ${filename}`);

    return res.json({ status: "queued", file: filename });
  } catch (err) {
    console.error("[OSC-BRIDGE] Failed writing command to queue directory:", err);
    return res.status(500).json({ error: "File system bridge error" });
  }
});

// 3b. Long-poll for the next queued command.
//
// The extension used to learn about commands only by scanning the queue
// directory every 2 s, so every browser action paid up to 2 s of latency.
// Live 12.4.15b5 gave extensions `fetch` and `AbortSignal`, so a modern
// extension can park on this route instead and be handed the command
// immediately. The directory stays the single source of truth: this route
// *claims* a file by renaming it (atomic), so a still-running old extension
// polling the same directory cannot also execute it.
//
// `wait=0` makes it non-blocking (a quick "is anything queued?" probe).
app.get("/api/command/next", async (req, res) => {
  const requested = Number(req.query.wait);
  const waitMs = Number.isFinite(requested)
    ? Math.max(0, Math.min(MAX_WAIT_MS, requested))
    : DEFAULT_WAIT_MS;

  let command = claimOldestCommand(STORAGE_DIR);
  if (!command && waitMs > 0) {
    await commandWaker.wait(waitMs);
    command = claimOldestCommand(STORAGE_DIR);
  }

  res.json({ command: command ?? null });
});

// 4. Push Song Blueprint -> Writes directly to the extension's blueprints
//    directory so the trackdraft-bridge extension's picker sees it immediately
//    — no manual sync script needed. Also queues an applyBlueprint command so
//    Ableton can auto-apply it. Requires BLUEPRINTS_DIRECTORY env to match
//    the extension's storageDirectory (same as the sync script).
app.post("/api/push-song", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const song = req.body;

  if (!song || typeof song.title !== "string" || typeof song.id !== "string") {
    return res.status(400).json({ error: "Invalid song blueprint: missing title or id" });
  }

  try {
    // Ensure the blueprints directory exists
    if (!fs.existsSync(BLUEPRINTS_DIR)) {
      fs.mkdirSync(BLUEPRINTS_DIR, { recursive: true });
    }

    // Write the blueprint JSON alongside any others the extension picks up
    const safeName = song.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const blueprintPath = path.join(BLUEPRINTS_DIR, `${safeName}.trackdraft.json`);
    fs.writeFileSync(blueprintPath, JSON.stringify(song, null, 2), "utf-8");
    console.log(`[OSC-BRIDGE] Pushed song blueprint: ${song.title} (${song.id}) → ${blueprintPath}`);

    // Also queue a command so the extension applies it automatically
    enqueueCommand({ action: "applyBlueprint", blueprintId: song.id });
    console.log(`[OSC-BRIDGE] Queued applyBlueprint command for: ${song.title}`);

    return res.json({ status: "pushed", id: song.id, title: song.title });
  } catch (err) {
    console.error("[OSC-BRIDGE] Failed pushing song blueprint:", err);
    return res.status(500).json({ error: "File system bridge error" });
  }
});

// Options handling for CORS preflight — Express v5 / path-to-regexp v8
// no longer accepts "*" as a wildcard. Use a middleware that catches
// every OPTIONS request regardless of route.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

/** Start the telemetry server (kept as exported factory for composability).
 *  `liveStateListener` is invoked on every fresh M4L telemetry payload —
 *  the CLI passes it through to `bridge.setTelemetry` so the WebSocket
 *  channel carries tempo/key/scale too, keeping the app on a single
 *  connection. */
export function startTelemetryServer(liveStateListener?: (state: AbletonState) => void) {
  if (liveStateListener) onLiveState = liveStateListener;
  app.listen(PORT, HOST, () => {
    console.log(`[OSC-BRIDGE] REST Telemetry server active on http://${HOST}:${PORT}`);
  });
}

export type { AbletonState };