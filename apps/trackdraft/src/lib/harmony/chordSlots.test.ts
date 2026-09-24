import { describe, it, expect } from "vitest";
import { chordSlotsForSection, chordSlotAt } from "./chordSlots";
import type { Chord } from "../../types/blueprint";

function makeChord(id: string, beats: number, romanNumeral = "I", root = "C"): Chord {
  return { id, romanNumeral, root, quality: "maj", beats } as Chord;
}

describe("chordSlotsForSection", () => {
  it("loops the progression to fill the section's full duration", () => {
    const chords = [makeChord("a", 4), makeChord("b", 4)];
    const slots = chordSlotsForSection(chords, 16);
    expect(slots.map((s) => [s.chord.id, s.startBeat, s.durationBeats])).toEqual([
      ["a", 0, 4],
      ["b", 4, 4],
      ["a", 8, 4],
      ["b", 12, 4],
    ]);
  });

  it("truncates the final pass at the section's end", () => {
    const chords = [makeChord("a", 4), makeChord("b", 4)];
    const slots = chordSlotsForSection(chords, 10);
    expect(slots.map((s) => [s.chord.id, s.startBeat, s.durationBeats])).toEqual([
      ["a", 0, 4],
      ["b", 4, 4],
      ["a", 8, 2],
    ]);
  });

  it("returns nothing for no chords, zero duration, or a zero-beat cycle", () => {
    expect(chordSlotsForSection([], 16)).toEqual([]);
    expect(chordSlotsForSection([makeChord("a", 4)], 0)).toEqual([]);
    expect(chordSlotsForSection([makeChord("z", 0)], 8)).toEqual([]);
  });

  it("skips zero-beat chords without hanging or emitting empty slots", () => {
    const slots = chordSlotsForSection([makeChord("a", 4), makeChord("z", 0), makeChord("b", 4)], 8);
    expect(slots.map((s) => s.chord.id)).toEqual(["a", "b"]);
  });
});

describe("chordSlotAt", () => {
  const slots = chordSlotsForSection([makeChord("a", 4), makeChord("b", 4)], 8);

  it("is start-inclusive, end-exclusive", () => {
    expect(chordSlotAt(slots, 0)?.chord.id).toBe("a");
    expect(chordSlotAt(slots, 3.999)?.chord.id).toBe("a");
    expect(chordSlotAt(slots, 4)?.chord.id).toBe("b");
    expect(chordSlotAt(slots, 7.999)?.chord.id).toBe("b");
  });

  it("returns null outside the section", () => {
    expect(chordSlotAt(slots, -0.5)).toBeNull();
    expect(chordSlotAt(slots, 8)).toBeNull();
    expect(chordSlotAt([], 0)).toBeNull();
  });
});
