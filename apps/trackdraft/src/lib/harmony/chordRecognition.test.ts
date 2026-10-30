import { describe, expect, it } from "vitest";
import {
  recognizeChord,
  recognizeChordFromNotes,
  recognizedChordName,
} from "./chordRecognition";

describe("recognizeChord", () => {
  it("names a plain major triad", () => {
    const chord = recognizeChord([0, 4, 7]);
    expect(chord).toMatchObject({ rootPc: 0, quality: "maj", score: 1 });
  });

  it("names a minor triad from its own root when the bass says so", () => {
    // A–C–E is both Am and a rootless-looking C6; the lowest note decides.
    expect(recognizeChordFromNotes([57, 60, 64])).toMatchObject({ rootPc: 9, quality: "min" });
  });

  it("reads an inversion as the chord, not the bass note's chord", () => {
    // C major first inversion: E3 G3 C4.
    expect(recognizeChordFromNotes([52, 55, 60])).toMatchObject({ rootPc: 0, quality: "maj" });
  });

  it("distinguishes sevenths from triads", () => {
    expect(recognizeChord([0, 4, 7, 10])).toMatchObject({ rootPc: 0, quality: "7" });
    expect(recognizeChord([0, 4, 7, 11])).toMatchObject({ rootPc: 0, quality: "maj7" });
    expect(recognizeChord([0, 3, 7, 10])).toMatchObject({ rootPc: 0, quality: "min7" });
  });

  it("calls a root-and-fifth a power chord rather than a half-played triad", () => {
    expect(recognizeChord([0, 7])).toMatchObject({ rootPc: 0, quality: "5" });
  });

  it("prefers the simpler spelling of identical pitch classes", () => {
    // C6 and Am7 are the same four pitch classes; with C in the bass it is C6.
    expect(recognizeChordFromNotes([48, 52, 55, 57])).toMatchObject({ rootPc: 0, quality: "6" });
  });

  it("uses the key as a tie-breaker rather than a straitjacket", () => {
    const chord = recognizeChord([0, 4, 7], { keyName: "C", scale: "ionian" });
    expect(chord?.quality).toBe("maj");
    // A borrowed bVI in C is still named, not rejected.
    expect(recognizeChord([8, 0, 3], { keyName: "C", scale: "ionian" })).toMatchObject({
      rootPc: 8,
      quality: "maj",
    });
  });

  it("returns null for silence and for a single note", () => {
    expect(recognizeChord([])).toBeNull();
    expect(recognizeChord([0])).toBeNull();
    expect(recognizeChordFromNotes([60])).toBeNull();
  });

  it("names the chord the way the harmony UI spells it", () => {
    const chord = recognizeChord([10, 2, 5])!;
    expect(chord).toMatchObject({ rootPc: 10, quality: "maj" });
    expect(recognizedChordName(chord, "Bb")).toBe("Bb");
  });
});
