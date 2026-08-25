import { describe, expect, it } from "vitest";
import { mulberry32, type MelodyModel } from "@platform/progression-engine";
import {
  mergeChordsAndMelody,
  renderBiTonalColorResult,
  renderBiTonalResult,
  renderMelodyResult,
  renderStudioResult,
} from "../src/render-progression.js";

// Tiny model mirroring the real corpus: maj melody uses chord tones {0,4,7}.
const melodyModel: MelodyModel = {
  qualities: ["maj", "min"],
  melodyIntervals: {
    maj: [0, 0, 0, 0, 5, 0, 0, 5, 0, 0, 0, 0],
    min: [0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 0],
  },
  intervalTransitions: {
    "0": [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    "4": [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    "7": [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
  },
  registerMode: { maj: 15, min: 15 },
  totalChords: 2,
  totalMelody: 2,
  classified: 2,
};

describe("renderStudioResult", () => {
  it("renders a block-chord clip in the chosen key and octave with a chord-name label", () => {
    const { notes, totalBeats, name } = renderStudioResult({
      key: "C",
      octave: 5,
      chords: [
        { degree: "I", quality: "maj", durationBeats: 4 },
        { degree: "V", quality: "maj", durationBeats: 4 },
      ],
    });
    // C major at octave 5 (= MIDI 60 base) then G major starting beat 4
    expect(notes.map((n) => n.pitch).sort()).toEqual([60, 64, 67, 67, 71, 74]);
    expect(notes.map((n) => n.startTime).sort()).toEqual([0, 0, 0, 4, 4, 4]);
    expect(totalBeats).toBe(8);
    expect(name).toBe("C - G");
  });

  it("honors edited quality (I as minor) in the label", () => {
    const { notes, name } = renderStudioResult({
      key: "C",
      octave: 5,
      chords: [{ degree: "I", quality: "min", durationBeats: 2 }],
    });
    expect(notes.map((n) => n.pitch).sort()).toEqual([60, 63, 67]);
    expect(name).toBe("Cm");
  });

  it("labels a flat-key chord correctly (V in F is C major)", () => {
    const { notes, name } = renderStudioResult({
      key: "F",
      octave: 5,
      chords: [{ degree: "V", quality: "maj", durationBeats: 4 }],
    });
    expect(notes.map((n) => n.pitch).sort()).toEqual([60, 64, 67]);
    expect(name).toBe("C");
  });

  it("returns an empty clip for no chords", () => {
    const { notes, totalBeats, name } = renderStudioResult({ key: "C", octave: 5, chords: [] });
    expect(notes).toEqual([]);
    expect(totalBeats).toBe(0);
    expect(name).toBe("");
  });
});

describe("renderMelodyResult", () => {
  const result = {
    key: "C" as const,
    octave: 5,
    chords: [
      { degree: "I" as const, quality: "maj" as const, durationBeats: 4 },
      { degree: "V" as const, quality: "maj" as const, durationBeats: 4 },
    ],
  };

  it("renders a monophonic melody quantized to chord boundaries", () => {
    const { notes, totalBeats, name } = renderMelodyResult(result, melodyModel, {
      rng: mulberry32(42),
    });
    expect(totalBeats).toBe(8);
    expect(name).toBe("Melody · C - G");
    // one note per chord at maxNoteBeats=4
    expect(notes).toHaveLength(2);
    expect(notes[0]!.startTime).toBe(0);
    expect(notes[1]!.startTime).toBe(4);
  });

  it("honors a denser maxNoteBeats (melody subdivides long chords)", () => {
    const { notes } = renderMelodyResult(
      { ...result, maxNoteBeats: 2 },
      melodyModel,
      { rng: mulberry32(7) },
    );
    // 8 beats total / 2-beat max => 4 notes
    expect(notes).toHaveLength(4);
  });

  it("only uses chord tones of each chord root", () => {
    const { notes } = renderMelodyResult(result, melodyModel, { rng: mulberry32(1) });
    for (let i = 0; i < notes.length; i++) {
      const rootPc = i === 0 ? 0 : 7;
      const pc = ((notes[i]!.pitch % 12) + 12) % 12;
      const iv = ((pc - rootPc) % 12 + 12) % 12;
      expect([0, 4, 7]).toContain(iv);
    }
  });
});

describe("mergeChordsAndMelody", () => {
  it("combines chord + melody notes into one list and labels it", () => {
    const chords = renderStudioResult({ key: "C", octave: 5, chords: [{ degree: "I", quality: "maj", durationBeats: 4 }] });
    const melody = renderMelodyResult({ key: "C", octave: 5, chords: [{ degree: "I", quality: "maj", durationBeats: 4 }] }, melodyModel, { rng: mulberry32(1) });
    const merged = mergeChordsAndMelody(chords, melody);
    expect(merged.notes.length).toBe(3 + 1); // triad + one melody note
    expect(merged.totalBeats).toBe(4);
    expect(merged.name).toBe("C + melody");
    // melody note sits above the chord notes
    const chordPitches = merged.notes.slice(0, 3).map((n) => n.pitch);
    const melodyPitch = merged.notes[3]!.pitch;
    expect(melodyPitch).toBeGreaterThan(Math.max(...chordPitches));
  });
});

describe("renderBiTonalResult", () => {
  const result = {
    key: "C" as const,
    octave: 4,
    chords: [
      { degree: "I" as const, quality: "maj" as const, durationBeats: 4 },
      { degree: "V" as const, quality: "7" as const, durationBeats: 4 },
    ],
  };

  it("merges anchor + color voices into one clip with a flavor label", () => {
    const { notes, totalBeats, name } = renderBiTonalResult(result, "sci_fi_wonder");
    expect(totalBeats).toBe(8);
    expect(name).toBe("C - G7 · sci fi wonder");
    // C maj anchor(3) + D maj color(3) + G7 anchor(4) + G7 color(4, fallback)
    expect(notes.length).toBe(14);
  });

  it("keeps the color layer above the anchor in the merged list", () => {
    const { notes } = renderBiTonalResult(result, "sci_fi_wonder");
    // anchor at octave 4 (48..65 max for G7), color at octave 6 (72+)
    const anchor = notes.filter((n) => n.pitch < 72);
    const color = notes.filter((n) => n.pitch >= 72);
    expect(anchor.length).toBe(7); // C maj + G7
    expect(color.length).toBe(7); // D maj + G7 color
  });
});

describe("renderBiTonalColorResult", () => {
  const result = {
    key: "C" as const,
    octave: 4,
    chords: [
      { degree: "I" as const, quality: "maj" as const, durationBeats: 4 },
      { degree: "V" as const, quality: "maj" as const, durationBeats: 4 },
    ],
  };

  it("returns only the color (Instrument B) layer, labeled as Color", () => {
    const { notes, totalBeats, name } = renderBiTonalColorResult(result, "sci_fi_wonder");
    expect(totalBeats).toBe(8);
    expect(name).toBe("Color · C - G · sci fi wonder");
    // D maj + A maj color triads only (no anchor notes)
    expect(notes.length).toBe(6);
    // color sits in the upper register (well above the octave-4 anchor);
    // voice leading may dip one chord down an octave, but never into anchor range
    expect(Math.min(...notes.map((n) => n.pitch))).toBeGreaterThanOrEqual(60);
    expect(Math.max(...notes.map((n) => n.pitch))).toBeLessThanOrEqual(96);
  });
});
