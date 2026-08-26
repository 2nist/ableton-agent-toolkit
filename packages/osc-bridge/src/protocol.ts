export interface BeatEvent {
  type: "beat";
  beat: number;
}

export interface PlayStateEvent {
  type: "playState";
  isPlaying: boolean;
}

/** The track selected in Live's arrangement/session (the "blue hand"). */
export interface SelectedTrackEvent {
  type: "selectedTrack";
  track: number;
}

/** The device selected in Live on its track (the "blue hand" device). */
export interface SelectedDeviceEvent {
  type: "selectedDevice";
  track: number;
  device: number;
}

/**
 * Fallback for any AbletonOSC reply not covered by a dedicated typed event
 * above — e.g. `/live/clip/get/notes`, `/live/view/get/selected_clip`, or
 * any other address a client explicitly requested via a `command` message.
 * Consumers that need a specific address subscribe by matching on
 * `address` themselves (see apps/apc-mk1-utility's osc.ts `request()`).
 */
export interface RawEvent {
  type: "raw";
  address: string;
  args: unknown[];
}

export type BridgeEvent =
  | BeatEvent
  | PlayStateEvent
  | SelectedTrackEvent
  | SelectedDeviceEvent
  | RawEvent;

/**
 * Maps AbletonOSC's reply messages into this package's WebSocket JSON
 * protocol. This bridge subscribes to beat, is_playing, selected_track and
 * selected_device (see bridge.ts) and gives those a dedicated typed shape;
 * any other address AbletonOSC replies to (including ones a client
 * explicitly requested, like clip note data) is relayed as a `RawEvent`
 * instead of being dropped.
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

  if (address === "/live/view/get/selected_track") {
    const track = args[0];
    return typeof track === "number" ? { type: "selectedTrack", track } : null;
  }

  if (address === "/live/view/get/selected_device") {
    const track = args[0];
    const device = args[1];
    return typeof track === "number" && typeof device === "number"
      ? { type: "selectedDevice", track, device }
      : null;
  }

  return { type: "raw", address, args };
}
