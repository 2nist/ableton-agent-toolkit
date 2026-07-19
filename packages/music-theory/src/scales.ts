import type { ScaleType, ModeData, DegreeMapEntry, Degree } from "./types";

/**
 * Scale interval patterns (semitones from root)
 * Source: APC64 chord editor + hexagon_chord_logic.js
 */
export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],     // Major
  dorian: [0, 2, 3, 5, 7, 9, 10],     // Minor with raised 6th
  phrygian: [0, 1, 3, 5, 7, 8, 10],   // Minor with lowered 2nd
  lydian: [0, 2, 4, 6, 7, 9, 11],     // Major with raised 4th
  mixolydian: [0, 2, 4, 5, 7, 9, 10], // Major with lowered 7th
  aeolian: [0, 2, 3, 5, 7, 8, 10],    // Natural minor
  locrian: [0, 1, 3, 5, 6, 8, 10],    // Diminished scale
};

/** Display order of modes */
export const SCALE_ORDER: ScaleType[] = [
  "ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian",
];

/** Display names for scales */
export const SCALE_NAMES: Record<ScaleType, string> = {
  ionian: "Ionian (Major)",
  dorian: "Dorian",
  phrygian: "Phrygian",
  lydian: "Lydian",
  mixolydian: "Mixolydian",
  aeolian: "Aeolian (Natural Minor)",
  locrian: "Locrian",
};

/**
 * Complete mode data with degree maps
 * Combines data from:
 * - hexagon_chord_logic.js (ionian mode with borrowed chords)
 * - APC64 chord editor (all 7 modes with diatonic chord types)
 */
export const MODE_DATA: Record<ScaleType, ModeData> = {
  ionian: {
    name: "Ionian",
    degrees: ["I", "ii", "iii", "IV", "V", "vi", "vii°"],
    map: {
      I: { pc: 0, triad: "maj", seventh: "maj7", func: "T" },
      ii: { pc: 2, triad: "min", seventh: "min7", func: "PD" },
      iii: { pc: 4, triad: "min", seventh: "min7", func: "T" },
      IV: { pc: 5, triad: "maj", seventh: "maj7", func: "PD" },
      V: { pc: 7, triad: "maj", seventh: "7", func: "D" },
      vi: { pc: 9, triad: "min", seventh: "min7", func: "T" },
      "vii°": {
        pc: 11,
        triad: "dim",
        seventh: "m7b5",
        func: "D",
      },
      // Borrowed chords from parallel minor (hexagon_chord_logic.js)
      "♭III": {
        pc: 3,
        triad: "maj",
        seventh: "maj7",
        func: "B",
        isBorrowed: true,
      },
      iv: {
        pc: 5,
        triad: "min",
        seventh: "min7",
        func: "B",
        isBorrowed: true,
      },
      "♭VI": {
        pc: 8,
        triad: "maj",
        seventh: "maj7",
        func: "B",
        isBorrowed: true,
      },
      "♭VII": {
        pc: 10,
        triad: "maj",
        seventh: "7",
        func: "B",
        isBorrowed: true,
      },
      "♭II": {
        pc: 1,
        triad: "maj",
        seventh: "maj7",
        func: "B",
        isBorrowed: true,
      },
    },
  },
  dorian: {
    name: "Dorian",
    degrees: ["i", "ii", "III", "IV", "v", "vi°", "VII"],
    map: {
      i: { pc: 0, triad: "min", seventh: "min7", func: "T" },
      ii: { pc: 2, triad: "min", seventh: "min7", func: "PD" },
      III: { pc: 3, triad: "maj", seventh: "maj7", func: "T" },
      IV: { pc: 5, triad: "maj", seventh: "7", func: "PD" },
      v: { pc: 7, triad: "min", seventh: "min7", func: "D" },
      "vi°": {
        pc: 9,
        triad: "dim",
        seventh: "m7b5",
        func: "T",
      },
      VII: { pc: 10, triad: "maj", seventh: "7", func: "D" },
    },
  },
  phrygian: {
    name: "Phrygian",
    degrees: ["i", "♭II", "♭III", "iv", "v°", "♭VI", "♭vii"],
    map: {
      i: { pc: 0, triad: "min", seventh: "min7", func: "T" },
      "♭II": {
        pc: 1,
        triad: "maj",
        seventh: "maj7",
        func: "PD",
      },
      "♭III": {
        pc: 3,
        triad: "maj",
        seventh: "maj7",
        func: "T",
      },
      iv: { pc: 5, triad: "min", seventh: "min7", func: "PD" },
      "v°": {
        pc: 7,
        triad: "dim",
        seventh: "m7b5",
        func: "D",
      },
      "♭VI": {
        pc: 8,
        triad: "maj",
        seventh: "maj7",
        func: "T",
      },
      "♭vii": {
        pc: 10,
        triad: "min",
        seventh: "min7",
        func: "D",
      },
    },
  },
  lydian: {
    name: "Lydian",
    degrees: ["I", "II", "iii", "#iv°", "V", "vi", "vii"],
    map: {
      I: { pc: 0, triad: "maj", seventh: "maj7", func: "T" },
      II: { pc: 2, triad: "maj", seventh: "7", func: "PD" },
      iii: { pc: 4, triad: "min", seventh: "min7", func: "T" },
      "#iv°": {
        pc: 6,
        triad: "dim",
        seventh: "m7b5",
        func: "PD",
      },
      V: { pc: 7, triad: "maj", seventh: "maj7", func: "D" },
      vi: { pc: 9, triad: "min", seventh: "min7", func: "T" },
      vii: { pc: 11, triad: "min", seventh: "min7", func: "D" },
    },
  },
  mixolydian: {
    name: "Mixolydian",
    degrees: ["I", "ii", "iii°", "IV", "v", "vi", "♭VII"],
    map: {
      I: { pc: 0, triad: "maj", seventh: "7", func: "T" },
      ii: { pc: 2, triad: "min", seventh: "min7", func: "PD" },
      "iii°": {
        pc: 4,
        triad: "dim",
        seventh: "m7b5",
        func: "T",
      },
      IV: { pc: 5, triad: "maj", seventh: "maj7", func: "PD" },
      v: { pc: 7, triad: "min", seventh: "min7", func: "D" },
      vi: { pc: 9, triad: "min", seventh: "min7", func: "T" },
      "♭VII": {
        pc: 10,
        triad: "maj",
        seventh: "7",
        func: "D",
      },
    },
  },
  aeolian: {
    name: "Aeolian",
    degrees: ["i", "ii°", "♭III", "iv", "v", "♭VI", "♭VII"],
    map: {
      i: { pc: 0, triad: "min", seventh: "min7", func: "T" },
      "ii°": {
        pc: 2,
        triad: "dim",
        seventh: "m7b5",
        func: "PD",
      },
      "♭III": {
        pc: 3,
        triad: "maj",
        seventh: "maj7",
        func: "T",
      },
      iv: { pc: 5, triad: "min", seventh: "min7", func: "PD" },
      v: { pc: 7, triad: "min", seventh: "min7", func: "D" },
      "♭VI": {
        pc: 8,
        triad: "maj",
        seventh: "maj7",
        func: "T",
      },
      "♭VII": {
        pc: 10,
        triad: "maj",
        seventh: "7",
        func: "D",
      },
      // Harmonic-minor borrowed dominant: raises aeolian's minor v to a
      // major/dominant-7 V, the raised-leading-tone chord that gives the
      // Andalusian cadence (i-♭VII-♭VI-V) its pull. Without this entry,
      // PRESET_PROGRESSIONS.andalusian's own "V" degree resolved to
      // nothing and the preset silently dropped its final chord.
      V: { pc: 7, triad: "maj", seventh: "7", func: "D", isBorrowed: true },
    },
  },
  locrian: {
    name: "Locrian",
    degrees: ["i°", "♭II", "♭iii", "iv", "♭V", "♭VI", "♭vii"],
    map: {
      "i°": {
        pc: 0,
        triad: "dim",
        seventh: "m7b5",
        func: "T",
      },
      "♭II": {
        pc: 1,
        triad: "maj",
        seventh: "maj7",
        func: "PD",
      },
      "♭iii": {
        pc: 3,
        triad: "min",
        seventh: "min7",
        func: "T",
      },
      iv: { pc: 5, triad: "min", seventh: "min7", func: "PD" },
      "♭V": {
        pc: 6,
        triad: "maj",
        seventh: "7",
        func: "D",
      },
      "♭VI": {
        pc: 8,
        triad: "maj",
        seventh: "maj7",
        func: "T",
      },
      "♭vii": {
        pc: 10,
        triad: "min",
        seventh: "min7",
        func: "D",
      },
    },
  },
};

/**
 * Harmonic function colors (matching both APC64 and hexagon)
 */
export const FUNCTION_COLORS: Record<string, number> = {
  T: 0x34d399, // Emerald (Tonic)
  PD: 0x60a5fa, // Blue (Pre-Dominant)
  D: 0xf87171, // Red (Dominant)
  B: 0xa78bfa, // Violet (Borrowed)
};

/**
 * Diatonic chord type indices per mode (1=maj, 2=min, 3=7, 4=maj7, 5=m7, 6=sus2, 7=sus4, 8=dim, 9=aug)
 * Source: APC64 chord editor
 */
export const DIATONIC_CHORD_TYPES: Record<ScaleType, number[]> = {
  ionian: [1, 2, 2, 1, 1, 2, 8],      // I, ii, iii, IV, V, vi, vii°
  dorian: [2, 2, 1, 1, 2, 8, 1],      // i, ii, III, IV, v, vi°, VII
  phrygian: [2, 1, 1, 2, 8, 1, 2],    // i, II, III, iv, v°, VI, vii
  lydian: [1, 1, 2, 8, 1, 2, 2],      // I, II, iii, #iv°, V, vi, vii
  mixolydian: [1, 2, 8, 1, 2, 2, 1],  // I, ii, iii°, IV, v, vi, VII
  aeolian: [2, 8, 1, 2, 2, 1, 1],     // i, ii°, III, iv, v, VI, VII
  locrian: [8, 1, 2, 2, 1, 1, 2],     // i°, II, iii, iv, V, VI, vii
};

/**
 * Get all scale notes (pitch classes) for a key root + scale type
 */
export function getScaleNotes(
  root: number,
  scaleType: ScaleType
): number[] {
  const intervals = SCALE_INTERVALS[scaleType] ?? SCALE_INTERVALS.ionian;
  return intervals.map((interval) => (root + interval) % 12);
}

/**
 * Get diatonic chords for a key root + scale type
 */
export function getDiatonicChords(
  root: number,
  scaleType: ScaleType
): Array<{ root: number; typeIdx: number; degree: number }> {
  const scaleNotes = getScaleNotes(root, scaleType);
  const types = DIATONIC_CHORD_TYPES[scaleType] ?? DIATONIC_CHORD_TYPES.ionian;

  return scaleNotes.map((note, i) => ({
    root: note,
    typeIdx: types[i]!,
    degree: i + 1,
  }));
}