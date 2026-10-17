/**
 * Data-driven monophonic melody generator trained on the Tegridy/LA general
 * MIDI corpus (`scripts/extract_melody_model.py` -> `data/melody_model.json`).
 *
 * The corpus encodes general compositions (not genre-restricted pop), with the
 * top voice of each chord acting as the melody note. From it we learn, per
 * chord quality, the distribution of melody intervals above the chord root,
 * the typical melody register (semitones above the root pitch), and a
 * first-order Markov chain on melody intervals across chord changes so the
 * generated line has plausible contour.
 */

/** Structural note shape the generator emits — deliberately not the SDK's
 *  type, so this package stays pure TypeScript with no extension-runtime
 *  dependency. */
export interface GeneratedMelodyNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity: number;
}

/** Per-chord quality: semitone intervals above root (0..11) -> count. */
export type MelodyIntervalTable = Record<string, number[]>;

/** prev melody interval (0..11) -> next interval (0..11) -> count. */
export type MelodyTransitionTable = Record<string, number[]>;

export interface MelodyModel {
  qualities: string[];
  melodyIntervals: MelodyIntervalTable;
  intervalTransitions: MelodyTransitionTable;
  /** quality -> typical semitones of the melody above the chord root pitch. */
  registerMode: Record<string, number>;
  totalChords: number;
  totalMelody: number;
  classified: number;
  source?: string;
}

/** A single chord the melody must ride over (root pc + quality + duration). */
export interface MelodyChord {
  rootPc: number;
  quality: string;
  durationBeats: number;
}

export interface MelodyOptions {
  /** Injectable RNG (seeded) for reproducible output. Defaults to Math.random. */
  rng?: () => number;
  /**
   * Longest a single melody note may last, in beats. Longer chords are
   * subdivided into several notes so the melody keeps moving. Default 4.
   */
  maxNoteBeats?: number;
  /** Melody note velocity. Default 104 (a touch louder than block chords). */
  velocity?: number;
  /**
   * How much the melodic-contour Markov chain biases note choice vs the raw
   * per-chord interval distribution (0..1). Default 0.4.
   */
  contourBias?: number;
}

export interface GeneratedMelody {
  notes: GeneratedMelodyNote[];
  /** Total duration in beats. */
  totalBeats: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function pickWeighted(rng: () => number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Deterministic PRNG (mulberry32) — handy for reproducible demo output and
 * tests. Pass `rng` in MelodyOptions to override.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nearest pitch with the desired pitch class to a reference pitch. */
function nearestWithPc(target: number, pc: number): number {
  const diff = ((pc - ((target % 12) + 12) % 12) + 12) % 12;
  // move the reference pitch to the nearest matching pitch class
  let cand = target + diff;
  if (Math.abs((cand - 12) - target) < Math.abs(cand - target)) cand -= 12;
  if (Math.abs((cand + 12) - target) < Math.abs(cand - target)) cand += 12;
  return cand;
}

/**
 * Generate a monophonic melody that rides the given chords. Each chord gets
 * one or more notes (long chords are subdivided at `maxNoteBeats`), every note
 * is a pitch from the corpus melody distribution for that chord quality, and
 * consecutive notes are pulled toward the previous one (smooth contour) while
 * staying near the corpus register for the quality.
 */
export function generateMelody(
  model: MelodyModel,
  chords: MelodyChord[],
  opts: MelodyOptions = {},
): GeneratedMelody {
  const rng = opts.rng ?? Math.random;
  const maxNoteBeats = Math.max(1, opts.maxNoteBeats ?? 4);
  const velocity = opts.velocity ?? 104;
  const contourBias = clamp(opts.contourBias ?? 0.4, 0, 1);

  const notes: GeneratedMelodyNote[] = [];
  let cursor = 0;
  let prevIv: number | null = null;
  let prevPitch: number | null = null;

  for (const chord of chords) {
    const dist = model.melodyIntervals[chord.quality] ?? model.melodyIntervals["maj"];
    const register = model.registerMode[chord.quality] ?? 15;

    // subdivide long chords into maxNoteBeats chunks
    const parts = Math.max(1, Math.ceil(chord.durationBeats / maxNoteBeats));
    const partBeats = chord.durationBeats / parts;

    for (let p = 0; p < parts; p++) {
      const weights = [...(dist ?? [])];
      if (prevIv !== null) {
        const contour = model.intervalTransitions[String(prevIv)];
        if (contour) {
          for (let i = 0; i < 12; i++) {
            weights[i] = weights[i] * (1 - contourBias) + contour[i] * contourBias;
          }
        }
      }
      const iv = pickWeighted(rng, weights);

      // Target register: near the corpus register above the chord root, but
      // pulled toward the previous melody pitch so the line stays singable.
      const rootPitch = chord.rootPc + 60; // reference (register is relative)
      const registerTarget = prevPitch ?? rootPitch + register;
      let pitch = nearestWithPc(registerTarget, (chord.rootPc + iv) % 12);
      // keep within a comfortable absolute window (octave 4-6 in this scheme)
      pitch = clamp(pitch, 48, 96);

      notes.push({
        pitch,
        startTime: cursor,
        duration: partBeats,
        velocity,
      });

      cursor += partBeats;
      prevIv = iv;
      prevPitch = pitch;
    }
  }

  return { notes, totalBeats: cursor };
}
