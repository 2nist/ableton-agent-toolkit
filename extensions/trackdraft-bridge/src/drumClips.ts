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
  synthesizeOutlineFill,
  type DrumPattern,
  type FillLibrary,
  type HandoffSectionInput,
  type PackedPreset,
  type PackedVariant,
} from "@drum/library";
import { getVelocity } from "@music-theory/song-structure";
import type { MeterOutline } from "@music-theory/song-blueprint";
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

/**
 * Turns a section's `drumMeterOutline` into a `PackedVariant` shaped like
 * any corpus/synth preset variant — one click/hi-hat hit per 2s/3s cell
 * subdivision, accented on each cell's first subdivision — so it can flow
 * through the exact same scale/tile/handoff pipeline as every other
 * pattern, with no special-casing downstream.
 */
function outlineVariant(outline: MeterOutline): PackedVariant {
  const bpb = outlineBeatsPerBar(outline);
  return {
    lengthBeats: bpb,
    beatsPerBar: bpb,
    notes: outlineToClickPattern(outline),
    source: { origin: "synth", generator: "outline-click" },
  };
}

/**
 * One clip per section. Pattern and variant selection, in priority order:
 *
 * - When `section.drumMeterOutline` is set (built in Drum Studio's Outline
 *   tab, for a meter the corpus has no analogue for at all — 9/8, 11/16,
 *   25/16...), a click/hi-hat pattern is generated from it directly. This
 *   is Drum Studio's "sync together" answer with the rest of the
 *   arrangement pipeline: the same blueprint field a section already
 *   carries, driving the same per-section clip this function has always
 *   produced, on the same track, at the same `sectionSpans()` boundaries
 *   chords and bass already use.
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
    if (section.drumMeterOutline) return outlineVariant(section.drumMeterOutline);

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
