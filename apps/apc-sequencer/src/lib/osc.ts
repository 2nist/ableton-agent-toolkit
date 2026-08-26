/**
 * WebSocket client for the osc-bridge relay (packages/osc-bridge), which fans
 * out AbletonOSC beat/play-state to browsers and forwards arbitrary `/live/...`
 * commands back to Live.
 *
 * Wire shape mirrors the bridge protocol:
 *   inbound  { type: "beat", beat } | { type: "playState", isPlaying } | { type: "telemetry", ... }
 *   outbound { type: "command", address, args }
 */
type BridgeMessage =
  | { type: "beat"; beat: number }
  | { type: "playState"; isPlaying: boolean }
  | { type: "telemetry"; bpm: number; scale: string; rootNote: string; timestamp: number }
  | { type: "selectedTrack"; track: number }
  | { type: "selectedDevice"; track: number; device: number };

export interface AbletonState {
  connected: boolean;
  beat: number | null;
  isPlaying: boolean;
  bpm?: number;
  scale?: string;
  rootNote?: string;
  /** Track selected in Live (the blue hand). */
  selectedTrack?: number;
  /** Device selected in Live on that track. */
  selectedDevice?: number;
}

const DEFAULT_URL = "ws://127.0.0.1:8081";
const RECONNECT_DELAY_MS = 2000;

class AbletonOsc {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wantsConnection = false;
  private listeners = new Set<(s: AbletonState) => void>();
  private state: AbletonState = { connected: false, beat: null, isPlaying: false };

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
      if (msg.type === "beat") this.setState({ ...this.state, beat: msg.beat });
      else if (msg.type === "playState") this.setState({ ...this.state, isPlaying: msg.isPlaying });
      else if (msg.type === "selectedTrack") this.setState({ ...this.state, selectedTrack: msg.track });
      else if (msg.type === "selectedDevice") this.setState({ ...this.state, selectedDevice: msg.device });
      else if (msg.type === "telemetry") {
        this.setState({ ...this.state, bpm: msg.bpm, scale: msg.scale, rootNote: msg.rootNote });
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
    this.setState({ connected: false, beat: null, isPlaying: false });
  }

  /** Subscribe to state changes. Returns an unsubscribe fn. */
  onChange(listener: (s: AbletonState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): AbletonState {
    return this.state;
  }

  /** Send an OSC command to Live through the bridge (fire-and-forget). */
  send(address: string, args: unknown[] = []): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "command", address, args }));
  }

  private setState(next: AbletonState): void {
    this.state = next;
    for (const l of this.listeners) l(next);
  }
}

let shared: AbletonOsc | null = null;
export function getAbleton(): AbletonOsc {
  if (!shared) shared = new AbletonOsc();
  return shared;
}
