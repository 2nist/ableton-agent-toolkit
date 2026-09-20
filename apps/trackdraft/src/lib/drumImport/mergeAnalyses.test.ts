import { describe, expect, it } from "vitest";
import { mergeAnalyses } from "./mergeAnalyses";
import type { DrumAnalysisFile } from "./analysisFile";

/** Two bars; hits as [lane, bar, step, velocity]. */
function makeFile(hits: Array<[string, number, number, number]>, songId = "test-song"): DrumAnalysisFile {
  const bars = Array.from({ length: 2 }, () => ({
    lanes: {
      kick: new Array<number>(16).fill(0),
      snare: new Array<number>(16).fill(0),
      hat: new Array<number>(16).fill(0),
    },
  }));
  for (const [lane, bar, step, vel] of hits) (bars[bar].lanes as Record<string, number[]>)[lane][step] = vel;
  return {
    beatsPerBar: 4,
    stepsPerBar: 16,
    bars,
    sections: [{ sectionId: "s1", startBar: 0, bars: 2 }],
    lanes: ["kick", "snare", "hat"],
    songId,
  };
}

describe("drumImport — mergeAnalyses consensus", () => {
  it("keeps agreeing cells at mean velocity, drops single-source cells at minVotes 2", () => {
    const a = makeFile([["kick", 0, 0, 100], ["kick", 0, 2, 90], ["snare", 0, 4, 80]]);
    const b = makeFile([["kick", 0, 0, 60], ["snare", 0, 4, 100], ["hat", 0, 0, 60]]);
    const { analysis, stats } = mergeAnalyses([a, b]);
    const bar = analysis.bars[0]!;
    expect(bar.lanes.kick![0]).toBe(80); // (100+60)/2
    expect(bar.lanes.kick![2]).toBe(0); // a-only → dropped
    expect(bar.lanes.hat![0]).toBe(0); // b-only → dropped
    expect(bar.lanes.snare![4]).toBe(90); // (80+100)/2
    expect(stats.kept).toBe(2);
    expect(stats.dropped).toBe(2);
    expect(stats.perLane.kick).toEqual({ kept: 1, dropped: 1 });
  });

  it("minVotes 1 keeps the union with averaged velocities", () => {
    const a = makeFile([["kick", 0, 0, 100], ["kick", 0, 2, 90]]);
    const b = makeFile([["kick", 0, 0, 60], ["hat", 0, 0, 60]]);
    const { analysis, stats } = mergeAnalyses([a, b], { minVotes: 1 });
    const bar = analysis.bars[0]!;
    expect(bar.lanes.kick![0]).toBe(80);
    expect(bar.lanes.kick![2]).toBe(90);
    expect(bar.lanes.hat![0]).toBe(60);
    expect(stats.dropped).toBe(0);
    expect(stats.sourceHits).toEqual([2, 2]);
  });

  it("rejects sources with mismatched grids", () => {
    const a = makeFile([["kick", 0, 0, 100]]);
    const b = { ...makeFile([]), stepsPerBar: 12 };
    expect(() => mergeAnalyses([a, b])).toThrow(/stepsPerBar/);
  });
});
