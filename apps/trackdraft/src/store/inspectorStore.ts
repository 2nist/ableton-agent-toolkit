import { create } from "zustand";

/** The inspector's facets — the focused object's tools, one per
 *  instrument/system (layout grammar, user decision 2026-09-21: RIGHT =
 *  the contextual inspector). */
export type InspectorTab = "structure" | "drums" | "harmony" | "lyrics" | "mix" | "song";

interface InspectorState {
  tab: InspectorTab;
  open: boolean;
  setTab: (t: InspectorTab) => void;
  setOpen: (o: boolean) => void;
  /** Select a facet AND open the rail — the "slides open on engagement"
   *  API any surface can call (the line view engages ▦ drums, etc.). */
  engage: (t: InspectorTab) => void;
}

export const useInspectorStore = create<InspectorState>((set) => ({
  tab: "structure",
  open: true,
  setTab: (t) => set({ tab: t }),
  setOpen: (o) => set({ open: o }),
  engage: (t) => set({ tab: t, open: true }),
}));
