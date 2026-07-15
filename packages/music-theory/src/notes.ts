import type { NoteName, PitchClass } from "./types";

/** All 12 note names using sharps */
export const SHARP_NOTES: NoteName[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/** All 12 note names using flats */
export const FLAT_NOTES: NoteName[] = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
];

/** Note name to pitch class mapping (handles both sharps and flats) */
export const NOTE_TO_PC: Record<NoteName, PitchClass> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
  "B#": 0,
};

/**
 * Keys that conventionally use flat accidentals
 * Source: hexagon_chord_logic.js / APC64 chord editor
 */
export const FLAT_KEYS: NoteName[] = [
  "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb",
];

/**
 * All 15 standard key roots (circle of fifths order)
 * Source: hexagon_chord_logic.js
 */
export const KEY_ROOTS: NoteName[] = [
  "C", "G", "D", "A", "E", "B", "F#", "C#", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb",
];

/**
 * Get pitch class from note name (supports enharmonic equivalents)
 */
export function pitchClass(note: NoteName): PitchClass {
  const pc = NOTE_TO_PC[note];
  if (pc === undefined) {
    throw new Error(`Unknown note name: ${note}`);
  }
  return pc;
}

/**
 * Get note name from pitch class, respecting key signature convention
 */
export function noteName(pc: PitchClass, key?: NoteName): NoteName {
  const normalized = ((pc % 12) + 12) % 12;
  if (key && FLAT_KEYS.includes(key)) {
    return FLAT_NOTES[normalized]!;
  }
  return SHARP_NOTES[normalized]!;
}

/**
 * Convert a MIDI note number to pitch class
 */
export function midiToPitchClass(midiNote: number): PitchClass {
  return ((midiNote % 12) + 12) % 12;
}

/**
 * Convert pitch class and octave to MIDI note number
 */
export function pitchClassToMidi(pc: PitchClass, octave: number): number {
  return octave * 12 + pc;
}

/**
 * Get the enharmonic equivalent of a note
 */
export function enharmonicPitchClass(
  pc: PitchClass,
  preferFlat: boolean
): PitchClass {
  // Notes with enharmonic equivalents: 1(C#/Db), 3(D#/Eb), 6(F#/Gb), 8(G#/Ab), 10(A#/Bb)
  // All others are identity
  return pc;
}

/**
 * Build a MIDI note array from root + intervals
 */
export function buildChordMidiNotes(
  rootPc: PitchClass,
  intervals: number[],
  octave: number = 4
): number[] {
  const base = octave * 12;
  return intervals.map((interval) => base + rootPc + interval);
}