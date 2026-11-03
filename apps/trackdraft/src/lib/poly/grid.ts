/**
 * The grid: what a drag snaps to, for every lane (§S2.1).
 *
 * Positions were editable and **lengths were not** — a bass note could be moved
 * but not held, a melody note could not be lengthened, a drum hit had no length
 * at all, and a chord's edge drag worked from its own private arithmetic. Four
 * answers to "how long is this" is how a canvas stops being a grid and becomes a
 * pile of gestures.
 *
 * So the snap lives here once: a **bar-aware ladder** (a 7/8 bar's sixteenth is
 * not a 4/4 bar's), a minimum span (nothing shorter than the grid can be
 * grabbed again), and the two conversions a resize needs — pixels to beats, and
 * beats to a legal length inside the section.
 *
 * Pure, so "you cannot drag a note past the end of its section" is a test rather
 * than a hope.
 */

/** How finely the canvas subdivides, in *steps per bar*. Musicians count these,
 *  so the ladder is the counting ladder, not a list of decimals. */
export const GRID_LADDER: readonly number[] = [1, 2, 4, 8, 16];

/** What each rung means on the row, in beats. */
export const GRID_LABEL: Record<number, string> = {
  1: "bar",
  2: "½ bar",
  4: "beat",
  8: "⅛ bar",
  16: "1/16",
};

/** Steps per bar → the length of one step, in beats. */
export function gridUnit(beatsPerBar: number, stepsPerBar: number): number {
  const bar = beatsPerBar > 0 ? beatsPerBar : 4;
  const steps = GRID_LADDER.includes(stepsPerBar) ? stepsPerBar : 4;
  return bar / steps;
}

/** The default rung: a sixteenth, which is the grid the canvas already snapped
 *  note moves to (`beatGrid` = ¼ beat in 4/4). Keeping it the default means the
 *  new length handles change nothing about the old drag — you coarsen the grid
 *  deliberately, with the Grid row. */
export const DEFAULT_STEPS_PER_BAR = 16;

/** The next rung up the ladder (finer), wrapping to the coarsest. */
export function nextGrid(stepsPerBar: number): number {
  const at = GRID_LADDER.indexOf(stepsPerBar);
  return GRID_LADDER[(at + 1) % GRID_LADDER.length] ?? DEFAULT_STEPS_PER_BAR;
}

/** Snap a beat to the grid — the one place a drag becomes a number. */
export function snapToGrid(beat: number, unit: number): number {
  if (!(unit > 0)) return beat;
  return Math.round(beat / unit) * unit;
}

/** The length a note's right edge means: snapped, at least one unit, and never
 *  past the end of the section. */
export function lengthFromEdge(
  startTime: number,
  edgeTime: number,
  unit: number,
  sectionBeats: number,
): number {
  const end = Math.min(
    sectionBeats,
    Math.max(startTime + unit, snapToGrid(edgeTime, unit)),
  );
  return Math.max(unit, round6(end - startTime));
}

/** A chord's length from an edge drag: the same rule, with a chord's own floor
 *  (a sixteenth, which is what the canvas has always allowed). */
export function chordLengthFromDrag(
  startBeats: number,
  dxPx: number,
  pxPerBeat: number,
  unit: number,
): number {
  const perBeat = pxPerBeat > 0 ? pxPerBeat : 1;
  const raw = startBeats + dxPx / perBeat;
  const snapped = unit > 0 ? snapToGrid(raw, unit) : raw;
  // A sixteenth is the shortest chord the canvas has ever allowed, and the floor
  // is `min(unit, 0.25)` so a coarse grid cannot make the shortest legal chord
  // longer than the shortest useful one.
  const floor = unit > 0 ? Math.min(unit, 0.25) : 0.25;
  return Math.max(floor, round6(snapped));
}

/** Extend or shorten one note of a line. Shared by the bass and the melody —
 *  the geometry is the same, only the field differs. */
export function resizeNote<N extends { startTime: number; duration: number }>(
  notes: readonly N[],
  index: number,
  edgeTime: number,
  unit: number,
  sectionBeats: number,
): N[] {
  const note = notes[index];
  if (!note) return [...notes];
  const duration = lengthFromEdge(note.startTime, edgeTime, unit, sectionBeats);
  if (duration === note.duration) return [...notes];
  return notes.map((entry, at) =>
    at === index ? { ...entry, duration } : entry,
  );
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
