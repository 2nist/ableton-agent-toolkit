import { describe, expect, it } from "vitest";
import {
  PLACEMENT_SNAP,
  clampPlacement,
  isPlaced,
  placementKey,
  placedRect,
  resolvePlacement,
  snapPlacement,
  tetherLine,
} from "./placements";
import { PLACEMENT_ROOM, POLY_HEIGHT, POLY_TOP, worldBounds } from "./layout";

const node = { x: 100, y: -300, w: 384, h: 600 };

describe("snapPlacement", () => {
  it("rounds to the placement grid", () => {
    expect(
      snapPlacement(PLACEMENT_SNAP * 2 + 5, PLACEMENT_SNAP * 3 + 5),
    ).toEqual({
      dx: PLACEMENT_SNAP * 2,
      dy: PLACEMENT_SNAP * 3,
    });
  });

  it("will not lift a section above its own lane stack", () => {
    // Upward would put the band under the ruler and its frame label off-screen.
    expect(snapPlacement(0, -240)).toEqual({ dx: 0, dy: 0 });
    expect(snapPlacement(48, -24)).toEqual({ dx: 48, dy: 0 });
    expect(snapPlacement(0, 120)).toEqual({ dx: 0, dy: 120 });
  });

  it("collapses a wobble to nothing", () => {
    expect(snapPlacement(3, -2)).toEqual({ dx: 0, dy: 0 });
    expect(isPlaced(snapPlacement(3, -2))).toBe(false);
  });
});

describe("isPlaced", () => {
  it("needs a real offset", () => {
    expect(isPlaced(undefined)).toBe(false);
    expect(isPlaced({ dx: 0, dy: 0 })).toBe(false);
    expect(isPlaced({ dx: 0, dy: 48 })).toBe(true);
  });
});

describe("placedRect", () => {
  it("moves the drawing, not the home", () => {
    const placed = placedRect(node, { dx: 120, dy: -60 });
    expect(placed).toEqual({ x: 220, y: -360, w: 384, h: 600 });
    // The node itself is untouched — Stage never writes Score.
    expect(node).toEqual({ x: 100, y: -300, w: 384, h: 600 });
  });

  it("is the identity when nothing is placed", () => {
    expect(placedRect(node, undefined)).toBe(node);
    expect(placedRect(node, { dx: 0, dy: 0 })).toBe(node);
  });
});

describe("tetherLine", () => {
  it("runs from the home column's spine point to the placed column", () => {
    const placed = placedRect(node, { dx: 240, dy: 300 });
    const line = tetherLine(node, placed, 0);
    expect(line.x1).toBe(100 + 192);
    expect(line.y1).toBe(0);
    expect(line.x2).toBe(340 + 192);
    expect(line.y2).toBe(0 + 300);
  });
});

describe("resolvePlacement", () => {
  const node = { key: "chorus#1", sectionId: "chorus" };

  it("prefers this pass over the whole section", () => {
    const placements = {
      chorus: { dx: 0, dy: 240 },
      "chorus#1": { dx: 120, dy: 0 },
    };
    expect(resolvePlacement(placements, node)).toEqual({ dx: 120, dy: 0 });
  });

  it("falls back to the section, so a whole-section lift still shows", () => {
    expect(resolvePlacement({ chorus: { dx: 0, dy: 240 } }, node)).toEqual({
      dx: 0,
      dy: 240,
    });
  });

  it("is nothing when neither key is placed", () => {
    expect(resolvePlacement({}, node)).toBeUndefined();
    expect(
      resolvePlacement({ other: { dx: 12, dy: 0 } }, node),
    ).toBeUndefined();
  });

  it("keys a pass by its node key", () => {
    expect(placementKey(node)).toBe("chorus#1");
  });
});

describe("clampPlacement", () => {
  const world = worldBounds({ bounds: { x: 0, y: POLY_TOP, w: 2000, h: 750 } });
  const column = { x: 0, y: POLY_TOP, w: 384, h: POLY_HEIGHT };

  it("stops at the bottom of the world's placement room", () => {
    const floor = clampPlacement(column, { dx: 0, dy: 99_999 }, world);
    expect(floor.dy).toBe(PLACEMENT_ROOM);
    expect(column.y + floor.dy + column.h).toBe(world.y + world.h);
  });

  it("keeps a column inside the song's width", () => {
    expect(clampPlacement(column, { dx: 99_999, dy: 0 }, world).dx).toBe(
      world.w - column.w,
    );
    expect(clampPlacement(column, { dx: -99_999, dy: 0 }, world).dx).toBe(0);
  });

  it("leaves a legal placement untouched, without allocating", () => {
    const placement = { dx: 240, dy: 120 };
    expect(clampPlacement(column, placement, world)).toBe(placement);
  });

  it("still refuses to lift above the lanes", () => {
    expect(clampPlacement(column, { dx: 0, dy: -240 }, world).dy).toBe(0);
  });
});
