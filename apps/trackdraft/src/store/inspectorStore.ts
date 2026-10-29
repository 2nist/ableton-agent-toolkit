import { create } from "zustand";

/** The inspector's facets — the focused object's tools, one per
 *  instrument/system (layout grammar, user decision 2026-09-21: RIGHT =
 *  the contextual inspector). */
export type InspectorTab = "structure" | "drums" | "harmony" | "lyrics" | "mix" | "song" | "sync";

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
  // Minimized by default (user decision 2026-10-24): the rail shows its
  // facets as a glyph strip, so the canvas gets the width and the tools are
  // still one click away. Engagement (a new selection, a facet icon, the
  // `engage` API) opens it.
  open: false,
  setTab: (t) => set({ tab: t }),
  setOpen: (o) => set({ open: o }),
  engage: (t) => set({ tab: t, open: true }),
}));
