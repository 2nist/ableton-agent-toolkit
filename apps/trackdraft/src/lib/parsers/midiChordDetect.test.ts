import { describe, expect, it } from "vitest";
import { detectMidiChords, parserNotesToTimed } from "./midiChordDetect";

/** Four notes sounding together for the whole first beat, then silence. */
function blockChord(pitches: number[], beats = 4) {
  return pitches.map((pitch) => ({ pitch, startBeat: 0, endBeat: beats }));
}

describe("detectMidiChords", () => {
  it("keeps a maj7 in the imported progression instead of flattening it to a triad", () => {
    // C E G B — the recognizer must be able to NAME maj7 at all; the previous
    // 10-quality candidate list made that structurally impossible.
    const chords = detectMidiChords(blockChord([60, 64, 67, 71]), 0, 4, 4, "C");
    expect(chords[0]).toMatchObject({ root: "C", quality: "maj7" });
  });

  it("keeps a min7 and a half-diminished seventh", () => {
    expect(detectMidiChords(blockChord([60, 63, 67, 70]), 0, 4, 4, "C")[0]).toMatchObject({
      root: "C",
      quality: "min7",
    });
    expect(detectMidiChords(blockChord([59, 62, 65, 69]), 0, 4, 4, "C")[0]).toMatchObject({
      root: "B",
      quality: "m7b5",
    });
  });

  it("names a maj7 whose fifth was not played", () => {
    // Root, third and seventh only — a pianist's normal voicing.
    const chords = detectMidiChords(blockChord([60, 64, 71]), 0, 4, 4, "C");
    expect(chords[0]).toMatchObject({ root: "C", quality: "maj7" });
  });

  it("reads the bass as an inversion", () => {
    const chords = detectMidiChords(blockChord([52, 55, 60]), 0, 4, 4, "C");
    expect(chords[0]).toMatchObject({ root: "C", quality: "maj" });
    expect(chords[0].voicing).toEqual({ inversion: 1 });
  });

  it("writes a Roman numeral, not a note name", () => {
    const chords = detectMidiChords(blockChord([55, 59, 62]), 0, 4, 4, "C");
    expect(chords[0].root).toBe("G");
    expect(chords[0].romanNumeral).toBe("V");
    expect(chords[0].romanNumeral).not.toBe("G");
  });

  it("numbers chords against the imported mode, not the major scale", () => {
    // C minor: Cm is i, not I.
    const chords = detectMidiChords(blockChord([60, 63, 67]), 0, 4, 4, "C", { scale: "aeolian" });
    expect(chords[0].root).toBe("C");
    expect(chords[0].romanNumeral).toBe("i");
  });

  it("does not invent a chord from a single held note", () => {
    expect(detectMidiChords(blockChord([60]), 0, 4, 4, "C")).toEqual([]);
  });

  it("merges consecutive identical chords into one longer chord", () => {
    const chords = detectMidiChords(blockChord([60, 64, 67], 4), 0, 4, 4, "C");
    expect(chords).toHaveLength(1);
    expect(chords[0].beats).toBe(4);
  });

  it("does not flicker when a colour tone enters mid-chord", () => {
    // C E G sustains for the section; B joins on beat 2. Reading the second
    // half as Cmaj7 is correct; reading it as a different root is not.
    const notes = [
      { pitch: 60, startBeat: 0, endBeat: 4 },
      { pitch: 64, startBeat: 0, endBeat: 4 },
      { pitch: 67, startBeat: 0, endBeat: 4 },
      { pitch: 71, startBeat: 2, endBeat: 4 },
    ];
    const chords = detectMidiChords(notes, 0, 4, 4, "C");
    expect(chords.every((c) => c.root === "C")).toBe(true);
  });
});

describe("parserNotesToTimed", () => {
  it("converts ticks to section-relative beats", () => {
    expect(parserNotesToTimed([{ note: 60, startTick: 480, endTick: 960 }], 480, 480)).toEqual([
      { pitch: 60, startBeat: 0, endBeat: 1 },
    ]);
  });

  it("returns nothing for an unusable tick resolution", () => {
    expect(parserNotesToTimed([{ note: 60, startTick: 0, endTick: 480 }], 0, 0)).toEqual([]);
  });
});
