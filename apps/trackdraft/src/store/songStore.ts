import { create } from "zustand";
import { type BlueprintSong, createEmptySong } from "../types/blueprint";

const STORAGE_KEY = "trackdraft-songs";
const CURRENT_ID_KEY = "trackdraft-current-song-id";
const CLOCK_SOURCE_KEY = "trackdraft-clock-source";
const MAX_HISTORY = 50;
const AUTOSAVE_DEBOUNCE_MS = 1500;

export type ClockSource = "internal" | "ableton";

interface SongStoreState {
  songs: BlueprintSong[];
  currentSongId: string | null;
  history: BlueprintSong[];
  historyIndex: number;

  /** Persisted clock source — survives page refresh. Default "internal". */
  clockSource: ClockSource;
  setClockSource: (mode: ClockSource) => void;

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
  loadFromStorage: () => void;
}

let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;

function readStoredSongs(): BlueprintSong[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BlueprintSong[]) : [];
  } catch {
    return [];
  }
}

function persistSongs(songs: BlueprintSong[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

export const useSongStore = create<SongStoreState>((set, get) => ({
  songs: [],
  currentSongId: null,
  history: [],
  historyIndex: -1,
  clockSource: "internal",

  setClockSource: (mode) => {
    set({ clockSource: mode });
    localStorage.setItem(CLOCK_SOURCE_KEY, mode);
  },

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
    get().autoSave();
  },

  openSong: (id: string) => {
    const song = get().songs.find((s) => s.id === id);
    if (!song) return;
    set({ currentSongId: id, history: [song], historyIndex: 0 });
  },

  deleteSong: (id: string) => {
    set((state) => {
      const songs = state.songs.filter((s) => s.id !== id);
      const currentSongId = state.currentSongId === id ? null : state.currentSongId;
      return { songs, currentSongId, history: [], historyIndex: -1 };
    });
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
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  autoSave: () => {
    if (autoSaveTimeout !== null) clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
      persistSongs(get().songs);
      if (get().currentSongId) {
        localStorage.setItem(CURRENT_ID_KEY, get().currentSongId!);
      }
      autoSaveTimeout = null;
    }, AUTOSAVE_DEBOUNCE_MS);
  },

  loadFromStorage: () => {
    const songs = readStoredSongs();
    const storedCurrentId = localStorage.getItem(CURRENT_ID_KEY);
    const currentSongId = songs.some((s) => s.id === storedCurrentId) ? storedCurrentId : null;
    const current = songs.find((s) => s.id === currentSongId);
    const savedSource = localStorage.getItem(CLOCK_SOURCE_KEY);
    const clockSource: ClockSource = savedSource === "ableton" ? "ableton" : "internal";
    set({
      songs,
      currentSongId,
      history: current ? [current] : [],
      historyIndex: current ? 0 : -1,
      clockSource,
    });
  },
}));
