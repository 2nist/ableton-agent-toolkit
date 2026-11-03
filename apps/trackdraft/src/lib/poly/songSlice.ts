/**
 * The slice of a song a canvas column actually reads (§S1.6).
 *
 * `PolyColumn` is memoised, and it was passed the **whole song**. Every column
 * therefore received a new object whenever *any* section changed, so editing one
 * bar re-rendered every visible column — the memo was structurally correct and
 * practically useless, for the second time in this spike (§S1.5 was the first).
 *
 * A column reads eight song-level fields (the key and mode the numerals are read
 * in, the tempo and title the groove is seeded from, and the Bend/narrative
 * settings) plus **its own** section. Those eight are what a column should
 * depend on, and they change far less often than "the song".
 *
 * Kept pure and boring on purpose: a stable reference from `useMemo` over these
 * fields is the whole mechanism.
 */

import type { BlueprintSong } from "../../types/blueprint";

/** Everything the lane planners and the numerical analysis read from the song. */
export type PolySongSlice = Pick<
  BlueprintSong,
  "key" | "scale" | "bpm" | "title" | "concept" | "notes" | "bend" | "genre"
>;

/** The eight fields, as a plain object. Extract, don't clone deeply — the
 *  nested values (`bend`, `notes`) keep their own identity, which is what a
 *  column's memo compares. */
export function polySongSlice(
  song: Pick<BlueprintSong, keyof PolySongSlice>,
): PolySongSlice {
  return {
    key: song.key,
    scale: song.scale,
    bpm: song.bpm,
    title: song.title,
    concept: song.concept,
    notes: song.notes,
    bend: song.bend,
    genre: song.genre,
  };
}

/** The fields a slice is built from — `useMemo`'s dependency list, named once so
 *  a field added to `PolySongSlice` cannot be forgotten at the call site. */
export const POLY_SONG_SLICE_FIELDS = [
  "key",
  "scale",
  "bpm",
  "title",
  "concept",
  "notes",
  "bend",
  "genre",
] as const satisfies readonly (keyof PolySongSlice)[];

/**
 * Does a slice need rebuilding for this song?
 *
 * The comparison `useMemo` would do, written down where a test can reach it —
 * "editing a section does not invalidate the slice" is the entire point of the
 * exercise, and it should not be provable only by profiling.
 */
export function sliceWouldChange(
  slice: PolySongSlice | null,
  song: PolySongSlice,
): boolean {
  if (!slice) return true;
  return POLY_SONG_SLICE_FIELDS.some((field) => slice[field] !== song[field]);
}
