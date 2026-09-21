import { describe, it, expect } from "vitest";
import { assembleBlueprint } from "../src/index";
import type { ChordMiniAppResult } from "../src/index";

/** Build 1s loudness segments for [start, end, loudness] blocks. */
function segments(blocks: Array<[number, number, number]>) {
  const out: Array<{ label: string; start_time: number; end_time: number; loudness: number }> = [];
  for (const [start, end, loudness] of blocks) {
    for (let t = start; t < end; t++) {
      out.push({ label: "seg", start_time: t, end_time: t + 1, loudness });
    }
  }
  return out;
}

/** N one-beat chords, ids c0..cN-1 (at 120bpm, 1 beat = 0.5s). */
function chords(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    root: "A",
    quality: "min",
    romanNumeral: "i",
    beats: 1,
  }));
}

function baseJson(overrides: Partial<ChordMiniAppResult> = {}): ChordMiniAppResult {
  return {
    key: "A",
    scale: "minor",
    bpm: 120,
    duration: 180,
    chords: chords(360),
    segments: segments([
      [0, 30, 0.05],
      [30, 90, 0.4],
      [90, 150, 0.2],
      [150, 180, 0.05],
    ]),
    ...overrides,
  };
}

describe("assembleBlueprint chord tiling", () => {
  it("assigns every chord exactly once, in order, with no duplication", () => {
    const song = assembleBlueprint(baseJson(), "Test");
    const flat = song.sections.flatMap((s) => s.chords);

    // Every chord present exactly once (the old overflow block re-assigned
    // the full chord list to the last section, duplicating 400+ chords).
    expect(flat.length).toBe(360);
    expect(new Set(flat.map((c) => c.id)).size).toBe(360);
    expect(flat.map((c) => c.id)).toEqual(chords(360).map((c) => c.id));

    // Sections are contiguous, ordered slices proportional to real duration:
    // 30s/90s/150s/180s cumulative → indices 60 / 180 / 300 / 360.
    expect(song.sections.map((s) => s.chords.length)).toEqual([60, 120, 120, 60]);
  });

  it("tiles across usable sections even when a short region is filtered out", () => {
    const json = baseJson({
      // 6s "medium" blip between two quiet stretches is dropped (<8s min)
      segments: segments([
        [0, 30, 0.05],
        [30, 60, 0.4],
        [60, 66, 0.2],
        [66, 120, 0.05],
        [120, 180, 0.4],
      ]),
      chords: chords(300),
    });
    const song = assembleBlueprint(json, "Test");
    const flat = song.sections.flatMap((s) => s.chords);

    expect(flat.length).toBe(300);
    expect(new Set(flat.map((c) => c.id)).size).toBe(300);
    expect(flat[0].id).toBe("c0");
    expect(flat[flat.length - 1].id).toBe("c299");
    for (const s of song.sections) expect(s.chords.length).toBeGreaterThan(0);
  });
});

describe("assembleBlueprint lyric placement", () => {
  it("windows synced lines by real audio spans, not by inflated bars", () => {
    const json = baseJson({
      segments: segments([
        [0, 60, 0.05],
        [60, 120, 0.4],
        [120, 180, 0.2],
      ]),
    });
    const synced = [
      "[00:05.00]intro line",
      "[00:10.00]still intro",
      "[01:05.00]verse line",
      "[03:10.00]outro tail",
    ].join("\n");

    const song = assembleBlueprint(json, "Test", { lrclibData: { syncedLyrics: synced } });

    expect(song.sections[0].lyrics).toContain("intro line");
    expect(song.sections[0].lyrics).toContain("still intro");

    const mid = song.sections.find((s) => s.lyrics?.includes("verse line"));
    expect(mid).toBeDefined();
    // startBeat is relative to the section start: 65s − 60s = 5s = 10 beats @120
    const entry = mid!.lyricsTimeline!.find((l) => l.text === "verse line")!;
    expect(entry.startBeat).toBeCloseTo(10, 2);

    // Lines past the final span land in the last section
    const last = song.sections[song.sections.length - 1];
    expect(last.lyrics).toContain("outro tail");
    // 190s − 120s = 70s = 140 beats @120
    expect(last.lyricsTimeline!.find((l) => l.text === "outro tail")!.startBeat).toBeCloseTo(140, 2);
  });

  it("never drops lines outside the covered span range", () => {
    const json = baseJson({
      segments: segments([
        [10, 70, 0.05],
        [70, 140, 0.4],
      ]),
    });
    const synced = ["[00:05.00]before the first span", "[02:29.00]after the last span"].join("\n");

    const song = assembleBlueprint(json, "Test", { lrclibData: { syncedLyrics: synced } });
    const assigned = song.sections.flatMap((s) => (s.lyrics ? s.lyrics.split("\n") : []));

    expect(assigned).toContain("before the first span");
    expect(assigned).toContain("after the last span");
    expect(song.sections[0].lyrics).toContain("before the first span");
    expect(song.sections[song.sections.length - 1].lyrics).toContain("after the last span");
  });
});
