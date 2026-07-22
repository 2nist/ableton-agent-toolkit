/** Wire shape of `osc-bridge`'s WebSocket relay
 *  (packages/osc-bridge/src/bridge.ts, already shipping — no changes
 *  needed there or in packages/osc-bridge/src/protocol.ts, which this
 *  intentionally doesn't import: that file's only exports besides these
 *  two types are Node-only (relies on the `osc`/`ws` packages), and
 *  duplicating a two-variant wire-protocol type here is far cheaper than
 *  risking a Node-only import leaking into the browser bundle through a
 *  shared package boundary. */
type BridgeMessage =
  | { type: "beat"; beat: number }
  | { type: "playState"; isPlaying: boolean }
  | { type: "telemetry"; bpm: number; scale: string; rootNote: string; timestamp: number };

export interface AbletonClockState {
  connected: boolean;
  /** Ableton's own raw transport beat — not song-relative. Null until the
   *  first message arrives (or after a disconnect). */
  abletonBeat: number | null;
  isPlaying: boolean;
  /** Live's current tempo, key root, and scale — from M4L telemetry via
   *  the merged osc-bridge WebSocket. Undefined until the first telemetry
   *  message arrives. */
  abletonBpm?: number;
  abletonScale?: string;
  abletonRootNote?: string;
}

const DEFAULT_URL = "ws://127.0.0.1:8081";
const RECONNECT_DELAY_MS = 2000;

/** Thin client for `osc-bridge`'s position relay. Reconnects on close/
 *  error rather than giving up — the bridge process (and Ableton itself)
 *  may not be running yet when a user first opts into Ableton sync, or
 *  may restart independently of the browser tab; this should just quietly
 *  pick the connection back up whenever it becomes available. */
class AbletonClock {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(state: AbletonClockState) => void>();
  private state: AbletonClockState = { connected: false, abletonBeat: null, isPlaying: false };
  private wantsConnection = false;

  connect(url: string = DEFAULT_URL): void {
    this.wantsConnection = true;
    if (this.ws) return;
    this.open(url);
  }

  private open(url: string): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(url);
      return;
    }
    this.ws = ws;

    ws.onopen = () => this.setState({ ...this.state, connected: true });
    ws.onclose = () => {
      this.ws = null;
      this.setState({ ...this.state, connected: false });
      if (this.wantsConnection) this.scheduleReconnect(url);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (event) => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.type === "beat") this.setState({ ...this.state, abletonBeat: msg.beat });
      else if (msg.type === "playState") this.setState({ ...this.state, isPlaying: msg.isPlaying });
      else if (msg.type === "telemetry") {
        this.setState({
          ...this.state,
          abletonBpm: msg.bpm,
          abletonScale: msg.scale,
          abletonRootNote: msg.rootNote,
        });
      }
    };
  }

  private scheduleReconnect(url: string): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantsConnection) this.open(url);
    }, RECONNECT_DELAY_MS);
  }

  disconnect(): void {
    this.wantsConnection = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setState({ connected: false, abletonBeat: null, isPlaying: false });
  }

  /** Fires immediately with the current state, then on every change —
   *  callers don't need a separate `getState()` round-trip to initialize. */
  onChange(listener: (state: AbletonClockState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): AbletonClockState {
    return this.state;
  }

  /** Send a command to AbletonOSC through the bridge's bidirectional
   *  WebSocket. No-op if the socket isn't connected — the caller should
   *  gate on `getState().connected` or just fire-and-forget (commands
   *  will be silently dropped if the bridge/Ableton aren't running). */
  sendCommand(address: string, args: unknown[] = []): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "command", address, args }));
  }

  private setState(next: AbletonClockState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

let sharedClock: AbletonClock | null = null;

export function getAbletonClock(): AbletonClock {
  if (!sharedClock) sharedClock = new AbletonClock();
  return sharedClock;
}
