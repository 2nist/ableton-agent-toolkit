import { describe, expect, it } from "vitest";
import { synthesiseSections, synthesiseSong } from "./perfSong";
import { sectionSpans } from "../arrangement";
import { arrangeSections } from "./layout";

describe("synthesiseSections", () => {
  it("makes the number of sections asked for", () => {
    expect(synthesiseSections(64)).toHaveLength(64);
    expect(synthesiseSections(0)).toHaveLength(0);
  });

  it("gives every section material in all six lanes", () => {
    for (const section of synthesiseSections(12)) {
      expect(section.chords.length).toBeGreaterThan(0);
      expect(section.drumPattern).toBeTruthy();
      expect(section.lyrics?.length).toBeGreaterThan(0);
      expect(section.melody?.notes.length).toBeGreaterThan(0);
      expect(section.bassNotes?.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic — two runs measure the same song", () => {
    expect(JSON.stringify(synthesiseSections(8))).toBe(
      JSON.stringify(synthesiseSections(8)),
    );
  });

  it("varies column widths, so culling is not flattered by equal columns", () => {
    const widths = new Set(synthesiseSections(24).map((s) => s.bars));
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe("synthesiseSong", () => {
  it("covers its sections in the arrangement", () => {
    const song = synthesiseSong(16);
    expect(song.arrangement).toHaveLength(16);
  });

  it("produces a layout with one node per section", () => {
    const song = synthesiseSong(16);
    const layout = arrangeSections(sectionSpans(song), {
      bpm: song.bpm,
      key: song.key,
      scale: song.scale,
    });
    expect(layout.nodes).toHaveLength(16);
    expect(layout.totalBars).toBeGreaterThan(0);
    expect(layout.bounds.w).toBeGreaterThan(0);
  });

  it("keeps ids unique, so keys are unique", () => {
    const song = synthesiseSong(64);
    const keys = sectionSpans(song).map(
      (span) => `${span.sectionId}#${span.occurrenceIndex}`,
    );
    expect(new Set(keys).size).toBe(64);
  });
});
