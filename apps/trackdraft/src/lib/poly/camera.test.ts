import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampCamera,
  clampZoom,
  fitRect,
  clampToWorld,
  panByPixels,
  rectsIntersect,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
  type PolyCamera,
} from "./camera";

const viewport = { width: 800, height: 600 };

describe("camera projections", () => {
  it("round-trips a world point through the screen", () => {
    const camera = { x: 320, y: -64, zoom: 1.75 };
    const world = { x: 120, y: 240 };
    const screen = worldToScreen(camera, viewport, world);
    expect(screenToWorld(camera, viewport, screen).x).toBeCloseTo(world.x, 10);
    expect(screenToWorld(camera, viewport, screen).y).toBeCloseTo(world.y, 10);
  });

  it("puts the camera's centre at the middle of the viewport", () => {
    const camera = { x: 900, y: 40, zoom: 2 };
    const screen = worldToScreen(camera, viewport, { x: 900, y: 40 });
    expect(screen).toEqual({ x: 400, y: 300 });
  });
});

describe("zoomAt", () => {
  it("keeps the world point under the cursor fixed", () => {
    const camera = { x: 500, y: 200, zoom: 1 };
    const focal = { x: 120, y: 480 };
    const before = screenToWorld(camera, viewport, focal);
    const after = zoomAt(camera, viewport, focal, 2.5);
    const anchor = screenToWorld(after, viewport, focal);
    expect(anchor.x).toBeCloseTo(before.x, 10);
    expect(anchor.y).toBeCloseTo(before.y, 10);
    expect(after.zoom).toBeCloseTo(2.5, 10);
  });

  it("clamps and leaves the camera alone at the limit", () => {
    const camera = { x: 10, y: 10, zoom: MAX_ZOOM };
    expect(zoomAt(camera, viewport, { x: 0, y: 0 }, 2)).toBe(camera);
  });
});

describe("clamping", () => {
  it("keeps zoom inside the range", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("repairs non-finite camera fields", () => {
    expect(clampCamera({ x: Number.NaN, y: 4, zoom: 0 })).toEqual({
      x: 0,
      y: 4,
      zoom: MIN_ZOOM,
    });
  });
});

describe("fitRect", () => {
  it("centres the rect and fits it inside the padded viewport", () => {
    const rect = { x: 100, y: 50, w: 1000, h: 300 };
    const camera = fitRect(rect, viewport, 50);
    expect(camera.x).toBe(600);
    expect(camera.y).toBe(200);
    expect(camera.zoom).toBeCloseTo(700 / 1000, 10);
    const topLeft = worldToScreen(camera, viewport, { x: rect.x, y: rect.y });
    expect(topLeft.x).toBeGreaterThanOrEqual(49);
    expect(topLeft.x).toBeLessThanOrEqual(51);
  });

  it("degrades to the default camera for an empty rect", () => {
    expect(fitRect({ x: 0, y: 0, w: 0, h: 0 }, viewport)).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
  });
});

describe("panning and culling", () => {
  it("moves the world with the pointer", () => {
    const camera = { x: 0, y: 0, zoom: 2 };
    const panned = panByPixels(camera, 100, -50);
    expect(panned.x).toBe(-50);
    expect(panned.y).toBe(25);
  });

  it("reports the visible world rect", () => {
    const camera = { x: 0, y: 0, zoom: 2 };
    const rect = visibleWorldRect(camera, viewport);
    expect(rect).toEqual({ x: -200, y: -150, w: 400, h: 300 });
  });

  it("detects overlap", () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 5, y: 5, w: 10, h: 10 },
      ),
    ).toBe(true);
    expect(
      rectsIntersect(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 11, y: 0, w: 10, h: 10 },
      ),
    ).toBe(false);
  });
});

describe("keeping the camera inside the song", () => {
  // 800x600 viewport; a song much wider and taller than the window.
  const world = { x: 0, y: -400, w: 4000, h: 1600 };
  const inset = 56;

  const leftEdge = (camera: PolyCamera, x = 0) =>
    worldToScreen(camera, viewport, { x, y: 0 }).x;
  const rightEdge = (camera: PolyCamera) =>
    worldToScreen(camera, viewport, { x: world.w, y: 0 }).x;

  it("stops the song's first bar at the gutter", () => {
    const camera = clampToWorld(
      { x: -800, y: 0, zoom: 0.5 },
      world,
      viewport,
      inset,
    );
    expect(leftEdge(camera)).toBeCloseTo(inset, 9);
    expect(camera.zoom).toBe(0.5);
  });

  it("stops the far end at the viewport edge", () => {
    const camera = clampToWorld(
      { x: 9999, y: 0, zoom: 1 },
      world,
      viewport,
      inset,
    );
    expect(rightEdge(camera)).toBeCloseTo(viewport.width, 9);
  });

  it("leaves a camera already inside alone, without allocating", () => {
    const camera = { x: 1200, y: 400, zoom: 0.5 };
    expect(clampToWorld(camera, world, viewport, inset)).toBe(camera);
  });

  it("stops vertical panning at the lane stack and the shelf", () => {
    const top = clampToWorld(
      { x: 1200, y: -9999, zoom: 1 },
      world,
      viewport,
      0,
    );
    expect(worldToScreen(top, viewport, { x: 0, y: world.y }).y).toBeCloseTo(
      0,
      9,
    );
    const bottom = clampToWorld(
      { x: 1200, y: 9999, zoom: 1 },
      world,
      viewport,
      0,
    );
    expect(
      worldToScreen(bottom, viewport, { x: 0, y: world.y + world.h }).y,
    ).toBeCloseTo(viewport.height, 9);
  });

  it("centres and locks a song smaller than the window", () => {
    const small = { x: 0, y: 0, w: 120, h: 80 };
    const pinned = clampToWorld(
      { x: -500, y: 400, zoom: 1 },
      small,
      viewport,
      0,
    );
    expect(pinned.x).toBeCloseTo(60, 9);
    expect(pinned.y).toBeCloseTo(40, 9);
    // Locked: any further attempt lands in the same place.
    expect(
      clampToWorld({ x: 5000, y: -5000, zoom: 1 }, small, viewport, 0),
    ).toEqual(pinned);
  });

  it("centres in the space the gutter leaves, not the whole viewport", () => {
    const small = { x: 0, y: 0, w: 200, h: 80 };
    const pinned = clampToWorld({ x: 0, y: 0, zoom: 1 }, small, viewport, 56);
    expect(leftEdge(pinned)).toBeCloseTo(
      56 + (viewport.width - 56) / 2 - 100,
      9,
    );
  });

  it("keeps content out from under the ruler as well as the gutter", () => {
    // Shorter than the window: centred in what the ruler leaves, not the whole
    // canvas.
    const small = { x: 0, y: 0, w: 200, h: 100 };
    const centred = clampToWorld(
      { x: 0, y: 500, zoom: 1 },
      small,
      viewport,
      0,
      14,
    );
    expect(worldToScreen(centred, viewport, { x: 0, y: 0 }).y).toBeCloseTo(
      14 + (viewport.height - 14) / 2 - 50,
      9,
    );
    // Taller than the window: the top stops below the ruler.
    const top = clampToWorld(
      { x: 1200, y: -9999, zoom: 1 },
      world,
      viewport,
      0,
      14,
    );
    expect(worldToScreen(top, viewport, { x: 0, y: world.y }).y).toBeCloseTo(
      14,
      9,
    );
  });

  it("ignores a viewport that has not been measured yet", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(clampToWorld(camera, world, { width: 0, height: 0 }, 56)).toBe(
      camera,
    );
  });
});
