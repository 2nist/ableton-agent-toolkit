import { describe, expect, it } from "vitest";
import { parseAnalysisFile } from "./analysisFile";

const VALID = {
  stepsPerBar: 16,
  bars: [{ lanes: { kick: [100, 0, 0, 0], snare: [0, 0, 0, 0] } }],
  sections: [{ sectionId: "sec-0", startBar: 0, bars: 1 }],
};

describe("parseAnalysisFile — the analysis exchange boundary", () => {
  it("parses a minimal file and defaults beatsPerBar to 4", () => {
    const f = parseAnalysisFile(VALID);
    expect(f.beatsPerBar).toBe(4);
    expect(f.stepsPerBar).toBe(16);
    expect(f.bars).toHaveLength(1);
    expect(f.sections[0]).toEqual({ sectionId: "sec-0", sectionName: undefined, role: undefined, startBar: 0, bars: 1 });
  });

  it("passes through the optional contract fields", () => {
    const f = parseAnalysisFile({
      ...VALID,
      format: "trackdraft-drum-analysis",
      songId: "song-x",
      songTitle: "Song X",
      beatsPerBar: 4,
      lanes: ["kick", "snare", "hat"],
      fillEncoding: "motion",
      basePattern: "standard",
      junk: "dropped",
    });
    expect(f.songId).toBe("song-x");
    expect(f.lanes).toEqual(["kick", "snare", "hat"]);
    expect(f.fillEncoding).toBe("motion");
    expect(f.basePattern).toBe("standard");
    expect("junk" in f).toBe(false);
  });

  it("rejects wrong shapes with field-named messages", () => {
    expect(() => parseAnalysisFile(null)).toThrow(/expected a JSON object/);
    expect(() => parseAnalysisFile({ ...VALID, stepsPerBar: undefined })).toThrow(/stepsPerBar/);
    expect(() => parseAnalysisFile({ ...VALID, stepsPerBar: 0 })).toThrow(/stepsPerBar/);
    expect(() => parseAnalysisFile({ ...VALID, bars: [] })).toThrow(/bars/);
    expect(() => parseAnalysisFile({ ...VALID, bars: [{ lanes: { piano: [1] } }] })).toThrow(/not a lane/);
    expect(() => parseAnalysisFile({ ...VALID, bars: [{ lanes: { kick: "loud" } }] })).toThrow(/step velocities/);
    expect(() => parseAnalysisFile({ ...VALID, bars: [{ lanes: { kick: [1, -2] } }] })).toThrow(/negative/);
    expect(() => parseAnalysisFile({ ...VALID, sections: [] })).toThrow(/sections/);
    expect(() => parseAnalysisFile({ ...VALID, sections: [{ startBar: 0, bars: 1 }] })).toThrow(/sectionId/);
    expect(() => parseAnalysisFile({ ...VALID, sections: [{ sectionId: "s", startBar: -1, bars: 1 }] })).toThrow(/startBar/);
    expect(() => parseAnalysisFile({ ...VALID, sections: [{ sectionId: "s", startBar: 0, bars: 0 }] })).toThrow(/bars/);
    expect(() => parseAnalysisFile({ ...VALID, fillEncoding: "swing" })).toThrow(/fillEncoding/);
    expect(() => parseAnalysisFile({ ...VALID, basePattern: "funk" })).toThrow(/basePattern/);
    expect(() => parseAnalysisFile({ ...VALID, lanes: ["cowbell"] })).toThrow(/unknown lane/);
  });
});
