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

  it("names a diminished eleventh without disturbing dim7", () => {
    // C dim11 = 0,3,6,9,14,17. Before the vocabulary held it, the ninth and
    // eleventh read as unexplained extras on top of a dim7.
    expect(recognizeChord([0, 3, 6, 9, 14, 17])).toMatchObject({ rootPc: 0, quality: "dim11" });
    // A plain dim7 must not be upgraded to a denser name it does not deserve.
    expect(recognizeChord([0, 3, 6, 9])).toMatchObject({ rootPc: 0, quality: "dim7" });
  });

  it("reads a diminished ninth as the dominant 7b9 it also is", () => {
    // C dim9 (0,3,6,9,14) and D 7b9 (2,6,9,0,3) are the same five pitch classes;
    // there is no way to tell them apart from the notes alone, so the more
    // common name wins. That is why `dim9` is not a quality — see the vocabulary
    // comment in packages/music-theory/src/chords.ts.
    expect(recognizeChord([0, 3, 6, 9, 14])).toMatchObject({ rootPc: 2, quality: "7b9" });
  });

  it("names an eleventh-inclusive major as maj11, not maj7 with an extra", () => {
    expect(recognizeChord([0, 4, 7, 11, 14, 17])).toMatchObject({ rootPc: 0, quality: "maj11" });
    // The practical major with a ninth is still maj9: no eleventh, no maj11.
    expect(recognizeChord([0, 4, 7, 11, 14])).toMatchObject({ rootPc: 0, quality: "maj9" });
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

describe("recognizeChord robustness", () => {
  it("names an extended quality the old candidate list could not reach", () => {
    // C E G Bb D A — a C13. The old list stopped at 7#11, so this shape could
    // only ever come back as "9" with an unexplained A.
    expect(recognizeChord([0, 4, 7, 10, 2, 9])).toMatchObject({ rootPc: 0, quality: "13" });
  });

  it("charges an omitted fifth far less than an omitted third", () => {
    // Root-3-7 vs root-5-7: the first is a normal maj7 voicing.
    const noFifth = recognizeChord([0, 4, 11]);
    const noThird = recognizeChord([0, 7, 11]);
    expect(noFifth).toMatchObject({ rootPc: 0, quality: "maj7" });
    expect(noFifth!.score).toBeGreaterThan(noThird!.score);
  });

  it("reports the inversion when the bass is a chord tone", () => {
    expect(recognizeChordFromNotes([52, 55, 60])).toMatchObject({ inversion: 1 });
    // Root position reports 0; callers treat absent-or-0 as "no inversion".
    expect(recognizeChordFromNotes([48, 52, 55])?.inversion).toBe(0);
  });

  it("stays on the previous chord when the frame alone is ambiguous", () => {
    // Root-3-7 with no fifth: readable as maj7; the prior raises its score.
    const plain = recognizeChord([0, 4, 11]);
    const primed = recognizeChord([0, 4, 11], {
      previous: { rootPc: 0, quality: "maj7" },
    });
    expect(primed!.score).toBeGreaterThan(plain!.score);
    expect(primed).toMatchObject({ rootPc: 0, quality: "maj7" });
  });

  it("still changes chord when the notes actually change", () => {
    const chord = recognizeChord([5, 9, 0], { previous: { rootPc: 0, quality: "maj7" } });
    expect(chord).toMatchObject({ rootPc: 5, quality: "maj" });
  });
});

describe("permitted vocabulary", () => {
  // The qualities the key offers, as the app derives them.
  const IONIAN = ["maj", "min", "dim", "maj7", "min7", "7", "m7b5"] as const;

  it("lets the caller's vocabulary steer an ambiguous shape", () => {
    // C E G A is both C6 and Am7. Whichever the context permits wins, and
    // both readings explain every note, so the vocabulary — not the sort
    // order — decides.
    expect(recognizeChord([0, 4, 7, 9], { permitted: ["6"] })).toMatchObject({
      rootPc: 0,
      quality: "6",
    });
    expect(recognizeChord([0, 4, 7, 9], { permitted: ["min7"] })).toMatchObject({
      rootPc: 9,
      quality: "min7",
    });
  });

  it("falls back to the full vocabulary when the key cannot explain the notes", () => {
    // Root-3-7 only: no ionian quality accounts for it without a stray note,
    // so recognition leaves the key and names the maj7 anyway.
    expect(recognizeChord([0, 4, 11], { permitted: [...IONIAN] })).toMatchObject({
      rootPc: 0,
      quality: "maj7",
    });
  });

  it("still names a borrowed chord the notes state outright", () => {
    // Ab major in C has no in-key reading that accounts for all three notes.
    const chord = recognizeChord([8, 0, 3], { permitted: [...IONIAN], keyName: "C", scale: "ionian" });
    expect(chord).toMatchObject({ rootPc: 8, quality: "maj" });
  });

  it("still names an extension the key does not list", () => {
    const chord = recognizeChord([0, 4, 7, 10, 2, 9], { permitted: [...IONIAN] });
    expect(chord).toMatchObject({ rootPc: 0, quality: "13" });
  });

  it("is a no-op when nothing is permitted", () => {
    const withList = recognizeChord([0, 4, 7], { permitted: [...IONIAN] });
    const without = recognizeChord([0, 4, 7]);
    expect(withList).toMatchObject({ rootPc: 0, quality: "maj" });
    expect(without).toMatchObject({ rootPc: 0, quality: "maj" });
  });
});
