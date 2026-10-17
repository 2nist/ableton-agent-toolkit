import { describe, expect, it } from "vitest";
import {
  anchoredScrollLeft,
  clampBarPx,
  fitBarPx,
  nextBarPx,
  scrollBarFromLeft,
  scrollLeftFromBar,
  SECTION_BAR_PX_STEPS,
  SONG_BAR_PX_STEPS,
} from "./timeMath";

describe("nextBarPx", () => {
  it("walks the ladder in both directions", () => {
    expect(nextBarPx(SONG_BAR_PX_STEPS, 10, 1)).toBe(14);
    expect(nextBarPx(SONG_BAR_PX_STEPS, 10, -1)).toBe(8);
  });

  it("stays at the ends instead of wrapping", () => {
    expect(nextBarPx(SONG_BAR_PX_STEPS, 80, 1)).toBe(80);
    expect(nextBarPx(SONG_BAR_PX_STEPS, 4, -1)).toBe(4);
  });

  it("uses the section ladder independently", () => {
    expect(nextBarPx(SECTION_BAR_PX_STEPS, 78, 1)).toBe(110);
    expect(nextBarPx(SECTION_BAR_PX_STEPS, 78, -1)).toBe(56);
  });
});

describe("clampBarPx", () => {
  it("keeps each depth inside its own range", () => {
    expect(clampBarPx("song", 1)).toBe(2);
    expect(clampBarPx("song", 999)).toBe(160);
    expect(clampBarPx("section", 1)).toBe(20);
    expect(clampBarPx("section", 9999)).toBe(400);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampBarPx("song", Number.NaN)).toBe(10);
    expect(clampBarPx("section", Number.POSITIVE_INFINITY)).toBe(78);
  });
});

describe("anchoredScrollLeft", () => {
  it("keeps the bar under the pointer fixed while zooming in", () => {
    // 100px scroll at 10px/bar → the viewport starts at bar 10.
    // Anchor 50px into the viewport → bar 15 under the pointer.
    // At 20px/bar, bar 15 must stay 50px from the left → scroll 250px.
    expect(anchoredScrollLeft(100, 50, 10, 20)).toBe(250);
  });

  it("keeps the bar fixed while zooming out", () => {
    expect(anchoredScrollLeft(250, 50, 20, 10)).toBe(100);
  });

  it("never returns a negative scroll", () => {
    expect(anchoredScrollLeft(0, 10, 10, 4)).toBe(0);
  });

  it("is a no-op for invalid scales", () => {
    expect(anchoredScrollLeft(120, 10, 0, 10)).toBe(120);
    expect(anchoredScrollLeft(120, 10, 10, 0)).toBe(120);
  });
});

describe("bar/scroll conversions", () => {
  it("round-trips at any scale", () => {
    expect(scrollBarFromLeft(780, 78)).toBe(10);
    expect(scrollLeftFromBar(10, 78)).toBe(780);
    expect(scrollBarFromLeft(120, 0)).toBe(0);
  });
});

describe("fitBarPx", () => {
  it("fits a song into the viewport, clamped", () => {
    expect(fitBarPx("song", 800, 80)).toBe(10);
    expect(fitBarPx("song", 800, 800)).toBe(2); // clamped at the minimum
    expect(fitBarPx("section", 800, 10)).toBe(80);
  });

  it("falls back to defaults for an empty viewport", () => {
    expect(fitBarPx("song", 0, 10)).toBe(10);
    expect(fitBarPx("section", 800, 0)).toBe(78);
  });
});
