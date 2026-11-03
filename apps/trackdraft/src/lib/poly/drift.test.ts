import { describe, expect, it } from "vitest";
import { DRIFT_GRID, driftLabel, driftOf } from "./drift";

describe("driftOf", () => {
  it("finds nothing wrong with notes on the grid", () => {
    expect(driftOf([0, 0.25, 0.5, 1, 3.75])).toEqual({
      offGrid: 0,
      worst: 0,
      lines: [],
    });
  });

  it("measures how far a swung hit sits from the line", () => {
    // Full swing: the off-eighth lands at 0.75 — which is on the grid. Half
    // swing lands at 0.625, a 32nd late.
    expect(driftOf([0, 0.625]).offGrid).toBe(1);
    expect(driftOf([0, 0.625]).worst).toBeCloseTo(0.125, 6);
  });

  it("counts every hit a coarse rate pushed off, and the worst one", () => {
    const report = driftOf([0, 1 / 3, 2 / 3, 1]);
    expect(report.offGrid).toBe(2);
    expect(report.worst).toBeCloseTo(0.0833, 3);
  });

  it("names the lines an off-grid hit would snap to", () => {
    expect(driftOf([0.1, 0.4]).lines).toEqual([0, 0.5]);
  });

  it("treats micro-timing as feel, not drift", () => {
    // The corpus' pools sit a few thousandths off the grid; that is not an
    // error to report.
    expect(driftOf([0.2500000001]).offGrid).toBe(0);
    expect(driftOf([0.0116, 0.275, 0.52]).offGrid).toBe(0);
    expect(driftOf([0.0116, 0.275, 0.52]).worst).toBe(0);
  });

  it("still reports a push bigger than a fifth of a step", () => {
    // 0.31 is 0.06 from the 0.25 line — past the fifth-of-a-step tolerance.
    expect(driftOf([0.31]).offGrid).toBe(1);
  });

  it("gives up rather than dividing by a zero grid", () => {
    expect(driftOf([0.1, 0.2], 0)).toEqual({ offGrid: 0, worst: 0, lines: [] });
  });
});

describe("driftLabel", () => {
  it("says nothing when nothing drifted", () => {
    expect(driftLabel(driftOf([0, 1]))).toBe("");
  });

  it("names the count and the worst offset", () => {
    expect(driftLabel(driftOf([0.625]))).toBe("1 off-grid (up to 0.13 beat)");
  });

  it("mentions material that fell off the end", () => {
    expect(driftLabel({ offGrid: 0, worst: 0 }, 3)).toBe("3 past the end");
    expect(driftLabel(driftOf([0.625]), 2)).toBe(
      "1 off-grid (up to 0.13 beat) · 2 past the end",
    );
  });

  it("measures against the canvas's own edit grid", () => {
    expect(DRIFT_GRID).toBe(0.25);
  });
});
