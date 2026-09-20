/**
 * Seeded picking shared by the lyric tools. Same seed → same result, so a
 * section shows the same prompts every time it's opened, and "roll N" is just
 * an integer you can store instead of the prompt itself.
 */

/** FNV-1a — the hash the drum library uses for its seeded picks. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle keyed by `seed`. */
export function shuffled<T>(pool: readonly T[], seed: string): T[] {
  const out = [...pool];
  const rnd = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The n-th card of a seeded shuffle: consecutive rolls never repeat until the
 * whole pool has been dealt (then the same order starts over).
 *
 * An empty pool is a programming error (it would produce `n % 0` → `NaN` →
 * `undefined`), so it throws instead of silently dealing nothing. Filtered
 * pools (e.g. `composeSpark`'s rule candidates) must fall back to their
 * unfiltered bank rather than reach this point empty.
 */
export function deal<T>(pool: readonly T[], seed: string, n: number): T {
  if (pool.length === 0) throw new Error("deal(): empty pool");
  const deck = shuffled(pool, seed);
  return deck[((n % deck.length) + deck.length) % deck.length];
}
