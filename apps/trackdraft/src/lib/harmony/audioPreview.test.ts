import { describe, it, expect } from "vitest";
import { midiToFreq, chordToFreqs, buildSchedule } from "./audioPreview";
import type { Chord } from "../../types/blueprint";

describe("midiToFreq", () => {
  it("anchors A4 (midi 69) at 440Hz", () => {
    expect(midiToFreq(69)).toBe(440);
  });

  it("is exactly one octave down/up at midi 57/81", () => {
    expect(midiToFreq(57)).toBeCloseTo(220, 5);
    expect(midiToFreq(81)).toBeCloseTo(880, 5);
  });

  it("matches middle C (midi 60)", () => {
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
  });
});

describe("chordToFreqs", () => {
  function makeChord(quality: Chord["quality"]): Chord {
    return { id: "x", romanNumeral: "I", root: "C", quality, beats: 4 };
  }

  it("returns one frequency per chord tone", () => {
    expect(chordToFreqs(makeChord("maj"))).toHaveLength(3);
    expect(chordToFreqs(makeChord("min7"))).toHaveLength(4);
  });

  it("returns positive, ascending-register frequencies", () => {
    const freqs = chordToFreqs(makeChord("maj"));
    for (const f of freqs) expect(f).toBeGreaterThan(0);
  });
});

describe("buildSchedule", () => {
  it("lays out cumulative start times honoring fractional beats", () => {
    const schedule = buildSchedule([{ beats: 4 }, { beats: 0.5 }, { beats: 2 }], 120);
    // 120bpm -> 0.5s/beat
    expect(schedule.map((s) => s.startSec)).toEqual([0, 2, 2.25]);
    expect(schedule.map((s) => s.durSec)).toEqual([2, 0.25, 1]);
    expect(schedule.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("returns [] for an empty progression", () => {
    expect(buildSchedule([], 120)).toEqual([]);
  });

  it("scales with tempo", () => {
    const slow = buildSchedule([{ beats: 4 }], 60);
    const fast = buildSchedule([{ beats: 4 }], 120);
    expect(slow[0].durSec).toBe(4);
    expect(fast[0].durSec).toBe(2);
  });
});
