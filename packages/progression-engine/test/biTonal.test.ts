import { describe, expect, it } from "vitest";
import {
  BI_TONAL_MATRIX,
  anchorFamily,
  generateBiTonal,
  resolveFlavor,
} from "../src/index.js";

const C_AM_F_G7 = [
  { rootPc: 0, quality: "maj", durationBeats: 4 }, // C
  { rootPc: 9, quality: "min", durationBeats: 4 }, // Am
  { rootPc: 5, quality: "maj", durationBeats: 4 }, // F
  { rootPc: 7, quality: "7", durationBeats: 4 }, // G7
];

describe("anchorFamily", () => {
  it("buckets chord qualities into major/minor/dominant_7th", () => {
    expect(anchorFamily("maj")).toBe("major");
    expect(anchorFamily("maj7")).toBe("major");
    expect(anchorFamily("sus4")).toBe("major");
    expect(anchorFamily("min")).toBe("minor");
    expect(anchorFamily("min7")).toBe("minor");
    expect(anchorFamily("dim")).toBe("minor");
    expect(anchorFamily("7")).toBe("dominant_7th");
  });
});

describe("resolveFlavor", () => {
  it("returns the matrix entry for a known (family, flavor) pair", () => {
    expect(resolveFlavor(BI_TONAL_MATRIX, "maj", "sci_fi_wonder")).toEqual({ shift: 2, quality: "maj", label: "Maj13(#11)" });
    expect(resolveFlavor(BI_TONAL_MATRIX, "min", "neo_soul_glow")).toEqual({ shift: 10, quality: "maj", label: "m11" });
    expect(resolveFlavor(BI_TONAL_MATRIX, "7", "altered_tension")).toEqual({ shift: 1, quality: "maj", label: "7(b9#9#11)" });
  });

  it("falls back to a unison same-quality recipe for unknown pairs", () => {
    expect(resolveFlavor(BI_TONAL_MATRIX, "maj", "not_a_flavor")).toEqual({ shift: 0, quality: "maj", label: "Unison" });
  });
});

describe("generateBiTonal", () => {
  it("produces an anchor layer per chord and a color layer", () => {
    const { anchor, color, totalBeats } = generateBiTonal(BI_TONAL_MATRIX, "sci_fi_wonder", C_AM_F_G7);
    expect(totalBeats).toBe(16);
    // 4 chords: C maj + Am min + F maj + G7 = 3+3+3+4 anchor notes
    expect(anchor.length).toBe(13);
    expect(color.length).toBeGreaterThanOrEqual(12); // triads; G7 color is a triad too
  });

  it("shifts the color root per the flavor (C major + sci_fi_wonder -> D major)", () => {
    const { color } = generateBiTonal(BI_TONAL_MATRIX, "sci_fi_wonder", [{ rootPc: 0, quality: "maj", durationBeats: 4 }], {
      anchorOctave: 3,
      colorOctave: 5,
    });
    // D major triad at octave 5 (base 60): D=62 F#=66 A=69
    expect(color.map((n) => n.pitch).sort()).toEqual([62, 66, 69]);
  });

  it("keeps the color layer strictly above the anchor (octave separation)", () => {
    const { anchor, color } = generateBiTonal(BI_TONAL_MATRIX, "ambient_ocean", C_AM_F_G7, {
      anchorOctave: 3,
      colorOctave: 5,
    });
    const maxAnchor = Math.max(...anchor.map((n) => n.pitch));
    const minColor = Math.min(...color.map((n) => n.pitch));
    expect(minColor).toBeGreaterThan(maxAnchor);
  });

  it("voice-leads consecutive color chords (small movement)", () => {
    const { color } = generateBiTonal(BI_TONAL_MATRIX, "sci_fi_wonder", [
      { rootPc: 0, quality: "maj", durationBeats: 4 },
      { rootPc: 9, quality: "min", durationBeats: 4 },
      { rootPc: 5, quality: "maj", durationBeats: 4 },
    ], { anchorOctave: 3, colorOctave: 5, syncopation: [0, 0, 0] });
    // group by chord (4 beats apart)
    const chordsColor = [
      color.filter((n) => n.startTime === 0).map((n) => n.pitch).sort((a, b) => a - b),
      color.filter((n) => n.startTime === 4).map((n) => n.pitch).sort((a, b) => a - b),
      color.filter((n) => n.startTime === 8).map((n) => n.pitch).sort((a, b) => a - b),
    ];
    // each successive chord should be near the previous (max movement well under an octave leap per voice)
    const maxMove = Math.max(
      Math.max(...chordsColor[1]!.map((p, i) => Math.abs(p - chordsColor[0]![i]!))),
      Math.max(...chordsColor[2]!.map((p, i) => Math.abs(p - chordsColor[1]![i]!))),
    );
    expect(maxMove).toBeLessThanOrEqual(7);
  });

  it("applies syncopation offsets to color note start times", () => {
    const { color } = generateBiTonal(BI_TONAL_MATRIX, "sci_fi_wonder", C_AM_F_G7, {
      syncopation: [0.5, 0, 0.5, 0],
      colorDurationBeats: 1,
    });
    const starts = [...new Set(color.map((n) => n.startTime))].sort((a, b) => a - b);
    // step 0 at 0.5, step 1 at 4, step 2 at 8.5, step 3 at 12
    expect(starts).toEqual([0.5, 4, 8.5, 12]);
  });

  it("uses short quiet color notes and sustained anchor notes", () => {
    const { anchor, color } = generateBiTonal(BI_TONAL_MATRIX, "cinematic_shimmer", C_AM_F_G7, {
      syncopation: [0, 0, 0, 0],
      colorDurationBeats: 1,
    });
    expect(anchor.every((n) => n.duration === 4)).toBe(true);
    expect(anchor.every((n) => n.velocity === 96)).toBe(true);
    expect(color.every((n) => n.duration === 1)).toBe(true);
    expect(color.every((n) => n.velocity === 80)).toBe(true);
  });

  it("sustains color notes for the full chord duration by default (extended color pad)", () => {
    const { color } = generateBiTonal(
      BI_TONAL_MATRIX,
      "ambient_ocean",
      [
        { rootPc: 0, quality: "maj", durationBeats: 4 },
        { rootPc: 5, quality: "maj", durationBeats: 2 },
      ],
      { syncopation: [0, 0] },
    );
    const first = color.filter((n) => n.startTime === 0);
    const second = color.filter((n) => n.startTime === 4);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first.every((n) => n.duration === 4)).toBe(true);
    expect(second.every((n) => n.duration === 2)).toBe(true);
  });
});
