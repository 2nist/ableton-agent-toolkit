import { describe, expect, it } from "vitest";
import { inferDrumPattern, inferDrumStyle } from "../src/infer.js";

describe("inferDrumStyle", () => {
  it("defaults to acoustic when the song says nothing about its sound", () => {
    expect(inferDrumStyle({})).toBe("acoustic");
    expect(inferDrumStyle({ title: "Twin Fish", concept: "a reflective ballad" })).toBe("acoustic");
  });

  it("reads electronic markers from concept, instrumentation and title", () => {
    expect(inferDrumStyle({ concept: "late-night synth wave city drive" })).toBe("electronic");
    expect(inferDrumStyle({ notes: { instrumentation: ["808", "pads"] } })).toBe("electronic");
    expect(inferDrumStyle({ title: "House of Static" })).toBe("electronic");
  });

  it("matches whole words only", () => {
    expect(inferDrumStyle({ concept: "entrapment and greenhouses" })).toBe("acoustic");
  });
});

describe("inferDrumPattern — meter wins first", () => {
  it("maps odd meters regardless of role or style", () => {
    expect(inferDrumPattern({ role: "chorus", timeSignatureNumerator: 7, timeSignatureDenominator: 8 })).toBe("78");
    expect(inferDrumPattern({ role: "verse", timeSignatureNumerator: 6, timeSignatureDenominator: 8 })).toBe("68");
    expect(inferDrumPattern({ role: "verse", timeSignatureNumerator: 5, timeSignatureDenominator: 4 })).toBe("54");
    expect(inferDrumPattern({ role: "verse", timeSignatureNumerator: 3, timeSignatureDenominator: 4 })).toBe("68");
  });
});

describe("inferDrumPattern — acoustic family", () => {
  it("maps roles to the corpus presets", () => {
    expect(inferDrumPattern({ role: "verse", velocity: "mf" })).toBe("standard");
    expect(inferDrumPattern({ role: "pre_chorus", velocity: "mf" })).toBe("driving");
    expect(inferDrumPattern({ role: "chorus", velocity: "mf" })).toBe("driving");
    expect(inferDrumPattern({ role: "chorus", velocity: "ff" })).toBe("intense");
    expect(inferDrumPattern({ role: "bridge", velocity: "mf" })).toBe("bridge_sparse");
    expect(inferDrumPattern({ role: "breakdown", velocity: "pp" })).toBe("kick_only");
    expect(inferDrumPattern({ role: "breakdown", velocity: "f" })).toBe("half_time");
    expect(inferDrumPattern({ role: "outro", velocity: "p" })).toBe("bridge_sparse");
  });

  it("lets dynamics pull a section sparse or driving", () => {
    expect(inferDrumPattern({ role: "verse", velocity: "pp" })).toBe("bridge_sparse");
    expect(inferDrumPattern({ role: "custom", velocity: "ff" })).toBe("driving");
    expect(inferDrumPattern({ role: "custom", velocity: "mf" })).toBe("standard");
  });

  it("keeps intros sparse up to mf so they settle into the song (not a train wreck)", () => {
    expect(inferDrumPattern({ role: "intro", velocity: "pp" })).toBe("bridge_sparse");
    expect(inferDrumPattern({ role: "intro", velocity: "mf" })).toBe("bridge_sparse");
    // A genuinely loud intro can still get the full standard groove.
    expect(inferDrumPattern({ role: "intro", velocity: "ff" })).toBe("standard");
  });

  it("treats a refrain as a chorus — Beatles-style labels get chorus patterns", () => {
    expect(inferDrumPattern({ role: "refrain", velocity: "mf" })).toBe("driving");
    expect(inferDrumPattern({ role: "refrain", velocity: "ff" })).toBe("intense");
    // …and electronic refrains get the chorus four-on-the-floor too.
    expect(inferDrumPattern({ role: "refrain", velocity: "mf" }, { concept: "club techno", bpm: 126 })).toBe("four_on_floor");
  });
});

describe("inferDrumPattern — electronic family", () => {
  const house = { concept: "four to the floor club techno" };

  it("uses four-on-the-floor at dance tempos", () => {
    expect(inferDrumPattern({ role: "chorus", velocity: "mf" }, { ...house, bpm: 126 })).toBe("four_on_floor");
    expect(inferDrumPattern({ role: "verse", velocity: "mf" }, { ...house, bpm: 126 })).toBe("four_on_floor");
    expect(inferDrumPattern({ role: "intro", velocity: "pp" }, { ...house, bpm: 126 })).toBe("kick_only");
    expect(inferDrumPattern({ role: "bridge", velocity: "mf" }, { ...house, bpm: 126 })).toBe("breakbeat");
  });

  it("goes dnb above 160 bpm", () => {
    const song = { concept: "electronic rush", bpm: 172 };
    expect(inferDrumPattern({ role: "chorus", velocity: "f" }, song)).toBe("dnb");
    expect(inferDrumPattern({ role: "verse", velocity: "mf" }, song)).toBe("dnb");
    expect(inferDrumPattern({ role: "bridge", velocity: "mf" }, song)).toBe("trap");
    expect(inferDrumPattern({ role: "intro", velocity: "pp" }, song)).toBe("kick_only");
  });

  it("reads trap/808 language as half-time trap", () => {
    const song = { concept: "808 heavy night drive", bpm: 140 };
    expect(inferDrumPattern({ role: "verse", velocity: "mf" }, song)).toBe("trap");
    expect(inferDrumPattern({ role: "chorus", velocity: "f" }, song)).toBe("trap");
    expect(inferDrumPattern({ role: "bridge", velocity: "mf" }, song)).toBe("half_time");
  });

  it("odd meter still beats style", () => {
    expect(
      inferDrumPattern(
        { role: "chorus", velocity: "f", timeSignatureNumerator: 7, timeSignatureDenominator: 8 },
        { concept: "techno", bpm: 128 },
      ),
    ).toBe("78");
  });
});
