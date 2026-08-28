import { describe, it, expect } from "vitest";
import { currentLineIndex, rebaseLyricsTimeline } from "./lyricTimeline";

// Real Drive My Car data: the catalog build stores lyricsTimeline in GLOBAL
// song beats (absolute timestamps, never re-based to the section). The verse
// section starts at global beat 12 (3-bar intro) but its lines sit at 11.6,
// 19.5, 27.4, 33.8 — the old popout compared these against the section-
// relative playhead, so lines lit several bars late and (for sections whose
// lines all start after the section start) never advanced at all.
const driveMyCarVerse = [
  { text: "Asked a girl what she wanted to be", startBeat: 11.64 },
  { text: "She said, \"Baby, can't you see?", startBeat: 19.49 },
  { text: "I wanna be famous, a star of the screen\"", startBeat: 27.4 },
  { text: "But you can do something in between", startBeat: 33.8 },
];

describe("rebaseLyricsTimeline", () => {
  it("re-bases global song beats to section-relative (verse at section start 12)", () => {
    const relative = rebaseLyricsTimeline(driveMyCarVerse, 12);
    expect(relative[0].startBeat).toBeCloseTo(-0.36); // pickup, just before section start
    expect(relative[1].startBeat).toBeCloseTo(7.49);
    expect(relative[2].startBeat).toBeCloseTo(15.4);
    expect(relative[3].startBeat).toBeCloseTo(21.8);
  });

  it("handles the refrain pickup (global 42.54 vs section start 44)", () => {
    const refrain = [
      { text: "Baby you can drive my car", startBeat: 42.54 },
      { text: "Yes I'm gonna be a star", startBeat: 50.4 },
    ];
    const relative = rebaseLyricsTimeline(refrain, 44);
    expect(relative[0].startBeat).toBeCloseTo(-1.46);
    expect(relative[1].startBeat).toBeCloseTo(6.4);
  });

  it("returns [] for an undefined timeline", () => {
    expect(rebaseLyricsTimeline(undefined, 12)).toEqual([]);
  });
});

describe("currentLineIndex", () => {
  it("selects the correct line as the playhead advances through a re-based verse", () => {
    const relative = rebaseLyricsTimeline(driveMyCarVerse, 12);
    expect(currentLineIndex(relative, 0)).toBe(0); // first line lit from section start (pickup)
    expect(currentLineIndex(relative, 4)).toBe(0);
    expect(currentLineIndex(relative, 8)).toBe(1); // second line ~7.5 beats in
    expect(currentLineIndex(relative, 16)).toBe(2);
    expect(currentLineIndex(relative, 22)).toBe(3); // last line lit until section end
    expect(currentLineIndex(relative, 31)).toBe(3);
  });

  it("lights the refrain's first line immediately at section start (negative pickup)", () => {
    const relative = rebaseLyricsTimeline(
      [
        { text: "Baby you can drive my car", startBeat: 42.54 },
        { text: "Yes I'm gonna be a star", startBeat: 50.4 },
      ],
      44,
    );
    expect(currentLineIndex(relative, 0)).toBe(0);
    expect(currentLineIndex(relative, 7)).toBe(1);
  });

  it("returns -1 before the first line and for empty/undefined timelines", () => {
    expect(currentLineIndex(undefined, 5)).toBe(-1);
    expect(currentLineIndex([], 5)).toBe(-1);
    // A timeline that starts strictly after the section start leaves nothing lit
    expect(currentLineIndex([{ startBeat: 100 }], 50)).toBe(-1);
  });
});
