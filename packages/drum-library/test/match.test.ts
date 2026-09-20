import { describe, expect, it } from "vitest";
import { PRESET_DATA } from "../src/presetData.js";
import { rankPatternMatches } from "../src/match.js";
import type { PackedVariant } from "../src/presetData.js";

const KICK = 36;
const SNARE = 38;
const HAT = 42;

const makeVariant = (notes: Array<[number, number]>): PackedVariant => ({
  lengthBeats: 4,
  beatsPerBar: 4,
  notes: notes.map(([beat, pitch]) => [beat, pitch, 100]),
  source: { origin: "synth", generator: "test" },
});

const candidate = (pattern: "standard" | "driving", index: number, notes: Array<[number, number]>) => ({
  pattern,
  variantIndex: index,
  variant: makeVariant(notes),
});

describe("rankPatternMatches", () => {
  it("scores an exact copy of a candidate at 1.0 with rotation 0", () => {
    const notes: Array<[number, number]> = [[0, KICK], [1, SNARE], [2, KICK], [3, SNARE], [0, HAT], [2, HAT]];
    const results = rankPatternMatches(
      notes.map(([beat, pitch]) => ({ beat, pitch })),
      { candidates: [candidate("standard", 0, notes)] },
    );
    expect(results[0].score).toBe(1);
    expect(results[0].rotation).toBe(0);
    expect(results[0].perLane).toEqual({ kick: 1, snare: 1, hat: 1 });
  });

  it("finds the rotation when the material is the candidate shifted by a half beat", () => {
    const notes: Array<[number, number]> = [[0, KICK], [2, KICK], [1, SNARE], [3, SNARE]];
    const shifted = notes.map(([beat, pitch]) => ({ beat: beat + 0.5, pitch }));
    const results = rankPatternMatches(shifted, { candidates: [candidate("standard", 0, notes)] });
    expect(results[0].score).toBe(1);
    expect(results[0].rotation).toBe(2);
  });

  it("prefers the candidate that matches when two are present", () => {
    const a: Array<[number, number]> = [[0, KICK], [2, SNARE]];
    // b is NOT a rotation of a (extra hits on both lanes) so it can't tie at 1.
    const b: Array<[number, number]> = [[0, KICK], [2, KICK], [1, SNARE], [3, SNARE]];
    const material = a.map(([beat, pitch]) => ({ beat, pitch }));
    const results = rankPatternMatches(material, { candidates: [candidate("driving", 0, b), candidate("standard", 0, a)] });
    expect(results[0].pattern).toBe("standard");
    expect(results[0].score).toBe(1);
    expect(results[1].score).toBeLessThan(1);
  });

  it("folds multi-bar material by phase so repeated bars reinforce and a fill bar does not dominate", () => {
    const notes: Array<[number, number]> = [[0, KICK], [2, KICK], [1, SNARE], [3, SNARE], [0, HAT], [1, HAT], [2, HAT], [3, HAT]];
    const material = [
      ...notes.map(([beat, pitch]) => ({ beat, pitch })),
      ...notes.map(([beat, pitch]) => ({ beat: beat + 4, pitch })),
      // one fill bar with extra hits — must not swamp the loop phases
      ...[0, 0.25, 0.5, 0.75].map((beat) => ({ beat: beat + 8, pitch: KICK })),
    ];
    const results = rankPatternMatches(material, { candidates: [candidate("standard", 0, notes)] });
    expect(results[0].score).toBeGreaterThanOrEqual(0.7);
    expect(results[0].score).toBeLessThan(1);
  });

  it("finds its own variant in the real baked corpus at 1.0", () => {
    const preset = PRESET_DATA.half_time;
    expect(preset).toBeDefined();
    const variantIndex = 1;
    const variant = preset!.variants[variantIndex];
    const material = variant.notes.map(([beat, pitch]) => ({ beat, pitch }));
    const results = rankPatternMatches(material, { top: 3 });
    expect(results[0].score).toBe(1);
    expect(results.some((m) => m.pattern === "half_time" && m.variantIndex === variantIndex && m.score === 1)).toBe(true);
  });

  it("restricts candidates via the patterns option", () => {
    const notes: Array<[number, number]> = [[0, KICK], [2, KICK]];
    const results = rankPatternMatches(notes.map(([beat, pitch]) => ({ beat, pitch })), {
      patterns: ["kick_only"],
      top: 50,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((m) => m.pattern === "kick_only")).toBe(true);
  });
});
