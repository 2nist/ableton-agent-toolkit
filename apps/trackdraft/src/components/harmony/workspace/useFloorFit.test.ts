import { describe, expect, it } from "vitest";
import { CAMERA_PRESETS } from "../../../lib/harmony/scene3d";
import {
  BEAT_Z,
  LADDER_STEPS,
  STEP_W,
  MIN_BARS_ACROSS,
  PAD,
  ROW_SHARE,
  RULER_H,
  FOOT_H,
  computeFloorFit,
  type FitNode,
} from "./useFloorFit";

const front = CAMERA_PRESETS.front;
const rowSine = Math.sin(front.pitch);
const plate = { width: 1340, stageH: 680 };
const sceneH = plate.stageH - RULER_H - FOOT_H - 20;
const targetPitch = (sceneH * ROW_SHARE) / LADDER_STEPS;

/** One chord on the tonic row, so the bounds have real content. */
function chord(start: number, beats: number): FitNode {
  const depth = Math.max(14, beats * BEAT_Z - 3);
  return {
    start,
    beats,
    center: { x: STEP_W, y: 13, z: start * BEAT_Z + depth / 2 },
    size: { x: 30, y: 26, z: depth },
  };
}

function fit(overrides: Partial<Parameters<typeof computeFloorFit>[0]> = {}) {
  return computeFloorFit({
    camera: front,
    width: plate.width,
    windowBeats: 16,
    windowStart: 0,
    nodes: [chord(0, 16)],
    stageH: plate.stageH,
    locked: true,
    barsShown: 4,
    beatsPerBar: 4,
    ...overrides,
  });
}

/** Screen y of a degree row, from the fit's own numbers. */
const rowY = (result: ReturnType<typeof computeFloorFit>, degree: number) =>
  result.origin.y - degree * STEP_W * rowSine * result.zoom * result.scaleY;

describe("computeFloorFit", () => {
  it("keeps the rows at a readable pitch in the locked front view", () => {
    const result = fit();
    expect(result.scaleY).toBeGreaterThan(0.5);
    const pitch = rowY(result, 1) - rowY(result, 2);
    // Seven rows are the height budget, so the pitch lands near the target.
    expect(Math.abs(pitch - targetPitch)).toBeLessThan(targetPitch * 0.35);
  });

  it("compresses time, not rows, when the window is long", () => {
    const short = fit({ windowBeats: 16, barsShown: 4 });
    const long = fit({ windowBeats: 308, barsShown: 77, nodes: [chord(0, 308)] });
    // Far less horizontal room per beat…
    expect(long.zoom).toBeLessThan(short.zoom / 10);
    // …but the rows stay in the same ballpark.
    const shortPitch = rowY(short, 1) - rowY(short, 2);
    const longPitch = rowY(long, 1) - rowY(long, 2);
    expect(longPitch).toBeGreaterThan(shortPitch * 0.4);
  });

  it("keys the pitch off the plate, not the window", () => {
    const four = fit({ windowBeats: 16, barsShown: 4 });
    const sixteen = fit({ windowBeats: 64, barsShown: 16, nodes: [chord(0, 64)] });
    const a = rowY(four, 1) - rowY(four, 2);
    const b = rowY(sixteen, 1) - rowY(sixteen, 2);
    expect(Math.abs(a - b)).toBeLessThan(Math.max(a, b) * 0.4);
  });

  it("never draws fewer than MIN_BARS_ACROSS bars", () => {
    const result = fit({ windowBeats: 8, barsShown: 2 });
    expect(result.gridBars).toBeGreaterThanOrEqual(MIN_BARS_ACROSS);
    const barWidth = result.zoom * 4 * BEAT_Z;
    expect(barWidth * result.gridBars).toBeLessThanOrEqual(plate.width);
  });

  it("keeps the chart inside the plate, however long the window", () => {
    for (const bars of [4, 16, 77]) {
      const result = fit({ windowBeats: bars * 4, barsShown: bars, nodes: [chord(0, bars * 4)] });
      const top = rowY(result, 6);
      const bottom = rowY(result, 0);
      expect(top).toBeGreaterThanOrEqual(RULER_H - 1);
      expect(bottom).toBeLessThanOrEqual(result.height - FOOT_H + 1);
      expect(top).toBeLessThan(bottom);
    }
  });

  it("starts the grid on the left pad", () => {
    const result = fit();
    // The board's left edge is the first rung of the degree ruler, which sits
    // one label-width behind the tonic row.
    expect(result.origin.x).toBeGreaterThan(0);
    expect(result.origin.x).toBeLessThan(plate.width * 0.2);
  });

  it("leaves the 3D and top presets isotropic", () => {
    const result = fit({ camera: CAMERA_PRESETS.threeQuarter, locked: false });
    expect(result.scaleY).toBe(1);
  });

  it("scales with the plate height", () => {
    const shortPlate = fit({ stageH: 262 });
    const tall = fit({ stageH: 900 });
    const shortPitch = rowY(shortPlate, 1) - rowY(shortPlate, 2);
    const tallPitch = rowY(tall, 1) - rowY(tall, 2);
    expect(tallPitch).toBeGreaterThan(shortPitch);
  });

  it("survives an empty section", () => {
    const result = fit({ nodes: [] });
    expect(Number.isFinite(result.zoom)).toBe(true);
    expect(Number.isFinite(result.origin.y)).toBe(true);
    expect(result.gridBars).toBeGreaterThanOrEqual(1);
  });

  it("pads the plate edges", () => {
    for (const bars of [2, 4, 16, 77]) {
      const result = fit({ windowBeats: bars * 4, barsShown: bars, nodes: [chord(0, bars * 4)] });
      // The board runs one label-width behind the tonic row and `gridBars`
      // bars forward from it.
      const leftEdge = result.origin.x - 2 * BEAT_Z * result.zoom;
      const rightEdge = result.origin.x + result.gridBars * 4 * BEAT_Z * result.zoom;
      expect(leftEdge).toBeGreaterThanOrEqual(PAD - 1);
      expect(rightEdge).toBeLessThanOrEqual(plate.width - 1);
    }
  });
});

