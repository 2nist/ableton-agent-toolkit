import { describe, expect, it } from "vitest";
import { LOD_THRESHOLDS, clockLabel, lodFor, stickyLodIndex } from "./lod";

describe("lodFor", () => {
  it("maps zoom to a named face", () => {
    expect(lodFor(0.1)).toBe("dot");
    expect(lodFor(0.3)).toBe("compact");
    expect(lodFor(0.5)).toBe("full");
    expect(lodFor(0.85)).toBe("full");
    expect(lodFor(2.5)).toBe("detail");
  });
});

describe("stickyLodIndex", () => {
  it("does not cross a boundary until the zoom is 8% past it", () => {
    // 0.25 is the dot → compact boundary.
    expect(stickyLodIndex(LOD_THRESHOLDS[0] + 0.005, 0)).toBe(0);
    expect(stickyLodIndex(LOD_THRESHOLDS[0] * 1.09, 0)).toBe(1);
  });

  it("needs the same margin coming back", () => {
    expect(stickyLodIndex(LOD_THRESHOLDS[0] - 0.005, 1)).toBe(1);
    expect(stickyLodIndex(LOD_THRESHOLDS[0] * 0.91, 1)).toBe(0);
  });

  it("never oscillates when parked on a threshold", () => {
    let index = 0;
    for (let i = 0; i < 10; i += 1) {
      index = stickyLodIndex(
        LOD_THRESHOLDS[0] + (i % 2 ? 0.002 : -0.002),
        index,
      );
    }
    expect(index).toBe(0);
  });

  it("jumps several tiers at once (fit-to-song)", () => {
    expect(stickyLodIndex(2, 0)).toBe(3);
    expect(stickyLodIndex(0.1, 3)).toBe(0);
  });
});

describe("clockLabel", () => {
  it("formats arrangement time", () => {
    expect(clockLabel(0)).toBe("0:00");
    expect(clockLabel(72)).toBe("1:12");
    expect(clockLabel(59.6)).toBe("1:00");
    expect(clockLabel(-5)).toBe("0:00");
  });
});
