import { describe, it, expect } from "vitest";
import {
  EFFECT_CYCLE,
  insertionIndexAt,
  moveChord,
  nextPerformanceEffect,
} from "./progressionEdits";
import type { Chord } from "../../types/blueprint";

const chord = (id: string, beats = 4): Chord => ({
  id,
  romanNumeral: id,
  root: "C",
  quality: "maj",
  beats,
});

const progression = () => [chord("I"), chord("vi"), chord("IV"), chord("V")];

describe("nextPerformanceEffect", () => {
  it("walks none → strum → pulse → arp → none", () => {
    expect(nextPerformanceEffect(undefined)).toEqual({ style: "strum" });
    expect(nextPerformanceEffect({ style: "strum" })).toEqual({ style: "pulse" });
    expect(nextPerformanceEffect({ style: "pulse" })).toEqual({ style: "arp" });
    expect(nextPerformanceEffect({ style: "arp" })).toBeUndefined();
  });

  it("starts at strum for an effect it doesn't know", () => {
    expect(nextPerformanceEffect({ style: "strum" })).toEqual(EFFECT_CYCLE[2]);
  });

  it("keeps authored params of the same style (no accidental reset)", () => {
    // findIndex matches on style + definedness only, so a param'd strum
    // still advances to pulse rather than restarting the cycle.
    expect(nextPerformanceEffect({ style: "strum", params: { spread: 3 } })).toEqual({ style: "pulse" });
  });
});

describe("insertionIndexAt", () => {
  const cells = [
    { start: 0, end: 4 },
    { start: 4, end: 8 },
    { start: 8, end: 12 },
    { start: 12, end: 16 },
  ];

  it("returns the caret slot between chords", () => {
    expect(insertionIndexAt(cells, 0)).toBe(0);
    expect(insertionIndexAt(cells, 1.9)).toBe(0);
    expect(insertionIndexAt(cells, 2.1)).toBe(1);
    expect(insertionIndexAt(cells, 9)).toBe(2);
    // Past the last chord's midpoint the caret sits at the end of the row.
    expect(insertionIndexAt(cells, 13)).toBe(3);
    expect(insertionIndexAt(cells, 15)).toBe(4);
    expect(insertionIndexAt(cells, 40)).toBe(4);
  });

  it("handles an empty cycle", () => {
    expect(insertionIndexAt([], 3)).toBe(0);
  });
});

describe("moveChord", () => {
  it("moves a chord later in the list", () => {
    // Insert after the third chord (caret 3) from index 0 → lands at index 2.
    expect(moveChord(progression(), 0, 3).map((c) => c.id)).toEqual(["vi", "IV", "I", "V"]);
  });

  it("moves a chord earlier in the list", () => {
    expect(moveChord(progression(), 3, 0).map((c) => c.id)).toEqual(["V", "I", "vi", "IV"]);
  });

  it("is a no-op when the chord doesn't move", () => {
    const chords = progression();
    expect(moveChord(chords, 1, 1)).toBe(chords);
    expect(moveChord(chords, 1, 2)).toBe(chords);
  });

  it("clamps out-of-range input", () => {
    const chords = progression();
    expect(moveChord(chords, 9, 0)).toBe(chords);
    expect(moveChord(chords, 0, 99).map((c) => c.id)).toEqual(["vi", "IV", "V", "I"]);
  });

  it("leaves a single chord alone", () => {
    const one = [chord("I")];
    expect(moveChord(one, 0, 1)).toBe(one);
  });
});
