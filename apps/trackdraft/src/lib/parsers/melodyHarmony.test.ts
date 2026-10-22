import { describe, expect, it } from "vitest";
import {
  diatonicCandidates,
  inferChordProgression,
  inferSectionsFromChords,
  inferredChordsToBlueprint,
  type MelodyNoteLike,
} from "./melodyHarmony";

/** An arpeggiated chord: one note per half beat, so the bar carries all three
 *  chord tones without ever sounding two at once (these corpora are monophonic). */
function arpeggio(bar: number, pitches: number[], beatsPerBar = 4): MelodyNoteLike[] {
  const step = beatsPerBar / pitches.length;
  return pitches.map((pitch, index) => ({
    pitch,
    startTime: bar * beatsPerBar + index * step,
    duration: step,
  }));
}

const C_MAJOR_BARS = {
  0: [60, 64, 67], // C  I
  3: [65, 69, 72], // F  IV
  4: [67, 71, 74], // G  V
};

describe("diatonicCandidates", () => {
  it("builds the seven triads plus a dominant seventh", () => {
    const candidates = diatonicCandidates("ionian");
    expect(candidates).toHaveLength(8);
    expect(candidates.slice(0, 7).map((c) => c.quality)).toEqual([
      "maj", "min", "min", "maj", "maj", "min", "dim",
    ]);
    expect(candidates[7].romanNumeral).toBe("V7");
  });

  it("gives each mode its own qualities", () => {
    // Dorian's IV is major and its i is minor — the reason the qualities are
    // derived from the scale rather than hard-coded by degree.
    expect(diatonicCandidates("dorian")[3].quality).toBe("maj");
    expect(diatonicCandidates("dorian")[0].quality).toBe("min");
    // Locrian's tonic triad is diminished.
    expect(diatonicCandidates("locrian")[0].quality).toBe("dim");
  });

  it("places roots in semitones above the tonic", () => {
    expect(diatonicCandidates("ionian").map((c) => c.rootOffset)).toEqual([0, 2, 4, 5, 7, 9, 11, 7]);
  });
});

describe("inferChordProgression", () => {
  const options = { keyName: "C" as const, scale: "ionian" as const, beatsPerBar: 4, totalBeats: 16 };

  it("recovers I–IV–V–I from arpeggios of those chords", () => {
    const melody = [
      ...arpeggio(0, C_MAJOR_BARS[0]),
      ...arpeggio(1, C_MAJOR_BARS[3]),
      ...arpeggio(2, C_MAJOR_BARS[4]),
      ...arpeggio(3, C_MAJOR_BARS[0]),
    ];
    const chords = inferChordProgression(melody, options);
    expect(chords.map((c) => c.degree)).toEqual([0, 3, 4, 0]);
  });

  it("merges a chord held across bars into one span", () => {
    const melody = [...arpeggio(0, C_MAJOR_BARS[0]), ...arpeggio(1, C_MAJOR_BARS[0])];
    const chords = inferChordProgression(melody, { ...options, totalBeats: 8 });
    expect(chords).toHaveLength(1);
    expect(chords[0].beats).toBe(8);
  });

  it("names the chord and gives it an absolute root", () => {
    const chords = inferChordProgression(arpeggio(0, C_MAJOR_BARS[0]), { ...options, totalBeats: 4 });
    expect(chords[0].romanNumeral).toBe("I");
    const [blueprint] = inferredChordsToBlueprint(chords, "C", "ionian");
    expect(blueprint).toMatchObject({ romanNumeral: "I", root: "C", quality: "maj" });
  });

  it("works in a mode, not just major", () => {
    // D dorian, with the IV (G major) and i (D minor) that make it dorian.
    const melody = [
      ...arpeggio(0, [62, 65, 69]), // D  i
      ...arpeggio(1, [67, 71, 74]), // G  IV
      ...arpeggio(2, [62, 65, 69]), // D  i
      ...arpeggio(3, [60, 64, 67]), // C  VII
    ];
    const chords = inferChordProgression(melody, {
      keyName: "D", scale: "dorian", beatsPerBar: 4, totalBeats: 16,
    });
    expect(chords[0].degree).toBe(0);
    expect(chords.map((c) => c.degree)).toContain(3);
  });

  it("returns nothing for a melody that has no notes or no span", () => {
    expect(inferChordProgression([], options)).toEqual([]);
    expect(inferChordProgression(arpeggio(0, [60]), { ...options, totalBeats: 0 })).toEqual([]);
  });

  it("keeps the chord grid aligned to the window, not the note positions", () => {
    const chords = inferChordProgression(arpeggio(0, [60, 64, 67]), {
      ...options, totalBeats: 8, windowBeats: 2,
    });
    expect(chords.every((c) => c.beat % 2 === 0)).toBe(true);
  });
});

describe("inferSectionsFromChords", () => {
  const loop = (bars: number, degrees: number[]) =>
    Array.from({ length: bars }, (_, bar) => ({
      degree: degrees[bar % degrees.length],
      romanNumeral: "I",
      quality: "maj" as const,
      beat: bar * 4,
      beats: 4,
      score: 0,
    }));

  it("merges an unbroken loop into one section", () => {
    // Four identical 8-bar blocks are the same material all the way through,
    // so they are one 32-bar section — not four.
    const inferred = loop(32, [0, 3, 4, 0]);
    const sections = inferSectionsFromChords(inferred, { beatsPerBar: 4, bars: 32 });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ label: "A", startBar: 0, bars: 32 });
  });

  it("labels a returning section with the label it returns to", () => {
    // A B A B across 4-bar blocks: the returning blocks share a label, so the
    // song reads as two sections alternating rather than four unrelated ones.
    const a = loop(4, [0, 3, 4, 0]);
    const b = loop(4, [5, 1, 4, 5]);
    const shifted = (blocks: typeof a, offset: number) =>
      blocks.map((c, i) => ({ ...c, beat: (i + offset) * 4 }));
    // A B C A B C — three distinct 4-bar blocks, then the same three again.
    // (A B A B would be periodic every 8 bars and collapse into one section,
    // which is the correct answer for it.)
    const c = loop(4, [1, 4, 0, 5]);
    const sections = inferSectionsFromChords(
      [...shifted(a, 0), ...shifted(b, 4), ...shifted(c, 8), ...shifted(a, 12), ...shifted(b, 16), ...shifted(c, 20)],
      { beatsPerBar: 4, bars: 24 },
    );
    expect(sections.map((s) => s.label)).toEqual(["A", "B", "C", "A", "B", "C"]);
    expect(sections.map((s) => s.startBar)).toEqual([0, 4, 8, 12, 16, 20]);
  });

  it("splits when the material genuinely changes", () => {
    const first = loop(8, [0, 3, 4, 0]);
    const second = loop(8, [5, 1, 4, 5]).map((c, i) => ({ ...c, beat: (i + 8) * 4 }));
    const sections = inferSectionsFromChords([...first, ...second], { beatsPerBar: 4, bars: 16 });
    expect(sections.map((s) => s.label)).toEqual(["A", "B"]);
  });

  it("reports nothing when nothing repeats", () => {
    // Eight different bars of harmony cannot repeat.
    const inferred = Array.from({ length: 8 }, (_, bar) => ({
      degree: bar % 7,
      romanNumeral: "I",
      quality: "maj" as const,
      beat: bar * 4,
      beats: 4,
      score: 0,
    }));
    expect(inferSectionsFromChords(inferred, { beatsPerBar: 4, bars: 8 })).toEqual([]);
  });

  it("needs enough song to segment", () => {
    expect(inferSectionsFromChords(loop(4, [0, 3]), { beatsPerBar: 4, bars: 4 })).toEqual([]);
    expect(inferSectionsFromChords([], { beatsPerBar: 4, bars: 32 })).toEqual([]);
  });
});
