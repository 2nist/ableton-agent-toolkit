import {
  narrativeHarmonySection,
  resolveChordOccurrences,
  resolveEffectiveStyle,
  resolveNarrativeProfile,
  styleSpacing,
  type ChordOccurrence,
} from "@drum/library";
import type { BlueprintSection, BlueprintSong, Chord } from "../../types/blueprint";

/**
 * The chords a section will ACTUALLY play, with their real onsets and
 * durations.
 *
 * This used to exist in three flavours: the narrative/style-styled one
 * behind the playback highlight, a plain `resolveChordOccurrences(section,
 * durationBeats)` behind the workbench's chord row and the hex canvas, and
 * a third in the export path. Whenever the style's density nudge re-timed
 * the cycle (`styleSpacing(density) !== 1`) or a meter outline was in play,
 * the highlight and the chord box it was drawn over came from different
 * timings — a highlight sitting beside the chord it claims to be lighting.
 *
 * One resolver, so a highlight can never disagree with what the generators
 * play, and with the box it is drawn on.
 */
export function sectionOccurrences(
  section: BlueprintSection,
  song: BlueprintSong | null | undefined,
  durationBeats: number,
): ChordOccurrence<Chord>[] {
  if (durationBeats <= 0) return [];
  const spacing = styleSpacing(resolveEffectiveStyle(section, song ?? undefined).density);
  return resolveChordOccurrences(
    narrativeHarmonySection(section, resolveNarrativeProfile(section, song ?? undefined)),
    durationBeats,
    spacing,
  );
}
