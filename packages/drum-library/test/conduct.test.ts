import { describe, expect, it } from "vitest";
import type { TimeDomain } from "@music-theory/song-blueprint";
import { conductSection } from "../src/conduct.js";
import { resolveChordOccurrences } from "../src/chordCycle.js";
import type { MeterOutline } from "../src/meter.js";

/** The shape these tests exercise. Written out rather than inferred from the
 *  literal below, so an override is checked against the real fields instead of
 *  quietly widening to `Record<string, unknown>`. */
interface TestSection {
  id: string;
  bars: number;
  chords: { id: string; beats: number; restAfter?: number }[];
  timeDomain: TimeDomain | null;
  /** The authored grid the harmony can advance on instead of chord `beats`. */
  harmonyMeterOutline: MeterOutline | null;
  melody: { notes: { startTime: number; duration: number; pitch: number }[] };
  bassNotes: { startTime: number; duration: number; pitch: number }[];
}

/** A four-chord, four-beat-a-piece progression in a 32-beat (8-bar) section. */
function section(overrides: Partial<TestSection> = {}): TestSection {
  return {
    id: "s",
    bars: 8,
    chords: [
      { id: "c1", beats: 4 },
      { id: "c2", beats: 4 },
      { id: "c3", beats: 4 },
      { id: "c4", beats: 4 },
    ],
    timeDomain: null,
    harmonyMeterOutline: null,
    melody: { notes: [] },
    bassNotes: [],
    ...overrides,
  };
}

describe("conductSection — the section as its clock plays it", () => {
  it("returns the section itself when there is no clock", () => {
    const plain = section();
    expect(conductSection(plain, 32)).toBe(plain);
  });

  it("returns the section itself for a clock that changes nothing", () => {
    // `{ rate: 1 }` is "the song's own time"; identity keeps memo equality and
    // "absent stays byte identical" true for every existing song.
    const plain = section({ timeDomain: { rate: 1 } });
    expect(conductSection(plain, 32)).toBe(plain);
  });

  it("stretches each chord at half time", () => {
    const conducted = conductSection(
      section({ timeDomain: { rate: 0.5 } }),
      32,
    );
    expect(conducted.chords.map((chord) => chord.beats)).toEqual([8, 8, 8, 8]);
    expect("timeDomain" in conducted).toBe(false);
  });

  it("shortens each chord at double time, and resolves to a tiled progression", () => {
    const fast = section({ timeDomain: { rate: 2 } });
    const conducted = conductSection(fast, 32);
    expect(conducted.chords.map((chord) => chord.beats)).toEqual([2, 2, 2, 2]);
    // The progression is 8 global beats long now, so the resolver repeats it
    // four times across the eight bars — the "riff over the section" reading.
    const occurrences = resolveChordOccurrences(conducted, 32);
    expect(occurrences.map((occ) => occ.startTime)).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
    ]);
  });

  it("folds the progression to the loop", () => {
    // A four-beat loop is the first chord only; the rest never happen.
    const looped = conductSection(
      section({ timeDomain: { rate: 1, cycle: 4 } }),
      32,
    );
    expect(looped.chords.map((chord) => chord.id)).toEqual(["c1"]);
    expect(looped.chords[0].beats).toBe(4);
  });

  it("cuts the chord that straddles the loop", () => {
    const looped = conductSection(
      section({ timeDomain: { rate: 1, cycle: 6 } }),
      32,
    );
    expect(looped.chords.map((chord) => chord.beats)).toEqual([4, 2]);
  });

  it("scales rests with the chords they sit beside", () => {
    const withRest = section({
      chords: [
        { id: "c1", beats: 4, restAfter: 2 },
        { id: "c2", beats: 4 },
      ],
      timeDomain: { rate: 0.5 },
    });
    const conducted = conductSection(withRest, 32);
    expect(conducted.chords[0].restAfter).toBe(4);
    expect(conducted.chords[0].beats).toBe(8);
  });

  it("moves and lengthens stored notes, not just their onsets", () => {
    // A half-time phrase lasts twice as long; leaving the durations alone made
    // every note staccato the moment the clock came on.
    const conducted = conductSection(
      section({
        timeDomain: { rate: 0.5 },
        melody: { notes: [{ startTime: 2, duration: 1, pitch: 60 }] },
        bassNotes: [{ startTime: 2, duration: 1, pitch: 36 }],
      }),
      32,
    );
    expect(conducted.melody.notes[0]).toEqual({
      startTime: 4,
      duration: 2,
      pitch: 60,
    });
    expect(conducted.bassNotes[0]).toEqual({
      startTime: 4,
      duration: 2,
      pitch: 36,
    });
  });

  it("drops a stored note the clock pushed past the end", () => {
    const conducted = conductSection(
      section({
        timeDomain: { rate: 0.5 },
        melody: {
          notes: [
            { startTime: 0, duration: 1, pitch: 60 },
            { startTime: 20, duration: 1, pitch: 62 },
          ],
        },
      }),
      32,
    );
    expect(conducted.melody.notes.map((note) => note.pitch)).toEqual([60]);
  });

  it("folds stored notes into the loop", () => {
    const conducted = conductSection(
      section({
        timeDomain: { rate: 1, cycle: 4 },
        melody: {
          notes: [
            { startTime: 0, duration: 1, pitch: 60 },
            { startTime: 8, duration: 1, pitch: 64 },
          ],
        },
      }),
      16,
    );
    // Only the first note is inside the four-beat loop, so it repeats.
    expect(conducted.melody.notes.map((note) => note.startTime)).toEqual([
      0, 4, 8, 12,
    ]);
    expect(new Set(conducted.melody.notes.map((note) => note.pitch))).toEqual(
      new Set([60]),
    );
  });
});

describe("resolveChordOccurrences — the clock reaches the harmony itself", () => {
  // The regression test for §P3.5: the bass used to move while the chords stood
  // still. Both resolve through this function, so both move together.
  it("spaces chord changes by the section's own clock", () => {
    const slow = section({ timeDomain: { rate: 0.5 } });
    const onsets = resolveChordOccurrences(slow, 32).map(
      (occ) => occ.startTime,
    );
    expect(onsets).toEqual([0, 8, 16, 24]);
  });

  it("leaves the grid alone without a clock, and during a loop-free identity", () => {
    expect(
      resolveChordOccurrences(section(), 32).map((occ) => occ.startTime),
    ).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(
      resolveChordOccurrences(section({ timeDomain: { rate: 1 } }), 32).map(
        (occ) => occ.startTime,
      ),
    ).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  it("retimes an authored grid by its cell length", () => {
    // `structural_warp` lays the changes out on an outline of its own, which
    // ignores chord `beats` — so the clock scales the CELL instead. A warp keeps
    // its syncopation at a different speed rather than standing still.
    const warped = section({
      // 4/4 as 2+2: four cells of one quarter-note beat each.
      harmonyMeterOutline: { cellBeats: 1, cells: [2, 2], label: "1 2 1 2" },
    });
    const plain = resolveChordOccurrences(warped, 16).map(
      (occ) => occ.startTime,
    );
    const half = resolveChordOccurrences(
      { ...warped, timeDomain: { rate: 0.5 } },
      16,
    ).map((occ) => occ.startTime);
    expect(plain).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(half).toEqual([0, 4, 8, 12]);
  });
});

describe("conductSection — lengths are scaled before they are clipped", () => {
  it("never leaves a note ringing past the section end", () => {
    // S2 caught the ordering bug: scaling the length AFTER the mapping put the
    // tail back over the boundary, so a half-time phrase ended two beats into
    // the next section. Here the note maps to 6 with a stretched length of 4 —
    // it has to arrive as 2, cut at the section's edge.
    const nearEnd = conductSection(
      section({
        timeDomain: { rate: 0.5 },
        melody: { notes: [{ startTime: 3, duration: 2, pitch: 60 }] },
      }),
      8,
    );
    expect(nearEnd.melody.notes[0]).toEqual({
      startTime: 6,
      duration: 2,
      pitch: 60,
    });
  });

  it("drops a note the clock pushed entirely past the end", () => {
    const gone = conductSection(
      section({
        timeDomain: { rate: 0.5 },
        melody: { notes: [{ startTime: 7, duration: 1, pitch: 60 }] },
      }),
      8,
    );
    expect(gone.melody.notes).toEqual([]);
  });
});
