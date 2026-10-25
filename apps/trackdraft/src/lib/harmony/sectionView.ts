import { NOTE_TO_PC, type NoteName, type ScaleType } from "@music-theory/core";
import { resolveChordOccurrences } from "@drum/library";
import { sectionDurationBeats, type BlueprintSection, type BlueprintSong } from "../../types/blueprint";
import { effectiveTonicRegions } from "./tonic";

/**
 * The tonality one section is read in: its own key/scale override when it has
 * one, otherwise the song's, plus the homes actually in force (authored, or
 * what the key finder proposes for the progression as it plays).
 *
 * Extracted because more than one view needs it now — the focused section, a
 * stacked band, and the comparison table — and three copies of this
 * derivation would eventually disagree about what a numeral means.
 */
export interface SectionView {
  keyName: NoteName;
  scale: ScaleType;
  regions: ReturnType<typeof effectiveTonicRegions>;
  /** True when a meter outline (drums/Bend grid) decides chord timing. */
  outlineGoverned: boolean;
}

export function sectionView(song: BlueprintSong, section: BlueprintSection): SectionView {
  const raw = section.key ?? song.key ?? "C";
  const keyName: NoteName = raw in NOTE_TO_PC ? (raw as NoteName) : "C";
  const scale: ScaleType = section.scale ?? song.scale ?? "ionian";
  const occurrences = resolveChordOccurrences(section, sectionDurationBeats(section)).map((occurrence) => ({
    root: occurrence.chord.root,
    quality: occurrence.chord.quality,
    startTime: occurrence.startTime,
    duration: occurrence.duration,
  }));
  const regions = effectiveTonicRegions(section.tonicRegions, occurrences, { scale, fallbackKey: keyName });
  const outlineGoverned = !!(
    section.harmonyMeterOutline ??
    (section.harmonyFollowsDrums === false ? null : section.drumMeterOutline ?? null)
  );
  return { keyName, scale, regions, outlineGoverned };
}
