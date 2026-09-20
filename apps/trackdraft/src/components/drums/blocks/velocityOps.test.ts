import { describe, expect, it } from "vitest";
import { scaleVelocity, velocityOpFactor, type VelocityOpContext } from "./velocityOps";

const ctx = (stepCount: number, peakVelocity = 100, seed?: string): VelocityOpContext =>
  ({ stepCount, peakVelocity, seed });

describe("velocityOps — selection shaping factors", () => {
  it("ramps linearly between 0.55 and 1 in both directions", () => {
    const c = ctx(4);
    expect(velocityOpFactor({ kind: "ramp", dir: "up" }, 0, c)).toBeCloseTo(0.55, 6);
    expect(velocityOpFactor({ kind: "ramp", dir: "up" }, 3, c)).toBeCloseTo(1, 6);
    expect(velocityOpFactor({ kind: "ramp", dir: "up" }, 1, c))
      .toBeGreaterThan(velocityOpFactor({ kind: "ramp", dir: "up" }, 0, c));
    expect(velocityOpFactor({ kind: "ramp", dir: "down" }, 0, c)).toBeCloseTo(1, 6);
    expect(velocityOpFactor({ kind: "ramp", dir: "down" }, 3, c)).toBeCloseTo(0.55, 6);
  });

  it("accents every N: the stride keeps full value, the rest duck", () => {
    const c = ctx(8);
    expect(velocityOpFactor({ kind: "accents", every: 4 }, 0, c)).toBe(1);
    expect(velocityOpFactor({ kind: "accents", every: 4 }, 4, c)).toBe(1);
    expect(velocityOpFactor({ kind: "accents", every: 4 }, 3, c)).toBe(0.7);
    // degenerate strides clamp to >= 2
    expect(velocityOpFactor({ kind: "accents", every: 0 }, 0, c)).toBe(1);
    expect(velocityOpFactor({ kind: "accents", every: 0 }, 1, c)).toBe(0.7);
  });

  it("alternates even/odd", () => {
    const c = ctx(4);
    expect(velocityOpFactor({ kind: "alternate" }, 0, c)).toBe(1);
    expect(velocityOpFactor({ kind: "alternate" }, 1, c)).toBe(0.65);
    expect(velocityOpFactor({ kind: "alternate" }, 2, c)).toBe(1);
  });

  it("humanize is seeded: deterministic, bounded, seed-sensitive", () => {
    const c = ctx(8, 100, "sec:kick");
    for (let i = 0; i < 8; i++) {
      const f = velocityOpFactor({ kind: "humanize" }, i, c);
      expect(f).toBe(velocityOpFactor({ kind: "humanize" }, i, c)); // idempotent
      expect(f).toBeGreaterThan(0.87);
      expect(f).toBeLessThan(1.13);
    }
    expect(velocityOpFactor({ kind: "humanize" }, 3, ctx(8, 100, "sec:snare")))
      .not.toBe(velocityOpFactor({ kind: "humanize" }, 3, c));
  });

  it("scale maps the peak to the target, capped by the MIDI ceiling", () => {
    expect(velocityOpFactor({ kind: "scale", target: 90 }, 0, ctx(4, 100))).toBeCloseTo(0.9, 6);
    expect(velocityOpFactor({ kind: "scale", target: 120 }, 0, ctx(4, 100))).toBeCloseTo(1.2, 6);
    expect(velocityOpFactor({ kind: "scale", target: 127 }, 0, ctx(4, 120))).toBeCloseTo(127 / 120, 6);
    expect(velocityOpFactor({ kind: "scale", target: 90 }, 0, ctx(4, 0))).toBe(1);
  });

  it("scaleVelocity rounds and clamps to 1..127", () => {
    expect(scaleVelocity(100, 0.905)).toBe(91);
    expect(scaleVelocity(100, 2)).toBe(127);
    expect(scaleVelocity(1, 0.1)).toBe(1);
  });
});
