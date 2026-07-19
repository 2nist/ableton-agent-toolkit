import { describe, expect, it } from "vitest";
import { applyGroove, extractGroove } from "../src/groove.js";
import type { DrumNote } from "../src/types.js";

describe("extractGroove", () => {
  it("measures per-slot timing offsets", () => {
    // Hats consistently 0.02 behind the offbeat 8ths, kick dead on the grid.
    const notes: DrumNote[] = [
      { beat: 0, pitch: 36, velocity: 110 },
      { beat: 0.52, pitch: 42, velocity: 70 },
      { beat: 1.52, pitch: 42, velocity: 70 },
      { beat: 2, pitch: 36, velocity: 110 },
      { beat: 2.52, pitch: 42, velocity: 70 },
      { beat: 3.52, pitch: 42, velocity: 70 },
    ];
    const groove = extractGroove(notes, 4, 0.5);

    const kickSlot = groove.points.find((p) => p.gridBeat === 0)!;
    expect(kickSlot.offset).toBeCloseTo(0, 5);

    const hatSlot = groove.points.find((p) => p.gridBeat === 0.5)!;
    expect(hatSlot.offset).toBeCloseTo(0.02, 5);
  });

  it("measures velocity emphasis relative to the mean", () => {
    const notes: DrumNote[] = [
      { beat: 0, pitch: 36, velocity: 120 },
      { beat: 1, pitch: 42, velocity: 60 },
      { beat: 2, pitch: 36, velocity: 120 },
      { beat: 3, pitch: 42, velocity: 60 },
    ];
    const groove = extractGroove(notes, 4, 1);
    expect(groove.points.find((p) => p.gridBeat === 0)!.velocityFactor).toBeGreaterThan(1);
    expect(groove.points.find((p) => p.gridBeat === 1)!.velocityFactor).toBeLessThan(1);
  });

  it("folds tiled clips onto one loop", () => {
    const oneBar: DrumNote[] = [{ beat: 0.51, pitch: 42, velocity: 70 }];
    const twoBars: DrumNote[] = [
      { beat: 0.51, pitch: 42, velocity: 70 },
      { beat: 4.51, pitch: 42, velocity: 70 },
    ];
    expect(extractGroove(twoBars, 4, 0.5).points).toEqual(extractGroove(oneBar, 4, 0.5).points);
  });

  it("assigns hits just before the loop seam to slot 0, not the last slot", () => {
    const notes: DrumNote[] = [{ beat: 3.99, pitch: 36, velocity: 100 }];
    const groove = extractGroove(notes, 4, 0.5);
    const slot0 = groove.points.find((p) => p.gridBeat === 0)!;
    expect(slot0).toBeDefined();
    expect(slot0.offset).toBeCloseTo(-0.01, 5);
  });
});

describe("applyGroove", () => {
  const groove = extractGroove(
    [
      { beat: 0, pitch: 36, velocity: 120 },
      { beat: 0.53, pitch: 42, velocity: 60 },
      { beat: 1, pitch: 38, velocity: 100 },
      { beat: 1.53, pitch: 42, velocity: 60 },
    ],
    2,
    0.5,
  );

  it("moves grid notes onto the measured pocket", () => {
    const bass: DrumNote[] = [
      { beat: 0.5, pitch: 40, velocity: 90 },
      { beat: 2.5, pitch: 40, velocity: 90 }, // same slot, next loop
    ];
    const grooved = applyGroove(bass, groove);
    expect(grooved[0].beat).toBeCloseTo(0.53, 4);
    expect(grooved[1].beat).toBeCloseTo(2.53, 4);
  });

  it("scales with strength", () => {
    const bass: DrumNote[] = [{ beat: 0.5, pitch: 40, velocity: 90 }];
    expect(applyGroove(bass, groove, { strength: 0.5 })[0].beat).toBeCloseTo(0.515, 4);
    expect(applyGroove(bass, groove, { strength: 0 })[0]).toEqual(bass[0]);
  });

  it("leaves notes on slots the drums never hit untouched", () => {
    const sparse = extractGroove([{ beat: 0, pitch: 36, velocity: 100 }], 4, 0.25);
    const grooved = applyGroove([{ beat: 1.75, pitch: 40, velocity: 90 }], sparse);
    expect(grooved[0]).toEqual({ beat: 1.75, pitch: 40, velocity: 90 });
  });

  it("applies velocity emphasis and can be told not to", () => {
    const stab: DrumNote[] = [{ beat: 0, pitch: 40, velocity: 80 }];
    expect(applyGroove(stab, groove)[0].velocity).toBeGreaterThan(80);
    expect(applyGroove(stab, groove, { applyVelocity: false })[0].velocity).toBe(80);
  });
});
