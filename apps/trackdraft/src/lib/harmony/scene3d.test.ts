import { describe, it, expect } from "vitest";
import {
  DEFAULT_CAMERA,
  MAX_PITCH,
  MAX_ZOOM,
  MIN_ZOOM,
  boxFaces,
  clampCamera,
  orbit,
  panBy,
  projectPoint,
  rotatePoint,
  zoomBy,
} from "./scene3d";

const ORIGIN = { x: 0, y: 0 };
const FLAT = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };

describe("rotatePoint", () => {
  it("is the identity for a flat camera", () => {
    expect(rotatePoint({ x: 3, y: 5, z: 7 }, FLAT)).toEqual({ x: 3, y: 5, z: 7 });
  });

  it("turns +z towards +x at a quarter turn of yaw", () => {
    const turned = rotatePoint({ x: 0, y: 0, z: 10 }, { ...FLAT, yaw: Math.PI / 2 });
    expect(turned.x).toBeCloseTo(10);
    expect(turned.z).toBeCloseTo(0);
  });

  it("tilts depth into height as pitch increases", () => {
    const tilted = rotatePoint({ x: 0, y: 0, z: 10 }, { ...FLAT, pitch: Math.PI / 2 });
    expect(tilted.y).toBeCloseTo(-10);
  });
});

describe("projectPoint", () => {
  it("flips screen y and applies zoom", () => {
    const point = projectPoint({ x: 10, y: 4, z: 0 }, { ...FLAT, zoom: 2 }, ORIGIN);
    expect(point.x).toBe(20);
    expect(point.y).toBe(-8);
  });

  it("reports larger depth for points nearer the viewer", () => {
    const near = projectPoint({ x: 0, y: 0, z: 10 }, FLAT, ORIGIN);
    const far = projectPoint({ x: 0, y: 0, z: 2 }, FLAT, ORIGIN);
    expect(near.depth).toBeGreaterThan(far.depth);
  });

  it("applies pan in screen pixels", () => {
    const point = projectPoint({ x: 0, y: 0, z: 0 }, { ...FLAT, panX: 5, panY: -3 }, ORIGIN);
    expect(point).toMatchObject({ x: 5, y: -3 });
  });
});

describe("boxFaces", () => {
  it("returns six faces sorted back to front", () => {
    const faces = boxFaces({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }, DEFAULT_CAMERA, ORIGIN);
    expect(faces).toHaveLength(6);
    const depths = faces.map((face) => face.depth);
    expect([...depths].sort((a, b) => a - b)).toEqual(depths);
  });

  it("keeps every face a quad", () => {
    for (const face of boxFaces({ x: 4, y: -2, z: 6 }, { x: 8, y: 8, z: 8 }, DEFAULT_CAMERA, ORIGIN)) {
      expect(face.points).toHaveLength(4);
      expect(face.shade).toBeGreaterThan(0.5);
      expect(face.shade).toBeLessThanOrEqual(1);
    }
  });

  it("puts a nearer box in front of a farther one", () => {
    const near = boxFaces({ x: 0, y: 0, z: 40 }, { x: 8, y: 8, z: 8 }, FLAT, ORIGIN);
    const far = boxFaces({ x: 0, y: 0, z: 0 }, { x: 8, y: 8, z: 8 }, FLAT, ORIGIN);
    const nearestOfFar = Math.max(...far.map((face) => face.depth));
    const nearestOfNear = Math.max(...near.map((face) => face.depth));
    expect(nearestOfNear).toBeGreaterThan(nearestOfFar);
  });
});

describe("camera controls", () => {
  it("orbits and clamps the tilt", () => {
    const tilted = orbit(DEFAULT_CAMERA, 20, 10_000);
    expect(tilted.yaw).toBeCloseTo(DEFAULT_CAMERA.yaw + 0.2);
    expect(tilted.pitch).toBe(MAX_PITCH);
  });

  it("clamps zoom to the allowed range", () => {
    expect(zoomBy(DEFAULT_CAMERA, 10).zoom).toBe(MAX_ZOOM);
    expect(zoomBy(DEFAULT_CAMERA, 0.0001).zoom).toBe(MIN_ZOOM);
  });

  it("pans in screen pixels", () => {
    const panned = panBy(DEFAULT_CAMERA, 12, -4);
    expect(panned).toMatchObject({ panX: 12, panY: -4 });
  });

  it("clampCamera leaves a valid camera alone", () => {
    expect(clampCamera(DEFAULT_CAMERA)).toEqual(DEFAULT_CAMERA);
  });
});
