import { create } from "zustand";

/**
 * The one time selection every editing layer understands.
 *
 * Coordinates are **section-relative beats** (`0..sectionDurationBeats`).
 * Sections own their chords, drum blocks, melody and lyrics, so a range
 * never spans two sections; `sectionId` makes that ownership explicit and
 * lets consumers ignore a stale range when the selected section changes.
 *
 * `lanes` is the set of layers the range applies to (drum lane ids today,
 * harmonic/melodic layer ids as they adopt it). An empty array means "all
 * layers" — the common case for a plain bar selection.
 */
export interface TimeSelection {
  sectionId: string;
  startBeat: number;
  endBeat: number;
  lanes: string[];
}

interface TimeSelectionState {
  selection: TimeSelection | null;
  setSelection: (selection: TimeSelection) => void;
  clearSelection: () => void;
}

function normalize(selection: TimeSelection): TimeSelection {
  const start = Math.max(0, Math.min(selection.startBeat, selection.endBeat));
  const end = Math.max(start, Math.max(selection.startBeat, selection.endBeat));
  return { ...selection, startBeat: start, endBeat: end };
}

export const useTimeSelectionStore = create<TimeSelectionState>((set, get) => ({
  selection: null,
  setSelection: (selection) => {
    const next = normalize(selection);
    const current = get().selection;
    if (
      current &&
      current.sectionId === next.sectionId &&
      current.startBeat === next.startBeat &&
      current.endBeat === next.endBeat &&
      current.lanes.length === next.lanes.length &&
      current.lanes.every((lane, index) => lane === next.lanes[index])
    ) {
      return; // identical range — don't wake every layer on a redundant pointermove
    }
    set({ selection: next });
  },
  clearSelection: () => set({ selection: null }),
}));

/** The selection when it belongs to `sectionId`; null otherwise. */
export function selectionForSection(sectionId: string | null | undefined): TimeSelection | null {
  const selection = useTimeSelectionStore.getState().selection;
  if (!selection || !sectionId || selection.sectionId !== sectionId) return null;
  return selection;
}

/**
 * The selection clamped to the section's CURRENT length, or null when it
 * belongs to a different section.
 *
 * Coordinates are section-relative, but nothing rewrites a stored range when
 * the section changes length — a bar resize, a split, or a template apply
 * can leave `endBeat` past the new `durationBeats`, and every range-driven
 * edit would then overrun the section. Clamping at the read boundary fixes
 * that without writing back into a global store from a render.
 */
export function selectionWithin(
  selection: TimeSelection | null,
  sectionId: string,
  durationBeats: number,
): TimeSelection | null {
  if (!selection || selection.sectionId !== sectionId || durationBeats <= 0) return null;
  const endBeat = Math.min(selection.endBeat, durationBeats);
  const startBeat = Math.min(selection.startBeat, endBeat);
  if (startBeat === selection.startBeat && endBeat === selection.endBeat) return selection;
  return { ...selection, startBeat, endBeat };
}

/** Range in the shape the drums tools already consume. */
export function drumRangeForSection(
  sectionId: string | null | undefined,
): { startBeat: number; endBeat: number; laneKeys: string[] } | null {
  const selection = selectionForSection(sectionId);
  if (!selection) return null;
  return { startBeat: selection.startBeat, endBeat: selection.endBeat, laneKeys: selection.lanes };
}
