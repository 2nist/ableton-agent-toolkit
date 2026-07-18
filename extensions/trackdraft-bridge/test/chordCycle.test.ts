import { describe, expect, it } from "vitest";
import { loopChordsToFill } from "../src/chordCycle.js";
import type { BlueprintChord } from "../src/blueprint.js";

const twoChordCycle: BlueprintChord[] = [
  { romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
  { romanNumeral: "V", root: "G", quality: "maj", beats: 4 },
];

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
    expect(loopChordsToFill([{ romanNumeral: "I", root: "C", quality: "maj", beats: 0 }], 16)).toEqual([]);
  });
});
