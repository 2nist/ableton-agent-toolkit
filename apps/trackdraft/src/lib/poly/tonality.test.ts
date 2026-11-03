import { describe, expect, it } from "vitest";
import type { BlueprintSection, TonicRegion } from "../../types/blueprint";
import { modulationMarks, withSectionTonality } from "./tonality";

const section = {
  id: "s",
  name: "Chorus",
  role: "chorus",
  bars: 8,
  chords: [],
  beatsPerChord: 4,
  velocity: "mf",
  timeSignatureNumerator: 4,
  timeSignatureDenPower: 2,
} as BlueprintSection;

describe("withSectionTonality", () => {
  it("sets a key the section owns", () => {
    const next = withSectionTonality(section, { key: "D" });
    expect(next.key).toBe("D");
    // Nothing else moves.
    expect(next.bars).toBe(8);
    expect(next.id).toBe("s");
  });

  it("clearing removes the field, so the section follows the song again", () => {
    const owned = withSectionTonality(section, { key: "D", scale: "dorian" });
    const cleared = withSectionTonality(owned, { key: null });
    expect("key" in cleared).toBe(false);
    // The mode is a separate override and stays.
    expect(cleared.scale).toBe("dorian");
  });

  it("clear-then-change-the-song really follows the song", () => {
    // The failure this guards: storing "C" as the section's key would make it
    // immune to the song moving to D.
    const owned = withSectionTonality(section, { key: "C" });
    const cleared = withSectionTonality(owned, { key: null });
    const songKey = "D" as const;
    expect(cleared.key ?? songKey).toBe(songKey);
  });

  it("leaves untouched fields alone", () => {
    const owned = withSectionTonality(section, { scale: "aeolian" });
    const next = withSectionTonality(owned, { key: "F" });
    expect(next.scale).toBe("aeolian");
    expect(next.key).toBe("F");
  });

  it("does not mutate the section it was given", () => {
    withSectionTonality(section, { key: "D" });
    expect(section.key).toBeUndefined();
  });

  it("clears a mode without touching the key", () => {
    const owned = withSectionTonality(section, {
      key: "A",
      scale: "mixolydian",
    });
    const next = withSectionTonality(owned, { scale: null });
    expect(next.key).toBe("A");
    expect("scale" in next).toBe(false);
  });
});

describe("modulationMarks", () => {
  const withRegions = (
    regions: TonicRegion[],
  ): { tonicRegions: TonicRegion[] } => ({
    tonicRegions: regions,
  });

  it("has nothing to say about a section with one home", () => {
    expect(modulationMarks({}, 32)).toEqual([]);
    expect(
      modulationMarks(
        withRegions([
          { startBeat: 0, key: "C", scale: "ionian", source: "authored" },
        ]),
        32,
      ),
    ).toEqual([]);
  });

  it("places a mid-section change where it starts", () => {
    const [mark] = modulationMarks(
      withRegions([
        { startBeat: 0, key: "C", scale: "ionian", source: "authored" },
        { startBeat: 16, key: "D", scale: "dorian", source: "authored" },
      ]),
      32,
      4,
    );
    expect(mark.at).toBeCloseTo(0.5, 6);
    expect(mark.bar).toBe(5);
    expect(mark.label).toBe("D");
    expect(mark.title).toContain("D dorian");
    expect(mark.title).toContain("bar 5");
  });

  it("says when a change was only suggested", () => {
    const [mark] = modulationMarks(
      withRegions([
        { startBeat: 8, key: "A", scale: "aeolian", source: "inferred" },
      ]),
      32,
      4,
    );
    expect(mark.title).toContain("suggested, not authored");
  });

  it("keeps every mark inside the column", () => {
    const marks = modulationMarks(
      withRegions([
        { startBeat: 40, key: "F", scale: "lydian", source: "authored" },
      ]),
      32,
      4,
    );
    expect(marks[0].at).toBe(1);
  });

  it("gives up on a zero-length section rather than dividing by it", () => {
    expect(
      modulationMarks(
        withRegions([
          { startBeat: 4, key: "G", scale: "ionian", source: "authored" },
        ]),
        0,
      ),
    ).toEqual([]);
  });
});
