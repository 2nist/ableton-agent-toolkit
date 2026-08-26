import { describe, expect, it } from "vitest";
import {
  createPattern,
  patternLengthBeats,
  patternToClipNotes,
  setStep,
  swingOffsetBeats,
  stepTriggers,
} from "../src/index.js";

// 16 rack notes (kick 36 .. clap 51 across the 16-pad map).
const VOICE_NOTES = Array.from({ length: 16 }, (_, i) => 36 + i);

describe("stepTriggers", () => {
  it("returns nothing on empty steps and past the length", () => {
    const p = createPattern(16, 8);
    expect(stepTriggers(p, 0, VOICE_NOTES)).toEqual([]);
    expect(stepTriggers(p, 8, VOICE_NOTES)).toEqual([]);
  });

  it("returns the rack notes for hit voices with effective velocity", () => {
    let p = createPattern(16, 32);
    p = setStep(p, 0, 0, { velocity: 100, accent: false });
    p = setStep(p, 3, 0, { velocity: 100, accent: true });
    const triggers = stepTriggers(p, 0, VOICE_NOTES);
    expect(triggers).toEqual([
      { pitch: 36, velocity: 100 },
      { pitch: 39, velocity: 124 },
    ]);
  });
});

describe("patternToClipNotes", () => {
  it("builds one note per hit in beats", () => {
    let p = createPattern(16, 16, "16");
    p = setStep(p, 0, 0, { velocity: 100, accent: false });
    p = setStep(p, 1, 4, { velocity: 80, accent: true });
    const notes = patternToClipNotes(p, VOICE_NOTES);
    expect(notes).toEqual([
      { pitch: 36, startBeat: 0, durationBeats: 0.25, velocity: 100 },
      { pitch: 37, startBeat: 1, durationBeats: 0.25, velocity: 104 },
    ]);
  });

  it("sorts by start beat then pitch", () => {
    let p = createPattern(4, 8, "16");
    p = setStep(p, 2, 1, { velocity: 100, accent: false });
    p = setStep(p, 0, 0, { velocity: 100, accent: false });
    const notes = patternToClipNotes(p, VOICE_NOTES);
    expect(notes[0]!.startBeat).toBe(0);
    expect(notes[1]!.startBeat).toBe(0.25);
    expect(notes[1]!.pitch).toBe(38);
  });

  it("falls back to 36+voice when the note table is short", () => {
    let p = createPattern(16, 4, "16");
    p = setStep(p, 10, 0, { velocity: 100, accent: false });
    const notes = patternToClipNotes(p, [36]); // table shorter than voices
    expect(notes[0]!.pitch).toBe(46); // 36 + 10
  });

  it("patternLengthBeats reflects resolution and length", () => {
    expect(patternLengthBeats(createPattern(16, 16, "16"))).toBe(4);
    expect(patternLengthBeats(createPattern(16, 32, "8"))).toBe(16);
  });
});

describe("swingOffsetBeats", () => {
  it("returns 0 for even steps and zero swing", () => {
    expect(swingOffsetBeats(0, 50, "16")).toBe(0);
    expect(swingOffsetBeats(1, 0, "16")).toBe(0);
  });

  it("delays offbeat steps proportional to swing", () => {
    // Half a 16th = 0.125 beats; 50% swing → 0.0625
    expect(swingOffsetBeats(1, 50, "16")).toBeCloseTo(0.0625);
    // Half an 8th = 0.25 beats; 100% swing → 0.25
    expect(swingOffsetBeats(1, 100, "8")).toBeCloseTo(0.25);
  });
});
