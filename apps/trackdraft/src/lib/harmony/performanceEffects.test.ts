import { describe, it, expect } from "vitest";
import {
  applyStrum,
  applyPulse,
  applyLegato,
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
  it("modulates velocity in a triangle wave pattern", () => {
    const notes = makeNotes([48, 52, 55], 0.1, 1);
    const effect = { style: "pulse" as const, params: { subdivision: 4 } };
    const result = applyPulse(notes, effect, { seed: "pulse-a" });
    expect(result).toHaveLength(3);
    expect(result[0].velocity).not.toBe(96);
    expect(result[0].velocity).toBeGreaterThan(1);
    expect(result[0].velocity).toBeLessThanOrEqual(127);
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

describe("applyLegato", () => {
  it("extends durations to overlap next notes when there is a gap", () => {
    const notes = [
      { pitch: 48, startTime: 0, duration: 2, velocity: 96 },
      { pitch: 52, startTime: 2, duration: 1, velocity: 96 },
    ];
    const effect = { style: "legato" as const, params: { overlapBeats: 0.1 } };
    const result = applyLegato(notes, effect, { seed: "legato-a" });
    // gap is 0 (2-2), so duration = 2 + 0 + 0.1 + ~0.01 jitter
    expect(result[0].duration).toBeGreaterThan(2.08);
    expect(result[0].duration).toBeLessThan(2.15);
    expect(result[1].duration).toBe(1); // last note unchanged
  });

  it("returns single-note unchanged", () => {
    const notes = makeNotes([48], 0, 1);
    const effect = { style: "legato" as const, params: {} };
    const result = applyLegato(notes, effect, { seed: "single" });
    expect(result).toHaveLength(1);
  });

  it("extends to overlap back-to-back notes", () => {
    const notes = [
      { pitch: 48, startTime: 0, duration: 1, velocity: 96 },
      { pitch: 52, startTime: 1, duration: 1, velocity: 96 },
    ];
    const effect = { style: "legato" as const, params: { overlapBeats: 0.05 } };
    const result = applyLegato(notes, effect, { seed: "backtoback" });
    // gap is 0, so duration = 1 + 0 + 0.05 + jitter(~0.01)
    expect(result[0].duration).toBeGreaterThan(1.03);
    expect(result[0].duration).toBeLessThan(1.1);
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
    expect(result[0].velocity).not.toBe(96);
  });

  it("dispatches to legato", () => {
    const notes = [
      { pitch: 48, startTime: 0, duration: 1, velocity: 96 },
      { pitch: 52, startTime: 1.2, duration: 1, velocity: 96 },
    ];
    const effect = { style: "legato" as const, params: { overlapBeats: 0.1 } };
    const result = applyPerformanceEffect(notes, effect, "seed");
    expect(result[0].duration).toBeGreaterThan(1);
  });
});
