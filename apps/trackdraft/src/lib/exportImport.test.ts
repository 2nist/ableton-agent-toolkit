/**
 * Regression tests for `parseImportedSong`'s whitelist rebuild.
 *
 * The rebuild enumerates every BlueprintSong field explicitly, which means
 * any field added to the schema LATER is silently dropped on import unless
 * it's added here too. That has now happened twice — `bend`/`detected`
 * (fixed 28dca7e) and `blueprintAcks` after the mode-inference work — and
 * the symptom is invisible: the import succeeds, the feature just never
 * activates. This suite locks every style/suggestion field across the
 * rebuild so the next field addition fails loudly instead of quietly.
 */
import { describe, expect, it } from "vitest";
import { parseImportedSong, parseLibraryBackup } from "./exportImport";

const RAW = {
  id: "song-1",
  title: "Pilot",
  key: "A",
  scale: "ionian",
  bpm: 141.2,
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  sections: [],
  arrangement: [],
  beatOffset: 2,
  outputOffsetBeats: -1,
  genre: "math-rock",
  bend: { energy: 0.66, backbeat: 0.72 },
  narrative: { tension_profile: 0.9, rhythmic_energy: 0.2, transition_delta: 0.6, structural_warp: 0.8 },
  detected: { harmony: 0.99, tension: 0.08 },
  provenance: { source: "audio-extract", extractedAt: "2026-09-21T00:00:00Z", warnings: ["low confidence"] },
  blueprintAcks: { "sec-1:candidate": true },
  lyricsSource: {
    provider: "lrclib",
    id: 4242,
    trackName: "Layla",
    artistName: "Derek and the Dominos",
    albumName: "Layla and Other Assorted Love Songs",
    duration: 425,
    attachedAt: "2026-09-21T00:00:00Z",
    chosenByUser: true,
  },
  createdAt: "2026-09-01T00:00:00Z",
};

describe("parseImportedSong — whitelist rebuild", () => {
  it("preserves every style + suggestion field across the rebuild", () => {
    const song = parseImportedSong(RAW);
    expect(song.bend).toEqual({ energy: 0.66, backbeat: 0.72 });
    expect(song.narrative).toEqual({
      tension_profile: 0.9,
      rhythmic_energy: 0.2,
      transition_delta: 0.6,
      structural_warp: 0.8,
    });
    expect(song.detected).toEqual({ harmony: 0.99, tension: 0.08 });
    expect(song.genre).toBe("math-rock");
    expect(song.beatOffset).toBe(2);
    expect(song.outputOffsetBeats).toBe(-1);
    expect(song.provenance?.source).toBe("audio-extract");
    expect(song.blueprintAcks).toEqual({ "sec-1:candidate": true });
    // Which record the words came from — dropped once already by this same
    // whitelist, which made the lyrics search forget what it had attached.
    expect(song.lyricsSource).toEqual(RAW.lyricsSource);
  });

  it("drops a malformed lyrics source rather than trusting it", () => {
    const noId = parseImportedSong({ ...RAW, lyricsSource: { provider: "lrclib", trackName: "Layla" } });
    expect(noId.lyricsSource).toBeUndefined();

    const wrongProvider = parseImportedSong({
      ...RAW,
      lyricsSource: { ...RAW.lyricsSource, provider: "genius" },
    });
    expect(wrongProvider.lyricsSource).toBeUndefined();
  });

  it("still rejects invalid files and leaves absent fields absent", () => {
    expect(() => parseImportedSong(null)).toThrow();
    expect(() => parseImportedSong({ title: "x" })).toThrow();
    const minimal = parseImportedSong({ title: "x", sections: [], arrangement: [] });
    expect(minimal.key).toBe("C");
    expect(minimal.bend).toBeUndefined();
    expect(minimal.narrative).toBeUndefined();
    expect(minimal.detected).toBeUndefined();
    expect(minimal.blueprintAcks).toBeUndefined();
  });
});

describe("parseLibraryBackup", () => {
  it("restores a backup bundle, preserving each song's updatedAt", () => {
    const songs = parseLibraryBackup({
      app: "trackdraft",
      version: 1,
      exportedAt: "2026-10-17T00:00:00Z",
      songs: [{ ...RAW, updatedAt: "2026-09-15T12:00:00Z" }],
    });
    expect(songs).toHaveLength(1);
    expect(songs[0].id).toBe("song-1");
    expect(songs[0].updatedAt).toBe("2026-09-15T12:00:00Z");
  });

  it("accepts a bare array and a single song object", () => {
    expect(parseLibraryBackup([RAW])).toHaveLength(1);
    expect(parseLibraryBackup(RAW)).toHaveLength(1);
  });

  it("rejects an empty bundle", () => {
    expect(() => parseLibraryBackup({ songs: [] })).toThrow(/no songs/i);
  });
});
