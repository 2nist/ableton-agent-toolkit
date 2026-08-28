import { describe, it, expect } from "vitest";
import { foldNotesToSection, dedupeNotes } from "./recordTiming";
import type { MelodyNote } from "../../types/blueprint";

function note(pitch: number, startTime: number, duration = 1): MelodyNote {
  return { pitch, startTime, duration, velocity: 96 };
}

describe("foldNotesToSection", () => {
  it("keeps notes already inside the window untouched", () => {
    const notes = [note(60, 0.5), note(64, 1.5)];
    const out = foldNotesToSection(notes, 8);
    expect(out.map((n) => n.startTime)).toEqual([0.5, 1.5]);
  });

  it("folds a second pass back onto the first (4-beat section, pass 2 notes at +4..8)", () => {
    const notes = [note(60, 0.5), note(64, 1.5), note(60, 4.5), note(64, 5.5)];
    const out = foldNotesToSection(notes, 4);
    // +4.5 → 0.5, +5.5 → 1.5 — same beats as pass 1
    expect(out.map((n) => n.startTime)).toEqual([0.5, 1.5, 0.5, 1.5]);
  });

  it("drops negative times (captured before the anchor)", () => {
    const out = foldNotesToSection([note(60, -0.3), note(62, 1)], 4);
    expect(out.map((n) => n.startTime)).toEqual([1]);
  });

  it("handles a zero/negative span without crashing", () => {
    expect(foldNotesToSection([note(60, 1)], 0)).toEqual([]);
  });
});

describe("dedupeNotes", () => {
  it("drops a note within tolerance of an earlier one (first wins)", () => {
    const notes = [note(60, 0.5), note(60, 0.6), note(64, 1.5)];
    const out = dedupeNotes(notes, 0.25);
    expect(out).toHaveLength(2);
    expect(out[0].startTime).toBe(0.5);
  });

  it("merges a same-time pitch change across passes first-wins (monophonic)", () => {
    // A different pitch at the same beat from a later pass is a conflict,
    // not a chord — keep the first pass's note.
    const notes = [note(60, 0.5), note(64, 0.5)];
    const out = dedupeNotes(notes, 0.25);
    expect(out).toHaveLength(1);
    expect(out[0].pitch).toBe(60);
  });

  it("keeps notes separated by more than the tolerance", () => {
    const notes = [note(60, 0), note(64, 1), note(67, 2)];
    expect(dedupeNotes(notes, 0.25)).toHaveLength(3);
  });

  it("sorts by start time", () => {
    const notes = [note(67, 2), note(60, 0), note(64, 1)];
    expect(dedupeNotes(notes).map((n) => n.startTime)).toEqual([0, 1, 2]);
  });
});
