/**
 * Pointer edits for a section's melody line — the pure half of the note
 * editor. Every gesture (tap to add, drag to move, drag an edge to resize,
 * drag the velocity lane) reduces to one of these functions, so the gesture
 * code in `MelodyNoteEditor` stays a thin coordinate mapper and the musical
 * rules are unit-testable without a DOM.
 *
 * Rules that hold for every edit:
 * - timing snaps to the editor's grid (`QuantizeGrid`, shared with the
 *   capture quantizer) and never leaves the section window;
 * - a note is always at least one grid cell long (1/16 when the grid is off),
 *   so a resize can't collapse it to nothing;
 * - pitch is an integer MIDI number in 0..127, velocity in 1..127.
 */

import type { MelodyNote, MelodyTrack } from "../../types/blueprint";
import { QUANTIZE_GRIDS, type QuantizeGrid } from "./quantize";

/** Shortest note the editor will produce, in beats. */
export const MIN_NOTE_DURATION = 1 / 16;
/** Fallback length for a tap-added note when the grid is off. */
export const DEFAULT_NOTE_DURATION = 0.5;
/** Matches the capture/export default (`DEFAULT_MELODY_VELOCITY`). */
export const DEFAULT_NOTE_VELOCITY = 96;
export const MIN_VELOCITY = 1;
export const MAX_VELOCITY = 127;

/** Trim binary-float noise so 1/8-triplet sums stay readable in the UI. */
function roundBeats(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Grid resolution in beats; 0 when snapping is off. */
export function gridStep(grid: QuantizeGrid): number {
  return grid === "none" ? 0 : QUANTIZE_GRIDS[grid];
}

/** Snap a beat position to the grid. `"none"` only trims float noise. */
export function snapBeat(beat: number, grid: QuantizeGrid): number {
  const step = gridStep(grid);
  if (step <= 0) return roundBeats(beat);
  return roundBeats(Math.round(beat / step) * step);
}

function clampPitch(pitch: number): number {
  return Math.max(0, Math.min(127, Math.round(pitch)));
}

/** Keep a note inside [0, sectionBeats] while preserving its length where
 *  the section is long enough to hold it. */
function fitToSection(note: MelodyNote, sectionBeats: number): MelodyNote {
  const limit = sectionBeats > 0 ? sectionBeats : note.startTime + note.duration;
  const duration = Math.min(
    Math.max(MIN_NOTE_DURATION, note.duration),
    Math.max(MIN_NOTE_DURATION, limit),
  );
  const startTime = Math.max(0, Math.min(note.startTime, Math.max(0, limit - duration)));
  return {
    ...note,
    startTime: roundBeats(startTime),
    duration: roundBeats(duration),
    pitch: clampPitch(note.pitch),
  };
}

export interface AddNoteOptions {
  pitch: number;
  /** Desired onset in section beats (snapped by the editor grid). */
  startTime: number;
  grid: QuantizeGrid;
  sectionBeats: number;
  duration?: number;
}

/** Append a note at a grid-snapped position. Returns a new array; the new
 *  note is always the LAST element, so the caller can select it by index. */
export function addNote(notes: MelodyNote[], opts: AddNoteOptions): MelodyNote[] {
  const length = opts.duration ?? (gridStep(opts.grid) || DEFAULT_NOTE_DURATION);
  const note: MelodyNote = {
    pitch: opts.pitch,
    startTime: snapBeat(Math.max(0, opts.startTime), opts.grid),
    duration: length,
    velocity: DEFAULT_NOTE_VELOCITY,
  };
  return [...notes, fitToSection(note, opts.sectionBeats)];
}

export interface MoveNoteOptions {
  /** Desired onset in section beats, before snapping. */
  startTime: number;
  pitch: number;
  grid: QuantizeGrid;
  sectionBeats: number;
}

/** Move one note in time and pitch, keeping its length. */
export function moveNote(
  notes: MelodyNote[],
  index: number,
  opts: MoveNoteOptions,
): MelodyNote[] {
  const current = notes[index];
  if (!current) return notes;
  const moved = fitToSection(
    {
      ...current,
      startTime: snapBeat(Math.max(0, opts.startTime), opts.grid),
      pitch: opts.pitch,
    },
    opts.sectionBeats,
  );
  return notes.map((note, i) => (i === index ? moved : note));
}

export interface ResizeNoteOptions {
  /** Which edge the pointer is dragging. */
  edge: "start" | "end";
  /** Desired position of that edge in section beats, before snapping. */
  time: number;
  grid: QuantizeGrid;
  sectionBeats: number;
}

/** Drag one edge of a note. The opposite edge stays put; the note can't get
 *  shorter than one grid cell. */
export function resizeNote(
  notes: MelodyNote[],
  index: number,
  opts: ResizeNoteOptions,
): MelodyNote[] {
  const current = notes[index];
  if (!current) return notes;
  const minDuration = gridStep(opts.grid) || MIN_NOTE_DURATION;
  const limit = opts.sectionBeats > 0 ? opts.sectionBeats : Infinity;
  const snapped = snapBeat(Math.max(0, opts.time), opts.grid);

  let next: MelodyNote;
  if (opts.edge === "end") {
    const end = Math.max(current.startTime + minDuration, Math.min(snapped, limit));
    next = { ...current, duration: end - current.startTime };
  } else {
    const end = current.startTime + current.duration;
    const start = Math.max(0, Math.min(snapped, end - minDuration));
    next = { ...current, startTime: start, duration: end - start };
  }
  const fitted = fitToSection(next, opts.sectionBeats);
  return notes.map((note, i) => (i === index ? fitted : note));
}

/** Set a note's velocity, clamped to the MIDI range. */
export function setVelocity(
  notes: MelodyNote[],
  index: number,
  velocity: number,
): MelodyNote[] {
  if (!notes[index]) return notes;
  const clamped = Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, Math.round(velocity)));
  return notes.map((note, i) => (i === index ? { ...note, velocity: clamped } : note));
}

/** Drop one note. */
export function removeNote(notes: MelodyNote[], index: number): MelodyNote[] {
  if (!notes[index]) return notes;
  return notes.filter((_, i) => i !== index);
}

/** Index of the note whose onset is closest to `beat` (the velocity lane's
 *  hit test) — -1 when there are no notes. */
export function nearestNoteIndex(notes: MelodyNote[], beat: number): number {
  let best = -1;
  let bestDistance = Infinity;
  notes.forEach((note, index) => {
    const distance = Math.abs(note.startTime - beat);
    if (distance < bestDistance - 1e-9) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/**
 * Fold hand edits into a track. A manually edited line is final: it keeps the
 * notes exactly as drawn, so `source` becomes `"edited"` (no more "rebuild
 * from Bend" nudges — the user is the generator now) and `contourApplied` is
 * set so the export stem doesn't re-shape the drawn line with the Bend
 * contour transform. Generation provenance (`seed`, `params`) is kept as a
 * record of where the base line came from.
 */
export function editedMelodyTrack(
  track: MelodyTrack | undefined,
  notes: MelodyNote[],
): MelodyTrack {
  return {
    ...(track ?? { notes: [] }),
    notes,
    source: "edited",
    contourApplied: true,
  };
}
