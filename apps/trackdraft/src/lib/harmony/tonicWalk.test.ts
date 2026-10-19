import { describe, expect, it } from "vitest";
import { buildWalk, degreeAt, DIRS } from "./honeycombWalk";
import { buildRegionWalk, MODULATION_SHIFT } from "./tonicWalk";

const steps = (degrees: number[], regionOf: (index: number) => number = () => 0) =>
  degrees.map((deg, index) => ({ deg, region: regionOf(index) }));

describe("MODULATION_SHIFT", () => {
  it("preserves the lattice's degree invariant", () => {
    expect((3 * MODULATION_SHIFT.q + MODULATION_SHIFT.r) % 7).toBe(0);
  });
});

describe("buildRegionWalk", () => {
  it("matches buildWalk exactly when there is one region", () => {
    const degrees = [0, 5, 3, 4, 0, 5];
    const plain = buildWalk(degrees.map((deg) => ({ deg } as never)));
    const regioned = buildRegionWalk(steps(degrees));
    expect(regioned.walk).toEqual(plain);
    expect(regioned.seams).toEqual([]);
  });

  it("keeps every chord on a cell of its own degree after a modulation", () => {
    // I–IV–V–I in the old key, then I–IV–V–I in the new one.
    const degrees = [0, 3, 4, 0, 0, 3, 4, 0];
    const { walk, regionOfStep } = buildRegionWalk(steps(degrees, (i) => (i < 4 ? 0 : 1)));
    walk.forEach((cell, index) => {
      expect(degreeAt(cell.q, cell.r)).toBe(degrees[index]);
    });
    expect(regionOfStep).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("moves the walk to a new area at the modulation instead of reusing cells", () => {
    // The same three chords before and after: without re-rooting they would
    // land on the same three hexes, which is the cramming this fixes.
    const degrees = [0, 3, 4, 0, 3, 4];
    const flat = buildWalk(degrees.map((deg) => ({ deg } as never)));
    const { walk } = buildRegionWalk(steps(degrees, (i) => (i < 3 ? 0 : 1)));
    const firstPass = flat.slice(0, 3);
    const secondPass = walk.slice(3);
    for (const cell of secondPass) {
      expect(firstPass).not.toContainEqual(cell);
    }
  });

  it("records one seam per modulation, from the old cell to its translated twin", () => {
    const { seams } = buildRegionWalk(steps([0, 3, 1, 3], (i) => (i < 2 ? 0 : 1)));
    expect(seams).toHaveLength(1);
    expect(seams[0].step).toBe(2);
    expect(seams[0].region).toBe(1);
    expect(seams[0].to).toEqual({
      q: seams[0].from.q + MODULATION_SHIFT.q,
      r: seams[0].from.r + MODULATION_SHIFT.r,
    });
  });

  it("handles a modulation back home, so A→B→A stays three distinct areas", () => {
    const degrees = [0, 3, 0, 3, 0, 3];
    const { walk, seams } = buildRegionWalk(steps(degrees, (i) => (i < 2 ? 0 : i < 4 ? 1 : 2)));
    expect(seams).toHaveLength(2);
    // Third region translates again from the second, not back onto the first.
    expect(walk[4]).not.toEqual(walk[0]);
    walk.forEach((cell, index) => expect(degreeAt(cell.q, cell.r)).toBe(degrees[index]));
  });

  it("anchors each region at the cell the walk enters it by", () => {
    const { anchors, walk, seams } = buildRegionWalk(steps([0, 3, 2, 5], (i) => (i < 2 ? 0 : 1)));
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toEqual({ region: 0, cell: walk[0] });
    expect(anchors[1].region).toBe(1);
    expect(anchors[1].cell).toEqual(seams[0].to);
  });

  it("stays a connected hex neighbourhood across the seam", () => {
    // The first cell of the new region must be a neighbour of the translated
    // cursor (or the cursor itself), so the path never teleports mid-region.
    const { walk, seams } = buildRegionWalk(steps([0, 3, 4, 2], (i) => (i < 3 ? 0 : 1)));
    const cursor = seams[0].to;
    const next = walk[seams[0].step];
    const adjacent =
      (next.q === cursor.q && next.r === cursor.r) ||
      DIRS.some(([a, b]) => cursor.q + a === next.q && cursor.r + b === next.r);
    expect(adjacent).toBe(true);
  });

  it("returns nothing for an empty progression", () => {
    expect(buildRegionWalk([])).toEqual({ walk: [], regionOfStep: [], seams: [], anchors: [] });
  });
});
