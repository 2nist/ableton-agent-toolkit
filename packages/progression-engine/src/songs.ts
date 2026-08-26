/**
 * Song matching for the Progression Studio: "which songs use this progression?"
 *
 * Backed by `data/song_sections.json` (built by
 * `scripts/extract_song_sections.py` from the lead-sheet corpus, laid out as
 * `Artist/Song/Section.mid`). Degrees are transposed to the section's key and
 * stored as single ASCII chars (a..l) so a progression is a short string and
 * "this section plays these chords in order" is a fast `indexOf`.
 *
 * The index is embedded in the webview gzipped (to keep the modal data: URL
 * small) and decompressed client-side; these helpers do the decode + match.
 */

/** The 12 ionian degree strings -> single chars. Must match the extractor. */
export const DEGREE_TO_CODE: Record<string, string> = {
  I: "a",
  ii: "b",
  iii: "c",
  IV: "d",
  V: "e",
  vi: "f",
  "vii°": "g",
  "♭II": "h",
  "♭III": "i",
  "♭VI": "j",
  "♭VII": "k",
  iv: "l",
};

/** The compact index shape produced by the extractor. */
export interface SongIndex {
  v: number;
  /** "Artist - Title" entries. */
  names: string[];
  sections: Array<{ n: number; d: string }>;
}

/** One matched song (deduped by name). */
export interface SongMatch {
  /** "Artist - Title". */
  name: string;
  /** The section's full degree code string. */
  code: string;
  /** How many chords the user's progression contributes vs the section's full length. */
  ratio: number;
  /** True when this is a subsequence (passing-chord) match, not a contiguous run. */
  partial?: boolean;
}

export interface SongMatchOptions {
  /** Cap on returned matches (default 20). */
  maxResults?: number;
}

/** Encode a list of degree strings to its single-char code string. */
export function encodeProgression(degrees: string[]): string {
  return degrees.map((d) => DEGREE_TO_CODE[d] ?? "").join("");
}

/** Reverse map: code char -> degree string (used to decode a matched song). */
export const CODE_TO_DEGREE: Record<string, string> = Object.fromEntries(
  Object.entries(DEGREE_TO_CODE).map(([d, c]) => [c, d]),
);

/** Decode a section's code string back to degree strings (I, ii, IV, …). */
export function decodeProgression(code: string): string[] {
  return [...code].map((c) => CODE_TO_DEGREE[c] ?? "").filter(Boolean);
}

/**
 * True if `needle` appears in `hay` as a subsequence (every char in order,
 * possibly with extra chords in between — e.g. passing chords). Contiguous
 * matches are strict; this is the "close enough" fallback.
 */
export function isSubsequence(needle: string, hay: string): boolean {
  if (needle.length === 0) return true;
  let n = 0;
  for (let h = 0; h < hay.length && n < needle.length; h++) {
    if (hay[h] === needle[n]) n++;
  }
  return n === needle.length;
}

/** Parse the compact JSON index into its object form. */
export function decodeSongIndex(json: string): SongIndex {
  return JSON.parse(json) as SongIndex;
}

/**
 * Find songs whose section progression CONTAINS the given progression —
 * first as a contiguous run (key-invariant — degrees are already relative to
 * the tonic), and if that yields nothing (or the caller opts in), falling back
 * to subsequence matches (chords appear in order but with passing/extra chords
 * between). Dedupes by song name and ranks so that tighter matches (fewer
 * extra chords in the section) come first. Each match carries the section's
 * full code so the UI can decode & load the song's actual progression.
 */
export function findMatchingSongs(
  index: SongIndex,
  degrees: string[],
  opts: SongMatchOptions = {},
): SongMatch[] {
  const maxResults = opts.maxResults ?? 20;
  const needle = encodeProgression(degrees);
  if (needle.length === 0) return [];

  const strict = needle.length > 1; // single chords match too many sections
  const seen = new Set<string>();
  const matches: SongMatch[] = [];

  const push = (section: { n: number; d: string }, partial: boolean) => {
    const name = index.names[section.n];
    if (!name || seen.has(name)) return;
    seen.add(name);
    matches.push({ name, code: section.d, ratio: needle.length / section.d.length, partial });
  };

  for (const section of index.sections) {
    if (strict && section.d.indexOf(needle) >= 0) push(section, false);
  }
  // Fall back to subsequence ("close enough") matches when we have room.
  if (matches.length < maxResults) {
    for (const section of index.sections) {
      if (matches.length >= maxResults) break;
      if (strict && section.d.indexOf(needle) >= 0) continue; // already counted
      if (isSubsequence(needle, section.d)) push(section, true);
    }
  }

  // Tighter (higher ratio) first, then alphabetical.
  matches.sort((a, b) => b.ratio - a.ratio || a.name.localeCompare(b.name));
  return matches.slice(0, maxResults);
}
