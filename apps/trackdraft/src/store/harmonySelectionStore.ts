import { create } from "zustand";

/** Which section/chord is active in the Harmony tab — lifted out of
 *  HarmonyView's local state so the dock's tools panel (a sibling
 *  component, registered once into `dockStore` rather than re-rendered by
 *  HarmonyView on every selection change) can read the same selection
 *  independently. Pushing freshly-computed JSX into the dock via an effect
 *  keyed on this state would risk a render loop (dock update → layout
 *  re-render → HarmonyView re-render → effect refires → dock update...);
 *  a shared store both sides subscribe to directly avoids that entirely —
 *  same pattern `SongInfoPanel` already uses against `useSongStore`. */
interface HarmonySelectionState {
  selectedSectionId: string | null;
  selectedChordId: string | null;
  setSelectedSectionId: (id: string | null) => void;
  setSelectedChordId: (id: string | null) => void;
}

export const useHarmonySelectionStore = create<HarmonySelectionState>((set) => ({
  selectedSectionId: null,
  selectedChordId: null,
  setSelectedSectionId: (id) => set({ selectedSectionId: id }),
  setSelectedChordId: (id) => set({ selectedChordId: id }),
}));
