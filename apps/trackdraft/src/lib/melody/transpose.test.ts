import { describe, it, expect } from "vitest";
import {
  anchorDegree,
  canShiftOctave,
  degreeSteps,
  noteRange,
  scaleDegreeLabels,
  shiftOctave,
  transposeDegrees,
  transposeToDegree,
} from "./transpose";
import type { MelodyNote } from "../../types/blueprint";

const note = (pitch: number, startTime = 0): MelodyNote => ({
  pitch,
  startTime,
  duration: 1,
  velocity: 96,
});

const C_MAJOR = { keyName: "C" as const, scale: "ionian" as const };

describe("noteRange", () => {
  it("reports the extremes and handles an empty line", () => {
    expect(noteRange([note(60), note(72), note(55)])).toEqual({ low: 55, high: 72 });
    expect(noteRange([])).toBeNull();
  });
});

describe("shiftOctave", () => {
  const line = [note(60), note(64), note(67)];

  it("moves the whole line by 12 semitones", () => {
    expect(shiftOctave(line, 1).map((n) => n.pitch)).toEqual([72, 76, 79]);
    expect(shiftOctave(line, -1).map((n) => n.pitch)).toEqual([48, 52, 55]);
  });

  it("keeps velocities and timing untouched", () => {
    const shifted = shiftOctave([note(60, 2)], 1)[0];
    expect(shifted).toMatchObject({ pitch: 72, startTime: 2, duration: 1, velocity: 96 });
  });

  it("refuses a shift that would leave the MIDI range", () => {
    expect(canShiftOctave([note(120)], 1)).toBe(false);
    expect(shiftOctave([note(120)], 1)).toEqual([note(120)]);
    expect(canShiftOctave([note(3)], -1)).toBe(false);
    expect(shiftOctave([note(3)], -1)).toEqual([note(3)]);
  });

  it("has nothing to do for a zero shift", () => {
    expect(canShiftOctave(line, 0)).toBe(false);
  });
});

describe("anchorDegree", () => {
  it("reads the scale degree of the first note", () => {
    expect(anchorDegree([note(64, 4), note(60, 0)], C_MAJOR)).toBe(0);
    expect(anchorDegree([note(64, 4), note(71, 0)], C_MAJOR)).toBe(6);
    expect(anchorDegree([note(69)], C_MAJOR)).toBe(5);
    expect(anchorDegree([], C_MAJOR)).toBeNull();
  });

  it("works for a non-C tonic", () => {
    expect(anchorDegree([note(64)], { keyName: "A", scale: "ionian" })).toBe(4);
    expect(anchorDegree([note(57)], { keyName: "A", scale: "aeolian" })).toBe(0);
  });
});

describe("degreeSteps", () => {
  it("takes the shorter way round so the register stays close", () => {
    // I → V is three degrees down (a fourth) rather than four up (a fifth).
    expect(degreeSteps(0, 4, 7)).toBe(-3);
    expect(degreeSteps(0, 5, 7)).toBe(-2);
    expect(degreeSteps(0, 3, 7)).toBe(3);
    expect(degreeSteps(4, 0, 7)).toBe(3);
    expect(degreeSteps(2, 2, 7)).toBe(0);
  });
});

describe("transposeDegrees", () => {
  it("moves a triad up the scale, keeping the key", () => {
    const line = [note(60, 0), note(64, 1), note(67, 2)];
    // I → vi: C E G becomes A C E (all still in C major).
    expect(transposeDegrees(line, 5, C_MAJOR).map((n) => n.pitch)).toEqual([69, 72, 76]);
  });

  it("moves down for negative steps", () => {
    // C5 down two degrees is A4 (a minor third).
    expect(transposeDegrees([note(72)], -2, C_MAJOR)[0].pitch).toBe(69);
  });

  it("stays diatonic instead of moving by a fixed semitone count", () => {
    // C major to D major region: E (degree 2) → F# (degree 3), not F.
    const line = [note(60), note(64), note(67), note(71)];
    const up = transposeDegrees(line, 1, C_MAJOR).map((n) => n.pitch);
    expect(up).toEqual([62, 65, 69, 72]);
  });

  it("keeps a blue note's alteration above the new degree", () => {
    // C# (raised tonic) shifted +2 degrees becomes E#/F.
    expect(transposeDegrees([note(61)], 2, C_MAJOR)[0].pitch).toBe(65);
  });

  it("respects the section's mode and tonic", () => {
    const aMinor = { keyName: "A" as const, scale: "aeolian" as const };
    // i → III in A minor: A C E becomes C E G.
    expect(transposeDegrees([note(57), note(60), note(64)], 2, aMinor).map((n) => n.pitch)).toEqual([
      60, 64, 67,
    ]);
  });

  it("folds by octaves rather than leaving the MIDI range", () => {
    // F9 (125) up two degrees is A9 (129) — folded down to A8.
    expect(transposeDegrees([note(125)], 2, C_MAJOR)[0].pitch).toBe(117);
  });

  it("is a no-op for zero steps or an empty line", () => {
    const line = [note(60)];
    expect(transposeDegrees(line, 0, C_MAJOR)).toBe(line);
    expect(transposeDegrees([], 3, C_MAJOR)).toEqual([]);
  });
});

describe("transposeToDegree", () => {
  it("lands the first note on the requested degree", () => {
    const line = [note(60, 0), note(64, 1)];
    const moved = transposeToDegree(line, 5, C_MAJOR);
    expect(anchorDegree(moved, C_MAJOR)).toBe(5);
    // The shorter route: down to A3 rather than up to A4.
    expect(moved.map((n) => n.pitch)).toEqual([57, 60]);
  });

  it("is a no-op when the line already sits there", () => {
    const line = [note(69, 0)];
    expect(transposeToDegree(line, 5, C_MAJOR)).toBe(line);
  });
});

describe("scaleDegreeLabels", () => {
  it("cases the numerals by triad quality", () => {
    expect(scaleDegreeLabels({ scale: "ionian" }).map((d) => d.numeral)).toEqual([
      "I", "ii", "iii", "IV", "V", "vi", "vii°",
    ]);
    expect(scaleDegreeLabels({ scale: "aeolian" }).map((d) => d.numeral)).toEqual([
      "i", "ii°", "III", "iv", "v", "VI", "VII",
    ]);
  });
});
