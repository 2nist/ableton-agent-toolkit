import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA,
  CAMERA_PRESETS,
  projectPoint,
  unprojectToPlane,
  type SceneCamera,
} from "./scene3d";

const front: SceneCamera = CAMERA_PRESETS.front;
const origin = { x: 0, y: 0 };

describe("vertical scale (locked front view)", () => {
  it("is a no-op when absent", () => {
    const point = { x: 0, y: 0, z: 100 };
    expect(projectPoint(point, front, origin).y).toBeCloseTo(
      projectPoint(point, { ...front, scaleY: 1 }, origin).y,
      6,
    );
  });

  it("stretches the degree rows without touching the time axis", () => {
    const plain = { ...front, zoom: 1 };
    const stretched = { ...front, zoom: 1, scaleY: 3 };
    const rowA = { x: 0, y: 0, z: 40 };
    const rowB = { x: 40, y: 0, z: 40 };

    const gapPlain = Math.abs(projectPoint(rowB, plain, origin).y - projectPoint(rowA, plain, origin).y);
    const gapStretched = Math.abs(projectPoint(rowB, stretched, origin).y - projectPoint(rowA, stretched, origin).y);
    expect(gapStretched).toBeCloseTo(gapPlain * 3, 6);

    // Time is the x axis in the front view; it must not move.
    const timePlain = { x: 0, y: 0, z: 0 };
    const timeLater = { x: 0, y: 0, z: 100 };
    expect(projectPoint(timeLater, stretched, origin).x - projectPoint(timePlain, stretched, origin).x).toBeCloseTo(
      projectPoint(timeLater, plain, origin).x - projectPoint(timePlain, plain, origin).x,
      6,
    );
  });

  it("round-trips through unprojectToPlane", () => {
    const camera: SceneCamera = { ...front, zoom: 1.4, scaleY: 2.5 };
    for (const point of [
      { x: 40, z: 0 },
      { x: 160, z: 208 },
      { x: 0, z: 52 },
    ]) {
      const screen = projectPoint({ ...point, y: 0 }, camera, origin);
      const back = unprojectToPlane(screen.x, screen.y, 0, camera, origin);
      expect(back).not.toBeNull();
      expect(back!.x).toBeCloseTo(point.x, 4);
      expect(back!.z).toBeCloseTo(point.z, 4);
    }
  });

  it("round-trips on an off-plane box height too", () => {
    const camera: SceneCamera = { ...front, zoom: 0.9, scaleY: 4 };
    const planeY = 22;
    const screen = projectPoint({ x: 80, y: planeY, z: 104 }, camera, origin);
    const back = unprojectToPlane(screen.x, screen.y, planeY, camera, origin);
    expect(back!.x).toBeCloseTo(80, 4);
    expect(back!.z).toBeCloseTo(104, 4);
  });

  it("leaves the default camera alone", () => {
    expect(DEFAULT_CAMERA.scaleY).toBeUndefined();
  });
});
