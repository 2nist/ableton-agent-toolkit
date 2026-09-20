import type { DrumLaneId, GridBar } from "@drum/library";
import type { DrumAnalysisFile } from "./analysisFile";

/**
 * Cross-source analysis AVERAGING — the consensus pass of the drum
 * importer. Several transcriptions of the same song (audio stem, mix,
 * another take, a drum MIDI, Ableton's converter…) are noisy in different
 * ways, and the euclid translation only cares about the canonical pattern
 * — so average the evidence: per grid cell (bar × step × lane) count the
 * sources that contain a hit, keep the cell when enough agree, and store
 * the mean velocity. Single-source noise (spurious detector hits, one
 * transcription's half-bar quirk) falls out; what multiple independent
 * reads agree on IS the part.
 */

export interface MergeOptions {
  /**
   * Minimum number of sources that must contain a hit in a cell for it to
   * survive. Default 2 — "two independent transcriptions agree". Use 1 to
   * keep the union with averaged velocities (also keeps detail only one
   * source heard, e.g. fills unique to one performance).
   */
  minVotes?: number;
  /** Lanes to merge (default: the first source's `lanes`, else k/s/h). */
  lanes?: DrumLaneId[];
}

export interface MergeStats {
  /** Cells kept vs dropped (dropped = heard by >0 but < minVotes). */
  kept: number;
  dropped: number;
  perLane: Record<string, { kept: number; dropped: number }>;
  /** How many hits each source contributed (diagnostic). */
  sourceHits: number[];
}

export interface MergedAnalysis {
  analysis: DrumAnalysisFile;
  stats: MergeStats;
}

/** Average N analysis files into one consensus grid. */
export function mergeAnalyses(sources: DrumAnalysisFile[], opts: MergeOptions = {}): MergedAnalysis {
  if (sources.length === 0) throw new Error("mergeAnalyses: no sources given");
  const minVotes = opts.minVotes ?? 2;
  if (!Number.isInteger(minVotes) || minVotes < 1) {
    throw new Error("mergeAnalyses: minVotes must be a positive integer");
  }
  const stepsPerBar = sources[0].stepsPerBar;
  for (const s of sources) {
    if (s.stepsPerBar !== stepsPerBar) {
      throw new Error("mergeAnalyses: sources disagree on stepsPerBar");
    }
  }
  const lanes = (opts.lanes ?? sources[0].lanes ?? ["kick", "snare", "hat"]) as DrumLaneId[];
  const barCount = Math.max(...sources.map((s) => s.bars.length));
  const perLane: MergeStats["perLane"] = {};
  const sourceHits = sources.map(() => 0);
  let kept = 0;
  let dropped = 0;
  const bars: GridBar[] = [];
  for (let b = 0; b < barCount; b++) {
    const barLanes: Record<string, number[]> = {};
    for (const lane of lanes) {
      perLane[lane] ??= { kept: 0, dropped: 0 };
      const row = new Array<number>(stepsPerBar).fill(0);
      for (let st = 0; st < stepsPerBar; st++) {
        let votes = 0;
        let sum = 0;
        sources.forEach((s, i) => {
          const v = s.bars[b]?.lanes?.[lane]?.[st] ?? 0;
          if (v > 0) {
            votes++;
            sum += v;
            sourceHits[i]++;
          }
        });
        if (votes >= minVotes) {
          row[st] = Math.max(1, Math.round(sum / votes));
          perLane[lane].kept++;
          kept++;
        } else if (votes > 0) {
          perLane[lane].dropped++;
          dropped++;
        }
      }
      barLanes[lane] = row;
    }
    bars.push({ lanes: barLanes } as GridBar);
  }
  const analysis: DrumAnalysisFile = {
    format: "trackdraft-drum-analysis",
    songId: sources[0].songId,
    songTitle: sources[0].songTitle,
    beatsPerBar: sources[0].beatsPerBar,
    stepsPerBar,
    bars,
    sections: sources[0].sections,
    lanes: sources[0].lanes,
  };
  return { analysis, stats: { kept, dropped, perLane, sourceHits } };
}
