/**
 * YouTube URL / search → BlueprintSong bridge.
 * Phase 1: metadata + LRCLIB lyrics (no audio analysis deps).
 * Phase 2 (future): full ChordMiniApp audio analysis pipeline.
 */

import type { BlueprintSong } from "../types/blueprint";
import type { LyricsTimelineEntry } from "@music-theory/song-blueprint";
import { parseSyncedLyrics } from "@music-theory/song-blueprint";
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

/** Search LRCLIB by track + artist. Returns best match with synced lyrics. */
export async function searchLrclib(
  trackName: string,
  artistName?: string,
): Promise<LrclibResult | null> {
  try {
    const params = new URLSearchParams({ track_name: trackName });
    if (artistName) params.set("artist_name", artistName);

    const res = await fetch(`https://lrclib.net/api/search?${params}`);
    if (!res.ok) return null;

    const results: LrclibSearchResult[] = await res.json();
    if (results.length === 0) return null;

    // Prefer results with synced lyrics
    const synced = results.find((r) => r.syncedLyrics);
    const best = synced ?? results[0];

    return {
      id: best.id,
      trackName: best.trackName,
      artistName: best.artistName,
      albumName: best.albumName,
      duration: best.duration,
      instrumental: best.instrumental,
      plainLyrics: best.plainLyrics,
      syncedLyrics: best.syncedLyrics,
    };
  } catch {
    return null;
  }
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
 * Fetch YouTube video metadata via our Vite endpoint.
 */
export async function fetchYoutubeMetadata(videoId: string): Promise<YoutubeMetadata | null> {
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