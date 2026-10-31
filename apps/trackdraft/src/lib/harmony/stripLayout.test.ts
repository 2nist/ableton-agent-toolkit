import { describe, expect, it } from "vitest";
import { stripLayout } from "./stripLayout";

const sections = [
  { id: "a", bars: 2 },
  { id: "b", bars: 8 },
];

describe("stripLayout", () => {
  it("gives every band the same px-per-bar", () => {
    const { bands, pxPerBar, totalBars } = stripLayout(sections, 800);
    expect(totalBars).toBe(10);
    expect(pxPerBar).toBe(80); // 800 / 10, inside the limits
    expect(bands.map((band) => band.widthPx)).toEqual([160, 640]);
  });

  it("places bands end to end, in song order", () => {
    const { bands, contentWidth } = stripLayout(sections, 800);
    expect(bands.map((band) => band.x)).toEqual([0, 160]);
    expect(contentWidth).toBe(800);
  });

  it("stops shrinking at the minimum, so a long selection scrolls instead of vanishing", () => {
    const { pxPerBar, contentWidth } = stripLayout(sections, 100);
    expect(pxPerBar).toBe(44);
    expect(contentWidth).toBe(440);
    expect(contentWidth).toBeGreaterThan(100);
  });

  it("stops stretching at the maximum, so three short sections don't become walls", () => {
    const { pxPerBar, contentWidth } = stripLayout(
      [
        { id: "a", bars: 1 },
        { id: "b", bars: 1 },
      ],
      4000,
    );
    expect(pxPerBar).toBe(140);
    expect(contentWidth).toBe(280);
  });

  it("treats a zero or fractional bar count as at least one whole bar", () => {
    const { bands } = stripLayout(
      [
        { id: "a", bars: 0 },
        { id: "b", bars: 2.4 },
      ],
      480,
    );
    expect(bands.map((band) => band.bars)).toEqual([1, 2]);
  });

  it("falls back to the minimum width when the container has not been measured", () => {
    const { pxPerBar, totalBars } = stripLayout(sections, 0);
    expect(pxPerBar).toBe(44);
    expect(totalBars).toBe(10);
  });

  it("handles an empty selection without dividing by zero", () => {
    const layout = stripLayout([], 800);
    expect(layout.bands).toEqual([]);
    expect(layout.totalBars).toBe(0);
    expect(Number.isFinite(layout.pxPerBar)).toBe(true);
  });
});
