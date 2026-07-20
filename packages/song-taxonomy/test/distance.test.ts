import { describe, expect, it } from "vitest";
import { formDistance, similarity } from "../src/distance.js";

describe("formDistance", () => {
  it("is zero for identical skeletons, including two empties", () => {
    expect(formDistance(["verse", "chorus"], ["verse", "chorus"])).toBe(0);
    expect(formDistance([], [])).toBe(0);
  });

  it("scores strophic (verse only) as distinct from verse-chorus, at 0.5", () => {
    expect(formDistance(["verse"], ["verse", "chorus"])).toBeCloseTo(0.5, 5);
  });

  it("costs a verse<->chorus substitution more than a bridge<->solo one", () => {
    const verseChorus = formDistance(["verse"], ["chorus"]);
    const bridgeSolo = formDistance(["bridge"], ["solo"]);
    expect(verseChorus).toBeGreaterThan(bridgeSolo);
  });

  it("is symmetric", () => {
    const a = ["verse", "chorus", "bridge", "chorus"] as const;
    const b = ["verse", "pre_chorus", "chorus"] as const;
    expect(formDistance(a, b)).toBeCloseTo(formDistance(b, a), 10);
  });

  it("never returns NaN for empty-vs-nonempty", () => {
    expect(formDistance([], ["verse"])).toBe(1);
    expect(Number.isNaN(formDistance([], []))).toBe(false);
  });
});

describe("similarity", () => {
  it("is the complement of distance", () => {
    const a = ["verse", "chorus"] as const;
    const b = ["verse", "chorus", "bridge"] as const;
    expect(similarity(a, b)).toBeCloseTo(1 - formDistance(a, b), 10);
  });
});
