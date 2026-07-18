import { describe, expect, it } from "vitest";
import { planCuePoints, type BlueprintSong } from "../src/blueprint.js";

const twinFish: BlueprintSong = {
  id: "lalo-chezia-03_twin_fish",
  title: "Twin Fish",
  bpm: 60,
  sections: [
    { id: "1", name: "Intro", bars: 8, timeSignatureNumerator: 4 },
    { id: "2", name: "Verse 1", bars: 16, timeSignatureNumerator: 4 },
    { id: "3", name: "Chorus", bars: 16, timeSignatureNumerator: 4 },
    { id: "4", name: "Verse 2", bars: 16, timeSignatureNumerator: 4 },
    { id: "5", name: "Bridge", bars: 8, timeSignatureNumerator: 4 },
    { id: "6", name: "Chorus 2", bars: 16, timeSignatureNumerator: 4 },
    { id: "7", name: "Outro", bars: 8, timeSignatureNumerator: 4 },
  ],
};

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
    const song: BlueprintSong = {
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        { id: "1", name: "Intro", bars: 4, timeSignatureNumerator: 4 },
        { id: "2", name: "Waltz Verse", bars: 4, timeSignatureNumerator: 3 },
      ],
    };
    expect(planCuePoints(song)).toEqual([
      { name: "Intro", beat: 0 },
      { name: "Waltz Verse", beat: 16 },
    ]);
  });

  it("returns an empty plan for a song with no sections", () => {
    expect(planCuePoints({ id: "x", title: "x", bpm: 120, sections: [] })).toEqual([]);
  });
});
