import { describe, it, expect } from "vitest";
import { sectionSpans, totalBars } from "./arrangement";
import type { BlueprintSong, BlueprintSection, ArrangementRepeat } from "../types/blueprint";

function makeSection(overrides: Partial<BlueprintSection> & { id: string }): BlueprintSection {
  return {
    name: overrides.id,
    role: "verse",
    bars: 4,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

function makeSong(sections: BlueprintSection[], arrangement: ArrangementRepeat[]): BlueprintSong {
  return {
    id: "song-1",
    title: "Test Song",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections,
    arrangement,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("sectionSpans", () => {
  it("falls back to one pass per section, in list order, when arrangement is empty", () => {
    const sections = [makeSection({ id: "a" }), makeSection({ id: "b" })];
    const spans = sectionSpans(makeSong(sections, []));
    expect(spans.map((s) => s.sectionId)).toEqual(["a", "b"]);
    expect(spans[0].startBeat).toBe(0);
    // 4 bars * 4/4 = 16 beats per section.
    expect(spans[0].durationBeats).toBe(16);
    expect(spans[1].startBeat).toBe(16);
  });

  it("expands repeats > 1 into multiple spans with incrementing occurrenceIndex", () => {
    const sections = [makeSection({ id: "chorus", bars: 4 })];
    const spans = sectionSpans(makeSong(sections, [{ sectionId: "chorus", repeats: 3 }]));
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.occurrenceIndex)).toEqual([0, 1, 2]);
    expect(spans.map((s) => s.startBeat)).toEqual([0, 16, 32]);
  });

  it("applies a per-pass bars override without mutating the canonical section", () => {
    const sections = [makeSection({ id: "verse", bars: 4 })];
    const song = makeSong(sections, [{ sectionId: "verse", repeats: 1, overrides: { bars: 8 } }]);
    const spans = sectionSpans(song);
    expect(spans[0].bars).toBe(8);
    expect(spans[0].durationBeats).toBe(32);
    // The canonical section in song.sections is untouched.
    expect(song.sections[0].bars).toBe(4);
  });

  it("skips a stale arrangement entry referencing a deleted section", () => {
    const sections = [makeSection({ id: "a" })];
    const song = makeSong(sections, [
      { sectionId: "ghost", repeats: 1 },
      { sectionId: "a", repeats: 1 },
    ]);
    const spans = sectionSpans(song);
    expect(spans.map((s) => s.sectionId)).toEqual(["a"]);
  });

  it("computes contiguous startBar values matching accumulated bars", () => {
    const sections = [makeSection({ id: "a", bars: 4 }), makeSection({ id: "b", bars: 8 })];
    const spans = sectionSpans(makeSong(sections, []));
    expect(spans[0].startBar).toBe(0);
    expect(spans[1].startBar).toBe(4);
    expect(totalBars(spans)).toBe(12);
  });

  it("returns an empty array and totalBars 0 for a song with no sections", () => {
    const spans = sectionSpans(makeSong([], []));
    expect(spans).toEqual([]);
    expect(totalBars(spans)).toBe(0);
  });
});
