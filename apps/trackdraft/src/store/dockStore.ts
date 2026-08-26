import { create } from "zustand";
import type { ReactNode } from "react";

/** The bottom dock's panel slots — not a generic named-panel registry,
 *  because the app only ever needs exactly these three:
 *
 *  - `info`: Song Info (formerly the standalone Details tab). Registered
 *    once by SongEditorLayout on mount and never cleared — available
 *    regardless of which tab is active, since song metadata isn't tied to
 *    any one screen. Always the last tab in the strip.
 *  - `primary`: the tab's main menu — its stable, always-visible working
 *    content (Harmony's key/scale/presets). Sits first in the strip when
 *    present; only Harmony uses it today.
 *  - `tools`: whatever the *active* tab has to offer for the current
 *    selection (Harmony's selected-chord editor; Drums' pattern/variation/
 *    transition editors; Lyrics' rhyme/meter/context group). Set and
 *    cleared by the tab that owns it — null on tabs with nothing more
 *    specific (Structure, Studio), which is what makes the dock fall back
 *    to Info there.
 */
interface DockState {
  info: ReactNode | null;
  primary: ReactNode | null;
  tools: ReactNode | null;
  activePanel: "info" | "primary" | "tools";
  setInfo: (node: ReactNode) => void;
  /** Registers the tab's main menu as the default view — it outranks
   *  `tools`, so Harmony lands on its menu rather than the chord editor. */
  setPrimary: (node: ReactNode | null) => void;
  /** Auto-switches the dock to "tools" the moment content appears, and
   *  falls back to "primary" (when present) or "info" the moment it's
   *  cleared (tab unmount, or nothing selected) — mirrors Ableton's own
   *  Device Chain, which always shows params for whatever's currently
   *  selected rather than staying on whatever the user was looking at
   *  before. */
  setTools: (node: ReactNode | null) => void;
  setActivePanel: (panel: "info" | "primary" | "tools") => void;
}

export const useDockStore = create<DockState>((set) => ({
  info: null,
  primary: null,
  tools: null,
  activePanel: "info",
  setInfo: (node) => set({ info: node }),
  setPrimary: (node) =>
    set((s) => ({ primary: node, activePanel: node ? "primary" : s.tools ? "tools" : "info" })),
  setTools: (node) =>
    set((s) => ({ tools: node, activePanel: s.primary ? "primary" : node ? "tools" : "info" })),
  setActivePanel: (panel) => set({ activePanel: panel }),
}));
