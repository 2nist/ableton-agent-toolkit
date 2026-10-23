import { describe, expect, it } from "vitest";
import { parseChartFileName, parseCorpusFileName, prettifyStem } from "./corpusFileName";

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

describe("parseChartFileName", () => {
  it("takes a trailing performer credit as the artist", () => {
    expect(parseChartFileName("Montana - Frank Zappa")).toEqual({ title: "Montana", artist: "Frank Zappa" });
    expect(parseChartFileName("Little house I used to live in - Frank Zappa")).toEqual({
      title: "Little house I used to live in",
      artist: "Frank Zappa",
    });
  });

  it("keeps a dash that belongs to the title", () => {
    // "Part 2" is not a name shape, so the credit rule must not fire.
    expect(parseChartFileName("Any Way the Wind Blows - Part 2")).toEqual({
      title: "Any Way the Wind Blows - Part 2",
    });
  });

  it("splits camel case and kebab case titles", () => {
    expect(parseChartFileName("EchidnasArf(OfYou)")?.title).toBe("Echidnas Arf (Of You)");
    expect(parseChartFileName("DontEatTheYellowSnow")?.title).toBe("Dont Eat The Yellow Snow");
    expect(parseChartFileName("cheap-thrills")?.title).toBe("Cheap Thrills");
    expect(parseChartFileName("take-your-clothes-off-while-you-dance")?.title).toBe(
      "Take Your Clothes Off While You Dance",
    );
  });

  it("leaves an already-spaced title alone", () => {
    expect(prettifyStem("Piano Sonata no. 14 in C minor")).toBe("Piano Sonata no. 14 in C minor");
    expect(parseChartFileName("") ).toBeNull();
  });
});
