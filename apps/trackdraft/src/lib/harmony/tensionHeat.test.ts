import { describe, expect, it } from "vitest";
import { tensionHeat, TENSION_NEUTRAL } from "./tensionHeat";

describe("tensionHeat — tension as colour", () => {
  it("draws nothing for a plain diatonic chord", () => {
    // 0.50 is what most chords read as; marking them would be a wash of colour
    // that carries no information.
    expect(tensionHeat(0.5)).toBe(0);
    expect(tensionHeat(0.4)).toBe(0);
    expect(tensionHeat(TENSION_NEUTRAL)).toBe(0);
  });

  it("rises with dissonance and saturates", () => {
    expect(tensionHeat(0.6)).toBeGreaterThan(0);
    expect(tensionHeat(0.7)).toBeGreaterThan(tensionHeat(0.6));
    expect(tensionHeat(0.8)).toBeGreaterThan(tensionHeat(0.7));
    expect(tensionHeat(0.85)).toBe(1);
    expect(tensionHeat(1)).toBe(1);
  });

  it("treats a missing or broken value as neutral rather than throwing", () => {
    expect(tensionHeat(undefined)).toBe(0);
    expect(tensionHeat(Number.NaN)).toBe(0);
    expect(tensionHeat(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
