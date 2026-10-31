import { startPositionBridge } from "./bridge.js";
import type { BridgeEvent } from "./protocol.js";
import { startTelemetryServer } from "./telemetry.js";

/** How long an identical, repeated event stays collapsed into one line.
 *  `/live/error` repeats on every 5 s resubscribe and `/live/song/get/beat`
 *  fires once per beat; logged verbatim they filled 11 MB in a session and
 *  buried everything worth reading. */
const LOG_REPEAT_MS = 60_000;
const recent = new Map<string, { at: number; suppressed: number }>();

function logEvent(event: BridgeEvent): void {
  // The beat stream is the bulk of the traffic and never says anything.
  if (event.type === "beat") return;

  const key = event.type === "raw" ? `raw:${event.address}` : event.type;
  const now = Date.now();
  const seen = recent.get(key);
  if (seen && now - seen.at < LOG_REPEAT_MS) {
    seen.suppressed += 1;
    return;
  }
  const repeated = seen?.suppressed ?? 0;
  recent.set(key, { at: now, suppressed: 0 });
  if (repeated > 0) console.log(new Date(now).toISOString(), event, `(+${repeated} more in the last minute)`);
  else console.log(new Date(now).toISOString(), event);
}

// 1. Start the playhead position relay (AbletonOSC → WebSocket clients)
const bridge = startPositionBridge({
  host: process.env.BRIDGE_HOST,
  // `BEAT_POLL_MS=0` keeps the integer-only feed (the pre-2026-10 behaviour).
  beatPollIntervalMs: process.env.BEAT_POLL_MS ? Number(process.env.BEAT_POLL_MS) : undefined,
  onEvent: logEvent,
});

const wsHost = process.env.BRIDGE_HOST ?? "127.0.0.1";
console.log("live-position-bridge running.");
console.log(`Relaying Ableton transport position/play state to ws://${wsHost}:8081`);
console.log("Requires AbletonOSC installed and enabled as a Live Remote Script.");

// 2. Start the M4L telemetry + command queue server, forwarding fresh
//    M4L state (bpm/key/scale) into the same WebSocket channel so browser
//    clients see it over the single ws:8081 connection they already hold.
startTelemetryServer((state) => bridge.setTelemetry(state));

process.on("SIGINT", () => {
  bridge.stop();
  process.exit(0);
});