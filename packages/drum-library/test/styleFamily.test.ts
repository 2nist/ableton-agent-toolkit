import { describe, it, expect } from "vitest";
import { styleAffinity, styleFamilyFor } from "../src/style-family.js";
import { pickVariantIndexFor } from "../src/handoffs.js";

describe("styleFamilyFor", () => {
  it("reads the genre field first", () => {
    expect(styleFamilyFor({ genre: "rock" })).toBe("rock");
    expect(styleFamilyFor({ genre: "Neo-Soul" })).toBe("soul");
    expect(styleFamilyFor({ genre: "bossa nova" })).toBe("latin");
  });

  it("prefers the specific family over the broad one it contains", () => {
    // Both words appear; punk is listed first for exactly this reason.
    expect(styleFamilyFor({ genre: "punk rock" })).toBe("punk");
    expect(styleFamilyFor({ genre: "pop rock" })).toBe("rock");
    expect(styleFamilyFor({ genre: "folk rock" })).toBe("rock");
  });

  it("falls back to the song's own description only when the genre says nothing", () => {
    expect(styleFamilyFor({ genre: "", concept: "a funk workout" })).toBe("funk");
    expect(styleFamilyFor({ genre: "rock", concept: "a funk workout" })).toBe("rock");
    expect(styleFamilyFor({ title: "Second Line Strut" })).toBe("neworleans");
  });

  it("returns undefined rather than guessing", () => {
    expect(styleFamilyFor(null)).toBeUndefined();
    expect(styleFamilyFor({})).toBeUndefined();
    // A ballad is a tempo, not a tradition — no family, no guess.
    expect(styleFamilyFor({ genre: "singer-songwriter balladry of the 1970s" })).toBeUndefined();
    expect(styleFamilyFor({ genre: "zzzz" })).toBeUndefined();
  });

  it("does not match inside a larger word", () => {
    // "housed" and "entrapment" are not families.
    expect(styleFamilyFor({ genre: "housed" })).toBeUndefined();
    expect(styleFamilyFor({ genre: "entrapment" })).toBeUndefined();
  });
});

describe("styleAffinity", () => {
  it("always lists the song's own family first", () => {
    expect(styleAffinity("rock")[0]).toBe("rock");
    expect(styleAffinity("funk")[0]).toBe("funk");
  });

  it("gives every family at least one neighbour", () => {
    for (const family of ["rock", "pop", "punk", "blues", "funk", "soul", "hiphop", "dance", "gospel", "country", "jazz", "latin", "afrocuban", "neworleans", "afrobeat", "middleeastern", "reggae"] as const) {
      expect(styleAffinity(family).length).toBeGreaterThan(1);
    }
  });

  it("is empty when there is no family to prefer", () => {
    expect(styleAffinity(undefined)).toEqual([]);
  });
});

describe("pickVariantIndexFor — style preference", () => {
  const variants = [
    { lengthBeats: 4, beatsPerBar: 4, style: "rock" },
    { lengthBeats: 4, beatsPerBar: 4, style: "funk" },
    { lengthBeats: 4, beatsPerBar: 4, style: "jazz" },
    { lengthBeats: 4, beatsPerBar: 4 }, // synth / mined: no style
  ];

  it("never picks outside the song's neighbourhood when it has material", () => {
    // 200 seeds: a rock song must never draw the jazz or untagged variants.
    for (let seed = 0; seed < 200; seed++) {
      const index = pickVariantIndexFor(seed, variants, 32, 4, 0, "rock");
      expect(["rock", "funk"].includes(String(variants[index]?.style))).toBe(true);
    }
  });

  it("falls back to the whole pool when the neighbourhood is empty", () => {
    const jazzOnly = [{ lengthBeats: 4, beatsPerBar: 4, style: "jazz" }];
    expect(pickVariantIndexFor(7, jazzOnly, 32, 4, 0, "rock")).toBe(0);
  });

  it("is unchanged when no style is given", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(pickVariantIndexFor(seed, variants, 32, 4)).toBe(pickVariantIndexFor(seed, variants, 32, 4, 0));
    }
  });
});
