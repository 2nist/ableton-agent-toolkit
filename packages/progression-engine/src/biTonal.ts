/**
 * Bi-Tonal harmonic generator — layers a second "color" chord over the anchor
 * block chords of a progression, split into two registers (Instrument A =
 * sustained foundation low, Instrument B = high-register transient/arpeggio).
 *
 * Every anchor chord is "colorized" by shifting its root per a flavor matrix
 * and stacking a color chord above it (see the spec from the bi_tonal_generator
 * schema). Two musical behaviors make it sound like a real performance:
 *
 *  - voice leading: each color chord's voicing is placed at the octave closest
 *    to the previous color chord, so the upper line moves smoothly.
 *  - syncopation: color notes start on an optional off-beat offset per step
 *    (conversational pattern), giving the upper layer rhythmic life.
 *
 * Pure + testable (no SDK dependency). This is the harmonic counterpart to
 * `melody.ts`: melody rides one note at a time; bi-tonal rides a chord.
 */

import type { NoteDescription } from "@ableton-extensions/sdk";

/** The anchor chord the color layer stacks on. */
export interface BiTonalChord {
  rootPc: number;
  quality: string;
  durationBeats: number;
}

/** A flavor entry in the bi-tonal matrix: how to colorize an anchor quality. */
export interface BiTonalFlavorDef {
  /** Semitones to shift the anchor root for the color chord. */
  shift: number;
  /** Quality of the color chord (triad family: "maj" | "min" | "7" | ...). */
  quality: string;
  /** Human label for the resulting compound texture, e.g. "Maj13(#11)". */
  label: string;
}

/** The full bi-tonal matrix: (anchor quality, flavor id) -> color recipe. */
export type BiTonalMatrix = Record<string, Record<string, BiTonalFlavorDef>>;

export interface BiTonalOptions {
  /** Octave (in @music-theory/core numbering) of the anchor foundation. Default 4. */
  anchorOctave?: number;
  /** Octave of the color layer. Default anchorOctave + 2 (strict separation). */
  colorOctave?: number;
  /** Velocity of the color notes. Default 80 (transient, below the anchor). */
  colorVelocity?: number;
  /** Syncopation pattern: beats offset for each step before its color notes.
   *  Default conversational: [0, 0.5, 0, 0.5, 0, 0, 1, 0] repeating. */
  syncopation?: number[];
  /** Duration of color notes in beats. Default 1 (short transients). */
  colorDurationBeats?: number;
  /** Inject an RNG for reproducible voicing tie-breaks. */
  rng?: () => number;
}

export interface GeneratedBiTonal {
  /** Instrument A: the anchor block chords (low register, sustained). */
  anchor: NoteDescription[];
  /** Instrument B: the color chords (high register, syncopated). */
  color: NoteDescription[];
  totalBeats: number;
}

/** The default flavor set, keyed by anchor quality. */
export const BI_TONAL_MATRIX: BiTonalMatrix = {
  major: {
    cinematic_shimmer: { shift: 7, quality: "maj", label: "Maj9" },
    sci_fi_wonder: { shift: 2, quality: "maj", label: "Maj13(#11)" },
    bittersweet_drama: { shift: 11, quality: "min", label: "Maj9(#11)" },
  },
  minor: {
    neo_soul_glow: { shift: 10, quality: "maj", label: "m11" },
    ambient_ocean: { shift: 7, quality: "min", label: "m9" },
  },
  dominant_7th: {
    altered_tension: { shift: 1, quality: "maj", label: "7(b9#9#11)" },
  },
};

/** The flavor used when a section/export doesn't specify one — a mellow
 *  minor-color recipe that sits comfortably over both major and minor
 *  progressions, so the Color track sounds sensible out of the box. */
export const DEFAULT_COLOR_FLAVOR = "neo_soul_glow";

/** Map a @music-theory chord quality to its bi-tonal family bucket. */
export function anchorFamily(quality: string): string {
  if (quality === "maj" || quality === "maj7" || quality === "sus2" || quality === "sus4" || quality === "aug") return "major";
  if (quality === "min" || quality === "min7" || quality === "m7b5" || quality === "dim") return "minor";
  if (quality === "7") return "dominant_7th";
  return "major"; // safe fallback
}

/** Resolve the color recipe for an anchor quality + flavor. Falls back to a
 *  same-quality no-shift recipe when the matrix has no entry for the pair. */
export function resolveFlavor(matrix: BiTonalMatrix, quality: string, flavor: string): BiTonalFlavorDef {
  return matrix[anchorFamily(quality)]?.[flavor] ?? { shift: 0, quality, label: "Unison" };
}

/** The voices (interval set) of a chord quality, as semitones above root. */
function voices(quality: string): number[] {
  switch (quality) {
    case "maj": return [0, 4, 7];
    case "min": return [0, 3, 7];
    case "7": return [0, 4, 7, 10];
    case "maj7": return [0, 4, 7, 11];
    case "min7": return [0, 3, 7, 10];
    case "m7b5": return [0, 3, 6, 10];
    case "dim": return [0, 3, 6];
    case "aug": return [0, 4, 8];
    case "sus2": return [0, 2, 7];
    case "sus4": return [0, 5, 7];
    default: return [0, 4, 7];
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Closest octave for a pitch so it sits near a reference — minimal voice leading. */
function nearestAbove(ref: number | null, pitch: number): number {
  if (ref === null) return pitch;
  let best = pitch;
  let bestDist = Math.abs(best - ref);
  for (let oct = -3; oct <= 3; oct++) {
    const cand = pitch + oct * 12;
    const d = Math.abs(cand - ref);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

/** Conversational syncopation pattern (beats offset per step). */
const CONVERSATIONAL = [0, 0.5, 0, 0.5, 0, 0, 1, 0];

/**
 * Generate the two-layer bi-tonal clip for a progression under a given flavor.
 *
 * - Anchor: each chord's block voicing at `anchorOctave`, sustained for the
 *   full chord duration.
 * - Color: a chord on the shifted root at `colorOctave` (default +2 octaves),
 *   each note pulled toward the previous color note (voice leading), starting
 *   at the syncopation offset, short and quiet (transient layer).
 */
export function generateBiTonal(
  matrix: BiTonalMatrix,
  flavorId: string,
  chords: BiTonalChord[],
  opts: BiTonalOptions = {},
): GeneratedBiTonal {
  const anchorOctave = opts.anchorOctave ?? 4;
  const colorOctave = opts.colorOctave ?? anchorOctave + 2;
  const colorVelocity = opts.colorVelocity ?? 80;
  const colorDur = Math.max(0.25, opts.colorDurationBeats ?? 1);
  const sync = opts.syncopation ?? CONVERSATIONAL;

  const anchor: NoteDescription[] = [];
  const color: NoteDescription[] = [];
  let prevColor: number[] = [];
  let cursor = 0;

  for (let i = 0; i < chords.length; i++) {
    const c = chords[i]!;
    const recipe = resolveFlavor(matrix, c.quality, flavorId);

    // Instrument A — anchor block voicing at the foundation octave.
    const base = anchorOctave * 12 + c.rootPc;
    for (const v of voices(c.quality)) {
      anchor.push({ pitch: base + v, startTime: cursor, duration: c.durationBeats, velocity: 96 });
    }

    // Instrument B — color chord on the shifted root, voice-led toward the
    // previous color chord, starting at the syncopation offset.
    const colorRoot = c.rootPc + recipe.shift;
    const raw = voices(recipe.quality).map((v) => colorOctave * 12 + colorRoot + v);
    let voiced: number[];
    if (prevColor.length === 0) {
      voiced = raw;
    } else {
      // Pull the whole chord toward the previous color chord's centroid, then
      // per-voice nearest octave for smooth voice leading.
      const centroid = prevColor.reduce((a, b) => a + b, 0) / prevColor.length;
      const chordCentroid = raw.reduce((a, b) => a + b, 0) / raw.length;
      const octShift = Math.round((centroid - chordCentroid) / 12);
      const baseChord = raw.map((p) => p + octShift * 12);
      voiced = baseChord.map((p, j) => nearestAbove(prevColor[j] ?? centroid, p));
    }
    for (const p of voiced) color.push({ pitch: p, startTime: cursor + sync[i % sync.length]!, duration: colorDur, velocity: colorVelocity });
    prevColor = voiced;

    cursor += c.durationBeats;
  }

  return { anchor, color, totalBeats: cursor };
}
