import { describe, it, expect } from "vitest";
import {
  functionColorHex,
  chordFunction,
  presetToChords,
  CHORD_QUALITIES,
  chordFromDegree,
  chordsToHoneycombText,
  honeycombTextToChords,
  qualityLabel,
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

describe("extended qualities through the honeycomb bridge", () => {
  /** Build a one-chord progression at a roman numeral we control. */
  function chordAt(romanNumeral: string, quality: Chord["quality"], root = "C"): Chord {
    return { id: romanNumeral, romanNumeral, root, quality, beats: 4 };
  }

  it("labels chips with the player's symbol, not the internal key", () => {
    expect(qualityLabel("maj")).toBe("maj");
    expect(qualityLabel("min9")).toBe("m9");
    expect(qualityLabel("maj13")).toBe("maj13");
    expect(qualityLabel("m7b5")).toBe("m7♭5");
  });

  it("round-trips every extended quality through text without losing it", () => {
    const qualities: Chord["quality"][] = [
      "5", "6", "min6", "69", "add9", "dim7", "mMaj7", "maj7#5",
      "7sus4", "7b5", "7#5", "9", "maj9", "min9", "9sus4",
      "7b9", "7#9", "7#11", "7b13", "11", "min11", "13", "maj13", "min13",
    ];
    for (const quality of qualities) {
      const text = chordsToHoneycombText([chordAt("I", quality, "C")]);
      const [back] = honeycombTextToChords(text, "C", 4);
      expect(back?.quality, `${quality} → "${text}"`).toBe(quality);
      // Fully described by `quality`, so no second source of truth.
      expect(back?.extendedSuffix, `${quality} keeps no stray suffix`).toBeUndefined();
      expect(back?.root, `${quality} keeps its root`).toBe("C");
    }
  });

  it("keeps a suffix the vocabulary cannot hold as extendedSuffix", () => {
    const [chord] = honeycombTextToChords("I7#9b13", "C", 4);
    expect(chord?.quality).toBe("7");
    expect(chord?.extendedSuffix).toBe("7#9b13");
  });

  it("offers the five- and six-note qualities to the editor", () => {
    for (const quality of ["9", "maj9", "min9", "11", "min11", "13", "maj13", "min13"] as const) {
      expect(CHORD_QUALITIES).toContain(quality);
    }
  });
});
