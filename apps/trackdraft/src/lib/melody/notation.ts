/**
 * Musical-notation layout math for the Melody tab's staff renderer.
 *
 * Pure functions that map MIDI pitches and beat durations onto a treble
 * staff. The key insight encoded here: staff position is DIATONIC, not
 * chromatic — a note's vertical slot is set by its letter name (E-F and
 * B-C are half steps, so the other letter-pairs are whole steps), and
 * accidentals (♯/♭) alter the name, not the slot. The canvas component
 * (`MelodyStaff.tsx`) draws from these numbers.
 */

import { noteName, pitchClass, SCALE_INTERVALS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";

/** Diatonic letter position, starting from C. */
const LETTER_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** 12 note names for resolving a pitch's letter (first char). */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Octave number of a MIDI pitch (60 = C4). */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** Letter name (C..B) of a MIDI pitch, ignoring accidentals — F# maps to
 *  F, Cb to C, etc. This is what places a note on the staff. */
export function letterOf(midi: number): string {
  return NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12][0];
}

/**
 * Diatonic staff steps above the treble staff's bottom line (E4). Each
 * step is one line-or-space position = half a line-spacing. Reference
 * points: E4 → 0, F4 → 1, G4 → 2, B4 → 4 (middle line), D5 → 6, F5 → 8
 * (top line), middle C4 → −2, G5 → 9, A5 → 10.
 */
export function staffSteps(midi: number): number {
  const letter = letterOf(midi);
  return (octaveOf(midi) - 4) * 7 + (LETTER_INDEX[letter] - LETTER_INDEX.E);
}

/** Staff-line steps (even) below the staff for a note at `steps`, from the
 *  note's own line position up to (excluding) the bottom staff line.
 *  Empty when the note is on or above the staff. */
export function ledgerLinesBelow(steps: number): number[] {
  if (steps >= 0) return [];
  const start = steps % 2 === 0 ? steps : steps - 1;
  const out: number[] = [];
  for (let s = start; s <= -2; s += 2) out.push(s);
  return out;
}

/** Staff-line steps (even) above the staff for a note at `steps`, from the
 *  note's own line position down to (excluding) the top staff line.
 *  Empty when the note is on or below the staff. */
export function ledgerLinesAbove(steps: number): number[] {
  if (steps <= 8) return [];
  const start = steps % 2 === 0 ? steps : steps + 1;
  const out: number[] = [];
  for (let s = start; s >= 10; s -= 2) out.push(s);
  return out;
}

/** Note-head value for a beat duration — nearest standard type, with the
 *  simple rule that ≥4 beats is a whole note, ≥2 a half, ≥1 a quarter,
 *  ≥0.5 an eighth, else a sixteenth. */
export type NoteHeadType = "whole" | "half" | "quarter" | "eighth" | "sixteenth";

export function noteHeadType(durationBeats: number): NoteHeadType {
  if (durationBeats >= 3.5) return "whole";
  if (durationBeats >= 1.5) return "half";
  if (durationBeats >= 0.75) return "quarter";
  if (durationBeats >= 0.375) return "eighth";
  return "sixteenth";
}

/** Whether a note needs an accidental glyph in front of it. Diatonic notes
 *  in the (key, scale) return null — no accidental, which is the common
 *  case for a fit-to-scale melody. Non-diatonic notes are spelled for the
 *  key's convention (sharp keys spell sharp, flat keys spell flat); a
 *  non-diatonic natural (e.g. E natural in Bb major) gets a natural sign. */
export function accidentalFor(midi: number, key: NoteName, scale: ScaleType): "sharp" | "flat" | "natural" | null {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const rootPc = pitchClass(key);
  const scalePcs = new Set((SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian).map((iv) => (rootPc + iv) % 12));
  if (scalePcs.has(pc)) return null;
  const name = noteName(pc, key);
  if (name.includes("#")) return "sharp";
  if (name.includes("b")) return "flat";
  return "natural";
}
