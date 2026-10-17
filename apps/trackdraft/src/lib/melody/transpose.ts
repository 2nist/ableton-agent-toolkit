/**
 * Whole-line transposition for a melody — the two moves a songwriter reaches
 * for while the line is in front of them:
 *
 * - **Octave** — shift the whole line up or down by 12 semitones (refused at
 *   the MIDI range edges rather than clamped, so the contour can't distort).
 * - **Degree** — diatonic transposition *within the section's key*, e.g.
 *   "move this line from the tonic to the vi". Every note keeps its position
 *   in the scale, so the line stays in key instead of drifting chromatically;
 *   blue notes keep their alteration relative to the degree below them
 *   (a raised tonic still arrives as a raised third).
 *
 * Both are pure: they take notes and return notes. The editor applies them as
 * a single undoable edit.
 */

import { DIATONIC_CHORD_TYPES, SCALE_INTERVALS, pitchClass } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { MelodyNote } from "../../types/blueprint";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

const DEFAULT_SCALE: ScaleType = "ionian";

function intervalsFor(scale: ScaleType): number[] {
  return SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian;
}

/** A note's place in the scale: degree index, chromatic offset above that
 *  degree (0 for a scale tone), and how many octaves above the root it sits. */
interface DegreePosition {
  index: number;
  offset: number;
  octave: number;
}

function positionOf(pitch: number, rootPc: number, intervals: number[]): DegreePosition {
  const rel = (((pitch - rootPc) % 12) + 12) % 12;
  let index = 0;
  for (let i = 0; i < intervals.length; i += 1) {
    if (intervals[i] <= rel) index = i;
  }
  return {
    index,
    offset: rel - intervals[index],
    octave: Math.floor((pitch - rootPc) / 12),
  };
}

/** Lowest and highest MIDI pitch in a line (null for an empty line). */
export function noteRange(notes: MelodyNote[]): { low: number; high: number } | null {
  if (notes.length === 0) return null;
  const pitches = notes.map((note) => note.pitch);
  return { low: Math.min(...pitches), high: Math.max(...pitches) };
}

/** Can the line move `octaves` steps without leaving the MIDI range? */
export function canShiftOctave(notes: MelodyNote[], octaves: number): boolean {
  const range = noteRange(notes);
  if (!range || octaves === 0) return false;
  const delta = octaves * 12;
  return range.low + delta >= 0 && range.high + delta <= 127;
}

/** Shift every note by whole octaves. Returns the input unchanged when the
 *  shift would push any note outside 0..127. */
export function shiftOctave(notes: MelodyNote[], octaves: number): MelodyNote[] {
  if (!canShiftOctave(notes, octaves)) return notes;
  const delta = octaves * 12;
  return notes.map((note) => ({ ...note, pitch: note.pitch + delta }));
}

export interface MelodyKey {
  keyName: NoteName;
  scale: ScaleType;
}

/** Diatonic degree (0-based) of the line's first note, or null when empty.
 *  This is the "the melody sits at …" anchor the degree buttons read. */
export function anchorDegree(notes: MelodyNote[], { keyName, scale }: MelodyKey): number | null {
  if (notes.length === 0) return null;
  const first = notes.reduce((a, b) => (b.startTime < a.startTime ? b : a));
  const intervals = intervalsFor(scale);
  return positionOf(first.pitch, pitchClass(keyName), intervals).index;
}

/** Signed scale steps from one degree to another, taking the shorter way
 *  round (the line keeps roughly its register). Ties prefer downward. */
export function degreeSteps(from: number, to: number, size: number): number {
  if (size <= 0) return 0;
  let steps = ((to - from) % size + size) % size;
  if (steps > size / 2) steps -= size;
  return steps;
}

/**
 * Transpose the line by `steps` scale degrees inside the key. Notes are moved
 * by their position in the scale rather than by a fixed interval, so the
 * result is in key; notes that were already altered stay altered above the
 * new degree. Results that would leave the MIDI range fold by octaves.
 */
export function transposeDegrees(
  notes: MelodyNote[],
  steps: number,
  { keyName, scale }: MelodyKey,
): MelodyNote[] {
  if (steps === 0 || notes.length === 0) return notes;
  const intervals = intervalsFor(scale);
  const size = intervals.length;
  const rootPc = pitchClass(keyName);

  return notes.map((note) => {
    const { index, offset, octave } = positionOf(note.pitch, rootPc, intervals);
    const position = octave * size + index + steps;
    const nextOctave = Math.floor(position / size);
    const nextIndex = ((position % size) + size) % size;
    let pitch = rootPc + nextOctave * 12 + intervals[nextIndex] + offset;
    while (pitch < 0) pitch += 12;
    while (pitch > 127) pitch -= 12;
    return { ...note, pitch };
  });
}

/** Transpose so the line's anchor (first note) lands on `degree`. */
export function transposeToDegree(
  notes: MelodyNote[],
  degree: number,
  key: MelodyKey,
): MelodyNote[] {
  const anchor = anchorDegree(notes, key);
  if (anchor == null) return notes;
  const size = intervalsFor(key.scale).length;
  return transposeDegrees(notes, degreeSteps(anchor, degree, size), key);
}

export interface ScaleDegreeLabel {
  /** 0-based degree index. */
  index: number;
  /** Display numeral — uppercase for major, lowercase for minor, ° for dim. */
  numeral: string;
}

/** The key's degrees as roman numerals, cased by their diatonic triad
 *  quality (I ii iii IV V vi vii°) — the labels on the degree buttons. */
export function scaleDegreeLabels({ scale }: { scale: ScaleType }): ScaleDegreeLabel[] {
  const size = intervalsFor(scale).length;
  const types = DIATONIC_CHORD_TYPES[scale] ?? DIATONIC_CHORD_TYPES[DEFAULT_SCALE];
  return Array.from({ length: size }, (_, index) => {
    const roman = ROMAN[index] ?? String(index + 1);
    const type = types[index] ?? 1;
    if (type === 1) return { index, numeral: roman };
    if (type === 8) return { index, numeral: `${roman.toLowerCase()}°` };
    return { index, numeral: roman.toLowerCase() };
  });
}
