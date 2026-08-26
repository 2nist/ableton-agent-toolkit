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
  /** Honeycomb view mode — also lifted here so the wheel (in the canvas)
   *  and the Linear/Loop toggle (in the dock's Tools panel) stay in sync
   *  without HarmonyView re-registering dock content. */
  honeycombMode: "linear" | "loop";
  setSelectedSectionId: (id: string | null) => void;
  setSelectedChordId: (id: string | null) => void;
  setHoneycombMode: (mode: "linear" | "loop") => void;
}

export const useHarmonySelectionStore = create<HarmonySelectionState>((set) => ({
  selectedSectionId: null,
  selectedChordId: null,
  honeycombMode: "linear",
  setSelectedSectionId: (id) => set({ selectedSectionId: id }),
  setSelectedChordId: (id) => set({ selectedChordId: id }),
  setHoneycombMode: (mode) => set({ honeycombMode: mode }),
}));
