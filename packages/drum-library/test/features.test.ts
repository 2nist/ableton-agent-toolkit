import { describe, expect, it } from "vitest";
import { measureFeel, rhythmKeyOf } from "../src/features.js";
import type { DrumNote } from "../src/types.js";

const KICK = 36;
const SNARE = 38;
const CLOSED_HAT = 42;
const OPEN_HAT = 46;

function note(beat: number, pitch: number, velocity = 100): DrumNote {
  return { beat, pitch, velocity };
}

describe("push", () => {
  it("is zero for perfectly quantised playing", () => {
    const notes = [note(0, KICK), note(1, SNARE), note(2, KICK), note(3, SNARE)];
    expect(measureFeel(notes, 1, 4).push).toBeCloseTo(0, 6);
  });

  it("is negative behind the beat and positive ahead of it", () => {
    const behind = [note(0.03, KICK), note(1.03, SNARE), note(2.03, KICK)];
    const ahead = [note(-0.03 + 1, KICK), note(2 - 0.03, SNARE), note(3 - 0.03, KICK)];
    expect(measureFeel(behind, 1, 4).push).toBeGreaterThan(0);
    expect(measureFeel(ahead, 1, 4).push).toBeLessThan(0);
  });
});

describe("looseness", () => {
  it("separates machine-tight from humanly varied timing", () => {
    const tight = [note(0, KICK), note(1, SNARE), note(2, KICK), note(3, SNARE)];
    const loose = [note(0.04, KICK), note(0.97, SNARE), note(2.06, KICK), note(2.94, SNARE)];
    expect(measureFeel(tight, 1, 4).looseness).toBeCloseTo(0, 6);
    expect(measureFeel(loose, 1, 4).looseness).toBeGreaterThan(0.02);
  });
});

describe("dynamics", () => {
  it("rises when ghost notes sit under accents", () => {
    const flat = [note(0, SNARE, 100), note(1, SNARE, 100), note(2, SNARE, 100)];
    const ghosted = [note(0, SNARE, 118), note(1, SNARE, 22), note(2, SNARE, 110)];
    expect(measureFeel(flat, 1, 4).dynamics).toBeCloseTo(0, 6);
    expect(measureFeel(ghosted, 1, 4).dynamics).toBeGreaterThan(0.2);
  });
});

describe("swing", () => {
  it("reads 0.5 for straight eighths and higher for a shuffle", () => {
    const straight = [note(0, CLOSED_HAT), note(0.5, CLOSED_HAT), note(1, CLOSED_HAT), note(1.5, CLOSED_HAT)];
    const shuffled = [note(0, CLOSED_HAT), note(0.667, CLOSED_HAT), note(1, CLOSED_HAT), note(1.667, CLOSED_HAT)];
    expect(measureFeel(straight, 1, 4).swing).toBeCloseTo(0.5, 2);
    expect(measureFeel(shuffled, 1, 4).swing).toBeGreaterThan(0.6);
  });

  it("defaults to straight when there are no offbeats to measure", () => {
    const onbeats = [note(0, KICK), note(1, KICK), note(2, KICK)];
    expect(measureFeel(onbeats, 1, 4).swing).toBe(0.5);
  });
});

describe("syncopation", () => {
  it("is low on the pulse and high off it", () => {
    const onbeat = [note(0, KICK), note(1, KICK), note(2, KICK), note(3, KICK)];
    const offbeat = [note(0.25, KICK), note(0.75, KICK), note(1.25, KICK), note(1.75, KICK)];
    expect(measureFeel(onbeat, 1, 4).syncopation).toBeLessThan(0.3);
    expect(measureFeel(offbeat, 1, 4).syncopation).toBeGreaterThan(0.9);
  });
});

describe("density", () => {
  it("counts hits per bar, not per take", () => {
    const notes = [note(0, KICK), note(1, KICK), note(2, KICK), note(3, KICK)];
    expect(measureFeel(notes, 1, 4).density).toBe(4);
    expect(measureFeel(notes, 2, 4).density).toBe(2);
  });
});

describe("brightness", () => {
  it("rises with open hats and ignores non-cymbal voices", () => {
    const closed = [note(0, CLOSED_HAT), note(0.5, CLOSED_HAT), note(1, CLOSED_HAT)];
    const open = [note(0, OPEN_HAT), note(0.5, OPEN_HAT), note(1, CLOSED_HAT)];
    expect(measureFeel(closed, 1, 4).brightness).toBe(0);
    expect(measureFeel(open, 1, 4).brightness).toBeCloseTo(2 / 3, 6);
    // A bar of kicks has no cymbals at all, so brightness is undefined-as-zero
    // rather than an accidental 1 from an empty denominator.
    expect(measureFeel([note(0, KICK), note(1, KICK)], 1, 4).brightness).toBe(0);
  });
});

describe("motion", () => {
  it("is zero for an identical loop and rises when bars differ", () => {
    const looped = [note(0, KICK), note(1, SNARE), note(4, KICK), note(5, SNARE)];
    const varied = [note(0, KICK), note(1, SNARE), note(4.25, OPEN_HAT), note(6.75, SNARE)];
    expect(measureFeel(looped, 2, 4).motion).toBe(0);
    expect(measureFeel(varied, 2, 4).motion).toBeGreaterThan(0.5);
  });

  it("needs at least two bars to mean anything", () => {
    expect(measureFeel([note(0, KICK), note(1, SNARE)], 1, 4).motion).toBe(0);
  });
});

describe("odd meters", () => {
  it("measures bar-relative position using beatsPerBar, not a hardcoded 4", () => {
    // In 6/8 (3 quarter notes per bar) beat 3 is the next bar's downbeat, so
    // both kicks are maximally grounded. Read as 4/4 the same notes place the
    // second kick mid-bar, which is weaker — so the two interpretations must
    // not agree, or bar-relative maths is ignoring the time signature.
    const notes = [note(0, KICK, 110), note(3, KICK, 110)];
    const inSixEight = measureFeel(notes, 2, 3).syncopation;
    const asFourFour = measureFeel(notes, 2, 4).syncopation;
    expect(inSixEight).toBeLessThan(0.05);
    expect(asFourFour).toBeGreaterThan(inSixEight);
  });
});

describe("rhythmKeyOf", () => {
  it("matches two performances of the same pattern despite feel differing", () => {
    const takeOne = [note(0, KICK, 100), note(1.02, SNARE, 90), note(2, KICK, 105)];
    const takeTwo = [note(0.01, KICK, 40), note(0.98, SNARE, 127), note(2.03, KICK, 70)];
    expect(rhythmKeyOf(takeOne)).toBe(rhythmKeyOf(takeTwo));
  });

  it("distinguishes genuinely different patterns", () => {
    const straight = [note(0, KICK), note(2, KICK)];
    const syncopated = [note(0, KICK), note(2.5, KICK)];
    expect(rhythmKeyOf(straight)).not.toBe(rhythmKeyOf(syncopated));
  });

  it("distinguishes the same positions played on different voices", () => {
    expect(rhythmKeyOf([note(0, KICK)])).not.toBe(rhythmKeyOf([note(0, SNARE)]));
  });
});

describe("empty input", () => {
  it("returns neutral features rather than NaN", () => {
    const features = measureFeel([], 4, 4);
    for (const [axis, value] of Object.entries(features)) {
      expect(Number.isFinite(value), `${axis} should be finite`).toBe(true);
    }
    expect(features.swing).toBe(0.5);
  });
});
