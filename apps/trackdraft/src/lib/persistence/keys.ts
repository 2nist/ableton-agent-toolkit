/**
 * Every durable key the app writes, in one table.
 *
 * The UI-standardisation doc claimed six keys were "the complete list" while
 * the app wrote twenty-odd. None of them was wrong on its own — that is exactly
 * how persistence drifts: each new panel invented a key next to its own state.
 *
 * The `scope` column is the decision that was missing:
 *
 *   song    — belongs to the music; must survive a reload and travel with the
 *             library (an export that drops it loses work).
 *   device  — per-machine setup (ports, folders, clock). Safe to lose on a new
 *             machine, wrong to sync between two.
 *   ui      — a view preference (zoom, open drawer, chosen tab). Losing it is
 *             an annoyance, never data loss. These are the ones to watch: if a
 *             preference starts holding something you would miss, it belongs in
 *             `song` or in a real store, not here.
 *   lab     — design surfaces outside the songwriting loop.
 *
 * `keys.test.ts` fails if a `"trackdraft-*"` literal appears outside this file
 * (and the short allow-list of non-storage names: BroadcastChannels, the
 * IndexedDB name, the popout window name, file-format tags).
 */
export type KeyScope = "song" | "device" | "ui" | "lab";

export interface StorageKeySpec {
  readonly key: string;
  readonly scope: KeyScope;
  /** The module that owns the read AND the write. */
  readonly owner: string;
}

export const STORAGE_KEYS = {
  // ---- song -------------------------------------------------------------
  songs: { key: "trackdraft-songs", scope: "song", owner: "lib/persistence/songRepository" },
  /** Desktop: the mirrored library snapshot (the live copy is IndexedDB). */
  libraryMirror: { key: "host-library", scope: "song", owner: "lib/persistence/songRepository" },
  currentSongId: { key: "trackdraft-current-song-id", scope: "song", owner: "lib/persistence/songRepository" },
  drumAnalysis: { key: "trackdraft-drum-analysis", scope: "song", owner: "lib/drumImport" },
  customPresets: { key: "trackdraft-custom-presets", scope: "song", owner: "components/harmony/PresetPicker" },
  userBeats: { key: "trackdraft-user-beats", scope: "song", owner: "lib/drums/savedBeats" },

  // ---- device -----------------------------------------------------------
  midiSettings: { key: "trackdraft-midi-settings", scope: "device", owner: "store/midiSettingsStore" },
  dawTarget: { key: "trackdraft-daw-target", scope: "device", owner: "store/dawTargetStore" },
  legacyClockSource: { key: "trackdraft-clock-source", scope: "device", owner: "store/dawTargetStore" },
  directories: { key: "trackdraft-directories", scope: "device", owner: "store/directoryStore" },
  theme: { key: "trackdraft-theme", scope: "device", owner: "store/themeStore" },
  lyricsSpark: { key: "trackdraft-lyrics-spark", scope: "device", owner: "store/lyricsSparkStore" },
  pronunciationCache: { key: "trackdraft-pronunciation-cache", scope: "device", owner: "lib/lyrics/pronouncer" },

  // ---- ui preferences ---------------------------------------------------
  timeViewport: { key: "trackdraft-time-viewport", scope: "ui", owner: "store/timeViewportStore" },
  harmonyWorkspace: { key: "trackdraft-harmony-workspace", scope: "ui", owner: "store/harmonyWorkspaceStore" },
  harmonyBarsView: { key: "trackdraft-harmony-bars-view", scope: "ui", owner: "components/harmony/workspace/ProgressionFloor" },
  harmonyFootTab: { key: "trackdraft-harmony-foot-tab", scope: "ui", owner: "components/harmony/workspace/ProgressionFloor" },
  /** Which chord lens is open (floor/map/rhythm/midi). Persisted so the lens
   *  and the desk can't disagree about whether they survive a reload. */
  harmonyChordView: { key: "trackdraft-harmony-chord-view", scope: "ui", owner: "components/harmony/workspace/ChordSurface" },
  honeycombScale: { key: "trackdraft-honeycomb-scale", scope: "ui", owner: "components/harmony/HoneycombWheel" },
  progressionLanes: { key: "trackdraft-progression-lanes", scope: "ui", owner: "components/harmony/ProgressionEditor" },
  popoutMode: { key: "trackdraft-popout-mode", scope: "ui", owner: "components/popout/LyricChordPopout" },
  workbenchRows: { key: "trackdraft-workbench-rows", scope: "ui", owner: "components/workspace/WorkbenchView" },
  /** The Study board's scopes and panels (not its filters — a stale
   *  cross-filter would hide most of the data on reopen). */
  studyBoard: { key: "trackdraft-study-board", scope: "ui", owner: "store/studyStore" },
  drumsBarsView: { key: "trackdraft-drums-bars-view", scope: "ui", owner: "components/drums/blocks/DrumBlocksView" },
  drumsStepSel: { key: "trackdraft-drums-step-sel", scope: "ui", owner: "components/drums/blocks/DrumBlocksView" },
  drumsFxSel: { key: "trackdraft-drums-fx-sel", scope: "ui", owner: "components/drums/blocks/DrumBlocksView" },
  drumsShelfOpen: { key: "trackdraft-drums-shelf-open", scope: "ui", owner: "components/drums/blocks/GrooveShelf" },

  // ---- lab --------------------------------------------------------------
  studioLogWorkshop: { key: "trackdraft-studio-log-workshop-v1", scope: "lab", owner: "pages/studio-log" },
} as const satisfies Record<string, StorageKeySpec>;

/**
 * Names that start with `trackdraft-` but are NOT storage keys. Listed here so
 * `keys.test.ts` can tell "we keep this on disk" from "this is a channel".
 */
export const NON_STORAGE_NAMES = [
  // BroadcastChannel topics — live messaging between tabs/windows.
  "trackdraft-transport",
  // IndexedDB database name and the library's BroadcastChannel topic.
  "trackdraft-library",
  // `window.open` name for the lyric/chord popout.
  "trackdraft-popout",
  // File-format tags written into exported/imported JSON.
  "trackdraft-drum-analysis",
  "trackdraft-studio-log-theme",
] as const;
