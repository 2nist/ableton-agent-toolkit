import {
  applyDrumBlocks,
  audibleLanes,
  DRUM_LANE_VOICES,
  occurrenceSeed,
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
  /** True when the hit falls between the view's dot positions (a
   *  decoupled / odd-meter / 16th onset) — rendered as a ◇ diamond. */
  offGrid: boolean;
}

export type LaneHits = Map<DrumLaneId, LaneHit[]>;

/**
 * Every hit of a section's six lanes — the dotted step lanes' data source.
 * The base groove is resolved exactly like the preview/export
 * (`resolveSectionVariant` + velocity scaling), plainly tiled across the
 * section's own duration, and the section's `drumBlocks` are compiled on
 * top with the SAME `applyDrumBlocks` + occurrence seed the export uses —
 * so toggling a dot, dropping an XY pad on a range, or gesturing a motion
 * block shows precisely what will play.
 *
 * The one export-side step deliberately not mirrored here is the automatic
 * fill/transition/Bend machinery — the same simplification the classic
 * view's per-loop necklaces make.
 */
export function resolveSectionLaneHits(
  section: BlueprintSection,
  song?: SongSignals,
  occurrenceIndex = 0,
): LaneHits {
  const out: LaneHits = new Map();
  const duration = sectionDurationBeats(section);
  const target = velocityNumber(section.velocity);

  // 1. Tile the base groove across the section (plain tiling; the export's
  //    seeded micro-variation is inaudible at dot resolution).
  const tiled: TiledNote[] = [];
  const variant = resolveSectionVariant(section, song, occurrenceIndex);
  if (variant && variant.notes.length > 0 && variant.lengthBeats > 0) {
    const peak = Math.max(...variant.notes.map(([, , v]) => v), 1);
    const scale = target / peak;
    for (let base = 0; base < duration - 1e-9; base += variant.lengthBeats) {
      for (const [beat, pitch, velocity] of variant.notes) {
        const pos = beat + base;
        if (pos >= duration - 1e-9) continue;
        tiled.push({
          beat: Math.round(pos * 10000) / 10000,
          pitch,
          velocity: Math.max(1, Math.min(127, Math.round(velocity * scale))),
        });
      }
    }
  }

  // 2. Compile authored blocks on top — same function, same seed, same
  //    velocity target as both export paths.
  const compiled = applyDrumBlocks(tiled, (section.drumBlocks ?? []) as DrumBlock[], {
    durationBeats: duration,
    beatsPerBar: beatsPerBar(section),
    velocityTarget: target,
    gridBeats: 0.25,
    seed: occurrenceSeed(section.id, occurrenceIndex),
  });

  // Muted / un-soloed lanes are dropped here by the SAME rule the planner
  // uses (`audibleLanes`), so the canvas shows exactly what will play.
  const play = audibleLanes(section.drumLaneMute, section.drumLaneSolo);
  for (const n of compiled) {
    const voice = voiceOf(n.pitch);
    if (!voice) continue;
    const lane = VOICE_TO_LANE.get(voice);
    if (!lane || !play.has(lane)) continue;
    const arr = out.get(lane) ?? [];
    arr.push({
      beat: n.beat,
      velocity: n.velocity,
      voice,
      offGrid: Math.abs(n.beat - Math.round(n.beat)) > 1e-3,
    });
    out.set(lane, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.beat - b.beat);
  return out;
}
