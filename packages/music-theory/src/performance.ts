/**
 * Performance Effects — deterministic per-chord articulation transforms
 * (strum/pulse/arp), shared by the TrackDraft web app's MIDI export and
 * the trackdraft-bridge Ableton extension. Previously these three
 * transforms were duplicated inline in both consumers; this module is
 * the canonical single implementation.
 *
 * Each transform is a pure generic function operating on any note type
 * that has { pitch, startTime, duration, velocity }. The `ChordPerformanceEffect`
 * type is compatible with @music-theory/song-blueprint's definition.
 */

export interface ChordPerformanceNote {
  pitch: number;
  startTime: number; // beats
  duration: number; // beats
  velocity?: number; // 0-127 (optional to accept NoteDescription's number|undefined)
}

export interface ChordPerformanceEffect {
  style: "strum" | "pulse" | "arp";
  params?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) for deterministic random (arp direction)
// ---------------------------------------------------------------------------

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

function hashStr(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Strum
// ---------------------------------------------------------------------------

/**
 * Strum-spread: notes are staggered outward from lowest to highest pitch
 * by `strumMs` milliseconds (default 150). The stagger is converted from
 * ms to beats using an approximation at 120 bpm (×2 correction so
 * 150ms → 0.3 beats, matching the documented bridge default).
 *
 * Additional params:
 *   velocityDecay (0-1, default 0) — each subsequent note loses this
 *     fraction of its velocity, so the strum fades as it spreads.
 */
export function applyStrum<T extends ChordPerformanceNote>(
  notes: T[],
  params?: Record<string, number>,
): T[] {
  if (notes.length < 2) return notes;
  const strumMs = params?.strumMs ?? 150;
  const velocityDecay = params?.velocityDecay ?? 0;

  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  const staggerBeats = (strumMs / 1000) * 2;
  const interval = staggerBeats / Math.max(1, sorted.length - 1);
  return sorted.map((n, i) => {
    const velDecay = 1 - i * velocityDecay / Math.max(1, sorted.length - 1);
    return {
      ...n,
      startTime: n.startTime + i * interval,
      duration: Math.max(0.05, n.duration - i * interval),
      velocity: Math.round(Math.max(1, (n.velocity ?? 96) * velDecay)),
    } as T;
  });
}

// ---------------------------------------------------------------------------
// Pulse (re-trigger / tremolo)
// ---------------------------------------------------------------------------

/**
 * Tremolo re-trigger: each note in the chord is split into `subdivision`
 * equal-duration hits across the original note's span (default 4).
 * Velocities follow a triangle wave across the re-trigger cycle.
 *
 * Additional params:
 *   velocityDepth (0-1, default 0.4) — how deep the triangle wave
 *     modulates velocity (0 = flat velocity, 1 = 0→100% swing).
 *   dutyCycle (0-1, default 0.5) — where the peak falls in the
 *     subdivision cycle (0.5 = centered triangle; <0.5 = early peak;
 *     >0.5 = late peak).
 */
export function applyPulse<T extends ChordPerformanceNote>(
  notes: T[],
  params?: Record<string, number>,
): T[] {
  if (notes.length === 0) return notes;
  const subdivision = params?.subdivision ?? 4;
  const velocityDepth = params?.velocityDepth ?? 0.4;
  const dutyCycle = params?.dutyCycle ?? 0.5;

  return notes
    .flatMap((n) => {
      const hitDuration = n.duration / subdivision;
      const hits: ChordPerformanceNote[] = [];
      for (let i = 0; i < subdivision; i++) {
        const position = i / Math.max(1, subdivision - 1);
        // Asymmetric triangle wave: peaks at dutyCycle
        const distFromPeak = Math.abs(position - dutyCycle);
        const range = Math.max(dutyCycle, 1 - dutyCycle);
        const factor = range > 0 ? 1 - distFromPeak / range : 1;
        const baseVel = n.velocity ?? 96;
        const modRange = baseVel * velocityDepth;
        const velocity = Math.round(baseVel - modRange + modRange * 2 * factor);
        hits.push({
          pitch: n.pitch,
          startTime: n.startTime + i * hitDuration,
          duration: hitDuration,
          velocity: Math.max(1, Math.min(127, velocity)),
        });
      }
      return hits;
    })
    .sort((a, b) => a.startTime - b.startTime) as T[];
}

// ---------------------------------------------------------------------------
// Arpeggiator
// ---------------------------------------------------------------------------

/**
 * Arpeggiator: cycles through chord notes at a `subdivision` rate
 * across the chord's full duration (default 4).
 *
 * Additional params:
 *   octaves (1-4, default 1) — how many octaves to span.
 *   direction ("up"|"down"|"upDown"|"random", default "up") — pattern
 *     direction. Stored as a numeric key: 0=up, 1=down, 2=upDown, 3=random.
 *   rateOffset (-0.5-0.5, default 0) — push/pull timing of each step.
 */
export function applyArp<T extends ChordPerformanceNote>(
  notes: T[],
  params?: Record<string, number>,
): T[] {
  if (notes.length === 0) return notes;
  const subdivision = params?.subdivision ?? 4;
  const octaves = Math.max(1, params?.octaves ?? 1);
  const directionNum = params?.direction ?? 0;
  const rateOffset = Math.max(-0.5, Math.min(0.5, params?.rateOffset ?? 0));

  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  const stepDuration = notes[0].duration / subdivision;
  const hits: ChordPerformanceNote[] = [];

  // Build the note sequence across octaves
  const baseNotes: { pitch: number; velocity?: number }[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const n of sorted) {
      baseNotes.push({ pitch: n.pitch + oct * 12, velocity: n.velocity ?? 96 });
    }
  }

  // Build the sequence for the number of steps
  const seq: { pitch: number; velocity?: number }[] = [];
  const totalNotes = baseNotes.length;

  // Resolve direction string/number
  // 0=up, 1=down, 2=upDown, 3=random
  const totalSteps = subdivision * octaves;
  const uniquePitches = new Set(baseNotes.map((n) => n.pitch));
  const seed = hashStr(uniquePitches.size.toString());

  if (directionNum === 3) {
    // random — deterministic via seeded RNG
    const rng = mulberry32(seed);
    for (let i = 0; i < totalSteps; i++) {
      seq.push(baseNotes[Math.floor(rng() * baseNotes.length)]!);
    }
  } else if (directionNum === 2) {
    // upDown: up then down
    const up = directionNum === 2 ? baseNotes : baseNotes;
    const down = [...up].reverse().slice(1, -1);
    const cycle = [...up, ...down];
    for (let i = 0; i < totalSteps; i++) {
      seq.push(cycle[i % cycle.length]!);
    }
  } else if (directionNum === 1) {
    // down
    const reversed = [...baseNotes].reverse();
    for (let i = 0; i < totalSteps; i++) {
      seq.push(reversed[i % reversed.length]!);
    }
  } else {
    // up (default)
    for (let i = 0; i < totalSteps; i++) {
      seq.push(baseNotes[i % baseNotes.length]!);
    }
  }

  for (let i = 0; i < Math.max(subdivision, totalSteps); i++) {
    const note = seq[i % seq.length]!;
    const offset = i * rateOffset * stepDuration;
    hits.push({
      pitch: note.pitch,
      startTime: notes[0].startTime + i * stepDuration + offset,
      duration: stepDuration,
      velocity: note.velocity ?? 96,
    });
  }
  return hits as T[];
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Apply a chord's performance effect (if any) to a note list.
 * If `effect` is null/undefined, returns notes unchanged.
 * All params default to values that reproduce the original behavior
 * so existing chords with no params continue to sound identical.
 */
export function applyPerformanceEffect<T extends ChordPerformanceNote>(
  notes: T[],
  effect: ChordPerformanceEffect | undefined,
): T[] {
  if (!effect) return notes;
  switch (effect.style) {
    case "strum":
      return applyStrum(notes, effect.params);
    case "pulse":
      return applyPulse(notes, effect.params);
    case "arp":
      return applyArp(notes, effect.params);
    default:
      return notes;
  }
}

// ---------------------------------------------------------------------------
// Whole-chord note planning (block → effect)
// ---------------------------------------------------------------------------

/** The longest rhythm grid: a bar of 8/4, matching the plug-in's capacity. */
export const RHYTHM_GRID_MAX_STEPS = 32;
/**
 * Sixteenths in a bar of 4/4 — the length a grid has when nothing says
 * otherwise, and what every grid written before meters existed is.
 */
export const RHYTHM_GRID_STEPS = 16;
/** Sixteenths in a beat, which is what turns a digit count into a bar length. */
export const RHYTHM_STEPS_PER_BEAT = 4;

/** Level of each grid step: 0 silent, 1 ghost, 2 normal, 3 accent. */
export type RhythmLevel = 0 | 1 | 2 | 3;

/**
 * A rhythm grid as levels, or null when the value is not one.
 *
 * The grid is the plug-in's wire format — one digit per sixteenth — because that
 * is what it writes into a preset. **The digit count is the bar**: sixteen
 * digits is a bar of 4/4, twelve a bar of 3/4, fourteen a bar of 7/8. That is
 * how a grid carries its meter without a second attribute, and why every grid
 * written before meters existed still means what it did.
 *
 * Validated in one place so the file reader and the note planner cannot disagree
 * about what a grid is.
 */
export function parseRhythmGrid(value: string | undefined | null): RhythmLevel[] | null {
  if (typeof value !== "string" || !/^[0-3]+$/.test(value)) return null;
  if (value.length > RHYTHM_GRID_MAX_STEPS) return null;
  return Array.from(value, (digit) => Number(digit) as RhythmLevel);
}

/** Beats one pass of a grid covers — its bar, read from its own length. */
export function rhythmGridBarBeats(grid: readonly RhythmLevel[]): number {
  return grid.length / RHYTHM_STEPS_PER_BEAT;
}

/** Whether a value is a rhythm grid, for callers that only need the test. */
export function isRhythmGrid(value: string | undefined | null): value is string {
  return parseRhythmGrid(value) !== null;
}

/**
 * A step's velocity relative to the chord's: an accent *is* the chord's
 * velocity, and the softer levels sit under it. Same ratios as the plug-in, so
 * a groove exported from the app sounds like the same groove in the DAW.
 */
function gridVelocity(velocity: number, level: RhythmLevel): number {
  const scale = level === 3 ? 1 : level === 1 ? 0.55 : 0.8;
  return Math.max(1, Math.min(127, Math.round(velocity * scale)));
}

/** A resolved, effect-applied note for one chord — the single shape every
 *  consumer (MIDI export, Ableton clip planner, in-app preview) maps onto
 *  its own timeline/units. */
export interface PlannedChordNote {
  pitch: number;
  startTime: number; // beats
  duration: number; // beats
  velocity: number; // 0-127
}

/**
 * Build the actual note list for a chord: the block voicing at `startBeat`
 * for `durationBeats`, with `performance` applied so a strummed/arpeggiated
 * chord *plans* (and therefore previews and exports) the way it sounds.
 *
 * This is the canonical "what notes does this chord make" function — the
 * app's MIDI export and the Ableton bridge's clip planner both build the
 * block then call `applyPerformanceEffect`; this folds those two steps into
 * one so the in-app preview can share the exact same result instead of
 * re-implementing a block-chord-only path. `intervals` are semitone offsets
 * from the root (e.g. `[0, 4, 7]` for major); callers resolve them from the
 * chord's quality via `getChordIntervals`.
 */
export function planChordNotes(
  rootMidi: number,
  intervals: number[],
  startBeat: number,
  durationBeats: number,
  velocity = 96,
  performance?: ChordPerformanceEffect,
  rhythm?: string,
): PlannedChordNote[] {
  const grid = parseRhythmGrid(rhythm);

  // No grid: the chord is one block across its span, which is what every chord
  // written before the grid existed does.
  if (!grid) {
    const block: PlannedChordNote[] = intervals.map((i) => ({
      pitch: rootMidi + i,
      startTime: startBeat,
      duration: durationBeats,
      velocity,
    }));
    return applyPerformanceEffect(block, performance);
  }

  // A grid says *when* and the performance says *how*: each hit is a short
  // block of its own, with the effect applied across it. One bar long, tiled
  // over a longer chord, and trimmed so the last hit never runs into the next.
  const stepBeats = 1 / RHYTHM_STEPS_PER_BEAT;
  // One pass of the grid is one bar, and the grid's own length says how long
  // that bar is — so a 3/4 grid repeats on the barline instead of drifting a
  // sixteenth further from it every bar.
  const barBeats = rhythmGridBarBeats(grid);
  const notes: PlannedChordNote[] = [];

  for (let bar = 0; bar < durationBeats - 1e-9; bar += barBeats) {
    for (let step = 0; step < grid.length; step++) {
      const offset = bar + step * stepBeats;
      if (offset >= durationBeats - 1e-9) break;

      const level = grid[step];
      if (level === 0) continue;

      const span = Math.min(stepBeats, durationBeats - offset);
      if (span <= 0) continue;

      const block: PlannedChordNote[] = intervals.map((i) => ({
        pitch: rootMidi + i,
        startTime: startBeat + offset,
        duration: span,
        velocity: gridVelocity(velocity, level),
      }));

      notes.push(...applyPerformanceEffect(block, performance));
    }
  }

  return notes;
}