import { describe, expect, it } from "vitest";
import { GENRE_GROOVES, inferPatternForGenre } from "../src/grooves.js";
import { inferDrumPattern } from "../src/infer.js";

/** A 4/4 acoustic-ish section (no odd meter) — where genre lean applies. */
const plainSection = { role: "chorus", velocity: "mf" };

describe("GENRE_GROOVES", () => {
  it("every listed role maps to families in the engine vocabulary", () => {
    // A lean family only matters if PRESET_DATA can actually play it; the
    // resolver skips unusable ones, but the table should still prefer
    // real families. At minimum every entry is a non-empty list.
    for (const [genre, profile] of Object.entries(GENRE_GROOVES)) {
      expect(profile.fallback.length, `${genre}.fallback`).toBeGreaterThan(0);
      for (const [role, families] of Object.entries(profile.patternsByRole ?? {})) {
        if (!families) continue; // Partial<Record> entries can be undefined
        expect(families.length, `${genre}.${role}`).toBeGreaterThan(0);
      }
    }
  });

  it("genres differ on exactly the roles that matter (rock chorus ≠ bossa chorus)", () => {
    const rockChorus = GENRE_GROOVES.rock.patternsByRole!.chorus!;
    const bossaChorus = GENRE_GROOVES.bossa.patternsByRole!.chorus!;
    // Rock leans intense/driving; bossa stays light — not the same vocabulary.
    expect(rockChorus[0]).toBe("intense");
    expect(bossaChorus[0]).toBe("standard");
  });
});

describe("inferPatternForGenre — family lean", () => {
  it("no genre → the existing heuristic (identical to inferDrumPattern)", () => {
    expect(inferPatternForGenre(plainSection, {}, undefined)).toBe(inferDrumPattern(plainSection, {}));
  });

  it("genre lean picks the role's preferred family over the generic heuristic", () => {
    // chorus + mf + no genre → "driving" (acoustic family per the heuristic).
    expect(inferDrumPattern(plainSection, {})).toBe("driving");
    // As "rock" the lean wins → intense.
    expect(inferPatternForGenre(plainSection, {}, "rock")).toBe("intense");
    // As "bossa" it stays light.
    expect(inferPatternForGenre({ role: "chorus", velocity: "mf" }, {}, "bossa")).toBe("standard");
  });

  it("odd meters win over the genre lean (a 7/8 section never gets a 4/4 family)", () => {
    const seven = { role: "chorus", velocity: "mf", timeSignatureNumerator: 7, timeSignatureDenominator: 8 };
    expect(inferPatternForGenre(seven, {}, "rock")).toBe("78");
  });

  it("falls to the heuristic when the genre's lean is empty for an unusual role", () => {
    // A role no profile lists falls back to the profile fallback / heuristic.
    expect(inferPatternForGenre({ role: "custom", velocity: "mf" }, {}, "rock")).toBe("standard");
  });

  it("is deterministic", () => {
    expect(inferPatternForGenre(plainSection, {}, "trap")).toBe(inferPatternForGenre(plainSection, {}, "trap"));
    expect(inferPatternForGenre(plainSection, {}, "trap")).toBe("trap");
  });
});
