import { describe, expect, it } from "vitest";
import type { BlueprintSong, Chord } from "../../types/blueprint";
import { moveChord, retypeChord } from "./chords";

const song = { key: "C", scale: "ionian" } as BlueprintSong;

function chord(
  id: string,
  root: string,
  quality: Chord["quality"],
  beats = 4,
): Chord {
  return { id, romanNumeral: "", root, quality, beats } as Chord;
}

const section = {
  chords: [chord("c1", "C", "maj"), chord("c2", "F", "maj")],
  beatsPerChord: 4,
  key: "C" as const,
  scale: "ionian" as const,
};

describe("retypeChord", () => {
  it("retypes a numeral into the chord it names", () => {
    const result = retypeChord(section, "c2", "vi", song);
    expect(result?.chord.root).toBe("A");
    expect(result?.chord.quality).toBe("min");
    expect(result?.chords[1].id).toBe("c2");
    expect(result?.chords[0]).toEqual(section.chords[0]);
  });

  it("takes a quality suffix", () => {
    const result = retypeChord(section, "c1", "V7", song);
    expect(result?.chord.root).toBe("G");
    expect(result?.chord.quality).toBe("7");
  });

  it("reads an accidental", () => {
    const result = retypeChord(section, "c1", "♭VII", song);
    expect(result?.chord.root).toBe("A#");
    expect(result?.chord.quality).toBe("maj");
  });

  it("keeps the id and the timing the chart already had", () => {
    const timed = { ...section, chords: [chord("c1", "C", "maj", 6)] };
    const result = retypeChord(timed, "c1", "IV", song);
    expect(result?.chords[0].id).toBe("c1");
    expect(result?.chords[0].beats).toBe(6);
  });

  it("drops a voicing that belonged to the old root", () => {
    const voiced = {
      ...section,
      chords: [
        { ...chord("c1", "C", "maj"), voicing: { inversion: 1 } } as Chord,
      ],
    };
    expect(
      retypeChord(voiced, "c1", "IV", song)?.chord.voicing,
    ).toBeUndefined();
    expect(retypeChord(voiced, "c1", "I", song)?.chord.voicing).toEqual({
      inversion: 1,
    });
  });

  it("refuses nonsense instead of writing it", () => {
    expect(retypeChord(section, "c1", "zzz", song)).toBeNull();
    expect(retypeChord(section, "c1", "   ", song)).toBeNull();
    expect(retypeChord(section, "nope", "I", song)).toBeNull();
  });
});

describe("moveChord", () => {
  const chords = [
    chord("a", "C", "maj"),
    chord("b", "A", "min"),
    chord("c", "F", "maj"),
    chord("d", "G", "maj"),
  ];

  it("moves a chord into another's slot", () => {
    expect(moveChord(chords, "a", "c")?.map((entry) => entry.id)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(moveChord(chords, "d", "a")?.map((entry) => entry.id)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("changes nothing when the slot is where it already is", () => {
    expect(moveChord(chords, "b", "b")).toBeNull();
    expect(moveChord(chords, "nope", "a")).toBeNull();
  });

  it("keeps every chord, just somewhere else", () => {
    const moved = moveChord(chords, "b", "d")!;
    expect(new Set(moved.map((entry) => entry.id)).size).toBe(4);
    expect(moved.map((entry) => entry.id).sort()).toEqual(["a", "b", "c", "d"]);
  });
});
