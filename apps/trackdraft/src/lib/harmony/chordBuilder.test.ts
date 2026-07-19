import { describe, it, expect } from "vitest";
import {
  functionColorHex,
  chordFunction,
  presetToChords,
  CHORD_QUALITIES,
  chordFromDegree,
} from "./chordBuilder";
import type { Chord } from "../../types/blueprint";

describe("functionColorHex", () => {
  it("converts the known function codes to hex strings", () => {
    expect(functionColorHex("T")).toBe("#34d399");
    expect(functionColorHex("PD")).toBe("#60a5fa");
    expect(functionColorHex("D")).toBe("#f87171");
    expect(functionColorHex("B")).toBe("#a78bfa");
  });

  it("returns null for an unknown or missing function", () => {
    expect(functionColorHex("nonsense")).toBeNull();
    expect(functionColorHex(undefined)).toBeNull();
    expect(functionColorHex(null)).toBeNull();
  });
});

describe("chordFunction", () => {
  function makeChord(romanNumeral: string): Chord {
    return { id: "x", romanNumeral, root: "C", quality: "maj", beats: 4 };
  }

  it("resolves a diatonic numeral's function under the given scale", () => {
    expect(chordFunction(makeChord("V"), "ionian")).toBe("D");
    expect(chordFunction(makeChord("ii"), "ionian")).toBe("PD");
    expect(chordFunction(makeChord("I"), "ionian")).toBe("T");
  });

  it("resolves borrowed numerals too (they carry their own func)", () => {
    expect(chordFunction(makeChord("♭VII"), "ionian")).toBe("B");
  });

  it("returns null for a numeral the scale doesn't recognize", () => {
    expect(chordFunction(makeChord("V"), "dorian")).toBeNull();
    expect(chordFunction(makeChord("nonsense"), "ionian")).toBeNull();
  });

  it("recomputes rather than trusting a stale stored function", () => {
    const chord = { ...makeChord("V"), function: "T" }; // deliberately wrong
    expect(chordFunction(chord, "ionian")).toBe("D");
  });
});

describe("CHORD_QUALITIES", () => {
  it("is non-empty and matches the qualities chordFromDegree can assign", () => {
    expect(CHORD_QUALITIES.length).toBeGreaterThan (0);
    expect(CHORD_QUALITIES).toContain("maj");
    expect(CHORD_QUALITIES).toContain("min7");
  });
});

describe("presetToChords", () => {
  it("resolves the Andalusian cadence in A: i-bVII-bVI-V, aeolian roots A-G-F-E", () => {
    const chords = presetToChords("andalusian", "A", 4);
    expect(chords).toHaveLength(4);
    expect(chords.map((c) => c.romanNumeral)).toEqual(["i", "♭VII", "♭VI", "V"]);
    expect(chords.map((c) => c.root)).toEqual(["A", "G", "F", "E"]);
    expect(chords.map((c) => c.quality)).toEqual(["min", "maj", "maj", "maj"]);
    expect(chords.every((c) => c.beats === 4)).toBe(true);
  });

  it("mints a fresh id per chord, distinct from other presets", () => {
    const a = presetToChords("andalusian", "A", 4);
    const b = presetToChords("andalusian", "A", 4);
    expect(new Set(a.map((c) => c.id)).size).toBe(4);
    expect(a.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
  });

  it("returns [] for an unknown preset key", () => {
    expect(presetToChords("not-a-real-preset", "C", 4)).toEqual([]);
  });
});

describe("chordFromDegree (regression: id/shape unaffected by new exports)", () => {
  it("still builds a chord with a resolved absolute root", () => {
    const chord = chordFromDegree(0, "C", "V", "maj", 7, 4);
    expect(chord.root).toBe("G");
    expect(chord.romanNumeral).toBe("V");
    expect(chord.quality).toBe("maj");
    expect(chord.beats).toBe(4);
    expect(chord.id).toBeTruthy();
  });
});
