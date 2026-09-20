/**
 * Euclidean fitting — the inverse of the library's `euclidOnsetSteps`.
 *
 * Given one lane's hits over a run of steps, find the (k, n, rotation) whose
 * necklace lands closest to them. The search is brute force and scores
 * candidates by GENERATING onsets, so results are always in Track Draft's
 * own convention.
 *
 * NB: Track Draft's necklace is NOT the classic Toussaint/Bjorklund one. It
 * places onset i at round(i·n/k) and shifts by `rotation`, so E(3,8) is
 * [0,3,5] here (Bjorklund gives [0,3,6]). "Euclidean" in this module means
 * "Euclidean as Track Draft renders it".
 *
 * `libraryOnsets` below is a verbatim copy of `euclidOnsetSteps`
 * (packages/drum-library/src/section.ts:92) so this file has no imports;
 * test/drumImport.parity.test.ts asserts the copy never drifts from the real
 * function.
 */

export interface EuclidParams { k: number; n: number; rotation: number }

/** Steps (0..n-1) that carry an onset for the given params. */
export type OnsetFn = (p: EuclidParams) => number[];

/** Verbatim behaviour of `euclidOnsetSteps` from @drum/library. */
export const libraryOnsets: OnsetFn = (pat) => {
  const n = Math.max(1, Math.floor(pat.n));
  const k = Math.max(1, Math.min(n, Math.floor(pat.k)));
  const r = ((Math.floor(pat.rotation) % n) + n) % n;
  const steps: number[] = [];
  for (let i = 0; i < k; i++) {
    const base = Math.round((i * n) / k);
    steps.push((base + r) % n);
  }
  return steps.sort((a, b) => a - b);
};

export interface EuclidFit extends EuclidParams {
  /** Hamming distance between the input and the fitted necklace (steps). */
  error: number;
  /** Onsets in the input. */
  hits: number;
  exact: boolean;
}

/**
 * Best Euclidean fit for `steps` (n = steps.length). Returns null for an
 * empty pattern — the library clamps k >= 1, so silence has to be expressed
 * as an empty `steps` block instead.
 *
 * Ties break toward: k closest to the hit count, then the smallest rotation
 * (so a symmetric necklace always reports its canonical rotation).
 */
export function fitEuclid(
  steps: readonly boolean[],
  opts: { onsets?: OnsetFn } = {},
): EuclidFit | null {
  const n = steps.length;
  const hits = steps.reduce((c, s) => c + (s ? 1 : 0), 0);
  if (n === 0 || hits === 0) return null;
  const onsets = opts.onsets ?? libraryOnsets;

  let best: EuclidFit | null = null;
  let bestKey: [number, number, number, number] = [Infinity, Infinity, Infinity, Infinity];
  for (let k = 1; k <= n; k++) {
    for (let rotation = 0; rotation < n; rotation++) {
      const on = new Set(onsets({ k, n, rotation }));
      let error = 0;
      for (let i = 0; i < n; i++) if (steps[i] !== on.has(i)) error++;
      const key: [number, number, number, number] = [error, Math.abs(k - hits), rotation, k];
      if (lexLess(key, bestKey)) {
        bestKey = key;
        best = { k, n, rotation, error, hits, exact: error === 0 };
      }
    }
  }
  return best;
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** Debug/report helper: `x..x.x..` */
export function stepsToString(steps: readonly boolean[]): string {
  return steps.map((s) => (s ? "x" : ".")).join("");
}
