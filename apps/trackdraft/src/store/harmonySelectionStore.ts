import { create } from "zustand";

/** Which CHORD is active in the Harmony tab, plus the honeycomb view mode —
 *  lifted out of HarmonyView's local state so the dock's tools panel (a
 *  sibling component, registered once into the inspector rail rather than
 *  re-rendered by HarmonyView on every selection change) can read the same
 *  selection independently. Pushing freshly-computed JSX into the dock via
 *  an effect keyed on this state would risk a render loop (dock update →
 *  layout re-render → HarmonyView re-render → effect refires → dock
 *  update...); a shared store both sides subscribe to directly avoids that
 *  entirely — same pattern `SongInfoPanel` already uses against
 *  `useSongStore`.
 *
 *  SECTION selection is deliberately NOT here: it belongs to the shared
 *  `useStudioSelectionStore`, which the spine writes on every route — so
 *  the spine's selection IS the harmony workspace's active section (the
 *  dock's old section chips died in P2). */
interface HarmonySelectionState {
  selectedChordId: string | null;
  /** Honeycomb view mode — lifted so the wheel (in the canvas) and the
   *  view toggle (in the dock's Tools panel) stay in sync without
   *  HarmonyView re-registering dock content.
   *
   *  `linear` / `loop` draw the degree lattice flat; `depth` gives each step
   *  a depth (z = sequence position) and shears the projection, so the path
   *  is monotone — repeats and runs advance instead of backtracking. */
  honeycombMode: "linear" | "loop" | "depth" | "scene";
  setSelectedChordId: (id: string | null) => void;
  setHoneycombMode: (mode: "linear" | "loop" | "depth" | "scene") => void;
}

export const useHarmonySelectionStore = create<HarmonySelectionState>((set) => ({
  selectedChordId: null,
  honeycombMode: "linear",
  setSelectedChordId: (id) => set({ selectedChordId: id }),
  setHoneycombMode: (mode) => set({ honeycombMode: mode }),
}));
