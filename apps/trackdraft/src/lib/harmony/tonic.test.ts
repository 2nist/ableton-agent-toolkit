import { describe, expect, it } from "vitest";
import {
  bestTonic,
  degreeRelativeTo,
  effectiveTonicRegions,
  inferTonicRegions,
  resolveTonicAt,
  setTonicAt,
  type TonicChordOccurrence,
} from "./tonic";

/** One chord per 4 beats, in order — the shape `resolveChordOccurrences` hands back. */
const progression = (
  ...chords: readonly (readonly [root: TonicChordOccurrence["root"], quality: string])[]
): TonicChordOccurrence[] =>
  chords.map(([root, quality], index) => ({
    root,
    quality,
    startTime: index * 4,
    duration: 4,
  }));

const C_MAJOR = [
  ["C", "maj"],
  ["F", "maj"],
  ["G", "maj"],
  ["C", "maj"],
] as const;

describe("bestTonic", () => {
  it("finds the tonic of a plain diatonic chroma", () => {
    const chroma = new Array(12).fill(0);
    for (const pc of [0, 4, 7]) chroma[pc] = 4;
    expect(bestTonic(chroma, "ionian").pc).toBe(0);
  });

  it("finds A in a minor-key chroma", () => {
    const chroma = new Array(12).fill(0);
    for (const pc of [9, 0, 4]) chroma[pc] = 4;
    expect(bestTonic(chroma, "aeolian").pc).toBe(9);
  });
});

describe("inferTonicRegions", () => {
  it("keeps one region for a progression that never leaves home", () => {
    const regions = inferTonicRegions(progression(...C_MAJOR), {
      scale: "ionian",
      fallbackKey: "C",
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ startBeat: 0, key: "C", scale: "ionian", source: "inferred" });
  });

  it("falls back to the song key for an empty progression", () => {
    expect(inferTonicRegions([], { scale: "ionian", fallbackKey: "Eb" })).toEqual([
      { startBeat: 0, key: "Eb", scale: "ionian", source: "inferred" },
    ]);
  });

  it("hears a modulation and starts a new region on the chord that lands home", () => {
    const chords = [
      ...progression(...C_MAJOR),
      // G major for four bars: the dominant pulls the home note to G.
      ...progression(...C_MAJOR).map((chord, index) => ({
        ...chord,
        startTime: 16 + index * 4,
      })),
      ...progression(["G", "maj"], ["C", "maj"], ["D", "maj"], ["G", "maj"]).map((chord, index) => ({
        ...chord,
        startTime: 32 + index * 4,
      })),
    ];
    const regions = inferTonicRegions(chords, { scale: "ionian", fallbackKey: "C" });
    expect(regions.length).toBeGreaterThan(1);
    expect(regions[0].key).toBe("C");
    expect(regions[regions.length - 1]).toMatchObject({ key: "G", source: "inferred" });
    // Regions are ordered and the first one owns beat 0.
    expect(regions.map((region) => region.startBeat)).toEqual(
      [...regions.map((region) => region.startBeat)].sort((a, b) => a - b),
    );
    expect(regions[0].startBeat).toBe(0);
  });

  it("lets minRegionBeats decide how eagerly a passing key becomes a region", () => {
    const chords = [
      { root: "C", quality: "maj", startTime: 0, duration: 4 },
      { root: "F", quality: "maj", startTime: 4, duration: 4 },
      { root: "G", quality: "maj", startTime: 8, duration: 4 },
      { root: "C", quality: "maj", startTime: 12, duration: 4 },
      // Two bars of Ab — a borrowed pair of bars, not a new home.
      { root: "Ab", quality: "maj", startTime: 16, duration: 8 },
      { root: "C", quality: "maj", startTime: 24, duration: 8 },
    ] as TonicChordOccurrence[];
    const eager = inferTonicRegions(chords, { scale: "ionian", fallbackKey: "C", minRegionBeats: 4 });
    const patient = inferTonicRegions(chords, {
      scale: "ionian",
      fallbackKey: "C",
      minRegionBeats: 32,
    });
    expect(patient).toHaveLength(1);
    expect(eager.length).toBeGreaterThanOrEqual(patient.length);
  });
});

describe("resolveTonicAt", () => {
  const regions = [
    { startBeat: 0, key: "C", scale: "ionian", source: "inferred" },
    { startBeat: 16, key: "G", scale: "ionian", source: "authored" },
  ] as const;

  it("returns the region covering the beat", () => {
    expect(resolveTonicAt([...regions], 0, { key: "C", scale: "ionian" }).key).toBe("C");
    expect(resolveTonicAt([...regions], 15.5, { key: "C", scale: "ionian" }).key).toBe("C");
    expect(resolveTonicAt([...regions], 16, { key: "C", scale: "ionian" }).key).toBe("G");
    expect(resolveTonicAt([...regions], 64, { key: "C", scale: "ionian" }).key).toBe("G");
  });

  it("falls back when nothing has been inferred yet", () => {
    expect(resolveTonicAt(undefined, 8, { key: "D", scale: "dorian" })).toEqual({
      startBeat: 0,
      key: "D",
      scale: "dorian",
      source: "inferred",
    });
  });
});

describe("setTonicAt", () => {
  const inferred = [
    { startBeat: 0, key: "C", scale: "ionian", source: "inferred" },
    { startBeat: 16, key: "G", scale: "ionian", source: "inferred" },
  ] as const;

  it("marks an authored home so re-inference can't move it silently", () => {
    const next = setTonicAt([...inferred], { startBeat: 16, key: "D", scale: "ionian" });
    expect(next[1]).toMatchObject({ startBeat: 16, key: "D", source: "authored" });
    expect(next[0].source).toBe("inferred");
  });

  it("keeps the list ordered and does not duplicate a boundary", () => {
    const next = setTonicAt([...inferred], { startBeat: 8, key: "F", scale: "ionian" });
    expect(next.map((region) => region.startBeat)).toEqual([0, 8, 16]);
    const replaced = setTonicAt(next, { startBeat: 8, key: "Bb", scale: "ionian" });
    expect(replaced).toHaveLength(3);
    expect(replaced[1].key).toBe("Bb");
  });

  it("always leaves a home at beat 0", () => {
    const next = setTonicAt(undefined, { startBeat: 12, key: "A", scale: "aeolian" });
    expect(next[0].startBeat).toBe(0);
    expect(next[0].source).toBe("inferred");
    expect(next[1]).toMatchObject({ key: "A", source: "authored" });
  });
});

describe("degreeRelativeTo", () => {
  it("places diatonic roots on their own degree", () => {
    expect(degreeRelativeTo(0, 0, "ionian")).toEqual({ deg: 0, acc: 0 });
    expect(degreeRelativeTo(5, 0, "ionian")).toEqual({ deg: 3, acc: 0 });
    expect(degreeRelativeTo(11, 0, "ionian")).toEqual({ deg: 6, acc: 0 });
  });

  it("flats a root that sits under a degree", () => {
    expect(degreeRelativeTo(8, 0, "ionian")).toEqual({ deg: 5, acc: -1 }); // Ab = bVI
    expect(degreeRelativeTo(10, 0, "ionian")).toEqual({ deg: 6, acc: -1 }); // Bb = bVII
  });

  it("reads an ambiguous semitone as a flat", () => {
    expect(degreeRelativeTo(1, 0, "ionian")).toEqual({ deg: 1, acc: -1 }); // Db = bII
    expect(degreeRelativeTo(3, 0, "ionian")).toEqual({ deg: 2, acc: -1 }); // Eb = bIII
  });

  it("keeps the raised fourth spelled as a sharp", () => {
    expect(degreeRelativeTo(6, 0, "ionian")).toEqual({ deg: 3, acc: 1 }); // F# = #IV
  });

  it("moves with the tonic, so the same shape reads differently after a modulation", () => {
    expect(degreeRelativeTo(2, 0, "ionian")).toEqual({ deg: 1, acc: 0 });
    expect(degreeRelativeTo(2, 7, "ionian")).toEqual({ deg: 4, acc: 0 }); // D is V of G
  });
});

describe("effectiveTonicRegions", () => {
  const chords = progression(...C_MAJOR);

  it("prefers what the author set", () => {
    const stored = [
      { startBeat: 0, key: "C", scale: "ionian", source: "inferred" },
      { startBeat: 8, key: "D", scale: "ionian", source: "authored" },
    ] as const;
    const regions = effectiveTonicRegions([...stored], chords, {
      scale: "ionian",
      fallbackKey: "C",
    });
    expect(regions).toHaveLength(2);
    expect(regions[1]).toMatchObject({ startBeat: 8, key: "D", source: "authored" });
  });

  it("infers when nothing was set, including an empty list", () => {
    for (const stored of [undefined, []]) {
      const regions = effectiveTonicRegions(stored, chords, {
        scale: "ionian",
        fallbackKey: "C",
      });
      expect(regions).toHaveLength(1);
      expect(regions[0]).toMatchObject({ key: "C", source: "inferred" });
    }
  });

  it("sorts stored regions, so a hand-edited list still resolves in time order", () => {
    const stored = [
      { startBeat: 8, key: "D", scale: "ionian", source: "authored" },
      { startBeat: 0, key: "C", scale: "ionian", source: "inferred" },
    ] as const;
    const regions = effectiveTonicRegions([...stored], chords, {
      scale: "ionian",
      fallbackKey: "C",
    });
    expect(regions.map((region) => region.startBeat)).toEqual([0, 8]);
  });
});
