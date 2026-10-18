import { describe, it, expect } from "vitest";
import { activeChordIdAt, activeStepIndex } from "./activeChord";

const occurrences = [
  { startTime: 0, chord: { id: "a" } },
  { startTime: 4, chord: { id: "b" } },
  { startTime: 8, chord: { id: "c" } },
];

describe("activeChordIdAt", () => {
  it("picks the occurrence covering the beat", () => {
    expect(activeChordIdAt(occurrences, 0)).toBe("a");
    expect(activeChordIdAt(occurrences, 3.9)).toBe("a");
    expect(activeChordIdAt(occurrences, 4)).toBe("b");
    expect(activeChordIdAt(occurrences, 11.5)).toBe("c");
  });

  it("does not run past the last chord", () => {
    expect(activeChordIdAt(occurrences, 999)).toBe("c");
  });

  it("treats a beat before the first onset as the first chord", () => {
    const pushed = [{ startTime: 0.5, chord: { id: "x" } }];
    expect(activeChordIdAt(pushed, 0)).toBe("x");
  });

  it("returns null with no playback or no chords", () => {
    expect(activeChordIdAt(occurrences, null)).toBeNull();
    expect(activeChordIdAt([], 3)).toBeNull();
  });
});

describe("activeStepIndex", () => {
  it("reports the index of the sounding chord", () => {
    expect(activeStepIndex(occurrences, 5)).toBe(1);
    expect(activeStepIndex(occurrences, null)).toBe(-1);
  });
});
