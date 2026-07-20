import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { matchLyrics, parseLrc } from "@music-theory/song-taxonomy";
import { buildLyricDocument, detectRepeatedBlocks } from "./sectionize";
import type { BlueprintSong } from "../../types/blueprint";

/**
 * Ground-truth validation for the chorus-detection assist, gated on the
 * McGill Billboard/SALAMI corpus being present on disk (local research
 * data, not checked into the repo — skipped rather than failed if absent).
 *
 * This is the payoff of pooling the corpora's own `lyrics_from_lrclib`
 * lyrics: 739 songs carry human-annotated section windows AND, for ~94%
 * of them, aligned real lyrics. That combination makes it possible to
 * measure the detector against reality instead of trusting the synthetic
 * fixtures in sectionize.test.ts — simulating exactly the situation the
 * editor exists for (all of a song's lyrics in one blob, no section
 * boundaries) and checking whether the detector's repeated blocks land on
 * the real, human-annotated Chorus windows.
 */
const MCGILL_ROOT = process.env.MCGILL_ROOT ?? "/Users/Matthew/mcgill_jcrd_salami_Billboard";
const corpusAvailable = existsSync(MCGILL_ROOT);
const SAMPLE_SIZE = 150;

/**
 * McGill's section windows and LRCLIB's lyric sync are two independently
 * produced timestamp sources for the same recording — measured directly:
 * with no tolerance, 33/71 eligible songs hit; allowing a lyric line to
 * land up to 3s outside the annotated window recovers 11 more (44/71,
 * 62%), which is cross-dataset clock slop, not detector error. This
 * tolerance is a property of the comparison in this test, not of
 * `detectRepeatedBlocks` itself, which only ever reasons about line
 * positions and text — it has no notion of "close enough in time".
 */
const WINDOW_TOLERANCE_SEC = 3;

interface McgillSection {
  start_ms: number;
  duration_ms: number;
  sectionType?: string;
}
interface McgillSong {
  title: string;
  artist: string;
  sections: McgillSection[];
}

function loadLyricCandidates(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const r = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
        return r.syncedLyrics
          ? { title: r.trackName ?? r.name ?? "", artist: r.artistName ?? "", syncedLyrics: r.syncedLyrics as string }
          : null;
      } catch {
        return null;
      }
    })
    .filter((c): c is { title: string; artist: string; syncedLyrics: string } => c !== null);
}

describe.skipIf(!corpusAvailable)("chorus-detection accuracy against McGill ground truth", () => {
  it("finds detected repeated blocks overlapping real annotated Chorus windows", () => {
    const lyricCandidates = loadLyricCandidates(path.join(MCGILL_ROOT, "lyrics_from_lrclib"));
    const files = readdirSync(MCGILL_ROOT)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(0, SAMPLE_SIZE);

    let eligible = 0; // songs with >=2 real Chorus windows AND a lyric match
    let hits = 0; // of those, detector found a block overlapping >=2 distinct Chorus windows
    let noBlockFound = 0; // detector found no repeated block at all — a real limitation, not a timing artifact

    for (const file of files) {
      let song: McgillSong;
      try {
        song = JSON.parse(readFileSync(path.join(MCGILL_ROOT, file), "utf8"));
      } catch {
        continue;
      }
      if (!song.sections?.length) continue;

      const chorusWindows = song.sections
        .filter((s) => s.sectionType === "Chorus")
        .map((s) => ({ startSec: s.start_ms / 1000, endSec: (s.start_ms + s.duration_ms) / 1000 }));
      if (chorusWindows.length < 2) continue;

      const lyricMatch = matchLyrics(song.title ?? "", song.artist ?? "", lyricCandidates);
      if (!lyricMatch) continue;
      const lines = parseLrc(lyricMatch.syncedLyrics);
      if (lines.length < 8) continue;

      eligible++;

      // Simulate the exact problem this editor exists for: all lyrics
      // dumped into one section, no boundaries at all.
      const syntheticSong: BlueprintSong = {
        id: "synthetic",
        title: song.title,
        key: "C",
        scale: "ionian",
        bpm: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
        sections: [
          {
            id: "blob",
            name: "Everything",
            role: "custom",
            bars: 8,
            chords: [],
            beatsPerChord: 4,
            velocity: "mf",
            timeSignatureNumerator: 4,
            timeSignatureDenPower: 2,
            lyricsTimeline: lines.map((l) => ({ text: l.text, startBeat: l.startSec })),
          },
        ],
        arrangement: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const doc = buildLyricDocument(syntheticSong);
      const blocks = detectRepeatedBlocks(doc);
      if (blocks.length === 0) noBlockFound++;

      const distinctWindowsHit = new Set<number>();
      for (const block of blocks) {
        for (const occ of block.occurrences) {
          const lineStart = doc[occ.start].startBeat; // seconds, per the synthetic song above
          if (lineStart === undefined) continue;
          const windowIndex = chorusWindows.findIndex(
            (w) => lineStart >= w.startSec - WINDOW_TOLERANCE_SEC && lineStart < w.endSec + WINDOW_TOLERANCE_SEC,
          );
          if (windowIndex !== -1) distinctWindowsHit.add(windowIndex);
        }
      }
      if (distinctWindowsHit.size >= 2) hits++;
    }

    const rate = eligible > 0 ? hits / eligible : 0;
    console.log(
      `chorus-detection accuracy: ${hits}/${eligible} eligible songs (${(rate * 100).toFixed(1)}%), ` +
        `${noBlockFound} found no repeated block at all (real lyric variation between performed repeats)`,
    );

    expect(eligible).toBeGreaterThan(10); // sanity: the sample actually exercised the detector
    // Measured baseline is 44/71 (62%); headroom below that catches a real
    // regression in the sliding-window matcher without flaking on the
    // corpus's own sample-to-sample noise.
    expect(rate).toBeGreaterThan(0.55);
  });
});
