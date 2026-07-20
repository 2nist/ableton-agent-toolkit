import { describe, expect, it } from "vitest";
import { parseLrc } from "./lrc.js";

describe("parseLrc", () => {
  it("parses real LRCLIB-shaped synced lyrics", () => {
    const lrc = "[00:00.15] Shoot me\n[00:04.30] Shoot me\n[00:12.50] Here come old flat-top";
    expect(parseLrc(lrc)).toEqual([
      { text: "Shoot me", startSec: 0.15 },
      { text: "Shoot me", startSec: 4.3 },
      { text: "Here come old flat-top", startSec: 12.5 },
    ]);
  });

  it("skips blank timestamped lines (common in LRC for instrumental gaps)", () => {
    expect(parseLrc("[00:00.00] Real line\n[00:05.00] \n[00:10.00]   ")).toEqual([
      { text: "Real line", startSec: 0 },
    ]);
  });

  it("ignores lines with no timestamp", () => {
    expect(parseLrc("not a timestamped line\n[00:01.00] Real line")).toEqual([
      { text: "Real line", startSec: 1 },
    ]);
  });

  it("handles minutes beyond single digits", () => {
    expect(parseLrc("[12:34.56] Late line")).toEqual([{ text: "Late line", startSec: 12 * 60 + 34.56 }]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseLrc("")).toEqual([]);
  });
});
