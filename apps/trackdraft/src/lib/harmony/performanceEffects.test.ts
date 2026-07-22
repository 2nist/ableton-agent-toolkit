import { describe, it, expect } from "vitest";
import {
  applyStrum,
  applyPulse,
  applyArp,
  applyPerformanceEffect,
  type PerfNote,
} from "./performanceEffects";

function makeNotes(pitches: number[], startTime = 0.1, duration = 1): PerfNote[] {
  return pitches.map((pitch, i) => ({
    pitch,
    startTime: startTime + i * 0.25,
    duration,
    velocity: 96,
  }));
}

describe("applyStrum", () => {
  it("staggers notes outward from lowest pitch", () => {
    const notes = makeNotes([48, 52, 55, 60], 0, 1);
    const effect = { style: "strum" as const, params: { strumMs: 40 } };
    const result = applyStrum(notes, effect, { seed: "test-a" });
    expect(result).toHaveLength(4);
    expect(result[0].startTime).toBeCloseTo(0, 3);
    expect(result[3].startTime).toBeGreaterThan(0);
    expect(result[3].duration).toBeLessThan(1);
  });

  it("returns notes unchanged for single-note input", () => {
    const notes = makeNotes([48], 0, 1);
    const effect = { style: "strum" as const, params: {} };
    const result = applyStrum(notes, effect, { seed: "test-b" });
    expect(result).toEqual(notes);
  });

  it("is deterministic with same seed", () => {
    const notes = makeNotes([48, 52, 55, 60], 0, 1);
    const effect = { style: "strum" as const, params: { strumMs: 50 } };
    const a = applyStrum(notes, effect, { seed: "det" });
    const b = applyStrum(notes, effect, { seed: "det" });
    expect(a).toEqual(b);
  });
});

describe("applyPulse", () => {
  it("re-triggers notes at the subdivision rate", () => {
    // 3 notes, subdivision=4 → 12 hits
    const notes = makeNotes([48, 52, 55], 0.1, 1);
    const effect = { style: "pulse" as const, params: { subdivision: 4 } };
    const result = applyPulse(notes, effect, { seed: "pulse-a" });
    expect(result).toHaveLength(12);
    // first hit is at the original start time
    expect(result[0].startTime).toBe(0.1);
    // each hit is duration/subdivision long
    expect(result[0].duration).toBeCloseTo(0.25);
  });

  it("handles empty input", () => {
    const effect = { style: "pulse" as const, params: { subdivision: 4 } };
    const result = applyPulse([], effect, { seed: "empty" });
    expect(result).toEqual([]);
  });

  it("is deterministic with same seed", () => {
    const notes = makeNotes([48, 52, 55], 0.1, 1);
    const effect = { style: "pulse" as const, params: { subdivision: 4 } };
    const a = applyPulse(notes, effect, { seed: "det" });
    const b = applyPulse(notes, effect, { seed: "det" });
    expect(a).toEqual(b);
  });
});

describe("applyArp", () => {
  it("cycles through chord notes one at a time", () => {
    const notes = makeNotes([48, 52, 55], 0, 1);
    const effect = { style: "arp" as const, params: { subdivision: 4 } };
    const result = applyArp(notes, effect, { seed: "arp-a" });
    // 4 steps cycling through 3 notes
    expect(result).toHaveLength(4);
    // Step 0: lowest pitch (48)
    expect(result[0].pitch).toBe(48);
    // Step 1: next pitch (52)
    expect(result[1].pitch).toBe(52);
    // Step 2: highest (55)
    expect(result[2].pitch).toBe(55);
    // Step 3: wraps to lowest (48)
    expect(result[3].pitch).toBe(48);
    // Each step is 0.25s apart for a 1s chord with subdivision=4
    expect(result[1].startTime - result[0].startTime).toBeCloseTo(0.25);
    expect(result[0].duration).toBeCloseTo(0.25);
  });

  it("returns notes unchanged for single-note input (still cycles that one note)", () => {
    const notes = makeNotes([48], 0, 1);
    const effect = { style: "arp" as const, params: { subdivision: 4 } };
    const result = applyArp(notes, effect, { seed: "single" });
    expect(result).toHaveLength(4);
    result.forEach((n) => expect(n.pitch).toBe(48));
  });

  it("handles empty input", () => {
    const effect = { style: "arp" as const, params: { subdivision: 4 } };
    const result = applyArp([], effect, { seed: "empty" });
    expect(result).toEqual([]);
  });
});

describe("applyPerformanceEffect (dispatcher)", () => {
  it("returns notes unchanged when no effect is present", () => {
    const notes = makeNotes([48, 52, 55], 0.1, 1);
    const result = applyPerformanceEffect(notes, undefined, "any");
    expect(result).toEqual(notes);
  });

  it("dispatches to strum", () => {
    const notes = makeNotes([48, 52, 55, 60], 0, 1);
    const effect = { style: "strum" as const, params: { strumMs: 40 } };
    const result = applyPerformanceEffect(notes, effect, "seed");
    expect(result[3].startTime).toBeGreaterThan(0);
  });

  it("dispatches to pulse", () => {
    const notes = makeNotes([48, 52, 55], 0.1, 1);
    const effect = { style: "pulse" as const, params: { subdivision: 4 } };
    const result = applyPerformanceEffect(notes, effect, "seed");
    expect(result).toHaveLength(12); // 3 notes × 4 subdivision
  });

  it("dispatches to arp", () => {
    const notes = makeNotes([48, 52, 55], 0, 1);
    const effect = { style: "arp" as const, params: { subdivision: 4 } };
    const result = applyPerformanceEffect(notes, effect, "seed");
    expect(result).toHaveLength(4); // 4 steps, one note at a time
    // Cycling low-high
    expect(result[0].pitch).toBe(48);
    expect(result[2].pitch).toBe(55);
  });
});