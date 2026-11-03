import type { NoteDescription } from "@ableton-extensions/sdk";
import {
  PRESET_DATA,
  FILL_DATA,
  planSectionDrumNotes,
  humanizeOutlineVariant,
  narrativeTransitionModel,
  resolveEffectiveStyle,
  resolveNarrativeProfile,
  exportSectionVariant,
  fitHitsToSection,
  sectionDrumInput,
  styleVelocityTarget,
  type DrumPattern,
  type FillLibrary,
  type PackedPreset,
  type SectionDrumInput,
} from "@drum/library";
import { getVelocity } from "@music-theory/song-structure";
import { barLengths, beatsPerBar } from "@music-theory/song-blueprint";
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
 * One clip per section. Pattern and variant selection is NOT resolved here —
 * `@drum/library`'s `selectSectionGroove` owns it, so TrackDraft's preview, its
 * `.mid` export and this Ableton plan all read the same groove. The priority it
 * implements, for reference:
 *
 * - When `section.drumMeterOutline` is set (built in Drum Studio's Outline
 *   tab or TrackDraft's Drums tab, for a meter the corpus has no analogue
 *   for at all — 9/8, 11/16, 25/16...), a pattern is generated from it
 *   directly — a real kick/snare groove when the outline carries
 *   `cellVoices`, a plain accented click otherwise.
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
 * "Send to Ableton" all produce the same drums. This file only supplies what
 * is genuinely bridge-specific: the section spans, the velocity preset and the
 * fitted clip note shape. `exportSectionVariant` resolves (and humanises) the
 * base groove and `sectionDrumInput` assembles it, both shared with the app.
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

  // Every span becomes the library's `SectionDrumInput` the same way the app's
  // `midiExport.ts` builds it — same selection, same humanization, same field
  // mapping — so the two consumers can't drift.
  const inputs: SectionDrumInput[] = spans.map(({ section, durationBeats, occurrenceIndex }) => {
    const profile = resolveEffectiveStyle(section, song);
    const narrative = resolveNarrativeProfile(section, song);
    const request = { section, song, occurrenceIndex, durationBeats, beatsPerBar: beatsPerBar(section), presetData };
    const variant = exportSectionVariant(request, profile);
    // A section that changes meter gets one groove per bar length, so a 4/4
    // pattern is not chopped at 3.5 beats when the chart drops to 7/8.
    const barBeats = barLengths(section);
    const distinctBars = [...new Set(barBeats)];
    const meterVariants =
      distinctBars.length > 1
        ? Object.fromEntries(
            distinctBars.flatMap((length) => {
              const styled = exportSectionVariant({ ...request, beatsPerBar: length }, profile);
              return styled ? [[String(length), styled] as const] : [];
            }),
          )
        : undefined;

    return sectionDrumInput({
      section,
      occurrenceIndex,
      durationBeats,
      beatsPerBar: beatsPerBar(section),
      variant,
      velocityTarget: styleVelocityTarget(getVelocity(section.velocity), profile),
      // transition_delta → a named transition model when the author hasn't
      // picked one explicitly (an authored drumTransitionModel always wins).
      transitionModel: section.drumTransitionModel ?? narrativeTransitionModel(narrative.transition_delta),
      barBeats,
      meterVariants,
    });
  });

  const plans = planSectionDrumNotes(inputs, fillData);

  return spans.map(({ section, startBeat, durationBeats }, i) => {
    // Clipped to the clip's own length, by the same rule the app's .mid uses —
    // they used to disagree, and a hat on the last 16th bled into the next clip
    // here while the .mid was cut.
    const notes: NoteDescription[] = fitHitsToSection(
      plans[i].notes,
      durationBeats,
      HIT_DURATION,
    )
      .sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
      .map(({ beat, pitch, velocity, duration }) => ({
        pitch,
        startTime: beat,
        duration,
        velocity,
      }));

    return { name: section.name, startBeat, durationBeats, notes };
  });
}
