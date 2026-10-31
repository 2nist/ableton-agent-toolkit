/**
 * Searching LRCLIB by hand.
 *
 * The importer's automatic lookup picks one record and says nothing — which
 * is right for an unattended import and useless when it picks wrong ("that's
 * a cover") or picks nothing ("this song is definitely on LRCLIB"). This
 * module returns the whole pool, in two piles: the records the conservative
 * matcher accepts, and the ones it refused with the reason it refused them.
 * The user then decides — including overruling the matcher, which is the
 * entire point of a hand-run search.
 *
 * It shares `lrclibMatch`'s scoring with the importer, so the panel's
 * "usable" verdict and the import's silent choice cannot disagree.
 */

import {
  normalizeForMatch,
  scoreCandidate,
  searchQueries,
  DURATION_TOLERANCE_S,
  type LyricsCandidate,
  type LyricsQuery,
  type ScoredCandidate,
} from "./lrclibMatch";

/** A record as LRCLIB returns it: a candidate that definitely has an id. */
export interface LrclibRecord extends LyricsCandidate {
  id: number;
  albumName?: string;
}

export interface RejectedRecord {
  scored: ScoredCandidate;
  /** Plain words for a person: why the matcher would not pick this one. */
  reason: string;
}

export interface LrclibSearchOutcome {
  query: LyricsQuery;
  /** True when LRCLIB was shedding load (`ServerOverloaded`) and we gave up.
   *  That is *their* capacity, not a bad request and not our network — the
   *  panel says so instead of implying the search was wrong. */
  busy: boolean;
  /** The terms the ladder would try, in order. */
  queries: { trackName: string; artistName?: string }[];
  /** How many of those actually went out — the early stop means this can be
   *  fewer, and a summary that says "2 queries sent" when one was would be
   *  lying about the request count the user is paying for. */
  sent: number;
  /** Accepted by the matcher, best first. */
  accepted: ScoredCandidate[];
  /** Refused, best first, each with the reason. */
  rejected: RejectedRecord[];
  /** Network/HTTP failure — distinct from "nothing matched". */
  error: string | null;
  /** True when LRCLIB answered but nothing at all came back. */
  empty: boolean;
}

/** Title agreement the matcher requires before it will pick a record at all. */
const MIN_TITLE_SCORE = 0.86;

/** LRCLIB's search endpoint sheds load when its index permits are exhausted:
 *  it answers `503 {"name":"ServerOverloaded"}` with `retry-after: 1`. That is
 *  transient — measured at 503 on a cold query and 200 four times in a row
 *  1.2 s later — so a search worth making is worth retrying. */
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MS = 400;

/** `retry-after` is either seconds or an HTTP date; we only ever see seconds. */
function retryAfterMs(response: { headers?: { get?: (name: string) => string | null } }): number {
  const raw = response.headers?.get?.("retry-after");
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(3000, seconds * 1000) : DEFAULT_RETRY_MS;
}

async function fetchSearch(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; busy: boolean; status: number; records: LrclibRecord[]; message?: string }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        const payload = await response.json();
        return { ok: true, busy: false, status: response.status, records: Array.isArray(payload) ? (payload as LrclibRecord[]) : [] };
      }
      // 503 = their overload (or a Cloudflare shield); 429 = explicit throttle.
      const shed = response.status === 503 || response.status === 429;
      if (shed && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response as never)));
        continue;
      }
      return { ok: false, busy: shed, status: response.status, records: [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, DEFAULT_RETRY_MS * attempt));
        continue;
      }
      // Keep the reason: "Failed to fetch" and a CSP block read the same to a
      // user, and the panel shows this string verbatim.
      return { ok: false, busy: false, status: 0, records: [], message };
    }
  }
  return { ok: false, busy: true, status: 503, records: [] };
}

/** Why `scored` would not be picked, or null when it would. */
export function rejectionReason(scored: ScoredCandidate, query: LyricsQuery): string | null {
  const record = scored.candidate;
  if (record.instrumental) return "marked instrumental — no words to attach";
  if (!record.syncedLyrics && !record.plainLyrics) return "record carries no lyrics";
  if (scored.titleScore < MIN_TITLE_SCORE) {
    return `title differs from "${query.title}"`;
  }
  if (!scored.artistAgrees) {
    return `different artist (${record.artistName || "unknown"})`;
  }
  if (!scored.durationAgrees) {
    const gap = Math.abs((query.duration ?? 0) - (record.duration ?? 0));
    return `duration is ${Math.round(gap)}s off (tolerance ${DURATION_TOLERANCE_S}s)`;
  }
  return null;
}

/**
 * Run the hand search.
 *
 * Same query ladder as the importer: fielded (title + artist) first, then the
 * bare title — a record filed under a slightly different artist still shows
 * up, which is exactly the case the user is here to rescue.
 */
export async function searchLrclibRecords(
  query: LyricsQuery,
  fetchImpl: typeof fetch = fetch,
  /** Narrow by album — LRCLIB indexes it, and it is the one handle left when
   *  the title in the song is wrong but you know the record it came from. */
  albumName?: string,
): Promise<LrclibSearchOutcome> {
  const queries = searchQueries(query);
  const seen = new Map<number, LrclibRecord>();
  let error: string | null = null;
  let busy = false;
  let sent = 0;

  for (const terms of queries) {
    const params = new URLSearchParams({ track_name: terms.trackName });
    if (terms.artistName) params.set("artist_name", terms.artistName);
    if (albumName?.trim()) params.set("album_name", albumName.trim());

    sent += 1;
    const result = await fetchSearch(`https://lrclib.net/api/search?${params.toString()}`, fetchImpl);
    if (result.busy) busy = true;
    if (!result.ok) {
      error = result.busy ? "busy" : result.status ? `LRCLIB answered ${result.status}` : (result.message ?? "network");
      continue;
    }
    for (const record of result.records) {
      if (typeof record?.id === "number" && !seen.has(record.id)) seen.set(record.id, record);
    }

    // One query is enough when it already produced something the matcher
    // trusts: every extra request is another chance to meet the overload
    // above, and the bare-title pass only exists to rescue a *failed* fielded
    // search.
    const acceptedSoFar = [...seen.values()]
      .map((record) => scoreCandidate(query, record))
      .some((scored) => rejectionReason(scored, query) === null);
    if (acceptedSoFar) break;
  }

  const scored = [...seen.values()]
    .map((record) => scoreCandidate(query, record))
    .sort((a, b) => b.score - a.score);

  const accepted: ScoredCandidate[] = [];
  const rejected: RejectedRecord[] = [];
  for (const entry of scored) {
    const reason = rejectionReason(entry, query);
    if (reason) rejected.push({ scored: entry, reason });
    else accepted.push(entry);
  }

  return {
    query,
    queries,
    sent,
    accepted,
    rejected,
    busy,
    // Records in hand beat any error: a second query failing is not worth
    // telling the user about when the first one answered.
    error: scored.length > 0 ? null : error,
    empty: scored.length === 0 && error === null,
  };
}

/** `3:25` — durations are how a person tells two recordings apart. */
export function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Records whose words contain `phrase`, best first.
 *
 * LRCLIB has no lyric search — its index covers track, artist and album names
 * only (`server/src/search_index.rs`, fields `name_lower` / `artist_name_lower`
 * / `album_name_lower`), so "find the song with these words" cannot be a
 * query. It can be a *filter*: fetch the pool by whatever you do know — a
 * title fragment, the artist, the album — then keep the records whose own
 * lyrics contain the line you remember. That is how you tell the studio take
 * from the live one when both are called the same thing.
 */
export function filterByLyricLine<T extends { plainLyrics?: string | null; syncedLyrics?: string | null }>(
  records: readonly T[],
  phrase: string,
): T[] {
  // Apostrophes are dropped *before* normalising: people type "lets" for
  // "Let's" when recalling a line, and the shared normaliser would otherwise
  // turn the printed form into "let s" and miss it.
  const fold = (text: string) => normalizeForMatch(text.replace(/['\u2019]/g, ""));
  const needle = fold(phrase);
  if (!needle) return [...records];
  return records.filter((record) => {
    const haystack = `${record.plainLyrics ?? ""}\n${record.syncedLyrics ?? ""}`;
    return fold(haystack).includes(needle);
  });
}
