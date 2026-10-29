import { describe, expect, it } from "vitest";
import {
  CORPUS_SOURCES,
  UNKNOWN_SOURCE,
  isRedistributable,
  restrictedSources,
  sourceByKey,
  sourceForSong,
} from "./sources";

describe("sourceForSong", () => {
  it("attributes by id prefix", () => {
    expect(sourceForSong("beatles-01-come-together").key).toBe("beatles");
    expect(sourceForSong("mcgill-20-75-willie-mitchell").key).toBe("mcgill");
    expect(sourceForSong("rock-04-something").key).toBe("rock");
    expect(sourceForSong("lalo-chezia-01_static_bloom").key).toBe("lalo-chezia");
    expect(sourceForSong("local-my-tune").key).toBe("local");
  });

  it("falls back to the directory name when the id says nothing", () => {
    expect(sourceForSong("song-with-no-prefix", "mcgill-catalog").key).toBe("mcgill");
    expect(sourceForSong("song-with-no-prefix", "rock-catalog").key).toBe("rock");
  });

  it("is case-insensitive", () => {
    expect(sourceForSong("BEATLES-01-HELP").key).toBe("beatles");
  });

  it("never guesses: an unrecognised song is unknown, not the nearest match", () => {
    expect(sourceForSong("mystery-song").key).toBe("unknown");
    expect(sourceForSong("").key).toBe("unknown");
    expect(sourceForSong(null).key).toBe("unknown");
    expect(UNKNOWN_SOURCE.redistributable).toBe(false);
  });

  it("prefers the longest prefix, so a future `rock-corpus-` beats `rock-`", () => {
    // Guards the reduce in sourceForSong: a shorter prefix must not shadow a
    // longer one that a later corpus introduces.
    const byPrefix = CORPUS_SOURCES.filter((s) => "rock-corpus-x".startsWith(s.idPrefix));
    const longest = byPrefix.reduce((best, current) =>
      current.idPrefix.length > best.idPrefix.length ? current : best,
    );
    expect(longest.idPrefix.length).toBeGreaterThanOrEqual(5);
  });
});

describe("licence policy", () => {
  it("only the locally-authored source is redistributable", () => {
    const shippable = CORPUS_SOURCES.filter(isRedistributable).map((source) => source.key);
    expect(shippable).toEqual(["local"]);
  });

  it("every corpus that exists in the repo is restricted", () => {
    expect(restrictedSources().map((source) => source.key)).toEqual([
      "beatles",
      "mcgill",
      "rock",
      "lalo-chezia",
    ]);
  });

  it("redistributable requires the cleared class, not just the flag", () => {
    expect(isRedistributable({ ...sourceByKey("beatles"), redistributable: true })).toBe(false);
    expect(isRedistributable({ ...sourceByKey("local"), redistributable: true })).toBe(true);
  });

  it("every source states a licence and a rebuild path", () => {
    for (const source of CORPUS_SOURCES) {
      expect(source.licenceNote.length, source.key).toBeGreaterThan(20);
      expect(source.rootEnv.length, source.key).toBeGreaterThan(0);
      expect(source.ingestScript.length, source.key).toBeGreaterThan(0);
    }
  });

  it("looks a source up by manifest key, falling back to unknown", () => {
    expect(sourceByKey("mcgill").key).toBe("mcgill");
    expect(sourceByKey("nope").key).toBe("unknown");
    expect(sourceByKey(undefined).key).toBe("unknown");
  });
});
