import { describe, expect, it } from "vitest";
import { resolveSectionLaneHits } from "./drumLaneHits";
import type { BlueprintSection } from "../../types/blueprint";

function makeSection(blocks?: BlueprintSection["drumBlocks"]): BlueprintSection {
  return {
    id: "sec-1",
    name: "Verse",
    role: "verse",
    bars: 4,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    drumPattern: "standard",
    drumVariantIndex: 0,
    drumBlocks: blocks,
  };
}

describe("resolveSectionLaneHits — the dotted lanes' data source", () => {
  it("resolves the base groove per lane, bounded to the section", () => {
    const hits = resolveSectionLaneHits(makeSection(), undefined, 0);
    expect(hits.get("kick")!.length).toBeGreaterThan(0);
    expect(hits.get("snare")!.length).toBeGreaterThan(0);
    for (const arr of hits.values()) {
      for (const h of arr) {
        expect(h.beat).toBeGreaterThanOrEqual(0);
        expect(h.beat).toBeLessThan(16);
      }
    }
  });

  it("compiles an euclid block over the lane's range only", () => {
    const sec = makeSection([
      { id: "b1", lane: "kick", startBeat: 8, endBeat: 12, mode: "euclid", euclid: { k: 2, n: 4, rotation: 0 } },
    ]);
    const hits = resolveSectionLaneHits(sec, undefined, 0);
    const kick = hits.get("kick")!;
    expect(kick.filter((h) => h.beat >= 8 && h.beat < 12).map((h) => h.beat).sort((a, b) => a - b)).toEqual([8, 10]);
    // Base groove outside the block range is untouched.
    expect(kick.some((h) => h.beat < 8)).toBe(true);
    expect(kick.some((h) => h.beat >= 12)).toBe(true);
  });

  it("compiles a steps block as a lane-range replacement (toggle semantics)", () => {
    const sec = makeSection([
      {
        id: "s1", lane: "hat", startBeat: 0, endBeat: 2, mode: "steps",
        notes: [{ beat: 0.5, voice: "closedHat", velocity: 90 }],
      },
    ]);
    const hits = resolveSectionLaneHits(sec, undefined, 0);
    const hatIn = hits.get("hat")!.filter((h) => h.beat < 2);
    expect(hatIn.map((h) => h.beat)).toEqual([0.5]);
    expect(hatIn[0].offGrid).toBe(true);
    expect(hatIn[0].velocity).toBe(90);
    // The rest of the section keeps its base hats.
    expect(hits.get("hat")!.some((h) => h.beat >= 2)).toBe(true);
  });

  it("spreads a cluster across lanes by priority (interleave)", () => {
    const sec = makeSection([
      { id: "c1", lane: "snare", groupId: "g", interleave: true, startBeat: 0, endBeat: 4, mode: "euclid", euclid: { k: 3, n: 4, rotation: 0 } },
      { id: "c2", lane: "tom", groupId: "g", interleave: true, startBeat: 0, endBeat: 4, mode: "euclid", euclid: { k: 3, n: 4, rotation: 0 } },
    ]);
    const hits = resolveSectionLaneHits(sec, undefined, 0);
    // Onsets 0,1,3 → snare, tom, snare.
    expect(hits.get("snare")!.filter((h) => h.beat < 4).map((h) => h.beat)).toEqual([0, 3]);
    expect(hits.get("tom")!.filter((h) => h.beat < 4).map((h) => h.beat)).toEqual([1]);
  });
});
