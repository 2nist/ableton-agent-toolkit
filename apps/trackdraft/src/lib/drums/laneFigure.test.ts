import { describe, expect, it } from "vitest";
import { laneFigureBlock } from "./laneFigure";

const note = (beat: number, voice: string, velocity: number) => ({ beat, voice, velocity }) as never;

describe("laneFigureBlock — a lane pick writes one lane", () => {
  it("covers the whole section, not just the first bar", () => {
    // A one-bar kick figure over four bars is four bars of kick. The block
    // spans the section so `spliceLane` clears the lane's old content
    // everywhere before writing the new figure.
    const block = laneFigureBlock({
      lane: "kick",
      notes: [note(0, "kick", 110), note(2, "kick", 100)],
      lengthBeats: 4,
      durationBeats: 16,
    })!;
    expect(block.startBeat).toBe(0);
    expect(block.endBeat).toBe(16);
    expect(block.mode).toBe("steps");
    expect(block.notes!.map((n) => n.beat)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("tiles a two-bar figure one repeat at a time", () => {
    const block = laneFigureBlock({
      lane: "snare",
      notes: [note(1, "snare", 100), note(5, "snare", 100)],
      lengthBeats: 8,
      durationBeats: 16,
    })!;
    expect(block.notes!.map((n) => n.beat)).toEqual([1, 5, 9, 13]);
  });

  it("stops at the section end instead of spilling past it", () => {
    const block = laneFigureBlock({
      lane: "hat",
      notes: [note(0, "closedHat", 70), note(3, "closedHat", 70)],
      lengthBeats: 4,
      durationBeats: 10,
    })!;
    expect(block.notes!.map((n) => n.beat)).toEqual([0, 3, 4, 7, 8]);
    expect(Math.max(...block.notes!.map((n) => n.beat))).toBeLessThan(10);
  });

  it("is null when there is nothing to write", () => {
    expect(laneFigureBlock({ lane: "kick", notes: [], lengthBeats: 4, durationBeats: 16 })).toBeNull();
    expect(laneFigureBlock({ lane: "kick", notes: [note(0, "kick", 100)], lengthBeats: 0, durationBeats: 16 })).toBeNull();
  });
});
