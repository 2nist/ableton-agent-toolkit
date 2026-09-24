import { describe, it, expect } from "vitest";
import { playbackPosFor, samePlayPos, type SongTextPlayPos } from "./songTextPlayback";
import { buildSongTextModel } from "./songTextRows";
import { sectionSpans } from "../arrangement";
import type { BlueprintSong, BlueprintSection, Chord } from "../../types/blueprint";

function makeChord(id: string, beats: number, romanNumeral = "I", root = "C"): Chord {
  return { id, romanNumeral, root, quality: "maj", beats } as Chord;
}

function makeSong(sections: Partial<BlueprintSection>[], arrangement?: { sectionId: string; repeats: number }[]): BlueprintSong {
  return {
    id: "song-1",
    title: "Test Song",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: sections.map((s, i) => ({
      id: s.id ?? `sec-${i}`,
      name: s.name ?? `Section ${i}`,
      role: s.role ?? "custom",
      bars: s.bars ?? 8,
      chords: [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
      ...s,
    })),
    arrangement: arrangement ?? [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

/** One 8-bar verse (32 beats at 4/4) with a 2-chord loop and timed lines. */
function verseSong(extra?: Partial<BlueprintSection>, arrangement?: { sectionId: string; repeats: number }[]) {
  const song = makeSong(
    [
      {
        id: "v",
        name: "Verse",
        role: "verse",
        chords: [makeChord("ca", 4, "I", "C"), makeChord("cb", 4, "V", "G")],
        lyrics: "l1\nl2\nl3",
        lyricsTimeline: [
          { text: "l1", startBeat: 0 },
          { text: "l2", startBeat: 8 },
          { text: "l3", startBeat: 16 },
        ],
        ...extra,
      },
    ],
    arrangement ?? [{ sectionId: "v", repeats: 1 }],
  );
  return song;
}

describe("playbackPosFor — the song text's playhead follow", () => {
  it("resolves the block, line and sounding chord from a tick", () => {
    const song = verseSong();
    const spans = sectionSpans(song);
    const model = buildSongTextModel(song);

    const pos = playbackPosFor(song, spans, model, { beat: 9, isPlaying: true, sectionIndex: 0 })!;
    expect(pos.sectionId).toBe("v");
    expect(pos.lineIdx).toBe(1); // l2 started at beat 8, l3 at 16
    // Progression loops to fill 32 beats: A 0-4, B 4-8, A 8-12, ... → beat 9 = A.
    expect(pos.chordId).toBe("ca");
    expect(pos.chordLabel).toContain("I");
    expect(pos.playing).toBe(true);
    expect(pos.passCount).toBe(1);
  });

  it("advances the chord across loop passes of the progression", () => {
    const song = verseSong();
    const spans = sectionSpans(song);
    const model = buildSongTextModel(song);
    expect(playbackPosFor(song, spans, model, { beat: 1, isPlaying: true, sectionIndex: 0 })!.chordId).toBe("ca");
    expect(playbackPosFor(song, spans, model, { beat: 5, isPlaying: true, sectionIndex: 0 })!.chordId).toBe("cb");
    expect(playbackPosFor(song, spans, model, { beat: 13, isPlaying: true, sectionIndex: 0 })!.chordId).toBe("cb");
  });

  it("reports which PASS of a repeated section is playing", () => {
    const song = verseSong(undefined, [{ sectionId: "v", repeats: 2 }]);
    const spans = sectionSpans(song);
    const model = buildSongTextModel(song);

    const first = playbackPosFor(song, spans, model, { beat: 4, isPlaying: true, sectionIndex: 0 })!;
    const second = playbackPosFor(song, spans, model, { beat: 36, isPlaying: true, sectionIndex: 1 })!;
    expect([first.occurrenceIndex, first.passCount]).toEqual([0, 2]);
    expect([second.occurrenceIndex, second.passCount]).toEqual([1, 2]);
    expect(second.sectionId).toBe("v"); // same block lights on both passes
  });

  it("falls back to even distribution when lines carry no timing", () => {
    const song = makeSong([
      {
        id: "v",
        chords: [makeChord("ca", 4)],
        lyrics: "a\nb\nc\nd",
      },
    ]);
    const spans = sectionSpans(song);
    const model = buildSongTextModel(song);
    const pos = playbackPosFor(song, spans, model, { beat: 16, isPlaying: true, sectionIndex: 0 })!; // 50% of 32 beats
    expect(pos.lineIdx).toBe(2);
  });

  it("is null when nothing is playing or the index is out of range", () => {
    const song = verseSong();
    const spans = sectionSpans(song);
    const model = buildSongTextModel(song);
    expect(playbackPosFor(song, spans, model, { beat: 4, isPlaying: false, sectionIndex: -1 })).toBeNull();
    expect(playbackPosFor(song, spans, model, { beat: 999, isPlaying: true, sectionIndex: 7 })).toBeNull();
  });
});

describe("samePlayPos", () => {
  const base: SongTextPlayPos = {
    sectionId: "v",
    occurrenceIndex: 0,
    passCount: 1,
    lineIdx: 2,
    playing: true,
    chordId: "ca",
    chordLabel: "I · C",
  };
  it("ignores ticks that change nothing (the 60fps guard)", () => {
    expect(samePlayPos(base, { ...base })).toBe(true);
    expect(samePlayPos(null, null)).toBe(true);
  });
  it("detects any content change", () => {
    expect(samePlayPos(base, { ...base, lineIdx: 3 })).toBe(false);
    expect(samePlayPos(base, { ...base, playing: false })).toBe(false);
    expect(samePlayPos(base, null)).toBe(false);
  });
});
