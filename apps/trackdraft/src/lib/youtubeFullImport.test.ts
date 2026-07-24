import { describe, it, expect } from "vitest";
import { parseChordName, chordMiniAppToBlueprintSong } from "./youtubeFullImport";
import type { ChordMiniAppResult, LrclibData } from "./youtubeFullImport";

// ---------------------------------------------------------------------------
// parseChordName
// ---------------------------------------------------------------------------

describe("parseChordName", () => {
  it("parses plain major chord", () => {
    expect(parseChordName("C")).toEqual({ root: "C", quality: "maj" });
  });

  it("parses minor chord with 'm' suffix", () => {
    expect(parseChordName("Am")).toEqual({ root: "A", quality: "min" });
  });

  it("parses minor chord with 'min' suffix", () => {
    expect(parseChordName("Emin")).toEqual({ root: "E", quality: "min" });
  });

  it("parses dominant 7th chord", () => {
    expect(parseChordName("G7")).toEqual({ root: "G", quality: "7" });
  });

  it("parses major 7th chord", () => {
    expect(parseChordName("Cmaj7")).toEqual({ root: "C", quality: "maj7" });
  });

  it("parses minor 7th chord", () => {
    expect(parseChordName("Dmin7")).toEqual({ root: "D", quality: "min7" });
  });

  it("parses minor 7 flat 5 chord", () => {
    expect(parseChordName("Bm7b5")).toEqual({ root: "B", quality: "m7b5" });
  });

  it("parses diminished chord", () => {
    expect(parseChordName("F#dim")).toEqual({ root: "F#", quality: "dim" });
  });

  it("parses augmented chord", () => {
    expect(parseChordName("Ebaug")).toEqual({ root: "Eb", quality: "aug" });
  });

  it("parses sus2 chord", () => {
    expect(parseChordName("Dsus2")).toEqual({ root: "D", quality: "sus2" });
  });

  it("parses sus4 chord", () => {
    expect(parseChordName("Gsus4")).toEqual({ root: "G", quality: "sus4" });
  });

  it("parses sharp root chord", () => {
    expect(parseChordName("C#m")).toEqual({ root: "C#", quality: "min" });
  });

  it("parses flat root chord", () => {
    expect(parseChordName("Bbmaj7")).toEqual({ root: "Bb", quality: "maj7" });
  });

  it("parses chord with mixed case", () => {
    expect(parseChordName("aM")).toEqual({ root: "A", quality: "min" });
  });

  it("returns null for invalid chord name", () => {
    expect(parseChordName("")).toBeNull();
    expect(parseChordName("X")).toBeNull();
    expect(parseChordName("H7")).toBeNull();
    expect(parseChordName("Cbogus")).toBeNull();
  });

  it("returns null for chord names with unmatched suffixes (e.g. 'C5', 'Cadd9')", () => {
    expect(parseChordName("C5")).toBeNull();
    expect(parseChordName("Cadd9")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// chordMiniAppToBlueprintSong — minimal input
// ---------------------------------------------------------------------------

describe("chordMiniAppToBlueprintSong", () => {
  const minimalAnalysis: ChordMiniAppResult = {
    key: "C",
    scale: "major",
    bpm: 120,
    chords: [
      { chord: "C", start_time: 0, duration: 2 },
      { chord: "Am", start_time: 2, duration: 2 },
      { chord: "F", start_time: 4, duration: 2 },
      { chord: "G7", start_time: 6, duration: 2 },
    ],
  };

  it("produces a valid BlueprintSong from minimal input", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test Song");

    expect(song.title).toBe("Test Song");
    expect(song.key).toBe("C");
    expect(song.scale).toBe("ionian");
    expect(song.bpm).toBe(120);
    expect(song.timeSignatureNumerator).toBe(4);
    expect(song.timeSignatureDenominator).toBe(4);
  });

  it("creates a single Full Song section when no segments are provided", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test");

    expect(song.sections.length).toBe(1);
    expect(song.sections[0].name).toBe("Full Song");
    expect(song.sections[0].role).toBe("verse");
  });

  it("populates chords with correct roots and qualities", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test");

    const chords = song.sections[0].chords;
    expect(chords.length).toBe(4);

    expect(chords[0].root).toBe("C");
    expect(chords[0].quality).toBe("maj");

    expect(chords[1].root).toBe("A");
    expect(chords[1].quality).toBe("min");

    expect(chords[2].root).toBe("F");
    expect(chords[2].quality).toBe("maj");

    expect(chords[3].root).toBe("G");
    expect(chords[3].quality).toBe("7");
  });

  it("converts chord durations from seconds to beats at 120 BPM", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test");
    const chords = song.sections[0].chords;

    // At 120 BPM: 60/120 = 0.5 sec/beat, so 2s = 4 beats
    expect(chords[0].beats).toBe(4);
  });

  it("creates arrangement entries matching sections", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test");

    expect(song.arrangement.length).toBe(song.sections.length);
    expect(song.arrangement[0].sectionId).toBe(song.sections[0].id);
    expect(song.arrangement[0].repeats).toBe(1);
  });

  it("sets provenance with warnings", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test");

    expect(song.provenance?.source).toBe("audio-extract");
    expect(song.provenance?.warnings).toBeDefined();
    expect(song.provenance!.warnings!.some((w) => w.includes("ChordMiniApp"))).toBe(true);
    expect(song.provenance!.warnings!.some((w) => w.includes("Key:"))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Key / Scale detection
  // -----------------------------------------------------------------------

  it('maps "minor" scale to "aeolian"', () => {
    const song = chordMiniAppToBlueprintSong({ ...minimalAnalysis, scale: "minor" }, "Test");
    expect(song.scale).toBe("aeolian");
  });

  it("defaults scale to ionian for unknown/missing scale", () => {
    const song = chordMiniAppToBlueprintSong({ ...minimalAnalysis, scale: "lydian" }, "Test");
    // "lydian" is not "minor" → stays ionian
    expect(song.scale).toBe("ionian");
  });

  it("uses the key from analysis", () => {
    const song = chordMiniAppToBlueprintSong({ ...minimalAnalysis, key: "Eb" }, "Test");
    expect(song.key).toBe("Eb");
  });

  it("defaults key to C when missing", () => {
    const { key, ...noKey } = minimalAnalysis;
    const song = chordMiniAppToBlueprintSong(noKey as ChordMiniAppResult, "Test");
    expect(song.key).toBe("C");
  });

  // -----------------------------------------------------------------------
  // Segments → sections
  // -----------------------------------------------------------------------

  it("creates sections from ChordMiniApp segments", () => {
    const withSegments: ChordMiniAppResult = {
      ...minimalAnalysis,
      chords: [
        { chord: "C", start_time: 0, duration: 2 },
        { chord: "Am", start_time: 2, duration: 2 },
        { chord: "F", start_time: 4, duration: 2 },
        { chord: "G7", start_time: 6, duration: 2 },
        { chord: "C", start_time: 8, duration: 2 },
        { chord: "Am", start_time: 10, duration: 2 },
        { chord: "F", start_time: 12, duration: 2 },
        { chord: "G7", start_time: 14, duration: 2 },
      ],
      segments: [
        { label: "verse", start_time: 0, end_time: 8 },
        { label: "chorus", start_time: 8, end_time: 16 },
      ],
    };

    const song = chordMiniAppToBlueprintSong(withSegments, "Test");

    expect(song.sections.length).toBe(2);
    expect(song.sections[0].role).toBe("verse");
    expect(song.sections[1].role).toBe("chorus");
  });

  it("assigns intro, outro, bridge, solo roles correctly from segment labels", () => {
    const withRoles: ChordMiniAppResult = {
      ...minimalAnalysis,
      chords: Array(12).fill(null).map((_, i) => ({ chord: "C", start_time: i * 2, duration: 2 })),
      segments: [
        { label: "intro", start_time: 0, end_time: 4 },
        { label: "verse", start_time: 4, end_time: 8 },
        { label: "chorus", start_time: 8, end_time: 12 },
        { label: "bridge", start_time: 12, end_time: 16 },
        { label: "solo", start_time: 16, end_time: 20 },
        { label: "outro", start_time: 20, end_time: 24 },
      ],
    };
    const song = chordMiniAppToBlueprintSong(withRoles, "Test");
    expect(song.sections[0].role).toBe("intro");
    expect(song.sections[1].role).toBe("verse");
    expect(song.sections[2].role).toBe("chorus");
    expect(song.sections[3].role).toBe("bridge");
    expect(song.sections[4].role).toBe("solo");
    expect(song.sections[5].role).toBe("outro");
  });

  it("maps pre_chorus and prechorus to verse role", () => {
    const withPre: ChordMiniAppResult = {
      ...minimalAnalysis,
      chords: Array(8).fill(null).map((_, i) => ({ chord: "C", start_time: i * 2, duration: 2 })),
      segments: [
        { label: "pre_chorus", start_time: 0, end_time: 8 },
        { label: "prechorus", start_time: 8, end_time: 16 },
      ],
    };
    const song = chordMiniAppToBlueprintSong(withPre, "Test");
    expect(song.sections[0].role).toBe("verse");
    expect(song.sections[1].role).toBe("verse");
  });

  // -----------------------------------------------------------------------
  // BPM edge cases
  // -----------------------------------------------------------------------

  it("handles zero BPM by defaulting to 120", () => {
    const song = chordMiniAppToBlueprintSong({ ...minimalAnalysis, bpm: 0 }, "Test");
    expect(song.bpm).toBe(120);
  });

  it("handles negative BPM by defaulting to 120", () => {
    const song = chordMiniAppToBlueprintSong({ ...minimalAnalysis, bpm: -60 }, "Test");
    expect(song.bpm).toBe(120);
  });

  it("accepts high BPM values", () => {
    const song = chordMiniAppToBlueprintSong({ ...minimalAnalysis, bpm: 240 }, "Test");
    expect(song.bpm).toBe(240);
    // At 240 BPM: 60/240 = 0.25 sec/beat, so 2s = 8 beats
    expect(song.sections[0].chords[0].beats).toBe(8);
  });

  // -----------------------------------------------------------------------
  // Empty / missing chords
  // -----------------------------------------------------------------------

  it("returns empty sections array when chords array is empty", () => {
    const song = chordMiniAppToBlueprintSong({ ...minimalAnalysis, chords: [] }, "Test");
    expect(song.sections.length).toBe(0);
    expect(song.arrangement.length).toBe(0);
  });

  it("handles missing chords array", () => {
    const { chords, ...noChords } = minimalAnalysis;
    const song = chordMiniAppToBlueprintSong(noChords as ChordMiniAppResult, "Test");
    expect(song.sections.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Unparseable chord names
  // -----------------------------------------------------------------------

  it("falls back to C maj for unparseable chord names", () => {
    const withBad: ChordMiniAppResult = {
      ...minimalAnalysis,
      chords: [{ chord: "??", start_time: 0, duration: 2 }],
    };
    const song = chordMiniAppToBlueprintSong(withBad, "Test");
    expect(song.sections[0].chords[0].root).toBe("C");
    expect(song.sections[0].chords[0].quality).toBe("maj");
  });

  // -----------------------------------------------------------------------
  // Time signature
  // -----------------------------------------------------------------------

  it("uses custom time signature from analysis", () => {
    const withTs: ChordMiniAppResult = {
      ...minimalAnalysis,
      time_signature: { numerator: 6, denominator: 8 },
    };
    const song = chordMiniAppToBlueprintSong(withTs, "Test");
    expect(song.timeSignatureNumerator).toBe(6);
    expect(song.timeSignatureDenominator).toBe(8);
  });

  it("defaults time signature to 4/4 when missing", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test");
    expect(song.timeSignatureNumerator).toBe(4);
    expect(song.timeSignatureDenominator).toBe(4);
  });

  // -----------------------------------------------------------------------
  // Artist
  // -----------------------------------------------------------------------

  it("sets artist when provided", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test", "Test Artist");
    expect(song.artist).toBe("Test Artist");
  });

  it("artist is undefined when not provided", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test");
    expect(song.artist).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // LRCLIB lyrics
  // -----------------------------------------------------------------------

  it("attaches synced lyrics to a single-section song", () => {
    const lrclib: LrclibData = {
      syncedLyrics: "[00:00.00]Hello\n[00:02.00]World\n",
      plainLyrics: "Hello\nWorld",
    };

    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test", undefined, lrclib);

    expect(song.sections[0].lyrics).toBe("Hello\nWorld");
    expect(song.sections[0].lyricsTimeline).toBeDefined();
    expect(song.sections[0].lyricsTimeline!.length).toBe(2);
    expect(song.sections[0].lyricsTimeline![0].text).toBe("Hello");
    expect(song.sections[0].lyricsTimeline![1].text).toBe("World");
  });

  it("uses plainLyrics as fallback when syncedLyrics has no timestamps", () => {
    const lrclib: LrclibData = {
      syncedLyrics: "[00:00.00]Line one\n[00:04.00]Line two\n",
    };

    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test", undefined, lrclib);
    // plainLyrics is undefined, so it falls back to timeline text join
    expect(song.sections[0].lyrics).toBe("Line one\nLine two");
  });

  it("does not attach lyrics when lrclibData is null", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test", undefined, null);
    expect(song.sections[0].lyrics).toBeUndefined();
  });

  it("does not attach lyrics when syncedLyrics is empty", () => {
    const lrclib: LrclibData = { syncedLyrics: "" };
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test", undefined, lrclib);
    expect(song.sections[0].lyrics).toBeUndefined();
  });

  it("distributes lyrics across multiple sections by beat range", () => {
    const withSegments: ChordMiniAppResult = {
      key: "C",
      scale: "major",
      bpm: 120,
      chords: Array(8).fill(null).map((_, i) => ({ chord: "C", start_time: i * 2, duration: 2 })),
      segments: [
        { label: "verse", start_time: 0, end_time: 8 },
        { label: "chorus", start_time: 8, end_time: 16 },
      ],
    };

    const lrclib: LrclibData = {
      // At 120 BPM, 1 beat = 0.5s, so:
      // 0.0s = beat 0, 1.0s = beat 2
      // Verse (0-8s) spans beats 0-16, Chorus (8-16s) spans beats 16-32
      syncedLyrics: [
        "[00:00.00]Verse line one",
        "[00:02.00]Verse line two",
        "[00:04.00]Verse line three",
        "[00:06.00]Verse line four",
        "[00:08.00]Chorus line one",
        "[00:10.00]Chorus line two",
        "[00:12.00]Chorus line three",
        "[00:14.00]Chorus line four",
      ].join("\n"),
    };

    const song = chordMiniAppToBlueprintSong(withSegments, "Test", undefined, lrclib);

    expect(song.sections.length).toBe(2);
    expect(song.sections[0].lyrics).toContain("Verse line one");
    expect(song.sections[0].lyrics).not.toContain("Chorus");
    expect(song.sections[1].lyrics).toContain("Chorus line one");
    expect(song.sections[1].lyrics).not.toContain("Verse");
  });

  // -----------------------------------------------------------------------
  // ID uniqueness
  // -----------------------------------------------------------------------

  it("generates unique IDs for each section and song", () => {
    const song = chordMiniAppToBlueprintSong(
      {
        ...minimalAnalysis,
        chords: Array(8).fill(null).map((_, i) => ({ chord: "C", start_time: i * 2, duration: 2 })),
        segments: [
          { label: "verse", start_time: 0, end_time: 8 },
          { label: "chorus", start_time: 8, end_time: 16 },
        ],
      },
      "Test",
    );

    expect(song.id).toBeTruthy();
    expect(song.sections[0].id).toBeTruthy();
    expect(song.sections[1].id).toBeTruthy();
    expect(song.sections[0].id).not.toBe(song.sections[1].id);

    // Chord IDs are unique
    const chordIds = new Set(song.sections.flatMap((s) => s.chords.map((c) => c.id)));
    const totalChords = song.sections.reduce((sum, s) => sum + s.chords.length, 0);
    expect(chordIds.size).toBe(totalChords);
  });

  // -----------------------------------------------------------------------
  // concept field
  // -----------------------------------------------------------------------

  it("summarizes chord and segment counts in concept field", () => {
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test");
    expect(song.concept).toContain("4 chords");
    expect(song.concept).toContain("0 segments");
  });

  it("notes synced lyrics in concept when present", () => {
    const lrclib: LrclibData = { syncedLyrics: "[00:00.00]Test\n" };
    const song = chordMiniAppToBlueprintSong(minimalAnalysis, "Test", undefined, lrclib);
    expect(song.concept).toContain("synced lyrics");
  });
});