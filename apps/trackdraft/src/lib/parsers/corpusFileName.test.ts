import { describe, expect, it } from "vitest";
import { parseCorpusFileName } from "./corpusFileName";

describe("parseCorpusFileName", () => {
  it("splits a CoCoPops name into artist, title and year", () => {
    expect(parseCorpusFileName("ABBA_DancingQueen_1976")).toEqual({
      artist: "ABBA",
      title: "Dancing Queen",
      year: 1976,
    });
    expect(parseCorpusFileName("BigJoeTurner_ShakeRattleAndRoll_1954")).toEqual({
      artist: "Big Joe Turner",
      title: "Shake Rattle And Roll",
      year: 1954,
    });
  });

  it("keeps multi-word titles together", () => {
    expect(parseCorpusFileName("AlGreen_LetsStayTogether_Part2_1972")).toEqual({
      artist: "Al Green",
      title: "Lets Stay Together Part 2",
      year: 1972,
    });
  });

  it("leaves ordinary file names alone", () => {
    for (const name of ["My Song", "Track_01", "Piano Sonata no. 14 in C minor", "a_b_c"]) {
      expect(parseCorpusFileName(name)).toBeNull();
    }
  });

  it("requires at least artist, title and year", () => {
    expect(parseCorpusFileName("ABBA_DancingQueen")).toBeNull();
  });

  it("does not treat a four-digit number mid-name as the year", () => {
    expect(parseCorpusFileName("Artist_1984_Title")).toBeNull();
  });
});
