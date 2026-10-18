import { useMemo } from "react";
import { resolveChordOccurrences, resolveStyleProfile, styleSpacing } from "@drum/library";
import { activeChordIdAt } from "../lib/harmony/activeChord";
import type { BlueprintSection, BlueprintSong } from "../types/blueprint";

/**
 * The chord that is sounding at `beatInSection` (section-relative), or null
 * when the playhead is elsewhere. Shared by the workbench and the harmony
 * canvas so a highlight can never disagree with what the generators play.
 */
export function useActiveChord(
  section: BlueprintSection | null,
  song: BlueprintSong | null,
  sectionBeats: number,
  beatInSection: number | null,
): string | null {
  return useMemo(() => {
    if (!section || !song || sectionBeats <= 0) return null;
    const profile = resolveStyleProfile(section, song);
    const occurrences = resolveChordOccurrences(
      section,
      sectionBeats,
      styleSpacing(profile.density),
    );
    return activeChordIdAt(occurrences, beatInSection);
  }, [section, song, sectionBeats, beatInSection]);
}
