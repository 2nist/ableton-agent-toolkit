/**
 * WebSocket client for the osc-bridge relay (packages/osc-bridge).
 *
 * Adapted from apps/apc-sequencer/src/lib/osc.ts's connect/reconnect/`send()`
 * pattern (not imported — that package has no exported browser client, and
 * apc-sequencer is left untouched). The one real addition here is
 * `request()`: apc-sequencer only ever fires one-way commands and listens to
 * a fixed set of pushed telemetry types, but clip editing needs an actual
 * read-transform-write round trip (read a clip's notes, compute a
 * transform, write the result back), so this client needs to await a reply
 * to a specific address it just asked for.
 *
 * Wire shape:
 *   inbound  { type: "beat"|"playState"|"selectedTrack"|"selectedDevice"|"raw", ... }
 *   outbound { type: "command", address, args }
 *
 * AbletonOSC replies to a request on the same OSC address it was sent to,
 * so `request(address, args)` sends the command and resolves on the next
 * inbound message (of any type) whose `address` matches. A per-address FIFO
 * queue is enough — this app's usage is inherently serial (one control
 * fires one round trip at a time), not concurrent.
 */
type BridgeMessage =
  | { type: "beat"; beat: number }
  | { type: "playState"; isPlaying: boolean }
  | { type: "selectedTrack"; track: number }
  | { type: "selectedDevice"; track: number; device: number }
  | { type: "raw"; address: string; args: unknown[] };

/** The address a message effectively arrived on, for request() matching. */
function messageAddress(msg: BridgeMessage): string | null {
  switch (msg.type) {
    case "beat":
      return "/live/song/get/beat";
    case "playState":
      return "/live/song/get/is_playing";
    case "selectedTrack":
      return "/live/view/get/selected_track";
    case "selectedDevice":
      return "/live/view/get/selected_device";
    case "raw":
      return msg.address;
  }
}

function messageArgs(msg: BridgeMessage): unknown[] {
  switch (msg.type) {
    case "beat":
      return [msg.beat];
    case "playState":
      return [msg.isPlaying];
    case "selectedTrack":
      return [msg.track];
    case "selectedDevice":
      return [msg.track, msg.device];
    case "raw":
      return msg.args;
  }
}

export interface OscState {
  connected: boolean;
}

const DEFAULT_URL = "ws://127.0.0.1:8081";
const RECONNECT_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 3000;

interface PendingRequest {
  resolve: (args: unknown[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class OscBridgeClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wantsConnection = false;
  private listeners = new Set<(s: OscState) => void>();
  private state: OscState = { connected: false };
  private pending = new Map<string, PendingRequest[]>();

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

    ws.onopen = () => this.setState({ connected: true });
    ws.onclose = () => {
      this.ws = null;
      this.setState({ connected: false });
      this.rejectAllPending(new Error("OSC bridge disconnected"));
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
      const address = messageAddress(msg);
      if (!address) return;
      const queue = this.pending.get(address);
      if (queue && queue.length > 0) {
        const req = queue.shift()!;
        clearTimeout(req.timer);
        req.resolve(messageArgs(msg));
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
    this.rejectAllPending(new Error("OSC bridge disconnected"));
    this.ws?.close();
    this.ws = null;
    this.setState({ connected: false });
  }

  onChange(listener: (s: OscState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): OscState {
    return this.state;
  }

  /** Send an OSC command through the bridge (fire-and-forget). */
  send(address: string, args: unknown[] = []): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "command", address, args }));
  }

  /**
   * Send an OSC command and await its reply on the same address.
   * Rejects on disconnect or after REQUEST_TIMEOUT_MS with no reply.
   */
  request(address: string, args: unknown[] = []): Promise<unknown[]> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      return Promise.reject(new Error("OSC bridge not connected"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = this.pending.get(address);
        if (queue) {
          const idx = queue.findIndex((r) => r.resolve === resolve);
          if (idx >= 0) queue.splice(idx, 1);
        }
        reject(new Error(`OSC request timed out: ${address}`));
      }, REQUEST_TIMEOUT_MS);

      const queue = this.pending.get(address) ?? [];
      queue.push({ resolve, reject, timer });
      this.pending.set(address, queue);
      this.send(address, args);
    });
  }

  private rejectAllPending(err: Error): void {
    for (const queue of this.pending.values()) {
      for (const req of queue) {
        clearTimeout(req.timer);
        req.reject(err);
      }
    }
    this.pending.clear();
  }

  private setState(next: OscState): void {
    this.state = next;
    for (const l of this.listeners) l(next);
  }
}

let shared: OscBridgeClient | null = null;
export function getOsc(): OscBridgeClient {
  if (!shared) shared = new OscBridgeClient();
  return shared;
}

export type { OscBridgeClient };
