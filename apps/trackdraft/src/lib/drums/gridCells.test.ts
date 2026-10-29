import { describe, expect, it } from "vitest";
import { cellsFromNotes, laneForVoice, stepsForBar, velocityTier } from "./gridCells";
import { stepIndexOf } from "./stepMath";

const LANES = [
  { key: "kick", voices: ["kick"] as const },
  { key: "snare", voices: ["snare"] as const },
  { key: "hat", voices: ["closedHat", "openHat"] as const },
];

type Note = [number, number, number];
const asPacked = (notes: Note[]) => notes as unknown as readonly [number, number, number][];

describe("stepIndexOf — the one beat → cell mapping", () => {
  it("gives the cell that starts at the step's own beat", () => {
    // 16ths: the cell beginning at 0.5 owns 0.5…0.749
    expect(stepIndexOf(0.5, 0.25)).toBe(2);
    expect(stepIndexOf(0.69, 0.25)).toBe(2);
    expect(stepIndexOf(0.7, 0.25)).toBe(2);
    // Within the 20 ms snap window of the next boundary it reads as the next
    // step, which is where a drummer would place a slightly-early hit.
    expect(stepIndexOf(0.74, 0.25)).toBe(3);
    expect(stepIndexOf(0.75, 0.25)).toBe(3);
  });

  it("snaps a hair-early onset forward into the step a drummer would read", () => {
    // Real E-GMD onsets: beat 1 arrives at 0.9958, beat 3 at 2.9958.
    expect(stepIndexOf(0.9958, 1)).toBe(1);
    expect(stepIndexOf(2.9958, 1)).toBe(3);
    expect(stepIndexOf(1.0437, 1)).toBe(1);
  });

  it("agrees with the editor's write range for every cell", () => {
    const stepBeats = 0.25;
    for (let i = 0; i < 16; i++) {
      expect(stepIndexOf(i * stepBeats, stepBeats)).toBe(i);
      expect(stepIndexOf(i * stepBeats + stepBeats * 0.9, stepBeats)).toBe(i);
    }
  });
});

describe("cellsFromNotes", () => {
  it("keeps the loudest hit when two land in one cell", () => {
    const cells = cellsFromNotes(asPacked([[0, 36, 40], [0.01, 36, 110]]), LANES, 16, 0.25);
    expect(cells.get("kick")?.get(0)).toBe(110);
  });

  it("folds a voice into its lane and drops unmapped voices", () => {
    const cells = cellsFromNotes(
      asPacked([[0, 42, 80], [1, 46, 90], [2, 35, 60]]),
      LANES,
      16,
      0.25,
    );
    // 42 = closed hat → hat lane, 46 = open hat → the same lane, 35 = kick.
    expect(cells.get("hat")?.get(0)).toBe(80);
    expect(cells.get("hat")?.get(4)).toBe(90);
    expect(cells.get("kick")?.get(8)).toBe(60);
  });

  it("wraps a two-bar source onto one bar instead of overflowing", () => {
    const cells = cellsFromNotes(asPacked([[4, 36, 90]]), LANES, 16, 0.25);
    expect(cells.get("kick")?.get(0)).toBe(90);
  });

  it("puts an off-grid corpus onset in the same cell the editor writes", () => {
    // 0.13 is in the second half of step 0: rounding would light step 1.
    const cells = cellsFromNotes(asPacked([[0.13, 38, 90]]), LANES, 16, 0.25);
    expect(cells.get("snare")?.has(0)).toBe(true);
    expect(cells.get("snare")?.has(1)).toBe(false);
  });
});

describe("stepsForBar", () => {
  it("divides common and odd meters without drifting", () => {
    expect(stepsForBar(4)).toEqual({ stepsPerBar: 16, stepBeats: 0.25 });
    expect(stepsForBar(3)).toEqual({ stepsPerBar: 12, stepBeats: 0.25 });
    expect(stepsForBar(6)).toEqual({ stepsPerBar: 24, stepBeats: 0.25 });
    // 7/8 → 3.5 beats: 14 eighths, an integer cell count.
    expect(stepsForBar(3.5)).toEqual({ stepsPerBar: 14, stepBeats: 0.25 });
  });
});

describe("velocityTier", () => {
  it("separates ghosts from accents at the thresholds the takes imply", () => {
    expect(velocityTier(20)).toBe("ghost");
    expect(velocityTier(44)).toBe("ghost");
    expect(velocityTier(45)).toBe("normal");
    expect(velocityTier(99)).toBe("normal");
    expect(velocityTier(100)).toBe("accent");
    expect(velocityTier(127)).toBe("accent");
  });
});

describe("laneForVoice", () => {
  it("resolves each member voice of a lane", () => {
    expect(laneForVoice(LANES, "openHat")?.key).toBe("hat");
    expect(laneForVoice(LANES, "kick")?.key).toBe("kick");
  });
});
