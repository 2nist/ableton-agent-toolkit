import { create } from "zustand";

/** Lyrics-view state that is NOT the section selection: the per-section
 *  vs song-text mode (a view toggle the inspector's ✎ facet also reads,
 *  to know whether its per-section tools apply). Section selection lives
 *  in the shared `useStudioSelectionStore` like every other view
 *  (unified 2026-09-21 with the layout grammar). */
interface LyricsSelectionState {
  mode: "per-section" | "song-text";
  setMode: (mode: LyricsSelectionState["mode"]) => void;
}

export const useLyricsSelectionStore = create<LyricsSelectionState>((set) => ({
  mode: "per-section",
  setMode: (mode) => set({ mode }),
}));
