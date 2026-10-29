import { useMemo } from "react";
import { activeChordIdAt } from "../lib/harmony/activeChord";
import { sectionOccurrences } from "../lib/harmony/sectionOccurrences";
import type { ChordOccurrence } from "@drum/library";
import type { BlueprintSection, BlueprintSong, Chord } from "../types/blueprint";

/**
 * The section's resolved chord occurrences — the EXPENSIVE half of "which
 * chord is sounding": it resolves the effective style and the narrative's
 * warped grid, then loops the progression across the section.
 *
 * Deliberately separate from the lookup (see `useActiveChord`) and memoized
 * only on what actually changes the answer. Folding the playhead into the
 * same memo (the old shape) re-ran all of the above at animation-frame rate
 * to produce a value that changes twice a bar.
 */
export function useSectionOccurrences(
  section: BlueprintSection | null,
  song: BlueprintSong | null,
  sectionBeats: number,
): ChordOccurrence<Chord>[] {
  return useMemo(
    () => (section && song && sectionBeats > 0 ? sectionOccurrences(section, song, sectionBeats) : []),
    [section, song, sectionBeats],
  );
}

/**
 * The chord that is sounding at `beatInSection` (section-relative), or null
 * when the playhead is elsewhere. Shared by the workbench and the harmony
 * canvas so a highlight can never disagree with what the generators play.
 *
 * The per-tick cost is one scan of the already-resolved occurrences.
 */
export function useActiveChord(
  section: BlueprintSection | null,
  song: BlueprintSong | null,
  sectionBeats: number,
  beatInSection: number | null,
): string | null {
  const occurrences = useSectionOccurrences(section, song, sectionBeats);
  return activeChordIdAt(occurrences, beatInSection);
}
