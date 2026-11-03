import { describe, expect, it } from "vitest";
import {
  chordLengthFromDrag,
  DEFAULT_STEPS_PER_BAR,
  GRID_LADDER,
  gridUnit,
  lengthFromEdge,
  nextGrid,
  resizeNote,
  snapToGrid,
} from "./grid";

/**
 * The grid (§S2.1) — every lane's answer to "how long is this?".
 *
 * Durations were the one thing the canvas could not edit: notes moved, chords
 * had a private edge calculation, a drum hit had no length. These tests pin the
 * rules so all four lanes share them.
 */
describe("the ladder", () => {
  it("counts in steps per bar, not decimals", () => {
    expect(gridUnit(4, 4)).toBe(1); // a 4/4 bar, a beat
    expect(gridUnit(4, 8)).toBe(0.5); // an eighth
    expect(gridUnit(4, 16)).toBe(0.25); // a sixteenth — the canvas's old default
    expect(gridUnit(4, 1)).toBe(4); // the whole bar
  });

  it("is bar-aware: a 7/8 bar's sixteenth is not a 4/4 bar's", () => {
    // 7/8 is 3.5 quarter-note beats, so an eighth of the bar is 0.4375 — a
    // fixed 0.5 would drift a semiquaver per bar in every odd meter.
    expect(gridUnit(3.5, 8)).toBe(0.4375);
    expect(gridUnit(3.5, 4)).toBe(0.875);
    expect(gridUnit(3.5, 16)).toBe(0.21875);
  });

  it("falls back to a beat for a nonsense bar or rung", () => {
    expect(gridUnit(0, 4)).toBe(1);
    expect(gridUnit(-2, 4)).toBe(1);
    expect(gridUnit(4, 5)).toBe(1);
  });

  it("walks the ladder and wraps", () => {
    const seen: number[] = [];
    let steps = DEFAULT_STEPS_PER_BAR;
    for (let i = 0; i < GRID_LADDER.length; i += 1) {
      steps = nextGrid(steps);
      seen.push(steps);
    }
    expect(seen).toEqual([1, 2, 4, 8, 16]);
  });

  it("defaults to the grid the canvas already used, so dragging is unchanged", () => {
    // `beatGrid` gave 0.25 beats in 4/4; the new default reproduces it exactly.
    expect(DEFAULT_STEPS_PER_BAR).toBe(16);
    expect(gridUnit(4, DEFAULT_STEPS_PER_BAR)).toBe(0.25);
  });
});

describe("snapToGrid", () => {
  it("rounds to the nearest step", () => {
    expect(snapToGrid(1.4, 1)).toBe(1);
    expect(snapToGrid(1.6, 1)).toBe(2);
    expect(snapToGrid(1.3, 0.5)).toBe(1.5);
  });

  it("leaves the value alone without a unit", () => {
    expect(snapToGrid(1.37, 0)).toBe(1.37);
  });
});

describe("lengthFromEdge", () => {
  it("snaps the edge and measures from the onset", () => {
    expect(lengthFromEdge(2, 5.4, 1, 32)).toBe(3);
    expect(lengthFromEdge(2, 5.6, 1, 32)).toBe(4);
  });

  it("never shorter than one step — a sliver cannot be grabbed again", () => {
    expect(lengthFromEdge(2, 2, 1, 32)).toBe(1);
    expect(lengthFromEdge(2, 1, 1, 32)).toBe(1);
  });

  it("stops at the end of the section", () => {
    expect(lengthFromEdge(30, 40, 1, 32)).toBe(2);
  });
});

describe("resizeNote", () => {
  const notes = [
    { pitch: 36, startTime: 0, duration: 1 },
    { pitch: 43, startTime: 4, duration: 1 },
  ];

  it("lengthens one note and leaves the other alone", () => {
    const next = resizeNote(notes, 1, 7, 1, 32);
    expect(next[1].duration).toBe(3);
    expect(next[0]).toEqual(notes[0]);
  });

  it("shortens without going under a step", () => {
    expect(resizeNote(notes, 0, 0.2, 1, 32)[0].duration).toBe(1);
  });

  it("returns the same notes when nothing changes", () => {
    const same = resizeNote(notes, 0, 1, 1, 32);
    expect(same[0]).toEqual(notes[0]);
  });

  it("ignores a note that is not there", () => {
    expect(resizeNote(notes, 9, 8, 1, 32)).toEqual(notes);
  });
});

describe("chordLengthFromDrag", () => {
  it("turns a pixel drag into snapped beats", () => {
    // 40 px at 20 px per beat is two beats; from a four-beat chord that is six.
    expect(chordLengthFromDrag(4, 40, 20, 1)).toBe(6);
  });

  it("keeps a chord at least a sixteenth long, whatever the grid", () => {
    // The canvas has always allowed a sixteenth chord; a coarse grid must not
    // make the shortest legal chord longer than the shortest useful one.
    expect(chordLengthFromDrag(4, -400, 20, 1)).toBe(0.25);
    expect(chordLengthFromDrag(4, 0, 20, 4)).toBe(4);
  });

  it("never returns zero or a negative length", () => {
    expect(chordLengthFromDrag(4, -10000, 20, 0.25)).toBeGreaterThan(0);
  });
});
