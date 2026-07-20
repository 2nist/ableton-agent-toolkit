import { describe, it, expect } from "vitest";
import {
  buildLyricDocument,
  assignLinesToSection,
  mergeLinesIntoSection,
  splitSectionAt,
  unassignLines,
  detectRepeatedBlocks,
} from "./sectionize";
import type { BlueprintSong, BlueprintSection } from "../../types/blueprint";

function makeSong(sections: Partial<BlueprintSection>[]): BlueprintSong {
  return {
    id: "song-1",
    title: "Test Song",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: sections.map((s, i) => ({
      id: s.id ?? `sec-${i}`,
      name: s.name ?? `Section ${i}`,
      role: s.role ?? "custom",
      bars: s.bars ?? 8,
      chords: [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
      ...s,
    })),
    arrangement: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function totalText(song: BlueprintSong): string {
  return song.sections
    .flatMap((s) => (s.lyrics ?? "").split("\n"))
    .filter((line) => line.length > 0)
    .sort()
    .join("|");
}

describe("buildLyricDocument", () => {
  it("prefers lyricsTimeline over plain lyrics when both exist", () => {
    const song = makeSong([
      { id: "s0", lyrics: "wrong a\nwrong b", lyricsTimeline: [{ text: "right a", startBeat: 0 }, { text: "right b", startBeat: 4 }] },
    ]);
    const doc = buildLyricDocument(song);
    expect(doc.map((l) => l.text)).toEqual(["right a", "right b"]);
    expect(doc[1].startBeat).toBe(4);
  });

  it("falls back to splitting plain lyrics when there's no timeline", () => {
    const song = makeSong([{ id: "s0", lyrics: "line one\nline two\n\nline three" }]);
    const doc = buildLyricDocument(song);
    expect(doc.map((l) => l.text)).toEqual(["line one", "line two", "", "line three"]);
    expect(doc.every((l) => l.startBeat === undefined)).toBe(true);
  });

  it("concatenates across sections in arrangement order", () => {
    const song = makeSong([{ id: "s0", lyrics: "a1\na2" }, { id: "s1", lyrics: "b1" }]);
    const doc = buildLyricDocument(song);
    expect(doc.map((l) => `${l.sectionId}:${l.text}`)).toEqual(["s0:a1", "s0:a2", "s1:b1"]);
  });
});

describe("assignLinesToSection", () => {
  it("carves a middle range out of one big blob into a new section", () => {
    const song = makeSong([{ id: "s0", name: "Everything", lyrics: "v1\nv2\nc1\nc2\nv3\nv4" }]);
    const doc = buildLyricDocument(song);
    const result = assignLinesToSection(song, doc, { start: 2, end: 3 }, { role: "chorus", name: "Chorus" });

    expect(result.sections.map((s) => s.lyrics)).toEqual(["v1\nv2", "c1\nc2", "v3\nv4"]);
    expect(result.sections[1].role).toBe("chorus");
    expect(result.sections[1].name).toBe("Chorus");
    expect(result.sections[1].id).not.toBe("s0");
  });

  it("preserves total text through a carve (round-trip)", () => {
    const song = makeSong([{ id: "s0", lyrics: "v1\nv2\nc1\nc2\nv3\nv4" }]);
    const doc = buildLyricDocument(song);
    const result = assignLinesToSection(song, doc, { start: 2, end: 3 }, { role: "chorus", name: "Chorus" });
    expect(totalText(result)).toBe(totalText(song));
  });

  it("handles a selection at the very start (no 'before' remainder)", () => {
    const song = makeSong([{ id: "s0", lyrics: "c1\nc2\nv1\nv2" }]);
    const doc = buildLyricDocument(song);
    const result = assignLinesToSection(song, doc, { start: 0, end: 1 }, { role: "chorus", name: "Chorus" });
    expect(result.sections.map((s) => s.lyrics)).toEqual(["c1\nc2", "v1\nv2"]);
  });

  it("handles a selection at the very end (no 'after' remainder)", () => {
    const song = makeSong([{ id: "s0", lyrics: "v1\nv2\nc1\nc2" }]);
    const doc = buildLyricDocument(song);
    const result = assignLinesToSection(song, doc, { start: 2, end: 3 }, { role: "chorus", name: "Chorus" });
    expect(result.sections.map((s) => s.lyrics)).toEqual(["v1\nv2", "c1\nc2"]);
  });

  it("derives real bars from timestamped lines instead of the 8-bar default", () => {
    const song = makeSong([
      {
        id: "s0",
        lyricsTimeline: [
          { text: "v1", startBeat: 0 },
          { text: "c1", startBeat: 8 },
          { text: "c2", startBeat: 12 },
          { text: "v2", startBeat: 16 },
        ],
      },
    ]);
    const doc = buildLyricDocument(song);
    const result = assignLinesToSection(song, doc, { start: 1, end: 2 }, { role: "chorus", name: "Chorus" });
    // span 8..16 beats = 8 beats = 2 bars at 4/4
    expect(result.sections[1].bars).toBe(2);
  });

  it("falls back to a default bar count when timing is unavailable", () => {
    const song = makeSong([{ id: "s0", lyrics: "v1\nc1\nc2\nv2" }]);
    const doc = buildLyricDocument(song);
    const result = assignLinesToSection(song, doc, { start: 1, end: 2 }, { role: "chorus", name: "Chorus" });
    expect(result.sections[1].bars).toBe(8);
  });
});

describe("mergeLinesIntoSection", () => {
  it("appends the selection onto an existing section's lyrics", () => {
    const song = makeSong([
      { id: "chorus-1", name: "Chorus", role: "chorus", lyrics: "c1\nc2" },
      { id: "s1", name: "Extra", lyrics: "c1-repeat\nc2-repeat\nv3" },
    ]);
    const doc = buildLyricDocument(song);
    const result = mergeLinesIntoSection(song, doc, { start: 2, end: 3 }, "chorus-1");
    const chorus = result.sections.find((s) => s.id === "chorus-1")!;
    expect(chorus.lyrics).toBe("c1\nc2\nc1-repeat\nc2-repeat");
    const remainder = result.sections.find((s) => s.name === "Extra");
    expect(remainder?.lyrics).toBe("v3");
  });

  it("preserves total text (round-trip)", () => {
    const song = makeSong([
      { id: "chorus-1", lyrics: "c1\nc2" },
      { id: "s1", lyrics: "c1-repeat\nc2-repeat\nv3" },
    ]);
    const doc = buildLyricDocument(song);
    const result = mergeLinesIntoSection(song, doc, { start: 2, end: 3 }, "chorus-1");
    expect(totalText(result)).toBe(totalText(song));
  });
});

describe("splitSectionAt", () => {
  it("breaks one section into two at a line boundary, same role", () => {
    const song = makeSong([{ id: "s0", name: "Verse", role: "verse", lyrics: "v1\nv2\nv3\nv4" }]);
    const doc = buildLyricDocument(song);
    const result = splitSectionAt(song, doc, "s0", 2);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].lyrics).toBe("v1\nv2");
    expect(result.sections[1].lyrics).toBe("v3\nv4");
    expect(result.sections[1].role).toBe("verse");
    expect(result.sections[1].name).toBe("Verse (cont.)");
  });

  it("is a no-op when the section or line index doesn't exist", () => {
    const song = makeSong([{ id: "s0", lyrics: "v1\nv2" }]);
    const doc = buildLyricDocument(song);
    expect(splitSectionAt(song, doc, "missing", 0)).toBe(song);
  });
});

describe("unassignLines", () => {
  it("never drops text — parks it in a visible Unassigned section", () => {
    const song = makeSong([{ id: "s0", lyrics: "v1\nunclear\nv2" }]);
    const doc = buildLyricDocument(song);
    const result = unassignLines(song, doc, { start: 1, end: 1 });
    const unassigned = result.sections.find((s) => s.name === "Unassigned");
    expect(unassigned?.lyrics).toBe("unclear");
    expect(unassigned?.role).toBe("custom");
    expect(totalText(result)).toBe(totalText(song));
  });
});

describe("detectRepeatedBlocks", () => {
  it("finds a repeated chorus block across a synthetic verse/chorus/verse song", () => {
    const song = makeSong([
      {
        id: "s0",
        lyrics: [
          "here is the first verse",
          "setting up the story",
          "",
          "this is the chorus hook",
          "sing it loud and clear",
          "",
          "here is the second verse",
          "deepening the story",
          "",
          "this is the chorus hook",
          "sing it loud and clear",
        ].join("\n"),
      },
    ]);
    const doc = buildLyricDocument(song);
    const blocks = detectRepeatedBlocks(doc);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].occurrences).toHaveLength(2);
    expect(blocks[0].normalizedText).toContain("this is the chorus hook");
  });

  it("finds repeats even with no blank-line separators (the lyricsTimeline shape)", () => {
    // Real timestamped lyrics never have blank-line entries — parseLrc
    // drops them — so the detector must not depend on blank lines at all.
    const song = makeSong([
      {
        id: "s0",
        lyricsTimeline: [
          { text: "here is the first verse", startBeat: 0 },
          { text: "setting up the story", startBeat: 4 },
          { text: "this is the chorus hook", startBeat: 8 },
          { text: "sing it loud and clear", startBeat: 12 },
          { text: "here is the second verse", startBeat: 16 },
          { text: "deepening the story", startBeat: 20 },
          { text: "this is the chorus hook", startBeat: 24 },
          { text: "sing it loud and clear", startBeat: 28 },
        ],
      },
    ]);
    const doc = buildLyricDocument(song);
    const blocks = detectRepeatedBlocks(doc);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].occurrences).toEqual([{ start: 2, end: 3 }, { start: 6, end: 7 }]);
  });

  it("is case/punctuation-insensitive", () => {
    const song = makeSong([
      { id: "s0", lyrics: ["Hello, World!", "Second line", "hello world", "second line"].join("\n") },
    ]);
    const doc = buildLyricDocument(song);
    const blocks = detectRepeatedBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].occurrences).toHaveLength(2);
  });

  it("returns nothing for a song with no repeats", () => {
    const song = makeSong([{ id: "s0", lyrics: "a unique line\nanother unique line\nyet another" }]);
    const doc = buildLyricDocument(song);
    expect(detectRepeatedBlocks(doc)).toEqual([]);
  });

  it("prefers the longest match and doesn't double-report a sub-span of it", () => {
    const song = makeSong([
      {
        id: "s0",
        lyrics: ["one", "two", "three", "four", "filler", "one", "two", "three", "four"].join("\n"),
      },
    ]);
    const doc = buildLyricDocument(song);
    const blocks = detectRepeatedBlocks(doc);
    // Should be one 4-line block, not also separately-reported 2- and 3-line sub-matches.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].occurrences[0]).toEqual({ start: 0, end: 3 });
    expect(blocks[0].occurrences[1]).toEqual({ start: 5, end: 8 });
  });
});
