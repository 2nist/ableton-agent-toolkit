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

/**
 * GROOVE-AS-GLUE — the drums' pocket, measured once, imposed on the other
 * parts of the same section.
 *
 * `extractGroove`/`applyGroove` above have carried this since the corpus
 * landed, but nothing ever wired it: the bass and the harmony were planned
 * on the grid while the drums sat behind it, which is exactly the "the band
 * isn't playing together" sound. This is the seam the app's export and the
 * Ableton bridge both call, so the glue can't differ between them.
 *
 * Pure and deterministic: same drum notes in, same offsets out — no RNG, no
 * wall clock, so preview ≡ .mid ≡ live-out ≡ Ableton by construction.
 */

/** The pocket of a section's drums: a one-bar groove map at 16th resolution.
 *  Slots the drums never hit are absent, and `applyGroove` leaves notes on
 *  those slots untouched — there is no measured feel to impose there. */
export function drumPocket(notes: readonly PackedNoteLike[], beatsPerBar: number, grid = 0.25): GrooveMap {
  const loop = Math.max(grid, beatsPerBar);
  return extractGroove(
    // pitch is irrelevant to a groove map (it pools by slot, not by voice)
    notes.map((n) => ({ beat: n.beat, pitch: 0, velocity: n.velocity })),
    loop,
    grid,
  );
}

/** A note in the shape the planners emit: section-relative `startTime`. */
export interface PocketTarget {
  startTime: number;
  duration: number;
  velocity: number;
}

export interface PackedNoteLike {
  beat: number;
  velocity: number;
}

export interface GlueOptions {
  /** 0 = untouched, 1 = the drums' full measured feel. Default 1. */
  strength?: number;
  /** Move velocities with the pocket as well as timing. Default true. */
  applyVelocity?: boolean;
}

/**
 * Impose a pocket on bass/chord notes. Timing and velocity move; PITCH and
 * DURATION are preserved (a glued note starts where the drums sit, it does
 * not become a different note or change length). Offsets are clamped so a
 * note can never cross the section's start.
 */
export function glueToPocket<T extends PocketTarget>(notes: readonly T[], pocket: GrooveMap, options: GlueOptions = {}): T[] {
  if (notes.length === 0 || pocket.points.length === 0) return notes.map((n) => ({ ...n }));
  const strength = Math.max(0, Math.min(1, options.strength ?? 1));
  if (strength <= 0) return notes.map((n) => ({ ...n }));
  const applyVelocity = options.applyVelocity ?? true;
  const slots = Math.round(pocket.lengthBeats / pocket.grid);
  const bySlot = new Map(pocket.points.map((p) => [p.gridBeat, p]));

  return notes.map((note) => {
    const inLoop = ((note.startTime % pocket.lengthBeats) + pocket.lengthBeats) % pocket.lengthBeats;
    const slotBeat = round4((Math.round(inLoop / pocket.grid) % slots) * pocket.grid);
    const point = bySlot.get(slotBeat);
    if (!point) return { ...note };
    return {
      ...note,
      startTime: round4(Math.max(0, note.startTime + point.offset * strength)),
      velocity: applyVelocity
        ? Math.max(1, Math.min(127, Math.round(note.velocity * (1 + (point.velocityFactor - 1) * strength))))
        : note.velocity,
    };
  });
}

/** A one-line, human readout of a pocket — the "what the drums are doing"
 *  line under the glue control (mean signed offset + how much of the grid
 *  the drums actually touch). */
export function pocketSummary(pocket: GrooveMap): { meanOffsetMs: number; slots: number; behind: boolean } {
  const played = pocket.points;
  if (played.length === 0) return { meanOffsetMs: 0, slots: 0, behind: false };
  const mean = played.reduce((sum, p) => sum + p.offset, 0) / played.length;
  // 120 bpm reference — 500 ms per quarter-note beat, the app's default tempo.
  return {
    meanOffsetMs: Math.round(mean * 500),
    slots: played.length,
    behind: mean < -1e-4,
  };
}
