import { describe, expect, it } from "vitest";
import {
  analyzeLine, analyzeWord, footFit, fromRecord, guessSyllables, parsePhones, rhymeKey,
  rhymeRelation, rhymeScheme, schemeString, stressMark,
} from "./phonetics";
import { prosodyIssues, segmentPhrases, syllableSlots } from "./melodyPhrases";

// A tiny ARPAbet fixture in CMU notation (vowels carry stress digits).
// Illustrative only — the app would inject the real dictionary.
const pron = fromRecord({
  night: "N AY1 T", light: "L AY1 T", time: "T AY1 M", boat: "B OW1 T",
  day: "D EY1", away: "AH0 W EY1", stay: "S T EY1",
  heart: "HH AA1 R T", apart: "AH0 P AA1 R T",
  river: "R IH1 V ER0", shiver: "SH IH1 V ER0",
  love: "L AH1 V", above: "AH0 B AH1 V", of: "AH1 V", the: "DH AH0",
  moon: "M UW1 N", soon: "S UW1 N", tune: "T UW1 N",
  walk: "W AO1 K", down: "D AW1 N",
});
const w = (s: string) => analyzeWord(s, pron)!;

describe("pronunciations", () => {
  it("parses ARPAbet, counting syllables and stress from the vowels", () => {
    const apart = w("apart");
    expect(apart.syllables).toBe(2);
    expect(apart.stress).toEqual([0, 1]);
    expect(parsePhones("HH AA1 R T").map((p) => p.stress)).toEqual([null, 1, null, null]);
  });

  it("normalizes case and punctuation, and skips non-words", () => {
    expect(analyzeWord("Night,", pron)!.word).toBe("night");
    expect(analyzeWord("—", pron)).toBeNull();
  });

  it("guesses syllables for unknown words and says so", () => {
    expect(guessSyllables("cake")).toBe(1); // silent e
    expect(guessSyllables("table")).toBe(2); // -le keeps its syllable
    expect(guessSyllables("beautiful")).toBe(3); // eau/i/u groups
    const u = analyzeWord("glimmering", pron)!;
    expect(u.known).toBe(false);
    expect(u.syllables).toBe(3);
    expect(u.stress).toEqual([1, 0, 0]);
  });
});

describe("analyzeLine", () => {
  it("builds a stress skeleton and demotes function words", () => {
    const l = analyzeLine("the river of night", pron);
    expect(l.stress).toEqual([0, 1, 0, 0, 1]);
    expect(stressMark(l.stress)).toBe("x/xx/");
    expect(l.syllables).toBe(5);
    expect(l.endWord!.word).toBe("night");
    // "of" is AH1 V in the dictionary; without demotion it counts as stressed
    expect(analyzeLine("the river of night", pron, { demoteFunctionWords: false }).stress).toEqual([0, 1, 0, 1, 1]);
  });

  it("lists words it had to guess", () => {
    expect(analyzeLine("walk down glimmering", pron).unknown).toEqual(["glimmering"]);
  });
});

describe("rhyme", () => {
  it("builds keys from the last stressed vowel", () => {
    expect(rhymeKey(w("night").phones!)!.key).toBe("AY T");
    expect(rhymeKey(w("apart").phones!)!.key).toBe("AA R T");
    expect(rhymeKey(w("river").phones!)).toEqual({ key: "IH V ER", vowel: "IH", tail: "", feminine: true });
  });

  it("classifies the relationship", () => {
    expect(rhymeRelation(w("night"), w("light"))).toBe("perfect");
    expect(rhymeRelation(w("heart"), w("apart"))).toBe("perfect");
    expect(rhymeRelation(w("river"), w("shiver"))).toBe("perfect");
    expect(rhymeRelation(w("moon"), w("soon"))).toBe("perfect");
    expect(rhymeRelation(w("night"), w("time"))).toBe("assonant");
    expect(rhymeRelation(w("night"), w("boat"))).toBe("consonant");
    expect(rhymeRelation(w("night"), w("night"))).toBe("identical");
    expect(rhymeRelation(w("night"), w("heart"))).toBe("none");
    // masculine vs feminine endings don't rhyme even when the vowel matches
    expect(rhymeRelation(w("love"), w("river"))).toBe("none");
  });
});

describe("rhymeScheme", () => {
  const scheme = (lines: string[]) => rhymeScheme(lines, pron);

  it("finds ABAB", () => {
    const e = scheme(["we walk down the night", "we walk away", "we walk to the light", "we walk and stay"]);
    expect(schemeString(e)).toBe("ABAB");
    expect(e.map((x) => x.relation)).toEqual(["new", "new", "perfect", "perfect"]);
  });

  it("finds AABB and restarts at a stanza break", () => {
    const e = scheme(["the light", "the night", "the moon", "the soon", "", "the day", "the away"]);
    expect(schemeString(e)).toBe("AABB CC");
  });

  it("marks a near rhyme with the same letter but says so", () => {
    const e = scheme(["the night", "the boat"]);
    expect(schemeString(e)).toBe("AA");
    expect(e[1].relation).toBe("consonant");
  });

  it("uses ? for an end word it cannot pronounce", () => {
    const e = scheme(["the night", "glimmering"]);
    expect(e[1]).toEqual({ line: 1, letter: "?", relation: "unknown" });
  });
});

describe("footFit", () => {
  it("names a clean repeating foot", () => {
    expect(footFit([0, 1, 0, 1, 0, 1, 0, 1])).toEqual({ foot: "iamb", fit: 1 });
    expect(footFit([1, 0, 1, 0, 1, 0])).toEqual({ foot: "trochee", fit: 1 });
    expect(footFit([0, 0, 1, 0, 0, 1])).toEqual({ foot: "anapest", fit: 1 });
    expect(footFit([1, 0, 0, 1, 0, 0])).toEqual({ foot: "dactyl", fit: 1 });
  });

  it("calls an irregular line mixed instead of grading it", () => {
    expect(footFit([1, 1, 0, 0, 1, 1, 0, 1]).foot).toBe("mixed");
    // one deviation in seven is still dactylic — reported with its fit, not rejected
    expect(footFit([1, 1, 0, 1, 0, 0, 1]).foot).toBe("dactyl");
    expect(footFit([1, 0]).foot).toBe("mixed");
  });
});

describe("with the melody", () => {
  it("feeds a line's stress skeleton into the prosody check", () => {
    const stress = analyzeLine("the river of night", pron).stress; // x/xx/
    const phrase = segmentPhrases([
      { pitch: 60, startTime: 0, duration: 1 }, { pitch: 62, startTime: 1, duration: 0.5 },
      { pitch: 64, startTime: 1.5, duration: 0.5 }, { pitch: 65, startTime: 2, duration: 1 },
      { pitch: 67, startTime: 3, duration: 1 },
    ])[0];
    const r = prosodyIssues(stress, syllableSlots(phrase, { beatsPerBar: 4 }));
    expect(r.countDelta).toBe(0);
    // "the" held on the downbeat and "of" held on beat 3: weak words on strong, long notes
    expect(r.issues.map((i) => i.slot)).toEqual([0, 3]);
  });
});
