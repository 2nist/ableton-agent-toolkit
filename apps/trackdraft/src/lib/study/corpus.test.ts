import { describe, expect, it } from "vitest";
import { baseNumeral, corpusDataset, corpusMatches, splitName } from "./corpus";
import type { SongIndex } from "@platform/progression-engine";

const index: SongIndex = {
  v: 3,
  names: ["Alpha - First Song", "Beta - Second Song", "Gamma - No Sections"],
  sections: [
    { n: 0, d: "aekd" }, // I V ♭VII IV
    { n: 0, d: "ak" }, //   I ♭VII
    { n: 1, d: "fd" }, //   vi IV
  ],
};

describe("splitName", () => {
  it("splits on the first separator only", () => {
    expect(splitName("A Ha - The Sun - Live")).toEqual({ artist: "A Ha", title: "The Sun - Live" });
  });

  it("keeps a name with no separator intact", () => {
    expect(splitName("Untitled")).toEqual({ artist: "", title: "Untitled" });
  });
});

describe("baseNumeral", () => {
  it("strips applied targets and quality suffixes", () => {
    expect(baseNumeral("V7/V")).toBe("V");
    expect(baseNumeral("iv7")).toBe("iv");
    expect(baseNumeral("♭VIImaj7")).toBe("♭VII");
    expect(baseNumeral("vi")).toBe("vi");
  });
});

describe("corpusDataset", () => {
  const dataset = corpusDataset(index);

  it("produces one row per chord and per section, and one per named song", () => {
    expect(dataset.scope).toBe("catalogue");
    expect(dataset.sections).toHaveLength(3);
    expect(dataset.chords).toHaveLength(4 + 2 + 2);
    expect(dataset.songs).toHaveLength(2);
  });

  it("carries only what the corpus knows — unknown numerics are NaN", () => {
    const section = dataset.sections[0]!;
    expect(section.chordCount).toBe(4);
    expect(section.distinctDegrees).toBe(4);
    expect(section.borrowed).toBe(true); // ♭VII
    expect(Number.isNaN(section.bars)).toBe(true);
    expect(section.role).toBe("");
    expect(dataset.chords[0]).toMatchObject({ roman: "I", nextRoman: "V" });
    expect(dataset.chords[3]).toMatchObject({ roman: "IV", nextRoman: "(end)" });
  });

  it("aggregates song rows from their sections", () => {
    const alpha = dataset.songs.find((song) => song.title === "First Song")!;
    expect(alpha.artist).toBe("Alpha");
    expect(alpha.sectionCount).toBe(2);
    expect(Number.isNaN(alpha.totalBars)).toBe(true);
  });
});

describe("corpusMatches", () => {
  it("finds songs whose section contains the run", () => {
    const matches = corpusMatches(index, ["I", "V", "♭VII"]);
    expect(matches.map((match) => match.name)).toContain("Alpha - First Song");
  });

  it("normalises derived numerals before matching", () => {
    // "V7/V" must be read as V, not as an unknown symbol.
    expect(corpusMatches(index, ["I", "V7/V", "♭VII"]).length).toBeGreaterThan(0);
  });

  it("returns nothing for an empty run", () => {
    expect(corpusMatches(index, [])).toEqual([]);
  });
});
