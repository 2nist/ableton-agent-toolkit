/** Pure timeline helpers for the lyric/chord popout — kept free of any
 *  React/router imports so they're trivially unit-testable. */

/** Which lyric line is current, given how far into the section we are.
 *  `startBeat` entries are strictly increasing (ingestion-produced), so
 *  the current line is the last one whose startBeat has passed. Returns
 *  -1 before the first line or when there's no timeline data at all. */
export function currentLineIndex(timeline: { startBeat: number }[] | undefined, beatInSection: number): number {
  if (!timeline || timeline.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].startBeat > beatInSection) break;
    idx = i;
  }
  return idx;
}

/** `lyricsTimeline.startBeat` is stored in GLOBAL song beats — every
 *  producer (LRCLIB/YouTube ingestion in `parsers/index.ts` and
 *  `youtube.ts`, the catalog build in `scripts/catalog/toBlueprintSong.ts`,
 *  and the song-blueprint adapters/assembler) keeps absolute timestamps and
 *  never re-baselines to the section, so a verse's entries land at e.g.
 *  11.6, 19.5, 27.4… while the popout's playhead is section-relative.
 *  Re-base to section-relative so line selection and chord grouping line up
 *  with `beatInSection` and the 0-based chord slots. Entries can land a
 *  hair before the section start (ingestion uses raw audio boundaries,
 *  playback uses snapped whole bars) — that just lights the first line as
 *  soon as the section begins, which is the right feel. */
export function rebaseLyricsTimeline(
  timeline: { text: string; startBeat: number }[] | undefined,
  sectionStartBeat: number,
): { text: string; startBeat: number }[] {
  return (timeline ?? []).map((line) => ({ text: line.text, startBeat: line.startBeat - sectionStartBeat }));
}
