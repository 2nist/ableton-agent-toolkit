import { describe, it, expect } from "vitest";
import {
  generateMelody,
  mulberry32,
  type MelodyModel,
} from "../src/index.js";

// A tiny hand-built model mirroring the real corpus shape: over a major chord
// the melody mostly uses the chord tones (0, 4, 7), with a bias toward 5th/3rd.
const model: MelodyModel = {
  qualities: ["maj", "min"],
  melodyIntervals: {
    maj: [0, 0, 0, 0, 5, 0, 0, 5, 0, 0, 0, 0], // iv 0, 4, 7 evenly
    min: [0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 0], // iv 0, 3, 7
  },
  intervalTransitions: {
    "0": [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    "4": [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    "7": [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    "3": [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
  },
  registerMode: { maj: 15, min: 15 },
  totalChords: 4,
  totalMelody: 4,
  classified: 4,
};

describe("generateMelody", () => {
  it("produces one note per beat window, quantized to chord boundaries", () => {
    const { notes, totalBeats } = generateMelody(
      model,
      [
        { rootPc: 0, quality: "maj", durationBeats: 4 },
        { rootPc: 7, quality: "maj", durationBeats: 4 },
      ],
      { rng: mulberry32(42) },
    );
    expect(totalBeats).toBe(8);
    // a 4-beat chord with maxNoteBeats=4 => one note
    expect(notes).toHaveLength(2);
    expect(notes[0]!.startTime).toBe(0);
    expect(notes[0]!.duration).toBe(4);
    expect(notes[1]!.startTime).toBe(4);
    expect(notes[1]!.duration).toBe(4);
  });

  it("subdivides long chords so the melody keeps moving", () => {
    const { notes } = generateMelody(
      model,
      [{ rootPc: 0, quality: "maj", durationBeats: 16 }],
      { rng: mulberry32(7) },
    );
    // 16 beats / 4-beat max => 4 notes
    expect(notes).toHaveLength(4);
    expect(notes.map((n) => n.duration).every((d) => d === 4)).toBe(true);
    expect(notes.map((n) => n.startTime)).toEqual([0, 4, 8, 12]);
  });

  it("only plays chord tones relative to each chord root", () => {
    const chords = [
      { rootPc: 0, quality: "maj", durationBeats: 4 },
      { rootPc: 7, quality: "maj", durationBeats: 4 },
    ];
    const { notes } = generateMelody(model, chords, { rng: mulberry32(1) });
    for (let i = 0; i < notes.length; i++) {
      const chord = chords[i]!;
      const pc = ((notes[i]!.pitch % 12) + 12) % 12;
      const iv = ((pc - chord.rootPc) % 12 + 12) % 12;
      // in this model, maj melody only ever emits intervals {0,4,7}
      expect([0, 4, 7]).toContain(iv);
    }
  });

  it("keeps the melody in a singable register (48..96) even for low roots", () => {
    const { notes } = generateMelody(
      model,
      [
        { rootPc: 0, quality: "maj", durationBeats: 4 },
        { rootPc: 0, quality: "maj", durationBeats: 4 },
        { rootPc: 0, quality: "maj", durationBeats: 4 },
      ],
      { rng: mulberry32(99) },
    );
    expect(notes.length).toBe(3);
    for (const n of notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(48);
      expect(n.pitch).toBeLessThanOrEqual(96);
    }
  });

  it("returns a full-length clip even when quality is unknown (falls back to maj)", () => {
    const { notes, totalBeats } = generateMelody(
      model,
      [{ rootPc: 0, quality: "weird", durationBeats: 4 }],
      { rng: mulberry32(3) },
    );
    expect(totalBeats).toBe(4);
    expect(notes).toHaveLength(1);
  });

  it("contour bias keeps consecutive notes within a narrow window", () => {
    const chords = Array.from({ length: 8 }, (_, i) => ({
      rootPc: (i * 3) % 12,
      quality: "maj" as const,
      durationBeats: 2,
    }));
    const { notes } = generateMelody(model, chords, {
      rng: mulberry32(123),
      maxNoteBeats: 2,
      contourBias: 0.9,
    });
    for (let i = 1; i < notes.length; i++) {
      const d = Math.abs(notes[i]!.pitch - notes[i - 1]!.pitch);
      // tight contour: chord tones are pulled toward the previous note; a
      // max leap of a minor 6th is acceptable between chords a third apart
      expect(d).toBeLessThanOrEqual(7);
    }
  });
});

describe("mulberry32", () => {
  it("is deterministic for a fixed seed", () => {
    const a = Array.from({ length: 5 }, () => mulberry32(99)());
    const b = Array.from({ length: 5 }, () => mulberry32(99)());
    expect(a).toEqual(b);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
