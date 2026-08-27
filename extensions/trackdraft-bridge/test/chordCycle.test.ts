import { describe, expect, it } from "vitest";
import { loopChordsToFill, loopChordsOnOutline, resolveChordOccurrences } from "../src/chordCycle.js";
import { makeChord, makeSection } from "./helpers.js";

const twoChordCycle = [
  makeChord({ romanNumeral: "I", root: "C", quality: "maj", beats: 4 }),
  makeChord({ romanNumeral: "V", root: "G", quality: "maj", beats: 4 }),
];

/** 7/8 as 2+2+3 at cellBeats 0.5 → bar = 3.5 beats; cell starts at 0, 1, 2. */
const SEVEN_EIGHT = { cellBeats: 0.5, cells: [2, 2, 3], label: "1 2 1 2 1 2 3" } as const;

describe("loopChordsToFill", () => {
  it("repeats the cycle until durationBeats is filled", () => {
    const occ = loopChordsToFill(twoChordCycle, 16);
    expect(occ.map((o) => o.startTime)).toEqual([0, 4, 8, 12]);
    expect(occ.map((o) => o.chord.romanNumeral)).toEqual(["I", "V", "I", "V"]);
    occ.forEach((o) => expect(o.duration).toBe(4));
  });

  it("truncates the final repeat instead of overshooting", () => {
    const occ = loopChordsToFill(twoChordCycle, 12);
    expect(occ).toHaveLength(3);
    expect(occ[2]).toEqual({ chord: twoChordCycle[0], startTime: 8, duration: 4 });
  });

  it("returns empty for no chords or a zero-length cycle", () => {
    expect(loopChordsToFill([], 16)).toEqual([]);
    expect(loopChordsToFill([makeChord({ romanNumeral: "I", root: "C", quality: "maj", beats: 0 })], 16)).toEqual([]);
  });
});

describe("loopChordsOnOutline — Euclidean harmony", () => {
  it("advances chords on each 2s/3s cell start instead of per-chord beats", () => {
    const occ = loopChordsOnOutline(twoChordCycle, SEVEN_EIGHT, 7);
    expect(occ.map((o) => o.startTime)).toEqual([0, 1, 2, 3.5, 4.5, 5.5]);
    expect(occ.map((o) => o.chord.romanNumeral)).toEqual(["I", "V", "I", "V", "I", "V"]);
    // each chord runs to the next onset
    expect(occ.map((o) => o.duration)).toEqual([1, 1, 1.5, 1, 1, 1.5]);
  });
});

describe("resolveChordOccurrences — honors Euclidean harmony on a section", () => {
  it("uses the harmonyMeterOutline when set", () => {
    const section = makeSection({
      id: "1", name: "V", bars: 1, timeSignatureNumerator: 4,
      harmonyMeterOutline: SEVEN_EIGHT, chords: twoChordCycle,
    });
    const occ = resolveChordOccurrences(section, 7);
    expect(occ[0].startTime).toBe(0);
    expect(occ[1].startTime).toBe(1);
    expect(occ.length).toBeGreaterThan(2);
  });

  it("follows the drums' outline when harmonyFollowsDrums is set and no explicit outline", () => {
    const section = makeSection({
      id: "1", name: "V", bars: 1, timeSignatureNumerator: 4,
      harmonyFollowsDrums: true, drumMeterOutline: SEVEN_EIGHT, chords: twoChordCycle,
    });
    const occ = resolveChordOccurrences(section, 7);
    expect(occ.map((o) => o.startTime)).toEqual([0, 1, 2, 3.5, 4.5, 5.5]);
  });

  it("falls back to per-chord beats when neither harmony field is set", () => {
    const section = makeSection({ id: "1", name: "V", bars: 1, timeSignatureNumerator: 4, chords: twoChordCycle });
    const occ = resolveChordOccurrences(section, 16);
    expect(occ.map((o) => o.startTime)).toEqual([0, 4, 8, 12]);
  });
});

describe("resolveChordOccurrences — syncopationOffset (jazz push)", () => {
  it("pushes every chord change early by the offset, clamping the section's first chord", () => {
    const section = makeSection({
      id: "1", name: "V", bars: 1, timeSignatureNumerator: 4,
      chords: twoChordCycle, syncopationOffset: 0.5,
    });
    const occ = resolveChordOccurrences(section, 16);
    // chords were at 0,4,8,12 → pushed to 0 (clamped), 3.5, 7.5, 11.5
    expect(occ.map((o) => o.startTime)).toEqual([0, 3.5, 7.5, 11.5]);
    // the last chord still reaches the section end (16)
    expect(occ[3].startTime + occ[3].duration).toBe(16);
  });

  it("applies to Euclidean harmony onsets too", () => {
    const section = makeSection({
      id: "1", name: "V", bars: 1, timeSignatureNumerator: 4,
      harmonyMeterOutline: SEVEN_EIGHT, chords: twoChordCycle, syncopationOffset: 0.5,
    });
    const occ = resolveChordOccurrences(section, 7);
    // onsets 0,1,2,3.5,4.5,5.5 → 0 (clamped), 0.5, 1.5, 3, 4, 5
    expect(occ.map((o) => o.startTime)).toEqual([0, 0.5, 1.5, 3, 4, 5]);
  });

  it("leaves occurrences untouched when no offset is set", () => {
    const section = makeSection({ id: "1", name: "V", bars: 1, timeSignatureNumerator: 4, chords: twoChordCycle });
    expect(resolveChordOccurrences(section, 16).map((o) => o.startTime)).toEqual([0, 4, 8, 12]);
  });
});
