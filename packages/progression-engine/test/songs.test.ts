import { describe, expect, it } from "vitest";
import {
  decodeProgression,
  encodeProgression,
  findMatchingSongs,
  isSubsequence,
  type SongIndex,
} from "../src/index.js";

// Tiny index mirroring the real corpus shape: codes are single chars.
const index: SongIndex = {
  v: 3,
  names: ["Artist One - Song A", "Artist Two - Song B", "Artist Three - Song C", "Artist Four - Song D"],
  sections: [
    { n: 0, d: "akdakd" }, // I ♭VII IV I ♭VII IV
    { n: 1, d: "aefd" }, // I V vi IV
    { n: 2, d: "efda" }, // V vi IV I (rotation)
    { n: 3, d: "eab" }, // V ii iii (too short, no match for 4-chord)
  ],
};

describe("encodeProgression", () => {
  it("maps each degree to its single-char code", () => {
    expect(encodeProgression(["I", "V", "vi", "IV"])).toBe("aefd");
    expect(encodeProgression(["♭VII", "IV", "I"])).toBe("kda");
  });
  it("returns empty for unknown degrees", () => {
    expect(encodeProgression(["wat"])).toBe("");
  });
});

describe("findMatchingSongs", () => {
  it("finds sections containing the progression as a contiguous run", () => {
    const matches = findMatchingSongs(index, ["I", "V", "vi", "IV"]);
    expect(matches.map((m) => m.name)).toEqual(["Artist Two - Song B"]);
  });

  it("ranks tighter matches first", () => {
    // "I ♭VII IV" = "akd" is a contiguous run in section A (len 6) only
    const matches = findMatchingSongs(index, ["I", "♭VII", "IV"]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.name).toBe("Artist One - Song A");
    expect(matches[0]!.ratio).toBeCloseTo(3 / 6);
  });

  it("does not match rotations that are not contiguous", () => {
    // "vi IV I" is contiguous in Song C ("efda" -> "f d a" appears? no: e f d a, "fda" yes)
    const matches = findMatchingSongs(index, ["vi", "IV", "I"]);
    expect(matches.map((m) => m.name)).toEqual(["Artist Three - Song C"]);
  });

  it("dedupes by song name and caps results", () => {
    // "I V" = "ae": B (aefd) and C? efda -> "ef", no. Only B matches.
    const matches = findMatchingSongs(index, ["I", "V"], { maxResults: 5 });
    expect(matches.map((m) => m.name)).toEqual(["Artist Two - Song B"]);
  });

  it("returns [] for empty/unknown progressions", () => {
    expect(findMatchingSongs(index, [])).toEqual([]);
    expect(findMatchingSongs(index, ["wat"])).toEqual([]);
  });

  it("falls back to subsequence matches (passing chords between) marked partial", () => {
    // "I IV" = "ad". No contiguous "ad" in the index, but Song A "akdakd" has
    // a→(k)→d and Song C "efda" has a at the end (a after f,d → not in order).
    const matches = findMatchingSongs(index, ["I", "IV"]);
    expect(matches.some((m) => m.name === "Artist One - Song A" && m.partial)).toBe(true);
  });

  it("prefers strict contiguous matches and only adds partials to fill", () => {
    // "I V vi IV" = "aefd" matches B strictly; no partials needed (maxResults 1).
    const matches = findMatchingSongs(index, ["I", "V", "vi", "IV"], { maxResults: 1 });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.name).toBe("Artist Two - Song B");
    expect(matches[0]!.partial).toBeFalsy();
  });
});

describe("decodeProgression", () => {
  it("round-trips an encoded progression", () => {
    expect(decodeProgression(encodeProgression(["I", "V", "vi", "IV"]))).toEqual(["I", "V", "vi", "IV"]);
    expect(decodeProgression("akd")).toEqual(["I", "♭VII", "IV"]);
  });
  it("drops unknown chars", () => {
    expect(decodeProgression("a?e")).toEqual(["I", "V"]);
  });
});

describe("isSubsequence", () => {
  it("matches chords in order even with gaps", () => {
    expect(isSubsequence("ae", "akdae")).toBe(true);
    expect(isSubsequence("ae", "eab")).toBe(false); // order wrong
  });
  it("treats empty needle as a match and requires full order", () => {
    expect(isSubsequence("", "anything")).toBe(true);
    expect(isSubsequence("abcd", "aabbccd")).toBe(true);
  });
});
