import { describe, expect, it } from "vitest";
import { parseOscReply } from "../src/protocol.js";

describe("parseOscReply", () => {
  it("parses a beat message", () => {
    expect(parseOscReply("/live/song/get/beat", [42])).toEqual({ type: "beat", beat: 42 });
  });

  it("parses is_playing as a boolean argument", () => {
    expect(parseOscReply("/live/song/get/is_playing", [true])).toEqual({ type: "playState", isPlaying: true });
    expect(parseOscReply("/live/song/get/is_playing", [false])).toEqual({ type: "playState", isPlaying: false });
  });

  it("parses is_playing as a numeric 0/1 argument (some OSC decoders send int, not T/F)", () => {
    expect(parseOscReply("/live/song/get/is_playing", [1])).toEqual({ type: "playState", isPlaying: true });
    expect(parseOscReply("/live/song/get/is_playing", [0])).toEqual({ type: "playState", isPlaying: false });
  });

  it("parses the selected track (blue hand)", () => {
    expect(parseOscReply("/live/view/get/selected_track", [3])).toEqual({ type: "selectedTrack", track: 3 });
    expect(parseOscReply("/live/view/get/selected_track", [])).toBeNull();
    expect(parseOscReply("/live/view/get/selected_track", ["x"])).toBeNull();
  });

  it("parses the selected device (blue hand)", () => {
    expect(parseOscReply("/live/view/get/selected_device", [3, 1])).toEqual({
      type: "selectedDevice",
      track: 3,
      device: 1,
    });
    expect(parseOscReply("/live/view/get/selected_device", [3])).toBeNull();
    expect(parseOscReply("/live/view/get/selected_device", ["x", 1])).toBeNull();
  });

  it("relays an unrelated OSC address as a raw event instead of dropping it", () => {
    expect(parseOscReply("/live/song/get/tempo", [120])).toEqual({
      type: "raw",
      address: "/live/song/get/tempo",
      args: [120],
    });
  });

  it("relays a clip note-data reply as a raw event", () => {
    expect(parseOscReply("/live/clip/get/notes", [0, 0, 60, 0, 0.25, 100, 0])).toEqual({
      type: "raw",
      address: "/live/clip/get/notes",
      args: [0, 0, 60, 0, 0.25, 100, 0],
    });
  });

  it("relays selected_clip as a raw event (no dedicated typed event for it)", () => {
    expect(parseOscReply("/live/view/get/selected_clip", [2, 5])).toEqual({
      type: "raw",
      address: "/live/view/get/selected_clip",
      args: [2, 5],
    });
  });

  it("returns null for malformed args instead of throwing", () => {
    expect(parseOscReply("/live/song/get/beat", [])).toBeNull();
    expect(parseOscReply("/live/song/get/beat", ["not a number"])).toBeNull();
    expect(parseOscReply("/live/song/get/is_playing", [])).toBeNull();
    expect(parseOscReply("/live/song/get/is_playing", ["nope"])).toBeNull();
  });
});
