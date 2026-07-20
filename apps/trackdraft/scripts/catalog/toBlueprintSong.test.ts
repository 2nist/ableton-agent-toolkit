import { describe, expect, it } from "vitest";
import { catalogSongToBlueprintSong } from "./toBlueprintSong.js";
import type { RawCatalogSong } from "./types.js";

const twoSectionSong: RawCatalogSong = {
  title: "Test Song",
  artist: "Test Artist",
  key: "C",
  mode: "ionian",
  bpm: 120, // 2 beats/sec
  sourceFormat: "beatles-jcrd",
  warnings: [],
  sections: [
    {
      name: "Verse",
      startSec: 0,
      endSec: 8, // 16 beats = 4 bars at 4/4
      chords: [
        { startSec: 0, endSec: 4, root: "C", quality: "maj" }, // I
        { startSec: 4, endSec: 8, root: "G", quality: "maj" }, // V
      ],
    },
    {
      name: "Chorus",
      startSec: 8,
      endSec: 16, // next 16 beats
      chords: [{ startSec: 8, endSec: 16, root: "A", quality: "min" }], // vi
    },
  ],
};

describe("catalogSongToBlueprintSong", () => {
  it("converts real metadata straight through", () => {
    const song = catalogSongToBlueprintSong({ id: "test-1", raw: twoSectionSong });
    expect(song.id).toBe("test-1");
    expect(song.title).toBe("Test Song");
    expect(song.artist).toBe("Test Artist");
    expect(song.key).toBe("C");
    expect(song.scale).toBe("ionian");
    expect(song.bpm).toBe(120);
    expect(song.provenance?.source).toBe("catalog-lookup");
  });

  it("converts seconds to beats using the real tempo", () => {
    const song = catalogSongToBlueprintSong({ id: "test-1", raw: twoSectionSong });
    expect(song.sections[0].bars).toBe(4); // 8 sec * 2 beats/sec = 16 beats = 4 bars
    expect(song.sections[0].chords[0].beats).toBe(8); // 4 sec * 2 beats/sec
  });

  it("computes correct Roman numerals relative to the song's own key", () => {
    const song = catalogSongToBlueprintSong({ id: "test-1", raw: twoSectionSong });
    const [c, g] = song.sections[0].chords;
    expect(c.romanNumeral).toBe("I");
    expect(g.romanNumeral).toBe("V");
    expect(song.sections[1].chords[0].romanNumeral).toBe("vi"); // lowercase: minor quality
  });

  it("buckets LRC lyric lines into the section whose beat range contains them", () => {
    const song = catalogSongToBlueprintSong({
      id: "test-1",
      raw: twoSectionSong,
      hasSyncedLyrics: true,
      lyricLines: [
        { text: "verse line one", startSec: 1 }, // beat 2 -> Verse (0-16)
        { text: "chorus line one", startSec: 9 }, // beat 18 -> Chorus (16-32)
      ],
    });
    expect(song.sections[0].lyricsTimeline).toEqual([{ text: "verse line one", startBeat: 2 }]);
    expect(song.sections[1].lyricsTimeline).toEqual([{ text: "chorus line one", startBeat: 18 }]);
    expect(song.sections[0].lyrics).toBe("verse line one");
  });

  it("warns instead of guessing when no LRCLIB match exists", () => {
    const song = catalogSongToBlueprintSong({ id: "test-1", raw: twoSectionSong, hasSyncedLyrics: false });
    expect(song.provenance?.warnings?.some((w) => w.includes("No LRCLIB match"))).toBe(true);
    expect(song.sections.every((s) => s.lyricsTimeline === undefined)).toBe(true);
  });

  it("warns when only plain (unsynced) lyrics were available", () => {
    const song = catalogSongToBlueprintSong({ id: "test-1", raw: twoSectionSong, hasSyncedLyrics: false, lyricLines: [] });
    expect(song.provenance?.warnings?.some((w) => w.includes("plain lyrics only"))).toBe(true);
  });

  it("defaults bpm and key with honest warnings when the source has neither", () => {
    const bare: RawCatalogSong = { title: "Bare", sections: [], sourceFormat: "beatles-jcrd", warnings: [] };
    const song = catalogSongToBlueprintSong({ id: "test-1", raw: bare });
    expect(song.bpm).toBe(120);
    expect(song.key).toBe("C");
    expect(song.provenance?.warnings?.some((w) => w.includes("defaulted to 120 BPM"))).toBe(true);
    expect(song.provenance?.warnings?.some((w) => w.includes("defaulted to C"))).toBe(true);
  });

  it("cleans a raw CD/track-number-prefixed title for display", () => {
    const song = catalogSongToBlueprintSong({
      id: "test-1",
      raw: { ...twoSectionSong, title: "CD1 - 03 - Glass_Onion" },
    });
    expect(song.title).toBe("Glass Onion");
  });

  it("builds a trivial 1:1 arrangement matching section order", () => {
    const song = catalogSongToBlueprintSong({ id: "test-1", raw: twoSectionSong });
    expect(song.arrangement).toEqual([
      { sectionName: "Verse", repeats: 1 },
      { sectionName: "Chorus", repeats: 1 },
    ]);
  });
});
