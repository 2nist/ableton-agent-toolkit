import { describe, expect, it } from "vitest";
import { cuePointNamesFor, planCuePoints, sectionSpans } from "../src/blueprint.js";
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
    expect(spans[0]).toEqual({ section: twinFish.sections[0], startBeat: 0, durationBeats: 32 });
    expect(spans[1]).toEqual({ section: twinFish.sections[1], startBeat: 32, durationBeats: 64 });
    expect(spans[spans.length - 1].startBeat + spans[spans.length - 1].durationBeats).toBe(352);
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
