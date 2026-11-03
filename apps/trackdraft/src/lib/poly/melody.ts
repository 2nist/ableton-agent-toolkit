import type { BlueprintSection, MelodyNote } from "../../types/blueprint";
import { sectionDurationBeats } from "../../types/blueprint";
import { conductSection, normaliseTimeDomain } from "@drum/library";

/**
 * The melody lane, as editable geometry.
 *
 * A note is drawn where it sounds: `x`/`w` are shares of the section's span,
 * `y` is its place in the section's own pitch range. Everything is pure, so a
 * drag can compute its draft without touching the song, and the same maths
 * resolves a click into a pitch when you add a note.
 *
 * Pitch <-> height goes through a padded range: a three-note phrase spread
 * over a third should still show as three distinct heights, and a drag of one
 * row must always mean one semitone.
 */

export interface PolyNoteGeom {
  /** Index into `section.melody.notes` — what a gesture edits. */
  index: number;
  /** Share of the span, 0..1. */
  x: number;
  /** Share of the span, 0..1 (at least a hair, so a 16th is still visible). */
  w: number;
  /** 0 = top of the range, 1 = bottom. */
  y: number;
  pitch: number;
  startTime: number;
  duration: number;
  velocity: number;
}

/** Where a note actually sounds, when a clock moved it away from where it is
 *  stored. Drawn dim under the note it belongs to. */
export interface PolyNoteGhost {
  x: number;
  /** Share of the span, 0..1. */
  w: number;
  /** 0 = top of the range, 1 = bottom. */
  y: number;
  pitch: number;
}

export interface PolyNoteFrame {
  notes: PolyNoteGeom[];
  /** One mark per sounding note when the section runs on its own clock. Empty
   *  otherwise: without a clock, stored and sounded are the same place. */
  ghost?: PolyNoteGhost[];
  /** Lowest and highest pitch the lane is drawn against (already padded). */
  low: number;
  high: number;
  /** The section's length in beats — the lane's right edge. */
  beats: number;
}

/** Smallest range a lane is drawn against, in semitones — a unison line still
 *  needs room to be dragged. */
const MIN_RANGE = 7;
/** Breathing room above and below the phrase, in semitones. */
const PAD = 2;

export const EMPTY_FRAME: PolyNoteFrame = {
  notes: [],
  low: 60,
  high: 60 + MIN_RANGE,
  beats: 0,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export interface NoteFrameOptions {
  /** Smallest pitch window the lane is drawn against, in semitones. */
  minRange?: number;
  /** Breathing room above and below the phrase, in semitones. */
  pad?: number;
}

/**
 * Notes → lane geometry. Shared by every note lane (melody, bass): the maths is
 * about pitches and beats, not about which stem they belong to.
 */
export function noteFrame(
  notes: readonly MelodyNote[],
  beats: number,
  options: NoteFrameOptions = {},
): PolyNoteFrame {
  const minRange = options.minRange ?? MIN_RANGE;
  const padRange = options.pad ?? PAD;
  if (notes.length === 0 || beats <= 0) return { ...EMPTY_FRAME, beats };

  const pitches = notes.map((note) => note.pitch);
  const lowPitch = Math.min(...pitches);
  const highPitch = Math.max(...pitches);
  const span = highPitch - lowPitch;
  const pad = span < minRange ? Math.ceil((minRange - span) / 2) : padRange;
  const low = lowPitch - pad;
  const high = highPitch + pad;

  // A 16th at a slow tempo is a sliver; keep every note clickable.
  const shortest = Math.min(...notes.map((note) => note.duration));
  const hair = Math.max(shortest / 2, beats / 64);

  return {
    low,
    high,
    beats,
    notes: notes.map((note, index) => ({
      index,
      x: clamp01(note.startTime / beats),
      w: clamp01(Math.max(note.duration, hair) / beats),
      y: (high - note.pitch) / (high - low),
      pitch: note.pitch,
      startTime: note.startTime,
      duration: note.duration,
      velocity: note.velocity ?? 96,
    })),
  };
}

export function polyNoteFrame(section: BlueprintSection): PolyNoteFrame {
  const duration = sectionDurationBeats(section);
  // The lane draws the line as it is WRITTEN, and ghosts where the clock puts
  // it (§P3.7). Drawing the conducted positions instead made every drag write a
  // local value computed from song-beat geometry — and made an authored bass
  // line round-trip through conduction on the first edit.
  const frame = noteFrame(section.melody?.notes ?? [], duration);
  // No clock (or an inert one) means stored and sounded are the same place —
  // a ghost would just be a second copy of every bar.
  if (!normaliseTimeDomain(section.timeDomain)) return frame;
  const sounded = conductSection(section, duration).melody?.notes ?? [];
  const ghost = noteGhosts(sounded, frame);
  return ghost.length > 0 ? { ...frame, ghost } : frame;
}

/** Where each sounding note lands, in the frame's own coordinates. */
export function noteGhosts(
  sounded: readonly MelodyNote[],
  frame: PolyNoteFrame,
): PolyNoteGhost[] {
  if (sounded.length === 0 || frame.beats <= 0) return [];
  const hair = frame.beats / 64;
  return sounded.map((note) => ({
    x: clamp01(note.startTime / frame.beats),
    w: clamp01(Math.max(note.duration, hair) / frame.beats),
    y:
      frame.high === frame.low
        ? 0.5
        : clamp01((frame.high - note.pitch) / (frame.high - frame.low)),
    pitch: note.pitch,
  }));
}

/** The pitch a vertical position means — rounded to the row it sits on. */
export function pitchForY(frame: PolyNoteFrame, y: number): number {
  const span = frame.high - frame.low;
  if (span <= 0) return frame.low;
  return Math.max(0, Math.min(127, Math.round(frame.high - clamp01(y) * span)));
}

/** Which note, if any, sits under a point in the lane. */
export function noteAtPoint(
  frame: PolyNoteFrame,
  x: number,
  y: number,
): PolyNoteGeom | null {
  // One semitone of height, with a floor so a narrow lane still catches a click.
  const tolerance = Math.max(1 / Math.max(1, frame.high - frame.low), 0.06);
  for (const note of frame.notes) {
    if (
      x >= note.x - 0.004 &&
      x <= note.x + note.w + 0.004 &&
      Math.abs(note.y - y) <= tolerance
    ) {
      return note;
    }
  }
  return null;
}

/** Grid the lane quantises to, in beats — sixteenths unless the bar is huge. */
export function beatGrid(beatsPerBar: number): number {
  const perBar = beatsPerBar > 0 ? beatsPerBar : 4;
  return Math.min(1, Math.max(0.25, perBar / 16));
}

export function quantise(value: number, grid: number): number {
  if (!(grid > 0)) return value;
  return Math.round(value / grid) * grid;
}

export interface NoteMove {
  /** Semitones to transpose by (positive = up). */
  semitones?: number;
  /** Beats to shift the onset by. */
  beats?: number;
}

/** One note, moved. Onset is clamped into the section, pitch into MIDI. */
export function moveNote(
  notes: readonly MelodyNote[],
  index: number,
  frame: PolyNoteFrame,
  move: NoteMove,
): MelodyNote[] {
  const note = notes[index];
  if (!note) return [...notes];
  const pitch = Math.max(0, Math.min(127, note.pitch + (move.semitones ?? 0)));
  const onset = Math.max(
    0,
    Math.min(frame.beats - note.duration, note.startTime + (move.beats ?? 0)),
  );
  if (pitch === note.pitch && onset === note.startTime) return [...notes];
  return sortNotes(
    notes.map((entry, at) =>
      at === index ? { ...entry, pitch, startTime: round6(onset) } : entry,
    ),
  );
}

/** A new note at a point in the lane, one grid step long. */
export function insertNote(
  notes: readonly MelodyNote[],
  frame: PolyNoteFrame,
  point: { x: number; y: number },
  grid: number,
): MelodyNote[] {
  const duration = Math.max(grid, Math.min(frame.beats, frame.beats / 8));
  const start = Math.max(
    0,
    Math.min(frame.beats - duration, quantise(point.x * frame.beats, grid)),
  );
  const next = [
    ...notes,
    {
      pitch: pitchForY(frame, point.y),
      startTime: round6(start),
      duration: round6(duration),
      velocity: 96,
    },
  ];
  return sortNotes(next);
}

export function removeNote(
  notes: readonly MelodyNote[],
  index: number,
): MelodyNote[] {
  return notes.filter((_, at) => at !== index);
}

/** Onset order is what the exporters, the inspector and this lane all assume,
 *  so the array stays sorted no matter which note was dragged. */
export function sortNotes(notes: MelodyNote[]): MelodyNote[] {
  return [...notes].sort(
    (a, b) => a.startTime - b.startTime || a.pitch - b.pitch,
  );
}

/** A section with an edited melody — used by both the drag preview and the
 *  commit, so what you see is exactly what is written. */
export function withNotes(
  section: BlueprintSection,
  notes: MelodyNote[],
): BlueprintSection {
  return { ...section, melody: { ...(section.melody ?? {}), notes } };
}
