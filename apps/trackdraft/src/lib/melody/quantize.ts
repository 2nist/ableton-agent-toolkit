/**
 * Post-processing knobs for the Melody tab's captured line — the "couple of
 * quantize and fit to scale knobs to dial it in" from the feature brief.
 *
 * A raw hum-to-MIDI take has loose edges (vibrato, pitch drift, a syllable
 * landing a hair before the beat). These two pure functions are the
 * corrective tools:
 *
 * - `quantizeMelody` snaps onsets/offsets to a beat grid (16th/8th/8th-T/
 *   quarter, or off), preserving each note's length so a phrase can't
 *   collapse to nothing.
 * - `fitMelodyToScale` snaps every pitch to the nearest tone of the song's
 *   key+scale, staying in the note's own register so a line doesn't jump an
 *   octave just to satisfy the scale.
 *
 * Both are non-destructive over the raw capture: `adjustMelody` runs them in
 * sequence for a preview, and the UI only writes the result to the section
 * when the user hits Save — so the knobs can be wiggled freely before
 * committing.
 */

import type { MelodyNote } from "../../types/blueprint";
import { pitchClass, SCALE_INTERVALS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";

/** Beat-grid granularity for quantize. `"none"` leaves timing untouched. */
export type QuantizeGrid = "none" | "1/16" | "1/8" | "1/8T" | "1/4";

/** Grid resolution in quarter-note beats for each named setting. */
export const QUANTIZE_GRIDS: Record<Exclude<QuantizeGrid, "none">, number> = {
  "1/16": 0.25,
  "1/8": 0.5,
  "1/8T": 1 / 3,
  "1/4": 1,
};

export const QUANTIZE_GRID_LABELS: Record<QuantizeGrid, string> = {
  none: "None",
  "1/16": "16th",
  "1/8": "8th",
  "1/8T": "8th-T",
  "1/4": "Quarter",
};

function roundToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/**
 * Snap a melody's onsets and offsets onto a beat grid. Each note's start is
 * rounded to the nearest grid line and its end (start + duration) rounded
 * too, so lengths stay true to the take; a note that rounds to nothing is
 * floored to one grid cell. `"none"` returns a copy with timing untouched.
 */
export function quantizeMelody(notes: MelodyNote[], grid: QuantizeGrid): MelodyNote[] {
  if (grid === "none") return notes.map((n) => ({ ...n }));
  const step = QUANTIZE_GRIDS[grid];
  return notes.map((n) => {
    const start = Math.max(0, roundToGrid(n.startTime, step));
    const end = roundToGrid(n.startTime + n.duration, step);
    return { ...n, startTime: start, duration: Math.max(step, end - start) };
  });
}

/**
 * Snap every pitch to the nearest tone of a (key, scale) — the "fit to
 * scale" knob. Stays in the note's own register (moves by semitones within
 * the octave, never by a whole octave), so the contour of a sung line is
 * preserved while off-scale blue notes are pulled into the key. A pitch
 * already in the scale is left untouched.
 */
export function fitMelodyToScale(notes: MelodyNote[], key: NoteName, scale: ScaleType): MelodyNote[] {
  const rootPc = pitchClass(key);
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian;
  const scalePcs = new Set(intervals.map((iv) => (rootPc + iv) % 12));
  return notes.map((n) => {
    const pc = ((n.pitch % 12) + 12) % 12;
    if (scalePcs.has(pc)) return { ...n };
    // Nearest scale tone in either direction, scanning outward from the
    // note (a 7-tone scale guarantees a hit within 2 semitones). On an
    // exact tie (the note sits half a semitone from two scale tones) snap
    // DOWN: out-of-tune takes run sharp far more often than flat, so
    // flattening keeps the line from creeping up the register.
    for (let offset = 1; offset < 12; offset++) {
      if (scalePcs.has(((pc - offset) % 12 + 12) % 12)) return { ...n, pitch: n.pitch - offset };
      if (scalePcs.has((pc + offset) % 12)) return { ...n, pitch: n.pitch + offset };
    }
    return { ...n };
  });
}

/** The Melody tab's two adjustment knobs in one bag. */
export interface MelodyAdjustOptions {
  quantize: QuantizeGrid;
  fitToScale: boolean;
  key: NoteName;
  scale: ScaleType;
}

/** Run quantize then fit-to-scale over a raw capture for a preview. */
export function adjustMelody(notes: MelodyNote[], opts: MelodyAdjustOptions): MelodyNote[] {
  let adjusted = quantizeMelody(notes, opts.quantize);
  if (opts.fitToScale) adjusted = fitMelodyToScale(adjusted, opts.key, opts.scale);
  return adjusted;
}
