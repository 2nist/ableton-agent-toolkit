import { describe, expect, it } from "vitest";
import { PRESET_DATA, type DrumLaneId } from "@drum/library";
import type { BlueprintSection } from "../../../types/blueprint";
import { withLaneFigure } from "./laneFigurePick";

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
    drumPattern: "half_time",
    ...over,
  }) as unknown as BlueprintSection;

/** The variant a shelf card would be drawn from. */
const variantOf = (pattern: keyof typeof PRESET_DATA, index = 0) => PRESET_DATA[pattern]!.variants[index]!;

const kickNotes = (sec: BlueprintSection) =>
  (sec.drumBlocks ?? []).find((b) => b.lane === "kick")?.notes?.length ?? 0;

describe("withLaneFigure — a lane pick writes one drum", () => {
  it("adds a section-wide block for that lane and leaves the pattern alone", () => {
    const next = withLaneFigure(section(), { lane: "kick" as DrumLaneId, variant: variantOf("standard") });
    const block = (next.drumBlocks ?? []).find((b) => b.lane === "kick")!;
    expect(block.startBeat).toBe(0);
    expect(block.endBeat).toBe(16); // 4 bars of 4/4
    expect(block.notes!.length).toBeGreaterThan(0);
    // the base groove still names the lanes the writer has not overridden
    expect(next.drumPattern).toBe("half_time");
  });

  it("keeps the other lanes' blocks exactly as they were", () => {
    // A snare figure already chosen by hand.
    const snare = withLaneFigure(section(), { lane: "snare" as DrumLaneId, variant: variantOf("standard", 1) });
    const snareBefore = snare.drumBlocks!.find((b) => b.lane === "snare")!;
    // Now replace the KICK — the snare must survive untouched.
    const both = withLaneFigure(snare, { lane: "kick" as DrumLaneId, variant: variantOf("motown") });
    const snareAfter = both.drumBlocks!.find((b) => b.lane === "snare")!;
    expect(snareAfter).toEqual(snareBefore);
    expect(both.drumBlocks!.some((b) => b.lane === "kick")).toBe(true);
  });

  it("replaces the same lane rather than stacking blocks on it", () => {
    const once = withLaneFigure(section(), { lane: "hat" as DrumLaneId, variant: variantOf("standard") });
    const twice = withLaneFigure(once, { lane: "hat" as DrumLaneId, variant: variantOf("driving") });
    expect(twice.drumBlocks!.filter((b) => b.lane === "hat")).toHaveLength(1);
    expect(kickNotes(twice)).toBe(0); // a hat pick must not invent a kick
  });

  it("writes nothing when the variant has no notes for that lane", () => {
    // `ballad` has no hats at all in its first variant.
    const next = withLaneFigure(section(), { lane: "cym" as DrumLaneId, variant: variantOf("ballad") });
    expect(next.drumBlocks ?? []).toHaveLength(0);
  });
});
