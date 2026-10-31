import { create } from "zustand";
import { type BlueprintSong, createEmptySong } from "../types/blueprint";
import { createSongRepository, type LibraryLoadInfo, type SongRepositoryKind } from "../lib/persistence/songRepository";
import { applySongTables } from "../lib/dataFiles";

const MAX_HISTORY = 50;

interface SongStoreState {
  songs: BlueprintSong[];
  currentSongId: string | null;
  history: BlueprintSong[];
  historyIndex: number;
  /** What the last hydrate found beyond the songs — null until it runs, and
   *  always null in a browser (there are no per-song files to fail). */
  loadInfo: LibraryLoadInfo | null;
  /**
   * False until the repository's first load has been adopted. Reading the
   * browser library from IndexedDB spans real event-loop turns (localStorage
   * resolved in one microtask), so a song route would otherwise paint
   * "Song not found" for a frame on every reload.
   */
  hydrated: boolean;

  currentSong: () => BlueprintSong | null;

  createNewSong: (title: string) => BlueprintSong;
  importSong: (song: BlueprintSong) => void;
  openSong: (id: string) => void;
  deleteSong: (id: string) => void;
  updateCurrentSong: (updater: (song: BlueprintSong) => BlueprintSong) => void;
  /**
   * Apply an edit WITHOUT adding a step to the undo history — for continuous
   * gestures (a hardware encoder sweep, a knob drag) where one physical
   * movement produces dozens of values. Pushing each one collapsed the whole
   * 50-deep history in a single twist, so "undo" after nudging a tempo
   * encoder could not get back to what you were doing before it.
   *
   * The entry the gesture started from is preserved, so ONE undo returns to
   * the pre-gesture state.
   */
  updateCurrentSongTransient: (
    updater: (song: BlueprintSong) => BlueprintSong,
    /** Identifies the gesture — a second detent of the SAME encoder folds
     *  into the same undo step; a different control starts a new one. */
    gesture: string,
  ) => void;

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
  /**
   * Take a change another tab wrote. Several tabs on one origin (a song open
   * in two views is the common case) each hold their own snapshot, so without
   * this the tab that happened to save last silently won.
   *
   * Refused while this tab has an unpersisted edit: refreshing under someone's
   * typing would throw it away, and this tab's own write is about to land.
   */
  applyExternalChange: (ids: string[]) => Promise<void>;
}

/** Where the library lives. Chosen once, at module load, so no store action
 *  has to ask whether it is running in the desktop shell. */
const repository = createSongRepository();

/** The gesture a transient run is currently folding into (see
 *  `updateCurrentSongTransient`). Cleared by anything that is a step of its
 *  own, so the next gesture starts a fresh undo entry. */
let activeGesture: { key: string; historyIndex: number } | null = null;

function resetGesture(): void {
  activeGesture = null;
}

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
  loadInfo: null,
  hydrated: false,
  currentSong: () => {
    const { songs, currentSongId } = get();
    return songs.find((s) => s.id === currentSongId) ?? null;
  },

  createNewSong: (title: string) => {
    resetGesture();
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
    resetGesture();
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
    resetGesture();
    const song = get().songs.find((s) => s.id === id);
    if (!song) return;
    set({ currentSongId: id, history: [song], historyIndex: 0 });
    syncSongTables();
  },

  deleteSong: (id: string) => {
    resetGesture();
    set((state) => {
      const songs = state.songs.filter((s) => s.id !== id);
      const currentSongId = state.currentSongId === id ? null : state.currentSongId;
      return { songs, currentSongId, history: [], historyIndex: -1 };
    });
    syncSongTables();
    get().autoSave();
  },

  updateCurrentSong: (updater) => {
    resetGesture();
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

  updateCurrentSongTransient: (updater, gesture) => {
    const { songs, currentSongId, history, historyIndex } = get();
    const current = songs.find((s) => s.id === currentSongId);
    if (!current) return;

    const updated = { ...updater(current), updatedAt: new Date().toISOString() };
    const songsNext = songs.map((s) => (s.id === updated.id ? updated : s));

    // The first detent of a gesture PUSHES a step (so the pre-gesture state
    // stays undoable); every later detent of the same gesture REPLACES the
    // tip, so one twist is one undo. Without the marker, replacing the tip
    // would swallow the last committed edit instead.
    const continuing = activeGesture?.key === gesture && activeGesture.historyIndex === historyIndex;
    const historyNext = (
      continuing
        ? [...history.slice(0, historyIndex), updated]
        : [...history.slice(0, historyIndex + 1), updated]
    ).slice(-MAX_HISTORY);

    set({
      songs: songsNext,
      history: historyNext,
      historyIndex: historyNext.length - 1,
    });
    activeGesture = { key: gesture, historyIndex: historyNext.length - 1 };
    syncSongTables();
    get().autoSave();
  },

  undo: () => {
    resetGesture();
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
    resetGesture();
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
    set({ loadInfo: repository.lastLoad() });
    return repository.kind;
  },

  applyExternalChange: async (ids) => {
    if (ids.length === 0 || repository.hasPendingWrite()) return;
    const fresh = await repository.readSongs(ids);
    const freshById = new Map(fresh.map((song) => [song.id, song]));
    const deleted = new Set(ids.filter((id) => !freshById.has(id)));
    if (freshById.size === 0 && deleted.size === 0) return;

    const { songs, currentSongId } = get();
    const known = new Set(songs.map((song) => song.id));
    // A song created in the other tab is news this tab has never seen; without
    // this it stayed invisible until a reload.
    const additions = fresh.filter((song) => !known.has(song.id));
    const nextSongs = [
      ...songs.filter((song) => !deleted.has(song.id)).map((song) => freshById.get(song.id) ?? song),
      ...additions,
    ];

    if (currentSongId != null && deleted.has(currentSongId)) {
      // The open song was removed in another tab; fall back the way a load would.
      adopt(nextSongs);
      return;
    }
    const refreshedCurrent = currentSongId != null ? freshById.get(currentSongId) : undefined;
    if (refreshedCurrent) {
      // Undo entries above this point describe the pre-change lineage, so the
      // history restarts here rather than letting an undo resurrect old content.
      set({ songs: nextSongs, history: [refreshedCurrent], historyIndex: 0 });
      resetGesture();
    } else {
      set({ songs: nextSongs });
    }
    syncSongTables();
  },
}));

/** Changes another tab makes land here. Subscribed once, at module load, so no
 *  component has to know that more than one tab may exist. */
repository.subscribeExternalChanges((ids) => {
  void useSongStore.getState().applyExternalChange(ids);
});

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
  resetGesture();
  syncSongTables();
}
