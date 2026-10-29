import { describe, expect, it } from "vitest";
import type { Chord } from "../../types/blueprint";
import {
  FLOOR_STEP,
  appendChord,
  closeRestAt,
  extendIntoRestAt,
  insertChordAt,
  floorLength,
  floorSlots,
  floorSlotsFilled,
  moveChordTo,
  removeChord,
  resizeChordTo,
  restsBetween,
  setRestAfter,
  snap,
  trimChordTo,
} from "./floorLayout";

const chord = (id: string, beats = 4, rest: Partial<Chord> = {}): Chord =>
  ({ id, romanNumeral: "I", root: "C", quality: "maj", beats, ...rest }) as Chord;

const iv = (chords: Chord[]) => chords.map((c) => c.id);
const spans = (chords: Chord[]) => floorSlots(chords).map((s) => [s.chord.id, s.start, s.end]);
const startOf = (chords: Chord[], id: string) => floorSlots(chords).find((s) => s.chord.id === id)!.start;
const endOf = (chords: Chord[], id: string) => floorSlots(chords).find((s) => s.chord.id === id)!.end;
const gaps = (chords: Chord[]) => restsBetween(chords).map((r) => [r.start, r.beats]);

describe("floorSlots — the schema read as a timeline", () => {
  it("tiles chords back to back when there are no rests", () => {
    expect(spans([chord("a"), chord("b")])).toEqual([
      ["a", 0, 4],
      ["b", 4, 8],
    ]);
  });

  it("counts rests in the positions", () => {
    expect(spans([chord("a", 4, { restAfter: 2 }), chord("b")])).toEqual([
      ["a", 0, 4],
      ["b", 6, 10],
    ]);
  });

  it("restBefore delays the first chord", () => {
    expect(spans([chord("a", 4, { restBefore: 2 }), chord("b")])).toEqual([
      ["a", 2, 6],
      ["b", 6, 10],
    ]);
  });

  it("floorLength includes the trailing rest", () => {
    expect(floorLength([chord("a", 4, { restAfter: 4 })])).toBe(8);
    expect(floorLength([chord("a"), chord("b")])).toBe(8);
  });

  it("reports every gap as a rest band", () => {
    expect(gaps([chord("a", 4, { restBefore: 1, restAfter: 2 }), chord("b", 2, { restAfter: 3 })])).toEqual([
      [0, 1],
      [5, 2],
      [9, 3],
    ]);
  });
});

describe("moveChordTo", () => {
  it("moves a chord and leaves the space behind as a rest", () => {
    const next = moveChordTo([chord("a"), chord("b"), chord("c")], "b", 7);
    expect(iv(next)).toEqual(["a", "b", "c"]);
    expect(spans(next)).toEqual([
      ["a", 0, 4],
      ["b", 7, 11],
      ["c", 11, 15],
    ]);
    expect(gaps(next)).toEqual([[4, 3]]);
  });

  it("snaps to the floor grid", () => {
    const next = moveChordTo([chord("a"), chord("b")], "b", 5.3);
    expect(startOf(next, "b")).toBe(5.5);
  });

  it("trades places when dropped onto another chord", () => {
    const next = moveChordTo([chord("a"), chord("b"), chord("c")], "a", 5);
    // a takes b's slot, b takes a's.
    expect(spans(next)).toEqual([
      ["b", 0, 4],
      ["a", 4, 8],
      ["c", 8, 12],
    ]);
  });

  it("an uneven trade leaves the difference as a rest", () => {
    // b takes a's four-beat slot but is only two beats long, so beats 2–4
    // become silence rather than squeezing anybody.
    const next = moveChordTo([chord("a", 4), chord("b", 2), chord("c", 4)], "a", 5);
    expect(spans(next)).toEqual([
      ["b", 0, 2],
      ["a", 4, 8],
      ["c", 8, 12],
    ]);
    expect(gaps(next)).toEqual([[2, 2]]);
  });

  it("never moves before zero", () => {
    const next = moveChordTo([chord("a"), chord("b")], "b", -4);
    expect(startOf(next, "b")).toBe(0);
    expect(iv(next)).toEqual(["b", "a"]);
  });

  it("keeps a gap when a chord is dragged past the end", () => {
    const next = moveChordTo([chord("a"), chord("b")], "b", 8);
    expect(floorLength(next)).toBe(12);
  });
});

describe("resizeChordTo", () => {
  it("stretches a chord and pushes what follows", () => {
    const next = resizeChordTo([chord("a"), chord("b")], "a", 6);
    expect(next[0].beats).toBe(6);
    expect(endOf(next, "b")).toBe(10);
  });

  it("shrinking leaves a rest instead of dragging the next chord back", () => {
    const next = resizeChordTo([chord("a"), chord("b")], "a", 2);
    expect(next[0].beats).toBe(2);
    expect(gaps(next)).toEqual([[2, 2]]);
  });

  it("a trailing chord may stretch past the old cycle", () => {
    const next = resizeChordTo([chord("a"), chord("b")], "b", 12);
    expect(floorLength(next)).toBe(12);
  });

  it("never shrinks below one step", () => {
    expect(resizeChordTo([chord("a")], "a", 0)[0].beats).toBe(FLOOR_STEP);
  });
});

describe("trimChordTo", () => {
  it("moves the start and opens a rest in front", () => {
    const next = trimChordTo([chord("a"), chord("b")], "a", 2);
    expect(next[0].beats).toBe(2);
    expect(spans(next)).toEqual([
      ["a", 2, 4],
      ["b", 4, 8],
    ]);
  });

  it("stops at the previous chord", () => {
    const next = trimChordTo([chord("a"), chord("b")], "b", 0);
    expect(startOf(next, "b")).toBe(4);
  });

  it("stops one step before its own end", () => {
    expect(trimChordTo([chord("a")], "a", 99)[0].beats).toBe(FLOOR_STEP);
  });
});

describe("setRestAfter", () => {
  it("opens silence and pushes the rest of the progression", () => {
    const next = setRestAfter([chord("a"), chord("b")], "a", 2);
    expect(next[0].restAfter).toBe(2);
    expect(startOf(next, "b")).toBe(6);
  });

  it("clears the rest at zero", () => {
    const next = setRestAfter([chord("a", 4, { restAfter: 2 }), chord("b")], "a", 0);
    expect(next[0].restAfter).toBeUndefined();
    expect(spans(next)[1][1]).toBe(4);
  });
});

describe("structure edits", () => {
  it("removing a chord closes the progression up", () => {
    const next = removeChord([chord("a"), chord("b"), chord("c")], "b");
    expect(iv(next)).toEqual(["a", "c"]);
    expect(floorLength(next)).toBe(8);
  });

  it("appending puts the chord last, in order", () => {
    const next = appendChord([chord("a")], chord("b", 2));
    expect(iv(next)).toEqual(["a", "b"]);
    expect(endOf(next, "b")).toBe(6);
  });
});

describe("snap", () => {
  it("rounds to half a beat", () => {
    expect(snap(1.2)).toBe(1);
    expect(snap(1.3)).toBe(1.5);
  });
});

describe("round trip — a gap has exactly one owner", () => {
  it("never writes both restAfter and restBefore for the same gap", () => {
    const next = moveChordTo([chord("a"), chord("b"), chord("c")], "b", 7);
    // only the opening gap may use restBefore
    next.slice(1).forEach((c) => expect(c.restBefore).toBeUndefined());
    expect(next.some((c) => (c.restAfter ?? 0) > 0)).toBe(true);
  });

  it("is stable: applying the same layout twice changes nothing", () => {
    const once = moveChordTo([chord("a"), chord("b"), chord("c")], "c", 12);
    const twice = moveChordTo(once, "c", 12);
    expect(twice).toEqual(once);
  });
});

describe("insertChordAt — a run up to a chord", () => {
  const prog = [chord("a", 4), chord("b", 4), chord("c", 4)];

  it("truncates the chord it lands in and gives the time to the new one", () => {
    // Insert 1 beat before b (at beat 7): a is 0–4, b is 4–8.
    const next = insertChordAt(prog, 7, chord("run", 1), 1);
    expect(spans(next)).toEqual([
      ["a", 0, 4],
      ["b", 4, 7],
      ["run", 7, 8],
      ["c", 8, 12],
    ]);
  });

  it("the chord you run up to does not move", () => {
    const next = insertChordAt(prog, 7, chord("run", 1), 1);
    expect(startOf(next, "c")).toBe(8);
  });

  it("takes the front beats when dropped on a chord's own start", () => {
    const next = insertChordAt(prog, 4, chord("run", 2), 2);
    expect(spans(next)).toEqual([
      ["a", 0, 4],
      ["run", 4, 6],
      ["b", 6, 8],
      ["c", 8, 12],
    ]);
  });

  it("fills a rest without pushing the next chord", () => {
    const withRest = [chord("a", 4, { restAfter: 4 }), chord("b", 4)];
    const next = insertChordAt(withRest, 4, chord("fill", 2), 2);
    expect(spans(next)).toEqual([
      ["a", 0, 4],
      ["fill", 4, 6],
      ["b", 8, 12],
    ]);
    expect(gaps(next)).toEqual([[6, 2]]);
  });

  it("can fill a whole rest", () => {
    const withRest = [chord("a", 4, { restAfter: 4 }), chord("b", 4)];
    const next = insertChordAt(withRest, 4, chord("fill", 4), 4);
    expect(spans(next)).toEqual([
      ["a", 0, 4],
      ["fill", 4, 8],
      ["b", 8, 12],
    ]);
    expect(gaps(next)).toEqual([]);
  });

  it("appends past the end", () => {
    const next = insertChordAt(prog, 12, chord("tail", 2), 2);
    expect(iv(next)).toEqual(["a", "b", "c", "tail"]);
    expect(floorLength(next)).toBe(14);
  });
});

describe("rests as objects", () => {
  const rippled = [chord("a", 4, { restAfter: 2 }), chord("b", 4)];

  it("closeRestAt pulls the music earlier", () => {
    const next = closeRestAt(rippled, 5);
    expect(spans(next)).toEqual([
      ["a", 0, 4],
      ["b", 4, 8],
    ]);
  });

  it("extendIntoRestAt gives the silence to the chord before it", () => {
    const next = extendIntoRestAt(rippled, 5);
    expect(spans(next)).toEqual([
      ["a", 0, 6],
      ["b", 6, 10],
    ]);
  });

  it("both are no-ops away from a rest", () => {
    expect(closeRestAt(rippled, 1)).toBeTruthy();
    expect(spans(closeRestAt(rippled, 1))).toEqual(spans(rippled));
    expect(spans(extendIntoRestAt(rippled, 1))).toEqual(spans(rippled));
  });
});

describe("floorSlotsFilled — the progression looped across the section", () => {
  // 6 + 7 = 13 beats of progression inside a 16-beat (4-bar) section.
  const short = [chord("c1", 3), chord("c2", 3), chord("c3", 7)];

  it("fills the section instead of stopping at the end of one pass", () => {
    // The exports loop a section's chord list to fill its bars; the floor used
    // to draw one pass, so the tail of a section looked empty while the bass,
    // colour and drum tracks were already back on chord one.
    const slots = floorSlotsFilled(short, 16);
    expect(slots.map((slot) => [slot.chord.id, slot.start, slot.end, slot.pass])).toEqual([
      ["c1", 0, 3, 0],
      ["c2", 3, 6, 0],
      ["c3", 6, 13, 0],
      ["c1", 13, 16, 1],
    ]);
  });

  it("truncates the last repeat at the section's last bar", () => {
    const slots = floorSlotsFilled(short, 14);
    const last = slots[slots.length - 1]!;
    expect(last.chord.id).toBe("c1");
    expect(last.start).toBe(13);
    expect(last.end).toBe(14);
  });

  it("leaves a section shorter than one pass as a single partial pass", () => {
    // Never invents a repeat that the section has no room for, and never runs a
    // box past the section's last bar.
    const slots = floorSlotsFilled(short, 4);
    expect(slots.map((slot) => [slot.chord.id, slot.end])).toEqual([
      ["c1", 3],
      ["c2", 4],
    ]);
  });

  it("is one pass, unchanged, when the progression fills the section", () => {
    const four = [chord("c1", 4), chord("c2", 4), chord("c3", 4), chord("c4", 4)];
    const filled = floorSlotsFilled(four, 16).map((slot) => [slot.chord.id, slot.start, slot.end]);
    expect(filled).toEqual(spans(four));
    expect(filled).toHaveLength(4);
  });
});
