import { create } from "zustand";

export interface DirectoryConfig {
  path: string;
  label: string;
  isDefault: boolean;
}

export interface DirectoryEntry {
  file: string;
  title: string;
  sections: number;
  type?: "blueprint" | "jcrd" | "audio" | "midi" | "lyrics" | "ableton" | "directory" | "unknown";
  loadable: boolean;
}

interface DirectoryStoreState {
  /** User-configured directories. */
  dirs: DirectoryConfig[];
  /** Loaded file listings, keyed by directory path. */
  listings: Record<string, DirectoryEntry[]>;
  /** Which directory listing is currently loading. */
  loading: string | null;
  /** Error from last load attempt. */
  error: string | null;

  addDirectory: (dir: DirectoryConfig) => void;
  removeDirectory: (path: string) => void;
  setDefault: (path: string) => void;
  loadListing: (path: string) => Promise<void>;
  refreshAll: () => Promise<void>;
}

const STORAGE_KEY = "trackdraft-directories";

function loadFromStorage(): DirectoryConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DirectoryConfig[]) : [];
  } catch {
    return [];
  }
}

function persist(dirs: DirectoryConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dirs));
}

export const useDirectoryStore = create<DirectoryStoreState>((set, get) => ({
  dirs: loadFromStorage(),
  listings: {},
  loading: null,
  error: null,

  addDirectory: (dir: DirectoryConfig) => {
    const next = [
      ...get().dirs.filter((d) => d.path !== dir.path),
      dir,
    ];
    // If this is the first default, mark it so
    if (!next.some((d) => d.isDefault)) {
      next[0].isDefault = true;
    }
    persist(next);
    set({ dirs: next });
    // Auto-load the new directory
    get().loadListing(dir.path);
  },

  removeDirectory: (path: string) => {
    const next = get().dirs.filter((d) => d.path !== path);
    // If we removed the default, make the first remaining one default
    if (next.length > 0 && !next.some((d) => d.isDefault)) {
      next[0].isDefault = true;
    }
    persist(next);
    set((s) => {
      const listings = { ...s.listings };
      delete listings[path];
      return { dirs: next, listings };
    });
  },

  setDefault: (path: string) => {
    const next = get().dirs.map((d) => ({
      ...d,
      isDefault: d.path === path,
    }));
    persist(next);
    set({ dirs: next });
  },

  loadListing: async (path: string) => {
    set({ loading: path, error: null });
    try {
      const res = await fetch(`/__local-browse?dir=${encodeURIComponent(path)}`);
      if (!res.ok) {
        // Try to read server error message
        let serverMsg = "";
        try {
          const body = await res.json();
          serverMsg = (body as { error?: string }).error ?? "";
        } catch {}
        throw new Error(serverMsg || `Server returned ${res.status} for ${path}`);
      }
      const data = await res.json();
      if (typeof data === "object" && data !== null && "error" in data) {
        throw new Error((data as { error: string }).error);
      }
      const entries = (data as DirectoryEntry[]);
      set((s) => ({
        listings: { ...s.listings, [path]: entries },
        loading: null,
        error: null,
      }));
    } catch (err) {
      set({
        loading: null,
        error: err instanceof Error ? err.message : "Failed to load directory",
      });
    }
  },

  refreshAll: async () => {
    const { dirs } = get();
    await Promise.all(dirs.map((d) => get().loadListing(d.path)));
  },
}));