import { describe, it, expect } from "vitest";
import {
  octaveOf,
  letterOf,
  staffSteps,
  ledgerLinesBelow,
  ledgerLinesAbove,
  noteHeadType,
  accidentalFor,
} from "./notation";

describe("staffSteps", () => {
  it("maps the treble staff lines and spaces", () => {
    expect(staffSteps(64)).toBe(0); // E4 bottom line
    expect(staffSteps(65)).toBe(1); // F4 first space
    expect(staffSteps(67)).toBe(2); // G4 second line
    expect(staffSteps(71)).toBe(4); // B4 middle line
    expect(staffSteps(74)).toBe(6); // D5 fourth line
    expect(staffSteps(77)).toBe(8); // F5 top line
  });

  it("handles accidentals as their letter (F# sits on F, not a line between)", () => {
    expect(staffSteps(66)).toBe(1); // F#4 → same slot as F4
    expect(staffSteps(61)).toBe(-2); // C#4 → same slot as C4 (a ledger line below)
  });

  it("places middle C and notes below/above the staff", () => {
    expect(staffSteps(60)).toBe(-2); // C4 (middle C) — one line-space below
    expect(staffSteps(57)).toBe(-4); // A3
    expect(staffSteps(59)).toBe(-3); // B3 — a space between A3 and C4 ledger lines
    expect(staffSteps(62)).toBe(-1); // D4 — first space below the staff
    expect(staffSteps(79)).toBe(9); // G5 — space above the top line
    expect(staffSteps(81)).toBe(10); // A5 — ledger line above
    expect(staffSteps(84)).toBe(12); // C6
  });

  it("octaveOf is C4 at 60", () => {
    expect(octaveOf(60)).toBe(4);
    expect(octaveOf(84)).toBe(6);
    expect(letterOf(61)).toBe("C");
    expect(letterOf(66)).toBe("F");
  });
});

describe("ledgerLinesBelow", () => {
  it("draws one ledger line for middle C", () => {
    expect(ledgerLinesBelow(-2)).toEqual([-2]);
  });
  it("draws two ledger lines for A3", () => {
    expect(ledgerLinesBelow(-4)).toEqual([-4, -2]);
  });
  it("draws two ledger lines for B3 (a space below the staff)", () => {
    expect(ledgerLinesBelow(-3)).toEqual([-4, -2]);
  });
  it("draws one ledger line for D4 (a space just below the staff)", () => {
    expect(ledgerLinesBelow(-1)).toEqual([-2]);
  });
  it("draws nothing for on-staff notes", () => {
    expect(ledgerLinesBelow(0)).toEqual([]);
    expect(ledgerLinesBelow(2)).toEqual([]);
  });
});

describe("ledgerLinesAbove", () => {
  it("draws one ledger line for A5 (steps 10)", () => {
    expect(ledgerLinesAbove(10)).toEqual([10]);
  });
  it("draws one ledger line for G5 (a space, steps 9)", () => {
    expect(ledgerLinesAbove(9)).toEqual([10]);
  });
  it("draws two ledger lines for C6 (steps 12)", () => {
    expect(ledgerLinesAbove(12)).toEqual([12, 10]);
  });
  it("draws nothing for on-staff notes", () => {
    expect(ledgerLinesAbove(8)).toEqual([]);
    expect(ledgerLinesAbove(6)).toEqual([]);
  });
});

describe("noteHeadType", () => {
  it("maps durations to note values", () => {
    expect(noteHeadType(4)).toBe("whole");
    expect(noteHeadType(2)).toBe("half");
    expect(noteHeadType(1)).toBe("quarter");
    expect(noteHeadType(0.5)).toBe("eighth");
    expect(noteHeadType(0.25)).toBe("sixteenth");
    expect(noteHeadType(0.1)).toBe("sixteenth");
  });
});

describe("accidentalFor", () => {
  it("returns null for diatonic notes in the key+scale", () => {
    expect(accidentalFor(60, "C", "ionian")).toBeNull(); // C
    expect(accidentalFor(67, "C", "ionian")).toBeNull(); // G
    expect(accidentalFor(66, "G", "ionian")).toBeNull(); // F# is diatonic in G major
    expect(accidentalFor(63, "Bb", "ionian")).toBeNull(); // Eb is diatonic in Bb major
  });
  it("returns sharp for non-diatonic notes in a sharp key", () => {
    expect(accidentalFor(61, "C", "ionian")).toBe("sharp"); // C#
    expect(accidentalFor(66, "C", "ionian")).toBe("sharp"); // F#
  });
  it("returns flat for non-diatonic notes in a flat key", () => {
    expect(accidentalFor(61, "Bb", "ionian")).toBe("flat"); // Db in Bb major
    expect(accidentalFor(66, "Bb", "ionian")).toBe("flat"); // Gb in Bb major
  });
  it("returns natural for a non-diatonic natural (E in Bb major)", () => {
    expect(accidentalFor(64, "Bb", "ionian")).toBe("natural");
  });
});
