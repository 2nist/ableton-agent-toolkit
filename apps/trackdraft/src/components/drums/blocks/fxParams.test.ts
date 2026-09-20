import { describe, expect, it } from "vitest";
import { FX_PARAMS, FX_SPECS, normalizeFx } from "./fxParams";

describe("fxParams — range FX units (mirrors @drum/library applyRangeFx)", () => {
  it("round-trips every meter fraction through the specs, inside range", () => {
    for (const id of FX_PARAMS) {
      const spec = FX_SPECS[id];
      for (const f of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const v = spec.fromFrac(f);
        expect(v).toBeGreaterThanOrEqual(spec.min);
        expect(v).toBeLessThanOrEqual(spec.max);
        expect(spec.toFrac(v)).toBeCloseTo(f, 2);
      }
    }
  });

  it("formats swing on the classic scale — 0 = straight, full = 67% (triplet)", () => {
    expect(FX_SPECS.swing.format(0)).toBe("0%");
    expect(FX_SPECS.swing.format(1)).toBe("67%");
    expect(FX_SPECS.swing.format(0.12)).toBe("8%");
  });

  it("formats humanize/quantize as plain percents and velCurve soft/hard", () => {
    expect(FX_SPECS.humanize.format(0.3)).toBe("30%");
    expect(FX_SPECS.quantize.format(0.9)).toBe("90%");
    expect(FX_SPECS.velCurve.format(0)).toBe("linear");
    expect(FX_SPECS.velCurve.format(0.5)).toBe("hard 50%");
    expect(FX_SPECS.velCurve.format(-0.4)).toBe("soft 40%");
    // bipolar meter: rest in the middle, poles at the edges
    expect(FX_SPECS.velCurve.toFrac(0)).toBe(0.5);
    expect(FX_SPECS.velCurve.toFrac(-1)).toBe(0);
    expect(FX_SPECS.velCurve.toFrac(1)).toBe(1);
  });

  it("normalizeFx drops rest fields, clamps, and returns undefined when empty", () => {
    expect(normalizeFx(undefined)).toBeUndefined();
    expect(normalizeFx({})).toBeUndefined();
    expect(normalizeFx({ swing: 0, humanize: 0, velCurve: 0 })).toBeUndefined();
    expect(normalizeFx({ swing: 0.5, quantize: 0 })).toEqual({ swing: 0.5 });
    // out-of-range values clamp; clamped-to-rest fields drop entirely
    expect(normalizeFx({ swing: 5, quantize: -3, velCurve: -5 })).toEqual({ swing: 1, velCurve: -1 });
    expect(normalizeFx({ velCurve: -0.25 })).toEqual({ velCurve: -0.25 });
  });
});
