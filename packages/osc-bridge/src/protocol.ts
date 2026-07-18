export interface BeatEvent {
  type: "beat";
  beat: number;
}

export interface PlayStateEvent {
  type: "playState";
  isPlaying: boolean;
}

export type BridgeEvent = BeatEvent | PlayStateEvent;

/**
 * Maps AbletonOSC's reply messages into this package's WebSocket JSON
 * protocol. This bridge only ever subscribes to two addresses
 * (/live/song/start_listen/beat and .../is_playing — see bridge.ts), so
 * anything else returns null rather than being relayed.
 *
 * AbletonOSC sends is_playing as a Python bool, which python-osc encodes
 * as an OSC T/F type tag; some OSC libraries decode that as a JS boolean,
 * others as 0/1 — handled defensively here rather than assumed.
 */
export function parseOscReply(address: string, args: unknown[]): BridgeEvent | null {
  if (address === "/live/song/get/beat") {
    const beat = args[0];
    return typeof beat === "number" ? { type: "beat", beat } : null;
  }

  if (address === "/live/song/get/is_playing") {
    const raw = args[0];
    if (typeof raw === "boolean") return { type: "playState", isPlaying: raw };
    if (typeof raw === "number") return { type: "playState", isPlaying: raw !== 0 };
    return null;
  }

  return null;
}
