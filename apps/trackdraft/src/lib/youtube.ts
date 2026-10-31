/**
 * YouTube URL / search → BlueprintSong bridge.
 * Metadata + LRCLIB lyrics live here; the full audio-analysis pipeline is in
 * `lib/youtubeFullImport.ts` + `components/dashboard/ActionBar.tsx`.
 */

import { parseSyncedLyrics } from "@music-theory/song-blueprint";
import { pickLyricsMatch, searchQueries, type LyricsCandidate } from "./lyrics/lrclibMatch";
export { parseSyncedLyrics };

/**
 * Extract a YouTube video ID from various URL formats.
 */
export function extractVideoId(input: string): string | null {
  // Already a bare ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) {
    return input.trim();
  }

  // Try to parse as URL
  try {
    const url = new URL(input);
    // youtube.com/watch?v=...
    if (url.hostname.includes("youtube.com") && url.searchParams.has("v")) {
      return url.searchParams.get("v");
    }
    // youtu.be/VIDEOID
    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1);
    }
    // youtube.com/embed/VIDEOID
    if (url.hostname.includes("youtube.com") && url.pathname.startsWith("/embed/")) {
      return url.pathname.split("/embed/")[1]?.split(/[/?]/)[0] ?? null;
    }
  } catch {
    // Not a valid URL
  }

  return null;
}

interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

interface LrclibSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

/**
 * Find the lyrics for one song.
 *
 * Candidates are gathered from the fielded search, then a bare-title search,
 * and *chosen* by `pickLyricsMatch` — which requires the titles to agree, the
 * artist when one is known, and a close duration, and which refuses
 * instrumentals outright. The old version took the first result carrying
 * `syncedLyrics`, so a Mozart sonata could pick up a stranger's words; on a
 * corpus of instrumentals that is the common case, not the edge case.
 */
export async function searchLrclib(
  trackName: string,
  artistName?: string,
  duration?: number,
): Promise<LrclibResult | null> {
  const query = { title: trackName, artist: artistName, duration };
  const candidates: LyricsCandidate[] = [];

  for (const terms of searchQueries(query)) {
    try {
      const params = new URLSearchParams({ track_name: terms.trackName });
      if (terms.artistName) params.set("artist_name", terms.artistName);
      const res = await fetch(`https://lrclib.net/api/search?${params}`);
      if (!res.ok) continue;
      const results = (await res.json()) as LrclibSearchResult[];
      candidates.push(...results);
    } catch {
      // A network hiccup on one query should not lose the other.
    }
    if (pickLyricsMatch(query, candidates)) break;
  }

  const best = pickLyricsMatch(query, candidates);
  if (!best) return null;

  const match = candidates.findIndex((candidate) => candidate.trackName === best.trackName);
  const source = match >= 0 ? (candidates[match] as LrclibSearchResult) : null;

  return {
    id: source?.id ?? 0,
    trackName: best.trackName,
    artistName: best.artistName ?? "",
    albumName: source?.albumName,
    duration: best.duration,
    instrumental: false,
    plainLyrics: best.plainLyrics ?? undefined,
    syncedLyrics: best.syncedLyrics ?? undefined,
  };
}
