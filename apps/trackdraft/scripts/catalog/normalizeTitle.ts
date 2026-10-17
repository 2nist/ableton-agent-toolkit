/** Both the chord corpus files and LRCLIB's own matched trackName carry
 *  a leading track number in inconsistent formats ("02 - Misery",
 *  "01 Come Together"), and double-disc albums (the White Album) prefix
 *  a disc label too ("CD1 - 03 - Glass_Onion") — strip both, then
 *  normalize punctuation/case so the two independently-named sources can
 *  be joined by title text. Confirmed against real files: without the
 *  CD-prefix strip, every White Album track silently failed to match
 *  its real, present LRCLIB entry.
 *
 *  NUMERIC-TITLE GUARD (2026-09): plain "starts with digits" stripping
 *  destroyed numeric song titles — "1999" became "", "50 Ways To Leave
 *  Your Lover" became "Ways...", "20-75" became "75". Only strip forms
 *  that are unambiguously track numbers: a leading-zero number ("01 "),
 *  or digits with a separator AND a letter following ("02 - Misery"). */
export function normalizeTitle(title: string): string {
  return title
    .replace(/^CD\s*\d+\s*[-_]*\s*/i, "")
    .replace(/^0\d+[\s_-]+(?=[A-Za-z])/, "")
    .replace(/^\d+[\s-]*[-_][\s-]*(?=[A-Za-z])/, "")
    .replace(/[_-]/g, " ")
    // LRCLIB track names routinely use Unicode smart-quote / acute-accent
    // characters for apostrophes (U+00B4, U+0060 backtick, U+2018/U+2019
    // single smart quotes, U+201a, and even U+0019).  Normalize all of
    // them to a plain ASCII apostrophe before stripping punctuation, so
    // "you´re" === "you're" and both match.
    .replace(/[\u00B4\u0060\u2018\u2019\u201a\u0019#]+/g, "'")
    .replace(/[.,!?'"()]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips the same CD-disc/track-number prefixes as normalizeTitle (with
 *  the same numeric-title guard), but keeps case and turns underscores
 *  into spaces for a real display title — "CD1 - 03 - Glass_Onion" ->
 *  "Glass Onion", while "1999" and "20-75" stay intact. */
export function cleanDisplayTitle(title: string): string {
  return title
    .replace(/^CD\s*\d+\s*[-_]*\s*/i, "")
    .replace(/^0\d+[\s_-]+(?=[A-Za-z])/, "")
    .replace(/^\d+[\s-]*[-_][\s-]*(?=[A-Za-z])/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}