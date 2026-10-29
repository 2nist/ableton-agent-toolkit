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

  it("shows the 4-bar cycle the export plays (open hat in bar 2, kick turnaround in bar 4)", () => {
    // The cycle is STRUCTURAL — if the .mid plays it and the dots don't, the
    // grid is lying. Bar 1 has an 8th-note hat grid and no open hat; bar 2
    // opens up on its last eighth.
    const sec = { ...makeSection(), bars: 8 };
    const hits = resolveSectionLaneHits(sec, undefined, 0);
    const openHats = (hits.get("hat") ?? []).filter((h) => h.voice === "openHat").map((h) => h.beat);
    expect(openHats.length, "no open hat in the cycle").toBeGreaterThan(0);
    // 4 + 3.5 = bar 2's last eighth.
    expect(openHats.some((beat) => Math.abs(beat - 7.5) < 0.06)).toBe(true);

    const kicks = (hits.get("kick") ?? []).map((h) => h.beat);
    // 12 + 3.5 = bar 4's last eighth, the turnaround into the next cycle.
    expect(kicks.some((beat) => Math.abs(beat - 15.5) < 0.06)).toBe(true);
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

/**
 * Precedence, asserted rather than assumed: a hand-authored range beats the
 * preset it sits on. This is what makes the sequencer and the Euclid editor
 * take effect, and it is the reason a *whole-section* choice has to clear
 * those blocks (see `lib/drums/grooveIntent.ts`) — otherwise the pick would
 * be silently overruled by an edit made against the previous groove.
 */
describe("precedence — authored blocks over the preset", () => {
  it("plays the authored note, not the preset's, inside the block's range", () => {
    const base = resolveSectionLaneHits(makeSection(), undefined, 0).get("kick") ?? [];
    // A kick on an off-beat the `standard` preset does not play.
    const authored = makeSection([
      {
        id: "blk",
        lane: "kick",
        startBeat: 0,
        endBeat: 2,
        mode: "steps",
        notes: [{ beat: 1.5, voice: "kick", velocity: 120 }],
      },
    ]);
    const withBlock = resolveSectionLaneHits(authored, undefined, 0).get("kick") ?? [];
    expect(withBlock.some((h) => Math.abs(h.beat - 1.5) < 1e-6)).toBe(true);
    expect(withBlock.some((h) => h.beat < 2 && Math.abs(h.beat - 1.5) > 1e-6)).toBe(false);
    // Outside the block, the preset is untouched.
    expect(withBlock.some((h) => h.beat >= 2)).toBe(true);
    expect(base.length).toBeGreaterThan(0);
  });

  it("lets the meter outline beat the preset", () => {
    const outlined = makeSection();
    outlined.drumMeterOutline = { cellBeats: 0.5, cells: [2, 2, 2, 2] as (2 | 3)[], label: "4/4" };
    const presetOnly = makeSection();
    const a = resolveSectionLaneHits(outlined, undefined, 0);
    const b = resolveSectionLaneHits(presetOnly, undefined, 0);
    const total = (m: Map<string, { beat: number }[]>) => [...m.values()].reduce((n, l) => n + l.length, 0);
    expect(total(a)).toBeGreaterThan(0);
    expect(total(a)).not.toBe(total(b));
  });
});
