import { describe, it, expect } from "vitest";
import { classifySong } from "./classification";
import type { BlueprintSong, BlueprintSection } from "../types/blueprint";

function makeSection(overrides: Partial<BlueprintSection> & { id: string }): BlueprintSection {
  return {
    name: overrides.id,
    role: "verse",
    bars: 4,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

function makeSong(sections: BlueprintSection[]): BlueprintSong {
  return {
    id: "song-1",
    title: "Test Song",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections,
    arrangement: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("classifySong", () => {
  it("classifies a clean verse-chorus-verse-chorus skeleton confidently", () => {
    const song = makeSong([
      makeSection({ id: "v1", role: "verse" }),
      makeSection({ id: "c1", role: "chorus" }),
      makeSection({ id: "v2", role: "verse" }),
      makeSection({ id: "c2", role: "chorus" }),
    ]);
    const result = classifySong(song);
    expect(result.isNewForm).toBe(false);
    expect(result.form).not.toBeNull();
    expect(result.label).not.toBe("New / unclassified form");
    expect(result.confidenceTier).not.toBe("new");
    expect(result.match.score).toBeGreaterThan(0);
  });

  it("reports isNewForm for a skeleton with no real narrative roles", () => {
    // All-custom-role sections drop out of fromBlueprintSong's tokens
    // entirely (custom without a recognizable name), leaving an empty
    // skeleton that can't clear the classifier's match threshold.
    const song = makeSong([
      makeSection({ id: "s1", role: "custom", name: "part_x" }),
      makeSection({ id: "s2", role: "custom", name: "part_y" }),
    ]);
    const result = classifySong(song);
    expect(result.isNewForm).toBe(true);
    expect(result.form).toBeNull();
    expect(result.label).toBe("New / unclassified form");
    expect(result.confidenceTier).toBe("new");
  });

  it("looks up the runner-up form when the engine reports one", () => {
    const song = makeSong([
      makeSection({ id: "v1", role: "verse" }),
      makeSection({ id: "c1", role: "chorus" }),
      makeSection({ id: "v2", role: "verse" }),
    ]);
    const result = classifySong(song);
    if (result.match.runnerUp) {
      expect(result.runnerUpForm?.id).toBe(result.match.runnerUp.formId);
    }
  });
});
