import type { CanonicalRole } from "./types.js";

/**
 * Substitution cost between two distinct roles, 0 (free) to 1 (full cost,
 * same as an insert/delete). Keys are role pairs joined by "|"; looked up
 * in both orders. Pairs not listed default to full cost — the safe choice
 * for roles that are genuinely, structurally distinct.
 *
 * The values encode real musical knowledge, which is the entire reason
 * this is a weighted metric rather than plain Levenshtein: confusing a
 * chorus for a pre-chorus (they're both "the lift into the hook") is a
 * much smaller error than confusing a chorus for a verse, and a bridge and
 * a guitar solo are both "the one-off departure section" even though
 * they're structurally distinct roles.
 */
const SUBSTITUTION_COST: Record<string, number> = {
  "chorus|pre_chorus": 0.4,
  "bridge|solo": 0.3,
  "verse|bridge": 0.7,
};

function substitutionCost(a: CanonicalRole, b: CanonicalRole): number {
  if (a === b) return 0;
  return SUBSTITUTION_COST[`${a}|${b}`] ?? SUBSTITUTION_COST[`${b}|${a}`] ?? 1;
}

/**
 * Weighted Levenshtein distance between two role skeletons, normalized by
 * the longer sequence's length so scores stay in [0, 1] regardless of song
 * length. Insert/delete cost is always 1; substitution cost comes from
 * SUBSTITUTION_COST above.
 *
 * Alternatives considered and rejected:
 * - Exact match: measured directly — 469 distinct signatures from 739
 *   songs. Dead on arrival.
 * - Bag-of-roles / set similarity: discards order, and order IS the
 *   narrative arc — Verse-Chorus-Verse and Chorus-Verse-Chorus have
 *   identical bags but are different forms.
 * - LCS ratio: under-penalizes insertion, so a long jam matches every
 *   short form it contains as a subsequence.
 * - Full Needleman-Wunsch with affine gaps: same asymptotic cost, but the
 *   extra gap-open/gap-extend parameter has no musical interpretation we
 *   could validate, unlike the substitution matrix above.
 *
 * Performance is a non-issue at this scale — skeletons are capped at 10
 * tokens, so classifying against ~25 forms is well under 2,500 DP cells
 * per song.
 */
export function formDistance(a: readonly CanonicalRole[], b: readonly CanonicalRole[]): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const sub = dp[i - 1][j - 1] + substitutionCost(a[i - 1], b[j - 1]);
      const del = dp[i - 1][j] + 1;
      const ins = dp[i][j - 1] + 1;
      dp[i][j] = Math.min(sub, del, ins);
    }
  }

  return dp[rows - 1][cols - 1] / maxLen;
}

export function similarity(a: readonly CanonicalRole[], b: readonly CanonicalRole[]): number {
  return 1 - formDistance(a, b);
}
