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
import { parseImportedSong } from "./exportImport";

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
  detected: { harmony: 0.99, tension: 0.08 },
  provenance: { source: "audio-extract", extractedAt: "2026-09-21T00:00:00Z", warnings: ["low confidence"] },
  blueprintAcks: { "sec-1:candidate": true },
  createdAt: "2026-09-01T00:00:00Z",
};

describe("parseImportedSong — whitelist rebuild", () => {
  it("preserves every style + suggestion field across the rebuild", () => {
    const song = parseImportedSong(RAW);
    expect(song.bend).toEqual({ energy: 0.66, backbeat: 0.72 });
    expect(song.detected).toEqual({ harmony: 0.99, tension: 0.08 });
    expect(song.genre).toBe("math-rock");
    expect(song.beatOffset).toBe(2);
    expect(song.outputOffsetBeats).toBe(-1);
    expect(song.provenance?.source).toBe("audio-extract");
    expect(song.blueprintAcks).toEqual({ "sec-1:candidate": true });
  });

  it("still rejects invalid files and leaves absent fields absent", () => {
    expect(() => parseImportedSong(null)).toThrow();
    expect(() => parseImportedSong({ title: "x" })).toThrow();
    const minimal = parseImportedSong({ title: "x", sections: [], arrangement: [] });
    expect(minimal.key).toBe("C");
    expect(minimal.bend).toBeUndefined();
    expect(minimal.detected).toBeUndefined();
    expect(minimal.blueprintAcks).toBeUndefined();
  });
});
