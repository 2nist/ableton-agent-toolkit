import { describe, expect, it } from "vitest";
import {
  createEmptySong,
  type BlueprintSection,
  type BlueprintSong,
} from "../../types/blueprint";
import type { SectionSpan } from "../arrangement";
import { planMelodyStem } from "./melodyStem";
import { planBassStem } from "../midiExport";

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
    chords: [
      { id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 8 },
    ],
    bend: { melodyContour: 0 },
    melody: {
      notes: [
        { pitch: 60, startTime: 0, duration: 1 },
        { pitch: 72, startTime: 1, duration: 1 },
      ],
      contourApplied,
    },
  };
  const song: BlueprintSong = {
    ...createEmptySong("Stem"),
    sections: [section],
  };
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

describe("planMelodyStem — the section's own clock", () => {
  const clocked = (rate: number) => {
    const { span, song } = fixture(true);
    const withClock = {
      ...span,
      section: { ...span.section, timeDomain: { rate } },
    } as SectionSpan;
    return planMelodyStem([withClock], song);
  };

  it("leaves the line on the song's grid without a clock", () => {
    expect(
      planMelodyStem([fixture(true).span], fixture(true).song).map(
        (n) => n.startTime,
      ),
    ).toEqual([0, 1]);
  });

  it("lands the line where the canvas draws it at double time, then fills", () => {
    // Twice as fast is half the length, and the phrase comes round again to
    // fill the section — the same rule the chords and the kit follow.
    expect(clocked(2).map((note) => note.startTime)).toEqual([0, 0.5, 4, 4.5]);
  });

  it("stretches it at half time", () => {
    expect(clocked(0.5).map((note) => note.startTime)).toEqual([0, 2]);
  });

  it("keeps the section's offset on top of the clock", () => {
    const { span, song } = fixture(true);
    const moved = {
      ...span,
      startBeat: 16,
      section: { ...span.section, timeDomain: { rate: 2 } },
    } as SectionSpan;
    expect(planMelodyStem([moved], song).map((note) => note.startTime)).toEqual(
      [16, 16.5, 20, 20.5],
    );
  });
});

describe("planMelodyStem — a looped section", () => {
  it("repeats a riff across the section and drops what is outside it", () => {
    const { span, song } = fixture(true);
    const looped = {
      ...span,
      section: { ...span.section, timeDomain: { rate: 1, cycle: 4 } },
    } as SectionSpan;
    const notes = planMelodyStem([looped], song);
    // The two notes live in the first four beats, so they repeat at +4, and
    // nothing from the section's second bar is played.
    expect(notes.map((note) => note.startTime)).toEqual([0, 1, 4, 5]);
  });
});

describe("planMelodyStem — one clock moves the whole band (§P3.6)", () => {
  it("moves the melody and the bass by the same factor", () => {
    // §P3.5 kept the bass still while the chords stood still. §P3.6 conducts the
    // harmony, so nothing needs holding back: both lanes retime, and they
    // retime by the same amount, which is what keeps the phrase on its chord.
    const { span, song } = fixture(true);
    const cases: [number, number[], number[]][] = [
      // rate, melody onsets, bass onsets
      [0.5, [0, 2], [0]],
      [2, [0, 0.5, 4, 4.5], [0, 4]],
    ];
    for (const [rate, melodyOnsets, bassOnsets] of cases) {
      const clocked = {
        ...span,
        section: { ...span.section, timeDomain: { rate } },
      } as SectionSpan;
      expect(planMelodyStem([clocked], song).map((n) => n.startTime)).toEqual(
        melodyOnsets,
      );
      // The fixture is one eight-beat chord over a two-bar section: at double
      // time the harmony comes round twice, so the bass plays twice.
      expect(planBassStem([clocked], song).map((n) => n.startTime)).toEqual(
        bassOnsets,
      );
    }
  });
});
