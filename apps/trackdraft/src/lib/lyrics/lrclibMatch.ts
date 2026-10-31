/**
 * Choosing the right LRCLIB record.
 *
 * The importer used to take the first search result that happened to have
 * `syncedLyrics`, with no check that it was the same song. On a pop catalogue
 * that mostly works; on the corpora this app now imports it is actively wrong:
 * "Piano Sonata no. 14 in C minor" or "ABBA Dancing Queen 1976" will match
 * *something*, and attaching a stranger's lyrics is worse than attaching none.
 *
 * The rules here are the conservative ones the offline scripts already use —
 * normalise, require the titles to actually agree, require the artist when it
 * is known, and require the durations to be close — plus one the app needs and
 * the scripts never did: **an instrumental has no lyrics to attach**, however
 * good the match looks.
 */

export interface LyricsQuery {
  title: string;
  artist?: string;
  /** Seconds, when known. */
  duration?: number;
}

export interface LyricsCandidate {
  /** LRCLIB's own record id, when the candidate came from the API — the
   *  stable key for deduping two queries that return the same record. */
  id?: number;
  trackName: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

/** Durations within this many seconds count as the same recording. */
export const DURATION_TOLERANCE_S = 12;
/** How well a title must agree before a candidate is considered at all. */
const MIN_TITLE_SCORE = 0.86;

/** Lowercase, strip punctuation and bracketed asides, collapse whitespace. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:[^)]*)\)|\[[^\]]*\]/g, " ")
    .replace(/\b(feat|ft|featuring)\.?\s+[^,]+/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the\s+/, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Token overlap (Jaccard) plus a bonus when one title contains the other. */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = union === 0 ? 0 : shared / union;

  const containment =
    left.includes(right) || right.includes(left)
      ? Math.min(left.length, right.length) / Math.max(left.length, right.length)
      : 0;
  return Math.max(jaccard, containment);
}

/** An artist string that tells us nothing — corpora are full of these. */
export function isUnknownArtist(artist: string | undefined): boolean {
  if (!artist) return true;
  const normal = normalizeForMatch(artist);
  return (
    normal === "" ||
    normal === "unknown artist" ||
    normal === "unknown" ||
    normal === "various artists" ||
    normal === "traditional"
  );
}

export interface ScoredCandidate {
  candidate: LyricsCandidate;
  titleScore: number;
  artistAgrees: boolean;
  durationAgrees: boolean;
  /** Total order for comparing candidates. */
  score: number;
}

/** Score one candidate against the query. */
export function scoreCandidate(query: LyricsQuery, candidate: LyricsCandidate): ScoredCandidate {
  const titleScore = titleSimilarity(query.title, candidate.trackName);
  const artistAgrees =
    isUnknownArtist(query.artist) ||
    isUnknownArtist(candidate.artistName) ||
    titleSimilarity(query.artist!, candidate.artistName!) >= 0.6;
  const durationGap =
    query.duration != null && candidate.duration != null
      ? Math.abs(query.duration - candidate.duration)
      : null;
  const durationAgrees = durationGap == null || durationGap <= DURATION_TOLERANCE_S;
  // Within tolerance, closer is better — a 141 s recording beats a 150 s one.
  const durationBonus =
    durationGap == null ? 0 : 0.1 * Math.max(0, 1 - durationGap / DURATION_TOLERANCE_S);

  // Lyrics are the whole point: a record without any is worth far less than
  // one with line timing, which is worth more than plain text.
  const lyricsBonus = candidate.syncedLyrics ? 0.25 : candidate.plainLyrics ? 0.1 : 0;

  return {
    candidate,
    titleScore,
    artistAgrees,
    durationAgrees,
    score:
      titleScore + (artistAgrees ? 0.15 : -0.35) + (durationAgrees ? durationBonus : -0.4) + lyricsBonus,
  };
}

/**
 * The best candidate, or `null` when nothing is trustworthy.
 *
 * Disqualifiers, in order: the title does not agree, the artist disagrees, the
 * duration is far off, the record is marked instrumental, or it carries no
 * lyrics at all.
 */
export function pickLyricsMatch(
  query: LyricsQuery,
  candidates: LyricsCandidate[],
): LyricsCandidate | null {
  const usable = candidates
    .filter((candidate) => !candidate.instrumental)
    .filter((candidate) => candidate.syncedLyrics || candidate.plainLyrics)
    .map((candidate) => scoreCandidate(query, candidate))
    .filter(
      (scored) =>
        scored.titleScore >= MIN_TITLE_SCORE && scored.artistAgrees && scored.durationAgrees,
    )
    .sort((a, b) => b.score - a.score);

  return usable[0]?.candidate ?? null;
}

/** The search terms worth trying, most specific first. */
export function searchQueries(query: LyricsQuery): { trackName: string; artistName?: string }[] {
  const clean = query.title
    .replace(/\((?:[^)]*)\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const queries: { trackName: string; artistName?: string }[] = [];
  if (!isUnknownArtist(query.artist)) {
    queries.push({ trackName: clean, artistName: query.artist! });
  }
  queries.push({ trackName: clean });
  return queries;
}
