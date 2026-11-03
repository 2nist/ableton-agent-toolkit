import { describe, expect, it } from "vitest";
import { fitHitsToSection } from "../src/spanFit.js";

const hit = (beat: number, extra: Record<string, unknown> = {}) => ({
  beat,
  pitch: 36,
  velocity: 100,
  ...extra,
});

describe("fitHitsToSection", () => {
  it("gives a hit the default gate when it authored none", () => {
    expect(fitHitsToSection([hit(0)], 16, 0.25)[0].duration).toBe(0.25);
  });

  it("keeps an authored gate that fits", () => {
    expect(fitHitsToSection([hit(0, { duration: 2 })], 16, 0.25)[0].duration).toBe(
      2,
    );
  });

  it("clips a hit to the room left in the section", () => {
    // The bug this exists for: a closed hat on the last 16th rang past the bar.
    expect(
      fitHitsToSection([hit(15.875)], 16, 0.25)[0].duration,
    ).toBeCloseTo(0.125, 6);
  });

  it("drops a hit that starts exactly on the boundary", () => {
    // That hit belongs to the next section, which plans its own downbeat.
    expect(fitHitsToSection([hit(16)], 16, 0.25)).toEqual([]);
  });

  it("keeps a boundary hit when the section is longer", () => {
    expect(fitHitsToSection([hit(16)], 32, 0.25)).toHaveLength(1);
  });

  it("leaves beats section-relative for the caller to offset", () => {
    const [only] = fitHitsToSection([hit(3.5)], 8, 0.25);
    expect(only.beat).toBe(3.5);
    expect(only.pitch).toBe(36);
    expect(only.velocity).toBe(100);
  });

  it("preserves order, so a sorted plan stays sorted", () => {
    const beats = fitHitsToSection(
      [hit(0), hit(1), hit(2.5)],
      8,
      0.25,
    ).map((entry) => entry.beat);
    expect(beats).toEqual([0, 1, 2.5]);
  });

  it("returns nothing for an empty plan", () => {
    expect(fitHitsToSection([], 8, 0.25)).toEqual([]);
  });
});
