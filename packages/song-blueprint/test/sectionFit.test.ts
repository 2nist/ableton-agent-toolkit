import { describe, it, expect } from "vitest";
import { beatsPerBar, sectionDurationBeats, describeProgressionFit } from "../src/index";
import type { BlueprintSection, Chord } from "../src/index";

function chord(beats: number): Chord {
  return { id: Math.random().toString(36), romanNumeral: "I", root: "C", quality: "maj", beats };
}

function section(overrides: Partial<BlueprintSection> = {}): BlueprintSection {
  return {
    id: "s1",
    name: "verse",
    role: "verse",
    bars: 4,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2, // denominator = 2^2 = 4
    ...overrides,
  };
}

describe("beatsPerBar", () => {
  it("computes 4 beats/bar for 4/4", () => {
    expect(beatsPerBar(section())).toBe(4);
  });

  it("computes 3 beats/bar for 6/8 (denPower=3 -> denominator 8)", () => {
    expect(beatsPerBar(section({ timeSignatureNumerator: 6, timeSignatureDenPower: 3 }))).toBe(3);
  });

  it("computes 3.5 beats/bar for 7/8 (denominator-aware, not numerator-only)", () => {
    expect(beatsPerBar(section({ timeSignatureNumerator: 7, timeSignatureDenPower: 3 }))).toBe(3.5);
  });
});

describe("sectionDurationBeats", () => {
  it("multiplies bars by beatsPerBar", () => {
    expect(sectionDurationBeats(section({ bars: 8 }))).toBe(32);
  });

  it("respects a non-4/4 time signature", () => {
    // 4 bars of 7/8 = 4 * 3.5 = 14 beats
    expect(sectionDurationBeats(section({ bars: 4, timeSignatureNumerator: 7, timeSignatureDenPower: 3 }))).toBe(14);
  });
});

describe("describeProgressionFit", () => {
  it("returns null for an empty progression", () => {
    expect(describeProgressionFit(section({ chords: [] }))).toBeNull();
  });

  it("reports an exact single-cycle fit", () => {
    // 4-bar section in 4/4 = 16 beats; one 16-beat progression fits exactly once
    const sec = section({ bars: 4, chords: [chord(4), chord(4), chord(4), chord(4)] });
    const fit = describeProgressionFit(sec)!;
    expect(fit.cycleBeats).toBe(16);
    expect(fit.durationBeats).toBe(16);
    expect(fit.wholeCycles).toBe(1);
    expect(fit.remainderBeats).toBe(0);
    expect(fit.overflowBeats).toBe(0);
  });

  it("reports a clean N-times loop", () => {
    // 8-bar section = 32 beats; a 2-chord/8-beat cycle loops exactly 4 times
    const sec = section({ bars: 8, chords: [chord(4), chord(4)] });
    const fit = describeProgressionFit(sec)!;
    expect(fit.cycleBeats).toBe(8);
    expect(fit.durationBeats).toBe(32);
    expect(fit.wholeCycles).toBe(4);
    expect(fit.remainderBeats).toBe(0);
    expect(fit.overflowBeats).toBe(0);
  });

  it("reports a loop with a truncated remainder", () => {
    // 3-bar section = 12 beats; a 2-chord/8-beat cycle loops once fully,
    // then a 4-beat partial repeat (matches loopChordsToFill's own test case)
    const sec = section({ bars: 3, chords: [chord(4), chord(4)] });
    const fit = describeProgressionFit(sec)!;
    expect(fit.cycleBeats).toBe(8);
    expect(fit.durationBeats).toBe(12);
    expect(fit.wholeCycles).toBe(1);
    expect(fit.remainderBeats).toBe(4);
    expect(fit.overflowBeats).toBe(0);
  });

  it("reports overflow when the progression alone exceeds the section", () => {
    // 2-bar section = 8 beats; a 4-chord/16-beat progression overflows by 8
    const sec = section({ bars: 2, chords: [chord(4), chord(4), chord(4), chord(4)] });
    const fit = describeProgressionFit(sec)!;
    expect(fit.cycleBeats).toBe(16);
    expect(fit.durationBeats).toBe(8);
    expect(fit.wholeCycles).toBe(0);
    expect(fit.remainderBeats).toBe(8);
    expect(fit.overflowBeats).toBe(8);
  });
});
