import { beforeEach, describe, expect, it } from "vitest";
import { clearLibraryRunsCache, sectionRuns } from "./libraryIndex";
import { librarySignature, songSignature } from "./signature";
import type { BlueprintSong } from "../../types/blueprint";

function song(overrides: Partial<BlueprintSong> = {}): BlueprintSong {
  return {
    id: "s1",
    title: "Test Song",
    artist: "Artist",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [
      {
        id: "sec1",
        name: "Verse",
        role: "verse",
        bars: 4,
        chords: [{ id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 }],
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
      },
    ],
    arrangement: [],
    ...overrides,
  } as BlueprintSong;
}

beforeEach(() => {
  clearLibraryRunsCache();
});

describe("songSignature", () => {
  it("is stable for identical content", () => {
    expect(songSignature(song())).toBe(songSignature(song()));
  });

  it("changes when a chord changes", () => {
    const before = songSignature(song());
    const changed = song();
    changed.sections[0]!.chords[0]!.root = "D";
    expect(songSignature(changed)).not.toBe(before);
  });

  it("changes when a section is renamed", () => {
    const before = songSignature(song());
    const changed = song();
    changed.sections[0]!.name = "Chorus";
    expect(songSignature(changed)).not.toBe(before);
  });

  it("folds songs into one library signature", () => {
    const one = librarySignature([song()]);
    const two = librarySignature([song(), song({ id: "s2" })]);
    expect(two).not.toBe(one);
  });
});

describe("sectionRuns", () => {
  it("caches by content and invalidates when the song changes", () => {
    const first = sectionRuns(song());
    expect(sectionRuns(song())).toBe(first);
    expect(first[0]!.degrees).toEqual(["0:0"]);

    const changed = song();
    changed.sections[0]!.chords[0]!.root = "D";
    const next = sectionRuns(changed);
    expect(next).not.toBe(first);
    expect(next[0]!.degrees).toEqual(["1:0"]);
  });

  it("returns the section's derived numerals for display", () => {
    expect(sectionRuns(song())[0]!.romans).toEqual(["I"]);
  });
});
