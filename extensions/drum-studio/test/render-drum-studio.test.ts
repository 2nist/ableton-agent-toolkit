import { describe, expect, it } from "vitest";
import type { DrumPattern, PackedPreset } from "@drum/library";
import {
  renderStudioResult,
  selectablePatterns,
  PATTERN_LABELS,
  type PatternStudioResult,
  type OutlineStudioResult,
} from "../src/render-drum-studio.js";

const KICK = 36;
const SNARE = 38;
const HAT = 42;

function fixturePresets(overrides: Partial<Record<DrumPattern, PackedPreset>> = {}) {
  const standard: PackedPreset = {
    variants: [
      { lengthBeats: 4, beatsPerBar: 4, notes: [[0, KICK, 100], [1, SNARE, 90], [2, KICK, 100], [3, SNARE, 90]], source: { origin: "egmd" } },
      { lengthBeats: 4, beatsPerBar: 4, notes: [[0, KICK, 110], [1.5, SNARE, 60]], source: { origin: "egmd" } },
    ],
  };
  return { standard, ...overrides };
}

function patternResult(overrides: Partial<PatternStudioResult> = {}): PatternStudioResult {
  return {
    mode: "pattern",
    pattern: "standard",
    variantIndex: 0,
    bars: 2,
    velocity: "mf",
    transitionModel: "none",
    transitionBars: 1,
    ...overrides,
  };
}

function outlineResult(overrides: Partial<OutlineStudioResult> = {}): OutlineStudioResult {
  return {
    mode: "outline",
    cells: [2, 2, 3],
    cellVoices: [],
    denominator: 16,
    bars: 4,
    velocity: "mf",
    transitionModel: "none",
    transitionBars: 1,
    ...overrides,
  };
}

describe("selectablePatterns", () => {
  it("only offers patterns with at least one variant", () => {
    const presets = fixturePresets();
    expect(selectablePatterns(presets)).toEqual(["standard"]);
  });

  it("returns nothing for empty preset data", () => {
    expect(selectablePatterns({})).toEqual([]);
  });

  it("every selectable pattern has a friendly label", () => {
    const presets = fixturePresets({
      "78": { variants: [{ lengthBeats: 3.5, beatsPerBar: 3.5, notes: [[0, KICK, 100]], source: { origin: "synth" } }] },
    });
    for (const pattern of selectablePatterns(presets)) {
      expect(PATTERN_LABELS[pattern]).toBeDefined();
    }
  });
});

describe("renderStudioResult — pattern mode", () => {
  const presets = fixturePresets();

  it("tiles the chosen variant to fill the requested bars", () => {
    const rendered = renderStudioResult(patternResult({ bars: 2 }), presets);
    expect(rendered).not.toBeNull();
    expect(rendered!.totalBeats).toBe(8); // 2 bars * 4 beatsPerBar
    const kicks = rendered!.notes.filter((n) => n.pitch === KICK).map((n) => n.startTime);
    expect(kicks).toEqual(expect.arrayContaining([0, 2, 4, 6]));
  });

  it("is deterministic for the same inputs", () => {
    const result = patternResult({ bars: 4, velocity: "f" });
    expect(renderStudioResult(result, presets)!.notes).toEqual(renderStudioResult(result, presets)!.notes);
  });

  it("clamps an out-of-range variant index instead of throwing", () => {
    const result = patternResult({ variantIndex: 99, bars: 1 });
    expect(() => renderStudioResult(result, presets)).not.toThrow();
    expect(renderStudioResult(result, presets)).not.toBeNull();
  });

  it("scales the variant's peak velocity to the target preset", () => {
    const loud = renderStudioResult(patternResult({ bars: 1, velocity: "ff" }), presets)!;
    const quiet = renderStudioResult(patternResult({ bars: 1, velocity: "pp" }), presets)!;
    expect(Math.max(...loud.notes.map((n) => n.velocity ?? 0))).toBeGreaterThan(
      Math.max(...quiet.notes.map((n) => n.velocity ?? 0)),
    );
  });

  it("gives every note a short, un-sustained duration", () => {
    const rendered = renderStudioResult(patternResult({ bars: 1 }), presets)!;
    expect(rendered.notes.every((n) => n.duration === 0.25)).toBe(true);
  });

  it("returns null for a pattern with no preset data", () => {
    expect(renderStudioResult(patternResult({ pattern: "dnb", bars: 1 }), presets)).toBeNull();
  });

  it("names the clip with the pattern label and bar count", () => {
    const rendered = renderStudioResult(patternResult({ bars: 8 }), presets)!;
    expect(rendered.name).toBe("Standard · 8 bars");
  });

  it("uses singular 'bar' for a 1-bar clip", () => {
    const rendered = renderStudioResult(patternResult({ bars: 1 }), presets)!;
    expect(rendered.name).toBe("Standard · 1 bar");
  });

  it("applies a transition model to the final bar when requested", () => {
    const plain = renderStudioResult(patternResult({ bars: 2, transitionModel: "none" }), presets)!;
    const cut = renderStudioResult(patternResult({ bars: 2, transitionModel: "cut", transitionBars: 1 }), presets)!;
    expect(cut.notes).not.toEqual(plain.notes);
    // "cut": the final bar (beats 4-8) should be a single hit then silence.
    const finalBar = cut.notes.filter((n) => n.startTime >= 4);
    expect(finalBar.every((n) => n.startTime === 4)).toBe(true);
  });

  it("degrades to no transition rather than throwing for an unrecognized model (e.g. a stale cached payload)", () => {
    const plain = renderStudioResult(patternResult({ bars: 2, transitionModel: "none" }), presets)!;
    const bogus = renderStudioResult(
      // @ts-expect-error deliberately invalid — simulating a payload from before this field existed
      patternResult({ bars: 2, transitionModel: "not-a-real-model" }),
      presets,
    )!;
    expect(bogus.notes).toEqual(plain.notes);
  });

  it("leaves the clip untouched when transitionModel is 'none', regardless of transitionBars", () => {
    const a = renderStudioResult(patternResult({ bars: 2, transitionModel: "none", transitionBars: 1 }), presets)!;
    const b = renderStudioResult(patternResult({ bars: 2, transitionModel: "none", transitionBars: 99 }), presets)!;
    expect(a.notes).toEqual(b.notes);
  });
});

describe("renderStudioResult — outline mode", () => {
  it("spans exactly the outline's beats-per-bar times the requested bars", () => {
    // 2+2+3 = 7, denominator 16 -> cellBeats 0.25 -> beatsPerBar 1.75
    const rendered = renderStudioResult(outlineResult({ bars: 4 }));
    expect(rendered).not.toBeNull();
    expect(rendered!.totalBeats).toBeCloseTo(7); // 4 * 1.75
  });

  it("is deterministic for the same cells", () => {
    const a = renderStudioResult(outlineResult());
    const b = renderStudioResult(outlineResult());
    expect(a!.notes).toEqual(b!.notes);
  });

  it("differs between two different groupings of the same numerator", () => {
    const a = renderStudioResult(outlineResult({ cells: [2, 2, 3] }));
    const b = renderStudioResult(outlineResult({ cells: [3, 2, 2] }));
    expect(a!.notes).not.toEqual(b!.notes);
  });

  it("returns null when no cell is a valid 2 or 3", () => {
    expect(renderStudioResult(outlineResult({ cells: [] }))).toBeNull();
    expect(renderStudioResult(outlineResult({ cells: [5, 7] }))).toBeNull();
  });

  it("drops invalid cell values but keeps valid ones", () => {
    const withJunk = renderStudioResult(outlineResult({ cells: [2, 5, 3] }));
    const clean = renderStudioResult(outlineResult({ cells: [2, 3] }));
    expect(withJunk!.totalBeats).toBe(clean!.totalBeats);
  });

  it("names the clip with the meter and grouping", () => {
    const rendered = renderStudioResult(outlineResult({ cells: [2, 2, 3], bars: 4 }));
    expect(rendered!.name).toBe("7/16 (2+2+3) · 4 bars");
  });

  it("scales groove velocity to the target preset", () => {
    const loud = renderStudioResult(outlineResult({ velocity: "ff" }))!;
    const quiet = renderStudioResult(outlineResult({ velocity: "pp" }))!;
    expect(Math.max(...loud.notes.map((n) => n.velocity ?? 0))).toBeGreaterThan(
      Math.max(...quiet.notes.map((n) => n.velocity ?? 0)),
    );
  });

  it("applies a transition model in outline mode too", () => {
    const plain = renderStudioResult(outlineResult({ bars: 4, transitionModel: "none" }))!;
    const buildUp = renderStudioResult(outlineResult({ bars: 4, transitionModel: "buildUp", transitionBars: 1 }))!;
    expect(buildUp.notes).not.toEqual(plain.notes);
  });

  describe("cell voices", () => {
    it("plays kick/snare on the cells they're assigned to", () => {
      const rendered = renderStudioResult(outlineResult({ cells: [2, 2, 3], cellVoices: ["kick", "snare", "kick"], bars: 1 }))!;
      // Cell downbeats at 0, 0.5, 1 (cellBeats 0.25).
      expect(rendered.notes.find((n) => n.startTime === 0)?.pitch).toBe(KICK);
      expect(rendered.notes.find((n) => n.startTime === 0.5)?.pitch).toBe(SNARE);
      expect(rendered.notes.find((n) => n.startTime === 1)?.pitch).toBe(KICK);
    });

    it("defaults unassigned cells to a plain hat accent", () => {
      const rendered = renderStudioResult(outlineResult({ cells: [2, 2, 3], cellVoices: [], bars: 1 }))!;
      expect(rendered.notes.every((n) => n.pitch === HAT)).toBe(true);
    });
  });
});

describe("renderStudioResult — meter-change pickup", () => {
  it("changes the tail of the clip when nextGridDenominator is set alongside a transition", () => {
    const without = renderStudioResult(patternResult({ bars: 2, transitionModel: "cut" }), fixturePresets())!;
    const withPickup = renderStudioResult(
      patternResult({ bars: 2, transitionModel: "cut", nextGridDenominator: 8 }),
      fixturePresets(),
    )!;
    expect(withPickup.notes).not.toEqual(without.notes);
  });

  it("has no effect when transitionModel is 'none'", () => {
    const without = renderStudioResult(patternResult({ bars: 2, transitionModel: "none" }), fixturePresets())!;
    const withPickup = renderStudioResult(
      patternResult({ bars: 2, transitionModel: "none", nextGridDenominator: 8 }),
      fixturePresets(),
    )!;
    expect(withPickup.notes).toEqual(without.notes);
  });
});
