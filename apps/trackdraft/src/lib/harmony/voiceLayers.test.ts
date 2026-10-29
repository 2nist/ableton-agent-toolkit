import { describe, expect, it } from "vitest";
import { pitchClass } from "@music-theory/core";
import { bassVoiceMarks, colorVoiceMarks } from "./voiceLayers";
import type { BlueprintSection } from "../../types/blueprint";

const chord = (
  id: string,
  root: string,
  quality: "maj" | "min" | "7",
  beats = 4,
) =>
  ({
    id,
    romanNumeral: "I",
    root,
    quality,
    beats,
  }) as unknown as BlueprintSection["chords"][number];

const section = (overrides: Partial<BlueprintSection> = {}): BlueprintSection =>
  ({
    id: "s1",
    name: "Verse",
    role: "verse",
    bars: 4,
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    chords: [
      chord("c1", "C", "maj"),
      chord("c2", "F", "maj"),
      chord("c3", "G", "maj"),
      chord("c4", "C", "maj"),
    ],
    ...overrides,
  }) as unknown as BlueprintSection;

/** The ladder counts chromatic semitones above the tonic, so a C major
 *  section puts C on row 0, F on row 5, G on row 7. */
const stepOfRoot = (root: string, key: string) =>
  (((pitchClass(root) - pitchClass(key)) % 12) + 12) % 12;

describe("bassVoiceMarks — the generated bass line, where it plays", () => {
  it("is one bar per chord at the default rhythm, on the chord's own row", () => {
    const marks = bassVoiceMarks(section(), "C");
    expect(marks).toHaveLength(4);
    expect(marks.map((m) => m.step)).toEqual([0, 5, 7, 0]);
    expect(marks.map((m) => m.label)).toEqual(["C", "F", "G", "C"]);
  });

  it("splits into more bars when the rhythm subdivides — the reason this is not one rectangle per chord", () => {
    const marks = bassVoiceMarks(
      section({ bassProfile: { rhythm: "eighth" } }),
      "C",
    );
    expect(marks.length).toBe(16); // 4 chords x 4 subdivisions
  });

  it("moves off the root for the fifth, which is the motion the bar is there to show", () => {
    const marks = bassVoiceMarks(
      section({ bassProfile: { rhythm: "half", motion: "root_fifth" } }),
      "C",
    );
    // Chord 1 (C): root then fifth (G = row 7).
    expect(marks[0]!.step).toBe(0);
    expect(marks[1]!.step).toBe(stepOfRoot("G", "C"));
  });

  it("walks into the next root, a semitone under it", () => {
    const marks = bassVoiceMarks(
      section({ bassProfile: { rhythm: "half", motion: "walking" } }),
      "C",
    );
    // Chord 1's second half approaches F (row 5) from one semitone below → row 4.
    expect(marks[1]!.step).toBe(4);
  });

  it("keeps the register invisible — the same row for octave 2 and 3", () => {
    // The floor's pitch axis is pitch classes, so register cannot move a mark.
    const low = bassVoiceMarks(section({ bassProfile: { octave: 2 } }), "C");
    const high = bassVoiceMarks(section({ bassProfile: { octave: 3 } }), "C");
    expect(low.map((m) => m.step)).toEqual(high.map((m) => m.step));
  });
});

describe("colorVoiceMarks — the bi-tonal chord, one per chord", () => {
  it("sits a flavour's shift above each chord's root", () => {
    // cinematic_shimmer shifts +7 (a fifth above the anchor, maj9).
    const marks = colorVoiceMarks(
      section({ colorFlavor: "cinematic_shimmer" }),
      "C",
    );
    expect(marks).toHaveLength(4);
    // C + 7 = G (row 7); F + 7 = C (row 0); G + 7 = D (row 2).
    expect(marks.map((m) => m.step)).toEqual([7, 0, 2, 7]);
    expect(marks[0]!.label).toBe("Maj9");
  });

  it("can land on a chromatic row the chord itself never uses", () => {
    // altered_tension shifts +1 — a flat ninth above the root. It belongs to
    // the dominant family, so it takes a "7" chord to reach it; any other
    // quality resolves to its own bucket and falls back to a unison (shift 0).
    const altered = colorVoiceMarks(
      section({
        colorFlavor: "altered_tension",
        chords: [chord("c1", "C", "7"), chord("c2", "C", "7")],
      }),
      "C",
    );
    expect(altered[0]!.step).toBe(1);
  });

  it("colours every chord family by default, so the layer never drops out", () => {
    // The default flavour used to exist only for MINOR anchors: a mixed
    // progression coloured its minor chords and passed each major through as a
    // zero-shift unison, so the layer stopped for a bar or two and came back.
    // It has an entry for every family now — a fifth above the anchor.
    const marks = colorVoiceMarks(section({ colorFlavor: undefined }), "C");
    expect(marks.some((mark) => mark.plain)).toBe(false);
    expect(marks.map((mark) => mark.name)).toEqual(["G", "C", "D", "G"]);
  });

  it("marks a unison fallback rather than pretending it added a note", () => {
    // `altered_tension` is a dominant-family recipe, so a major chord has
    // nothing to resolve: the "colour" chord is the chord again, and the
    // overlay says so instead of claiming a layer that does nothing.
    const marks = colorVoiceMarks(
      section({
        colorFlavor: "altered_tension",
        chords: [chord("c1", "C", "maj"), chord("c2", "C", "7")],
      }),
      "C",
    );
    expect(marks[0]!.plain).toBe(true);
    expect(marks[0]!.label).toBe("Unison");
    expect(marks[1]!.plain).toBe(false);
  });

  it("spells the bass against the section's key", () => {
    // The same pitch class is Bb in a flat key and A# in a sharp one — a bass
    // bar labelled A# in D aeolian would be wrong on the page.
    const chords = [
      chord("c1", "D", "min"),
      chord("c2", "Bb", "maj"),
      chord("c3", "C", "maj"),
      chord("c4", "D", "min"),
    ];
    const inD = bassVoiceMarks(section({ chords }), "D").map(
      (mark) => mark.label,
    );
    expect(inD).toEqual(["D", "Bb", "C", "D"]);

    // ...and it follows the CHORD, not the key: the same pitch class on an
    // A#-rooted chord is written A#.
    const sharps = [
      chord("c1", "D", "min"),
      chord("c2", "A#", "maj"),
      chord("c3", "C", "maj"),
      chord("c4", "D", "min"),
    ];
    expect(
      bassVoiceMarks(section({ chords: sharps }), "D").map(
        (mark) => mark.label,
      ),
    ).toEqual(["D", "A#", "C", "D"]);
  });

  it("sustains for the chord it colours", () => {
    const marks = colorVoiceMarks(
      section({ colorFlavor: "cinematic_shimmer" }),
      "C",
    );
    expect(marks[0]!.duration).toBeGreaterThan(0);
    // and the next mark starts where the first ends
    expect(marks[1]!.start).toBeCloseTo(
      marks[0]!.start + marks[0]!.duration,
      6,
    );
  });

  it("names the chord the engine builds, not the flavour's marketing label", () => {
    // `neo_soul_glow` labels itself "m11" but its recipe quality is "maj", so a
    // Dm chord is coloured with a C MAJOR triad. "Cm11" would name a chord that
    // is never played.
    const marks = colorVoiceMarks(
      section({ chords: [chord("c1", "D", "min")] }),
      "D",
    );
    expect(marks[0]!.name).toBe("C");
    expect(marks[0]!.label).toBe("m11");
    // and a minor-quality recipe does get the minor suffix
    const ocean = colorVoiceMarks(
      section({
        chords: [chord("c1", "D", "min")],
        colorFlavor: "ambient_ocean",
      }),
      "D",
    );
    expect(ocean[0]!.name).toBe("Am");
  });

  it("measures the row from the section's key, not from C", () => {
    // C + 7 = G. Above C that is row 7; above D it is row 5 (G is a fourth
    // above D). Same chord, different ladder row — so the mark tracks the key.
    const inC = colorVoiceMarks(
      section({ colorFlavor: "cinematic_shimmer" }),
      "C",
    );
    const inD = colorVoiceMarks(
      section({ colorFlavor: "cinematic_shimmer" }),
      "D",
    );
    expect(inC[0]!.step).toBe(7);
    expect(inD[0]!.step).toBe(5);
  });
});
