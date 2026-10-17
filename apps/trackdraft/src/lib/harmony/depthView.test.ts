import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHEAR,
  MIN_DEPTH_OPACITY,
  depthOpacity,
  projectDepth,
  shearIsSafe,
} from "./depthView";
import { hexToPixel } from "./honeycombWalk";

const SIZE = 34;

describe("projectDepth", () => {
  it("is the plain lattice at depth 0", () => {
    expect(projectDepth(0, 0, 0, SIZE)).toEqual(hexToPixel(0, 0, SIZE));
    expect(projectDepth(2, -1, 0, SIZE)).toEqual(hexToPixel(2, -1, SIZE));
  });

  it("shifts by exactly the shear per step", () => {
    const a = projectDepth(1, 0, 3, SIZE);
    const b = projectDepth(1, 0, 4, SIZE);
    expect(b.x - a.x).toBeCloseTo(DEFAULT_SHEAR.dx);
    expect(b.y - a.y).toBeCloseTo(DEFAULT_SHEAR.dy);
  });

  it("keeps a repeated chord distinct at a new depth", () => {
    const first = projectDepth(0, 0, 0, SIZE);
    const again = projectDepth(0, 0, 1, SIZE);
    expect(again).not.toEqual(first);
  });

  it("accepts a custom shear", () => {
    const point = projectDepth(0, 0, 2, SIZE, { dx: 5, dy: 0 });
    expect(point.x).toBeCloseTo(10);
  });
});

describe("shearIsSafe", () => {
  it("never collapses two (lattice, depth) positions onto one point", () => {
    expect(shearIsSafe(DEFAULT_SHEAR, SIZE, { lattice: 6, depth: 40 })).toBe(true);
    expect(shearIsSafe(DEFAULT_SHEAR, 24)).toBe(true);
    expect(shearIsSafe(DEFAULT_SHEAR, 56)).toBe(true);
  });

  it("rejects a shear that runs along a lattice direction", () => {
    // A pure +x shear equals the (1,0) lattice step once per step.
    expect(shearIsSafe({ dx: SIZE * Math.sqrt(3), dy: 0 }, SIZE, { lattice: 4, depth: 8 })).toBe(false);
  });
});

describe("depthOpacity", () => {
  it("lights every step of a short progression", () => {
    expect(depthOpacity(0, 4)).toBe(1);
    expect(depthOpacity(3, 4)).toBe(1);
  });

  it("fades older steps and keeps the newest brightest", () => {
    const first = depthOpacity(0, 40);
    const mid = depthOpacity(20, 40);
    const last = depthOpacity(39, 40);
    expect(first).toBeLessThan(mid);
    expect(mid).toBeLessThan(last);
    expect(last).toBe(1);
  });

  it("never fades below the floor", () => {
    expect(depthOpacity(0, 500)).toBeGreaterThanOrEqual(MIN_DEPTH_OPACITY);
    expect(depthOpacity(0, 40)).toBe(MIN_DEPTH_OPACITY);
    expect(depthOpacity(0, 1)).toBe(1);
  });
});
