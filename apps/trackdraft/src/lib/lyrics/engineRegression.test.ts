/**
 * Regression tests for the known-issue fixes applied when the lyric engine was
 * wired into TrackDraft (see REFACTOR_NOTES.md). Kept in their own file so the
 * kit's original suites stay the untouched spec for the pure modules.
 */
import { describe, expect, it } from "vitest";
import { analyzeLine, fromRecord, guessSyllables } from "./phonetics";
import { prosodyIssues, segmentPhrases, syllableSlots } from "./melodyPhrases";
import { deal } from "./seed";

describe("deal()", () => {
  it("throws on an empty pool instead of silently dealing undefined", () => {
    expect(() => deal([], "x", 0)).toThrow(/empty pool/);
    expect(() => deal([], "x", 7)).toThrow(/empty pool/);
  });

  it("still deals the full deck for a non-empty pool", () => {
    const pool = ["a", "b", "c"];
    const dealt = [0, 1, 2].map((n) => deal(pool, "s", n));
    expect(new Set(dealt).size).toBe(3);
  });
});

describe("guessSyllables", () => {
  it("counts people as two syllables (the -le rule keeps a syllabic l, not a silent e)", () => {
    expect(guessSyllables("people")).toBe(2);
    expect(guessSyllables("table")).toBe(2);
    expect(guessSyllables("little")).toBe(2);
    // the silent-e rule still applies when there is no syllabic -le
    expect(guessSyllables("mile")).toBe(1);
    expect(guessSyllables("cake")).toBe(1);
  });
});

describe("FUNCTION_WORDS demotion", () => {
  // the CMU dictionary stresses these; performance usually doesn't
  const pron = fromRecord({ we: "W IY1", are: "AA1 R", the: "DH AH0", ones: "W AH1 N Z" });

  it("demotes auxiliaries and pronouns that carry dictionary stress", () => {
    expect(analyzeLine("we are the ones", pron).stress).toEqual([0, 0, 0, 1]);
    // with demotion off they read as stressed, as the dictionary says
    expect(analyzeLine("we are the ones", pron, { demoteFunctionWords: false }).stress).toEqual([1, 1, 0, 1]);
  });
});

describe("prosodyIssues", () => {
  it("flags secondary stress on a weak slot too, not just primary", () => {
    const meter = { beatsPerBar: 4 };
    // note at beat 0.5 (eighth, weight .3) then a held note on beat 1
    const phrase = segmentPhrases([
      { pitch: 60, startTime: 0.5, duration: 0.25 },
      { pitch: 62, startTime: 1, duration: 1 },
    ])[0];
    const slots = syllableSlots(phrase, meter);
    const r = prosodyIssues([2, 0], slots);
    expect(r.issues).toContainEqual({ slot: 0, kind: "stressed-on-weak" });
  });
});
