import { describe, expect, it } from "vitest";
import {
  FRAME_BUDGET_MS,
  summariseFrames,
  sweepCamera,
  frameDeltas,
} from "./perfProbe";

describe("summariseFrames", () => {
  it("says nothing about a run with no frames", () => {
    const summary = summariseFrames([]);
    expect(summary.frames).toBe(0);
    expect(summary.fps).toBe(0);
    expect(summary.overBudget).toBe(0);
  });

  it("reports percentiles that match the sorted deltas", () => {
    const deltas = [16, 17, 18, 16, 40, 16, 16, 17, 20, 16];
    const summary = summariseFrames(deltas);
    expect(summary.frames).toBe(10);
    // An even sample count lands on the upper median: five 16s, then 17.
    expect(summary.p50).toBe(17);
    expect(summary.max).toBe(40);
    expect(summary.p50).toBeLessThanOrEqual(summary.p90);
    expect(summary.p90).toBeLessThanOrEqual(summary.p95);
    expect(summary.p95).toBeLessThanOrEqual(summary.max);
  });

  it("counts the frames a user would feel", () => {
    const summary = summariseFrames([16, 16, 16, 16, 33]);
    expect(summary.overBudget).toBe(1);
    expect(summary.overBudgetShare).toBeCloseTo(0.2, 6);
  });

  it("does not call a perfect 60fps frame late", () => {
    const deltas = Array.from({ length: 60 }, () => FRAME_BUDGET_MS);
    expect(summariseFrames(deltas).overBudget).toBe(0);
    // …nor a 16.7ms one, which is what a real rAF delta reads as.
    expect(summariseFrames([16.7, 16.7, 16.8]).overBudget).toBe(0);
    // …but a skipped vsync is late.
    expect(summariseFrames([16.7, 33.4]).overBudget).toBe(1);
  });

  it("turns deltas into an average frame rate", () => {
    // Ten 16.7ms frames is one second at 60fps, give or take.
    const deltas = Array.from({ length: 60 }, () => FRAME_BUDGET_MS);
    expect(summariseFrames(deltas).fps).toBeCloseTo(60, 3);
  });

  it("does not mutate the caller's list", () => {
    const deltas = [30, 10, 20];
    summariseFrames(deltas);
    expect(deltas).toEqual([30, 10, 20]);
  });
});

describe("sweepCamera", () => {
  const world = { x: 0, y: 0, w: 40_000, h: 750 };
  const viewport = { width: 900, height: 700 };

  it("starts at the beginning of the song and ends back there", () => {
    const start = sweepCamera(0, world, viewport);
    const end = sweepCamera(1, world, viewport);
    const middle = sweepCamera(0.45, world, viewport);
    // Both ends sit in the song's first few columns; the middle does not.
    expect(start.x).toBeLessThan(world.x + 2_000);
    expect(end.x).toBeLessThan(world.x + 2_000);
    expect(middle.x).toBeGreaterThan(world.x + world.w / 2);
  });

  it("reaches the far end in the middle of the run", () => {
    const early = sweepCamera(0.1, world, viewport);
    const late = sweepCamera(0.44, world, viewport);
    expect(late.x).toBeGreaterThan(early.x);
  });

  it("zooms out for the overview and comes back in for the pan home", () => {
    const wide = sweepCamera(0.2, world, viewport);
    const narrow = sweepCamera(0.9, world, viewport);
    expect(narrow.zoom).toBeLessThan(wide.zoom);
    expect(narrow.zoom).toBeGreaterThan(0);
  });

  it("never leaves the world, however far the script goes", () => {
    for (let step = 0; step <= 20; step += 1) {
      const camera = sweepCamera(step / 20, world, viewport);
      expect(camera.x).toBeGreaterThanOrEqual(world.x);
      expect(camera.x).toBeLessThanOrEqual(world.x + world.w);
    }
  });

  it("clamps a t outside the run rather than extrapolating", () => {
    expect(sweepCamera(-1, world, viewport)).toEqual(
      sweepCamera(0, world, viewport),
    );
    expect(sweepCamera(2, world, viewport)).toEqual(
      sweepCamera(1, world, viewport),
    );
  });
});

describe("frameDeltas", () => {
  it("drops the delta that spans the mount", () => {
    // Samples: click at 0, first painted frame at 400 (the mount), then 16, 16.
    // A 300 ms warm-up excludes the montage entirely.
    expect(frameDeltas([0, 400, 416, 432], 300)).toEqual([16, 16]);
  });

  it("keeps everything after the warm-up window", () => {
    const samples = [0, 100, 300, 1200, 1216, 1232];
    expect(frameDeltas(samples, 1000)).toEqual([16, 16]);
  });

  it("measures the mount when no warm-up is asked for", () => {
    // No warm-up means the click's frame is measured with the rest — the
    // behaviour §S1.11 exists to avoid, kept explicit so the default is not a
    // silent one.
    expect(frameDeltas([0, 20, 40], 0)).toEqual([20]);
  });

  it("returns nothing when the run ended inside the warm-up", () => {
    // The lesson of §S1.11: a run that never got going has NO measurement, and
    // reporting p50 of its one mount frame is worse than reporting nothing.
    expect(frameDeltas([0, 500, 900], 1000)).toEqual([]);
    expect(frameDeltas([0], 1000)).toEqual([]);
    expect(frameDeltas([], 1000)).toEqual([]);
  });

  it("keeps a stall that happened after warm-up", () => {
    // Warm-up must not hide the tail — the tail is the finding.
    expect(frameDeltas([0, 100, 1100, 2100], 1000)).toEqual([1000]);
  });
});
