import type { DrumNote } from "./types.js";

/**
 * Groove extraction: distill a variant's *feel* — per-grid-slot timing
 * offsets and velocity emphasis — into a reusable map, the way Ableton's
 * own "extract groove" works on a clip.
 *
 * The point is cross-track pocket: the drums in this library carry real
 * (corpus) or deliberate (synth) micro-structure, and a bass line or comping
 * part generated straight on the grid will fight it. Extract the groove
 * from the section's chosen drum variant, apply it to the other parts, and
 * they sit in the same pocket.
 */

export interface GroovePoint {
  /** Grid position within the loop, in quarter-note beats. */
  gridBeat: number;
  /** Mean signed offset of hits at this slot, in beats. Negative = behind the grid. */
  offset: number;
  /** Mean velocity at this slot relative to the loop's overall mean (1 = average). */
  velocityFactor: number;
}

export interface GrooveMap {
  lengthBeats: number;
  grid: number;
  points: GroovePoint[];
}

/**
 * Measure a groove map from a note list. Notes are folded into one loop of
 * `lengthBeats` (so an already-tiled clip measures the same as one tile)
 * and pooled per nearest grid slot.
 */
export function extractGroove(notes: DrumNote[], lengthBeats: number, grid = 0.25): GrooveMap {
  const slots = Math.round(lengthBeats / grid);
  const offsetSums = new Array<number>(slots).fill(0);
  const velocitySums = new Array<number>(slots).fill(0);
  const counts = new Array<number>(slots).fill(0);

  let velocityTotal = 0;
  for (const note of notes) {
    const beatInLoop = ((note.beat % lengthBeats) + lengthBeats) % lengthBeats;
    const slot = Math.round(beatInLoop / grid) % slots;
    const slotBeat = slot * grid;
    // Offset measured to the *nearest* slot, wrapping the loop seam: a hit
    // played slightly before beat 0 belongs to slot 0, not the last slot.
    let offset = beatInLoop - slotBeat;
    if (offset > lengthBeats / 2) offset -= lengthBeats;
    offsetSums[slot] += offset;
    velocitySums[slot] += note.velocity;
    counts[slot] += 1;
    velocityTotal += note.velocity;
  }

  const meanVelocity = notes.length > 0 ? velocityTotal / notes.length : 1;
  const points: GroovePoint[] = [];
  for (let slot = 0; slot < slots; slot++) {
    if (counts[slot] === 0) continue;
    points.push({
      gridBeat: round4(slot * grid),
      offset: round4(offsetSums[slot] / counts[slot]),
      velocityFactor: round4(velocitySums[slot] / counts[slot] / meanVelocity),
    });
  }
  return { lengthBeats, grid, points };
}

export interface ApplyGrooveOptions {
  /** 0 leaves notes untouched, 1 applies the full measured feel. Default 1. */
  strength?: number;
  /** Apply velocity emphasis as well as timing. Default true. */
  applyVelocity?: boolean;
}

/**
 * Impose a groove map on grid-authored notes (a bass line, comping stabs).
 * Each note snaps its loop position to the nearest measured grid slot and
 * takes on that slot's timing offset and velocity emphasis, scaled by
 * `strength`. Slots the drums never hit leave notes untouched — there is no
 * measured feel to impose there, and inventing one would be noise.
 */
export function applyGroove(notes: DrumNote[], groove: GrooveMap, options: ApplyGrooveOptions = {}): DrumNote[] {
  const strength = options.strength ?? 1;
  const applyVelocity = options.applyVelocity ?? true;
  if (strength <= 0 || groove.points.length === 0) return notes.map((note) => ({ ...note }));

  const bySlot = new Map(groove.points.map((point) => [point.gridBeat, point]));

  return notes.map((note) => {
    const beatInLoop = ((note.beat % groove.lengthBeats) + groove.lengthBeats) % groove.lengthBeats;
    const slots = Math.round(groove.lengthBeats / groove.grid);
    const slotBeat = round4((Math.round(beatInLoop / groove.grid) % slots) * groove.grid);
    const point = bySlot.get(slotBeat);
    if (!point) return { ...note };

    const beat = Math.max(0, note.beat + point.offset * strength);
    const velocity = applyVelocity
      ? Math.max(1, Math.min(127, Math.round(note.velocity * (1 + (point.velocityFactor - 1) * strength))))
      : note.velocity;
    return { beat: round4(beat), pitch: note.pitch, velocity };
  });
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
