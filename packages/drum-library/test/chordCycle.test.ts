import { describe, expect, it } from "vitest";
import {
  loopChordsToFill,
  loopChordsOnOutline,
  resolveChordOccurrences,
  applySyncopation,
  type MeterOutline,
  type ChordOccurrence,
} from "../src/chordCycle.js";

/** A minimal structural chord (the schema's `Chord` has `beats` too). */
const C = (beats: number, root = "C") => ({ root, beats });
const G = (beats: number) => ({ root: "G", beats });

const twoChordCycle = [C(4), G(4)];

/** 7/8 as 2+2+3 at cellBeats 0.5 → bar = 3.5 beats; cell starts at 0, 1, 2. */
const SEVEN_EIGHT: MeterOutline = { cellBeats: 0.5, cells: [2, 2, 3], label: "1 2 1 2 1 2 3" };

describe("loopChordsToFill", () => {
  it("repeats the cycle until durationBeats is filled, truncating the tail", () => {
    const occ = loopChordsToFill(twoChordCycle, 12);
    expect(occ.map((o) => o.startTime)).toEqual([0, 4, 8]);
    expect(occ.map((o) => o.chord.root)).toEqual(["C", "G", "C"]);
    expect(occ[2].duration).toBe(4);
  });

  it("returns empty for no chords or a zero-length cycle", () => {
    expect(loopChordsToFill([], 16)).toEqual([]);
    expect(loopChordsToFill([C(0)], 16)).toEqual([]);
  });
});

describe("loopChordsOnOutline — Euclidean harmony", () => {
  it("advances chords on each 2s/3s cell start instead of per-chord beats", () => {
    const occ = loopChordsOnOutline(twoChordCycle, SEVEN_EIGHT, 7);
    expect(occ.map((o) => o.startTime)).toEqual([0, 1, 2, 3.5, 4.5, 5.5]);
    expect(occ.map((o) => o.duration)).toEqual([1, 1, 1.5, 1, 1, 1.5]);
  });
});

describe("resolveChordOccurrences — follow-drums default + explicit opt-out", () => {
  const section = (over: object) => ({ chords: twoChordCycle, ...over });

  it("follows the drums' outline by default when the section has one", () => {
    const occ = resolveChordOccurrences(section({ drumMeterOutline: SEVEN_EIGHT }), 7);
    expect(occ.map((o) => o.startTime)).toEqual([0, 1, 2, 3.5, 4.5, 5.5]);
  });

  it("an explicit harmonyMeterOutline wins over the drums' outline", () => {
    const occ = resolveChordOccurrences(section({ harmonyMeterOutline: SEVEN_EIGHT, drumMeterOutline: SEVEN_EIGHT }), 7);
    expect(occ.map((o) => o.startTime)).toEqual([0, 1, 2, 3.5, 4.5, 5.5]);
  });

  it("harmonyFollowsDrums: false opts back onto per-chord beats", () => {
    const occ = resolveChordOccurrences(section({ harmonyFollowsDrums: false, drumMeterOutline: SEVEN_EIGHT }), 16);
    expect(occ.map((o) => o.startTime)).toEqual([0, 4, 8, 12]);
  });

  it("plain per-chord beats when nothing sets an outline", () => {
    const occ = resolveChordOccurrences(section({}), 16);
    expect(occ.map((o) => o.startTime)).toEqual([0, 4, 8, 12]);
  });
});

describe("applySyncopation — jazz push", () => {
  const occ: ChordOccurrence[] = [
    { chord: C(4), startTime: 0, duration: 4 },
    { chord: G(4), startTime: 4, duration: 4 },
  ];

  it("shifts every change early, clamps the first to 0, last still reaches the end", () => {
    const pushed = applySyncopation(occ, 0.5);
    expect(pushed.map((o) => o.startTime)).toEqual([0, 3.5]);
    expect(pushed.map((o) => o.duration)).toEqual([3.5, 4.5]);
  });

  it("no-op for absent or non-positive offsets", () => {
    expect(applySyncopation(occ, undefined)).toEqual(occ);
    expect(applySyncopation(occ, 0)).toEqual(occ);
  });
});
