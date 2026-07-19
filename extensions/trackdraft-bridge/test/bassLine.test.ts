import { describe, expect, it } from "vitest";
import { planBassLine } from "../src/bassLine.js";
import { makeChord, makeSection, makeSong } from "./helpers.js";

const twinFishVerse1 = makeSong({
  id: "lalo-chezia-03_twin_fish",
  title: "Twin Fish",
  bpm: 60,
  sections: [
    makeSection({
      id: "1",
      name: "Verse 1",
      bars: 4,
      timeSignatureNumerator: 4,
      chords: [
        makeChord({ romanNumeral: "i", root: "E", quality: "min", beats: 4 }),
        makeChord({ romanNumeral: "VII", root: "D", quality: "maj", beats: 4 }),
        makeChord({ romanNumeral: "VI", root: "C", quality: "maj", beats: 4 }),
        makeChord({ romanNumeral: "V", root: "B", quality: "maj", beats: 4 }),
      ],
    }),
  ],
});

describe("planBassLine", () => {
  it("plays a single sustained root note per chord, back-to-back with no gaps", () => {
    const [clip] = planBassLine(twinFishVerse1);
    expect(clip.notes).toHaveLength(4); // one note per chord, no triads

    // E at octave 3 => 3*12+4 = 40
    expect(clip.notes[0]).toMatchObject({ pitch: 40, startTime: 0, duration: 4 });
    // D at octave 3 => 3*12+2 = 38
    expect(clip.notes[1]).toMatchObject({ pitch: 38, startTime: 4, duration: 4 });

    // legato: each note's end exactly meets the next note's start
    for (let i = 0; i < clip.notes.length - 1; i++) {
      expect(clip.notes[i].startTime + clip.notes[i].duration).toBe(clip.notes[i + 1].startTime);
    }
  });

  it("loops the root-note cycle to fill the section, same as chord clips", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({
          id: "1",
          name: "Verse",
          bars: 8, // 32 beats, 4x the 8-beat cycle below
          timeSignatureNumerator: 4,
          chords: [
            makeChord({ romanNumeral: "I", root: "C", quality: "maj", beats: 4 }),
            makeChord({ romanNumeral: "V", root: "G", quality: "maj", beats: 4 }),
          ],
        }),
      ],
    });
    const [clip] = planBassLine(song);
    expect(clip.notes).toHaveLength(8); // 4 repeats * 2 chords
    const last = clip.notes[clip.notes.length - 1];
    expect(last.startTime + last.duration).toBe(32);
  });

  it("respects an explicit octave override", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({
          id: "1",
          name: "A",
          bars: 1,
          timeSignatureNumerator: 4,
          chords: [makeChord({ romanNumeral: "I", root: "C", quality: "maj", beats: 4 })],
        }),
      ],
    });
    const octave2 = planBassLine(song, 2);
    const octave3 = planBassLine(song, 3);
    expect(octave3[0].notes[0].pitch).toBe(octave2[0].notes[0].pitch + 12);
  });

  it("produces an empty-notes clip for a section with no chord data", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Intro", bars: 4, timeSignatureNumerator: 4 })],
    });
    const [clip] = planBassLine(song);
    expect(clip.notes).toEqual([]);
    expect(clip.durationBeats).toBe(16);
  });
});
