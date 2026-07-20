import { describe, expect, it } from "vitest";
import { parseLrc, matchLyrics, attachLyricCounts } from "../src/lyricAlign.js";
import type { SectionToken } from "../src/types.js";

describe("parseLrc", () => {
  it("parses [mm:ss.xx] timestamped lines and skips blanks", () => {
    const lrc = "[00:15.07] Chiquitita, tell me what's wrong\n[00:20.17] \n[00:28.28] In your eyes";
    const lines = parseLrc(lrc);
    expect(lines).toEqual([
      { text: "Chiquitita, tell me what's wrong", startSec: 15.07 },
      { text: "In your eyes", startSec: 28.28 },
    ]);
  });
});

describe("matchLyrics", () => {
  const candidates = [
    { title: "chiquitita", artist: "abba abba", syncedLyrics: "x" },
    { title: "get ready", artist: "rare earth", syncedLyrics: "y" },
    { title: "get ready", artist: "temptations", syncedLyrics: "z" },
  ];

  it("matches on normalized title when unambiguous", () => {
    expect(matchLyrics("Chiquitita", "ABBA", candidates)?.syncedLyrics).toBe("x");
  });

  it("disambiguates same-title matches by artist", () => {
    expect(matchLyrics("Get Ready", "Rare Earth", candidates)?.syncedLyrics).toBe("y");
    expect(matchLyrics("Get Ready", "The Temptations", candidates)?.syncedLyrics).toBe("z");
  });

  it("returns null rather than a wrong guess when nothing matches", () => {
    expect(matchLyrics("Totally Different Song", "Nobody", candidates)).toBeNull();
    expect(matchLyrics("", "", candidates)).toBeNull();
  });
});

describe("attachLyricCounts", () => {
  it("counts lines landing inside each token's time window", () => {
    const tokens = [
      { role: "intro" as const, rawLabel: "Intro", startMs: 0, durationMs: 5000 },
      { role: "verse" as const, rawLabel: "Verse", startMs: 5000, durationMs: 10000 },
    ];
    const lines = [
      { text: "a", startSec: 1 },
      { text: "b", startSec: 6 },
      { text: "c", startSec: 8 },
    ];
    const result = attachLyricCounts(tokens, lines);
    expect(result[0].lyricLineCount).toBe(1);
    expect(result[1].lyricLineCount).toBe(2);
  });

  it("leaves tokens without timing untouched", () => {
    const tokens: SectionToken[] = [{ role: "verse", rawLabel: "Verse" }];
    expect(attachLyricCounts(tokens, [{ text: "a", startSec: 1 }])[0].lyricLineCount).toBeUndefined();
  });
});
