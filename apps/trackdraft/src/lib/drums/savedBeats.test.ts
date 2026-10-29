import { describe, expect, it } from "vitest";
import type { BlueprintSection } from "../../types/blueprint";
import { beatsFile, captureBeat, mergeBeats, parseBeatsFile, savedBeatVariant, withSavedBeat } from "./savedBeats";
import type { SavedBeat } from "../../types/blueprint";

const section = (over: Partial<BlueprintSection> = {}): BlueprintSection =>
  ({
    id: "s1",
    name: "Verse",
    role: "verse",
    bars: 4,
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    chords: [],
    drumPattern: "standard",
    ...over,
  }) as unknown as BlueprintSection;

describe("captureBeat — a saved beat is the notes you hear", () => {
  it("captures ONE loop, not the section — that is what makes it reusable", () => {
    // An eight-bar verse whose pattern is one bar saves one bar.
    const beat = captureBeat(section({ bars: 8 }), "my beat")!;
    expect(beat.bars).toBe(1);
    const notes = Object.values(beat.lanes).flat();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.length).toBeLessThan(40);
    expect(Math.max(...notes.map((n) => n.beat))).toBeLessThan(4);
  });

  it("names lanes it has no hits for by omission, not by an empty array", () => {
    const beat = captureBeat(section(), "kick only")!;
    expect(beat.lanes.kick!.length).toBeGreaterThan(0);
    expect(beat.lanes.cym).toBeUndefined();
  });
});

describe("withSavedBeat — replaces what it defines, keeps the rest", () => {
  const beat = (lanes: SavedBeat["lanes"]): SavedBeat => ({ id: "b1", name: "x", bars: 1, lanes });

  it("writes one block per defined lane, spanning the section", () => {
    const next = withSavedBeat(
      section(),
      beat({ kick: [{ beat: 0, pitch: 36, velocity: 110 }], snare: [{ beat: 2, pitch: 38, velocity: 100 }] }),
    );
    const lanes = (next.drumBlocks ?? []).map((b) => b.lane).sort();
    expect(lanes).toEqual(["kick", "snare"]);
    for (const block of next.drumBlocks!) {
      expect(block.startBeat).toBe(0);
      expect(block.endBeat).toBe(16);
    }
  });

  it("leaves a lane it does not define alone", () => {
    const withHat = withSavedBeat(section(), beat({ hat: [{ beat: 0, pitch: 42, velocity: 70 }] }));
    const both = withSavedBeat(withHat, beat({ kick: [{ beat: 0, pitch: 36, velocity: 110 }] }));
    const hat = both.drumBlocks!.find((b) => b.lane === "hat")!;
    expect(hat).toEqual(withHat.drumBlocks!.find((b) => b.lane === "hat")!);
  });

  it("re-tiles a one-bar beat across an eight-bar section", () => {
    const next = withSavedBeat(section({ bars: 8 }), beat({ kick: [{ beat: 0, pitch: 36, velocity: 110 }, { beat: 2, pitch: 36, velocity: 100 }] }));
    const block = next.drumBlocks!.find((b) => b.lane === "kick")!;
    expect(block.notes!.map((n) => n.beat)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);
  });
});

describe("savedBeatVariant — a saved beat is a playable card", () => {
  it("carries its own length and its notes in time order", () => {
    const variant = savedBeatVariant(
      { id: "b", name: "n", bars: 2, lanes: { kick: [{ beat: 4, pitch: 36, velocity: 100 }, { beat: 0, pitch: 36, velocity: 110 }] } },
      4,
    );
    expect(variant.lengthBeats).toBe(8);
    expect(variant.beatsPerBar).toBe(4);
    expect(variant.notes.map(([beat]) => beat)).toEqual([0, 4]);
  });
});

describe("beats.json — the portable file", () => {
  const beat = (id: string, name = id): SavedBeat => ({
    id,
    name,
    bars: 1,
    lanes: { kick: [{ beat: 0, pitch: 36, velocity: 110 }] },
  });

  it("round-trips through the export format", () => {
    const file = JSON.stringify(beatsFile([beat("a")]));
    expect(file).toContain("trackdraft.beats.v1");
    expect(parseBeatsFile(file).map((b) => b.id)).toEqual(["a"]);
  });

  it("accepts a bare array, because a hand-written file usually is one", () => {
    expect(parseBeatsFile(JSON.stringify([beat("a")])).map((b) => b.id)).toEqual(["a"]);
  });

  it("drops entries that are not beats instead of failing the whole import", () => {
    const messy = JSON.stringify({ beats: [beat("a"), { id: "b" }, null, "nope"] });
    expect(parseBeatsFile(messy).map((b) => b.id)).toEqual(["a"]);
  });

  it("merges by id — an imported beat replaces the one it names", () => {
    const merged = mergeBeats([beat("a", "old"), beat("b")], [beat("a", "new"), beat("c")]);
    expect(merged.added).toBe(1);
    expect(merged.replaced).toBe(1);
    expect(merged.beats.map((b) => `${b.id}:${b.name}`)).toEqual(["a:new", "b:b", "c:c"]);
  });
});
