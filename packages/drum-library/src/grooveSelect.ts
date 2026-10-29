/**
 * Which groove a section plays — the ONE selection every consumer shares.
 *
 * Before this module the decision lived in three places: TrackDraft's preview
 * and .mid export (`drumPreview.ts`), the Ableton bridge (`drumClips.ts`), and
 * the heuristic each of them re-implemented — "outline > authored pattern >
 * inferred pattern, then a deterministic variant pick". A `parity.test.ts`
 * existed purely to assert the copies still agreed, and both were annotated
 * "must match the other argument-for-argument". This module is that contract,
 * expressed once.
 *
 * Two things stay with the consumer, on purpose:
 *
 * - **Humanisation.** An outline's mathematically-perfect onsets get a real
 *   performance's microtiming on export (see `humanizeOutlineVariant`), but
 *   the editor's step grid must draw the EXACT grid or the user's edits stop
 *   lining up with what they see. So selection returns un-humanised notes and
 *   each exporter humanises.
 * - **Song-level type maths.** `durationBeats` and `beatsPerBar` are
 *   parameters rather than derived here, so this package stays free of
 *   `@music-theory/song-blueprint` (the app and the bridge each own the
 *   schema-side derivation).
 */

import { PRESET_DATA } from "./presetData.js";
import type { PackedPreset, PackedVariant } from "./presetData.js";
import type { DrumPattern } from "./presets.js";
import { inferPatternForGenre } from "./grooves.js";
import { songSignalsFor } from "./infer.js";
import type { InferSong } from "./infer.js";
import { compatibleVariantIndices, hashSeed, occurrenceSeed, pickVariantIndexFor } from "./handoffs.js";
import { applyStyleToVariant, hasBend, styleSeed } from "./style.js";
import type { StyleProfile } from "./style.js";
import { hasNarrative, resolveEffectiveStyle } from "./narrative.js";
import type { NarrativeSource } from "./narrative.js";
import { styleFamilyFor } from "./style-family.js";
import { humanizeOutlineNotes } from "./section.js";
import { meterGrooveVariant } from "./synthesize.js";
import type { EuclidLike, OutlineWithVoices, SectionDrumInput } from "./section.js";
import type { DrumBlock, DrumLaneId } from "./blocks.js";
import type { KitVoice } from "./kit.js";
import type { TransitionModel } from "./transitions.js";
import { defaultCellVoices, outlineBeatsPerBar, outlineToGroovePattern } from "./meter.js";

/** The five overlapping groove fields, as the resolver reads them. */
export interface GrooveSource<P extends string = DrumPattern> extends NarrativeSource {
  drumPattern?: P;
  drumVariantIndex?: number;
  drumMeterOutline?: OutlineWithVoices | null;
}

/**
 * The groove, as ONE value.
 *
 * On disk a section carries five overlapping fields — `drumPattern`,
 * `drumVariantIndex`, `drumMeterOutline`, `drumBlocks` and the lane mutes —
 * and the precedence between them used to live in prose. That is the bug
 * class this type removes: everything that asks "what plays here?" asks
 * `grooveOf`, and everything that changes it writes the fields back.
 *
 * The fields themselves stay exactly as they are (the schema is shared with
 * every stored song and with the bridge), so this is an API, not a migration.
 *
 * `P` is the caller's own pattern vocabulary: TrackDraft passes its schema
 * union (a subset — the engine also has synth-only idioms like `trap` that no
 * `drumPattern` field can hold), the bridge and the engine use the full one.
 */
export type GrooveChoice<P extends string = DrumPattern> =
  /** The heuristic picks from role + velocity + meter + tempo. */
  | { kind: "auto" }
  /** Explicitly silent — no kit on this section. */
  | { kind: "muted" }
  /** A named preset, optionally a specific variant. */
  | { kind: "preset"; pattern: P; variant?: number }
  /** A hand-authored meter outline (odd meters / Euclid). */
  | { kind: "outline"; outline: OutlineWithVoices };

/** Whether a groove's own meter is the section's — within the same tolerance
 *  `compatibleVariantIndices` uses. */
function sameMeter(variantBeatsPerBar: number, sectionBeatsPerBar: number): boolean {
  return Math.abs(variantBeatsPerBar - sectionBeatsPerBar) < 1e-6;
}

/** What a section's groove source currently is. */
export function grooveOf<P extends string = DrumPattern>(section: GrooveSource<P>): GrooveChoice<P> {
  if (section.drumMeterOutline) return { kind: "outline", outline: section.drumMeterOutline };
  const pattern = section.drumPattern;
  if (!pattern) return { kind: "auto" };
  if (pattern === "none") return { kind: "muted" };
  return { kind: "preset", pattern, variant: section.drumVariantIndex };
}

/** A section, as groove selection reads it — the structural subset of
 *  `BlueprintSection` these functions need. */
export interface GrooveSection<P extends string = DrumPattern> extends GrooveSource<P> {
  id: string;
  role?: string;
  velocity?: string;
  name?: string;
  timeSignatureNumerator: number;
  /** What the schema stores — `2 ** timeSignatureDenPower` is the denominator. */
  timeSignatureDenPower: number;
}

/** A song, as groove selection reads it — the structural subset of
 *  `BlueprintSong` these functions need. */
export interface GrooveSong extends NarrativeSource {
  bpm?: number;
  title?: string;
  concept?: string;
  genre?: string;
  notes?: InferSong["notes"];
}

/**
 * Heuristic pattern for a section — the fallback when nothing was authored:
 * odd meter first, then the song's genre family, then the role/dynamics/
 * tempo heuristic. The `"refrain"` → `"chorus"` normalization lives in
 * `inferPatternForGenre`, so a refrain and a chorus cannot drift.
 */
export function inferPatternForSection(
  section: GrooveSection,
  song?: GrooveSong,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
): DrumPattern {
  return inferPatternForGenre(
    {
      role: section.role,
      velocity: section.velocity,
      name: section.name,
      timeSignatureNumerator: section.timeSignatureNumerator,
      timeSignatureDenominator: 2 ** section.timeSignatureDenPower,
    },
    songSignalsFor(song),
    song?.genre,
    presetData,
  );
}

/**
 * An outline as a `PackedVariant` — a real kick/snare groove when the outline
 * carries `cellVoices` (authored in TrackDraft's Drums tab or Drum Studio's
 * Outline mode), a plain accented click otherwise. Un-humanised: see this
 * module's header for why humanisation belongs to the exporter.
 */
export function outlineVariantFor(outline: OutlineWithVoices): PackedVariant {
  const bpb = outlineBeatsPerBar(outline);
  return {
    lengthBeats: bpb,
    beatsPerBar: bpb,
    // A voiceless outline uses the default backbeat, not a click track: an
    // applied Euclidean pattern has to arrive with a kick and a snare, or the
    // grid shows hats and the writer sees nothing they asked for.
    notes: outlineToGroovePattern(outline, outline.cellVoices ?? defaultCellVoices(outline.cells)),
    source: { origin: "synth", generator: outline.cellVoices ? "outline-groove" : "outline-default-voices" },
  };
}

/**
 * An outline's selected variant, humanised — the step BOTH exporters apply
 * and the preview deliberately skips (the editor draws the exact grid).
 * Extracted so the two exports can't drift on microtiming.
 */
export function humanizeOutlineVariant(
  outline: OutlineWithVoices,
  variant: PackedVariant,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
): PackedVariant {
  return { ...variant, notes: humanizeOutlineNotes(variant.notes, outline.cellBeats, presetData) };
}

/**
 * One variant of a named pattern, clamped to what the preset actually has —
 * `undefined` for a pattern with no baked content, `null` for a variant with
 * nothing playable in it.
 */
export function presetVariantAt(
  pattern: DrumPattern,
  variantIndex: number | undefined,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
): PackedVariant | null {
  const preset = presetData[pattern];
  if (!preset || preset.variants.length === 0) return null;
  const index = variantIndex !== undefined
    ? Math.max(0, Math.min(variantIndex, preset.variants.length - 1))
    : 0;
  const variant = preset.variants[index];
  return variant.notes.length === 0 || variant.lengthBeats <= 0 ? null : variant;
}

/** What a variant pick needs: the pattern, the section, the song signals and
 *  the two schema-side numbers this package deliberately doesn't compute. */
export interface GrooveSelectRequest {
  section: GrooveSection;
  song?: GrooveSong;
  /** Which pass through the section this is (0 = first). */
  occurrenceIndex?: number;
  /** The section's total beats — a variant whose loop divides it evenly wins. */
  durationBeats: number;
  /** Quarter-note beats per bar in the section's own meter. */
  beatsPerBar: number;
  presetData?: Partial<Record<DrumPattern, PackedPreset>>;
}

/** A variant pick for one specific pattern. */
export interface VariantPickRequest extends GrooveSelectRequest {
  pattern: DrumPattern;
}

/**
 * Indices of the variants whose loop length this section is committed to —
 * one length for the section's whole life, chosen from its id. Returns
 * `undefined` when the pool has only one length (nothing to narrow) so the
 * legacy pick is untouched.
 */
function stableLengthIndices(
  variants: ReadonlyArray<Pick<PackedVariant, "lengthBeats" | "beatsPerBar" | "style">>,
  sectionId: string,
  durationBeats: number,
  beatsPerBar: number,
): number[] | undefined {
  const compatible = compatibleVariantIndices(variants, durationBeats, beatsPerBar);
  const base = compatible.length > 0 ? compatible : variants.map((_, index) => index);
  const lengths = [...new Set(base.map((index) => variants[index]!.lengthBeats))].sort((a, b) => a - b);
  if (lengths.length <= 1) return undefined;
  const chosen = lengths[hashSeed(`${sectionId}:loop`) % lengths.length]!;
  return base.filter((index) => Math.abs(variants[index]!.lengthBeats - chosen) < 1e-9);
}

/**
 * The effective variant index for a section's pattern — an explicit
 * `drumVariantIndex` wins (the user's manual pick); otherwise a deterministic
 * pick seeded by the section id + occurrence. `undefined` only when the
 * pattern has no resolvable preset.
 */
export function seededVariantIndexFor(request: VariantPickRequest): number | undefined {
  const { section, song, occurrenceIndex = 0, presetData = PRESET_DATA } = request;
  const preset = presetData[request.pattern];
  if (!preset || preset.variants.length === 0) return undefined;
  if (section.drumVariantIndex !== undefined) {
    // An explicit pick indexes the WHOLE pool — the corpus takes are options.
    return Math.max(0, Math.min(section.drumVariantIndex, preset.variants.length - 1));
  }

  /**
   * The DEFAULT pick draws from the authored bank only.
   *
   * The pool also carries corpus takes (see `selectableMined`), and a seeded
   * index over a bigger pool would re-shuffle every section's groove the moment
   * the corpus grew — the drums would change character between builds for no
   * musical reason. Defaults stay on the written material; stepping the variant
   * reaches the rest.
   */
  const authored = preset.variants
    .map((variant, index) => ({ variant, index }))
    .filter((entry) => entry.variant.source.origin === "curated");
  const base =
    authored.length > 0
      ? authored
      : preset.variants.map((variant, index) => ({ variant, index }));
  const pool = base.map((entry) => entry.variant);
  /** A pool index back in the pattern's own variant list. */
  const toVariantIndex = (index: number): number => base[index]?.index ?? index;
  // A bend OR a narrative re-seeds the pick ("controls, not dice" — the same
  // slider positions always pick the same groove, and a narrative that raises
  // energy changes which groove is drawn, not just how it is styled). No bend
  // and no narrative → the classic occurrence seed, so existing songs keep
  // their exact output.
  const seed =
    hasBend(section, song) || hasNarrative(section, song)
      ? styleSeed(resolveEffectiveStyle(section, song), section.id, occurrenceIndex)
      : occurrenceSeed(section.id, occurrenceIndex);
  // The song's tradition picks among the performances: same feel, different
  // tradition. Falls back to the whole pool when the bake has nothing for it.
  const styleFamily = styleFamilyFor({
    genre: song?.genre,
    concept: song?.concept,
    title: song?.title,
    instrumentation: song?.notes?.instrumentation,
  });
  // CONTINUITY: the loop LENGTH is a property of the SECTION, not of the pass
  // through it. A pool holds both one- and two-bar variants, so without this
  // a repeated verse can jump from a 1-bar loop to a 2-bar one — the groove
  // stops being recognisable even though every note is in the right place.
  // The length is chosen once, from the section id, and stays for every
  // occurrence; the feel may still change.
  const spread = stableLengthIndices(pool, section.id, request.durationBeats, request.beatsPerBar);
  if (spread) {
    const narrowed = spread.map((index) => pool[index]!);
    const picked = pickVariantIndexFor(
      hashSeed(seed),
      narrowed,
      request.durationBeats,
      request.beatsPerBar,
      occurrenceIndex,
      styleFamily,
    );
    return toVariantIndex(spread[picked]!);
  }

  // Meter-aware: a section in an odd meter draws the variants that are
  // actually in that meter instead of grooves that would drift against the
  // barline.
  return toVariantIndex(
    pickVariantIndexFor(
      hashSeed(seed),
      pool,
      request.durationBeats,
      request.beatsPerBar,
      occurrenceIndex,
      // The song's tradition picks among the performances: same feel, different
      // tradition. Falls back to the whole pool when the bake has nothing for it.
      styleFamily,
    ),
  );
}

/**
 * The groove a section plays — the single selection both TrackDraft's
 * preview/.mid export and the Ableton bridge consume.
 *
 * Priority: authored outline > authored pattern (+ its variant) > the
 * heuristic — then a deterministic variant pick. Returns `null` for a muted
 * section or a pattern with no baked content. Notes are UN-humanised; an
 * exporter that wants a real performance on an outline applies
 * `humanizeOutlineVariant` itself.
 */
export function selectSectionGroove(request: GrooveSelectRequest): PackedVariant | null {
  const { section, song } = request;
  const choice = grooveOf(section);
  switch (choice.kind) {
    case "outline":
      return outlineVariantFor(choice.outline);
    case "muted":
      return null;
    case "preset":
    case "auto": {
      const pattern = choice.kind === "preset" ? choice.pattern : inferPatternForSection(section, song, request.presetData);
      const variantIndex =
        choice.kind === "preset" && choice.variant !== undefined
          ? choice.variant
          : seededVariantIndexFor({ ...request, pattern });
      const variant = presetVariantAt(pattern, variantIndex, request.presetData);
      if (variant && sameMeter(variant.beatsPerBar, request.beatsPerBar)) return variant;
      // Nothing baked for this pattern at all: stay silent rather than invent
      // drums. The meter fallback below is for a pattern in the WRONG meter,
      // not for a missing library.
      if (!variant) return null;

      // Nothing compatible. Either the section's pattern is in another meter
      // (7/8 chosen on a 4/4 section) or its meter has no authored pattern at
      // all (3/8, 9/8, 11/16 ...). Tiling anyway drifts off the barline for
      // the rest of the section — a 3.5-beat loop across 4-beat bars is 9.14
      // loops, so the downbeat never comes back.
      //
      // Honour the author's intent where it can be: substitute the pattern
      // the section's own meter resolves to, then (when even that is in
      // another meter) write a groove from the meter itself.
      const fallback = inferPatternForSection(section, song, request.presetData);
      if (fallback !== pattern) {
        const substituted = presetVariantAt(
          fallback,
          seededVariantIndexFor({ ...request, pattern: fallback }),
          request.presetData,
        );
        if (substituted && sameMeter(substituted.beatsPerBar, request.beatsPerBar)) return substituted;
      }
      const fromMeter = meterGrooveVariant(
        section.timeSignatureNumerator,
        2 ** section.timeSignatureDenPower,
      );
      if (fromMeter && sameMeter(fromMeter.beatsPerBar, request.beatsPerBar)) return fromMeter;
      return variant;
    }
  }
}

/** The drum fields the pipeline reads straight off a section — a structural
 *  subset of `BlueprintSection`, so the assembly below stays schema-free. */
export interface DrumSectionFields {
  id: string;
  role?: string | null;
  drumMeterOutline?: OutlineWithVoices | null;
  drumVoicePatterns?: Partial<Record<KitVoice, EuclidLike>>;
  drumLaneMute?: readonly DrumLaneId[];
  drumLaneSolo?: readonly DrumLaneId[];
  drumBlocks?: DrumBlock[];
  drumVariationOutline?: OutlineWithVoices | null;
  drumVariationBars?: number;
  drumVariationStartBeat?: number;
  drumTransitionModel?: TransitionModel | null;
  drumTransitionBars?: number;
}

export interface SectionDrumAssembly {
  section: DrumSectionFields;
  occurrenceIndex: number;
  durationBeats: number;
  beatsPerBar: number;
  /** The RESOLVED, styled base groove (`selectSectionGroove` + the Bend
   *  transforms) — `null` for a muted section. */
  variant: PackedVariant | null;
  /** The section's velocity preset mapped to a MIDI velocity, post-Bend. */
  velocityTarget: number;
  /** The named transition: the authored `drumTransitionModel`, or the one the
   *  narrative arc implies. */
  transitionModel: TransitionModel | null;
  /** Bar lengths in order, when the section changes meter. */
  barBeats?: number[];
  /** Grooves for the section's OTHER bar lengths, keyed by bar length. */
  meterVariants?: Record<string, PackedVariant>;
}

/**
 * One section as `planSectionDrumNotes` expects it.
 *
 * This object was assembled twice — once in the app's `midiExport.ts`, once in
 * the bridge's `planDrumClips` — from the same section fields in the same
 * order. Twenty fields copied by hand is twenty chances to differ, so the
 * mapping lives here and both sides call it.
 */
export function sectionDrumInput(assembly: SectionDrumAssembly): SectionDrumInput {
  const { section, variant } = assembly;
  return {
    sectionId: section.id,
    occurrenceIndex: assembly.occurrenceIndex,
    role: section.role ?? null,
    beatsPerBar: assembly.beatsPerBar,
    ...(assembly.meterVariants ? { barBeats: assembly.barBeats, meterVariants: assembly.meterVariants } : {}),
    variant,
    outline: section.drumMeterOutline ?? null,
    voiceOverrides: section.drumVoicePatterns,
    mute: section.drumLaneMute,
    solo: section.drumLaneSolo,
    blocks: section.drumBlocks,
    variation: section.drumVariationOutline ?? null,
    variationBars: section.drumVariationBars,
    variationStartBeat: section.drumVariationStartBeat,
    transitionModel: assembly.transitionModel,
    transitionBars: section.drumTransitionBars,
    gridBeats: section.drumMeterOutline ? section.drumMeterOutline.cellBeats : 0.25,
    durationBeats: assembly.durationBeats,
    velocityTarget: assembly.velocityTarget,
  };
}

/**
 * The base groove as an EXPORTER sees it: the shared selection, an outline's
 * onsets humanised, then the Bend note transforms. The .mid export and the
 * Ableton bridge both call exactly this, so a section's drums are the same
 * notes on both sides — including microtiming.
 *
 * The preview deliberately does NOT call it: it wants `selectSectionGroove`
 * un-humanised, because the editor's step grid has to stay exact.
 */
export function exportSectionVariant(request: GrooveSelectRequest, style: StyleProfile): PackedVariant | null {
  const selected = selectSectionGroove(request);
  if (!selected) return null;
  const humanized = request.section.drumMeterOutline
    ? humanizeOutlineVariant(request.section.drumMeterOutline, selected, request.presetData)
    : selected;
  return applyStyleToVariant(humanized, style);
}

/**
 * The section's groove at one of its OTHER bar lengths — a 4/4 pattern must not
 * be chopped at 3.5 beats when the chart drops to 7/8, so a meter-changing
 * section asks for a groove per bar length. `meterFor` is the schema's own
 * `meterForLength` (both consumers already depend on it), which is why this
 * takes it as a parameter instead of re-deriving the meter here.
 */
export function selectSectionGrooveAtMeter(
  request: GrooveSelectRequest,
  meter: { numerator: number; denominator: number },
): PackedVariant | null {
  return selectSectionGroove({
    ...request,
    beatsPerBar: meter.numerator * (4 / meter.denominator),
    section: {
      ...request.section,
      timeSignatureNumerator: meter.numerator,
      timeSignatureDenPower: Math.log2(meter.denominator),
    },
  });
}
