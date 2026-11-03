import { describe, expect, it } from "vitest";
import {
  FRAME_PADDING,
  frameAround,
  frameLabel,
  frameRect,
  nodesInFrame,
} from "./frames";

const frame = { id: "f1", label: "Chorus ideas", x: 0, y: 0, w: 400, h: 300 };

describe("frameAround", () => {
  it("is the bounding box plus padding", () => {
    const box = frameAround([
      { x: 100, y: 100, w: 200, h: 300 },
      { x: 400, y: 50, w: 100, h: 100 },
    ]);
    expect(box).toEqual({
      x: 100 - FRAME_PADDING,
      y: 50 - FRAME_PADDING,
      w: 400 + FRAME_PADDING * 2,
      h: 350 + FRAME_PADDING * 2,
    });
  });

  it("takes a single rect", () => {
    expect(frameAround([{ x: 5, y: 5, w: 10, h: 10 }], 0)).toEqual({
      x: 5,
      y: 5,
      w: 10,
      h: 10,
    });
  });

  it("refuses to frame nothing", () => {
    expect(frameAround([])).toBeNull();
  });
});

describe("nodesInFrame", () => {
  const nodes = [
    { key: "inside", x: 100, y: 100, w: 50, h: 50 },
    { key: "outside", x: 900, y: 900, w: 50, h: 50 },
    // Centre at (0, 0) — right on the frame's corner, which counts as inside.
    { key: "corner", x: -25, y: -25, w: 50, h: 50 },
  ];

  it("keeps what is inside it", () => {
    expect(nodesInFrame(frame, nodes)).toEqual(["inside", "corner"]);
  });

  it("judges by centre, so a straddling column goes to the side holding most of it", () => {
    const half = { key: "half", x: 380, y: 100, w: 100, h: 50 };
    expect(nodesInFrame(frame, [half])).toEqual([]);
    const mostly = { key: "mostly", x: 300, y: 100, w: 100, h: 50 };
    expect(nodesInFrame(frame, [mostly])).toEqual(["mostly"]);
  });

  it("is empty for a frame with nothing in it", () => {
    expect(nodesInFrame({ ...frame, x: 5000 }, nodes)).toEqual([]);
  });
});

describe("frameLabel", () => {
  it("sits inside the frame, whatever the zoom", () => {
    for (const zoom of [0.08, 0.5, 2]) {
      const label = frameLabel(frame, zoom);
      expect(label.x).toBeGreaterThan(frame.x);
      expect(label.y).toBeGreaterThan(frame.y);
      expect(label.x).toBeLessThan(frame.x + frame.w);
      expect(label.y).toBeLessThan(frame.y + frame.h);
    }
  });

  it("scales its type so it reads at any zoom", () => {
    expect(frameLabel(frame, 0.5).size).toBeGreaterThan(
      frameLabel(frame, 2).size,
    );
  });

  it("survives a zero zoom without dividing by it", () => {
    expect(Number.isFinite(frameLabel(frame, 0).y)).toBe(true);
  });
});

describe("frameRect", () => {
  it("exposes the frame as a rect", () => {
    expect(frameRect(frame)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
});
