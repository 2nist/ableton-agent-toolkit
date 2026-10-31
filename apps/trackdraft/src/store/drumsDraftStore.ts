import { create } from "zustand";
import type { BlueprintSection } from "../types/blueprint";
import { useSongStore } from "./songStore";
import { updateSection } from "../lib/sections";

/** A working draft of a section's drum fields — the in-progress edit the
 *  Pattern editor is previewing live on the timeline before the user
 *  commits it with Apply. One draft at a time, keyed by section id;
 *  switching sections (or pressing Revert/Apply) clears it. The timeline
 *  reads this directly, so dragging a slider shows the change on the
 *  voice lines / necklaces / domes without touching the song's real data. */
interface DrumsDraftState {
  sectionId: string | null;
  section: BlueprintSection | null;
  setDraft: (sectionId: string, section: BlueprintSection) => void;
  clearDraft: () => void;
}

export const useDrumsDraftStore = create<DrumsDraftState>((set) => ({
  sectionId: null,
  section: null,
  setDraft: (sectionId, section) => set({ sectionId, section }),
  clearDraft: () => set({ sectionId: null, section: null }),
}));

/**
 * The one way to write drum fields into the song.
 *
 * A staged draft shadows the song on every surface that reads it (the timeline,
 * the necklaces, the transport's preview), so a direct edit that forgot to drop
 * the draft first would appear to do nothing. That invariant used to be five
 * separate `clearDraft()` calls spread across two components, each one a
 * chance to forget it. It lives here now.
 */
export function writeDrumSection(
  sectionId: string,
  mutate: (section: BlueprintSection) => BlueprintSection,
): void {
  useDrumsDraftStore.getState().clearDraft();
  useSongStore.getState().updateCurrentSong((song) => updateSection(song, sectionId, mutate));
}
