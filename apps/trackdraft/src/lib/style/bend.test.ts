import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE_PROFILE, hasBend, resolveStyleProfile } from "./bend";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";

function section(bend?: BlueprintSection["bend"]): BlueprintSection {
  return {
    id: "s1",
    name: "Verse",
    role: "verse",
    bars: 4,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...(bend ? { bend } : {}),
  };
}

function song(bend?: BlueprintSong["bend"]): BlueprintSong {
  return {
    id: "song-1",
    title: "Test",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [],
    arrangement: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...(bend ? { bend } : {}),
  };
}

describe("bend resolution (through the real schema types)", () => {
  it("no bend → neutral profile and hasBend false", () => {
    expect(hasBend(section(), song())).toBe(false);
    expect(resolveStyleProfile(section(), song())).toEqual(DEFAULT_STYLE_PROFILE);
  });

  it("song master + section override merge through Partial<StyleProfile>", () => {
    const s = section({ backbeat: 0.9, tempo: 100 });
    const g = song({ energy: 0.7, backbeat: 0.1, tempo: 140 });
    const resolved = resolveStyleProfile(s, g);
    expect(resolved.backbeat).toBe(0.9); // section wins
    expect(resolved.tempo).toBe(100); // section wins
    expect(resolved.energy).toBe(0.7); // master fills the rest
    expect(resolved.harmony).toBe(DEFAULT_STYLE_PROFILE.harmony); // untouched → neutral
  });
});