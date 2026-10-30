/** Window features for the performer's second screen — the popout is meant to
 *  be glanced at from across a room, so it opens as its own chrome-free window
 *  rather than a tab. Fixed name: opening it twice focuses the existing one. */
export const POPOUT_WINDOW_NAME = "trackdraft-popout";
export const POPOUT_WINDOW_FEATURES = "width=900,height=560,menubar=no,toolbar=no,location=no,status=no";

/** Route of the lyrics/chords popout for a song. Absolute (not relative) so
 *  it never depends on which song route the opener happens to be on. */
export function lyricChordPopoutUrl(songId: string): string {
  return `/song/${songId}/popout`;
}

/** Open (or focus) the lyrics/chords popout. Returns null when the browser
 *  blocked it — `window.open` from a click is allowed, but a programmatic
 *  call after an await is not, so callers should invoke this straight from
 *  the handler. */
export function openLyricChordPopout(songId: string): Window | null {
  return window.open(lyricChordPopoutUrl(songId), POPOUT_WINDOW_NAME, POPOUT_WINDOW_FEATURES);
}
