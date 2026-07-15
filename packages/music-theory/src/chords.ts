import type { ChordType, Chord, ChordQuality, ScaleType, NoteName } from "./types";
import { pitchClass, noteName } from "./notes";
import { MODE_DATA } from "./scales";

/**
 * Chord type definitions with interval patterns
 * Source: APC64 chord editor + hexagon_chord_logic.js
 *
 * Index mapping (matching APC64 Lua implementation):
 * 1=maj, 2=min, 3=7, 4=maj7, 5=m7, 6=sus2, 7=sus4, 8=dim, 9=aug
 */
export const CHORD_TYPES: ChordType[] = [
  { name: "maj", intervals: [0, 4, 7], display: "" },
  { name: "min", intervals: [0, 3, 7], display: "m" },
  { name: "7", intervals: [0, 4, 7, 10], display: "7" },
  { name: "maj7", intervals: [0, 4, 7, 11], display: "maj7" },
  { name: "m7", intervals: [0, 3, 7, 10], display: "m7" },
  { name: "sus2", intervals: [0, 2, 7], display: "sus2" },
  { name: "sus4", intervals: [0, 5, 7], display: "sus4" },
  { name: "dim", intervals: [0, 3, 6], display: "dim" },
  { name: "aug", intervals: [0, 4, 8], display: "aug" },
];

/** Chord quality display suffix mapping */
export const CHORD_QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: "",
  min: "m",
  "7": "7",
  maj7: "maj7",
  min7: "m7",
  m7b5: "m7♭5",
  sus2: "sus2",
  sus4: "sus4",
  dim: "dim",
  aug: "aug",
};

/**
 * Get a chord type by 1-based index (matching APC64 convention)
 */
export function getChordTypeByIndex(index: number): ChordType | undefined {
  return CHORD_TYPES[index - 1];
}

/**
 * Get the display suffix for a chord quality
 */
export function getChordSuffix(quality: ChordQuality): string {
  return CHORD_QUALITY_SUFFIX[quality] ?? "";
}

/**
 * Build full chord name (e.g. "Cmaj7", "F#m", "B♭dim")
 */
export function chordName(
  rootPc: number,
  quality: ChordQuality,
  key?: NoteName
): string {
  const root = noteName(rootPc, key);
  const suffix = getChordSuffix(quality);
  return `${root}${suffix}`;
}

/**
 * Get intervals for a chord quality
 */
export function getChordIntervals(quality: ChordQuality): number[] {
  // Map from quality to CHORD_TYPES entry
  const qualityToIntervals: Record<string, number[]> = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    "7": [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    m7b5: [0, 3, 6, 10],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
  };
  return qualityToIntervals[quality] ?? [0, 4, 7];
}

/**
 * Get MIDI note numbers for a chord at a given octave
 */
export function chordToMidiNotes(
  rootPc: number,
  quality: ChordQuality,
  octave: number = 4
): number[] {
  const intervals = getChordIntervals(quality);
  const base = octave * 12;
  return intervals.map((interval) => base + rootPc + interval);
}

/**
 * Create a Chord object from a degree in a key/mode
 */
export function buildChord(
  key: NoteName,
  degree: string,
  mode: ScaleType,
  beats: number = 4
): Chord {
  const keyPc = pitchClass(key);
  const modeData = MODE_DATA[mode];
  const degreeEntry = modeData.map[degree];

  if (!degreeEntry) {
    throw new Error(
      `Degree "${degree}" not found in ${mode} mode`
    );
  }

  const rootPc = ((keyPc + degreeEntry.pc) % 12 + 12) % 12;
  const root = noteName(rootPc, key);

  return {
    root,
    degree,
    quality: degreeEntry.triad,
    beats,
    key,
    mode,
    isSubstitution: degreeEntry.isBorrowed ?? false,
  };
}

/**
 * Create a Chord from an absolute root note + quality
 */
export function chord(
  rootNote: NoteName,
  quality: ChordQuality,
  beats: number = 4,
  key?: NoteName,
  mode?: ScaleType
): Chord {
  return {
    root: rootNote,
    degree: rootNote, // Absolute chords don't have a scale degree
    quality,
    beats,
    key: key ?? "C",
    mode: mode ?? "ionian",
    isSubstitution: false,
  };
}