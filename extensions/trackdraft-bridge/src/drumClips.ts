import type { NoteDescription } from "@ableton-extensions/sdk";
import {
  PRESET_DATA,
  FILL_DATA,
  CRASH_PITCH,
  inferDrumPattern,
  tileGrooveVaried,
  occurrenceSeed,
  hashSeed,
  scaleToVelocityPreset,
  planSectionHandoffFills,
  outlineBeatsPerBar,
  outlineToClickPattern,
  outlineToGroovePattern,
  synthesizeOutlineFill,
  synthesizeTransition,
  extractGroove,
  applyGroove,
  type DrumPattern,
  type DrumNote,
  type FillLibrary,
  type HandoffSectionInput,
  type PackedPreset,
  type PackedVariant,
  type PackedNote,
} from "@drum/library";
import { getVelocity } from "@music-theory/song-structure";
import type { MeterOutline, DrumTransitionModel, BlueprintSection } from "@music-theory/song-blueprint";
import { sectionSpans, type BlueprintSong } from "./blueprint.js";

export interface DrumClipPlan {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

export type { FillLibrary };

/** A short, un-sustained hit — not a block chord — regardless of how dense the underlying groove is. */
const HIT_DURATION = 0.25;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

type TiledDrumNote = { beat: number; pitch: number; velocity: number };

/**
 * Splices `section.drumTransitionModel` into a section's final bars,
 * replacing whatever's there — including an automatic handoff fill from
 * `planSectionHandoffFills`, spliced in just before this runs. An explicit
 * transition is a deliberate authorial choice and wins over the default
 * fill, not a second thing layered on top of it.
 *
 * Mirrors `extensions/drum-studio/src/render-drum-studio.ts`'s own
 * `applyTransition` (single-clip authoring) so the same section-boundary
 * vocabulary behaves identically whether it's driving one standalone clip
 * or a whole song's worth of them. Doesn't yet support that function's
 * `nextGridDenominator` meter-modulation pickup — `BlueprintSection` has
 * no field for it yet, so there's nothing for this to read.
 */
function applyTransition(
  tiled: TiledDrumNote[],
  section: BlueprintSection,
  durationBeats: number,
  variant: PackedVariant,
  velocityTarget: number,
): TiledDrumNote[] {
  const model: DrumTransitionModel | undefined = section.drumTransitionModel;
  if (!model) return tiled;

  const barBeats = variant.beatsPerBar;
  const gridBeats = section.drumMeterOutline ? section.drumMeterOutline.cellBeats : 0.25;

  const maxBars = Math.floor(durationBeats / barBeats);
  if (maxBars < 1) return tiled;
  const spanBars = Math.max(1, Math.min(Math.round(section.drumTransitionBars ?? 1), maxBars));
  if (spanBars >= maxBars && maxBars < 2) return tiled; // never eat the section's only bar

  const spanBeats = spanBars * barBeats;
  const fillStart = durationBeats - spanBeats;
  const baseNotes: PackedNote[] = tiled
    .filter((n) => n.beat >= fillStart)
    .map((n): PackedNote => [round4(n.beat - fillStart), n.pitch, n.velocity]);

  const generated = synthesizeTransition(model, { spanBeats, gridBeats, velocityTarget, baseNotes });

  const kept = tiled.filter((n) => n.beat < fillStart);
  const added: TiledDrumNote[] = generated.map(([beat, pitch, velocity]) => ({ beat: round4(beat + fillStart), pitch, velocity }));
  return [...kept, ...added];
}

function toDrumNotes(notes: PackedNote[]): DrumNote[] {
  return notes.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity }));
}

function toPackedNotes(notes: DrumNote[]): PackedNote[] {
  return notes.map((n): PackedNote => [n.beat, n.pitch, n.velocity]);
}

/**
 * Borrows real human timing/velocity character from an actual corpus
 * performance and imposes it on an outline's mathematically-precise
 * onsets — real feel for a meter the corpus has no recording of at all,
 * via the same `extractGroove`/`applyGroove` template system used
 * elsewhere in this library to keep other parts in the drums' pocket.
 *
 * Extracted per-*beat*, not per-bar: the reference's own bar length has
 * nothing to do with the outline's (a 7/8 bar isn't 4 beats), but "how
 * a human's timing wobbles within one beat" generalizes across any bar
 * length, so `extractGroove` is called with `lengthBeats: 1` — every
 * beat of the outline inherits the same borrowed character, rather than
 * needing bar-position-specific data that wouldn't transfer between
 * differently-shaped meters anyway.
 *
 * Always draws from the `standard` preset's first variant — a real,
 * always-baked E-GMD performance, generic rather than stylistically
 * matched to the section. Falls back to the untouched notes if that
 * preset is missing (a test's fixture `presetData`, say) rather than
 * throwing — humanization is a real improvement, not a hard dependency.
 */
function humanizeOutlineNotes(
  notes: PackedNote[],
  cellBeats: number,
  presetData: Partial<Record<DrumPattern, PackedPreset>>,
): PackedNote[] {
  const reference = presetData.standard?.variants[0];
  if (!reference || reference.notes.length === 0) return notes;
  const groove = extractGroove(toDrumNotes(reference.notes), 1, cellBeats);
  if (groove.points.length === 0) return notes;
  return toPackedNotes(applyGroove(toDrumNotes(notes), groove));
}

/**
 * Turns a section's `drumMeterOutline` into a `PackedVariant` shaped like
 * any corpus/synth preset variant, so it can flow through the exact same
 * scale/tile/handoff pipeline as every other pattern, with no
 * special-casing downstream. When the outline carries `cellVoices` (a
 * per-cell kick/snare assignment, authored in TrackDraft's Drums tab or
 * Drum Studio's Outline mode), each cell's downbeat plays that voice
 * instead of a flat click — a real groove, not just a hi-hat count-along.
 * Absent `cellVoices` (or an outline authored before that field existed)
 * falls back to `outlineToClickPattern`, identical to before. Either way,
 * the result is then humanized (`humanizeOutlineNotes`) rather than left
 * on a mathematically perfect grid.
 */
function outlineVariant(outline: MeterOutline, presetData: Partial<Record<DrumPattern, PackedPreset>>): PackedVariant {
  const bpb = outlineBeatsPerBar(outline);
  const rawNotes = outline.cellVoices ? outlineToGroovePattern(outline, outline.cellVoices) : outlineToClickPattern(outline);
  return {
    lengthBeats: bpb,
    beatsPerBar: bpb,
    notes: humanizeOutlineNotes(rawNotes, outline.cellBeats, presetData),
    source: { origin: "synth", generator: outline.cellVoices ? "outline-groove" : "outline-click" },
  };
}

/**
 * One clip per section. Pattern and variant selection, in priority order:
 *
 * - When `section.drumMeterOutline` is set (built in Drum Studio's Outline
 *   tab or TrackDraft's Drums tab, for a meter the corpus has no analogue
 *   for at all — 9/8, 11/16, 25/16...), a pattern is generated from it
 *   directly — a real kick/snare groove when the outline carries
 *   `cellVoices`, a plain accented click otherwise (see `outlineVariant`).
 *   This is the "sync together" answer with the rest of the arrangement
 *   pipeline: the same blueprint field a section already carries, driving
 *   the same per-section clip this function has always produced, on the
 *   same track, at the same `sectionSpans()` boundaries chords and bass
 *   already use.
 * - Otherwise, when `section.drumPattern` is set (user has chosen a
 *   preset pattern in TrackDraft's Structure tab), that pattern is used
 *   directly — overriding the heuristic. `section.drumVariantIndex` picks
 *   a specific variant (clamped to the preset's actual variant count);
 *   absent or out of range falls back to the deterministic hash pick.
 * - Otherwise `inferDrumPattern` maps each section's role, dynamics, meter
 *   and the song's tempo/self-description to an engine pattern, and a
 *   variant is picked deterministically per section id — exactly as before
 *   manual control existed.
 *
 * Regardless of how the pattern is chosen, variants are scaled so their
 * peak lands on the section's velocity preset, and tiled with seeded
 * per-bar micro-variation (`tileGrooveVaried`) so long sections don't
 * loop identically. Section-handoff fills and the crash that resolves them
 * are computed by `@drum/library`'s `planSectionHandoffFills` — see there
 * for the actual logic; this file just resolves sections into its inputs
 * and splices the result into each section's notes. An outline-driven
 * section's fill comes from `synthesizeOutlineFill` (the corpus/synth
 * `FILL_DATA` has nothing keyed by an outline's often-fractional
 * beats-per-bar), injected into a local copy of `fillData` so
 * `planSectionHandoffFills`'s own fill-pool lookup finds it with no
 * special-casing there either.
 *
 * When `section.drumTransitionModel` is also set, `applyTransition`
 * (below) then overwrites that same tail span with one of the four named
 * transition models instead — an explicit choice always wins over the
 * automatic handoff fill for the bars it covers, it doesn't stack with it.
 *
 * `presetData`/`fillData` default to the real library and only need
 * overriding in tests, which use small fixture presets instead of asserting
 * against actual baked content — that content legitimately changes shape
 * when the pipeline is re-run.
 */
export function planDrumClips(
  song: BlueprintSong,
  presetData: Partial<Record<DrumPattern, PackedPreset>> = PRESET_DATA,
  fillData: FillLibrary = FILL_DATA,
): DrumClipPlan[] {
  const spans = sectionSpans(song);
  const songSignals = { bpm: song.bpm, title: song.title, concept: song.concept, notes: song.notes };

  // First pass: choose pattern + variant per section, so the handoff planner
  // can look at the *next* section's resolved target too.
  const resolved = spans.map(({ section, occurrenceIndex }) => {
    if (section.drumMeterOutline) return outlineVariant(section.drumMeterOutline, presetData);

    const pattern = section.drumPattern ?? inferDrumPattern(
      {
        role: section.role,
        velocity: section.velocity,
        name: section.name,
        timeSignatureNumerator: section.timeSignatureNumerator,
        timeSignatureDenominator: 2 ** section.timeSignatureDenPower,
      },
      songSignals,
    );
    const preset = presetData[pattern];
    if (!preset || preset.variants.length === 0) return null;

    // Explicit variant index when the user chose one (clamped to valid range);
    // otherwise the deterministic hash pick that's been the default since day one.
    const variantIndex = section.drumVariantIndex !== undefined
      ? Math.max(0, Math.min(section.drumVariantIndex, preset.variants.length - 1))
      : hashSeed(occurrenceSeed(section.id, occurrenceIndex)) % preset.variants.length;
    return preset.variants[variantIndex];
  });

  // Give planSectionHandoffFills somewhere to find a fill for each distinct
  // outline meter in play — the real FILL_DATA has nothing keyed by an
  // outline's (often fractional) beats-per-bar, and a section-transition
  // fill still reads better than the groove just stopping cold. A local
  // copy: never mutate the caller's fillData (the real FILL_DATA, by
  // default), and only add keys that aren't already present so genuine
  // corpus/synth fills for a beats-per-bar an outline happens to collide
  // with (unlikely, but not impossible) still win.
  const outlineFillData: FillLibrary = { acoustic: fillData.acoustic, synth: { ...fillData.synth } };
  for (const { section } of spans) {
    if (!section.drumMeterOutline) continue;
    const key = String(outlineBeatsPerBar(section.drumMeterOutline));
    if (!outlineFillData.synth[key]) {
      outlineFillData.synth[key] = [synthesizeOutlineFill(section.drumMeterOutline, 100)];
    }
  }

  const handoffInputs: HandoffSectionInput[] = spans.map(({ section, durationBeats, occurrenceIndex }, i) => ({
    sectionId: section.id,
    occurrenceIndex,
    variant: resolved[i],
    durationBeats,
    velocityTarget: getVelocity(section.velocity),
  }));
  const handoffPlans = planSectionHandoffFills(handoffInputs, outlineFillData);

  return spans.map(({ section, startBeat, durationBeats, occurrenceIndex }, i) => {
    const variant = resolved[i];
    if (!variant) {
      return { name: section.name, startBeat, durationBeats, notes: [] };
    }

    const velocityTarget = getVelocity(section.velocity);
    const scaled = scaleToVelocityPreset(variant.notes, velocityTarget);

    let tiled = tileGrooveVaried(
      scaled.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
      variant.lengthBeats,
      durationBeats,
      { seed: occurrenceSeed(section.id, occurrenceIndex) },
    );

    const plan = handoffPlans[i];
    if (plan.fillStart !== null) {
      const fillStart = plan.fillStart;
      tiled = tiled.filter((note) => note.beat < fillStart);
      for (const [beat, pitch, velocity] of plan.fillNotes) {
        tiled.push({ beat, pitch, velocity });
      }
    }

    tiled = applyTransition(tiled, section, durationBeats, variant, velocityTarget);

    // A fill resolves onto a crash — put it on this section's downbeat when
    // the previous section built into it, unless the groove already opens
    // with one.
    if (plan.precededByFill && !tiled.some((n) => n.pitch === CRASH_PITCH && n.beat < 0.25)) {
      tiled.push({ beat: 0, pitch: CRASH_PITCH, velocity: Math.min(127, velocityTarget + 4) });
    }

    const notes: NoteDescription[] = tiled
      .sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
      .map(({ beat, pitch, velocity }) => ({
        pitch,
        startTime: beat,
        duration: HIT_DURATION,
        velocity,
      }));

    return { name: section.name, startBeat, durationBeats, notes };
  });
}
