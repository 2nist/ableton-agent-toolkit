import { create } from "zustand";

/** Which section is active in the Drums tab — same reasoning and same
 *  shape as `harmonySelectionStore`: the dock's tools panel is a sibling
 *  component registered once into the inspector rail, not re-rendered by
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
  range: DrumsRangeSelection | null;
  setRange: (range: DrumsRangeSelection) => void;
  clearRange: () => void;
}

/**
 * The drums RANGE selection — the Drum Blocks view's editing interface
 * (the marquee / the workbench line view's picked range). SECTION selection
 * is no longer drums-local: it belongs to the shared
 * `useStudioSelectionStore` (the spine writes it on every route, the line
 * view stages it, the drum tools read it) — so selecting a section
 * anywhere now retargets the drums tools exactly like it retargets
 * Harmony. This store keeps only what is genuinely drums-specific; the
 * range still clears whenever the selected section changes (that's
 * enforced by the shared store's consumers, see DrumLineEmbed ordering).
 */
export const useDrumsSelectionStore = create<DrumsSelectionState>((set) => ({
  range: null,
  setRange: (range) => set({ range }),
  clearRange: () => set({ range: null }),
}));
