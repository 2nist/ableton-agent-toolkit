import { startPositionBridge } from "./bridge.js";
import { startTelemetryServer } from "./telemetry.js";

// 1. Start the playhead position relay (AbletonOSC → WebSocket clients)
const bridge = startPositionBridge({
  host: process.env.BRIDGE_HOST,
  onEvent: (event) => {
    console.log(new Date().toISOString(), event);
  },
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