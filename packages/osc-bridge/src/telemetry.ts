import express from "express";
import osc from "osc";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.TELEMETRY_PORT || 5200;
const OSC_IN_PORT = process.env.OSC_IN_PORT || 6000;
const STORAGE_DIR =
  process.env.STORAGE_DIRECTORY ||
  path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? "/tmp",
    "ableton-agent-toolkit",
    "storageDirectory",
    "blueprints",
    "queue",
  );

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

// 3. UI Command Queue Router -> Writes to Shared Directory
app.post("/api/command", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const commandPayload = req.body;

  if (!commandPayload || !commandPayload.action) {
    return res.status(400).json({ error: "Invalid action blueprint payload" });
  }

  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }

    const filename = `command_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.json`;
    const targetPath = path.join(STORAGE_DIR, filename);

    fs.writeFileSync(targetPath, JSON.stringify(commandPayload, null, 2), "utf-8");
    console.log(`[OSC-BRIDGE] Written blueprint queue command payload: ${filename}`);

    return res.json({ status: "queued", file: filename });
  } catch (err) {
    console.error("[OSC-BRIDGE] Failed writing command to queue directory:", err);
    return res.status(500).json({ error: "File system bridge error" });
  }
});

// Options handling for CORS preflight
app.options("*", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

/** Start the telemetry server (kept as exported factory for composability). */
export function startTelemetryServer() {
  app.listen(PORT, () => {
    console.log(`[OSC-BRIDGE] REST Telemetry server active on http://localhost:${PORT}`);
  });
}

export type { AbletonState };