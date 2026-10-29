/**
 * YouTube URL / search → BlueprintSong bridge.
 * Metadata + LRCLIB lyrics live here; the full audio-analysis pipeline is in
 * `lib/youtubeFullImport.ts` + `components/dashboard/ActionBar.tsx`.
 */

import { getHost } from "./host";
import type { BlueprintSong } from "../types/blueprint";
import { parseSyncedLyrics } from "@music-theory/song-blueprint";
import { pickLyricsMatch, searchQueries, type LyricsCandidate } from "./lyrics/lrclibMatch";
export { parseSyncedLyrics };

interface YoutubeMetadata {
  title: string;
  artist?: string;
  videoId: string;
}

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

/** Get a specific LRCLIB entry by ID (for fetching synced lyrics after search). */
export async function getLrclibById(id: number): Promise<LrclibResult | null> {
  try {
    const res = await fetch(`https://lrclib.net/api/get/${id}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * YouTube video metadata.
 *
 * Desktop gets it from the main process (there is no dev server to ask); the
 * browser build still uses the Vite endpoint.
 */
export async function fetchYoutubeMetadata(videoId: string): Promise<YoutubeMetadata | null> {
  const host = getHost();
  if (host) {
    try {
      return await host.youtubeMeta(videoId);
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(`/__youtube-meta?videoId=${encodeURIComponent(videoId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Build a BlueprintSong from YouTube + LRCLIB data.
 */
export function buildYoutubeBlueprintSong(
  metadata: YoutubeMetadata,
  lrclib: LrclibResult | null,
): BlueprintSong {
  const now = new Date().toISOString();
  const title = metadata.title || lrclib?.trackName || `YouTube: ${metadata.videoId}`;
  const artist = metadata.artist || lrclib?.artistName;
  const sectionId = crypto.randomUUID();

  const song: BlueprintSong = {
    id: crypto.randomUUID(),
    title,
    artist,
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [],
    arrangement: [],
    concept: lrclib ? `YouTube import with synced lyrics` : `YouTube import: ${metadata.videoId}`,
    provenance: {
      source: "docx-ingest",
      extractedAt: now,
      warnings: [
        "YouTube metadata only — audio analysis pending.",
        "BPM and key are defaults — run ChordMiniApp or manual analysis to refine.",
      ],
    },
    createdAt: now,
    updatedAt: now,
  };

  // If we have synced lyrics, create a section with timeline
  if (lrclib?.syncedLyrics) {
    const timeline = parseSyncedLyrics(lrclib.syncedLyrics, song.bpm);
    const fullText = lrclib.plainLyrics || timeline.map((t) => t.text).join("\n");

    song.sections.push({
      id: sectionId,
      name: "Full Song",
      role: "verse",
      bars: Math.max(16, Math.ceil(timeline.length / 4)),
      chords: [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
      lyrics: fullText,
      lyricsTimeline: timeline.map((t) => ({
        text: t.text,
        startBeat: t.startBeat,
      })),
    });

    song.arrangement.push({ sectionId, repeats: 1 });
  }

  return song;
}