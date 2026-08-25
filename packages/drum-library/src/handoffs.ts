import type { PackedNote, PackedVariant } from "./presetData.js";

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
        const fill = pool[hashSeed(`${seed}:fill`) % pool.length];
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
