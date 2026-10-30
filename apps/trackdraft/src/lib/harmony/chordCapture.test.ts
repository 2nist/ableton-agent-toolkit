import { describe, expect, it } from "vitest";
import { buildCapturedProgression, captureToChords } from "./chordCapture";

const chord = (beat: number, rootPc: number, quality = "maj" as const) => ({
  beat,
  rootPc,
  quality,
});

describe("buildCapturedProgression", () => {
  it("reads a four-bar take as four chords of four beats", () => {
    const take = buildCapturedProgression(
      [chord(0, 0), chord(4, 5), chord(8, 7), chord(12, 0)],
      16,
    );
    expect(take.map((entry) => [entry.rootPc, entry.startBeat, entry.beats])).toEqual([
      [0, 0, 4],
      [5, 4, 4],
      [7, 8, 4],
      [0, 12, 4],
    ]);
  });

  it("snaps human timing onto the beat grid", () => {
    const take = buildCapturedProgression(
      [chord(0.08, 0), chord(3.92, 5), chord(8.3, 7)],
      12,
    );
    expect(take.map((entry) => entry.startBeat)).toEqual([0, 4, 8]);
    expect(take.map((entry) => entry.beats)).toEqual([4, 4, 4]);
  });

  it("pulls a downbeat attack onto bar one instead of leaving a sliver of rest", () => {
    const take = buildCapturedProgression([chord(0.2, 0), chord(4, 5)], 8);
    expect(take[0]).toMatchObject({ startBeat: 0, beats: 4 });
  });

  it("collapses re-struck and held chords into one", () => {
    const take = buildCapturedProgression([chord(0, 0), chord(2, 0), chord(4, 5)], 8);
    expect(take).toHaveLength(2);
    expect(take[0]).toMatchObject({ rootPc: 0, startBeat: 0, beats: 4 });
  });

  it("keeps the last chord to the end of the section", () => {
    const take = buildCapturedProgression([chord(0, 0), chord(4, 5)], 16);
    expect(take[1]).toMatchObject({ startBeat: 4, beats: 12 });
  });

  it("ends the last chord where the take ended, so a short cycle can loop", () => {
    // A four-bar cycle played once inside an eight-bar section: the last
    // chord is four beats, not twenty.
    const take = buildCapturedProgression([chord(0, 0), chord(4, 5)], 32, { endBeat: 8 });
    expect(take.map((entry) => entry.beats)).toEqual([4, 4]);
  });

  it("never shortens the last chord below one grid cell", () => {
    const take = buildCapturedProgression([chord(0, 0), chord(4, 5)], 32, { endBeat: 4.1 });
    expect(take[1]!.beats).toBe(1);
  });

  it("honours a finer grid", () => {
    const take = buildCapturedProgression([chord(0, 0), chord(2.4, 5)], 8, { gridBeats: 0.5 });
    expect(take.map((entry) => entry.startBeat)).toEqual([0, 2.5]);
  });

  it("ignores notes outside the section and impossible slivers", () => {
    const take = buildCapturedProgression(
      [chord(-1, 0), chord(0, 0), chord(8.05, 5), chord(9, 7)],
      8,
    );
    expect(take).toHaveLength(1);
    expect(take[0]).toMatchObject({ rootPc: 0, startBeat: 0, beats: 8 });
  });

  it("caps a runaway take", () => {
    const events = Array.from({ length: 50 }, (_, index) => chord(index * 0.5, index % 12));
    const take = buildCapturedProgression(events, 64, { maxChords: 8, gridBeats: 0.5 });
    expect(take).toHaveLength(8);
  });

  it("returns nothing for an empty take or a zero-length section", () => {
    expect(buildCapturedProgression([], 16)).toEqual([]);
    expect(buildCapturedProgression([chord(0, 0)], 0)).toEqual([]);
  });
});

describe("captureToChords", () => {
  it("writes section chords with roman numerals", () => {
    const chords = captureToChords([chord(0, 0), chord(4, 5), chord(8, 7), chord(12, 0)], 16, {
      keyName: "C",
      scale: "ionian",
    });
    expect(chords.map((entry) => entry.root)).toEqual(["C", "F", "G", "C"]);
    expect(chords.map((entry) => entry.romanNumeral)).toEqual(["I", "IV", "V", "I"]);
    expect(chords.map((entry) => entry.beats)).toEqual([4, 4, 4, 4]);
    expect(new Set(chords.map((entry) => entry.id)).size).toBe(chords.length);
  });

  it("spells the root in the song's key", () => {
    const chords = captureToChords([chord(0, 10), chord(8, 3)], 16, {
      keyName: "Bb",
      scale: "ionian",
    });
    expect(chords.map((entry) => entry.root)).toEqual(["Bb", "Eb"]);
  });
});
