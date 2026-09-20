import { describe, expect, it } from "vitest";
import {
  applyDrumBlocks,
  motionModelFor,
  type ApplyDrumBlocksContext,
  type DrumBlock,
} from "../src/blocks.js";
import { KIT_PITCHES, type TiledNote } from "../src/section.js";

const CTX: ApplyDrumBlocksContext = {
  durationBeats: 16,
  beatsPerBar: 4,
  velocityTarget: 100,
  gridBeats: 0.25,
  seed: "seed-1",
};

const P = KIT_PITCHES;

function baseTiled(): TiledNote[] {
  return [
    { beat: 0, pitch: P.kick, velocity: 100 },
    { beat: 2, pitch: P.kick, velocity: 96 },
    { beat: 4, pitch: P.kick, velocity: 100 },
    { beat: 6, pitch: P.kick, velocity: 96 },
    { beat: 1, pitch: P.snare, velocity: 90 },
    { beat: 5, pitch: P.snare, velocity: 90 },
    { beat: 0, pitch: P.closedHat, velocity: 70 },
  ];
}

const beatsOf = (notes: TiledNote[], pitch: number): number[] =>
  notes.filter((n) => n.pitch === pitch).map((n) => n.beat);

/** The compiler returns canonical (beat, pitch) order — compare against the
 *  sorted baseline when asserting a pass-through. */
const sorted = (notes: TiledNote[]): TiledNote[] =>
  [...notes].sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);

describe("applyDrumBlocks — migration + clamping", () => {
  it("returns the input untouched (same reference) when there are no blocks", () => {
    const t = baseTiled();
    expect(applyDrumBlocks(t, [], CTX)).toBe(t);
    expect(applyDrumBlocks(t, undefined, CTX)).toBe(t);
    expect(applyDrumBlocks(t, null, CTX)).toBe(t);
  });

  it("clamps a block to the section and drops blocks entirely outside it", () => {
    const outside: DrumBlock = {
      id: "o1", lane: "kick", startBeat: 20, endBeat: 24, mode: "euclid", euclid: { k: 2, n: 4, rotation: 0 },
    };
    const kept = applyDrumBlocks(baseTiled(), [outside], CTX);
    // No valid blocks → a complete no-op, order untouched.
    expect(kept).toEqual(baseTiled());

    const clamped: DrumBlock = {
      id: "c1", lane: "kick", startBeat: 12, endBeat: 40, mode: "euclid", euclid: { k: 4, n: 8, rotation: 0 },
    };
    const out = applyDrumBlocks(baseTiled(), [clamped], CTX);
    // Range clamps to 12..16 → stepBeats 0.5 → onsets at 12, 13, 14, 15.
    expect(beatsOf(out, P.kick)).toEqual([0, 2, 4, 6, 12, 13, 14, 15]);
    expect(out.every((n) => n.beat >= 0 && n.beat < CTX.durationBeats)).toBe(true);
  });
});

describe("applyDrumBlocks — euclid mode (the XY pad's compile target)", () => {
  it("replaces only its lane inside its range and inherits the lane's peak velocity", () => {
    const block: DrumBlock = {
      id: "e1", lane: "kick", startBeat: 0, endBeat: 4, mode: "euclid", euclid: { k: 3, n: 4, rotation: 0 },
    };
    const out = applyDrumBlocks(baseTiled(), [block], CTX);
    // k=3/n=4 over 4 beats → steps 0,1,3 → beats 0,1,3; base kick @4,6 kept.
    expect(beatsOf(out, P.kick)).toEqual([0, 1, 3, 4, 6]);
    expect(out.find((n) => n.beat === 1 && n.pitch === P.kick)?.velocity).toBe(100);
    // Other lanes untouched.
    expect(beatsOf(out, P.snare)).toEqual([1, 5]);
    expect(beatsOf(out, P.closedHat)).toEqual([0]);
  });

  it("rotation shifts the onsets around the fixed length", () => {
    const block: DrumBlock = {
      id: "e2", lane: "kick", startBeat: 0, endBeat: 4, mode: "euclid", euclid: { k: 3, n: 4, rotation: 1 },
    };
    const out = applyDrumBlocks(baseTiled(), [block], CTX);
    expect(beatsOf(out, P.kick)).toEqual([0, 1, 2, 4, 6]);
  });
});

describe("applyDrumBlocks — steps mode + step FX", () => {
  it("splices authored steps, expands ratchets, honors gates and seeded probability", () => {
    const block: DrumBlock = {
      id: "s1", lane: "snare", startBeat: 0, endBeat: 2, mode: "steps",
      notes: [
        { beat: 0, voice: "snare", velocity: 90, ratchet: 2, durBeats: 0.5 },
        { beat: 1, voice: "snare", velocity: 80, prob: 0 },
      ],
    };
    const out = applyDrumBlocks(baseTiled(), [block], CTX);
    const snares = out.filter((n) => n.pitch === P.snare).sort((a, b) => a.beat - b.beat);
    // Base snare @1 replaced by the authored step; prob 0 drops the @1 step;
    // ratchet ×2 splits the 0.5-beat gate into two 0.25 hits; base @5 kept.
    expect(snares.map((n) => [n.beat, n.velocity, n.duration])).toEqual([
      [0, 90, 0.25],
      [0.25, 68, 0.25],
      [5, 90, undefined],
    ]);
  });

  it("flam adds a grace note a hair before the step", () => {
    const block: DrumBlock = {
      id: "s2", lane: "rim", startBeat: 0, endBeat: 4, mode: "steps",
      notes: [{ beat: 1, voice: "rim", velocity: 100, flam: true }],
    };
    const out = applyDrumBlocks(baseTiled(), [block], CTX);
    expect(beatsOf(out, P.rim)).toEqual([0.9375, 1]);
    expect(out.find((n) => n.beat === 0.9375)?.velocity).toBe(60);
  });
});

describe("applyDrumBlocks — interleave clusters", () => {
  it("spreads one rhythm across the member lanes by priority, replacing all of them in range", () => {
    const blocks: DrumBlock[] = [
      { id: "c1", lane: "snare", groupId: "g", interleave: true, startBeat: 0, endBeat: 4, mode: "euclid", euclid: { k: 3, n: 4, rotation: 0 } },
      { id: "c2", lane: "tom", groupId: "g", interleave: true, startBeat: 0, endBeat: 4, mode: "euclid", euclid: { k: 3, n: 4, rotation: 0 } },
    ];
    const out = applyDrumBlocks(baseTiled(), blocks, CTX);
    // Onsets 0,1,3 → snare first (priority), then tom, then snare again.
    expect(beatsOf(out, P.snare)).toEqual([0, 3, 5]);
    expect(beatsOf(out, P.tomMid)).toEqual([1]);
    // Kick lane untouched by the cluster.
    expect(beatsOf(out, P.kick)).toEqual([0, 2, 4, 6]);
  });
});

describe("applyDrumBlocks — motion gestures", () => {
  it("maps vectors to models with a deadzone", () => {
    expect(motionModelFor({ x: 0.6, y: 0.6 })?.model).toBe("buildUp");
    expect(motionModelFor({ x: -0.6, y: 0.6 })?.model).toBe("buildUp");
    expect(motionModelFor({ x: 0, y: -0.8 })?.model).toBe("dropOut");
    expect(motionModelFor({ x: -0.6, y: -0.6 })?.model).toBe("breakDown");
    expect(motionModelFor({ x: 0.6, y: -0.6 })?.model).toBe("cut");
    expect(motionModelFor({ x: 0.05, y: 0.05 })).toBeNull();
  });

  it("replaces the range with the synthesized gesture, deterministically", () => {
    const block: DrumBlock = {
      id: "m1", lane: "cym", startBeat: 8, endBeat: 12, mode: "motion", motion: { x: 0.7, y: 0.7 },
    };
    const out = applyDrumBlocks(baseTiled(), [block], CTX);
    // Everything before the block is untouched — and the gesture's landing
    // kick+snare resolve on the range's final grid step.
    expect(beatsOf(out, P.kick)).toEqual([0, 2, 4, 6, 11.875]);
    const inRange = out.filter((n) => n.beat >= 8 && n.beat < 12);
    expect(inRange.length).toBeGreaterThan(10); // a 32nd-sprint build
    expect(inRange.some((n) => n.pitch === P.closedHat)).toBe(true);
    // Lands kick+snare on the block's final grid step.
    expect(inRange.some((n) => n.pitch === P.kick && Math.abs(n.beat - 11.875) < 1e-9)).toBe(true);
    expect(inRange.some((n) => n.pitch === P.snare && Math.abs(n.beat - 11.875) < 1e-9)).toBe(true);
    expect(out.every((n) => n.beat >= 0 && n.beat < CTX.durationBeats)).toBe(true);
    // Same seed → byte-identical plan.
    expect(applyDrumBlocks(baseTiled(), [block], CTX)).toEqual(out);
  });

  it("is a no-op inside the deadzone", () => {
    const block: DrumBlock = {
      id: "m2", lane: "cym", startBeat: 8, endBeat: 12, mode: "motion", motion: { x: 0.05, y: 0.05 },
    };
    expect(applyDrumBlocks(baseTiled(), [block], CTX)).toEqual(sorted(baseTiled()));
  });
});

describe("applyDrumBlocks — range FX", () => {
  it("swing delays off-8ths, quantize pulls to the 16th grid", () => {
    const block: DrumBlock = {
      id: "f1", lane: "hat", startBeat: 0, endBeat: 4, mode: "steps",
      notes: [
        { beat: 1.5, voice: "closedHat", velocity: 80 },
        { beat: 2, voice: "closedHat", velocity: 80, offsetBeats: 0.07 },
      ],
      fx: { swing: 0.4, quantize: 1 },
    };
    const out = applyDrumBlocks(baseTiled(), [block], CTX);
    const hats = beatsOf(out, P.closedHat);
    // 1.5 (off-8th) swings late by 0.4 × 1/6; the nudged hit snaps to 2.
    expect(hats).toEqual([1.5667, 2]);
  });

  it("velCurve remaps velocities (soft → hard) deterministically", () => {
    const hard: DrumBlock = {
      id: "f2", lane: "rim", startBeat: 0, endBeat: 4, mode: "steps",
      notes: [{ beat: 0, voice: "rim", velocity: 40 }], fx: { velCurve: 1 },
    };
    const soft: DrumBlock = { ...hard, id: "f3", fx: { velCurve: -1 } };
    const hardOut = applyDrumBlocks(baseTiled(), [hard], CTX);
    const softOut = applyDrumBlocks(baseTiled(), [soft], CTX);
    const hardVel = hardOut.find((n) => n.pitch === P.rim)!.velocity;
    const softVel = softOut.find((n) => n.pitch === P.rim)!.velocity;
    expect(hardVel).toBe(71); // 127 × (40/127)^0.5
    expect(softVel).toBeLessThan(40); // compressed downward
    expect(applyDrumBlocks(baseTiled(), [hard], CTX)).toEqual(hardOut);
  });

  it("inherit blocks apply FX to the lane's existing notes and are a no-op without FX", () => {
    const plain: DrumBlock = { id: "i1", lane: "kick", startBeat: 0, endBeat: 4, mode: "inherit" };
    expect(applyDrumBlocks(baseTiled(), [plain], CTX)).toEqual(sorted(baseTiled()));

    const verb: DrumBlock = { id: "i2", lane: "kick", startBeat: 0, endBeat: 4, mode: "inherit", fx: { humanize: 1 } };
    const out = applyDrumBlocks(baseTiled(), [verb], CTX);
    // Same note count, but the in-range kick hits moved/reshaped.
    expect(beatsOf(out, P.kick).length).toBe(4);
    expect(applyDrumBlocks(baseTiled(), [verb], CTX)).toEqual(out);
  });
});
