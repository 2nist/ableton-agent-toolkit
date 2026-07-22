import { create } from "zustand";
import type { ReactNode } from "react";

/** The bottom dock's two panel slots — not a generic named-panel registry,
 *  because the app only ever needs exactly these two:
 *
 *  - `info`: Song Info (formerly the standalone Details tab). Registered
 *    once by SongEditorLayout on mount and never cleared — available
 *    regardless of which tab is active, since song metadata isn't tied to
 *    any one screen.
 *  - `tools`: whatever the *active* tab has to offer for the current
 *    selection (Harmony's key/scale controls or selected-chord editor;
 *    Lyrics' rhyme/meter/context group). Set and cleared by the tab that
 *    owns it — null on tabs with nothing more specific (Structure, Studio),
 *    which is what makes the dock fall back to Info there.
 */
interface DockState {
  info: ReactNode | null;
  tools: ReactNode | null;
  activePanel: "info" | "tools";
  setInfo: (node: ReactNode) => void;
  /** Auto-switches the dock to "tools" the moment content appears, and
   *  falls back to "info" the moment it's cleared (tab unmount, or nothing
   *  selected) — mirrors Ableton's own Device Chain, which always shows
   *  params for whatever's currently selected rather than staying on
   *  whatever the user was looking at before. */
  setTools: (node: ReactNode | null) => void;
  setActivePanel: (panel: "info" | "tools") => void;
}

export const useDockStore = create<DockState>((set) => ({
  info: null,
  tools: null,
  activePanel: "info",
  setInfo: (node) => set({ info: node }),
  setTools: (node) => set({ tools: node, activePanel: node ? "tools" : "info" }),
  setActivePanel: (panel) => set({ activePanel: panel }),
}));
