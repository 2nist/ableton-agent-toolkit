/**
 * Baseline regression suite for the ported @music-theory/core.
 *
 * The source repo (unified-music-platform) had `vitest` as a devDependency
 * but no actual *.test.ts files — there was nothing to "re-run" post-port.
 * This suite exists so the port has real coverage going forward, not because
 * it existed upstream.
 */

import { describe, expect, it } from "vitest";
import {
  buildChord,
  chordName,
  chordToMidiNotes,
  countSubstitutions,
  getChordIntervals,
  getChordSuffix,
  getDiatonicChords,
  getPresetKeys,
  getScaleNotes,
  getSubstitutionsForDegree,
  midiToPitchClass,
  noteName,
  pitchClass,
  resolveProgression,
  CHORD_INTERVALS,
  CHORD_QUALITY_GROUPS,
  CHORD_QUALITY_SUFFIX,
  parseChordQuality,
} from "../src/index.js";

describe("notes", () => {
  it("resolves sharp and flat spellings to the same pitch class", () => {
    expect(pitchClass("C#")).toBe(1);
    expect(pitchClass("Db")).toBe(1);
  });

  it("throws on an unknown note name", () => {
    expect(() => pitchClass("H")).toThrow();
  });

  it("spells pitch 1 as sharp by default, flat under a flat key", () => {
    expect(noteName(1)).toBe("C#");
    expect(noteName(1, "Bb")).toBe("Db");
  });

  it("wraps MIDI notes to a 0-11 pitch class regardless of octave", () => {
    expect(midiToPitchClass(60)).toBe(0); // middle C
    expect(midiToPitchClass(61)).toBe(1);
    expect(midiToPitchClass(0)).toBe(0);
  });
});

describe("chords", () => {
  it("builds full chord names with quality suffixes", () => {
    expect(chordName(0, "maj")).toBe("C");
    expect(chordName(0, "min7")).toBe("Cm7");
    expect(chordName(6, "maj", "Bb")).toBe("Gb"); // flat-key spelling, "maj" suffix is empty
  });

  it("builds MIDI note arrays from root + quality at the given octave", () => {
    // This library's octave convention is `octave * 12 + pitchClass` — octave 4
    // lands at MIDI 48, NOT the scientific-pitch-notation "C4 = 60" convention.
    // Callers generating real MIDI clips (e.g. the chord-assistant extension)
    // need octave + 1 to match Ableton's own note naming.
    expect(chordToMidiNotes(0, "maj", 4)).toEqual([48, 52, 55]);
    expect(chordToMidiNotes(0, "maj", 5)).toEqual([60, 64, 67]); // "middle C" octave, in this library's numbering
  });

  it("resolves a scale degree to a Chord with the mode's diatonic quality", () => {
    const chord = buildChord("C", "V", "ionian");
    expect(chord).toMatchObject({ root: "G", degree: "V", quality: "maj", isSubstitution: false });
  });

  it("flags borrowed (modal interchange) degrees as substitutions", () => {
    const chord = buildChord("C", "♭VII", "ionian");
    expect(chord.isSubstitution).toBe(true);
  });
});

describe("scales", () => {
  it("returns the 7 pitch classes of the ionian (major) scale from C", () => {
    expect(getScaleNotes(0, "ionian")).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it("returns 7 diatonic chords with sequential degree numbers", () => {
    const chords = getDiatonicChords(0, "ionian");
    expect(chords).toHaveLength(7);
    expect(chords.map((c) => c.degree)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("substitutions", () => {
  it("has exactly 147 substitution rules across all 7 modes (7 modes × 7 degrees × 3 subs)", () => {
    expect(countSubstitutions()).toBe(147);
  });

  it("finds the substitution group for a given mode + degree", () => {
    const group = getSubstitutionsForDegree("ionian", 1);
    expect(group?.subs).toHaveLength(3);
  });

  it("returns undefined for a degree with no defined group", () => {
    expect(getSubstitutionsForDegree("ionian", 99)).toBeUndefined();
  });
});

describe("progressions", () => {
  it("has at least the 10 preset progressions documented in prior analysis", () => {
    expect(getPresetKeys().length).toBeGreaterThanOrEqual(10);
  });

  it("resolves a preset into concrete Chord objects in the given key", () => {
    const chords = resolveProgression("pop_progression", "C");
    expect(chords.map((c) => c.root)).toEqual(["C", "G", "A", "F"]); // I-V-vi-IV in C
  });

  it("throws for an unknown preset key", () => {
    expect(() => resolveProgression("not_a_real_preset")).toThrow();
  });
});

describe("extended chord vocabulary", () => {
  it("gives every quality an interval set, a suffix and a picker group", () => {
    const qualities = Object.keys(CHORD_INTERVALS) as (keyof typeof CHORD_INTERVALS)[];
    for (const quality of qualities) {
      expect(CHORD_QUALITY_SUFFIX[quality], `${quality} suffix`).toBeDefined();
      expect(CHORD_INTERVALS[quality].length, `${quality} has tones`).toBeGreaterThanOrEqual(2);
    }
    // Every picker chip must be a real quality, and the groups must cover
    // the vocabulary exactly once — a quality with no chip is unreachable
    // in the Harmony view.
    const grouped = CHORD_QUALITY_GROUPS.flatMap((g) => g.qualities);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(qualities));
  });

  it("stacks upper extensions above the octave so they voice like any chord", () => {
    expect(getChordIntervals("9")).toEqual([0, 4, 7, 10, 14]);
    expect(getChordIntervals("maj13")).toEqual([0, 4, 7, 11, 14, 21]);
    expect(getChordIntervals("7b9")).toEqual([0, 4, 7, 10, 13]);
    expect(getChordIntervals("7#9")).toEqual([0, 4, 7, 10, 15]);
  });

  it("has five- and six-note qualities", () => {
    // The five-note chords (root, third, fifth, seventh, ninth).
    for (const quality of ["9", "maj9", "min9", "69", "7b9", "7#9", "7#11", "7b13", "9sus4"] as const) {
      expect(getChordIntervals(quality), quality).toHaveLength(5);
    }
    // A plain "11" omits the third the way an eleventh chord actually does
    // (the 3rd and 11th clash), which leaves it five tones; the minor
    // eleventh keeps its third, so it is six.
    expect(getChordIntervals("11")).toEqual([0, 7, 10, 14, 17]);
    for (const quality of ["min11", "13", "maj13", "min13"] as const) {
      expect(getChordIntervals(quality), quality).toHaveLength(6);
    }
    expect(getChordIntervals("5")).toEqual([0, 7]);
  });

  it("sounds the new qualities through chordToMidiNotes", () => {
    // Cmaj9 at octave 4 = C4 E4 G4 B4 D5 — five notes, not a plain triad.
    expect(chordToMidiNotes(0, "maj9", 4)).toEqual([48, 52, 55, 59, 62]);
  });

  it("round-trips every quality through its display suffix", () => {
    for (const quality of Object.keys(CHORD_INTERVALS) as (keyof typeof CHORD_INTERVALS)[]) {
      const suffix = getChordSuffix(quality);
      expect(parseChordQuality(suffix), `${quality} → "${suffix}"`).toBe(quality);
    }
  });

  it("resolves the lead-sheet shorthand", () => {
    expect(parseChordQuality("")).toBe("maj");
    expect(parseChordQuality("", true)).toBe("min");
    expect(parseChordQuality("m7")).toBe("min7");
    expect(parseChordQuality("7", true)).toBe("min7");
    expect(parseChordQuality("min7")).toBe("min7");
    expect(parseChordQuality("M7")).toBe("maj7");
    expect(parseChordQuality("Maj9")).toBe("maj9");
    expect(parseChordQuality("mMaj7")).toBe("mMaj7");
    expect(parseChordQuality("Δ7")).toBe("maj7");
    expect(parseChordQuality("ø")).toBe("m7b5");
    expect(parseChordQuality("°7")).toBe("dim7");
    expect(parseChordQuality("+")).toBe("aug");
    expect(parseChordQuality("6/9")).toBe("69");
    expect(parseChordQuality("dom7")).toBe("7");
    expect(parseChordQuality("sus4", true)).toBe("sus4");
  });

  it("returns null when a symbol holds more than one quality's worth of info", () => {
    expect(parseChordQuality("7#9b13")).toBeNull();
    expect(parseChordQuality("nonsense")).toBeNull();
  });
});
