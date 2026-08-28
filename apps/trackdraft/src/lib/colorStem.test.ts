import { describe, expect, it } from "vitest";
import { planColorStem, DEFAULT_COLOR_OCTAVE } from "./colorStem";
import { sectionSpans } from "./arrangement";
import { createEmptySong, type BlueprintSong, type Chord } from "../types/blueprint";

function testSong(colorOctave?: number): BlueprintSong {
  const song = createEmptySong("Color Test");
  song.bpm = 120;
  song.key = "C";
  song.scale = "ionian";
  song.timeSignatureNumerator = 4;
  song.timeSignatureDenominator = 4;
  const chords: Chord[] = [
    { id: "c1", romanNumeral: "I", root: "C", quality: "maj7", beats: 4 },
    { id: "c2", romanNumeral: "vi", root: "A", quality: "min7", beats: 4 },
  ];
  song.sections = [
    {
      id: "s1",
      name: "Verse",
      role: "verse",
      bars: 2,
      chords,
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
      colorFlavor: "cinematic_shimmer",
      ...(colorOctave !== undefined ? { colorOctave } : {}),
    },
  ];
  song.arrangement = [{ sectionId: "s1", repeats: 1 }];
  return song;
}

describe("planColorStem register", () => {
  it("defaults the color voice to the engine's two-octaves-above register", () => {
    expect(DEFAULT_COLOR_OCTAVE).toBe(6);
    const notes = planColorStem(sectionSpans(testSong()));
    expect(notes.length).toBeGreaterThan(0);
    // Anchor is octave 4; default color octave 6. Every color pitch should
    // sit well above the anchor (>= octave 6, i.e. pitch >= 72).
    expect(notes.every((n) => n.pitch >= 72)).toBe(true);
  });

  it("honors a per-section colorOctave override (transposes the whole layer)", () => {
    const low = planColorStem(sectionSpans(testSong(5)));
    const high = planColorStem(sectionSpans(testSong(7)));
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBe(low.length);
    // A two-octave jump on the register shifts every note by 24 semitones
    // (same chord/flavor on both — only the register differs).
    high.forEach((n, i) => {
      expect(n.pitch).toBe(low[i].pitch + 24);
    });
  });

  it("sustains color notes for the full chord duration (extended, not 1-beat stabs)", () => {
    const notes = planColorStem(sectionSpans(testSong()));
    expect(notes.length).toBeGreaterThan(0);
    // The test song's chords are 4 beats each; the color voice should ring
    // for the whole chord, not a 1-beat transient.
    expect(notes.every((n) => n.duration === 4)).toBe(true);
  });
});
