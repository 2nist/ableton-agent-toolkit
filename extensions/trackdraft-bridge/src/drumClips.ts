import type { NoteDescription } from "@ableton-extensions/sdk";
import {
  PRESET_DATA,
  FILL_DATA,
  inferPatternForGenre,
  songSignalsFor,
  humanizeOutlineNotes,
  planSectionDrumNotes,
  outlineBeatsPerBar,
  outlineToClickPattern,
  outlineToGroovePattern,
  occurrenceSeed,
  hashSeed,
  pickVariantIndex,
  applyStyleToVariant,
  hasBend,
  resolveStyleProfile,
  styleSeed,
  styleVelocityTarget,
  type DrumPattern,
  type FillLibrary,
  type PackedPreset,
  type PackedVariant,
  type SectionDrumInput,
} from "@drum/library";
import { getVelocity } from "@music-theory/song-structure";
import { beatsPerBar, type MeterOutline } from "@music-theory/song-blueprint";
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
 * From there, the whole per-section pipeline — per-voice Euclidean
 * overrides (`drumVoicePatterns`), velocity scaling, seeded tiling,
 * automatic handoff fills, the ending detour (`drumVariationOutline`),
 * the named transition (`drumTransitionModel`) and the resolve-on-crash —
 * runs in `@drum/library`'s `planSectionDrumNotes`, the SAME function the
 * web app's MIDI export uses, so "Export MIDI", live MIDI out, and
 * "Send to Ableton" all produce the same drums. This file only resolves
 * each section's *base* groove (the part that needs song-blueprint /
 * song-structure types) and maps the results into the library's
 * DAW-agnostic `SectionDrumInput`, exactly like `planSectionHandoffFills`.
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
  // The exact same signals the app's preview/export/live feed the heuristic
  // (shared `songSignalsFor`), so a fast/trap-leaning song resolves the
  // same in-browser and here — no drift.
  const songSignals = songSignalsFor(song);

  // First pass: choose the base pattern + variant per section, so the
  // handoff planner can look at the *next* section's resolved target too.
  const resolved: (PackedVariant | null)[] = spans.map(({ section, occurrenceIndex }) => {
    if (section.drumMeterOutline) return outlineVariant(section.drumMeterOutline, presetData);

    const pattern = section.drumPattern ?? inferPatternForGenre(
      {
        role: section.role,
        velocity: section.velocity,
        name: section.name,
        timeSignatureNumerator: section.timeSignatureNumerator,
        timeSignatureDenominator: 2 ** section.timeSignatureDenPower,
      },
      songSignals,
      song.genre,
    );
    const preset = presetData[pattern];
    if (!preset || preset.variants.length === 0) return null;

    // Explicit variant index when the user chose one (clamped to valid range);
    // otherwise the deterministic pick that defaults to the clean downbeat
    // groove (variant 0) most of the time, with the corpus variants as
    // seeded variation — matches the app's preview/export via `pickVariantIndex`.
    const variantIndex = section.drumVariantIndex !== undefined
      ? Math.max(0, Math.min(section.drumVariantIndex, preset.variants.length - 1))
      : pickVariantIndex(
          hashSeed(
            hasBend(section, song)
              ? styleSeed(resolveStyleProfile(section, song), section.id, occurrenceIndex)
              : occurrenceSeed(section.id, occurrenceIndex),
          ),
          preset.variants.length,
        );
    return preset.variants[variantIndex];
  });

  // Map each span into the library's shared per-section pipeline — voice
  // overrides, detour, transition, and the outline fill are all carried
  // here, so the app's MIDI export and this Ableton plan can't drift.
  const inputs: SectionDrumInput[] = spans.map(({ section, durationBeats, occurrenceIndex }, i) => {
    // The Bend note transforms (Feel + Backbeat) apply after the outline
    // humanization baked into `resolved[i]` — the same relative point the
    // app applies them, so app == bridge. Neutral profile = no-op.
    const profile = resolveStyleProfile(section, song);
    const variant = resolved[i] ? applyStyleToVariant(resolved[i], profile) : null;
    return {
      sectionId: section.id,
      occurrenceIndex,
      role: section.role ?? null,
      beatsPerBar: beatsPerBar(section),
      variant,
      outline: section.drumMeterOutline ?? null,
      voiceOverrides: section.drumVoicePatterns,
      blocks: section.drumBlocks,
      variation: section.drumVariationOutline ?? null,
      variationBars: section.drumVariationBars,
      variationStartBeat: section.drumVariationStartBeat,
      transitionModel: section.drumTransitionModel ?? null,
      transitionBars: section.drumTransitionBars,
      gridBeats: section.drumMeterOutline ? section.drumMeterOutline.cellBeats : 0.25,
      durationBeats,
      velocityTarget: styleVelocityTarget(getVelocity(section.velocity), profile),
    };
  });

  const plans = planSectionDrumNotes(inputs, fillData);

  return spans.map(({ section, startBeat, durationBeats }, i) => {
    const notes: NoteDescription[] = plans[i].notes
      .sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
      .map(({ beat, pitch, velocity, duration }) => ({
        pitch,
        startTime: beat,
        duration: duration ?? HIT_DURATION,
        velocity,
      }));

    return { name: section.name, startBeat, durationBeats, notes };
  });
}
