import type {
  Degree,
  TransitionModel,
  NextSuggestion,
  RankedPath,
  BuildOptions,
  SuggestOptions,
} from "./types.js";

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

/**
 * Build a first/second-order Markov transition model from a corpus of
 * degree sequences. Sequences are key-invariant, so one model works for
 * every key.
 */
export function buildTransitionModel(
  sequences: Degree[][],
  opts: BuildOptions = {},
): TransitionModel {
  const firstOrder: Record<string, Record<string, number>> = {};
  const secondOrder: Record<string, Record<string, number>> = {};
  const starts: Record<string, number> = {};
  const ends: Record<string, number> = {};
  const totals: Record<string, number> = {};
  const pairs: Record<string, number> = {};
  let sequenceCount = 0;
  let chordCount = 0;

  for (const seq of sequences) {
    if (seq.length === 0) continue;
    sequenceCount++;
    bump(starts, seq[0]);
    bump(ends, seq[seq.length - 1]);
    for (let i = 0; i < seq.length; i++) {
      chordCount++;
      const d = seq[i];
      if (i + 1 >= seq.length) continue;
      const n = seq[i + 1];
      (firstOrder[d] ??= {})[n] = (firstOrder[d][n] ?? 0) + 1;
      bump(totals, d);
      bump(pairs, `${d} ${n}`);
      if (i + 2 >= seq.length) continue;
      const key = `${d} ${n}`;
      const nn = seq[i + 2];
      (secondOrder[key] ??= {})[nn] = (secondOrder[key][nn] ?? 0) + 1;
    }
  }

  const min = opts.minCount;
  if (min && min > 1) {
    const drop = new Set(
      Object.keys(firstOrder).filter((d) => (totals[d] ?? 0) < min),
    );
    for (const d of drop) {
      delete firstOrder[d];
      delete totals[d];
      delete starts[d];
      delete ends[d];
    }
    for (const d of Object.keys(firstOrder)) {
      for (const t of Object.keys(firstOrder[d])) {
        if (drop.has(t)) delete firstOrder[d][t];
      }
    }
    // prune from-keys left with no surviving targets
    for (const d of Object.keys(firstOrder)) {
      if (Object.keys(firstOrder[d]).length === 0) {
        delete firstOrder[d];
        delete totals[d];
        delete starts[d];
        delete ends[d];
      }
    }
  }

  return {
    degrees: Object.keys(firstOrder),
    firstOrder,
    secondOrder,
    starts,
    ends,
    totals,
    pairs,
    sequenceCount,
    chordCount,
  };
}

/**
 * Rank the most likely next chords given the current progression tail.
 * Uses second-order context when available, falls back to first-order,
 * and to the start distribution when the tail is empty.
 */
export function suggestNext(
  model: TransitionModel,
  tail: Degree[],
  opts: SuggestOptions = {},
): NextSuggestion[] {
  const penalty = opts.selfLoopPenalty ?? 1;

  if (tail.length === 0) {
    const total = Object.values(model.starts).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(model.starts)
      .map(([degree, count]) => ({
        degree,
        count,
        probability: count / total,
        context: "start" as const,
      }))
      .sort((a, b) => b.count - a.count);
  }

  const last = tail[tail.length - 1];
  let from: Record<string, number> | undefined;
  let context: NextSuggestion["context"] = "first";
  if (tail.length >= 2) {
    const key = `${tail[tail.length - 2]} ${last}`;
    if (model.secondOrder[key]) {
      from = model.secondOrder[key];
      context = "second";
    }
  }
  if (!from) from = model.firstOrder[last];
  if (!from) return [];

  // Apply the self-loop penalty to the weighted counts before ranking so the
  // returned probabilities reflect it.
  let total = 0;
  const adjusted: Array<[degree: string, count: number]> = [];
  for (const [degree, count] of Object.entries(from)) {
    const c = penalty !== 1 && degree === last ? count * penalty : count;
    adjusted.push([degree, c]);
    total += c;
  }
  if (total <= 0) return [];

  return adjusted
    .map(([degree, count]) => ({ degree, count, probability: count / total, context }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Rank full continuation paths from a start tail via beam search over the
 * transition model — "rankings of paths by chord."
 */
export function rankPaths(
  model: TransitionModel,
  start: Degree[],
  length: number,
  topK = 5,
  opts: SuggestOptions = {},
): RankedPath[] {
  let beams: RankedPath[] = [{ degrees: [...start], logProb: 0, probability: 1 }];
  const target = Math.max(start.length, length);
  while (beams.length > 0 && beams[0].degrees.length < target) {
    const next: RankedPath[] = [];
    for (const b of beams) {
      for (const s of suggestNext(model, b.degrees, opts).slice(0, topK)) {
        next.push({
          degrees: [...b.degrees, s.degree],
          logProb: b.logProb + Math.log(s.probability || 1e-12),
          probability: b.probability * s.probability,
        });
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.logProb - a.logProb);
    beams = next.slice(0, topK);
  }
  return beams.filter((p) => p.degrees.length === target);
}
