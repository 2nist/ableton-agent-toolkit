/**
 * End-to-end probes: converter output through the REAL compiler and pipeline
 * (the gaps the converter's author flagged when `applyDrumBlocks`'s body and
 * the null-base guard were still unknown to them):
 *
 *   1. empty-notes `steps` blocks (the converter's clears / silent stretches)
 *      pass `applyDrumBlocks`'s valid filter and wipe their lane family.
 *   2. a "none" base + blocks compiles the import as the ONLY drums —
 *      `planSectionDrumNotes` matches a direct `applyDrumBlocks` pass, and
 *      adds nothing of its own (no crash, no fill).
 */
import { describe, expect, it } from "vitest";
import { gridToBlocks, type DrumGrid, type GridBar } from "../src/drumImport/gridToBlocks.js";
import { toSectionPatch } from "../src/drumImport/sectionPatch.js";
import { applyDrumBlocks, type ApplyDrumBlocksContext } from "../src/blocks.js";
import { planSectionDrumNotes, type SectionDrumInput, type TiledNote } from "../src/section.js";
import type { FillLibrary } from "../src/handoffs.js";

const v = (s: string, vel = 100): number[] => [...s].map((c) => (c === "x" ? vel : 0));
const verse: GridBar = { lanes: { kick: v("x.......x......."), snare: v("....x.......x..."), hat: v("x.x.x.x.x.x.x.x.") } };
const grid: DrumGrid = { beatsPerBar: 4, stepsPerBar: 16, bars: [verse, verse] };
const sections = [{ id: "s1", role: "verse", startBar: 0, bars: 2 }];
const EMPTY_FILLS: FillLibrary = { acoustic: {}, synth: {} };

describe("drumImport → applyDrumBlocks (real compiler)", () => {
  it("empty-notes clear blocks are NOT filtered: they wipe their lane family in range", () => {
    const [{ blocks }] = gridToBlocks(grid, sections);
    // A base groove with content in every lane — the converter's clears
    // (rim/cym/tom across the section) must erase those voices entirely.
    const base: TiledNote[] = [
      { beat: 0, pitch: 36, velocity: 100 },   // kick
      { beat: 1, pitch: 38, velocity: 100 },   // snare
      { beat: 2, pitch: 42, velocity: 100 },   // closed hat
      { beat: 0.5, pitch: 37, velocity: 80 },  // rim — wiped
      { beat: 1.5, pitch: 49, velocity: 80 },  // crash (cym family) — wiped
      { beat: 2.5, pitch: 41, velocity: 80 },  // tomLow — wiped
    ];
    const ctx: ApplyDrumBlocksContext = {
      durationBeats: 8, beatsPerBar: 4, velocityTarget: 100, gridBeats: 0.25, seed: "import",
    };
    const out = applyDrumBlocks(base, blocks, ctx);

    // the three unimported lanes are gone
    expect(out.some((n) => n.pitch === 37 || n.pitch === 49 || n.pitch === 41)).toBe(false);
    // snare backbeat = E(2,16) rot 4 → beats 1 and 3 per bar
    expect(out.filter((n) => n.pitch === 38).map((n) => n.beat)).toEqual([1, 3, 5, 7]);
    // hats = E(8,16) → 16 hits across 2 bars (all flat velocityTarget)
    expect(out.filter((n) => n.pitch === 42)).toHaveLength(16);
    // kick = E(2,16) → beats 0 and 2 per bar
    expect(out.filter((n) => n.pitch === 36).map((n) => n.beat)).toEqual([0, 2, 4, 6]);
  });

  it("a muted base + blocks compiles as the only drums (planSectionDrumNotes === direct pass)", () => {
    const imp = gridToBlocks(grid, sections)[0];
    const patch = toSectionPatch(imp);
    expect(patch.drumPattern).toBe("none");

    const inputs: SectionDrumInput[] = [{
      sectionId: "s1",
      occurrenceIndex: 0,
      variant: null, // drumPattern: "none"
      beatsPerBar: 4,
      blocks: patch.drumBlocks,
      durationBeats: 8,
      velocityTarget: 100,
      gridBeats: 0.25,
    }];
    const [plan] = planSectionDrumNotes(inputs, EMPTY_FILLS);

    const ctx: ApplyDrumBlocksContext = {
      durationBeats: 8, beatsPerBar: 4, velocityTarget: 100, gridBeats: 0.25, seed: "s1",
    };
    const direct = applyDrumBlocks([], patch.drumBlocks, ctx)
      .sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);

    expect(plan.notes).toEqual(direct);
    expect(plan.notes.length).toBeGreaterThan(0);
    // nothing automatic: no crash (49) added at the downbeat
    expect(plan.notes.some((n) => n.pitch === 49)).toBe(false);
  });
});
