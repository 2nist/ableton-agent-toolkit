import { describe, expect, it } from "vitest";
import { diatonicChordQualities } from "./chords";

describe("diatonicChordQualities", () => {
  it("derives the major-scale vocabulary", () => {
    expect(diatonicChordQualities("ionian").sort()).toEqual(
      ["dim", "m7b5", "maj", "maj7", "min", "min7", "7"].sort(),
    );
  });

  it("derives the natural-minor vocabulary", () => {
    const q = diatonicChordQualities("aeolian");
    expect(q).toEqual(expect.arrayContaining(["min", "dim", "maj", "min7", "m7b5", "maj7", "7"]));
    expect(q).not.toContain("mMaj7");
  });

  it("keeps every mode's vocabulary distinct where the mode differs", () => {
    // Dorian's IV is major and its i is a minor seventh chord.
    expect(diatonicChordQualities("dorian")).toContain("min7");
    expect(diatonicChordQualities("lydian")).toContain("maj7");
    expect(diatonicChordQualities("phrygian")).toContain("maj");
  });

  it("returns no duplicates", () => {
    const q = diatonicChordQualities("mixolydian");
    expect(new Set(q).size).toBe(q.length);
  });
});
