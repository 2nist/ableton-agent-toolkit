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

// ---------------------------------------------------------------------------
// Cyclic development
// ---------------------------------------------------------------------------

/**
 * The 4-bar cycle — how a groove DEVELOPS without stopping repeating.
 *
 * Tiling gives you the same bar N times, and `tileGrooveVaried` only shades
 * velocities. A drummer playing eight bars of a verse does something else as
 * well: bar 2 opens the hat up, bar 4 turns the last eighth over into the
 * next cycle. That is not a fill (fills come from `FILL_DATA`) and it is not
 * random — it is the same turnaround every time, which is exactly what makes
 * it feel like a groove rather than a loop.
 *
 * Pure and deterministic: the same tiled notes in give the same notes out, so
 * the preview grid, the .mid and the Ableton plan all agree.
 *
 * Additions are gated on what the groove already plays, so a `kick_only`
 * pulse never sprouts a hi-hat and a hatless groove never gets an open hat.
 */
export interface CycleOptions {
  beatsPerBar: number;
  durationBeats: number;
  /** Bars per cycle. Default 4. */
  cycleBars?: number;
  velocityTarget: number;
  openHatPitch: number;
  closedHatPitch: number;
  kickPitch: number;
}

/** Two hits closer than this are the same hit — don't stack a second one. */
const CYCLE_EPSILON = 0.06;

export function applyCyclicDevelopment(notes: DrumNote[], options: CycleOptions): DrumNote[] {
  const { beatsPerBar, durationBeats, velocityTarget, openHatPitch, closedHatPitch, kickPitch } = options;
  const cycleBars = Math.max(2, options.cycleBars ?? 4);
  if (beatsPerBar <= 0 || durationBeats <= beatsPerBar) return notes;

  const hasHat = notes.some((n) => n.pitch === openHatPitch || n.pitch === closedHatPitch);
  const hasKick = notes.some((n) => n.pitch === kickPitch);
  if (!hasHat && !hasKick) return notes;

  const out = notes.map((n) => ({ ...n }));
  const occupied = (beat: number, pitch: number): boolean =>
    out.some((n) => n.pitch === pitch && Math.abs(n.beat - beat) < CYCLE_EPSILON);
  const add = (beat: number, pitch: number, velocity: number): void => {
    if (beat >= durationBeats - 1e-9 || occupied(beat, pitch)) return;
    out.push({ beat: round4(beat), pitch, velocity });
  };

  const lastEighth = Math.max(0.25, beatsPerBar - 0.5);
  for (let bar = 0; bar < Math.ceil(durationBeats / beatsPerBar - 1e-9); bar++) {
    const barStart = bar * beatsPerBar;
    if (barStart >= durationBeats - 1e-9) break;
    const inCycle = bar % cycleBars;

    // Second bar of the cycle: open the hat on the last eighth.
    if (inCycle === 1 && hasHat) {
      add(barStart + lastEighth, openHatPitch, Math.round(velocityTarget * 0.72));
    }
    // Last bar of the cycle: turn the last eighth over into the next cycle.
    if (inCycle === cycleBars - 1 && hasKick) {
      add(barStart + lastEighth, kickPitch, Math.round(velocityTarget * 0.8));
    }
  }

  return out.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
