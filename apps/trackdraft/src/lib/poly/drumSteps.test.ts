import { describe, expect, it } from "vitest";
import type { DrumBlock } from "../../types/blueprint";
import {
  MIN_DRUM_GATE,
  drumStepGate,
  drumStepWindow,
  authoredSteps,
  nextRatchet,
  patchPaintedStep,
  setDrumStepGate,
  stepsBlockId,
  toggleDrumStep,
} from "./drumSteps";

describe("drumStepWindow", () => {
  it("splits the section into one window per necklace step", () => {
    expect(drumStepWindow(16, 8, 0)).toEqual({ startBeat: 0, endBeat: 2 });
    expect(drumStepWindow(16, 8, 3)).toEqual({ startBeat: 6, endBeat: 8 });
    expect(drumStepWindow(16, 8, 7)).toEqual({ startBeat: 14, endBeat: 16 });
  });

  it("clamps a step index onto the grid", () => {
    expect(drumStepWindow(4, 4, 99)).toEqual({ startBeat: 3, endBeat: 4 });
    expect(drumStepWindow(4, 4, -3)).toEqual({ startBeat: 0, endBeat: 1 });
  });

  it("does not divide by a nonsense column count", () => {
    expect(drumStepWindow(4, 0, 0)).toEqual({ startBeat: 0, endBeat: 4 });
  });
});

describe("toggleDrumStep", () => {
  const window = drumStepWindow(16, 8, 2);

  it("adds one note at the window's start, on the lane's voice", () => {
    const blocks = toggleDrumStep(undefined, {
      lane: "kick",
      ...window,
      on: true,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: stepsBlockId("kick", 4, 6),
      lane: "kick",
      startBeat: 4,
      endBeat: 6,
      mode: "steps",
      notes: [{ beat: 0, voice: "kick", velocity: 100 }],
    });
  });

  it("clears the step with an empty block, not by deleting the block", () => {
    const painted = toggleDrumStep(undefined, {
      lane: "kick",
      ...window,
      on: true,
    });
    const cleared = toggleDrumStep(painted, {
      lane: "kick",
      ...window,
      on: false,
    });
    expect(cleared).toHaveLength(1);
    expect(cleared[0].mode).toBe("steps");
    expect(cleared[0].notes).toEqual([]);
  });

  it("rewrites the same block instead of piling up duplicates", () => {
    let blocks = toggleDrumStep(undefined, {
      lane: "snare",
      ...window,
      on: true,
    });
    blocks = toggleDrumStep(blocks, { lane: "snare", ...window, on: false });
    blocks = toggleDrumStep(blocks, { lane: "snare", ...window, on: true });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe(stepsBlockId("snare", 4, 6));
  });

  it("leaves every other block alone", () => {
    const existing: DrumBlock[] = [
      {
        id: "someone-elses",
        lane: "hat",
        startBeat: 0,
        endBeat: 16,
        mode: "euclid",
      },
    ];
    const out = toggleDrumStep(existing, { lane: "kick", ...window, on: true });
    expect(out).toHaveLength(2);
    expect(out.find((b) => b.id === "someone-elses")).toEqual(existing[0]);
  });

  it("ignores a window with no width", () => {
    expect(
      toggleDrumStep(undefined, {
        lane: "kick",
        startBeat: 4,
        endBeat: 4,
        on: true,
      }),
    ).toEqual([]);
  });
});

describe("authoredSteps", () => {
  it("marks only the cells a painted step authored", () => {
    const blocks: DrumBlock[] = [
      {
        id: stepsBlockId("kick", 2, 3),
        lane: "kick",
        startBeat: 2,
        endBeat: 3,
        mode: "steps",
        notes: [{ beat: 0, voice: "kick", velocity: 100 }],
      },
    ];
    const authored = authoredSteps(blocks, "kick", 8, 8);
    expect(authored).toHaveLength(8);
    expect(authored.findIndex(Boolean)).toBe(2);
    expect(authored.filter(Boolean)).toHaveLength(1);
  });

  it("ignores another lane's blocks", () => {
    const blocks: DrumBlock[] = [
      {
        id: stepsBlockId("snare", 2, 3),
        lane: "snare",
        startBeat: 2,
        endBeat: 3,
        mode: "steps",
        notes: [{ beat: 0, voice: "snare", velocity: 100 }],
      },
    ];
    expect(authoredSteps(blocks, "kick", 8, 8).some(Boolean)).toBe(false);
  });

  it("ignores a cleared step — an empty block is silence, not a handle", () => {
    const blocks: DrumBlock[] = [
      {
        id: stepsBlockId("kick", 2, 3),
        lane: "kick",
        startBeat: 2,
        endBeat: 3,
        mode: "steps",
        notes: [],
      },
    ];
    expect(authoredSteps(blocks, "kick", 8, 8).some(Boolean)).toBe(false);
  });

  it("ignores a range block from the Drum Blocks surface", () => {
    // It starts in a cell, but `setDrumStepGate` addresses blocks by their step
    // id, so a handle here would drag nothing.
    const blocks: DrumBlock[] = [
      {
        id: "a-range-block",
        lane: "kick",
        startBeat: 2,
        endBeat: 6,
        mode: "steps",
        notes: [{ beat: 0, voice: "kick", velocity: 100 }],
      },
    ];
    expect(authoredSteps(blocks, "kick", 8, 8).some(Boolean)).toBe(false);
  });
});

describe("setDrumStepGate", () => {
  const window = { startBeat: 2, endBeat: 3 };

  function painted(beats?: number): DrumBlock[] {
    return [
      {
        id: stepsBlockId("kick", 2, 3),
        lane: "kick",
        startBeat: 2,
        endBeat: 3,
        mode: "steps",
        notes: [
          {
            beat: 0,
            voice: "kick",
            velocity: 100,
            ...(beats !== undefined ? { durBeats: beats } : {}),
          },
        ],
      },
    ];
  }

  it("writes the gate onto the painted note", () => {
    const out = setDrumStepGate(painted(), {
      lane: "kick",
      ...window,
      beats: 2,
    });
    expect(out?.[0].notes?.[0].durBeats).toBe(2);
  });

  it("clamps a gate so it cannot hold past the section", () => {
    const out = setDrumStepGate(painted(), {
      lane: "kick",
      ...window,
      beats: 99,
      limitBeats: 8,
    });
    expect(out?.[0].notes?.[0].durBeats).toBe(6);
  });

  it("never writes a gate a block cannot play", () => {
    const out = setDrumStepGate(painted(), {
      lane: "kick",
      ...window,
      beats: 0,
    });
    expect(out?.[0].notes?.[0].durBeats).toBe(MIN_DRUM_GATE);
  });

  it("returns the same array when the gate does not change", () => {
    const blocks = painted(2);
    expect(setDrumStepGate(blocks, { lane: "kick", ...window, beats: 2 })).toBe(
      blocks,
    );
  });

  it("leaves the blocks untouched when the cell holds no painted note", () => {
    // A gate is a length, so it needs a hit to be the length of: dragging over
    // the generated part of a row must not bake a block that replaces it.
    const blocks = painted();
    expect(
      setDrumStepGate(blocks, {
        lane: "kick",
        startBeat: 5,
        endBeat: 6,
        beats: 2,
      }),
    ).toBe(blocks);
    expect(
      setDrumStepGate(undefined, { lane: "kick", ...window, beats: 2 }),
    ).toBeUndefined();
  });

  it("reads a gate back out", () => {
    expect(drumStepGate(painted(1.5), "kick", window)).toBe(1.5);
    expect(drumStepGate(painted(), "kick", window)).toBeUndefined();
    expect(
      drumStepGate(painted(1.5), "kick", { startBeat: 5, endBeat: 6 }),
    ).toBeUndefined();
  });
});

describe("nextRatchet", () => {
  it("walks the ladder and wraps", () => {
    expect(nextRatchet(1)).toBe(2);
    expect(nextRatchet(2)).toBe(3);
    expect(nextRatchet(4)).toBe(1);
  });

  it("treats an absent or silly ratchet as one", () => {
    expect(nextRatchet(undefined)).toBe(2);
    expect(nextRatchet(0)).toBe(2);
    expect(nextRatchet(99)).toBe(1);
  });
});

describe("patchPaintedStep", () => {
  const window = { startBeat: 2, endBeat: 3 };
  const base = (): DrumBlock[] => [
    {
      id: stepsBlockId("kick", 2, 3),
      lane: "kick",
      startBeat: 2,
      endBeat: 3,
      mode: "steps",
      notes: [{ beat: 0, voice: "kick", velocity: 100 }],
    },
  ];

  it("sets a ratchet", () => {
    const out = patchPaintedStep(base(), {
      lane: "kick",
      ...window,
      patch: { ratchet: 3 },
    });
    expect(out?.[0].notes?.[0].ratchet).toBe(3);
  });

  it("removes the field when it is back at its default", () => {
    // A step cycled back to ×1 must be byte-identical to one never touched —
    // otherwise the authored array grows with no-ops and every cycle is a diff.
    const at2 = patchPaintedStep(base(), {
      lane: "kick",
      ...window,
      patch: { ratchet: 2 },
    });
    const back = patchPaintedStep(at2, {
      lane: "kick",
      ...window,
      patch: { ratchet: 1 },
    });
    expect(back?.[0].notes?.[0]).not.toHaveProperty("ratchet");
  });

  it("toggles a flam both ways", () => {
    const on = patchPaintedStep(base(), {
      lane: "kick",
      ...window,
      patch: { flam: true },
    });
    expect(on?.[0].notes?.[0].flam).toBe(true);
    const off = patchPaintedStep(on, {
      lane: "kick",
      ...window,
      patch: { flam: false },
    });
    expect(off?.[0].notes?.[0]).not.toHaveProperty("flam");
  });

  it("keeps the gate when the feel changes", () => {
    const gated = setDrumStepGate(base(), {
      lane: "kick",
      ...window,
      beats: 2,
    });
    const rolled = patchPaintedStep(gated, {
      lane: "kick",
      ...window,
      patch: { ratchet: 2 },
    });
    expect(rolled?.[0].notes?.[0].durBeats).toBe(2);
    expect(rolled?.[0].notes?.[0].ratchet).toBe(2);
  });

  it("returns the same array when nothing changes", () => {
    const blocks = base();
    expect(
      patchPaintedStep(blocks, {
        lane: "kick",
        ...window,
        patch: { ratchet: 1 },
      }),
    ).toBe(blocks);
  });

  it("no-ops on a window with no authored step", () => {
    const blocks = base();
    expect(
      patchPaintedStep(blocks, {
        lane: "kick",
        startBeat: 6,
        endBeat: 7,
        patch: { ratchet: 2 },
      }),
    ).toBe(blocks);
  });
});

describe("authoredSteps — the feel of a painted step", () => {
  it("reports ratchet, flam and probability", () => {
    const blocks: DrumBlock[] = [
      {
        id: stepsBlockId("kick", 0, 1),
        lane: "kick",
        startBeat: 0,
        endBeat: 1,
        mode: "steps",
        notes: [
          {
            beat: 0,
            voice: "kick",
            velocity: 100,
            durBeats: 1,
            ratchet: 3,
            flam: true,
            prob: 0.5,
          },
        ],
      },
    ];
    expect(authoredSteps(blocks, "kick", 4, 4)[0]).toEqual({
      gate: 1,
      ratchet: 3,
      flam: true,
      prob: 0.5,
    });
  });

  it("fills in the defaults a bare step relies on", () => {
    const blocks: DrumBlock[] = [
      {
        id: stepsBlockId("kick", 0, 1),
        lane: "kick",
        startBeat: 0,
        endBeat: 1,
        mode: "steps",
        notes: [{ beat: 0, voice: "kick", velocity: 100 }],
      },
    ];
    expect(authoredSteps(blocks, "kick", 4, 4)[0]).toEqual({
      ratchet: 1,
      flam: false,
      prob: 1,
    });
  });
});
