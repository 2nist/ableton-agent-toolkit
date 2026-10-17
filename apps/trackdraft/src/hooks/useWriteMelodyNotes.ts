import { useCallback } from "react";
import { useSongStore } from "../store/songStore";
import { updateSection } from "../lib/sections";
import { editedMelodyTrack } from "../lib/melody/noteEdits";
import type { MelodyNote } from "../types/blueprint";

/**
 * The one write path for hand-edited melody notes. Every gesture in the note
 * editor funnels here so `editedMelodyTrack` is applied exactly once: the
 * section keeps its other fields, the line is marked `"edited"`, and the
 * export stem stops re-shaping it with the Bend contour.
 */
export function useWriteMelodyNotes() {
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  return useCallback(
    (sectionId: string, notes: MelodyNote[]) => {
      updateCurrentSong((song) =>
        updateSection(song, sectionId, (section) => ({
          ...section,
          melody: editedMelodyTrack(section.melody, notes),
        })),
      );
    },
    [updateCurrentSong],
  );
}
