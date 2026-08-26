import { create } from "zustand";
import type { BlueprintSection } from "../types/blueprint";

/** A working draft of a section's drum fields — the in-progress edit the
 *  Pattern editor is previewing live on the timeline before the user
 *  commits it with Apply. One draft at a time, keyed by section id;
 *  switching sections (or pressing Revert/Apply) clears it. The timeline
 *  reads this directly, so dragging a slider shows the change on the
 *  voice lines / necklaces / domes without touching the song's real data. */
interface DrumsDraftState {
  sectionId: string | null;
  section: BlueprintSection | null;
  setDraft: (sectionId: string, section: BlueprintSection) => void;
  clearDraft: () => void;
}

export const useDrumsDraftStore = create<DrumsDraftState>((set) => ({
  sectionId: null,
  section: null,
  setDraft: (sectionId, section) => set({ sectionId, section }),
  clearDraft: () => set({ sectionId: null, section: null }),
}));
