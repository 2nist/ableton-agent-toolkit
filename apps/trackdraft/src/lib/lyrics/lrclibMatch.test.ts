import { describe, expect, it } from "vitest";
import { normalizeForMatch, pickLyricsMatch, scoreCandidate, searchQueries, titleSimilarity } from "./lrclibMatch";

const lyrics = { syncedLyrics: "[00:01.00] a line" };

describe("normalizeForMatch", () => {
  it("folds case, punctuation, brackets and accents", () => {
    expect(normalizeForMatch("  Hey, Jude!  ")).toBe("hey jude");
    expect(normalizeForMatch("Dancing Queen (Remastered 2017)")).toBe("dancing queen");
    expect(normalizeForMatch("Café del Mar")).toBe("cafe del mar");
    expect(normalizeForMatch("Beyoncé feat. Jay-Z")).toBe("beyonce");
  });

  it("treats an ampersand as 'and' and drops a leading 'the'", () => {
    expect(normalizeForMatch("Simon & Garfunkel")).toBe("simon and garfunkel");
    expect(normalizeForMatch("The Beatles")).toBe("beatles");
  });
});

describe("titleSimilarity", () => {
  it("scores an exact match as 1", () => {
    expect(titleSimilarity("Dancing Queen", "Dancing Queen")).toBe(1);
  });

  it("scores a remaster suffix as a match", () => {
    expect(titleSimilarity("Dancing Queen", "Dancing Queen (Remastered)")).toBeGreaterThan(0.9);
  });

  it("scores different songs low", () => {
    expect(titleSimilarity("Dancing Queen", "Killer Queen")).toBeLessThan(0.6);
    expect(titleSimilarity("Piano Sonata no. 14 in C minor", "Sonata")).toBeLessThan(0.9);
  });

  it("returns 0 when either side is empty", () => {
    expect(titleSimilarity("", "anything")).toBe(0);
  });
});

describe("pickLyricsMatch", () => {
  const query = { title: "Help", artist: "The Beatles", duration: 140 };

  it("accepts the record that matches title, artist and duration", () => {
    const candidate = { trackName: "Help", artistName: "The Beatles", duration: 139, ...lyrics };
    expect(pickLyricsMatch(query, [candidate])).toBe(candidate);
  });

  it("rejects a candidate whose title is a different song", () => {
    expect(
      pickLyricsMatch(query, [{ trackName: "Help Me", artistName: "The Beatles", duration: 140, ...lyrics }]),
    ).toBeNull();
  });

  it("rejects a same-title record by another artist", () => {
    expect(
      pickLyricsMatch(query, [{ trackName: "Help", artistName: "Some Cover Band", duration: 140, ...lyrics }]),
    ).toBeNull();
  });

  it("rejects a recording whose duration is far off", () => {
    expect(
      pickLyricsMatch(query, [{ trackName: "Help", artistName: "The Beatles", duration: 400, ...lyrics }]),
    ).toBeNull();
  });

  it("never attaches lyrics to an instrumental", () => {
    // The corpora are full of these: a good match, but there are no words.
    const instrumental = { trackName: "Help", artistName: "The Beatles", duration: 140, instrumental: true, ...lyrics };
    expect(pickLyricsMatch(query, [instrumental])).toBeNull();
  });

  it("rejects a record carrying no lyrics at all", () => {
    expect(pickLyricsMatch(query, [{ trackName: "Help", artistName: "The Beatles", duration: 140 }])).toBeNull();
  });

  it("prefers line-timed lyrics over plain text", () => {
    const plain = { trackName: "Help", artistName: "The Beatles", duration: 140, plainLyrics: "words" };
    const synced = { trackName: "Help", artistName: "The Beatles", duration: 140, ...lyrics };
    expect(pickLyricsMatch(query, [plain, synced])).toBe(synced);
  });

  it("picks the closest duration among otherwise equal candidates", () => {
    const close = { trackName: "Help", artistName: "The Beatles", duration: 141, ...lyrics };
    const further = { trackName: "Help", artistName: "The Beatles", duration: 150, ...lyrics };
    expect(pickLyricsMatch(query, [further, close])).toBe(close);
  });

  it("ignores the artist when the query's artist is unknown", () => {
    const candidate = { trackName: "Help", artistName: "Anyone", duration: 140, ...lyrics };
    expect(pickLyricsMatch({ title: "Help", artist: "Unknown Artist" }, [candidate])).toBe(candidate);
  });

  it("refuses to match a roman-numeral sonata to a pop song", () => {
    // The real failure this guards against: a Mozart import picking up lyrics.
    const candidate = { trackName: "Sonata", artistName: "Beethoven", duration: 600, ...lyrics };
    expect(pickLyricsMatch({ title: "Piano Sonata no. 14 in C minor" }, [candidate])).toBeNull();
  });
});

describe("scoreCandidate", () => {
  it("penalises a mismatched artist and a wrong duration", () => {
    const good = scoreCandidate({ title: "Help", artist: "The Beatles", duration: 140 }, {
      trackName: "Help", artistName: "The Beatles", duration: 140, ...lyrics,
    });
    const bad = scoreCandidate({ title: "Help", artist: "The Beatles", duration: 140 }, {
      trackName: "Help", artistName: "Nope", duration: 400, ...lyrics,
    });
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.artistAgrees).toBe(true);
    expect(bad.artistAgrees).toBe(false);
    expect(bad.durationAgrees).toBe(false);
  });
});

describe("searchQueries", () => {
  it("tries the fielded search first when an artist is known", () => {
    expect(searchQueries({ title: "Help", artist: "The Beatles" })).toEqual([
      { trackName: "Help", artistName: "The Beatles" },
      { trackName: "Help" },
    ]);
  });

  it("skips the artist term when it is unknown", () => {
    expect(searchQueries({ title: "Help", artist: "Unknown Artist" })).toEqual([{ trackName: "Help" }]);
  });

  it("strips bracketed asides from the search term", () => {
    expect(searchQueries({ title: "Help (Remastered 2009)" })).toEqual([{ trackName: "Help" }]);
  });
});
