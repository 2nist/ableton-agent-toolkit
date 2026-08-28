import { describe, it, expect } from "vitest";
import { quantizeMelody, fitMelodyToScale, adjustMelody, type QuantizeGrid } from "./quantize";
import type { MelodyNote } from "../../types/blueprint";

function note(partial: Partial<MelodyNote> & { pitch: number; startTime: number; duration: number }): MelodyNote {
  return { velocity: 96, ...partial };
}

describe("quantizeMelody", () => {
  it("rounds onsets to the 8th-note grid (0.5 beats)", () => {
    const notes = [note({ pitch: 60, startTime: 1.1, duration: 0.7 })];
    const out = quantizeMelody(notes, "1/8");
    expect(out[0].startTime).toBe(1); // 1.1 → 1
    expect(out[0].duration).toBe(1); // end 1.8 → 2, length 1
  });

  it("rounds to the 16th grid (0.25 beats) and preserves a note that lands exactly on grid", () => {
    const notes = [note({ pitch: 62, startTime: 0.25, duration: 0.5 })];
    const out = quantizeMelody(notes, "1/16");
    expect(out[0].startTime).toBe(0.25);
    expect(out[0].duration).toBe(0.5);
  });

  it("floors a note that rounds to nothing to one grid cell", () => {
    // start 1.01 → 1; end 1.01+0.02=1.03 → 1; must not become a 0-length note.
    const notes = [note({ pitch: 64, startTime: 1.01, duration: 0.02 })];
    const out = quantizeMelody(notes, "1/8");
    expect(out[0].startTime).toBe(1);
    expect(out[0].duration).toBe(0.5);
  });

  it("leaves timing untouched on 'none' but still copies", () => {
    const notes = [note({ pitch: 60, startTime: 1.37, duration: 0.41 })];
    const out = quantizeMelody(notes, "none");
    expect(out[0]).not.toBe(notes[0]);
    expect(out[0].startTime).toBe(1.37);
    expect(out[0].duration).toBe(0.41);
  });
});

describe("fitMelodyToScale", () => {
  it("snaps an off-scale C# to C in C major", () => {
    const notes = [note({ pitch: 61, startTime: 0, duration: 1 })]; // C#
    const out = fitMelodyToScale(notes, "C", "ionian");
    expect(out[0].pitch).toBe(60); // C
  });

  it("keeps in-scale pitches untouched", () => {
    const notes = [note({ pitch: 64, startTime: 0, duration: 1 })]; // E
    const out = fitMelodyToScale(notes, "C", "ionian");
    expect(out[0].pitch).toBe(64);
  });

  it("snaps an exact-tie pitch DOWN (F# → F in C major, not G)", () => {
    // F# is 1 below G and 1 above F — a tie, and the tie-break is down.
    const notes = [note({ pitch: 66, startTime: 0, duration: 1 })];
    const out = fitMelodyToScale(notes, "C", "ionian");
    expect(out[0].pitch).toBe(65); // F
  });

  it("stays in the note's register — doesn't jump an octave", () => {
    // B (pitch 71) is in C major; C# (73) should snap down to C (72), not up an octave.
    const notes = [note({ pitch: 73, startTime: 0, duration: 1 })];
    const out = fitMelodyToScale(notes, "C", "ionian");
    expect(out[0].pitch).toBe(72);
  });

  it("respects the key root (E natural in D major, not E♭)", () => {
    const notes = [note({ pitch: 64, startTime: 0, duration: 1 })]; // E
    const out = fitMelodyToScale(notes, "D", "ionian"); // D major = D E F# G A B C#
    expect(out[0].pitch).toBe(64); // E is in the scale
  });
});

describe("adjustMelody", () => {
  it("runs quantize then fit-to-scale in sequence", () => {
    const raw = [note({ pitch: 61, startTime: 1.1, duration: 0.7 })]; // C# off-grid
    const out = adjustMelody(raw, { quantize: "1/8", fitToScale: true, key: "C", scale: "ionian" });
    expect(out[0].startTime).toBe(1); // quantized
    expect(out[0].pitch).toBe(60); // fitted to C
  });

  it("skips fit-to-scale when disabled", () => {
    const raw = [note({ pitch: 61, startTime: 1.1, duration: 0.7 })];
    const out = adjustMelody(raw, { quantize: "1/8", fitToScale: false, key: "C", scale: "ionian" });
    expect(out[0].pitch).toBe(61);
    expect(out[0].startTime).toBe(1);
  });

  it("accepts the empty list", () => {
    expect(adjustMelody([], { quantize: "1/8", fitToScale: true, key: "C", scale: "ionian" })).toEqual([]);
  });

  it("exhaustive grid smoke — every named grid runs without throwing", () => {
    const raw = [note({ pitch: 62, startTime: 2.3, duration: 1.1 })];
    const grids: QuantizeGrid[] = ["none", "1/16", "1/8", "1/8T", "1/4"];
    for (const g of grids) {
      expect(adjustMelody(raw, { quantize: g, fitToScale: false, key: "A", scale: "aeolian" }).length).toBe(1);
    }
  });
});
