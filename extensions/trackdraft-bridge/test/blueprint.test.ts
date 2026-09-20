import { describe, expect, it } from "vitest";
import { applyOutputOffset, cuePointNamesFor, planCuePoints, sectionSpans } from "../src/blueprint.js";
import { makeSection, makeSong } from "./helpers.js";

const twinFish = makeSong({
  id: "lalo-chezia-03_twin_fish",
  title: "Twin Fish",
  bpm: 60,
  sections: [
    makeSection({ id: "1", name: "Intro", bars: 8, timeSignatureNumerator: 4 }),
    makeSection({ id: "2", name: "Verse 1", bars: 16, timeSignatureNumerator: 4 }),
    makeSection({ id: "3", name: "Chorus", bars: 16, timeSignatureNumerator: 4 }),
    makeSection({ id: "4", name: "Verse 2", bars: 16, timeSignatureNumerator: 4 }),
    makeSection({ id: "5", name: "Bridge", bars: 8, timeSignatureNumerator: 4 }),
    makeSection({ id: "6", name: "Chorus 2", bars: 16, timeSignatureNumerator: 4 }),
    makeSection({ id: "7", name: "Outro", bars: 8, timeSignatureNumerator: 4 }),
  ],
});

describe("planCuePoints", () => {
  it("places Twin Fish's sections at the correct cumulative beat offsets", () => {
    expect(planCuePoints(twinFish)).toEqual([
      { name: "Intro", beat: 0 },
      { name: "Verse 1", beat: 32 },
      { name: "Chorus", beat: 96 },
      { name: "Verse 2", beat: 160 },
      { name: "Bridge", beat: 224 },
      { name: "Chorus 2", beat: 256 },
      { name: "Outro", beat: 320 },
    ]);
  });

  it("accounts for a mid-song time signature change", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "1", name: "Intro", bars: 4, timeSignatureNumerator: 4 }),
        makeSection({ id: "2", name: "Waltz Verse", bars: 4, timeSignatureNumerator: 3 }),
      ],
    });
    expect(planCuePoints(song)).toEqual([
      { name: "Intro", beat: 0 },
      { name: "Waltz Verse", beat: 16 },
    ]);
  });

  it("returns an empty plan for a song with no sections", () => {
    expect(planCuePoints(makeSong({ id: "x", title: "x", bpm: 120, sections: [] }))).toEqual([]);
  });
});

describe("sectionSpans", () => {
  it("carries both start and duration alongside the section itself", () => {
    const spans = sectionSpans(twinFish);
    expect(spans[0]).toEqual({ section: twinFish.sections[0], startBeat: 0, durationBeats: 32, occurrenceIndex: 0 });
    expect(spans[1]).toEqual({ section: twinFish.sections[1], startBeat: 32, durationBeats: 64, occurrenceIndex: 0 });
    expect(spans[spans.length - 1].startBeat + spans[spans.length - 1].durationBeats).toBe(352);
  });

  it("with an empty arrangement, behaves exactly as before -- one span per section, in list order", () => {
    // twinFish's makeSong default is arrangement: [] -- this is the real
    // shape of every existing song today (catalog songs aside, which
    // populate one repeats:1 entry per section -- covered below).
    const spans = sectionSpans(twinFish);
    expect(spans).toHaveLength(twinFish.sections.length);
    expect(spans.map((s) => s.section.id)).toEqual(twinFish.sections.map((s) => s.id));
    expect(spans.every((s) => s.occurrenceIndex === 0)).toBe(true);
  });

  it("an arrangement entry with repeats > 1 expands into multiple spans, each numbered by occurrence", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "v", name: "Verse", bars: 4, timeSignatureNumerator: 4 }),
        makeSection({ id: "c", name: "Chorus", bars: 4, timeSignatureNumerator: 4 }),
      ],
      arrangement: [
        { sectionId: "v", repeats: 1 },
        { sectionId: "c", repeats: 3 },
      ],
    });
    const spans = sectionSpans(song);
    expect(spans.map((s) => s.section.id)).toEqual(["v", "c", "c", "c"]);
    expect(spans.map((s) => s.occurrenceIndex)).toEqual([0, 0, 1, 2]);
    expect(spans.map((s) => s.startBeat)).toEqual([0, 16, 32, 48]);
  });

  it("a section not covered by any arrangement entry is appended once, in sections list order -- never silently dropped", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "v", name: "Verse", bars: 4, timeSignatureNumerator: 4 }),
        makeSection({ id: "c", name: "Chorus", bars: 4, timeSignatureNumerator: 4 }),
        makeSection({ id: "o", name: "Outro", bars: 4, timeSignatureNumerator: 4 }),
      ],
      // Only "v" is covered -- "c" and "o" have no arrangement entry at all
      // (e.g. added after the arrangement was authored).
      arrangement: [{ sectionId: "v", repeats: 2 }],
    });
    const spans = sectionSpans(song);
    expect(spans.map((s) => s.section.id)).toEqual(["v", "v", "c", "o"]);
  });

  it("an arrangement entry referencing a deleted section is skipped, not crashed on", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "v", name: "Verse", bars: 4, timeSignatureNumerator: 4 })],
      arrangement: [
        { sectionId: "v", repeats: 1 },
        { sectionId: "does-not-exist", repeats: 2 },
      ],
    });
    expect(sectionSpans(song).map((s) => s.section.id)).toEqual(["v"]);
  });

  it("repeats: 0 plays a section zero times, deliberately -- not clamped up to 1", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "v", name: "Verse", bars: 4, timeSignatureNumerator: 4 }),
        makeSection({ id: "c", name: "Chorus", bars: 4, timeSignatureNumerator: 4 }),
      ],
      arrangement: [
        { sectionId: "v", repeats: 0 },
        { sectionId: "c", repeats: 1 },
      ],
    });
    expect(sectionSpans(song).map((s) => s.section.id)).toEqual(["c"]);
  });

  it("overrides merge onto the section for that pass only", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "c", name: "Chorus", bars: 4, velocity: "mf", timeSignatureNumerator: 4 })],
      arrangement: [
        { sectionId: "c", repeats: 1 },
        { sectionId: "c", repeats: 1, overrides: { velocity: "ff" }, variation: "Chorus (final)" },
      ],
    });
    const spans = sectionSpans(song);
    expect(spans).toHaveLength(2);
    expect(spans[0].section.velocity).toBe("mf");
    expect(spans[1].section.velocity).toBe("ff");
    // The base section object itself is untouched by the override.
    expect(song.sections[0].velocity).toBe("mf");
  });

  it("matches the catalog-ingestion shape: one repeats:1 entry per section produces identical output to no arrangement at all", () => {
    const sections = twinFish.sections;
    const withExplicitArrangement = makeSong({
      id: "x",
      title: "x",
      bpm: 60,
      sections,
      arrangement: sections.map((s) => ({ sectionId: s.id, repeats: 1 })),
    });
    expect(sectionSpans(withExplicitArrangement)).toEqual(sectionSpans(twinFish));
  });
});

describe("cuePointNamesFor", () => {
  it("returns the set of a blueprint's section names", () => {
    expect(cuePointNamesFor(twinFish)).toEqual(
      new Set(["Intro", "Verse 1", "Chorus", "Verse 2", "Bridge", "Chorus 2", "Outro"]),
    );
  });

  it("collapses duplicate section names (e.g. two sections both named 'Chorus')", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "1", name: "Chorus", bars: 8, timeSignatureNumerator: 4 }),
        makeSection({ id: "2", name: "Chorus", bars: 8, timeSignatureNumerator: 4 }),
      ],
    });
    expect(cuePointNamesFor(song)).toEqual(new Set(["Chorus"]));
  });
});

describe("applyOutputOffset", () => {
  const note = (startTime: number) => ({ pitch: 60, startTime, duration: 1, velocity: 100 });
  const plan = () => [
    { name: "Intro", startBeat: 0, durationBeats: 16, notes: [note(0), note(2.5)] },
    { name: "Verse", startBeat: 16, durationBeats: 32, notes: [note(4)] },
    { name: "Chorus", startBeat: 48, durationBeats: 32, notes: [note(0)] },
  ];

  it("returns the plan untouched for a zero offset", () => {
    const original = plan();
    expect(applyOutputOffset(original, 0)).toBe(original);
  });

  it("a negative offset moves every clip earlier, leaving notes clip-relative", () => {
    const shifted = applyOutputOffset(plan(), -1);
    // Clip 0's -1 is clamped to 0 (its notes shift instead — covered below).
    expect(shifted.map((c) => c.startBeat)).toEqual([0, 15, 47]);
    expect(shifted[1].notes).toEqual(plan()[1].notes);
    expect(shifted[2].notes).toEqual(plan()[2].notes);
    expect(shifted.map((c) => c.durationBeats)).toEqual([16, 32, 32]);
  });

  it("clamps a first clip that would start before bar 1 by shifting its notes instead", () => {
    const shifted = applyOutputOffset(plan(), -1);
    // Clip 0 stays at 0; its notes carry the -1 themselves, clamped at 0.
    expect(shifted[0].startBeat).toBe(0);
    expect(shifted[0].notes.map((n) => n.startTime)).toEqual([0, 1.5]);
    // A note that was already inside the first beat squashes to 0, not negative.
    const tiny = applyOutputOffset([{ name: "Intro", startBeat: 0, durationBeats: 4, notes: [note(0.5)] }], -1);
    expect(tiny[0].notes[0].startTime).toBe(0);
  });

  it("a positive offset moves clips later and never touches notes", () => {
    const shifted = applyOutputOffset(plan(), 2);
    expect(shifted.map((c) => c.startBeat)).toEqual([2, 18, 50]);
    expect(shifted.map((c) => c.notes)).toEqual([plan()[0].notes, plan()[1].notes, plan()[2].notes]);
  });
});
