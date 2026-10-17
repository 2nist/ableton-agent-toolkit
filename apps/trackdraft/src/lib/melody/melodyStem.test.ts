import { describe, expect, it } from "vitest";
import { createEmptySong, type BlueprintSection, type BlueprintSong } from "../../types/blueprint";
import type { SectionSpan } from "../arrangement";
import { planMelodyStem } from "./melodyStem";

function fixture(contourApplied: boolean) {
  const section: BlueprintSection = {
    id: "verse-1",
    name: "Verse 1",
    role: "verse",
    bars: 2,
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    chords: [{ id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 8 }],
    bend: { melodyContour: 0 },
    melody: {
      notes: [
        { pitch: 60, startTime: 0, duration: 1 },
        { pitch: 72, startTime: 1, duration: 1 },
      ],
      contourApplied,
    },
  };
  const song: BlueprintSong = { ...createEmptySong("Stem"), sections: [section] };
  const span: SectionSpan = {
    sectionId: section.id,
    section,
    occurrenceIndex: 0,
    startBeat: 0,
    durationBeats: 8,
    startBar: 0,
    bars: 2,
  };
  return { span, song };
}

describe("planMelodyStem — contour application", () => {
  it("shapes a recorded line at render time", () => {
    const { span, song } = fixture(false);
    const notes = planMelodyStem([span], song);
    expect(notes.map((note) => note.pitch)).toEqual([60, 62]);
  });

  it("does not shape a generated line twice", () => {
    const { span, song } = fixture(true);
    const notes = planMelodyStem([span], song);
    expect(notes.map((note) => note.pitch)).toEqual([60, 72]);
  });
});
