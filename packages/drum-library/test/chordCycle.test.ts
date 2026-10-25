import { describe, expect, it } from "vitest";
import {
  loopChordsToFill,
  loopChordsOnOutline,
  resolveChordOccurrences,
  applySyncopation,
  chordCycleBeats,
  type ChordOccurrence,
} from "../src/chordCycle.js";
import type { MeterOutline } from "../src/meter.js";

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

describe("resolveChordOccurrences — bend spacing (density nudge)", () => {
  it("spacing re-times the plain per-chord case only", () => {
    const section = { chords: twoChordCycle };
    const tight = resolveChordOccurrences(section, 16, 0.9);
    // 4-beat chords at 0.9 → 3.6-beat spans → more, denser changes.
    expect(tight.map((o) => o.startTime)).toEqual([0, 3.6, 7.2, 10.8, 14.4]);
  });

  it("an outline is never stretched (spacing ignored)", () => {
    const section = { harmonyMeterOutline: SEVEN_EIGHT, chords: twoChordCycle };
    const occ = resolveChordOccurrences(section, 7, 0.9);
    expect(occ.map((o) => o.startTime)).toEqual([0, 1, 2, 3.5, 4.5, 5.5]);
  });

  it("spacing 1 == historical behavior", () => {
    const section = { chords: twoChordCycle };
    expect(resolveChordOccurrences(section, 16, 1)).toEqual(resolveChordOccurrences(section, 16));
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

describe("rests — silence inside the cycle", () => {
  // A rest is written on the chord BEFORE it, so the progression stays a
  // sequence and no absolute start times have to be maintained.
  const withRest = [C(4), { root: "G", beats: 4, restAfter: 4 }];

  it("the cycle gets longer, so the loop repeats less often", () => {
    expect(chordCycleBeats(withRest)).toBe(12);
    expect(loopChordsToFill(withRest, 24).map((o) => o.startTime)).toEqual([0, 4, 12, 16]);
  });

  it("no occurrence is emitted during the rest", () => {
    const occ = loopChordsToFill(withRest, 24);
    const inRest = occ.filter((o) => o.startTime >= 8 && o.startTime < 12);
    expect(inRest).toEqual([]);
  });

  it("the chord before a rest keeps its own length", () => {
    const occ = loopChordsToFill(withRest, 24);
    expect(occ.map((o) => o.duration)).toEqual([4, 4, 4, 4]);
  });

  it("restBefore places the first chord late, and repeats with the cycle", () => {
    const pickup = [{ root: "C", beats: 4, restBefore: 2 }, G(2)];
    const occ = loopChordsToFill(pickup, 16);
    // 8-beat cycle: 2 of silence, C, G.
    expect(occ.map((o) => o.startTime)).toEqual([2, 6, 10, 14]);
  });

  it("a trailing rest shortens the loop without stretching the last chord", () => {
    const occ = loopChordsToFill([C(2), { root: "G", beats: 2, restAfter: 4 }], 8);
    expect(occ.map((o) => o.startTime)).toEqual([0, 2]);
    expect(occ.map((o) => o.duration)).toEqual([2, 2]);
  });

  it("rests are never scaled by the bend spacing", () => {
    const occ = loopChordsToFill(withRest, 24, 0.5);
    // Chords halve, the 4-beat rest does not.
    expect(occ.map((o) => o.startTime)).toEqual([0, 2, 8, 10, 16, 18]);
  });

  it("syncopation cannot stretch a chord across a rest", () => {
    const occ = applySyncopation(loopChordsToFill(withRest, 24), 0.5);
    // G pushes early to 3.5 and keeps its written END at 8: it must not
    // stretch to the next onset at 11.5, which would swallow the authored
    // rest at 8–12.
    expect(occ[1].startTime).toBe(3.5);
    expect(occ[1].startTime + occ[1].duration).toBe(8);
    // The rest itself stays empty; the only thing in it is the NEXT chord's
    // half-beat anticipation at 11.5, which is what the push is for.
    expect(occ.filter((o) => o.startTime > 8 && o.startTime < 11.5)).toEqual([]);
    expect(occ[2].startTime).toBe(11.5);
  });

  it("a chord still stretches to the next onset when there is no rest", () => {
    const occ = applySyncopation(loopChordsToFill([C(4), G(4)], 8), 0.5);
    expect(occ.map((o) => o.startTime)).toEqual([0, 3.5]);
    expect(occ.map((o) => o.duration)).toEqual([3.5, 4.5]);
  });

  it("zero and negative rests are ignored", () => {
    expect(loopChordsToFill([{ root: "C", beats: 4, restAfter: 0 }], 8).map((o) => o.startTime)).toEqual([0, 4]);
    expect(loopChordsToFill([{ root: "C", beats: 4, restAfter: -2 }], 8).map((o) => o.startTime)).toEqual([0, 4]);
  });
});
