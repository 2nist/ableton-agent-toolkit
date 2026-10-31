import { describe, expect, it } from "vitest";
import { attachLyrics } from "./attachLyrics";
import { createEmptySong, type BlueprintSong } from "../../types/blueprint";

/** Two 4/4 bars, then two 7/8 bars, then one 4/4 bar.
 *  Spans: 0–8 beats, 8–15 beats, 15–19 beats. */
function mixedMeterSong(): BlueprintSong {
  const song = createEmptySong("Meter");
  song.bpm = 120;
  song.sections = [
    {
      id: "a",
      name: "Verse",
      role: "verse",
      bars: 2,
      chords: [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
    },
    {
      id: "b",
      name: "Odd",
      role: "chorus",
      bars: 2,
      chords: [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 7,
      timeSignatureDenPower: 3,
    },
    {
      id: "c",
      name: "Outro",
      role: "outro",
      bars: 1,
      chords: [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
    },
  ];
  song.arrangement = song.sections.map((section) => ({ sectionId: section.id, repeats: 1 }));
  return song;
}

/** LRC at 120 bpm: one beat = 0.5 s, so `beat * 0.5` seconds. */
function lrcAt(entries: { beat: number; text: string }[]): string {
  return entries
    .map(({ beat, text }) => {
      const seconds = beat * 0.5;
      const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
      const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
      const cs = String(Math.round((seconds % 1) * 100)).padStart(2, "0");
      return `[${mm}:${ss}.${cs}]${text}`;
    })
    .join("\n");
}

describe("attachLyrics — placing synced lines", () => {
  it("measures each section in its own meter", () => {
    // Beats 1 (verse), 10 (odd: 8–15), 16 (outro: 15–19). The old
    // `bars × numerator` maths made the 7/8 section 14 beats long, which
    // swallowed the outro line.
    const song = mixedMeterSong();
    const result = attachLyrics(song, {
      syncedLyrics: lrcAt([
        { beat: 1, text: "verse line" },
        { beat: 10, text: "odd line" },
        { beat: 16, text: "outro line" },
      ]),
    });

    expect(result.lines).toBe(2);
    expect(result.sections).toBe(2); // verse + odd; outro is instrumental
    const byId = new Map(result.song.sections.map((section) => [section.id, section]));
    expect(byId.get("a")!.lyrics).toBe("verse line");
    expect(byId.get("b")!.lyrics).toBe("odd line");
    // An instrumental role never takes words — the outro line has nowhere to
    // go, and it is counted as homeless rather than vanishing.
    expect(byId.get("c")!.lyrics).toBeUndefined();
    expect(result.unplaced).toBe(1);
  });

  it("rebases a section's timeline to its own start", () => {
    const result = attachLyrics(mixedMeterSong(), {
      syncedLyrics: lrcAt([
        { beat: 9, text: "one" },
        { beat: 13, text: "two" },
      ]),
    });
    const odd = result.song.sections.find((section) => section.id === "b")!;
    expect(odd.lyricsTimeline?.map((line) => line.text)).toEqual(["one", "two"]);
    // Section b starts at beat 8, so the first line sits 1 beat in.
    expect(odd.lyricsTimeline?.[0]?.startBeat).toBeCloseTo(1, 1);
    expect(odd.lyricsTimeline?.[1]?.startBeat).toBeCloseTo(5, 1);
  });

  it("reports lines that fall past the arrangement instead of dropping them silently", () => {
    const result = attachLyrics(mixedMeterSong(), {
      syncedLyrics: lrcAt([{ beat: 40, text: "way out" }]),
    });
    expect(result.lines).toBe(0);
    expect(result.unplaced).toBe(1);
    expect(result.attached).toBe(true);
  });
});

describe("attachLyrics — unsynced and empty sources", () => {
  it("puts a plain record on the first section that can sing", () => {
    const result = attachLyrics(mixedMeterSong(), { plainLyrics: "line one\nline two" });
    expect(result.plainOnly).toBe(true);
    expect(result.sections).toBe(1);
    const verse = result.song.sections.find((section) => section.id === "a")!;
    expect(verse.lyrics).toBe("line one\nline two");
    expect(verse.lyricsTimeline).toBeUndefined();
  });

  it("creates a section when the song has none yet", () => {
    const song = createEmptySong("Empty");
    const result = attachLyrics(song, { syncedLyrics: lrcAt([{ beat: 0, text: "hello" }]) });
    expect(result.song.sections).toHaveLength(1);
    expect(result.song.sections[0]!.lyrics).toBe("hello");
    expect(result.song.arrangement).toHaveLength(1);
  });

  it("does nothing at all for an empty record", () => {
    const song = mixedMeterSong();
    const result = attachLyrics(song, {});
    expect(result.attached).toBe(false);
    expect(result.song).toBe(song);
  });
});
