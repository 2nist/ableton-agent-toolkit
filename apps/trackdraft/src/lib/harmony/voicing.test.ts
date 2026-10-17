import { describe, it, expect } from "vitest";
import {
  bassName,
  cycleInversion,
  inversionCount,
  normalizeVoicing,
  toggleSpread,
  voicingLabel,
  withVoicing,
} from "./voicing";
import type { Chord } from "../../types/blueprint";

const chord = (quality: Chord["quality"] = "maj"): Chord => ({
  id: "c1",
  romanNumeral: "I",
  root: "C",
  quality,
  beats: 4,
});

describe("inversionCount", () => {
  it("counts the tones in the chord", () => {
    expect(inversionCount(chord("maj"))).toBe(3);
    expect(inversionCount(chord("maj7"))).toBe(4);
    expect(inversionCount(chord("sus2"))).toBe(3);
  });
});

describe("cycleInversion", () => {
  it("walks root → 1st → 2nd → root for a triad", () => {
    const first = cycleInversion(chord());
    expect(first.voicing).toEqual({ inversion: 1 });
    const second = cycleInversion(first);
    expect(second.voicing).toEqual({ inversion: 2 });
    const wrapped = cycleInversion(second);
    expect(wrapped.voicing).toBeUndefined();
  });

  it("offers a third inversion on a seventh chord", () => {
    let next = chord("maj7");
    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      next = cycleInversion(next);
      seen.push(next.voicing?.inversion ?? 0);
    }
    expect(seen).toEqual([1, 2, 3, 0]);
  });

  it("keeps an open spread while the bass changes", () => {
    const open = { ...chord(), voicing: { spread: "open" as const } };
    expect(cycleInversion(open).voicing).toEqual({ inversion: 1, spread: "open" });
  });
});

describe("toggleSpread", () => {
  it("toggles close ↔ open and drops the default again", () => {
    const open = toggleSpread(chord());
    expect(open.voicing).toEqual({ spread: "open" });
    expect(toggleSpread(open).voicing).toBeUndefined();
  });

  it("keeps the inversion while the spread changes", () => {
    const inverted = cycleInversion(chord());
    expect(toggleSpread(inverted).voicing).toEqual({ inversion: 1, spread: "open" });
  });
});

describe("normalizeVoicing", () => {
  it("drops root position and close spacing", () => {
    expect(normalizeVoicing({ inversion: 0, spread: "close" })).toBeUndefined();
    expect(normalizeVoicing(undefined)).toBeUndefined();
  });

  it("keeps only the meaningful parts", () => {
    expect(normalizeVoicing({ inversion: 2, spread: "close" })).toEqual({ inversion: 2 });
    expect(normalizeVoicing({ inversion: 0, spread: "open" })).toEqual({ spread: "open" });
  });
});

describe("withVoicing", () => {
  it("leaves the rest of the chord alone", () => {
    const voiced = withVoicing(chord(), { inversion: 1 });
    expect(voiced).toMatchObject({ id: "c1", root: "C", quality: "maj", beats: 4 });
  });
});

describe("labels", () => {
  it("names the bass tone", () => {
    expect(bassName(0)).toBe("root");
    expect(bassName(1)).toBe("first");
    expect(bassName(2)).toBe("second");
    expect(bassName(3)).toBe("third");
  });

  it("reads out the whole voicing", () => {
    expect(voicingLabel(chord())).toBe("root · close");
    expect(voicingLabel({ voicing: { inversion: 1, spread: "open" } })).toBe("first · open");
  });
});
