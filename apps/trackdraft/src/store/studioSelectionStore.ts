import { create } from "zustand";
import {
  EMPTY_SELECTION,
  reconcileSelection as reconcileSelectionRef,
  selectSections,
  type SelectionMode,
  type SelectionState,
} from "../lib/sectionSelection";

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
interface StudioSelection extends SelectionState {
  /** The ONE section single-section views follow — always the last pick, and
   *  always a member of `selected` (or null). */
  selectedSectionId: string | null;
  /** Plain pick. Kept as the simple API every existing caller uses. */
  setSelectedSectionId: (id: string | null) => void;
  /** Click / ⇧-click / ⌘-click, resolved against the song's section order. */
  selectSection: (id: string, mode: SelectionMode, order: readonly string[]) => void;
  /** Sweep: extend the range from the current anchor to `id`. */
  extendSelectionTo: (id: string, order: readonly string[]) => void;
  setSelection: (ids: readonly string[], focus?: string | null) => void;
  clearSelection: () => void;
  /** Drop ids that no longer exist (after a split, merge or delete). */
  reconcile: (order: readonly string[]) => void;
}

export const useStudioSelectionStore = create<StudioSelection>((set, get) => ({
  ...EMPTY_SELECTION,
  selectedSectionId: null,
  setSelectedSectionId: (id) =>
    set({
      selectedSectionId: id,
      selected: id ? [id] : [],
      anchor: id,
      focus: id,
    }),
  selectSection: (id, mode, order) => {
    const next = selectSections(get(), id, mode, order);
    if (next === get()) return;
    set({ ...next, selectedSectionId: next.focus });
  },
  extendSelectionTo: (id, order) => {
    const next = selectSections(get(), id, "extend", order);
    if (next === get()) return;
    set({ ...next, selectedSectionId: next.focus });
  },
  setSelection: (ids, focus) => {
    const clean = [...new Set(ids)];
    const resolved = focus && clean.includes(focus) ? focus : (clean[clean.length - 1] ?? null);
    set({ selected: clean, anchor: resolved, focus: resolved, selectedSectionId: resolved });
  },
  clearSelection: () => set({ ...EMPTY_SELECTION, selectedSectionId: null }),
  reconcile: (order) => {
    const state = get();
    const next = reconcileSelectionRef(state, order);
    if (next === state) return;
    set({ ...next, selectedSectionId: next.focus });
  },
}));
