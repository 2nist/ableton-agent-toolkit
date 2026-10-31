import { describe, expect, it } from "vitest";
import { applyFilters, matchesFilter, measureValue, runBreakdown, runDistribution, runMatrix, runRows } from "./report";
import { measureDef } from "./fields";
import type { SectionRow, StudyFilter } from "./types";

function section(partial: Partial<SectionRow>): SectionRow {
  return {
    grain: "section",
    songId: "s1",
    title: "Song",
    artist: "Artist",
    genre: "rock",
    key: "D",
    scale: "aeolian",
    meter: "4/4",
    sectionId: "sec1",
    section: "Intro",
    role: "intro",
    velocity: "mp",
    bars: 8,
    beatsPerChord: 4,
    chordCount: 4,
    distinctDegrees: 3,
    borrowed: false,
    appliedCount: 0,
    avgTension: 0.4,
    hasMelody: false,
    hasLyrics: true,
    hasDrums: true,
    sectionIndex: 0,
    startBar: 0,
    cadences: "",
    ...partial,
  };
}

const rows = [
  section({ role: "intro", avgTension: 0.2, bars: 4, hasMelody: false }),
  section({ role: "verse", avgTension: 0.4, bars: 8, hasMelody: true }),
  section({ role: "verse", avgTension: 0.5, bars: 8, borrowed: true, hasMelody: true }),
  section({ role: "chorus", avgTension: 0.8, bars: 16, borrowed: true, hasMelody: true }),
];

describe("filters", () => {
  it("matches eq/contains/gt on a present field", () => {
    const row = rows[0]!;
    expect(matchesFilter(row, { field: "role", op: "eq", value: "intro", grain: "common" })).toBe(true);
    expect(matchesFilter(row, { field: "section", op: "contains", value: "int", grain: "common" })).toBe(true);
    expect(matchesFilter(row, { field: "bars", op: "gt", value: 6, grain: "section" })).toBe(false);
  });

  it("ignores a filter for a column the row does not carry", () => {
    // A roman-numeral filter belongs to the chord grain; it must not blank a
    // section panel that never had the field.
    const roman: StudyFilter = { field: "roman", op: "eq", value: "V", grain: "chord" };
    expect(matchesFilter(rows[0]!, roman)).toBe(true);
    expect(applyFilters(rows, [roman])).toHaveLength(4);
  });

  it("applies several filters together", () => {
    const filtered = applyFilters(rows, [
      { field: "role", op: "eq", value: "verse", grain: "common" },
      { field: "borrowed", op: "eq", value: "yes", grain: "chord" },
    ]);
    expect(filtered).toHaveLength(1);
  });
});

describe("measures", () => {
  it("computes mean and share", () => {
    const mean = measureDef("section", "meanTension")!;
    const share = measureDef("section", "borrowShare")!;
    expect(measureValue(rows, mean)).toBeCloseTo((0.2 + 0.4 + 0.5 + 0.8) / 4, 5);
    expect(measureValue(rows, share)).toBeCloseTo(2 / 4, 5);
  });

  it("counts rows", () => {
    expect(measureValue(rows, measureDef("section", "count")!)).toBe(4);
  });
});

describe("runBreakdown", () => {
  const panel = {
    id: "p",
    kind: "breakdown" as const,
    title: "t",
    grain: "section" as const,
    dimension: "role",
    measures: ["meanTension", "count"],
  };

  it("groups, measures and sorts by the first measure descending", () => {
    const groups = runBreakdown(rows, panel, []);
    expect(groups.map((group) => group.key)).toEqual(["chorus", "verse", "intro"]);
    expect(groups[1]!.values.meanTension).toBeCloseTo(0.45, 5);
  });

  it("respects the active filters", () => {
    const groups = runBreakdown(rows, panel, [
      { field: "borrowed", op: "eq", value: "yes", grain: "chord" },
    ]);
    expect(groups.map((group) => group.key)).toEqual(["chorus", "verse"]);
  });
});

describe("runMatrix", () => {
  it("counts cells and truncates each axis to the heaviest values", () => {
    const panel = {
      id: "p",
      kind: "matrix" as const,
      title: "t",
      grain: "section" as const,
      row: "role",
      col: "meter",
      measures: [],
    };
    const result = runMatrix(rows, panel, []);
    expect(result.total).toBe(4);
    expect(result.rowKeys).toContain("verse");
    expect(result.cells[result.rowKeys.indexOf("verse")]![result.colKeys.indexOf("4/4")]).toBe(2);
  });
});

describe("runDistribution", () => {
  it("buckets a numeric field", () => {
    const result = runDistribution(rows, {
      id: "p",
      kind: "distribution",
      title: "t",
      grain: "section",
      dimension: "bars",
      measures: [],
    }, []);
    expect(result.numeric).toBe(true);
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(4);
  });

  it("counts a categorical field", () => {
    const result = runDistribution(rows, {
      id: "p",
      kind: "distribution",
      title: "t",
      grain: "section",
      dimension: "role",
      measures: [],
    }, []);
    expect(result.numeric).toBe(false);
    expect(result.buckets[0]).toEqual({ label: "verse", count: 2 });
  });
});

describe("runRows", () => {
  it("sorts by the first mean measure's field and limits", () => {
    const result = runRows(rows, {
      id: "p",
      kind: "rows",
      title: "t",
      grain: "section",
      measures: ["meanBars"],
      limit: 2,
    }, []);
    expect(result).toHaveLength(2);
    expect(result[0]!.grain === "section" ? result[0]!.bars : 0).toBe(16);
  });
});
