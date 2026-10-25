import { describe, expect, it } from "vitest";
import type { Chord } from "../../types/blueprint";
import {
  analyzeSection,
  eventLabel,
  rootForDegree,
  rootForStep,
  scaleStepSemitones,
  semitoneForDegree,
  transposeForDisplay,
} from "./analysis";
import { spellingReadings } from "../../components/harmony/workspace/floorLabel";

let seq = 0;
function chord(root: Chord["root"], quality: Chord["quality"], beats = 4, extra: Partial<Chord> = {}): Chord {
  seq += 1;
  return { id: `c${seq}`, root, quality, beats, romanNumeral: "", ...extra };
}

function romans(chords: Chord[], key = "F", scale: "ionian" | "aeolian" = "ionian") {
  return analyzeSection(chords, { key, scale }).events.map((event) => event.roman);
}

describe("analyzeSection — derived numerals", () => {
  it("derives the diatonic numerals of a I–V–vi–IV cycle", () => {
    expect(romans([chord("F", "maj"), chord("C", "maj"), chord("D", "min"), chord("Bb", "maj")])).toEqual([
      "I",
      "V",
      "vi",
      "IV",
    ]);
  });

  it("reads a borrowed iv as lowercase and flags it", () => {
    const analysis = analyzeSection([chord("F", "maj"), chord("Bb", "min")], { key: "F", scale: "ionian" });
    expect(analysis.events[1].roman).toBe("iv");
    expect(analysis.events[1].borrowed).toBe(true);
    // a borrowed chord gets no guessed function
    expect(analysis.events[1].function).toBeNull();
  });

  it("does not call the key's own V→I an applied dominant", () => {
    const analysis = analyzeSection([chord("C", "7"), chord("F", "maj")], { key: "F", scale: "ionian" });
    expect(analysis.events[0].roman).toBe("V7");
    expect(analysis.events[0].appliedTo).toBeNull();
    expect(analysis.events[0].function).toBe("D");
  });

  it("names a secondary dominant V7/V and suppresses its borrowed flag", () => {
    const analysis = analyzeSection([chord("G", "7"), chord("C", "7")], { key: "F", scale: "ionian" });
    expect(analysis.events[0].roman).toBe("V7/V");
    expect(analysis.events[0].appliedTo).toBe("V");
    expect(analysis.events[0].function).toBe("D");
    expect(analysis.events[0].borrowed).toBe(false);
  });

  it("does not mark a diatonic vii° as borrowed", () => {
    const analysis = analyzeSection([chord("F", "maj"), chord("E", "dim")], { key: "F", scale: "ionian" });
    expect(analysis.events[1].roman).toBe("vii°");
    expect(analysis.events[1].borrowed).toBe(false);
  });

  it("keeps the source label when the stored numeral disagrees", () => {
    const analysis = analyzeSection(
      [chord("Bb", "min", 4, { annotation: "FV65/V" })],
      { key: "F", scale: "ionian" },
    );
    expect(analysis.events[0].sourceLabel).toBe("FV65/V");
  });

  it("measures each chord against the home in force at its own beat", () => {
    const analysis = analyzeSection([chord("C", "maj", 4), chord("D", "maj", 4)], {
      key: "C",
      scale: "ionian",
      regions: [
        { startBeat: 0, key: "C", scale: "ionian", source: "authored" },
        { startBeat: 4, key: "G", scale: "ionian", source: "authored" },
      ],
    });
    expect(analysis.events.map((event) => event.roman)).toEqual(["I", "V"]);
    expect(analysis.events.every((event) => !event.borrowed)).toBe(true);
  });
});

describe("analyzeSection — readings", () => {
  it("orders tension: tonic below dominant, applied above plain dominant", () => {
    const analysis = analyzeSection(
      [chord("F", "maj"), chord("C", "maj"), chord("G", "7"), chord("C", "7")],
      { key: "F", scale: "ionian" },
    );
    const [tonic, dominant, applied] = analysis.events;
    expect(tonic.tension).toBeLessThan(dominant.tension);
    expect(applied.tension).toBeGreaterThanOrEqual(dominant.tension);
  });

  it("finds an authentic cadence, and a plagal one", () => {
    const authentic = analyzeSection([chord("C", "7"), chord("F", "maj")], { key: "F", scale: "ionian" });
    expect(authentic.cadences.map((cadence) => cadence.kind)).toContain("authentic");

    const plagal = analyzeSection([chord("Bb", "min"), chord("F", "maj")], { key: "F", scale: "ionian" });
    expect(plagal.cadences.map((cadence) => cadence.kind)).toContain("plagal");
  });

  it("reports common tones and bass motion between neighbours", () => {
    const analysis = analyzeSection([chord("F", "maj"), chord("C", "maj")], { key: "F", scale: "ionian" });
    expect(analysis.links).toHaveLength(1);
    expect(analysis.links[0].commonTones).toBe(1); // C
    expect(analysis.links[0].bassMotion).toBe(-5); // F → C, shortest path
  });
});

describe("eventLabel", () => {
  it("switches to numbers for Nashville and strips extensions when simplified", () => {
    const analysis = analyzeSection([chord("C", "7"), chord("F", "maj")], { key: "F", scale: "ionian" });
    expect(eventLabel(analysis.events[0], { nashville: true })).toBe("5");
    expect(eventLabel(analysis.events[0], { simplify: true })).toBe("V");
  });
});

describe("transposeForDisplay", () => {
  it("shifts the root but keeps identity and timing", () => {
    const original = chord("F", "maj", 3);
    const shown = transposeForDisplay(original, 2, "F");
    expect(shown.id).toBe(original.id);
    expect(shown.beats).toBe(3);
    expect(shown.root).toBe("G");
  });
});

describe("scaleStepSemitones", () => {
  it("counts semitones per scale degree, not per step", () => {
    expect(scaleStepSemitones("ionian", 1)).toBe(2);
    expect(scaleStepSemitones("ionian", 2)).toBe(4);
    expect(scaleStepSemitones("ionian", 3)).toBe(5);
    expect(scaleStepSemitones("ionian", 7)).toBe(0);
  });

  it("wraps negative steps and odd modes", () => {
    expect(scaleStepSemitones("ionian", -1)).toBe(11);
    expect(scaleStepSemitones("aeolian", 1)).toBe(2);
    expect(scaleStepSemitones("aeolian", 2)).toBe(3);
    expect(scaleStepSemitones("aeolian", 0)).toBe(0);
  });
});

describe("rootForDegree — the chromatic lane", () => {
  it("flats and sharps the diatonic degree it is applied to", () => {
    expect(rootForDegree("F", "ionian", 2, 0)).toBe("A");
    expect(rootForDegree("F", "ionian", 2, -1)).toBe("Ab");
    expect(rootForDegree("G", "ionian", 0, 1)).toBe("G#");
  });

  it("spells a sharpened degree enharmonically when the key prefers flats", () => {
    // ♯III in F is the same pitch as ♭IV, and the key's spelling wins: the
    // lane moves the PITCH, it does not pin the accidental.
    expect(rootForDegree("F", "ionian", 2, 1)).toBe("Bb");
  });
});

describe("modal numerals and the chromatic ladder", () => {
  const aeolian = (chords: Chord[]) => analyzeSection(chords, { key: "D", scale: "aeolian" }).events;

  it("prints a mode's own accidentals: Bb in D aeolian is ♭VI, not VI", () => {
    const [event] = aeolian([chord("Bb", "maj")]);
    expect(event.roman).toBe("♭VI");
    expect(event.absoluteName).toBe("Bb");
  });

  it("names a pitch between two scale steps the way the chord asked", () => {
    // F# in D sits between ♭III (F) and iv (G): ♯III and ♭IV are both real
    // names for the same pitch, so the stored spelling decides.
    const [asSharp] = aeolian([chord("Gb", "maj", 4, { spelling: "sharp" })]);
    const [asFlat] = aeolian([chord("Gb", "maj", 4, { spelling: "flat" })]);
    // Sharpening the mode's ♭III gives the major third, which is plain "III";
    // flattening iv gives "♭IV". Same pitch, two numbers.
    expect(asSharp.roman).toBe("III");
    expect(asFlat.roman).toBe("♭IV");
  });

  it("offers only names that are worth writing", () => {
    // B in D aeolian: reading it as a flattened seventh needs ♭♭VII, so that
    // option is dropped and only the natural name is left.
    expect(spellingReadings("D", "aeolian", 9, "maj")).toEqual({ sharp: "VI", flat: null });
    expect(spellingReadings("D", "aeolian", 4, "maj")).toEqual({ sharp: "III", flat: "♭IV" });
  });

  it("lays the scale out on the twelve-step ladder", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((deg) => semitoneForDegree("aeolian", deg, 0))).toEqual([
      0, 2, 3, 5, 7, 8, 10,
    ]);
    expect(semitoneForDegree("aeolian", 5, -1)).toBe(7);
    expect(semitoneForDegree("ionian", 3, 1)).toBe(6);
  });

  it("spells a chromatic step by the request, a scale step by the key", () => {
    expect(rootForStep("D", "aeolian", 4, "sharp")).toBe("F#");
    expect(rootForStep("D", "aeolian", 4, "flat")).toBe("Gb");
    expect(rootForStep("D", "aeolian", 3)).toBe("F"); // ♭III: the key decides
    expect(rootForStep("D", "aeolian", 9, "flat")).toBe("B");
  });
});

describe("spelling and the name it produces", () => {
  const read = (root: Chord["root"], spelling?: "sharp" | "flat") =>
    analyzeSection([chord(root, "min", 4, { spelling })], { key: "D", scale: "aeolian" }).events[0];

  it("keeps the numeral and the absolute name in step", () => {
    expect([read("D#", "sharp").roman, read("D#", "sharp").absoluteName]).toEqual(["♯i", "D#m"]);
    expect([read("D#", "flat").roman, read("D#", "flat").absoluteName]).toEqual(["♭ii", "Ebm"]);
    expect([read("F#", "sharp").roman, read("F#", "sharp").absoluteName]).toEqual(["iii", "F#m"]);
    expect([read("F#", "flat").roman, read("F#", "flat").absoluteName]).toEqual(["♭iv", "Gbm"]);
  });

  it("heals a stored spelling the key cannot write", () => {
    // B as a flattened seventh would be ♭♭VII; the reader falls back to ♮VI.
    const event = read("B", "flat");
    expect(event.roman).toBe("vi");
    expect(event.absoluteName).toBe("Bm");
  });
});
