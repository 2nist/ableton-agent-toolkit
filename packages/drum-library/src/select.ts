import type { LibraryIndex } from "./library-index.js";
import { timeSignatureOf } from "./library-index.js";
import { PRESETS, type DrumPattern } from "./presets.js";
import type { FeelFeatures, GrooveSpec, Limb, Segment, SegmentRef, TimeSignature } from "./types.js";

export interface SelectOptions {
  /**
   * Deterministic seed — pass the section's own id/name. The same section
   * must select the same groove every time a blueprint is re-applied, or
   * "Apply Song Blueprint" stops being idempotent the moment drums are
   * involved, which the rest of this extension already guarantees for
   * chords, bass and cue points.
   */
  seed: string;
  /** How many top-scoring candidates to consider before picking. Higher spreads variety across sections that share a preset; 1 always takes the closest match. */
  poolSize?: number;
  lengthBars?: number;
}

const DEFAULT_POOL_SIZE = 6;

/** FNV-1a. Not cryptographic — just needs to be stable and cheap. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function distance(a: Partial<FeelFeatures>, b: FeelFeatures): number {
  let sum = 0;
  for (const key of Object.keys(a) as (keyof FeelFeatures)[]) {
    const target = a[key];
    if (target === undefined) continue;
    sum += (target - b[key]) ** 2;
  }
  return sum;
}

/**
 * Per-index cache of ranked candidate pools, keyed on everything that
 * changes the result: limb, feel target, time signature, length and pool
 * size. `selectGroove` is called once per *variant* of a preset with an
 * identical target and only the seed differing — without this, picking 10
 * variants meant re-filtering and re-sorting the same multi-million-element
 * per-limb pool 10 times over. A `WeakMap` keyed on the index object itself
 * means a fresh `buildIndex()` (as every test uses) starts with an empty
 * cache, so this is pure memoisation with no risk of stale results leaking
 * between independent corpora.
 */
const candidateCache = new WeakMap<LibraryIndex, Map<string, Segment[]>>();

function cacheKey(
  limb: Limb,
  target: Partial<FeelFeatures>,
  timeSignature: TimeSignature | undefined,
  lengthBars: number | undefined,
  k: number,
): string {
  const ts = timeSignature ? `${timeSignature.numerator}/${timeSignature.denominator}` : "-";
  return `${limb}:${JSON.stringify(target)}:${ts}:${lengthBars ?? "-"}:${k}`;
}

/**
 * Groups segments that come from essentially the same recording rather than
 * independent performances. E-GMD stores repeated recordings of one
 * rehearsed pattern as separate numbered files — `13_rock_115_beat_4-4_2`,
 * `..._5`, `..._22`, `..._43` are the same drummer playing the same pattern
 * over and over, not four different performances. Confirmed directly: for
 * the `driving` preset, six different seeds picked six different `takeId`s
 * that were *all* numbered variants of `13_rock_115_beat_4-4` by the same
 * drummer, and folded to byte-identical Ableton output every time — real
 * file diversity, zero actual variety. `drummer + style + bpm` is the
 * available proxy for "same rehearsed pattern" (E-GMD's own style field
 * sometimes carries a groove number, e.g. `funk/groove1`, which sharpens
 * this further where present).
 */
function takeFamily(index: LibraryIndex, segment: Segment): string {
  const take = index.takes.get(segment.takeId);
  if (!take) return segment.takeId;
  return `${take.drummer}:${take.style}:${take.bpm}`;
}

/**
 * The closest `k` candidates for a limb, ranked by feel distance — at most
 * one per take family, so the result can't be dominated by near-duplicate
 * repeats of a single recording (see `takeFamily`). Within one scan of the
 * per-limb pool, this keeps only the single best-scoring segment seen so
 * far per family; the families map stays far smaller than the pool itself
 * (tens to low hundreds of drummer/style/tempo combinations, not millions
 * of segments), so sorting it at the end is cheap even though the initial
 * scan is still O(n) over the full pool.
 */
function topKCandidates(
  index: LibraryIndex,
  limb: Limb,
  target: Partial<FeelFeatures>,
  timeSignature: TimeSignature | undefined,
  lengthBars: number | undefined,
  k: number,
): Segment[] {
  let cache = candidateCache.get(index);
  if (!cache) {
    cache = new Map();
    candidateCache.set(index, cache);
  }
  const key = cacheKey(limb, target, timeSignature, lengthBars, k);
  const cached = cache.get(key);
  if (cached) return cached;

  const pool = index.byLimb.get(limb) ?? [];
  const bestPerFamily = new Map<string, { segment: Segment; dist: number }>();

  for (const segment of pool) {
    if (lengthBars !== undefined && segment.lengthBars !== lengthBars) continue;
    if (timeSignature) {
      const ts = timeSignatureOf(index, segment);
      if (!ts || ts.numerator !== timeSignature.numerator || ts.denominator !== timeSignature.denominator) continue;
    }

    const dist = distance(target, segment.features);
    const family = takeFamily(index, segment);
    const existing = bestPerFamily.get(family);
    if (!existing || dist < existing.dist) {
      bestPerFamily.set(family, { segment, dist });
    }
  }

  const result = [...bestPerFamily.values()]
    .sort((a, b) => a.dist - b.dist)
    .slice(0, k)
    .map((entry) => entry.segment);
  cache.set(key, result);
  return result;
}

function toRef(segment: Segment): SegmentRef {
  return { takeId: segment.takeId, startBar: segment.startBar, lengthBars: segment.lengthBars };
}

/**
 * Pick one groove per limb for a `DrumPattern` preset.
 *
 * Selection is deterministic (`options.seed`) rather than random: re-running
 * "Apply Song Blueprint" must reproduce the same drums, matching how the
 * chord and bass generators already behave. Each limb is chosen from a small
 * pool of the closest-scoring candidates for that limb specifically — not
 * one take's limbs bundled together — which is the recombination the
 * library was built around: a verse's kick doesn't have to come from the
 * same performance as its snare.
 *
 * Returns null when the preset has no target at all (`none`) or when the
 * corpus has no matching material (`78` — E-GMD contains no 7/8 takes).
 * A caller silently falling back to some other meter under a `78` label
 * would be a worse outcome than an explicit empty result.
 */
export function selectGroove(index: LibraryIndex, pattern: DrumPattern, options: SelectOptions): GrooveSpec | null {
  const preset = PRESETS[pattern];
  if (!preset) return null;

  const poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;
  const seedValue = hashSeed(options.seed);
  const spec: GrooveSpec = {};

  // Recombining limbs across mismatched meter isn't a feel mismatch, it's
  // structurally broken — a 6/8 kick tiled against a 4/4 snare has no
  // consistent bar length at all. `preset.timeSignature` already pins every
  // limb to one meter for `68`/`54`; presets that don't set it (the large
  // majority, all effectively 4/4 by how dominant that meter is in the
  // corpus) still need every limb of *this one spec* to agree with each
  // other, so the first limb picked pins the rest.
  let requiredTimeSignature = preset.timeSignature;

  for (let i = 0; i < preset.limbs.length; i++) {
    const limb = preset.limbs[i];
    const pool = topKCandidates(index, limb, preset.feel, requiredTimeSignature, options.lengthBars, poolSize);
    if (pool.length === 0) continue;

    // Different limbs of the same section must not all collapse onto pool
    // index 0 just because they share a seed — offsetting by limb index
    // spreads them across the pool while staying fully deterministic.
    const choice = pool[(seedValue + i * 2654435761) % pool.length];
    spec[limb] = toRef(choice);

    if (!requiredTimeSignature) {
      const ts = timeSignatureOf(index, choice);
      if (ts) requiredTimeSignature = ts;
    }
  }

  return Object.keys(spec).length > 0 ? spec : null;
}
