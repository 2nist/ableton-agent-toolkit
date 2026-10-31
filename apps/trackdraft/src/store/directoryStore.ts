import { create } from "zustand";
import { getHost } from "../lib/host";
import { kindForFile } from "../lib/importKinds";
import { readStorage, writeStorage } from "./storage";
import { STORAGE_KEYS } from "../lib/persistence/keys";

export interface DirectoryConfig {
  path: string;
  label: string;
  isDefault: boolean;
}

export interface DirectoryEntry {
  file: string;
  title: string;
  sections: number;
  type?: "blueprint" | "jcrd" | "audio" | "midi" | "lyrics" | "ableton" | "musicxml" | "directory" | "unknown";
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

const STORAGE_KEY = STORAGE_KEYS.directories.key;

export const useDirectoryStore = create<DirectoryStoreState>((set, get) => ({
  dirs: readStorage<DirectoryConfig[]>(STORAGE_KEY, []),
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
    writeStorage(STORAGE_KEY, next);
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
    writeStorage(STORAGE_KEY, next);
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
    writeStorage(STORAGE_KEY, next);
    set({ dirs: next });
  },

  loadListing: async (path: string) => {
    set({ loading: path, error: null });
    try {
      // Desktop has no dev server to ask, so it lists the folder through the
      // main process. Same shape either way; only the source differs.
      const host = getHost();
      if (host) {
        const files = await host.listDirectory(path);
        const entries: DirectoryEntry[] = files.map((f) => {
          if (f.isDirectory) {
            return { file: f.name, title: f.name, sections: 0, type: "directory", loadable: false };
          }
          const info = kindForFile(f.name);
          return { file: f.name, title: f.name, sections: 0, type: info.category, loadable: info.loadable };
        });
        set((s) => ({
          listings: { ...s.listings, [path]: entries },
          loading: null,
          error: null,
        }));
        return;
      }
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
