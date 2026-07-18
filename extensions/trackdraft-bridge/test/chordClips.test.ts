import { describe, expect, it } from "vitest";
import { planChordClips } from "../src/chordClips.js";
import type { BlueprintSong } from "../src/blueprint.js";

const twinFishVerse1: BlueprintSong = {
  id: "lalo-chezia-03_twin_fish",
  title: "Twin Fish",
  bpm: 60,
  sections: [
    {
      id: "1",
      name: "Verse 1",
      bars: 16,
      timeSignatureNumerator: 4,
      chords: [
        { romanNumeral: "i", root: "E", quality: "min", beats: 4 },
        { romanNumeral: "VII", root: "D", quality: "maj", beats: 4 },
        { romanNumeral: "VI", root: "C", quality: "maj", beats: 4 },
        { romanNumeral: "V", root: "B", quality: "maj", beats: 4 },
      ],
    },
  ],
};

describe("planChordClips", () => {
  it("builds a sustained block-chord voicing for each chord in a section", () => {
    const plan = planChordClips(twinFishVerse1);
    expect(plan).toHaveLength(1);
    const [clip] = plan;
    expect(clip.name).toBe("Verse 1");
    expect(clip.startBeat).toBe(0);
    expect(clip.durationBeats).toBe(64); // 16 bars * 4/4

    // Em: E(4) G(7) B(11) at octave 5 => base 60
    const emNotes = clip.notes.filter((n) => n.startTime === 0);
    expect(emNotes.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([64, 67, 71]);
    emNotes.forEach((n) => expect(n.duration).toBe(4));

    // D major: D(2) F#(6) A(9) at octave 5
    const dNotes = clip.notes.filter((n) => n.startTime === 4);
    expect(dNotes.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([62, 66, 69]);
  });

  it("loops the progression to fill the whole section, not just one pass", () => {
    // 4 chords * 4 beats = 16-beat cycle, but the section is 64 beats (16
    // bars) — the real bug this guards against: only the first 16 beats
    // had notes, leaving 48 beats of a 16-bar verse silent.
    const plan = planChordClips(twinFishVerse1);
    const [clip] = plan;

    const starts = Array.from(new Set(clip.notes.map((n) => n.startTime))).sort((a, b) => a - b);
    expect(starts).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60]);

    const lastNote = clip.notes.reduce((latest, n) => (n.startTime > latest.startTime ? n : latest));
    expect(lastNote.startTime + lastNote.duration).toBe(64);

    // 4 repeats of the 4-chord/3-note-triad progression.
    expect(clip.notes).toHaveLength(4 * 4 * 3);
  });

  it("truncates the final repeat instead of overshooting the section", () => {
    const song: BlueprintSong = {
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        {
          id: "1",
          name: "Odd Verse",
          bars: 3, // 12 beats — not a clean multiple of the 8-beat cycle below
          timeSignatureNumerator: 4,
          chords: [
            { romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
            { romanNumeral: "V", root: "G", quality: "maj", beats: 4 },
          ],
        },
      ],
    };
    const [clip] = planChordClips(song);
    expect(clip.durationBeats).toBe(12);

    const lastNote = clip.notes.reduce((latest, n) => (n.startTime > latest.startTime ? n : latest));
    expect(lastNote.startTime + lastNote.duration).toBe(12);
    // Full C, full G, then a truncated 4-beat C (not an 8-beat repeat that would overshoot to beat 16).
    const cAtEnd = clip.notes.filter((n) => n.startTime === 8);
    cAtEnd.forEach((n) => expect(n.duration).toBe(4));
  });

  it("chains clips at cumulative bar offsets, same math as planCuePoints", () => {
    const song: BlueprintSong = {
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        { id: "1", name: "Intro", bars: 8, timeSignatureNumerator: 4, chords: [] },
        { id: "2", name: "Verse 1", bars: 16, timeSignatureNumerator: 4, chords: [] },
      ],
    };
    const plan = planChordClips(song);
    expect(plan[0].startBeat).toBe(0);
    expect(plan[0].durationBeats).toBe(32);
    expect(plan[1].startBeat).toBe(32);
    expect(plan[1].durationBeats).toBe(64);
  });

  it("produces an empty-notes clip for a section with no chord data, not skipping it", () => {
    const song: BlueprintSong = {
      id: "x",
      title: "x",
      bpm: 120,
      sections: [{ id: "1", name: "Instrumental", bars: 4, timeSignatureNumerator: 4 }],
    };
    const plan = planChordClips(song);
    expect(plan).toHaveLength(1);
    expect(plan[0].notes).toEqual([]);
    expect(plan[0].durationBeats).toBe(16);
  });

  it("respects an explicit octave override", () => {
    const song: BlueprintSong = {
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        {
          id: "1",
          name: "A",
          bars: 1,
          timeSignatureNumerator: 4,
          chords: [{ romanNumeral: "I", root: "C", quality: "maj", beats: 4 }],
        },
      ],
    };
    const octave4 = planChordClips(song, 4);
    const octave5 = planChordClips(song, 5);
    expect(Math.min(...octave5[0].notes.map((n) => n.pitch))).toBe(
      Math.min(...octave4[0].notes.map((n) => n.pitch)) + 12,
    );
  });
});
