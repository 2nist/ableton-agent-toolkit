import { describe, it, expect } from "vitest";
import { resolveChordOccurrences, resolveEffectiveStyle, styleSpacing } from "@drum/library";
import { sectionOccurrences } from "./sectionOccurrences";
import type { BlueprintSection, BlueprintSong, Chord } from "../../types/blueprint";

function chord(id: string, beats: number): Chord {
  return { id, romanNumeral: "I", root: "C", quality: "maj", beats };
}

function section(overrides: Partial<BlueprintSection> = {}): BlueprintSection {
  return {
    id: "verse",
    name: "Verse",
    role: "verse",
    bars: 4,
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    chords: [chord("c1", 4), chord("c2", 4), chord("c3", 4), chord("c4", 4)],
    ...overrides,
  };
}

function song(bend?: Partial<Record<"density", number>>): BlueprintSong {
  return {
    id: "song-1",
    title: "Test Song",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [],
    arrangement: [],
    ...(bend ? { bend } : {}),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("sectionOccurrences", () => {
  it("matches the plain resolver at the neutral style", () => {
    const sec = section();
    const model = song();
    const plain = resolveChordOccurrences(sec, 16);
    expect(sectionOccurrences(sec, model, 16).map((o) => [o.startTime, o.duration])).toEqual(
      plain.map((o) => [o.startTime, o.duration]),
    );
  });

  it("applies the style's density nudge — the boxes and the highlight share one grid", () => {
    const dense = section({ bend: { density: 1 } });
    const model = song();
    const spacing = styleSpacing(resolveEffectiveStyle(dense, model).density);

    // The nudge is real for this style, otherwise the assertion below is vacuous.
    expect(spacing).toBeLessThan(1);

    const occurrences = sectionOccurrences(dense, model, 16);
    const plain = resolveChordOccurrences(dense, 16);

    // Chords compress, so more of them fit in the same section: the second
    // onset lands before the unstyled 4-beat mark and the cycle repeats an
    // extra time.
    expect(occurrences[1].startTime).toBeCloseTo(4 * spacing, 5);
    expect(occurrences[1].startTime).toBeLessThan(plain[1].startTime);
    expect(occurrences.length).toBeGreaterThan(plain.length);
  });

  it("returns nothing for a zero-length section", () => {
    expect(sectionOccurrences(section(), song(), 0)).toEqual([]);
  });

  it("tolerates a missing song", () => {
    expect(sectionOccurrences(section(), null, 16).length).toBeGreaterThan(0);
  });
});
