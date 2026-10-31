/**
 * Per-song harmony runs, cached by content signature.
 *
 * `StudyDesk.matchLibrary()` used to re-analyse every section of every song on
 * every section selection: ~1 s of main-thread work once the full catalogue is
 * loaded. The analysis only depends on the song, so it is cached per song and
 * warmed in the background while the Study desk is open. The same cache is
 * what the board's library scope is built from, so there is one reading of
 * "what degrees does this song play".
 */

import { analyzeSection } from "../harmony/analysis";
import { songSignature } from "./signature";
import type { BlueprintSong } from "../../types/blueprint";

export interface SectionRuns {
  sectionId: string;
  name: string;
  /** One key-invariant `degree:accidental` per harmony event. */
  degrees: string[];
  /** The derived numerals, for display. */
  romans: string[];
}

interface CacheEntry {
  signature: string;
  runs: SectionRuns[];
}

const cache = new Map<string, CacheEntry>();

export function sectionRuns(song: BlueprintSong): SectionRuns[] {
  const signature = songSignature(song);
  const cached = cache.get(song.id);
  if (cached && cached.signature === signature) return cached.runs;
  const runs = song.sections.map((section) => {
    const analysis = analyzeSection(section.chords, {
      key: section.key ?? song.key,
      scale: section.scale ?? song.scale,
      regions: section.tonicRegions,
    });
    return {
      sectionId: section.id,
      name: section.name,
      degrees: analysis.events.map((event) => `${event.degree}:${event.accidental}`),
      romans: analysis.events.map((event) => event.roman),
    };
  });
  cache.set(song.id, { signature, runs });
  return runs;
}

const WARM_CHUNK = 15;

/**
 * Pre-analyse the library in small turns so the first section click in the
 * Study desk is instant. Returns a cancel function; one bad song cannot stop
 * the rest, and already-cached songs are skipped.
 */
export function warmLibraryRuns(songs: readonly BlueprintSong[]): () => void {
  let cancelled = false;
  let index = 0;
  const step = () => {
    if (cancelled) return;
    const end = Math.min(songs.length, index + WARM_CHUNK);
    for (; index < end; index += 1) {
      try {
        sectionRuns(songs[index]!);
      } catch {
        /* a malformed song is skipped, not fatal */
      }
    }
    if (index < songs.length) setTimeout(step, 0);
  };
  setTimeout(step, 0);
  return () => {
    cancelled = true;
  };
}

/** Test helper — the cache is module state. */
export function clearLibraryRunsCache(): void {
  cache.clear();
}
