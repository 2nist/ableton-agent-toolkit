import { voiceOf, type KitVoice, type PackedNote } from "@drum/library";
import { stepIndexOf } from "./stepMath";

/** A lane as the grid needs it — the name, and the kit voices it absorbs. */
export interface GridLane {
  key: string;
  voices: readonly KitVoice[];
}

/**
 * Velocity tiers.
 *
 * The E-GMD takes are full of ghost notes: 45% of all snare hits in `standard`
 * sit below velocity 45. Drawn identically they read as a backbeat twice as
 * busy as the kick — which is exactly how a listener reported it. Every drum
 * surface therefore tiers velocities the same way; the thresholds live here so
 * they cannot drift apart.
 */
export const GHOST_MAX = 45;
export const ACCENT_MIN = 100;

export type VelocityTier = "ghost" | "normal" | "accent";

export function velocityTier(velocity: number): VelocityTier {
  if (velocity < GHOST_MAX) return "ghost";
  if (velocity >= ACCENT_MIN) return "accent";
  return "normal";
}

/** One lane's cells: step index → the loudest velocity that lands there. */
export type LaneCells = Map<number, number>;

/** `laneKey → cells`, for the lanes that have any hit. */
export type GridCells = Map<string, LaneCells>;

export function laneForVoice(lanes: readonly GridLane[], voice: KitVoice): GridLane | undefined {
  return lanes.find((l) => l.voices.includes(voice));
}

/**
 * Project resolved notes onto a grid of `stepsPerBar` cells per bar.
 *
 * A cell keeps the loudest hit that lands on it (a flam is one cell, not two),
 * steps wrap within the bar, and off-grid corpus onsets snap through
 * `stepIndexOf` — the same mapping the editor writes with, so a cell reads the
 * same in every surface.
 */
export function cellsFromNotes(
  notes: readonly PackedNote[],
  lanes: readonly GridLane[],
  stepsPerBar: number,
  stepBeats: number,
): GridCells {
  const steps = Math.max(1, stepsPerBar);
  const cells: GridCells = new Map();
  for (const [beat, pitch, velocity] of notes) {
    const voice = voiceOf(pitch);
    if (!voice) continue;
    const lane = laneForVoice(lanes, voice);
    if (!lane) continue;
    const step = ((stepIndexOf(beat, stepBeats) % steps) + steps) % steps;
    let row = cells.get(lane.key);
    if (!row) {
      row = new Map();
      cells.set(lane.key, row);
    }
    row.set(step, Math.max(row.get(step) ?? 0, velocity));
  }
  return cells;
}

/**
 * Steps and step length for a bar of a given length. Sixteenths, capped at 16
 * so a 12/8 bar (6 beats) still divides evenly, and never fewer than 4 so an
 * odd bar keeps a readable grid.
 */
export function stepsForBar(beatsPerBar: number): { stepsPerBar: number; stepBeats: number } {
  const steps = Math.max(4, Math.round(beatsPerBar * 4));
  return { stepsPerBar: steps, stepBeats: beatsPerBar / steps };
}
