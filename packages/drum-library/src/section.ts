import { ABLETON_SAFE_NOTES } from "./ableton.js";
import { voiceOf, type KitVoice } from "./kit.js";
import {
  outlineToClickPattern,
  outlineToGroovePattern,
  outlineBeatsPerBar,
  synthesizeOutlineFill,
  type MeterOutline,
  type CellVoice,
} from "./meter.js";
import type { PackedNote, PackedVariant, PackedPreset } from "./presetData.js";
import type { DrumPattern } from "./presets.js";
import {
  planSectionHandoffFills,
  scaleToVelocityPreset,
  occurrenceSeed,
  type FillLibrary,
  type HandoffSectionInput,
} from "./handoffs.js";
import { tileGrooveVaried } from "./vary.js";
import { extractGroove, applyGroove } from "./groove.js";
import { synthesizeTransition, type TransitionModel } from "./transitions.js";
import type { DrumNote } from "./types.js";
import { PRESET_DATA } from "./presetData.js";

/**
 * The DAW-agnostic per-section drum pipeline shared by BOTH the web app's
 * MIDI export (`planDrumStem`) and the Ableton bridge's clip planner
 * (`planDrumClips`). Everything the two export paths must agree on — how a
 * section's rhythm resolves, how per-voice Euclidean overrides replace the
 * base groove, how a detour/variation or a named transition rewrites the
 * section's tail, and how handoff fills + crashes are spliced — lives here
 * in one place, so the exported .mid, live MIDI out, and "Send to Ableton"
 * can never silently drift apart the way they did before (voice overrides
 * and detours were previewed in the UI but dropped at export).
 *
 * Following the same pattern as `planSectionHandoffFills`: pure functions
 * over already-resolved descriptors — a caller maps its own song-blueprint
 * section into `SectionDrumInput` (resolving outline-vs-pattern, which
 * needs song-level types this package deliberately avoids) and gets back
 * absolute-positioned notes it can drop straight into a MIDI file or an
 * Ableton clip.
 */

/** Round a beat position to 4 decimals — enough for 1/16ths and the
 *  fractional beat values odd meters produce, without floating-point noise
 *  leaking into exported files. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** A single resolved hit at an absolute beat offset — the currency of the
 *  per-section pipeline. `DrumNote`-shaped so it flows through the library's
 *  existing note functions unchanged. */
export interface TiledNote {
  beat: number;
  pitch: number;
  velocity: number;
}

/** Structurally compatible with song-blueprint's `EuclidPattern` (k/n/rotation)
 *  without importing it — this package stays decoupled from the schema. */
export interface EuclidLike {
  k: number;
  n: number;
  rotation: number;
}

/** A `MeterOutline` that may carry the per-cell kick/snare/hat voicing
 *  (`cellVoices`) song-blueprint adds on top of this package's own
 *  `MeterOutline` — a caller passing a schema outline can still be read
 *  here. */
export interface OutlineWithVoices extends MeterOutline {
  cellVoices?: CellVoice[];
}

/** The onset step indices of a Euclidean pattern, cyclically shifted by
 *  `rotation` — the exact same math the UI's step view uses, exported here
 *  so the export path and the preview can never disagree about where a
 *  per-voice pattern's hits actually fall. */
export function euclidOnsetSteps(pat: EuclidLike): number[] {
  const n = Math.max(1, Math.floor(pat.n));
  const k = Math.max(1, Math.min(n, Math.floor(pat.k)));
  const r = ((Math.floor(pat.rotation) % n) + n) % n;
  const steps: number[] = [];
  for (let i = 0; i < k; i++) {
    const base = Math.round((i * n) / k);
    steps.push((base + r) % n);
  }
  return steps.sort((a, b) => a - b);
}

/**
 * One canonical GM pitch per `KitVoice` — all 13 voices, not just the subset
 * `ABLETON_SAFE_NOTES` covers. Derived from `ABLETON_SAFE_NOTES` where the
 * two overlap so they can't drift; the missing voices (pedalHat, tomLow,
 * rideBell) get their standard GM note.
 */
export const KIT_PITCHES: Record<KitVoice, number> = {
  ...ABLETON_SAFE_NOTES,
  pedalHat: 44,
  tomLow: 41,
  rideBell: 53,
};

export interface EuclidPatternNotesOptions {
  /** Beats spanned by one full loop of the pattern — the base variant's
   *  `lengthBeats` (a 4/4 bar is 4 beats, a 7/8 bar is 3.5). The `n` steps
   *  are spread evenly across this, exactly how the necklace UI reads "n
   *  steps around one loop", so a per-voice pattern lands in the same place
   *  on the timeline it appears in the preview. Defaults to 4 (one 4/4 bar). */
  loopBeats?: number;
  /** Velocity for every generated hit. Callers usually rescale afterwards
   *  (`scaleToVelocityPreset`), so a plain 100 is the neutral default. */
  velocity?: number;
}

/** Turns a free-form Euclidean pattern into notes for one voice — `k`
 *  onsets spread as evenly as possible across `n` steps, rotated, each
 *  step `loopBeats / n` apart. The per-voice authoring path ("edit the
 *  drums voice by voice") and the export now share this. */
export function euclidPatternNotes(
  pat: EuclidLike,
  voice: KitVoice,
  opts: EuclidPatternNotesOptions = {},
): PackedNote[] {
  const n = Math.max(1, Math.floor(pat.n));
  const loopBeats = Math.max(0.001, opts.loopBeats ?? 4);
  const stepBeats = loopBeats / n;
  const velocity = opts.velocity ?? 100;
  const pitch = KIT_PITCHES[voice];
  return euclidOnsetSteps(pat).map((step) => [round4(step * stepBeats), pitch, velocity]);
}

/**
 * Applies per-voice Euclidean overrides (`drumVoicePatterns`) on top of a
 * section's resolved base groove: every note whose voice is overridden is
 * removed and replaced with that voice's own k/n rhythm, everything else
 * (including the base's humanized microtiming) is kept. Returns the base
 * untouched when there's nothing to override.
 *
 * The override's step grid spans the base's own loop length (`lengthBeats`),
 * so a voice re-patterned in the UI previews and exports in the same place.
 * New notes inherit the base voice's peak velocity when the voice was
 * present, falling back to a neutral 100 (the caller rescales to the
 * section's velocity preset afterwards anyway).
 */
export function applyVoiceOverrides(
  base: PackedVariant,
  overrides: Partial<Record<KitVoice, EuclidLike>>,
  opts: EuclidPatternNotesOptions = {},
): PackedVariant {
  const keys = (Object.keys(overrides) as KitVoice[]).filter((v) => overrides[v]);
  if (keys.length === 0) return base;

  const overridden = new Set(keys);
  const baseVelocity = new Map<KitVoice, number>();
  for (const [, pitch, velocity] of base.notes) {
    const v = voiceOf(pitch);
    if (v && (!baseVelocity.has(v) || velocity > baseVelocity.get(v)!)) baseVelocity.set(v, velocity);
  }

  const notes: PackedNote[] = [
    ...base.notes.filter(([, pitch]) => {
      const v = voiceOf(pitch);
      return !(v && overridden.has(v));
    }),
    ...keys.flatMap((v) =>
      euclidPatternNotes(overrides[v]!, v, {
        loopBeats: opts.loopBeats ?? base.lengthBeats,
        velocity: opts.velocity ?? baseVelocity.get(v) ?? 100,
      }),
    ),
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  return { ...base, notes };
}

export interface ApplyVariationOptions {
  /** Total beats of the section — where the detour's tail begins. */
  durationBeats: number;
  /** The base groove's beats per bar, to convert `variationBars` into beats. */
  barBeats: number;
  /** Peak velocity the detour's notes are scaled to (the section's velocity preset). */
  velocityTarget: number;
}

/**
 * Spliced a section's ending detour (`drumVariationOutline`) into its final
 * bars — a deliberately different k/n for a bar or two that then returns to
 * the base groove, the way a drummer plays a fill that lands back in the
 * pocket. Replaces whatever was in the span (including an automatic handoff
 * fill planned for the same region — a authored detour wins over the
 * default, same precedence `applySectionTransition` already uses). The
 * detour's own per-cell voicing (`cellVoices`) is honored when present; a
 * plain click otherwise — identical to how the section's main outline is
 * generated. Returns the notes unchanged when there's no detour or the
 * section is too short to give up a bar.
 */
export function applyVariation(
  tiled: TiledNote[],
  variation: OutlineWithVoices | null | undefined,
  variationBars: number | undefined,
  opts: ApplyVariationOptions,
): TiledNote[] {
  if (!variation) return tiled;
  const { durationBeats, barBeats, velocityTarget } = opts;
  const maxBars = Math.floor(durationBeats / barBeats);
  if (maxBars < 1) return tiled;
  const spanBars = Math.max(1, Math.min(Math.round(variationBars ?? 1), maxBars));
  if (spanBars >= maxBars && maxBars < 2) return tiled; // never eat the section's only bar

  const spanBeats = spanBars * barBeats;
  const fillStart = durationBeats - spanBeats;

  const raw = variation.cellVoices
    ? outlineToGroovePattern(variation, variation.cellVoices)
    : outlineToClickPattern(variation);
  const peak = Math.max(...raw.map(([, , v]) => v), 1);
  const scale = velocityTarget / peak;

  const generated: TiledNote[] = raw.map(([beat, pitch, velocity]) => ({
    beat: round4(beat + fillStart),
    pitch,
    velocity: Math.max(1, Math.min(127, Math.round(velocity * scale))),
  }));

  const kept = tiled.filter((n) => n.beat < fillStart);
  return [...kept, ...generated];
}

export interface ApplyTransitionOptions {
  model: TransitionModel | null | undefined;
  transitionBars: number | undefined;
  durationBeats: number;
  variant: PackedVariant;
  velocityTarget: number;
  /** Subdivision grid the transition is generated on — an outline's
   *  `cellBeats`, or 0.25 (16ths) for standard presets. */
  gridBeats?: number;
}

/**
 * Splices a section's named transition (`drumTransitionModel`) into its
 * final bars, replacing whatever's there — including an automatic handoff
 * fill. An explicit transition is a deliberate authorial choice and wins
 * over the default fill, not a second thing layered on top of it. Moved
 * here from the bridge so the app's MIDI export applies the exact same
 * build/break/cut/drop the Ableton export does.
 */
export function applySectionTransition(
  tiled: TiledNote[],
  opts: ApplyTransitionOptions,
): TiledNote[] {
  const { model } = opts;
  if (!model) return tiled;

  const barBeats = opts.variant.beatsPerBar;
  const gridBeats = opts.gridBeats ?? 0.25;

  const maxBars = Math.floor(opts.durationBeats / barBeats);
  if (maxBars < 1) return tiled;
  const spanBars = Math.max(1, Math.min(Math.round(opts.transitionBars ?? 1), maxBars));
  if (spanBars >= maxBars && maxBars < 2) return tiled; // never eat the section's only bar

  const spanBeats = spanBars * barBeats;
  const fillStart = opts.durationBeats - spanBeats;
  const baseNotes: PackedNote[] = tiled
    .filter((n) => n.beat >= fillStart)
    .map((n): PackedNote => [round4(n.beat - fillStart), n.pitch, n.velocity]);

  const generated = synthesizeTransition(model, { spanBeats, gridBeats, velocityTarget: opts.velocityTarget, baseNotes });

  const kept = tiled.filter((n) => n.beat < fillStart);
  const added: TiledNote[] = generated.map(([beat, pitch, velocity]) => ({
    beat: round4(beat + fillStart),
    pitch,
    velocity,
  }));
  return [...kept, ...added];
}

/**
 * Borrows real human timing/velocity character from an actual corpus
 * performance and imposes it on an outline's mathematically-precise onsets —
 * real feel for a meter the corpus has no recording of at all. Extracted
 * per-*beat*, not per-bar: "how a human's timing wobbles within one beat"
 * generalizes across any bar length. Always draws from the `standard`
 * preset's first variant (a real, always-baked E-GMD performance); falls
 * back to the untouched notes if that preset is missing rather than
 * throwing — humanization is an improvement, not a hard dependency. Shared
 * by the bridge's outline export and the app's, so both produce the same
 * groove.
 */
export function humanizeOutlineNotes(
  notes: PackedNote[],
  cellBeats: number,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
): PackedNote[] {
  const reference = presetData.standard?.variants[0];
  if (!reference || reference.notes.length === 0) return notes;
  const groove = extractGroove(toDrumNotes(reference.notes), 1, cellBeats);
  if (groove.points.length === 0) return notes;
  return toPackedNotes(applyGroove(toDrumNotes(notes), groove));
}

function toDrumNotes(notes: PackedNote[]): DrumNote[] {
  return notes.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity }));
}

function toPackedNotes(notes: DrumNote[]): PackedNote[] {
  return notes.map((n): PackedNote => [n.beat, n.pitch, n.velocity]);
}

/** A section's drums, as the shared pipeline needs them — resolved by the
 *  caller (which owns the song-level types), consumed by
 *  `planSectionDrumNotes`. */
export interface SectionDrumInput {
  sectionId: string;
  occurrenceIndex: number;
  /** Resolved base groove — an outline-driven variant, a pattern variant,
   *  or `null` for silence. The caller resolves outline-vs-pattern because
   *  that path needs song-blueprint / song-structure types. */
  variant: PackedVariant | null;
  /** The section's `drumMeterOutline`, for outline-driven sections only —
   *  used to inject a synthesized fill for its (often fractional)
   *  beats-per-bar, which `FILL_DATA` has nothing for. */
  outline?: OutlineWithVoices | null;
  /** Per-voice Euclidean overrides (`drumVoicePatterns`). */
  voiceOverrides?: Partial<Record<KitVoice, EuclidLike>>;
  /** Ending detour (`drumVariationOutline`). */
  variation?: OutlineWithVoices | null;
  variationBars?: number;
  /** Named ending transition (`drumTransitionModel`). */
  transitionModel?: TransitionModel | null;
  transitionBars?: number;
  /** The section's subdivision grid for transitions — its outline's
   *  `cellBeats`, or 0.25 for preset/heuristic grooves. */
  gridBeats?: number;
  durationBeats: number;
  velocityTarget: number;
}

export interface SectionDrumPlan {
  /** Absolute-positioned notes within the section (beat 0 = section start),
   *  sorted by beat then pitch, ready for a caller to offset by the span's
   *  own start beat. */
  notes: TiledNote[];
}

export interface PlanSectionDrumOptions {
  /** Pitch used for the crash that resolves a preceding fill. Defaults to
   *  the library's `CRASH_PITCH` (note 49). */
  crashPitch?: number;
}

/**
 * One clip per section's drums — the full pipeline both export paths share:
 *
 *   1. Per-voice Euclidean overrides (`drumVoicePatterns`) are applied to
 *      the resolved base groove first, so the handoff planner matches fills
 *      against the *final* groove.
 *   2. A synthesized fill is injected for any outline-driven meter
 *      `FILL_DATA` has no analogue for.
 *   3. Each section is velocity-scaled, tiled with seeded per-occurrence
 *      micro-variation (`tileGrooveVaried`), and its automatic handoff fill
 *      (if the boundary qualifies) is spliced into its last bar.
 *   4. An authored detour (`drumVariationOutline`) and then a named
 *      transition (`drumTransitionModel`) overwrite the same tail region in
 *      turn — authorial choices always beat the automatic fill.
 *   5. A section preceded by a fill opens with a crash, unless its groove
 *      already does.
 *
 * Pure and DAW-agnostic — the caller maps its own section model into
 * `SectionDrumInput` (exactly like `planSectionHandoffFills`), so both the
 * web app and the Ableton bridge call one function and can't drift.
 */
export function planSectionDrumNotes(
  inputs: SectionDrumInput[],
  fills: FillLibrary,
  opts: PlanSectionDrumOptions = {},
): SectionDrumPlan[] {
  const crashPitch = opts.crashPitch ?? ABLETON_SAFE_NOTES.crash;

  // First pass: apply per-voice overrides so the handoff planner matches
  // fills against the final groove, not the pre-override base.
  const resolved: (PackedVariant | null)[] = inputs.map((input) =>
    input.variant && input.voiceOverrides
      ? applyVoiceOverrides(input.variant, input.voiceOverrides, { loopBeats: input.variant.lengthBeats })
      : input.variant,
  );

  // Give planSectionHandoffFills somewhere to find a fill for each distinct
  // outline meter in play — a local copy, never mutating the caller's fills,
  // and only adding keys that aren't already present.
  const outlineFillData: FillLibrary = { acoustic: fills.acoustic, synth: { ...fills.synth } };
  for (const input of inputs) {
    if (!input.outline) continue;
    const key = String(outlineBeatsPerBar(input.outline));
    if (!outlineFillData.synth[key]) {
      outlineFillData.synth[key] = [synthesizeOutlineFill(input.outline, 100)];
    }
  }

  const handoffInputs: HandoffSectionInput[] = inputs.map((input, i) => ({
    sectionId: input.sectionId,
    occurrenceIndex: input.occurrenceIndex,
    variant: resolved[i],
    durationBeats: input.durationBeats,
    velocityTarget: input.velocityTarget,
  }));
  const handoffPlans = planSectionHandoffFills(handoffInputs, outlineFillData);

  return inputs.map((input, i) => {
    const variant = resolved[i];
    if (!variant) return { notes: [] };

    const velocityTarget = input.velocityTarget;
    const scaled = scaleToVelocityPreset(variant.notes, velocityTarget);

    let tiled: TiledNote[] = tileGrooveVaried(
      scaled.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
      variant.lengthBeats,
      input.durationBeats,
      { seed: occurrenceSeed(input.sectionId, input.occurrenceIndex) },
    );

    const plan = handoffPlans[i];
    const fillStart = plan.fillStart;
    if (fillStart !== null) {
      tiled = tiled.filter((note) => note.beat < fillStart);
      for (const [beat, pitch, velocity] of plan.fillNotes) {
        tiled.push({ beat, pitch, velocity });
      }
    }

    // Authorial ending gestures overwrite the automatic fill's region.
    if (input.variation) {
      tiled = applyVariation(tiled, input.variation, input.variationBars, {
        durationBeats: input.durationBeats,
        barBeats: variant.beatsPerBar,
        velocityTarget,
      });
    }
    tiled = applySectionTransition(tiled, {
      model: input.transitionModel,
      transitionBars: input.transitionBars,
      durationBeats: input.durationBeats,
      variant,
      velocityTarget,
      gridBeats: input.gridBeats,
    });

    // A fill resolves onto a crash — put it on this section's downbeat when
    // the previous section built into it, unless the groove already opens
    // with one.
    if (plan.precededByFill && !tiled.some((n) => n.pitch === crashPitch && n.beat < 0.25)) {
      tiled.push({ beat: 0, pitch: crashPitch, velocity: Math.min(127, velocityTarget + 4) });
    }

    tiled.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
    return { notes: tiled };
  });
}
