/**
 * What a song route shows while the library is still being read.
 *
 * A deep link — or a reload on `/song/:id/poly` — mounts the route before
 * `hydrate()` has come back, so `songs` is empty and `currentSongId` is null
 * for the first few hundred milliseconds (longer on the desktop library, which
 * reads files through the host bridge). The shell used to `return null` for
 * that window: a genuinely blank page, with no spine, no rail and no hint that
 * anything was coming. Worse, the layout rendered its `<Outlet/>` as soon as
 * the *route's* song was in `songs`, one commit before the effect that calls
 * `openSong` — so the first paint of a deep link could show the previously
 * open song under the route's title.
 *
 * Both are the same question, asked once: is the route ready to draw? Three
 * facts answer it, and the ordering between them is the decision.
 */
export type SongOpeningState = "opening" | "missing" | "ready";

export interface SongOpeningFacts {
  /** `hydrate()` has installed the library at least once. */
  hydrated: boolean;
  /** The route's id is in `songs`. */
  routedSongExists: boolean;
  /** The store has opened the route's song — `currentSongId === songId`. */
  routedIsCurrent: boolean;
}

export function songOpeningState({
  hydrated,
  routedSongExists,
  routedIsCurrent,
}: SongOpeningFacts): SongOpeningState {
  if (routedSongExists && routedIsCurrent) return "ready";
  // Never claim a song is missing before the library has been read: the
  // "not found" panel is a lie the user sees flash by on every deep link.
  if (!hydrated) return "opening";
  // Hydrated and the id is unknown — the song really is not in this library.
  if (!routedSongExists) return "missing";
  // In the library but not opened yet: the layout's effect is one commit
  // behind, and drawing the outlet now would draw the *previous* song.
  return "opening";
}

export interface SongOpeningCopy {
  title: string;
  detail: string;
}

export function songOpeningCopy(
  state: SongOpeningState,
): SongOpeningCopy | null {
  switch (state) {
    case "ready":
      return null;
    case "opening":
      return { title: "Opening…", detail: "Reading the song library." };
    case "missing":
      return {
        title: "Song not found.",
        detail:
          "It may have been deleted, or the link may point at another library.",
      };
  }
}
