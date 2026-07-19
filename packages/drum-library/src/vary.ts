import type { DrumNote } from "./types.js";
import { tileGroove } from "./resolve.js";

/**
 * Seeded per-bar micro-variation, applied when a groove is tiled across a
 * section. A 16-bar verse tiled from one 2-bar variant repeats identically
 * eight times; a human drummer never does. This nudges each repeat apart —
 * deterministically, so re-applying a blueprint still reproduces the exact
 * same clip — without touching what makes the groove itself:
 *
 * - The first tile is left completely untouched: it states the pattern.
 * - Velocities breathe a few points per repeat (different offset per tile).
 * - Timekeeping hats occasionally drop a hit (never kick or snare, and
 *   never on a downbeat) — the gap is what reads as human.
 *
 * Timing is deliberately not jittered. Corpus grooves already carry real
 * microtiming; synthesized machine idioms are *supposed* to be grid-tight.
 */

const HAT_PITCHES = new Set([42, 46]);

export interface VaryOptions {
  /** Deterministic seed — pass the section id. */
  seed: string;
  /** 0 disables, 1 is the full effect. Default 0.5. */
  amount?: number;
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tile a groove to fill `totalBeats`, varying every repeat after the first.
 * Same contract as `tileGroove` (final repeat truncated, never overshoots).
 */
export function tileGrooveVaried(
  notes: DrumNote[],
  grooveLengthBeats: number,
  totalBeats: number,
  options: VaryOptions,
): DrumNote[] {
  const amount = options.amount ?? 0.5;
  if (amount <= 0 || grooveLengthBeats <= 0) {
    return tileGroove(notes, grooveLengthBeats, totalBeats);
  }

  const tiled: DrumNote[] = [];
  let tileIndex = 0;
  for (let offset = 0; offset < totalBeats; offset += grooveLengthBeats, tileIndex++) {
    const random = mulberry32(hashSeed(`${options.seed}:${tileIndex}`));
    // Whole-tile dynamic drift: this repeat sits a touch above or below the
    // written level, the way a player leans into some bars and off others.
    const tileLean = tileIndex === 0 ? 0 : (random() - 0.5) * 10 * amount;

    for (const note of notes) {
      const beat = offset + note.beat;
      if (beat >= totalBeats) continue;

      if (tileIndex > 0) {
        const onDownbeat = Math.abs(note.beat - Math.round(note.beat)) < 1e-6 && Math.round(note.beat) % 4 === 0;
        if (HAT_PITCHES.has(note.pitch) && !onDownbeat && random() < 0.04 * amount) {
          continue; // dropped hat — the human gap
        }
      }

      const jitter = tileIndex === 0 ? 0 : (random() - 0.5) * 6 * amount;
      const velocity = Math.max(1, Math.min(127, Math.round(note.velocity + tileLean + jitter)));
      tiled.push({ beat, pitch: note.pitch, velocity });
    }
  }
  return tiled;
}
