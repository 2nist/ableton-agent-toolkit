import { useMemo } from "react";
import {
  resolveChordOccurrences,
  resolveEffectiveStyle,
  resolveNarrativeProfile,
  narrativeHarmonySection,
  styleSpacing,
} from "@drum/library";
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
    // Effective style + the narrative's warped grid: the highlight must sit on
    // the same chord boundaries the export writes, or the app lights one chord
    // while the file plays another.
    const profile = resolveEffectiveStyle(section, song);
    const occurrences = resolveChordOccurrences(
      narrativeHarmonySection(section, resolveNarrativeProfile(section, song)),
      sectionBeats,
      styleSpacing(profile.density),
    );
    return activeChordIdAt(occurrences, beatInSection);
  }, [section, song, sectionBeats, beatInSection]);
}
