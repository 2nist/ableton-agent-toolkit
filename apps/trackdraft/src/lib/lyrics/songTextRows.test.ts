import { describe, it, expect } from "vitest";
import { buildSongTextModel, songTextLines, UNASSIGNED_NAME } from "./songTextRows";
import { buildLyricDocument, mergeLinesIntoSection, unassignLines } from "./sectionize";
import type { BlueprintSong, BlueprintSection } from "../../types/blueprint";

function makeSong(sections: Partial<BlueprintSection>[], arrangement?: { sectionId: string; repeats: number }[]): BlueprintSong {
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
    arrangement: arrangement ?? [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("buildSongTextModel — the document-index contract", () => {
  it("numbers lines by their TRUE document index, with an instrumental between lyric sections", () => {
    // Order: Intro (2 lines) · Solo (no lyrics) · Verse (1 line).
    // The old view numbered rows display-first, so after the Solo
    // placeholder every selection was off by one — this is the lock.
    const song = makeSong([
      { id: "intro", lyrics: "intro one\nintro two" },
      { id: "solo", role: "solo" }, // no lyrics → instrumental placeholder
      { id: "verse", lyrics: "verse one" },
    ]);
    const doc = buildLyricDocument(song);
    const model = buildSongTextModel(song);

    const verseBlock = model.blocks.find((b) => b.section.id === "verse")!;
    const verseRow = verseBlock.lines[0];
    expect(verseRow.line.text).toBe("verse one");
    // The doc has only 3 lines (the solo contributes none) — verse is index 2,
    // NOT index 3 as display-row numbering would have said.
    expect(verseRow.docIndex).toBe(2);
    expect(doc[verseRow.docIndex].text).toBe("verse one");

    // Every row's docIndex must address exactly its own text.
    for (const row of songTextLines(model)) {
      expect(doc[row.docIndex].text).toBe(row.line.text);
    }
    expect(model.docLineCount).toBe(3);
  });

  it("keeps unassigned lines VISIBLE in place, and their docIndex addresses the right text", () => {
    // Park the middle line of one section (the real user flow: select a
    // line, Unassign) — the line used to vanish from the view entirely.
    const song = makeSong([{ id: "v", lyrics: "line one\nline two\nline three" }]);
    const parked = unassignLines(song, buildLyricDocument(song), { start: 1, end: 1 });
    expect(parked.sections.some((s) => s.name === UNASSIGNED_NAME)).toBe(true);

    const model = buildSongTextModel(parked);
    const unassigned = model.blocks.find((b) => b.kind === "unassigned");
    expect(unassigned).toBeDefined();
    expect(unassigned!.lines.map((r) => r.line.text)).toEqual(["line two"]);

    const doc = buildLyricDocument(parked);
    for (const row of songTextLines(model)) {
      expect(doc[row.docIndex].text).toBe(row.line.text);
    }
  });

  it("regression: an op driven by a row's docIndex moves EXACTLY the line that row shows", () => {
    // Reconstructs the old failure: with an unassigned tray mid-document,
    // selecting the row below it and applying an op must move the row's own
    // text — not the invisible parked line (the pre-fix behavior), and not
    // anything shifted by display numbering.
    const song = makeSong([{ id: "v", lyrics: "a\nb\nc\nd" }]);
    const parked = unassignLines(song, buildLyricDocument(song), { start: 1, end: 1 }); // park "b"

    const target = makeSong([{ id: "target" }]);
    const songWithTarget: BlueprintSong = { ...parked, sections: [...parked.sections, target.sections[0]] };

    const model = buildSongTextModel(songWithTarget);
    const rowD = songTextLines(model).find((r) => r.line.text === "d")!;

    const moved = mergeLinesIntoSection(songWithTarget, buildLyricDocument(songWithTarget), { start: rowD.docIndex, end: rowD.docIndex }, "target");
    const targetAfter = moved.sections.find((s) => s.id === "target")!;
    expect(targetAfter.lyrics).toBe("d"); // the row the user selected — nothing else
  });

  it("surfaces arrangement repeats (including 0 = skipped) and defaults to 1 with no entry", () => {
    const song = makeSong(
      [
        { id: "chorus", role: "chorus", lyrics: "hook" },
        { id: "bridge", role: "bridge", lyrics: "middle" },
        { id: "hidden", lyrics: "skipped" },
      ],
      [
        { sectionId: "chorus", repeats: 3 },
        { sectionId: "bridge", repeats: 1 },
        { sectionId: "hidden", repeats: 0 },
      ],
    );
    const model = buildSongTextModel(song);
    expect(model.blocks.find((b) => b.section.id === "chorus")!.repeats).toBe(3);
    expect(model.blocks.find((b) => b.section.id === "hidden")!.repeats).toBe(0);

    // No arrangement at all: every block still reads repeats 1 (implicit play),
    // and duplicate arrangement entries never duplicate blocks.
    const implicit = buildSongTextModel(makeSong([{ id: "a", lyrics: "x" }]));
    expect(implicit.blocks[0].repeats).toBe(1);
    const dup = buildSongTextModel(
      makeSong([{ id: "a", lyrics: "x" }], [
        { sectionId: "a", repeats: 1 },
        { sectionId: "a", repeats: 2 },
      ]),
    );
    expect(dup.blocks.filter((b) => b.section.id === "a")).toHaveLength(1);
  });

  it("classifies blocks: lyric · instrumental (no lines) · unassigned", () => {
    const song = makeSong([
      { id: "intro", role: "intro", lyrics: "oh" },
      { id: "solo", role: "solo" },
      { id: "parked", name: UNASSIGNED_NAME, lyrics: "orphan" },
    ]);
    const model = buildSongTextModel(song);
    expect(model.blocks.map((b) => b.kind)).toEqual(["lyric", "instrumental", "unassigned"]);
  });
});
