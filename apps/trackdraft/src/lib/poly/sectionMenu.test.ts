import { describe, expect, it } from "vitest";
import { sectionMenuState } from "./sectionMenu";

const base = {
  startBeat: 16,
  bars: 8,
  beatsPerBar: 4,
  playheadBeat: 32,
  hasNext: true,
  parked: false,
};

describe("sectionMenuState", () => {
  it("cuts at the bar the playhead is in", () => {
    // 4 bars past the section start, so the cut lands on bar 4.
    const state = sectionMenuState(base);
    expect(state.canSplit).toBe(true);
    expect(state.splitBar).toBe(4);
    expect(state.splitHint).toBe("bar 4");
  });

  it("will not cut at the section's first bar", () => {
    const state = sectionMenuState({ ...base, playheadBeat: 16 });
    expect(state.canSplit).toBe(false);
    expect(state.splitBar).toBe(0);
    expect(state.splitHint).toBe("playhead first");
  });

  it("will not cut before the section", () => {
    const state = sectionMenuState({ ...base, playheadBeat: 2 });
    expect(state.canSplit).toBe(false);
    expect(state.splitBar).toBe(0);
    expect(state.splitHint).toBe("playhead first");
  });

  it("will not cut past the section, and says so", () => {
    const state = sectionMenuState({ ...base, playheadBeat: 16 + 8 * 4 + 9 });
    expect(state.canSplit).toBe(false);
    expect(state.splitBar).toBe(0);
    expect(state.splitHint).toBe("past the end");
  });

  it("will not cut at the very end of the section either", () => {
    const state = sectionMenuState({ ...base, playheadBeat: 16 + 8 * 4 });
    expect(state.canSplit).toBe(false);
    expect(state.splitHint).toBe("past the end");
  });

  it("cuts inside a one-bar section impossible, but keeps the hint honest", () => {
    const state = sectionMenuState({
      ...base,
      bars: 1,
      playheadBeat: 20,
    });
    expect(state.canSplit).toBe(false);
    expect(state.splitHint).toBe("past the end");
  });

  it("treats a zero meter as nowhere to cut", () => {
    const state = sectionMenuState({ ...base, beatsPerBar: 0 });
    expect(state.canSplit).toBe(false);
    expect(state.splitHint).toBe("playhead first");
  });

  it("refuses to merge on the last section", () => {
    expect(sectionMenuState({ ...base, hasNext: false }).canMerge).toBe(false);
    expect(sectionMenuState(base).canMerge).toBe(true);
  });

  it("names the park row after where the section already is", () => {
    expect(sectionMenuState(base).parkLabel).toBe("Park on shelf");
    expect(sectionMenuState({ ...base, parked: true }).parkLabel).toBe(
      "Take off the shelf",
    );
  });
});
