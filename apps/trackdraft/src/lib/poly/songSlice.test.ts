import { describe, expect, it } from "vitest";
import type { BlueprintSong } from "../../types/blueprint";
import { polySongSlice, sliceWouldChange } from "./songSlice";

function song(overrides: Partial<BlueprintSong> = {}): BlueprintSong {
  return {
    id: "s",
    title: "Song",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [
      {
        id: "a",
        name: "Verse",
        role: "verse",
        bars: 4,
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
        chords: [],
      },
    ],
    arrangement: [],
    ...overrides,
  } as BlueprintSong;
}

/**
 * §S1.6 — a column depends on eight fields, not on the song.
 *
 * The memo was already in place and kept missing: every column received the
 * whole `song`, so editing one section invalidated every visible column. These
 * tests pin the separation that makes the memo real.
 */
describe("polySongSlice", () => {
  it("takes the eight fields and nothing else", () => {
    const slice = polySongSlice(song({ title: "Here" }));
    expect(Object.keys(slice).sort()).toEqual(
      [
        "bend",
        "bpm",
        "concept",
        "genre",
        "key",
        "notes",
        "scale",
        "title",
      ].sort(),
    );
    expect(slice.title).toBe("Here");
  });

  it("does not change when a SECTION is edited", () => {
    // The whole point: a new song object with different sections must produce a
    // slice that compares equal, so `useMemo` keeps the previous reference.
    const before = song();
    const after = {
      ...song(),
      sections: before.sections.map((section) => ({ ...section, bars: 8 })),
    };
    const slice = polySongSlice(before);
    expect(sliceWouldChange(slice, polySongSlice(after))).toBe(false);
  });

  it("changes when the key, mode, tempo, title, concept, notes, bend or genre does", () => {
    const slice = polySongSlice(song());
    for (const patch of [
      { key: "D" },
      { scale: "dorian" },
      { bpm: 90 },
      { title: "Different" },
      { concept: "other" },
      { genre: "rock" },
      // `bend` is a style profile in this schema, not a drum knob bag.
      { bend: { energy: 0.7 } },
      { notes: "a note" },
    ] as Partial<BlueprintSong>[]) {
      expect(sliceWouldChange(slice, polySongSlice(song(patch)))).toBe(true);
    }
  });

  it("asks for a rebuild when there is no slice yet", () => {
    expect(sliceWouldChange(null, polySongSlice(song()))).toBe(true);
  });

  it("keeps nested values by reference, so their own identity still decides", () => {
    const bend = { energy: 0.5 };
    const slice = polySongSlice(song({ bend }));
    expect(slice.bend).toBe(bend);
  });
});
