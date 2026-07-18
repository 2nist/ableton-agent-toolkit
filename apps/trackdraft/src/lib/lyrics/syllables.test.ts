import { describe, it, expect } from "vitest";
import { countLineSyllables } from "./syllables";

describe("countLineSyllables", () => {
  it("counts a simple line", () => {
    // "Two fish swimming in a cosmic bowl" -- from Twin Fish's actual lyrics
    expect(countLineSyllables("Two fish swimming in a cosmic bowl")).toBeGreaterThanOrEqual(8);
  });

  it("returns 0 for an empty line", () => {
    expect(countLineSyllables("")).toBe(0);
    expect(countLineSyllables("   ")).toBe(0);
  });

  it("sums per-word counts", () => {
    expect(countLineSyllables("hi")).toBe(1);
    expect(countLineSyllables("hi hi")).toBe(2);
  });
});
