import { create } from "zustand";

/**
 * The song editor's SHARED section selection — which section has focus.
 * Written by the spine (shell chrome on every song route since P2 — its
 * blocks are the app-wide section navigator) and read by the Studio
 * arrangement timeline + Mix/Bend panel, the Workbench's section workspace
 * + Structure rail, and the Harmony workspace (since the Harmony dock's
 * section chips died in P2). The "studio" in the name is historical —
 * treat this as THE section selection for a song, the way
 * `songStore.currentSong()` is THE song.
 */
interface StudioSelectionState {
  selectedSectionId: string | null;
  setSelectedSectionId: (id: string | null) => void;
}

export const useStudioSelectionStore = create<StudioSelectionState>((set) => ({
  selectedSectionId: null,
  setSelectedSectionId: (id) => set({ selectedSectionId: id }),
}));
