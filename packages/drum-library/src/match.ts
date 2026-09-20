import { PRESET_DATA } from "./presetData.js";
import type { PackedPreset, PackedVariant } from "./presetData.js";
import type { DrumPattern } from "./presets.js";

/**
 * Pattern matching — score a section's drum material against every baked
 * groove variant and rank the closest substitutes.
 *
 * This is the "sub a more sensible pattern" engine: given whatever a
 * section currently plays (a resolved variant, an imported groove, a
 * hand-authored voice set), it answers "which library pattern is really
 * this?" so the UI can offer a canonical preset instead of the material,
 * and the auto-assigner can pick a preset that matches what the section
 * actually does rather than only what it's labeled.
 *
 * Matching is deliberately phase-aware, exactly like the transcriber
 * scoreboard (`apps/trackdraft/scripts/transcribe-accuracy.ts`): the same
 * groove rotated by a beat is still the same groove to a human ear, and
 * an alignment-only miss must not read as a content miss. Multi-bar
 * material is folded by phase (a hit anywhere on a loop phase marks that
 * phase), so repeated bars reinforce the pattern and one-off fills don't
 * dominate the score.
 */

export type MatchLane = "kick" | "snare" | "hat";

/** GM pitches the matcher understands, mirroring the analysis lanes. */
export const MATCH_LANES: Record<number, MatchLane> = {
  35: "kick", 36: "kick",
  37: "snare", 38: "snare", 39: "snare", 40: "snare",
  42: "hat", 44: "hat", 46: "hat",
};

/**
 * Lane weights: kick and snare carry the groove's identity; hats are
 * near-constant texture (8ths in half the library) and would otherwise
 * dominate every score by sheer cell count.
 */
const LANE_WEIGHT: Record<MatchLane, number> = { kick: 1.2, snare: 1.2, hat: 0.6 };

const STEPS_PER_BEAT = 4;

export interface PatternMatch {
  pattern: DrumPattern;
  variantIndex: number;
  /** Weighted mean of the per-lane Jaccards, 0..1. */
  score: number;
  /** Per-lane Jaccard at the winning rotation. */
  perLane: Record<MatchLane, number>;
  /** Steps the candidate was rotated to align (0 = already aligned). */
  rotation: number;
  /** Loop length tested, in quarter-note beats. */
  lengthBeats: number;
}

export interface MatchMaterialNote {
  beat: number;
  pitch: number;
}

export interface PatternMatchOptions {
  /** How many results to return (default 8). */
  top?: number;
  /** Restrict candidates to these patterns. */
  patterns?: DrumPattern[];
  /** Test seam: rank these candidates instead of `PRESET_DATA`. */
  candidates?: Array<{ pattern: DrumPattern; variantIndex: number; variant: PackedVariant }>;
}

/** Per-lane step-presence grids for one loop's worth of material, folded by phase. */
function foldPhases(notes: MatchMaterialNote[], lengthBeats: number): Record<MatchLane, boolean[]> {
  const steps = Math.max(1, Math.round(lengthBeats * STEPS_PER_BEAT));
  const grid: Record<MatchLane, boolean[]> = {
    kick: new Array<boolean>(steps).fill(false),
    snare: new Array<boolean>(steps).fill(false),
    hat: new Array<boolean>(steps).fill(false),
  };
  for (const note of notes) {
    const lane = MATCH_LANES[note.pitch];
    if (!lane) continue;
    const phase = ((note.beat % lengthBeats) + lengthBeats) % lengthBeats;
    grid[lane][Math.round(phase * STEPS_PER_BEAT) % steps] = true;
  }
  return grid;
}

function rotate<T>(arr: T[], k: number): T[] {
  const n = arr.length;
  if (k % n === 0) return arr;
  const out = new Array<T>(n);
  for (let i = 0; i < n; i++) out[(i + k) % n] = arr[i];
  return out;
}

/** Jaccard over firing steps; two empty lanes agree (both play nothing). */
function laneJaccard(material: boolean[], candidate: boolean[]): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < material.length; i++) {
    if (material[i] && candidate[i]) inter++;
    if (material[i] || candidate[i]) union++;
  }
  return union === 0 ? 1 : inter / union;
}

function scoreAt(material: Record<MatchLane, boolean[]>, candidate: Record<MatchLane, boolean[]>, k: number) {
  const lanes: MatchLane[] = ["kick", "snare", "hat"];
  const perLane = {} as Record<MatchLane, number>;
  let weighted = 0;
  let total = 0;
  for (const lane of lanes) {
    const j = laneJaccard(material[lane], rotate(candidate[lane], k));
    perLane[lane] = j;
    weighted += LANE_WEIGHT[lane] * j;
    total += LANE_WEIGHT[lane];
  }
  return { score: weighted / total, perLane };
}

/**
 * Rank every candidate variant by how closely it matches `notes`,
 * searching all rotations of each candidate's loop. Deterministic sort:
 * score desc, then rotation asc (prefer the unrotated reading), then
 * pattern name / variant index for stable ties.
 */
export function rankPatternMatches(notes: MatchMaterialNote[], opts: PatternMatchOptions = {}): PatternMatch[] {
  const candidates = opts.candidates ?? defaultCandidates(opts.patterns);
  const results: PatternMatch[] = [];
  for (const { pattern, variantIndex, variant } of candidates) {
    const lengthBeats = variant.lengthBeats;
    if (!(lengthBeats > 0)) continue;
    const material = foldPhases(notes, lengthBeats);
    const candidate = foldPhases(variant.notes.map(([beat, pitch]) => ({ beat, pitch })), lengthBeats);
    const steps = Math.max(1, Math.round(lengthBeats * STEPS_PER_BEAT));
    let best = { score: -1, perLane: { kick: 0, snare: 0, hat: 0 }, rotation: 0 };
    for (let k = 0; k < steps; k++) {
      const s = scoreAt(material, candidate, k);
      if (s.score > best.score + 1e-9) best = { ...s, rotation: k };
    }
    results.push({
      pattern,
      variantIndex,
      score: Math.round(best.score * 1000) / 1000,
      perLane: best.perLane,
      rotation: best.rotation,
      lengthBeats,
    });
  }
  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.rotation - b.rotation ||
      a.pattern.localeCompare(b.pattern) ||
      a.variantIndex - b.variantIndex,
  );
  return opts.top === undefined ? results : results.slice(0, opts.top);
}

function defaultCandidates(patterns?: DrumPattern[]): Array<{ pattern: DrumPattern; variantIndex: number; variant: PackedVariant }> {
  const wanted = patterns ? new Set(patterns) : undefined;
  const out: Array<{ pattern: DrumPattern; variantIndex: number; variant: PackedVariant }> = [];
  for (const [pattern, preset] of Object.entries(PRESET_DATA) as Array<[DrumPattern, PackedPreset | undefined]>) {
    if (!preset) continue;
    if (wanted && !wanted.has(pattern)) continue;
    preset.variants.forEach((variant, variantIndex) => out.push({ pattern, variantIndex, variant }));
  }
  return out;
}
