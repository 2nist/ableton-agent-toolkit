import { startPositionBridge } from "./bridge.js";

const bridge = startPositionBridge({
  onEvent: (event) => {
    console.log(new Date().toISOString(), event);
  },
});

console.log("live-position-bridge running.");
console.log("Relaying Ableton transport position/play state to ws://127.0.0.1:8081");
console.log("Requires AbletonOSC installed and enabled as a Live Remote Script.");

process.on("SIGINT", () => {
  bridge.stop();
  process.exit(0);
});
