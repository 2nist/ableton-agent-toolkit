import { describe, expect, it } from "vitest";
import { createEmptySong, type BlueprintSection, type BlueprintSong } from "../../types/blueprint";
import {
  canAutoFill,
  generateSectionMelody,
  melodyParamsDiffer,
  melodyParamsFromProfile,
  melodySeedFor,
} from "./autoFill";
import { resolveStyleProfile } from "@drum/library";

function makeSong(): { song: BlueprintSong; section: BlueprintSection } {
  const section: BlueprintSection = {
    id: "verse-1",
    name: "Verse 1",
    role: "verse",
    bars: 2,
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    chords: [
      { id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
      { id: "c2", romanNumeral: "vi", root: "A", quality: "min", beats: 4 },
    ],
  };
  const base = createEmptySong("Auto Fill");
  const song: BlueprintSong = {
    ...base,
    sections: [section],
    arrangement: [{ sectionId: section.id, repeats: 1 }],
  };
  return { song, section };
}

describe("generateSectionMelody", () => {
  it("refuses sections with no chords", () => {
    const { song, section } = makeSong();
    const empty = { ...section, chords: [] };
    expect(canAutoFill(empty)).toBe(false);
    expect(generateSectionMelody({ section: empty, song, seed: 1 })).toBeNull();
  });

  it("is deterministic for a given seed and bend", () => {
    const { song, section } = makeSong();
    const a = generateSectionMelody({ section, song, seed: 42 });
    const b = generateSectionMelody({ section, song, seed: 42 });
    expect(a?.notes).toEqual(b?.notes);
    expect(a?.source).toBe("generated");
    expect(a?.seed).toBe(42);
    expect(a?.contourApplied).toBe(true);
  });

  it("produces different lines for different seeds", () => {
    const { song, section } = makeSong();
    const a = generateSectionMelody({ section, song, seed: 1 });
    const b = generateSectionMelody({ section, song, seed: 2 });
    expect(a?.notes).not.toEqual(b?.notes);
  });

  it("maps the density axis to notes per chord", () => {
    const { song, section } = makeSong();
    const sparse = generateSectionMelody({
      section: { ...section, bend: { melodyDensity: 0.05 } },
      song,
      seed: 7,
    });
    const busy = generateSectionMelody({
      section: { ...section, bend: { melodyDensity: 0.95 } },
      song,
      seed: 7,
    });
    expect(busy!.notes.length).toBeGreaterThan(sparse!.notes.length);
  });

  it("maps the register axis to pitch", () => {
    const { song, section } = makeSong();
    const low = generateSectionMelody({
      section: { ...section, bend: { melodyRegister: 0 } },
      song,
      seed: 11,
    });
    const high = generateSectionMelody({
      section: { ...section, bend: { melodyRegister: 1 } },
      song,
      seed: 11,
    });
    const avg = (notes: { pitch: number }[]) =>
      notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length;
    expect(avg(high!.notes)).toBeGreaterThan(avg(low!.notes) + 12);
  });

  it("keeps every note inside the singable window and on the section", () => {
    const { song, section } = makeSong();
    const track = generateSectionMelody({ section, song, seed: 3 })!;
    for (const note of track.notes) {
      expect(note.pitch).toBeGreaterThanOrEqual(36);
      expect(note.pitch).toBeLessThanOrEqual(96);
      expect(note.startTime).toBeGreaterThanOrEqual(0);
      expect(note.startTime).toBeLessThan(8);
      expect(note.duration).toBeGreaterThan(0);
    }
  });

  it("stores the bend values it was generated with", () => {
    const { song, section } = makeSong();
    const bent = { ...section, bend: { melodyDensity: 0.8, melodyRegister: 0.2 } };
    const track = generateSectionMelody({ section: bent, song, seed: 9 })!;
    expect(track.params?.density).toBeCloseTo(0.8, 5);
    expect(track.params?.register).toBeCloseTo(0.2, 5);
  });
});

describe("melody params helpers", () => {
  it("reads neutral defaults from an unbent profile", () => {
    const { song, section } = makeSong();
    const params = melodyParamsFromProfile(resolveStyleProfile(section, song));
    expect(params).toEqual({
      contour: 0.5,
      density: 0.5,
      register: 0.5,
      rhythm: 0.5,
      repetition: 0.5,
      rest: 0.5,
    });
  });

  it("detects a bend change beyond tolerance", () => {
    const { song, section } = makeSong();
    const before = melodyParamsFromProfile(resolveStyleProfile(section, song));
    const after = melodyParamsFromProfile(
      resolveStyleProfile({ ...section, bend: { melodyDensity: 0.7 } }, song),
    );
    expect(melodyParamsDiffer(before, after)).toBe(true);
    expect(melodyParamsDiffer(before, { ...after, density: before.density })).toBe(false);
  });

  it("derives a stable, non-zero seed per section", () => {
    expect(melodySeedFor("verse-1")).toBe(melodySeedFor("verse-1"));
    expect(melodySeedFor("verse-1")).toBeGreaterThan(0);
    expect(melodySeedFor("verse-1")).not.toBe(melodySeedFor("chorus-1"));
  });
});
