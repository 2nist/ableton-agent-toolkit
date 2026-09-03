import { create } from "zustand";

/**
 * Studio tab selection — which section the Studio arrangement timeline has
 * focused, so the Mix/Bend panel's per-section override targets it. Mirrors
 * the other per-tab selection stores (drums/harmony/lyrics): sibling
 * components read the store directly rather than receiving props through
 * the tab.
 */
interface StudioSelectionState {
  selectedSectionId: string | null;
  setSelectedSectionId: (id: string | null) => void;
}

export const useStudioSelectionStore = create<StudioSelectionState>((set) => ({
  selectedSectionId: null,
  setSelectedSectionId: (id) => set({ selectedSectionId: id }),
}));
