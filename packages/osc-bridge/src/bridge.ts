import osc from "osc";
const { UDPPort } = osc;
import { WebSocketServer, type WebSocket } from "ws";
import { parseOscReply, type BridgeEvent } from "./protocol.js";

export interface TelemetryState {
  bpm: number;
  scale: string;
  rootNote: string;
  timestamp: number;
}

export interface PositionBridgeOptions {
  /** Where AbletonOSC (the Remote Script) is running. */
  abletonOscHost?: string;
  /** Port to send commands TO AbletonOSC. */
  abletonOscSendPort?: number;
  /** AbletonOSC's fixed reply port (OSC_RESPONSE_PORT in its own source — not configurable on its side). */
  abletonOscListenPort?: number;
  /** Port this bridge's WebSocket server listens on for browser clients. */
  websocketPort?: number;
  /** Interface to bind. Loopback by default: the socket is bidirectional and
   *  can drive Ableton, so exposing it to the LAN is an explicit opt-in
   *  (BRIDGE_HOST=0.0.0.0, used by `start-all.sh lan`). */
  host?: string;
  /** How often to re-send the start_listen subscriptions. */
  resubscribeIntervalMs?: number;
  /** Called for every event relayed, before it's broadcast — for logging/observability. */
  onEvent?: (event: BridgeEvent) => void;
}

const DEFAULTS: Required<Omit<PositionBridgeOptions, "onEvent">> = {
  abletonOscHost: "127.0.0.1",
  abletonOscSendPort: 11000,
  abletonOscListenPort: 11001,
  websocketPort: 8081,
  host: "127.0.0.1",
  resubscribeIntervalMs: 5000,
};

export interface PositionBridge {
  stop(): void;
  /** Expose the telemetry cache so the CLI can feed M4L state into the
   *  same WebSocket channel without a separate REST server. */
  setTelemetry(state: Partial<TelemetryState>): void;
}

/**
 * Bidirectional relay between a browser WebSocket and AbletonOSC's UDP
 * transport:
 *
 *   - Inbound (Ableton → browser): subscribes to /live/song/beat and
 *     /live/song/is_playing via OSC, fans out as JSON {"type":"beat"/"playState"}
 *     to every connected WebSocket client.
 *   - Outbound (browser → Ableton): clients send JSON
 *     {"type":"command","address":"/live/song/set/tempo","args":[140]}
 *     and this bridge forwards it as an OSC message.  Any command the
 *     AbletonOSC remote script understands (/live/song/set/…,
 *     /live/track/…, etc.) is routable.
 *   - Telemetry (M4L → browser): call `bridge.setTelemetry({…})` from the
 *     CLI's M4L OSC listener to broadcast app-level state (bpm, key,
 *     scale) on the same WebSocket channel, avoiding a separate REST
 *     server.  Emitted as {"type":"telemetry","bpm":…,"scale":…,...}.
 *
 * The OSC_UDPPort is the single point of communication with AbletonOSC;
 * nothing else in this process opens a UDP socket on 11000/11001.
 */
export function startPositionBridge(options: PositionBridgeOptions = {}): PositionBridge {
  const config = { ...DEFAULTS, ...options };
  const onEvent = options.onEvent ?? (() => {});
  const lastState: {
    beat?: number;
    isPlaying?: boolean;
    selectedTrack?: number;
    selectedDevice?: number;
    telemetry?: TelemetryState;
  } = {};
  const clients = new Set<WebSocket>();

  const udpPort = new UDPPort({
    localAddress: config.abletonOscHost,
    localPort: config.abletonOscListenPort,
    remoteAddress: config.abletonOscHost,
    remotePort: config.abletonOscSendPort,
  });

  function broadcast(data: unknown) {
    const payload = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  /** Forward an outgoing command from a WebSocket client to AbletonOSC. */
  function forwardCommand(address: string, args: unknown[] = []) {
    try {
      udpPort.send({ address, args });
    } catch (err) {
      console.error("[osc-bridge] failed to forward OSC command", address, err);
    }
  }

  // --- Inbound OSC (AbletonOSC → WebSocket clients) ---

  udpPort.on("message", (message) => {
    const event = parseOscReply(message.address, message.args);
    if (!event) return;
    if (event.type === "beat") lastState.beat = event.beat;
    if (event.type === "playState") lastState.isPlaying = event.isPlaying;
    if (event.type === "selectedTrack") lastState.selectedTrack = event.track;
    if (event.type === "selectedDevice") lastState.selectedDevice = event.device;
    onEvent(event);
    broadcast(event);
  });

  function subscribe() {
    udpPort.send({ address: "/live/song/start_listen/beat" });
    udpPort.send({ address: "/live/song/start_listen/is_playing" });
    // Blue hand — the selected track in Live's UI. AbletonOSC's view.py only
    // registers start_listen/stop_listen for selected_scene and
    // selected_track, NOT selected_device (get/set only) — subscribing to
    // it used to silently fail (dropped as an unrecognized reply type)
    // before parseOscReply gained a raw fallback; sending it just produced
    // a repeating "Unknown OSC address" error from AbletonOSC for no
    // benefit, so it's dropped here rather than "fixed" — there's nothing
    // to subscribe to on the AbletonOSC side for this field.
    udpPort.send({ address: "/live/view/start_listen/selected_track" });
  }

  udpPort.on("ready", subscribe);
  udpPort.open();

  const resubscribeTimer = setInterval(subscribe, config.resubscribeIntervalMs);

  // --- WebSocket server (bidirectional) ---

  const wss = new WebSocketServer({ port: config.websocketPort, host: config.host });
  wss.on("connection", (client) => {
    clients.add(client);

    // Catch-up: send everything we already know to a newly-connected client.
    if (lastState.beat !== undefined) client.send(JSON.stringify({ type: "beat", beat: lastState.beat }));
    if (lastState.isPlaying !== undefined) {
      client.send(JSON.stringify({ type: "playState", isPlaying: lastState.isPlaying }));
    }
    if (lastState.selectedTrack !== undefined) {
      client.send(JSON.stringify({ type: "selectedTrack", track: lastState.selectedTrack }));
    }
    if (lastState.selectedDevice !== undefined) {
      client.send(
        JSON.stringify({ type: "selectedDevice", track: lastState.selectedTrack ?? 0, device: lastState.selectedDevice }),
      );
    }
    if (lastState.telemetry) {
      client.send(JSON.stringify({ type: "telemetry", ...lastState.telemetry }));
    }

    // --- Outbound commands (browser → AbletonOSC) ---
    client.on("message", (raw) => {
      let msg: { type?: string; address?: string; args?: unknown[] };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "command" && typeof msg.address === "string") {
        forwardCommand(msg.address, msg.args ?? []);
      }
    });

    client.on("close", () => clients.delete(client));
  });

  return {
    stop() {
      clearInterval(resubscribeTimer);
      udpPort.close();
      wss.close();
    },
    setTelemetry(partial: Partial<TelemetryState>) {
      lastState.telemetry = {
        bpm: partial.bpm ?? lastState.telemetry?.bpm ?? 120,
        scale: partial.scale ?? lastState.telemetry?.scale ?? "Major",
        rootNote: partial.rootNote ?? lastState.telemetry?.rootNote ?? "C",
        timestamp: partial.timestamp ?? Date.now(),
      };
      broadcast({ type: "telemetry", ...lastState.telemetry });
    },
  };
}
