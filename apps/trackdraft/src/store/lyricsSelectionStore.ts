import { create } from "zustand";

/** Which section is active in per-section Lyrics mode — lifted out of
 *  LyricsView's local state for the same reason as harmonySelectionStore:
 *  the dock's tools panel (MetricalTable/WritingContext/RhymeSuggestions)
 *  is a sibling component registered once, and needs to derive the same
 *  active section independently rather than have LyricsView push
 *  freshly-computed JSX into the dock on every change. */
interface LyricsSelectionState {
  selectedSectionId: string | null;
  setSelectedSectionId: (id: string | null) => void;
}

export const useLyricsSelectionStore = create<LyricsSelectionState>((set) => ({
  selectedSectionId: null,
  setSelectedSectionId: (id) => set({ selectedSectionId: id }),
}));
