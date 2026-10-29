import { describe, expect, it } from "vitest";
import { applyGrooveChoice, grooveOf, PATTERN_GROUPS, survivingBlocks } from "./grooveModel";
import type { BlueprintSection, DrumBlock } from "../../types/blueprint";

const block = (id: string, mode: DrumBlock["mode"], lane: DrumBlock["lane"] = "kick"): DrumBlock => ({
  id,
  lane,
  startBeat: 0,
  endBeat: 4,
  mode,
  ...(mode === "steps" ? { notes: [{ beat: 0, voice: "kick", velocity: 100 }] } : {}),
});

const section = (blocks: DrumBlock[] = [], extra: Partial<BlueprintSection> = {}): BlueprintSection =>
  ({
    id: "s1",
    name: "Verse",
    role: "verse",
    bars: 2,
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    chords: [],
    velocity: "mf",
    drumPattern: "standard",
    drumBlocks: blocks,
    ...extra,
  }) as unknown as BlueprintSection;

describe("grooveOf — the five fields read as one value", () => {
  it("reports the source the resolver will actually use", () => {
    expect(grooveOf(section([], { drumPattern: undefined }))).toEqual({ kind: "auto" });
    expect(grooveOf(section([], { drumPattern: "none" }))).toEqual({ kind: "muted" });
    expect(grooveOf(section([], { drumPattern: "driving", drumVariantIndex: 3 }))).toEqual({
      kind: "preset",
      pattern: "driving",
      variant: 3,
    });
  });

  it("prefers the meter outline over the pattern — the resolver's own order", () => {
    const outlined = section([], {
      drumPattern: "standard",
      drumMeterOutline: { cellBeats: 0.5, cells: [2, 2, 2, 2], label: "4/4" },
    });
    expect(grooveOf(outlined).kind).toBe("outline");
  });
});

describe("applyGrooveChoice — a whole-section choice replaces what it covers", () => {
  it("drops rhythm blocks so the new preset is actually heard", () => {
    const next = applyGrooveChoice(section([block("a", "steps"), block("b", "euclid")]), {
      kind: "preset",
      pattern: "half_time",
    });
    expect(next.drumPattern).toBe("half_time");
    expect(next.drumBlocks).toBeUndefined();
  });

  it("keeps FX blocks — a new groove should still be shaped by them", () => {
    const next = applyGrooveChoice(section([block("lead", "steps"), block("ramp", "inherit")]), {
      kind: "preset",
      pattern: "driving",
    });
    expect(next.drumBlocks?.map((b) => b.id)).toEqual(["ramp"]);
  });

  it("clears the other sources so exactly one remains", () => {
    const withOutline = section([], {
      drumMeterOutline: { cellBeats: 0.5, cells: [2, 2, 2, 2], label: "4/4" },
      drumPattern: undefined,
    });
    const next = applyGrooveChoice(withOutline, { kind: "preset", pattern: "intense" });
    expect(next.drumMeterOutline).toBeUndefined();
    expect(next.drumPattern).toBe("intense");

    const back = applyGrooveChoice(next, { kind: "auto" });
    expect(back.drumPattern).toBeUndefined();
    expect(back.drumVariantIndex).toBeUndefined();
  });

  it("muted is a source, not a missing one", () => {
    const next = applyGrooveChoice(section(), { kind: "muted" });
    expect(grooveOf(next)).toEqual({ kind: "muted" });
  });

  it("does not mutate its input (undo depends on that)", () => {
    const before = section([block("a", "steps")]);
    applyGrooveChoice(before, { kind: "preset", pattern: "intense" });
    expect(before.drumBlocks).toHaveLength(1);
    expect(before.drumPattern).toBe("standard");
  });

  it("keeps only FX blocks as survivors", () => {
    const all = [block("1", "steps"), block("2", "euclid"), block("3", "outline"), block("4", "motion"), block("5", "inherit")];
    expect(survivingBlocks(all).map((b) => b.mode)).toEqual(["inherit"]);
  });
});

describe("PATTERN_GROUPS — one vocabulary, derived", () => {
  it("offers every pattern exactly once", () => {
    const flat = PATTERN_GROUPS.flatMap((g) => g.patterns);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat).toContain("standard");
    expect(flat).toContain("78");
  });

  it("separates the odd meters", () => {
    expect(PATTERN_GROUPS.find((g) => g.label === "Odd meter")!.patterns).toEqual(["78", "68", "54"]);
  });
});
