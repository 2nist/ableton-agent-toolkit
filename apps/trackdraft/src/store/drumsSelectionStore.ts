import { create } from "zustand";

/** Which section is active in the Drums tab — same reasoning and same
 *  shape as `harmonySelectionStore`: the dock's tools panel is a sibling
 *  component registered once into `dockStore`, not re-rendered by
 *  DrumsView on every click, so it needs its own store to read the
 *  current selection from rather than being handed fresh JSX each time.
 *
 *  Keyed by section id, not by span/occurrence — a repeated section
 *  (Chorus playing three times) has one underlying section to edit, and
 *  selecting any one of its timeline blocks should edit that same
 *  section, visibly updating every occurrence at once. */
/** A range selection inside one section — section-relative beats
 *  [startBeat, endBeat) plus the lane family keys the marquee covered.
 *  The Drum Blocks view treats this as its editing interface: the docked
 *  XY pad and the step editor operate on whatever this range names. */
export interface DrumsRangeSelection {
  startBeat: number;
  endBeat: number;
  laneKeys: string[];
}

interface DrumsSelectionState {
  selectedSectionId: string | null;
  setSelectedSectionId: (id: string | null) => void;
  range: DrumsRangeSelection | null;
  setRange: (range: DrumsRangeSelection) => void;
  clearRange: () => void;
}

export const useDrumsSelectionStore = create<DrumsSelectionState>((set) => ({
  selectedSectionId: null,
  // Switching sections drops any range selection — a range is meaningless
  // on a different section's timeline.
  setSelectedSectionId: (id) =>
    set((s) => (s.selectedSectionId === id ? { selectedSectionId: id } : { selectedSectionId: id, range: null })),
  range: null,
  setRange: (range) => set({ range }),
  clearRange: () => set({ range: null }),
}));
