/** Where the osc-bridge endpoints live, derived from the page's own host.
 *
 *  Local dev opens the app at localhost/127.0.0.1, so the bridge (which
 *  runs on the same machine) is reached on 127.0.0.1. When the app is
 *  opened from another device on the LAN — e.g. an iPad loading
 *  `http://192.168.4.26:5183` — the browser's hostname IS the Mac's LAN
 *  IP, and the bridge (still on the Mac) is reached at that same IP on
 *  the bridge ports. Deriving the host from the page keeps local dev and
 *  LAN access working with zero config: `start-all.sh lan` exposes Vite
 *  on the network, and every bridge URL (WebSocket sync, /health,
 *  Send-to-Ableton) automatically follows whatever host the page was
 *  loaded from. */
export function getBridgeHost(): string {
  if (typeof window === "undefined") return "127.0.0.1";
  const host = window.location?.hostname ?? "";
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    return "127.0.0.1";
  }
  return host;
}

/** HTTP base for the bridge REST API (health, push-song, command). */
export function getBridgeHttpBase(): string {
  return `http://${getBridgeHost()}:5200`;
}

/** WebSocket URL for the bridge's transport/telemetry relay. */
export function getBridgeWsUrl(): string {
  return `ws://${getBridgeHost()}:8081`;
}
