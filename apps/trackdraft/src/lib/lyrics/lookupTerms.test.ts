import { describe, expect, it } from "vitest";
import { resolveLookupTerms } from "./lookupTerms";

const song = { title: "Respect", artist: "Aretha Franklin" };

describe("resolveLookupTerms", () => {
  it("falls back to the song's own title and artist when untouched", () => {
    const terms = resolveLookupTerms(song);
    expect(terms.title).toBe("Respect");
    expect(terms.artist).toBe("Aretha Franklin");
    expect(terms.needsArtist).toBe(false);
    expect(terms.songNeedsArtist).toBe(false);
  });

  it("uses what the user typed over the song's values", () => {
    const terms = resolveLookupTerms({ title: "Layla", artist: "Unknown" }, { title: "Respect", artist: "aretha franklin" });
    expect(terms.title).toBe("Respect");
    expect(terms.artist).toBe("aretha franklin");
    // The bug: the warning used to follow the SONG's artist, so it nagged
    // even though the search was fine.
    expect(terms.needsArtist).toBe(false);
  });

  it("warns only when the SEARCH has no artist", () => {
    const terms = resolveLookupTerms({ title: "Layla" });
    expect(terms.needsArtist).toBe(true);
    expect(terms.songNeedsArtist).toBe(true);
  });

  it("treats a placeholder artist as no artist", () => {
    for (const placeholder of ["", "   ", "Unknown", "unknown artist", "Various Artists"]) {
      const terms = resolveLookupTerms({ title: "Layla", artist: placeholder });
      expect(terms.needsArtist, placeholder).toBe(true);
      expect(terms.artist).toBeUndefined();
    }
  });

  it("lets the user clear a prefilled artist on purpose", () => {
    // `null` = untouched, `""` = deliberately empty. Without the distinction
    // a cleared field would snap back to the song's artist.
    const terms = resolveLookupTerms(song, { artist: "" });
    expect(terms.artist).toBeUndefined();
    expect(terms.needsArtist).toBe(true);
    expect(terms.songNeedsArtist).toBe(false);
  });

  it("offers to save an artist the song is missing", () => {
    const terms = resolveLookupTerms({ title: "Layla", artist: "Unknown" }, { artist: "Derek and the Dominos" });
    expect(terms.artist).toBe("Derek and the Dominos");
    expect(terms.canSaveArtist).toBe(true);
  });

  it("does not offer to save when the song already has that artist", () => {
    expect(resolveLookupTerms(song, { artist: "Aretha Franklin" }).canSaveArtist).toBe(false);
  });

  it("carries album and line as optional narrowing", () => {
    const terms = resolveLookupTerms(song, { album: " I Never Loved a Man ", line: "  r e s p e c t  " });
    expect(terms.album).toBe("I Never Loved a Man");
    expect(terms.line).toBe("r e s p e c t");
    expect(resolveLookupTerms(song).album).toBeUndefined();
    expect(resolveLookupTerms(song).line).toBeUndefined();
  });
});
