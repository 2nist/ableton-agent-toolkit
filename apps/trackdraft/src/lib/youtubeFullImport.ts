/**
 * YouTube → BlueprintSong full import pipeline — chord parsing and assembly
 * logic shared between the ActionBar browser component and the
 * ChordMiniApp CLI bridge script.
 *
 * All actual conversion logic lives in @music-theory/song-blueprint/adapters.ts
 * (single source of truth). This file only re-exports for compatibility with
 * existing import paths in the TrackDraft app and its test suite.
 */

export {
  parseChordName,
  parseSyncedLyrics,
  chordMiniAppToBlueprintSong,
  assembleBlueprint,
} from "@music-theory/song-blueprint";

export type {
  ChordMiniAppResult,
  LrclibData,
} from "@music-theory/song-blueprint";
