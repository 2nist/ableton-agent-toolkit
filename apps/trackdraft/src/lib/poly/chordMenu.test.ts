import { describe, expect, it } from "vitest";
import type { BlueprintSection } from "../../types/blueprint";
import {
  CHORD_INVERSIONS,
  CHORD_MENU_QUALITIES,
  chordById,
  QUALITY_LABEL,
  withChordInversion,
  withChordQuality,
  withoutChord,
} from "./chordMenu";

function section(overrides: Partial<BlueprintSection> = {}): BlueprintSection {
  return {
    id: "s",
    name: "Verse",
    role: "verse",
    bars: 2,
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    chords: [
      { id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
      { id: "c2", romanNumeral: "vi", root: "A", quality: "min", beats: 4 },
    ],
    ...overrides,
  } as BlueprintSection;
}

describe("withChordQuality (§S1)", () => {
  it("changes one chord and leaves the rest alone", () => {
    const next = withChordQuality(section(), "c2", "min7");
    expect(next.chords[1].quality).toBe("min7");
    expect(next.chords[0]).toEqual(section().chords[0]);
  });

  it("drops a stale extended suffix", () => {
    // The suffix is what the hex and the inspector DISPLAY — "maj9" left on a
    // chord that now says `min` would label it one thing and play another.
    const withSuffix = section();
    withSuffix.chords[1] = { ...withSuffix.chords[1], extendedSuffix: "maj9" };
    expect(
      withChordQuality(withSuffix, "c2", "min").chords[1].extendedSuffix,
    ).toBeUndefined();
  });

  it("does nothing for an unknown chord id", () => {
    expect(withChordQuality(section(), "nope", "dim").chords).toEqual(
      section().chords,
    );
  });
});

describe("withChordInversion (§S1)", () => {
  it("puts a chord tone in the bass", () => {
    expect(withChordInversion(section(), "c1", 1).chords[0].voicing).toEqual({
      inversion: 1,
    });
  });

  it("treats root position as ABSENT, not as { inversion: 0 }", () => {
    // Every planner reads an absent voicing as root-position-close; storing the
    // default would make "never touched" and "touched then reset" differ.
    const flipped = withChordInversion(section(), "c1", 2);
    const back = withChordInversion(flipped, "c1", 0);
    expect(back.chords[0].voicing).toBeUndefined();
  });

  it("keeps a spread when the inversion goes back to root", () => {
    const spread = section();
    spread.chords[0] = {
      ...spread.chords[0],
      voicing: { inversion: 2, spread: "open" },
    };
    const back = withChordInversion(spread, "c1", 0);
    expect(back.chords[0].voicing).toEqual({ spread: "open" });
  });

  it("clamps to the three positions a triad has", () => {
    expect(withChordInversion(section(), "c1", 9).chords[0].voicing).toEqual({
      inversion: 2,
    });
    expect(
      withChordInversion(section(), "c1", -4).chords[0].voicing,
    ).toBeUndefined();
  });
});

describe("withoutChord (§S1)", () => {
  it("removes the chord and hands its beats to the one before", () => {
    const next = withoutChord(section(), "c2");
    expect(next.chords).toHaveLength(1);
    expect(next.chords[0].id).toBe("c1");
    // Four + four: the progression still fills the bar instead of leaving a
    // hole where the deleted chord was.
    expect(next.chords[0].beats).toBe(8);
  });

  it("just removes the first chord, with nothing to hand its beats to", () => {
    const next = withoutChord(section(), "c1");
    expect(next.chords.map((chord) => chord.id)).toEqual(["c2"]);
  });

  it("returns the same section for an unknown id", () => {
    const before = section();
    expect(withoutChord(before, "nope")).toBe(before);
  });

  it("can empty a progression", () => {
    const one = withoutChord(section(), "c2");
    expect(withoutChord(one, "c1").chords).toEqual([]);
  });
});

describe("the menu's vocabulary", () => {
  it("offers a quality for every button label", () => {
    for (const quality of CHORD_MENU_QUALITIES) {
      expect(QUALITY_LABEL[quality]).toBeTruthy();
    }
  });

  it("offers three inversions, root first", () => {
    expect(CHORD_INVERSIONS.map((entry) => entry.value)).toEqual([0, 1, 2]);
  });

  it("finds a chord by id, or says it is gone", () => {
    expect(chordById(section(), "c2")?.root).toBe("A");
    expect(chordById(section(), "gone")).toBeNull();
  });
});
