import { create } from "zustand";
import { type BlueprintSong, createEmptySong } from "../types/blueprint";
import { createSongRepository, type SongRepositoryKind } from "../lib/persistence/songRepository";
import { applySongTables } from "../lib/dataFiles";

const MAX_HISTORY = 50;

interface SongStoreState {
  songs: BlueprintSong[];
  currentSongId: string | null;
  history: BlueprintSong[];
  historyIndex: number;

  currentSong: () => BlueprintSong | null;

  createNewSong: (title: string) => BlueprintSong;
  importSong: (song: BlueprintSong) => void;
  openSong: (id: string) => void;
  deleteSong: (id: string) => void;
  updateCurrentSong: (updater: (song: BlueprintSong) => BlueprintSong) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  autoSave: () => void;
  /**
   * Load the library from wherever it lives — the desktop app's library
   * directory (which main seeds from the bundled catalogue on first run), or
   * localStorage in a browser. Returns where it came from, for the shell's
   * diagnostics, so nothing else has to ask whether a host exists.
   */
  hydrate: () => Promise<SongRepositoryKind>;
}

/** Where the library lives. Chosen once, at module load, so no store action
 *  has to ask whether it is running in the desktop shell. */
const repository = createSongRepository();

/**
 * The song layer of the engine tables.
 *
 * Tables are process-wide (the engine reads them from its packages' module
 * state), so "this song only" means mirroring the open song's overrides into
 * them whenever the open song changes — and putting the library's back when the
 * song closes. Guarded by identity: `tables` only changes when it is edited, so
 * the common case of typing in a field does not re-apply three tables.
 */
let appliedTables: BlueprintSong["tables"];
function syncSongTables(): void {
  const { songs, currentSongId } = useSongStore.getState();
  const tables = songs.find((song) => song.id === currentSongId)?.tables;
  if (tables === appliedTables) return;
  appliedTables = tables;
  applySongTables(tables);
}

export const useSongStore = create<SongStoreState>((set, get) => ({
  songs: [],
  currentSongId: null,
  history: [],
  historyIndex: -1,
  currentSong: () => {
    const { songs, currentSongId } = get();
    return songs.find((s) => s.id === currentSongId) ?? null;
  },

  createNewSong: (title: string) => {
    const song = createEmptySong(title);
    set((state) => ({
      songs: [...state.songs, song],
      currentSongId: song.id,
      history: [song],
      historyIndex: 0,
    }));
    syncSongTables();
    get().autoSave();
    return song;
  },

  importSong: (song: BlueprintSong) => {
    set((state) => ({
      songs: [...state.songs.filter((s) => s.id !== song.id), song],
      currentSongId: song.id,
      history: [song],
      historyIndex: 0,
    }));
    syncSongTables();
    get().autoSave();
  },

  openSong: (id: string) => {
    const song = get().songs.find((s) => s.id === id);
    if (!song) return;
    set({ currentSongId: id, history: [song], historyIndex: 0 });
    syncSongTables();
  },

  deleteSong: (id: string) => {
    set((state) => {
      const songs = state.songs.filter((s) => s.id !== id);
      const currentSongId = state.currentSongId === id ? null : state.currentSongId;
      return { songs, currentSongId, history: [], historyIndex: -1 };
    });
    syncSongTables();
    get().autoSave();
  },

  updateCurrentSong: (updater) => {
    const { songs, currentSongId, history, historyIndex } = get();
    const current = songs.find((s) => s.id === currentSongId);
    if (!current) return;

    const updated = { ...updater(current), updatedAt: new Date().toISOString() };
    const songsNext = songs.map((s) => (s.id === updated.id ? updated : s));

    // Truncate any redo tail, push the new state, cap at MAX_HISTORY.
    const historyNext = [...history.slice(0, historyIndex + 1), updated].slice(-MAX_HISTORY);

    set({
      songs: songsNext,
      history: historyNext,
      historyIndex: historyNext.length - 1,
    });
    syncSongTables();
    get().autoSave();
  },

  undo: () => {
    const { history, historyIndex, songs } = get();
    if (historyIndex <= 0) return;
    const prevIndex = historyIndex - 1;
    const prevSong = history[prevIndex];
    set({
      songs: songs.map((s) => (s.id === prevSong.id ? prevSong : s)),
      historyIndex: prevIndex,
    });
    syncSongTables();
    // Persist the reverted state — without this, the last edit's debounced
    // save would land AFTER the undo and the undone edit resurrected on
    // reload (found 2026-09-22 while testing the workbench bars stepper:
    // +1 bar → undo → reload showed +1 again).
    get().autoSave();
  },

  redo: () => {
    const { history, historyIndex, songs } = get();
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    const nextSong = history[nextIndex];
    set({
      songs: songs.map((s) => (s.id === nextSong.id ? nextSong : s)),
      historyIndex: nextIndex,
    });
    syncSongTables();
    get().autoSave();
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  autoSave: () => {
    repository.scheduleSave(get().songs);
    const id = get().currentSongId;
    if (id) repository.writeCurrentId(id);
  },

  hydrate: async () => {
    adopt(await repository.load());
    return repository.kind;
  },
}));

/** Install a freshly loaded library: current song from the persisted pointer,
 *  falling back to the first song, with a clean undo history. */
function adopt(songs: BlueprintSong[]): void {
  const storedId = repository.readCurrentId();
  const currentSongId = songs.some((song) => song.id === storedId) ? storedId : (songs[0]?.id ?? null);
  const current = songs.find((song) => song.id === currentSongId) ?? null;
  useSongStore.setState({
    songs,
    currentSongId,
    history: current ? [current] : [],
    historyIndex: current ? 0 : -1,
  });
  syncSongTables();
}
