import { describe, it, expect } from "vitest";
import {
  barAtBeat,
  barLengths,
  beatAtBar,
  beatsPerBar,
  sectionDurationBeats,
} from "../src/index";
import type { BlueprintSection, MeterChange } from "../src/index";

function section(overrides: Partial<BlueprintSection> = {}): BlueprintSection {
  return {
    id: "s1",
    name: "A",
    role: "custom",
    bars: 4,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

const map = (...changes: MeterChange[]) => ({ meterMap: changes });

describe("no meter map", () => {
  it("is byte-identical to the old bars × beatsPerBar math", () => {
    const plain = section({ bars: 9 });
    expect(sectionDurationBeats(plain)).toBe(9 * beatsPerBar(plain));
    expect(barLengths(plain)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4]);
  });

  it("places bars and beats as it always did", () => {
    const s = section({ bars: 4 });
    expect(barAtBeat(s, 0)).toEqual({ bar: 0, beatInBar: 0 });
    expect(barAtBeat(s, 5.5)).toEqual({ bar: 1, beatInBar: 1.5 });
    expect(beatAtBar(s, 2)).toBe(8);
  });

  it("treats an empty map exactly like no map", () => {
    const s = section({ bars: 2, ...map() });
    expect(sectionDurationBeats(s)).toBe(8);
    expect(barLengths(s)).toEqual([4, 4]);
  });
});

describe("with a meter map", () => {
  /** The Zappa shape that motivated this: three 4/4 bars, a 7/8 bar, two 3/4. */
  const mixed = section({
    bars: 6,
    ...map(
      { bar: 0, numerator: 4, denominator: 4 },
      { bar: 3, numerator: 7, denominator: 8 },
      { bar: 4, numerator: 3, denominator: 4 },
    ),
  });

  it("expands to one length per bar", () => {
    expect(barLengths(mixed)).toEqual([4, 4, 4, 3.5, 3, 3]);
  });

  it("sums the actual bars rather than bars × one meter", () => {
    expect(sectionDurationBeats(mixed)).toBe(4 + 4 + 4 + 3.5 + 3 + 3);
    // The old math would have said 6 × 4 = 24.
    expect(sectionDurationBeats(mixed)).toBeLessThan(6 * beatsPerBar(mixed));
  });

  it("maps beats to bars across a meter change", () => {
    expect(barAtBeat(mixed, 0)).toEqual({ bar: 0, beatInBar: 0 });
    expect(barAtBeat(mixed, 11)).toEqual({ bar: 2, beatInBar: 3 });
    expect(barAtBeat(mixed, 12)).toEqual({ bar: 3, beatInBar: 0 }); // the 7/8 bar
    expect(barAtBeat(mixed, 14)).toEqual({ bar: 3, beatInBar: 2 });
    expect(barAtBeat(mixed, 15.5)).toEqual({ bar: 4, beatInBar: 0 }); // 7/8 bar is 3.5 long
    expect(beatAtBar(mixed, 3)).toBe(12);
    expect(beatAtBar(mixed, 4)).toBe(15.5);
    expect(beatAtBar(mixed, 5)).toBe(18.5);
  });

  it("holds the first meter until the first change", () => {
    const s = section({ bars: 4, ...map({ bar: 2, numerator: 3, denominator: 4 }) });
    expect(barLengths(s)).toEqual([4, 4, 3, 3]);
  });

  it("ignores changes outside the section's bars and clamps at the end", () => {
    const s = section({ bars: 2, ...map({ bar: 0, numerator: 5, denominator: 4 }, { bar: 9, numerator: 2, denominator: 4 }) });
    expect(barLengths(s)).toEqual([5, 5]);
  });

  it("falls back to the declared meter for a malformed change", () => {
    const s = section({ bars: 2, ...map({ bar: 0, numerator: 0, denominator: 0 }) });
    expect(barLengths(s)).toEqual([4, 4]);
  });
});
