import type { PackedNote, PackedVariant } from "./presetData.js";
import { styleAffinity } from "./style-family.js";

/**
 * Fill variants keyed by beats-per-bar (as a string, e.g. `"4"`, `"3.5"`),
 * split by family so a caller can match a fill to the groove it's replacing
 * — a trap section should not get a jazz tom run. Same shape as
 * `FILL_DATA` (`presetData.ts`); kept as its own type here so a caller can
 * pass fixture fills in tests without depending on the real bake.
 */
export interface FillLibrary {
  acoustic: Record<string, PackedVariant[]>;
  synth: Record<string, PackedVariant[]>;
}

/**
 * FNV-1a — the seeding this whole library uses wherever a deterministic-but-
 * unpredictable pick is needed (variant selection, fill selection, groove
 * micro-variation), so the same section always renders the same way and
 * different sections don't suspiciously line up.
 */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A section's own id for the first pass through it, `id:occurrenceIndex`
 * for every repeat after that — so a section repeated in an arrangement
 * gets independently varied drums per pass instead of rendering every
 * repeat byte-identical by accident. Occurrence 0 (a section that plays
 * once, or the first pass of one that repeats) always resolves to the bare
 * section id, so a caller with no concept of repeats keeps producing
 * byte-identical output.
 */
export function occurrenceSeed(sectionId: string, occurrenceIndex: number): string {
  return occurrenceIndex === 0 ? sectionId : `${sectionId}:${occurrenceIndex}`;
}

/**
 * Scale a groove's baked-in velocities so its peak lands on a target
 * velocity, without touching the *shape* of its dynamics.
 *
 * The alternative — replacing every note's velocity with a flat value — is
 * exactly the bug this library used to ship: it destroys ghost notes and
 * ends up sounding uniformly hammered. Scaling the peak is what a mixing
 * engineer does with a fader, not a compressor.
 */
export function scaleToVelocityPreset(notes: PackedNote[], targetPeak: number): PackedNote[] {
  const peak = Math.max(...notes.map(([, , velocity]) => velocity), 1);
  const scale = targetPeak / peak;
  return notes.map(([beat, pitch, velocity]) => [beat, pitch, Math.max(1, Math.min(127, Math.round(velocity * scale)))]);
}

/**
 * The fill pool for a groove: matched to the groove's bar length, and to
 * its family first — a trap section gets a programmed roll, an acoustic
 * verse gets a played fill — falling back to the other family rather than
 * to silence when only one has material for this meter.
 */
export function fillPool(variant: PackedVariant, fills: FillLibrary): PackedVariant[] {
  const key = String(variant.beatsPerBar);
  const preferred = variant.source.origin === "synth" ? fills.synth : fills.acoustic;
  const fallback = variant.source.origin === "synth" ? fills.acoustic : fills.synth;
  const pool = preferred[key] ?? [];
  return pool.length > 0 ? pool : (fallback[key] ?? []);
}

/** Hits per bar of a variant's own loop — the density a fill has to answer. */
function densityPerBar(variant: Pick<PackedVariant, "notes" | "lengthBeats" | "beatsPerBar">): number {
  const bars = variant.lengthBeats / Math.max(variant.beatsPerBar, 1e-9);
  return variant.notes.length / Math.max(bars, 1e-9);
}

/**
 * The fills that actually answer this groove.
 *
 * `fillPool` matches family and meter; that is not enough. A `bridge_sparse`
 * groove runs at 6 hits per bar, and the same pool holds fills at 25 — the
 * fill then sounds like a different song arriving early, and the section it
 * was meant to lead into gets buried. Selecting by density (at least as busy
 * as the groove, at most ~2.5x) keeps the gesture legible. When nothing
 * matches — a very sparse or a very busy groove — the whole pool is used
 * rather than losing the fill entirely.
 */
export function fillsForGroove(pool: PackedVariant[], variant: PackedVariant): PackedVariant[] {
  const groove = densityPerBar(variant);
  if (groove <= 0) return pool;
  const suited = pool.filter((fill) => {
    const density = densityPerBar(fill);
    return density >= groove * 0.9 && density <= groove * 2.5;
  });
  return suited.length > 0 ? suited : pool;
}

/**
 * The auto variant pick for a seeded section — the clean downbeat groove
 * (variant 0, snare on the downbeats) stays the single most common pick,
 * with the corpus/synth variants spread behind it. Shared by the app's
 * preview/export and the bridge's Ableton plan so they agree.
 *
 * The clean weight was 60% until a catalog audit measured what that did
 * to whole songs (`.audit-patterns.ts`: 60.3% of all multi-variant picks
 * landed on v0, 46/194 songs were dominated by one pattern·variant combo,
 * 9.6% of adjacent section pairs were literally identical grooves). 35%
 * keeps the no-flam default common without flattening entire songs into
 * one groove — the seeded spread over the 79 corpus variants is the point
 * of having them.
 */
export function pickVariantIndex(seed: number, variantCount: number): number {
  if (variantCount <= 1) return 0;
  // ~35% land on the clean default (variant 0); the rest spread across
  // every other variant.
  return seed % 100 < 35 ? 0 : 1 + (seed % (variantCount - 1));
}

/** Meter arithmetic tolerance — MIDI-derived meters are exact quarter
 *  beats (7/8 = 3.5, 21/16 = 5.25) but variant data rounds to 4 decimals. */
const METER_EPSILON = 0.01;

/** True when `value` is (within tolerance) an integer multiple of `unit`:
 *  divides(14, 3.5) → true, divides(5.25, 3.5) → false. */
function divides(value: number, unit: number): boolean {
  if (unit <= 0) return false;
  const quotient = value / unit;
  return Math.abs(quotient - Math.round(quotient)) * unit < METER_EPSILON;
}

/**
 * Indices of variants that can play a section cleanly:
 *
 *  - the groove's own meter matches the section's bar length (a 4/4 groove
 *    is never compatible with a 7/8 section), and
 *  - the phrase either tiles the section exactly
 *    (`sectionBeats % lengthBeats === 0`) or spans whole bars
 *    (`lengthBeats % barBeats === 0`), so a truncated final loop still
 *    lands on a barline.
 *
 * Every baked corpus variant is whole bars of its own meter, so on a 4/4
 * section this returns the full list — existing picks are unchanged.
 * Returns `[]` when nothing is compatible (callers fall back to the full
 * list, preserving the legacy pick).
 */
export function compatibleVariantIndices(
  variants: ReadonlyArray<Pick<PackedVariant, "lengthBeats" | "beatsPerBar">>,
  sectionBeats: number,
  barBeats: number,
): number[] {
  const out: number[] = [];
  variants.forEach((variant, index) => {
    if (Math.abs(variant.beatsPerBar - barBeats) > METER_EPSILON) return;
    if (divides(sectionBeats, variant.lengthBeats) || divides(variant.lengthBeats, barBeats)) {
      out.push(index);
    }
  });
  return out;
}

/**
 * Meter-aware `pickVariantIndex`. Identical seeding and the same 35%
 * clean-downbeat default whenever the full set is compatible (any 4/4
 * section — picks stay bit-identical), but when the section's meter
 * excludes part of the pool it picks only among the variants that fit:
 * 7/8 sections draw the mined Zappa 7/8 grooves, 5/4 sections the 5/4
 * ones, and so on. Falls back to the full list when nothing is compatible
 * so an unmined meter keeps its old (drifting) behavior rather than
 * losing its drums entirely.
 */
export function pickVariantIndexFor(
  seed: number,
  variants: ReadonlyArray<Pick<PackedVariant, "lengthBeats" | "beatsPerBar" | "style">>,
  sectionBeats: number,
  barBeats: number,
  /**
   * Which pass of this section this is (0 = first). The clean-downbeat
   * default is a *statement* — it belongs on the first time through. Repeats
   * spread across the pool instead, so a chorus that comes round again isn't
   * the identical two-bar cell for the fourth time. A catalogue audit found
   * the unconditional 35% bias put 36% of all sections on variant 0.
   */
  occurrenceIndex = 0,
  /**
   * The song's corpus style family ("funk", "rock", "latin"…). When the pool
   * holds any variants from that tradition, selection is restricted to them;
   * when it doesn't (odd meters, synth idioms, a style the bake had no
   * material for), the full pool is used rather than returning nothing.
   */
  style?: string,
): number {
  if (variants.length <= 1) return 0;
  const compatible = compatibleVariantIndices(variants, sectionBeats, barBeats);
  const base = compatible.length > 0 ? compatible : variants.map((_, index) => index);
  // Prefer the song's own family, then its musical neighbours (see
  // `styleAffinity`) — one family alone is too thin to draw from.
  const affinity = new Set(styleAffinity(style));
  const styled = affinity.size > 0 ? base.filter((index) => affinity.has(variants[index]?.style ?? "")) : [];
  const pool = styled.length > 0 ? styled : base;
  if (pool.length === 1) return pool[0];
  const cleanSlot = pool.indexOf(0);
  if (cleanSlot >= 0 && occurrenceIndex === 0 && seed % 100 < 35) return 0;
  const spread = cleanSlot >= 0 ? pool.filter((index) => index !== 0) : pool;
  return spread[seed % spread.length];
}

export interface HandoffSectionInput {
  sectionId: string;
  occurrenceIndex: number;
  /** Resolved variant for this section, or `null` when nothing matched (renders as an empty clip). */
  variant: PackedVariant | null;
  durationBeats: number;
  velocityTarget: number;
}

export interface SectionHandoffPlan {
  /**
   * Fill notes — family-matched, velocity-scaled, and already positioned at
   * absolute beat offsets within the section — to splice in starting at
   * `fillStart`, replacing any groove notes at or after it. Empty when no
   * fill applies to this section.
   */
  fillNotes: PackedNote[];
  /** Beat within the section where the fill begins; `null` when `fillNotes` is empty. */
  fillStart: number | null;
  /**
   * True when the *previous* section built into this one with a fill, so
   * this section should open with a crash — unless its own groove already
   * has one, which only the caller (post-variation) can check.
   */
  precededByFill: boolean;
}

/**
 * Section transitions across a whole song: when a section hands off to
 * another and is long enough that losing a groove bar reads as a fill
 * rather than as the whole section, its last bar is replaced by a fill from
 * the matching family, scaled toward the *louder* of the two sections when
 * building up and pulled back when settling down.
 *
 * Pure and DAW-agnostic — takes already-resolved per-section descriptors
 * (a caller maps its own section/blueprint model into `HandoffSectionInput`)
 * so this has no dependency on any particular song-blueprint schema.
 */
export function planSectionHandoffFills(
  sections: HandoffSectionInput[],
  fills: FillLibrary,
): SectionHandoffPlan[] {
  let previousEndedWithFill = false;

  return sections.map((section, i) => {
    const precededByFill = previousEndedWithFill;
    const { variant, durationBeats, velocityTarget, sectionId, occurrenceIndex } = section;

    if (!variant) {
      previousEndedWithFill = false;
      return { fillNotes: [], fillStart: null, precededByFill };
    }

    const next = i + 1 < sections.length ? sections[i + 1] : null;
    if (next && next.variant && durationBeats >= 2 * variant.beatsPerBar) {
      const pool = fillPool(variant, fills);
      if (pool.length > 0) {
        const seed = occurrenceSeed(sectionId, occurrenceIndex);
        const suited = fillsForGroove(pool, variant);
        const fill = suited[hashSeed(`${seed}:fill`) % suited.length];
        const nextTarget = next.velocityTarget;
        // Build toward a louder section; ease into a quieter one.
        const fillTarget = nextTarget >= velocityTarget ? Math.max(velocityTarget, nextTarget) : Math.round(velocityTarget * 0.85);
        const scaledFill = scaleToVelocityPreset(fill.notes, fillTarget);
        const fillStart = durationBeats - fill.lengthBeats;
        const fillNotes: PackedNote[] = scaledFill
          .map(([beat, pitch, velocity]): PackedNote => [fillStart + beat, pitch, velocity])
          .filter(([beat]) => beat < durationBeats);

        previousEndedWithFill = true;
        return { fillNotes, fillStart, precededByFill };
      }
    }

    previousEndedWithFill = false;
    return { fillNotes: [], fillStart: null, precededByFill };
  });
}
