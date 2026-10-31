import { create } from "zustand";
import { readStorage, writeStorage } from "./storage";
import { STORAGE_KEYS } from "../lib/persistence/keys";

/** Which chrome the app is wearing. `dark` is the Ableton-derived palette
 *  that has always been the default; `logsheet` is the studio-log theme
 *  (printed form · pencil · tape · stamps). */
export type ThemeId = "dark" | "logsheet";

const STORAGE_KEY = STORAGE_KEYS.theme.key;

/** The themes a picker can offer, in order, with the label to show. */
export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "logsheet", label: "Log sheet" },
];

/** Push the theme onto the document. `data-theme` drives the palette block in
 *  theme/themes.css; `color-scheme` keeps native controls, scrollbars and
 *  form widgets in the same world (a light sheet with dark scrollbars looks
 *  broken in a way people notice but rarely diagnose). */
export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === "dark" ? "dark" : "light";
}

interface ThemeStoreState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  theme: readStorage<ThemeId>(STORAGE_KEY, "dark"),
  setTheme: (theme) => {
    writeStorage(STORAGE_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === "dark" ? "logsheet" : "dark"),
}));
