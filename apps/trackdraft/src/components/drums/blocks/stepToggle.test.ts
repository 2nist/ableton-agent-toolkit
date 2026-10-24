import { describe, expect, it } from "vitest";
import { stepToggleBlock } from "./stepToggle";
import type { BlueprintSection, DrumBlock } from "../../../types/blueprint";

/** A 4/4, two-bar section with whatever blocks the test hands it. */
const section = (blocks: DrumBlock[]): BlueprintSection =>
  ({
    id: "s1",
    name: "A",
    role: "verse",
    bars: 2,
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    chords: [],
    velocity: 100,
    drumBlocks: blocks,
  }) as unknown as BlueprintSection;

const stepsBlock = (notes: DrumBlock["notes"]): DrumBlock => ({
  id: "b1",
  lane: "snare",
  startBeat: 0,
  endBeat: 4,
  mode: "steps",
  notes,
});

const toggle = (blocks: DrumBlock[], beat: number) =>
  stepToggleBlock({
    section: section(blocks),
    song: undefined,
    occurrenceIndex: 0,
    laneKey: "snare",
    beat,
    stepSize: 0.25,
  }).block;

describe("stepToggle — toggling one step must not flatten the block", () => {
  it("keeps every other note's step parameters", () => {
    const next = toggle(
      [
        stepsBlock([
          { beat: 1, voice: "snare", velocity: 100, ratchet: 2, durBeats: 0.5 },
          { beat: 2, voice: "snare", velocity: 90, flam: true, offsetBeats: 0.07, prob: 0.5 },
        ]),
      ],
      3, // a bar-3 step with no hit — the add gesture
    );
    const kept = next.notes ?? [];
    expect(kept.some((n) => n.ratchet === 2 && n.durBeats === 0.5)).toBe(true);
    expect(kept.some((n) => n.flam && n.offsetBeats === 0.07 && n.prob === 0.5)).toBe(true);
    // and the step that was clicked arrived as a plain, single note
    const added = kept.filter((n) => Math.abs(n.beat - 3) < 1e-9);
    expect(added).toHaveLength(1);
    expect(added[0].ratchet).toBeUndefined();
  });

  it("removes only the toggled step's notes", () => {
    const next = toggle(
      [
        stepsBlock([
          { beat: 1, voice: "snare", velocity: 100, flam: true },
          { beat: 2, voice: "snare", velocity: 90, ratchet: 3 },
        ]),
      ],
      1, // remove the flam step
    );
    const kept = next.notes ?? [];
    expect(kept.some((n) => n.flam)).toBe(false);
    expect(kept.some((n) => n.ratchet === 3)).toBe(true);
    expect(kept).toHaveLength(1);
  });

  it("still builds a plain block from the base groove when nothing is authored", () => {
    const next = toggle([], 1);
    expect(next.notes).toHaveLength(1);
    expect(next.notes?.[0]).toMatchObject({ beat: 0, velocity: 100 });
    expect(next.startBeat).toBe(1);
    expect(next.endBeat).toBe(1.25);
  });
});
