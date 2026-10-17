import { describe, it, expect } from "vitest";
import { voiceChord } from "../src/chords";

const MAJOR = [0, 4, 7];
const C4 = 60;

describe("voiceChord", () => {
  it("leaves root position, close spacing untouched", () => {
    expect(voiceChord(C4, MAJOR)).toEqual({ rootMidi: 60, intervals: [0, 4, 7] });
    expect(voiceChord(C4, MAJOR, { inversion: 0, spread: "close" })).toEqual({
      rootMidi: 60,
      intervals: [0, 4, 7],
    });
  });

  it("puts the third in the bass for a first inversion", () => {
    const voiced = voiceChord(C4, MAJOR, { inversion: 1 });
    expect(voiced.rootMidi).toBe(64); // E4
    expect(voiced.intervals).toEqual([0, 3, 8]);
    expect(voiced.intervals.map((i) => voiced.rootMidi + i)).toEqual([64, 67, 72]);
  });

  it("puts the fifth in the bass for a second inversion", () => {
    const voiced = voiceChord(C4, MAJOR, { inversion: 2 });
    expect(voiced.intervals.map((i) => voiced.rootMidi + i)).toEqual([67, 72, 76]);
  });

  it("wraps an inversion past the chord's size", () => {
    expect(voiceChord(C4, MAJOR, { inversion: 4 })).toEqual(voiceChord(C4, MAJOR, { inversion: 1 }));
    expect(voiceChord(C4, MAJOR, { inversion: -1 })).toEqual(voiceChord(C4, MAJOR, { inversion: 2 }));
  });

  it("opens the spacing by dropping the second-highest voice", () => {
    const voiced = voiceChord(C4, MAJOR, { spread: "open" });
    expect(voiced.intervals.map((i) => voiced.rootMidi + i)).toEqual([52, 60, 67]);
  });

  it("combines an inversion with open spacing", () => {
    const voiced = voiceChord(C4, MAJOR, { inversion: 1, spread: "open" });
    expect(voiced.intervals.map((i) => voiced.rootMidi + i)).toEqual([55, 64, 72]);
  });

  it("keeps every tone on a seventh chord when the seventh moves", () => {
    const voiced = voiceChord(C4, [0, 4, 7, 11], { inversion: 3 });
    expect(voiced.intervals.map((i) => voiced.rootMidi + i)).toEqual([71, 72, 76, 79]);
  });

  it("returns ascending intervals starting at zero", () => {
    for (const inversion of [0, 1, 2, 3]) {
      for (const spread of ["close", "open"] as const) {
        const { intervals } = voiceChord(C4, [0, 3, 7, 10], { inversion, spread });
        expect(intervals[0]).toBe(0);
        expect([...intervals].sort((a, b) => a - b)).toEqual(intervals);
      }
    }
  });

  it("handles an empty interval list", () => {
    expect(voiceChord(C4, [])).toEqual({ rootMidi: 60, intervals: [] });
  });
});
