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

  it("returns null for an unrelated OSC address", () => {
    expect(parseOscReply("/live/song/get/tempo", [120])).toBeNull();
  });

  it("returns null for malformed args instead of throwing", () => {
    expect(parseOscReply("/live/song/get/beat", [])).toBeNull();
    expect(parseOscReply("/live/song/get/beat", ["not a number"])).toBeNull();
    expect(parseOscReply("/live/song/get/is_playing", [])).toBeNull();
    expect(parseOscReply("/live/song/get/is_playing", ["nope"])).toBeNull();
  });
});
