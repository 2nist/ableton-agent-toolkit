import { describe, expect, it } from "vitest";
import {
  buildTransitionModel,
  functionalTension,
  tension,
  tensionCurve,
  tensionColor,
} from "../src/index.js";
import type { Degree } from "../src/index.js";

describe("functionalTension", () => {
  it("is lowest on the tonic and highest on the leading tone", () => {
    expect(functionalTension("I")).toBe(0);
    expect(functionalTension("vii°")).toBeGreaterThan(functionalTension("V"));
    expect(functionalTension("V")).toBeGreaterThan(functionalTension("IV"));
    expect(functionalTension("♭II")).toBeGreaterThan(functionalTension("I"));
  });
});

describe("tension (hybrid)", () => {
  it("falls back to functional-only when no model is given", () => {
    const t = tension(null, "I");
    expect(t.tension).toBe(0);
    expect(t.functional).toBe(0);
    expect(t.empirical).toBe(0);
  });

  it("a chord with scattered successors is tenser than one that always resolves to a single place", () => {
    const corpus: Degree[][] = [
      ["I", "V", "I"],
      ["I", "V", "I"],
      ["I", "V", "I"],
      ["I", "V", "I"],
      ["I", "IV", "V"],
      ["I", "IV", "ii"],
      ["I", "IV", "vi"],
      ["I", "IV", "iii"],
    ];
    const m = buildTransitionModel(corpus);
    const tV = tension(m, "V");
    const tIV = tension(m, "IV");
    expect(tIV.entropy).toBeGreaterThan(tV.entropy);
    expect(tIV.empirical).toBeGreaterThan(tV.empirical);
  });

  it("respects custom blend weights", () => {
    const m = buildTransitionModel([["I", "V", "I"]]);
    const pureFunctional = tension(m, "V", { weights: { functional: 1, empirical: 0 } });
    const pureEmpirical = tension(m, "V", { weights: { functional: 0, empirical: 1 } });
    // the blended `tension` collapses to the weighted source
    expect(pureFunctional.tension).toBe(pureFunctional.functional);
    expect(pureEmpirical.tension).toBe(pureEmpirical.empirical);
  });
});

describe("tensionCurve & color", () => {
  it("produces a monotone tension curve with tonic resolved", () => {
    const m = buildTransitionModel([["I", "V", "vi", "IV", "I"]]);
    const curve = tensionCurve(m, ["I", "V", "vi", "IV", "I"]);
    expect(curve).toHaveLength(5);
    expect(curve[0].tension).toBe(0); // tonic, fully resolved
    expect(curve[1].tension).toBeGreaterThan(curve[0].tension); // dominant
    expect(curve[4].tension).toBe(0); // returns home
  });

  it("maps tension to a blue->red diverging color", () => {
    const low = tensionColor(0);
    const high = tensionColor(1);
    expect(low.hue).toBeGreaterThan(high.hue); // 220 -> 0
    expect(high.hex.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
    expect(low.hue).toBeCloseTo(220);
    expect(high.hue).toBeCloseTo(0);
  });
});
