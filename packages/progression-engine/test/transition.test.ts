import { describe, expect, it } from "vitest";
import { buildTransitionModel, suggestNext, rankPaths } from "../src/index.js";
import type { Degree } from "../src/index.js";

const corpus: Degree[][] = [
  ["I", "V", "vi", "IV"],
  ["I", "V", "vi", "IV"],
  ["I", "IV", "V", "I"],
  ["vi", "IV", "I", "V"],
];

describe("buildTransitionModel", () => {
  const m = buildTransitionModel(corpus);

  it("counts first-order transitions and totals", () => {
    // I->V appears in seqs 1,2,4; I->IV in seq 3
    expect(m.firstOrder["I"]["V"]).toBe(3);
    expect(m.firstOrder["I"]["IV"]).toBe(1);
    expect(m.totals["I"]).toBe(4);
    expect(m.sequenceCount).toBe(4);
    expect(m.chordCount).toBe(16);
  });

  it("counts second-order transitions", () => {
    expect(m.secondOrder["I V"]["vi"]).toBe(2);
    expect(m.secondOrder["IV I"]["V"]).toBe(1);
  });

  it("counts starts and ends", () => {
    expect(m.starts["I"]).toBe(3);
    expect(m.starts["vi"]).toBe(1);
    expect(m.ends["IV"]).toBe(2);
    expect(m.ends["I"]).toBe(1);
    expect(m.ends["V"]).toBe(1);
  });

  it("honors minCount filtering", () => {
    // totals: I=4, V=3, vi=3, IV=2 -> with minCount 3 only IV drops. vi's only
    // target (IV) is dropped, so vi is pruned too; it remains a V target.
    const filtered = buildTransitionModel(corpus, { minCount: 3 });
    expect(filtered.degrees.sort()).toEqual(["I", "V"]);
    expect(filtered.firstOrder["I"]).toEqual({ V: 3 });
    expect(filtered.firstOrder["V"]).toEqual({ vi: 2, I: 1 });
    expect(filtered.firstOrder["vi"]).toBeUndefined();
    expect(filtered.firstOrder["IV"]).toBeUndefined();
  });
});

describe("suggestNext", () => {
  const m = buildTransitionModel(corpus);

  it("ranks next chords by frequency from first-order context", () => {
    const s = suggestNext(m, ["I"]);
    expect(s[0].degree).toBe("V");
    expect(s[0].probability).toBeCloseTo(3 / 4);
    expect(s[0].context).toBe("first");
  });

  it("uses second-order context when available", () => {
    const s = suggestNext(m, ["I", "V"]);
    expect(s[0].degree).toBe("vi");
    expect(s[0].context).toBe("second");
  });

  it("falls back to first-order when the second-order key is absent", () => {
    const s = suggestNext(m, ["I", "vi"]);
    expect(s[0].degree).toBe("IV");
    expect(s[0].context).toBe("first");
  });

  it("returns [] for an unknown degree", () => {
    expect(suggestNext(m, ["iii"])).toEqual([]);
  });

  it("empty tail returns start-ranked suggestions", () => {
    const s = suggestNext(m, []);
    expect(s[0].degree).toBe("I");
    expect(s[0].context).toBe("start");
  });

  it("applies a self-loop penalty so repeats rank lower", () => {
    const droney: Degree[][] = [
      ["I", "I"],
      ["I", "I"],
      ["I", "V"],
    ];
    const dm = buildTransitionModel(droney);
    // firstOrder["I"] = { I: 2, V: 1 } -> raw top is the self-loop I
    expect(suggestNext(dm, ["I"])[0].degree).toBe("I");
    // with a penalty, I's weighted count (2*0.2=0.4) drops below V's 1
    const penalized = suggestNext(dm, ["I"], { selfLoopPenalty: 0.2 });
    expect(penalized[0].degree).toBe("V");
    expect(penalized[0].probability).toBeCloseTo(1 / 1.4);
  });

  it("passes the self-loop penalty through rankPaths", () => {
    const droney: Degree[][] = [
      ["I", "I", "I", "I"],
      ["I", "I", "I", "I"],
      ["I", "V", "vi", "IV"],
    ];
    const dm = buildTransitionModel(droney);
    const raw = rankPaths(dm, ["I"], 4, 3);
    const penalized = rankPaths(dm, ["I"], 4, 3, { selfLoopPenalty: 0.1 });
    // raw top is the all-I drone; with a penalty the Axis path should surface
    expect(raw[0].degrees).toEqual(["I", "I", "I", "I"]);
    expect(penalized[0].degrees).toEqual(["I", "V", "vi", "IV"]);
  });
});

describe("rankPaths", () => {
  const m = buildTransitionModel(corpus);

  it("ranks top-k continuations by likelihood", () => {
    const paths = rankPaths(m, ["I"], 4, 3);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].degrees).toEqual(["I", "V", "vi", "IV"]);
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i].logProb).toBeLessThanOrEqual(paths[i - 1].logProb);
    }
  });

  it("preserves a longer start context", () => {
    const paths = rankPaths(m, ["vi", "IV"], 4, 2);
    expect(paths[0].degrees.slice(0, 2)).toEqual(["vi", "IV"]);
  });

  it("handles a dead-end tail (no continuations)", () => {
    const paths = rankPaths(m, ["iii"], 3, 2);
    expect(paths.length).toBe(0);
  });
});
