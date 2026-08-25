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
interface DrumsSelectionState {
  selectedSectionId: string | null;
  setSelectedSectionId: (id: string | null) => void;
}

export const useDrumsSelectionStore = create<DrumsSelectionState>((set) => ({
  selectedSectionId: null,
  setSelectedSectionId: (id) => set({ selectedSectionId: id }),
}));
