import osc from "osc";
const { UDPPort } = osc;
import { WebSocketServer, type WebSocket } from "ws";
import { parseOscReply, type BridgeEvent } from "./protocol.js";

export interface PositionBridgeOptions {
  /** Where AbletonOSC (the Remote Script) is running. */
  abletonOscHost?: string;
  /** Port to send commands TO AbletonOSC. */
  abletonOscSendPort?: number;
  /** AbletonOSC's fixed reply port (OSC_RESPONSE_PORT in its own source — not configurable on its side). */
  abletonOscListenPort?: number;
  /** Port this bridge's WebSocket server listens on for browser clients. */
  websocketPort?: number;
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
  resubscribeIntervalMs: 5000,
};

export interface PositionBridge {
  stop(): void;
}

/**
 * Relays Ableton's playhead beat position and play state to any number of
 * WebSocket clients, as the only way to get that data at all — the
 * Extensions SDK exposes neither (confirmed: no playhead/isPlaying
 * property anywhere in Application or Song). AbletonOSC's fixed
 * OSC_RESPONSE_PORT means only one process can hold this relay role at a
 * time; this bridge is that single OSC subscriber, fanning out to N
 * WebSocket clients.
 */
export function startPositionBridge(options: PositionBridgeOptions = {}): PositionBridge {
  const config = { ...DEFAULTS, ...options };
  const onEvent = options.onEvent ?? (() => {});
  const lastState: { beat?: number; isPlaying?: boolean } = {};
  const clients = new Set<WebSocket>();

  const udpPort = new UDPPort({
    localAddress: config.abletonOscHost,
    localPort: config.abletonOscListenPort,
    remoteAddress: config.abletonOscHost,
    remotePort: config.abletonOscSendPort,
  });

  function broadcast(event: BridgeEvent) {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  udpPort.on("message", (message) => {
    const event = parseOscReply(message.address, message.args);
    if (!event) return;
    if (event.type === "beat") lastState.beat = event.beat;
    if (event.type === "playState") lastState.isPlaying = event.isPlaying;
    onEvent(event);
    broadcast(event);
  });

  function subscribe() {
    udpPort.send({ address: "/live/song/start_listen/beat" });
    udpPort.send({ address: "/live/song/start_listen/is_playing" });
  }

  udpPort.on("ready", subscribe);
  udpPort.open();

  // AbletonOSC's listener registration doesn't survive a Live/AbletonOSC
  // restart. Periodically re-subscribing is harmless — re-registering an
  // existing listener just replaces it (see AbletonOSCHandler._start_listen)
  // — and makes this bridge self-healing without a manual restart.
  const resubscribeTimer = setInterval(subscribe, config.resubscribeIntervalMs);

  const wss = new WebSocketServer({ port: config.websocketPort });
  wss.on("connection", (client) => {
    clients.add(client);
    // A client that connects mid-song has no reason to wait for the next
    // beat/play-state change — send whatever we already know immediately.
    if (lastState.beat !== undefined) client.send(JSON.stringify({ type: "beat", beat: lastState.beat }));
    if (lastState.isPlaying !== undefined) {
      client.send(JSON.stringify({ type: "playState", isPlaying: lastState.isPlaying }));
    }
    client.on("close", () => clients.delete(client));
  });

  return {
    stop() {
      clearInterval(resubscribeTimer);
      udpPort.close();
      wss.close();
    },
  };
}
