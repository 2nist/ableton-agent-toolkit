import {
  ABLETON_SAFE_NOTES,
  applyCyclicDevelopment,
  applyDrumBlocks,
  applyStyleToVariant,
  audibleLanes,
  DRUM_LANE_VOICES,
  occurrenceSeed,
  resolveEffectiveStyle,
  scaleToVelocityPreset,
  styleVelocityTarget,
  tileGrooveVaried,
  voiceOf,
  type DrumBlock,
  type DrumLaneId,
  type KitVoice,
  type TiledNote,
} from "@drum/library";
import {
  beatsPerBar,
  sectionDurationBeats,
  type BlueprintSection,
  type BlueprintSong,
} from "../../types/blueprint";
import { resolveSectionVariant, velocityNumber } from "../playback/drumPreview";
import { planDrumSections, type SectionDrumPlan } from "../midiExport";
import type { SectionSpan } from "../arrangement";

/** The song fields the drum heuristic reads — same structural subset the
 *  preview/resolve chain threads through. */
type SongSignals = Partial<Pick<BlueprintSong, "bpm" | "title" | "concept" | "notes" | "bend" | "genre">>;

/** GM voice → lane family, inverted from the library's own mapping so the
 *  view and the compiler can't disagree about which lane owns a voice. */
const VOICE_TO_LANE = new Map<KitVoice, DrumLaneId>();
for (const [lane, voices] of Object.entries(DRUM_LANE_VOICES)) {
  for (const voice of voices) VOICE_TO_LANE.set(voice, lane as DrumLaneId);
}

export interface LaneHit {
  /** Section-relative beat. */
  beat: number;
  velocity: number;
  voice: KitVoice;
  /** How long the hit holds, in beats, when the planner knows — the gate the
   *  canvas draws. Absent on the paths that carry pitch only. */
  durBeats?: number;
  /** True when the hit falls between the view's dot positions (a
   *  decoupled / odd-meter / 16th onset) — rendered as a ◇ diamond. */
  offGrid: boolean;
  /** True when a gesture (detour / transition / handoff fill) is what puts a
   *  hit here rather than the section's own groove — the view draws those
   *  differently, because toggling the cell under them edits the pocket the
   *  gesture is currently covering. */
  generated?: boolean;
}

export type LaneHits = Map<DrumLaneId, LaneHit[]>;

/** Bin section-relative pitched notes into the six lanes. Muted / un-soloed
 *  lanes are dropped by the SAME rule the planner uses (`audibleLanes`), so
 *  the canvas shows exactly what will play. */
export function laneHitsFromNotes(
  notes: readonly {
    beat: number;
    pitch: number;
    velocity: number;
    duration?: number;
  }[],
  section: Pick<BlueprintSection, "drumLaneMute" | "drumLaneSolo">,
): LaneHits {
  const out: LaneHits = new Map();
  const play = audibleLanes(section.drumLaneMute, section.drumLaneSolo);
  for (const n of notes) {
    const voice = voiceOf(n.pitch);
    if (!voice) continue;
    const lane = VOICE_TO_LANE.get(voice);
    if (!lane || !play.has(lane)) continue;
    const arr = out.get(lane) ?? [];
    arr.push({
      beat: n.beat,
      velocity: n.velocity,
      voice,
      // The resolved note's own length: a painted step's `durBeats`, or the
      // 0.25 the block grid gives a generated hit. The canvas draws this, so a
      // hit that holds looks different from a tick.
      ...(n.duration !== undefined ? { durBeats: n.duration } : {}),
      offGrid: Math.abs(n.beat - Math.round(n.beat)) > 1e-3,
    });
    out.set(lane, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.beat - b.beat);
  return out;
}

/**
 * Every hit of a section's six lanes — the dotted step lanes' data source.
 * The base groove is resolved exactly like the preview/export
 * (`resolveSectionVariant` + velocity scaling), plainly tiled across the
 * section's own duration, and the section's `drumBlocks` are compiled on
 * top with the SAME `applyDrumBlocks` + occurrence seed the export uses —
 * so toggling a dot, dropping an XY pad on a range, or gesturing a motion
 * block shows precisely what will play.
 *
 * What is deliberately NOT mirrored here: the automatic fill/transition
 * gestures (the view draws those in its gesture layer instead) and the
 * outline humaniser's micro-timing (the grid has to stay exact to edit).
 * The Bend transforms, the seeded varied tiling and the 4-bar cycle ARE
 * mirrored, so a step the grid shows is a note the export plays.
 */
export function resolveSectionLaneHits(
  section: BlueprintSection,
  song?: SongSignals,
  occurrenceIndex = 0,
): LaneHits {
  const duration = sectionDurationBeats(section);
  // The Bend (style profile) is structural for the drums: backbeat can ADD
  // 2 & 4 snares and feel can move notes. The export applies it, so the dots
  // must too — this used to be the one transform the grid skipped.
  const profile = resolveEffectiveStyle(section, song);
  const target = styleVelocityTarget(velocityNumber(section.velocity), profile);

  // 1. The base groove exactly as the export tiles it: Bend transforms, the
  //    velocity preset, then the SAME seeded varied tiling (`tileGrooveVaried`
  //    drops the occasional hat as a human gap — drawing that hat would be a
  //    step that never sounds).
  const tiled: TiledNote[] = [];
  const variant = resolveSectionVariant(section, song, occurrenceIndex);
  const styled = variant ? applyStyleToVariant(variant, profile) : null;
  if (styled && styled.notes.length > 0 && styled.lengthBeats > 0) {
    const scaled = scaleToVelocityPreset(styled.notes, target);
    const varied = tileGrooveVaried(
      scaled.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity })),
      styled.lengthBeats,
      duration,
      { seed: occurrenceSeed(section.id, occurrenceIndex) },
    );
    tiled.push(...varied);
  }

  // 2. The 4-bar cycle the export applies (open hat in bar 2, a turned-over
  //    kick on the last eighth of bar 4). This is STRUCTURAL, not the
  //    inaudible velocity drift skipped above — if the export plays it, the
  //    dots have to show it.
  const developed = applyCyclicDevelopment(tiled, {
    beatsPerBar: beatsPerBar(section),
    durationBeats: duration,
    velocityTarget: target,
    openHatPitch: ABLETON_SAFE_NOTES.openHat,
    closedHatPitch: ABLETON_SAFE_NOTES.closedHat,
    kickPitch: ABLETON_SAFE_NOTES.kick,
  });

  // 3. Compile authored blocks on top — same function, same seed, same
  //    velocity target as both export paths.
  const compiled = applyDrumBlocks(developed, (section.drumBlocks ?? []) as DrumBlock[], {
    durationBeats: duration,
    beatsPerBar: beatsPerBar(section),
    velocityTarget: target,
    gridBeats: 0.25,
    seed: occurrenceSeed(section.id, occurrenceIndex),
  });

  // Muted / un-soloed lanes are dropped by the SAME rule the planner uses
  // (`audibleLanes`), so the canvas shows exactly what will play.
  return laneHitsFromNotes(compiled, section);
}

/**
 * What the section PLAYS — the export plan itself (`planDrumStem`'s own
 * `planSectionDrumNotes` pass), section-relative.
 *
 * `resolveSectionLaneHits` is the section's AUTHORED pocket: the groove plus
 * its blocks, which is what a step toggle edits. This is the other side of the
 * same coin — the finished performance, after the automatic detour /
 * transition / handoff fill has taken over the bars it claims, and after the
 * outline humaniser's micro-timing. The lanes draw this, so a fill that
 * replaces the last bar is visible as the fill instead of as a pocket that
 * never sounds.
 *
 * Takes every span because a handoff fill is planned across the seam: a
 * section planned alone would play a different last bar.
 */
export function resolvePlayedLaneHits(
  spans: readonly SectionSpan[],
  song: Parameters<typeof planDrumSections>[1],
  index: number,
  plans?: readonly SectionDrumPlan[],
): LaneHits {
  const span = spans[index];
  if (!span) return new Map();
  const plan = plans?.[index] ?? planDrumSections([...spans], song)[index];
  if (!plan) return new Map();
  return laneHitsFromNotes(plan.notes, span.section);
}

