import { useEffect, useState } from "react";
import { getAbletonClock } from "../../lib/playback/abletonClock";
import { getBridgeHttpBase } from "../../lib/bridgeHost";

/** osc-bridge REST liveness probe — reachable whenever the bridge process
 *  is up, independent of whether AbletonOSC/Live are sending yet. Follows
 *  the page host so it works from an iPad on the LAN too. */
const HEALTH_URL = `${getBridgeHttpBase()}/health`;

type BridgeState = "unknown" | "up" | "down";

/** Live connection status dot for the Studio transport bar.
 *
 *  - WebSocket open → green "● connected"
 *  - bridge REST unreachable → amber "○ bridge not running" + hint
 *  - bridge up, socket still opening → muted "○ connecting…"
 *
 *  Polls the osc-bridge `/health` endpoint so the user gets an actionable
 *  message instead of an eternal "waiting…" when the bridge process was
 *  never started — the actual root cause of the original bug (start-all.sh
 *  didn't launch the bridge). A manual ↻ retry is included for good
 *  measure, though the underlying `AbletonClock` already auto-reconnects.
 */
export default function AbletonStatus({ connected }: { connected: boolean }) {
  const [bridge, setBridge] = useState<BridgeState>("unknown");

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(HEALTH_URL);
        if (alive) setBridge(res.ok ? "up" : "down");
      } catch {
        if (alive) setBridge("down");
      }
    };
    check();
    const timer = setInterval(check, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (connected) {
    return <span className="text-[10px] font-mono text-ok">● connected</span>;
  }

  function retry() {
    const clock = getAbletonClock();
    clock.disconnect();
    clock.connect();
  }

  if (bridge === "down") {
    return (
      <span className="flex items-center gap-1">
        <span
          className="text-[10px] font-mono text-warn"
          title="The osc-bridge isn't running. Start it with `npm run bridge` (start-all.sh does this automatically), and make sure Ableton Live is open."
        >
          ○ bridge not running
        </span>
        <button
          className="text-[10px] text-inkMuted hover:text-accent font-mono"
          onClick={retry}
          title="Re-check the bridge connection"
        >
          ↻
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <span
        className="text-[10px] font-mono text-inkMuted/60"
        title="Connecting to the osc-bridge… If this sticks, enable AbletonOSC in Live: Preferences → Link, Tempo & MIDI → Control Surface."
      >
        ○ connecting…
      </span>
      <button
        className="text-[10px] text-inkMuted hover:text-accent font-mono"
        onClick={retry}
        title="Reconnect to the osc-bridge"
      >
        ↻
      </button>
    </span>
  );
}
