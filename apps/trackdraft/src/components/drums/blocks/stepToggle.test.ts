import { describe, expect, it } from "vitest";
import { stepToggleBlock } from "./stepToggle";
import { peakVelocityByStep } from "./hitsCache";
import { stepIndexOf } from "./meterGrid";
import { laneHitsFor } from "./hitsCache";
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

/** The first beat between 0 and `barBeats` whose 16th cell is empty in the
 *  snare lane of the resolved base groove. */
const freeStep = (barBeats: number): number => {
  const hits = laneHitsFor(section([]), undefined, 0).get("snare") ?? [];
  const occupied = new Set(hits.map((h) => stepIndexOf(h.beat, 0.25)));
  for (let beat = 0; beat < barBeats - 1e-9; beat += 0.25) {
    if (!occupied.has(stepIndexOf(beat, 0.25))) return beat;
  }
  throw new Error("every cell in the bar is occupied");
};

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
    // Find a cell the base groove genuinely leaves empty rather than hardcoding
    // one — the banks carry ghost notes and a 4-bar turnaround, so "beat 1.5
    // is always free" stopped being true.
    const free = freeStep(1);
    const next = toggle([], free);
    expect(next.notes).toHaveLength(1);
    expect(next.notes?.[0]).toMatchObject({ beat: 0, velocity: 100 });
    expect(next.startBeat).toBe(free);
    expect(next.endBeat).toBe(free + 0.25);
  });
});

/**
 * The quirk a user hit in the app: cells that don't respond, and cells that
 * change a neighbour.
 *
 * Cause was two different beat→cell mappings. The view drew with
 * `Math.round(beat / stepBeats)`; the toggle wrote a block over
 * `[beat, beat + stepBeats)`. A corpus hit at 0.69 under a quarter-note grid
 * was therefore DRAWN in cell 1 but lived inside cell 0's range — clicking
 * the cell you could see removed nothing, and rebuilding the block copied
 * the stray 0.69 into the next cell as an authored note.
 *
 * These tests pin the fix: one index convention (`stepIndexOf`, floor-based
 * with a small snap), and rebuilt notes snapped to the grid.
 */
describe("stepIndexOf — one convention for drawing and writing", () => {
  // Real onsets from a baked `standard` variant: the downbeat, a late 16th
  // ghost, and a backbeat played a few milliseconds early.
  it("maps a beat to the cell that starts at it", () => {
    expect(stepIndexOf(0, 1)).toBe(0);
    expect(stepIndexOf(0.0125, 1)).toBe(0);
    expect(stepIndexOf(1.0437, 1)).toBe(1);
  });

  it("does not round a late hit into the next cell", () => {
    // 0.69 is inside the cell that starts at 0, even though round() says 1.
    expect(stepIndexOf(0.6917, 1)).toBe(0);
    // At 16ths it has a cell of its own: 0.69 sits in [0.5, 0.75).
    expect(stepIndexOf(0.6917, 0.25)).toBe(2);
  });

  it("snaps a hit that is a hair early onto the beat it anticipates", () => {
    expect(stepIndexOf(2.9958, 1)).toBe(3);
    expect(stepIndexOf(0.9958, 1)).toBe(1);
  });
});

describe("peakVelocityByStep — only on-step hits light a cell", () => {
  it("draws corner cases where a drummer reads them", () => {
    const hits = [
      { beat: 0.0125, velocity: 21 },
      { beat: 0.6917, velocity: 20 },
      { beat: 2.9958, velocity: 80 },
    ];
    const { peak, offGrid } = peakVelocityByStep(hits, 1, 8);
    expect([...peak.keys()].sort((a, b) => a - b)).toEqual([0, 3]);
    // The 16th ghost is NOT folded into a neighbouring cell — it is drawn at
    // its true position, which is what makes every visible cell toggleable.
    expect(offGrid.map((h) => h.beat)).toEqual([0.6917]);
  });
});

describe("stepToggle — clearing the cell a corpus hit sits in", () => {
  /** No base groove: these tests are about authored notes only. */
  const bare = (blocks: DrumBlock[]): BlueprintSection =>
    ({
      id: "s-bare",
      name: "A",
      role: "verse",
      bars: 2,
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
      chords: [],
      velocity: 100,
      drumPattern: "none",
      drumBlocks: blocks,
    }) as unknown as BlueprintSection;

  it("adds exactly one note, at the cell's own beat", () => {
    const result = stepToggleBlock({
      section: bare([]),
      song: undefined,
      occurrenceIndex: 0,
      laneKey: "kick",
      beat: 2,
      stepSize: 1,
    });
    expect(result.block.notes ?? []).toHaveLength(1);
    expect((result.block.notes ?? [])[0]!.beat).toBe(0);
    expect(result.startBeat).toBe(2);
    expect(result.endBeat).toBe(3);
  });

  it("leaves an off-grid note in a neighbouring cell alone", () => {
    const blocks: DrumBlock[] = [
      {
        id: "b1",
        lane: "kick",
        startBeat: 0,
        endBeat: 4,
        mode: "steps",
        notes: [{ beat: 0.9958, voice: "kick", velocity: 90 }],
      },
    ];
    const result = stepToggleBlock({
      section: bare(blocks),
      song: undefined,
      occurrenceIndex: 0,
      laneKey: "kick",
      beat: 0,
      stepSize: 1,
    });
    // Toggling beat 0 must not delete the authored note at 0.9958.
    expect((result.block.notes ?? []).map((n) => n.beat)).toContain(0.9958);
  });
});
