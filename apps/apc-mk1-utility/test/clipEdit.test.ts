import { describe, expect, it } from "vitest";
import {
  describeBankParams,
  euclideanPattern,
  generateEuclidean,
  transformPitch,
  transformTime,
  transformTransform,
  type ClipNote,
} from "../src/lib/clipEdit";

function note(overrides: Partial<ClipNote> = {}): ClipNote {
  return { pitch: 60, startTime: 0, duration: 0.25, velocity: 100, mute: 0, ...overrides };
}

describe("transformPitch", () => {
  it("fader 1 at center (64) leaves pitch unchanged", () => {
    const notes = [note({ pitch: 60 })];
    expect(transformPitch(notes, [64, 64])[0]!.pitch).toBe(60);
  });

  it("fader 1 at max transposes up by +24 semitones", () => {
    const notes = [note({ pitch: 60 })];
    expect(transformPitch(notes, [127, 64])[0]!.pitch).toBe(84);
  });

  it("fader 1 at min transposes down by -24 semitones", () => {
    const notes = [note({ pitch: 60 })];
    expect(transformPitch(notes, [0, 64])[0]!.pitch).toBe(36);
  });

  it("clamps to the valid MIDI pitch range", () => {
    const notes = [note({ pitch: 120 })];
    expect(transformPitch(notes, [127, 64])[0]!.pitch).toBeLessThanOrEqual(127);
  });
});

describe("transformTime", () => {
  it("quantize strength 0 leaves timing unchanged", () => {
    const notes = [note({ startTime: 0.1 })];
    expect(transformTime(notes, [0, 64])[0]!.startTime).toBeCloseTo(0.1);
  });

  it("quantize strength at max (fader=127) snaps fully to the 1/16 grid", () => {
    const notes = [note({ startTime: 0.1 })];
    // nearest 1/16 (0.25 beats) to 0.1 is 0
    expect(transformTime(notes, [127, 64])[0]!.startTime).toBeCloseTo(0);
  });
});

describe("transformTransform", () => {
  it("fader 1 at center (64) leaves velocity unchanged", () => {
    const notes = [note({ velocity: 80 })];
    expect(transformTransform(notes, [64, 0], 4)[0]!.velocity).toBe(80);
  });

  it("fader 1 at max doubles velocity, clamped to 127", () => {
    const notes = [note({ velocity: 80 })];
    expect(transformTransform(notes, [127, 0], 4)[0]!.velocity).toBe(127);
  });

  it("fader 2 above 64 reverses note position within the clip length", () => {
    const notes = [note({ startTime: 0, duration: 1 })];
    // clip length 4, note at [0,1) -> reversed start = 4 - 0 - 1 = 3
    expect(transformTransform(notes, [64, 100], 4)[0]!.startTime).toBe(3);
  });

  it("fader 2 at or below 64 leaves position unchanged", () => {
    const notes = [note({ startTime: 0, duration: 1 })];
    expect(transformTransform(notes, [64, 64], 4)[0]!.startTime).toBe(0);
  });
});

describe("euclideanPattern", () => {
  it("distributes pulses evenly and produces exactly `pulses` hits", () => {
    const pattern = euclideanPattern(4, 16);
    expect(pattern.filter(Boolean)).toHaveLength(4);
    expect(pattern).toHaveLength(16);
  });

  it("0 pulses produces no hits", () => {
    expect(euclideanPattern(0, 16).some(Boolean)).toBe(false);
  });

  it("pulses >= steps fills every step", () => {
    expect(euclideanPattern(16, 16).every(Boolean)).toBe(true);
    expect(euclideanPattern(20, 16).every(Boolean)).toBe(true);
  });
});

describe("generateEuclidean", () => {
  it("fader 1 controls pulse count, spanning the clip length", () => {
    const notes = generateEuclidean([64, 64], 4);
    // fader=64 -> round(64/127*16) = 8 pulses
    expect(notes).toHaveLength(8);
    for (const n of notes) {
      expect(n.startTime).toBeGreaterThanOrEqual(0);
      expect(n.startTime).toBeLessThan(4);
    }
  });

  it("fader 2 controls the generated pitch, clamped to a sane MIDI range", () => {
    const notes = generateEuclidean([64, 0], 4);
    expect(notes[0]!.pitch).toBeGreaterThanOrEqual(0);
    expect(notes[0]!.pitch).toBeLessThanOrEqual(127);
  });
});

describe("describeBankParams", () => {
  it("matches transformPitch's actual math (semitones + octave)", () => {
    expect(describeBankParams("pitch", [127, 64])).toEqual(["+24 st", "+0 oct", "", "", "", "", "", ""]);
    const notes = transformPitch([note({ pitch: 60 })], [127, 64]);
    expect(notes[0]!.pitch).toBe(60 + 24);
  });

  it("matches transformTime's actual math (quantize % + swing %)", () => {
    expect(describeBankParams("time", [127, 64])).toEqual(["100%", "+0%", "", "", "", "", "", ""]);
  });

  it("matches transformTransform's reverse threshold", () => {
    expect(describeBankParams("transform", [64, 64])[1]).toBe("reverse: off");
    expect(describeBankParams("transform", [64, 65])[1]).toBe("reverse: ON");
  });

  it("matches generateEuclidean's pulse count", () => {
    const [pulseLabel] = describeBankParams("generate", [127, 64]);
    expect(pulseLabel).toBe("16/16 steps");
    expect(generateEuclidean([127, 64], 4)).toHaveLength(16);
  });

  it("clip_tools has no fader params to describe", () => {
    expect(describeBankParams("clip_tools", [64, 64])).toEqual(["", "", "", "", "", "", "", ""]);
  });
});
