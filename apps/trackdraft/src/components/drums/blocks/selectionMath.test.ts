import { describe, expect, it } from "vitest";
import {
  boxMetrics, euclidFromRing, motionLabelFor, ringHand, scrubbedNotes, upsertBlocks, type VelocityScrubTarget,
} from "./selectionMath";
import type { DrumBlock } from "../../../types/blueprint";

describe("selectionMath — shared pad/editor math", () => {
  it("maps a euclid ring hand out and back without drift", () => {
    for (const [k, rotation] of [[1, 0], [3, 2], [6, 5], [8, 7]] as const) {
      const { x, y } = ringHand(k, 8, rotation, 96, 30);
      const back = euclidFromRing(x, y, 8, 96, 30);
      expect(back).toEqual({ k, rotation });
    }
  });

  it("quantizes the ring drag: angle → rotation, distance → density", () => {
    // straight up = rotation 0; straight down = rotation n/2
    expect(euclidFromRing(0, -90, 8, 96, 30).rotation).toBe(0);
    expect(euclidFromRing(0, 90, 8, 96, 30).rotation).toBe(4);
    // near the center → k 1 (clamped), at the rim → k = n
    expect(euclidFromRing(0, -10, 8, 96, 30).k).toBe(1);
    expect(euclidFromRing(0, -96, 8, 96, 30).k).toBe(8);
  });

  it("box metrics leave room for a number at working zooms and vanish at tiny ones", () => {
    const bm = boxMetrics(0, 8.8, 19.6);
    expect(bm).not.toBeNull();
    expect(bm!.w).toBeCloseTo(17.1, 1);
    expect(bm!.h).toBeGreaterThanOrEqual(12);
    expect(bm!.font).toBeGreaterThanOrEqual(6.5);
    expect(boxMetrics(0, 2.5, 4)).toBeNull();
  });

  it("scrubs a uniform delta over the selection peaks only, clamped", () => {
    const s: VelocityScrubTarget = {
      laneKey: "kick",
      start: 4,
      end: 6,
      hits: [
        { beat: 4, velocity: 80, voice: "kick" },
        { beat: 5.25, velocity: 40, voice: "kick" }, // same step as 5.5? no — step 5 bucket below
        { beat: 5, velocity: 100, voice: "kick" },
      ],
      peaks: [{ beat: 5, voice: "kick", velocity: 100 }],
      base: 100,
    };
    const up = scrubbedNotes(s, 120);
    // the loudest voice on step 5 moved +20; everything else untouched
    expect(up.find((n) => n.beat === 1)!.velocity).toBe(120);
    expect(up.find((n) => Math.abs(n.beat - 1.25) < 1e-9)!.velocity).toBe(40);
    expect(up.find((n) => n.beat === 0)!.velocity).toBe(80);
    // beats are block-relative
    expect(up.map((n) => n.beat)).toEqual([0, 1.25, 1]);
    // clamps at 127 / 1
    expect(scrubbedNotes(s, 127).find((n) => n.beat === 1)!.velocity).toBe(127);
  });

  it("labels motion vectors", () => {
    expect(motionLabelFor({ x: 0.8, y: 0.6 })).toContain("BUILD");
    expect(motionLabelFor({ x: -0.8, y: 0.5 })).toContain("CRESCENDO");
    expect(motionLabelFor({ x: 0, y: -0.8 })).toContain("BREAK");
    expect(motionLabelFor({ x: 0, y: 0 })).toBeNull();
  });

  it("upserts blocks by id", () => {
    const a: DrumBlock = { id: "blk-1", lane: "kick", startBeat: 0, endBeat: 2, mode: "euclid" };
    const b: DrumBlock = { id: "blk-2", lane: "snare", startBeat: 0, endBeat: 2, mode: "euclid" };
    const b2: DrumBlock = { ...b, startBeat: 4, endBeat: 6 };
    expect(upsertBlocks([a, b], [b2])).toEqual([a, b2]);
    expect(upsertBlocks(undefined, [a])).toEqual([a]);
  });
});
