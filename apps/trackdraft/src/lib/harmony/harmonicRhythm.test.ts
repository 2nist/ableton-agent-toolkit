import { describe, it, expect } from "vitest";
import {
  MIN_CHORD_BEATS,
  cycleBars,
  cycleBeats,
  cycleRepeats,
  dominantBeatsPerChord,
  evenHarmonicRhythm,
  redistributeBeats,
  repeatsEvenly,
  rhythmPresets,
} from "./harmonicRhythm";
import type { Chord } from "../../types/blueprint";

const chord = (id: string, beats: number): Chord => ({
  id,
  romanNumeral: id,
  root: "C",
  quality: "maj",
  beats,
});

/** Four chords, one per bar in 4/4 — a 16-beat (4-bar) cycle. */
const progression = (): Chord[] => [
  chord("I", 4),
  chord("vi", 4),
  chord("IV", 4),
  chord("V", 4),
];

describe("cycleBeats / cycleBars / cycleRepeats", () => {
  it("sums the chord lengths into one pass", () => {
    expect(cycleBeats(progression())).toBe(16);
    expect(cycleBars(progression(), 4)).toBe(4);
    expect(cycleBeats([])).toBe(0);
  });

  it("counts how many passes fit a section", () => {
    expect(cycleRepeats(progression(), 64)).toBe(4);
    expect(cycleRepeats(progression(), 32)).toBe(2);
    expect(cycleRepeats(progression(), 24)).toBe(1.5);
    expect(cycleRepeats(progression(), 0)).toBe(0);
  });

  it("knows when the cycle truncates", () => {
    expect(repeatsEvenly(progression(), 64)).toBe(true);
    expect(repeatsEvenly(progression(), 24)).toBe(false);
    expect(repeatsEvenly([], 24)).toBe(false);
  });
});

describe("redistributeBeats", () => {
  it("moves the boundary and keeps the cycle length", () => {
    const moved = redistributeBeats(progression(), 0, 2);
    expect(moved.map((c) => c.beats)).toEqual([6, 2, 4, 4]);
    expect(cycleBeats(moved)).toBe(16);
  });

  it("works for an interior boundary", () => {
    const moved = redistributeBeats(progression(), 1, -1);
    expect(moved.map((c) => c.beats)).toEqual([4, 3, 5, 4]);
  });

  it("snaps the boundary to the half-beat grid", () => {
    expect(redistributeBeats(progression(), 0, 1.26).map((c) => c.beats)).toEqual([5.5, 2.5, 4, 4]);
    expect(redistributeBeats(progression(), 0, 0.24).map((c) => c.beats)).toEqual([4, 4, 4, 4]);
  });

  it("never shrinks a chord below one grid cell", () => {
    const squeezed = redistributeBeats(progression(), 0, 99);
    expect(squeezed[0].beats).toBe(7.5);
    expect(squeezed[1].beats).toBe(MIN_CHORD_BEATS);
    const pulled = redistributeBeats(progression(), 0, -99);
    expect(pulled[0].beats).toBe(MIN_CHORD_BEATS);
    expect(pulled[1].beats).toBe(7.5);
  });

  it("leaves the last chord's end alone", () => {
    const chords = progression();
    expect(redistributeBeats(chords, 3, 2)).toBe(chords);
    expect(redistributeBeats(chords, 9, 2)).toBe(chords);
  });

  it("keeps velocities and ids untouched on other chords", () => {
    const moved = redistributeBeats(progression(), 0, 2);
    expect(moved[2]).toEqual(chord("IV", 4));
    expect(moved[0].id).toBe("I");
  });
});

describe("evenHarmonicRhythm", () => {
  it("gives every chord the same length", () => {
    const uneven = [chord("I", 6), chord("vi", 2), chord("IV", 4), chord("V", 4)];
    const even = evenHarmonicRhythm(uneven, 4);
    expect(even.map((c) => c.beats)).toEqual([4, 4, 4, 4]);
  });

  it("changes the cycle length, so the repeat rate follows", () => {
    const halfBar = evenHarmonicRhythm(progression(), 2);
    expect(cycleBeats(halfBar)).toBe(8);
    expect(cycleRepeats(halfBar, 64)).toBe(8);
  });

  it("returns the same array when nothing would change", () => {
    const chords = progression();
    expect(evenHarmonicRhythm(chords, 4)).toBe(chords);
  });

  it("refuses a length below the floor", () => {
    expect(evenHarmonicRhythm(progression(), 0)[0].beats).toBe(MIN_CHORD_BEATS);
  });
});

describe("dominantBeatsPerChord", () => {
  it("picks the most common length", () => {
    expect(dominantBeatsPerChord(progression())).toBe(4);
    expect(dominantBeatsPerChord([chord("I", 4), chord("vi", 2), chord("IV", 2)])).toBe(2);
  });

  it("falls back for an empty progression", () => {
    expect(dominantBeatsPerChord([])).toBe(4);
  });
});

describe("rhythmPresets", () => {
  it("offers two bars, one bar and half a bar", () => {
    expect(rhythmPresets(4).map((p) => p.beats)).toEqual([8, 4, 2]);
    expect(rhythmPresets(3).map((p) => p.beats)).toEqual([6, 3, 1.5]);
  });

  it("falls back to 4/4 timing for a broken meter", () => {
    expect(rhythmPresets(0).map((p) => p.beats)).toEqual([8, 4, 2]);
  });
});
