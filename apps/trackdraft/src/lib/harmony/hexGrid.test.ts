import { describe, it, expect } from "vitest";
import { getDiatonicHexCells } from "./hexGrid";

describe("getDiatonicHexCells", () => {
  it("returns exactly one cell per degree 0-6", () => {
    const cells = getDiatonicHexCells();
    expect(cells).toHaveLength(7);
    expect(cells.map((c) => c.degreeIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("includes the origin as degree 0", () => {
    const cells = getDiatonicHexCells();
    const origin = cells.find((c) => c.q === 0 && c.r === 0);
    expect(origin?.degreeIndex).toBe(0);
  });
});
