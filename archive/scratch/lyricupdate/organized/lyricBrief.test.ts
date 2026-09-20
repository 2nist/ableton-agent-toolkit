import { describe, expect, it } from "vitest";
import { beatsPerBarFor, buildBrief, cadenceOf, feelOf, phraseStructure, type BriefInput } from "./lyricBrief";
import { segmentPhrases } from "./melodyPhrases";

// slots copied from the genre-catalog JSON (neo-psychedelia, neo-soul, math-rock)
const psychVerse: BriefInput = {
  id: "psych-verse", role: "verse", bars: 16, beatsPerBar: beatsPerBarFor(4, 2), beatsPerChord: 4,
  progression: ["I", "bVII", "IV", "I"], swing: 12,
  purpose: "FEEL: Hypnotic, submerged in a warm haze. PRODUCTION NOTE: Bury the vocal slightly under the instrumental bed.",
};
const psychChorus: BriefInput = {
  id: "psych-chorus", role: "chorus", bars: 8, beatsPerBar: 4, beatsPerChord: 4, progression: ["I", "v", "bVII", "IV"],
  purpose: "FEEL: Blooming, wider, more saturated. TRICK: Stack the vocal in parallel thirds.",
};
const psychFreakout: BriefInput = {
  id: "psych-freak", role: "breakdown", bars: 16, beatsPerBar: 4, beatsPerChord: 8, progression: ["I", "bVII"], optional: true,
  purpose: "FEEL: Full freakout. TRICK: Introduce a backwards guitar swell.",
};
const mathVerse: BriefInput = {
  id: "math-verse", role: "verse", bars: 12, beatsPerBar: beatsPerBarFor(7, 3), beatsPerChord: 4,
  purpose: "FEEL: Intricate, tight conversational pocket. PRODUCTION NOTE: crisp snare ghost notes.",
};

describe("helpers", () => {
  it("converts a time signature to quarter-note beats per bar", () => {
    expect(beatsPerBarFor(4, 2)).toBe(4);
    expect(beatsPerBarFor(7, 3)).toBe(3.5);
    expect(beatsPerBarFor(6, 3)).toBe(3);
  });

  it("lifts the FEEL sentence out of a purpose", () => {
    expect(feelOf(psychVerse.purpose)).toBe("Hypnotic, submerged in a warm haze");
    expect(feelOf("TRICK: no feel here.")).toBe(undefined);
  });

  it("classifies how a looping cell ends", () => {
    expect(cadenceOf(["I", "bVII", "IV", "I"])!.kind).toBe("home");
    expect(cadenceOf(["I", "v", "bVII", "IV"])).toEqual({ kind: "lift", last: "IV" });
    expect(cadenceOf(["I", "IV", "V7"])!.kind).toBe("open");
    expect(cadenceOf(["I"])!.kind).toBe("static");
    expect(cadenceOf(["ii7", "bIII7", "bII7"])!.kind).toBe("lift");
    expect(cadenceOf(undefined)).toBeNull();
    expect(cadenceOf([])).toBeNull();
  });
});

describe("phraseStructure", () => {
  it("derives phrase count from the chord cycle", () => {
    // 4 chords × 4 beats = 16 beats = 4 bars per pass; 16 bars = 4 passes
    expect(phraseStructure(psychVerse)).toEqual({ cycleBars: 4, cycles: 4, aligned: true, source: "harmony" });
    // ["I","bVII"] × 8 beats = 16 beats = 4 bars
    expect(phraseStructure(psychFreakout)!.cycles).toBe(4);
  });

  it("assumes 4-bar phrases when a slot has no chord cycle", () => {
    expect(phraseStructure(mathVerse)).toEqual({ cycleBars: 4, cycles: 3, aligned: true, source: "assumed" });
  });

  it("notes when the cycle drifts against the bar (7/8 with 4-beat chords)", () => {
    const drift = phraseStructure({ ...mathVerse, progression: ["I", "IV"] })!;
    expect(drift.cycleBars).toBe(2.29);
    expect(drift.aligned).toBe(false);
  });
});

describe("buildBrief", () => {
  it("builds a verse brief from harmony and feel (swing 12 is too straight to mention)", () => {
    const b = buildBrief(psychVerse);
    const kinds = b.prompts.map((p) => p.kind);
    expect(b.vocal).toBe(true);
    expect(kinds).toEqual(["job", "structure", "cadence", "feel", "rhyme", "constraint"]);
    expect(b.prompts[1].text).toContain("4 passes of a 4-bar chord cycle");
    expect(b.prompts[2].text).toContain("tonic");
    expect(b.prompts[3].text).toContain("Hypnotic, submerged in a warm haze");
  });

  it("mentions swing only when the section is really swung", () => {
    const swung = buildBrief({ ...psychVerse, swing: 62 });
    expect(swung.prompts.find((p) => p.kind === "density")!.text).toContain("Swung feel");
  });

  it("reads the chorus cell as a lift, not a landing", () => {
    const b = buildBrief(psychChorus);
    expect(b.cadence).toEqual({ kind: "lift", last: "IV" });
    expect(b.prompts.find((p) => p.kind === "cadence")!.text).toContain("a lift, not a landing");
  });

  it("treats an optional breakdown as instrumental unless a map says otherwise", () => {
    const b = buildBrief(psychFreakout);
    expect(b.vocal).toBe(false);
    expect(b.prompts).toHaveLength(1);
    expect(b.prompts[0].text).toContain("Instrumental by design");
    expect(buildBrief({ ...psychFreakout, lyric: { vocal: "lead" } }).vocal).toBe(true);
    expect(buildBrief({ ...psychVerse, lyric: { vocal: "none" } }).vocal).toBe(false);
  });

  it("uses the melody's phrases for syllable budgets and rhyme sites", () => {
    const phrases = segmentPhrases([
      { pitch: 60, startTime: 0, duration: 1 }, { pitch: 64, startTime: 1, duration: 1 }, { pitch: 62, startTime: 2, duration: 2 },
      { pitch: 65, startTime: 6, duration: 1 }, { pitch: 67, startTime: 7, duration: 1 },
    ]);
    const b = buildBrief({ ...psychVerse, phrases });
    const melody = b.prompts.filter((p) => p.kind === "melody");
    expect(melody[0].text).toContain("2 phrases of 3, 2 notes");
    expect(melody[1].text).toContain("Phrase 1 ends on a held note (2 beats)");
  });

  it("asks for contrast when the previous section's scheme is known", () => {
    const b = buildBrief({ ...psychVerse, priorScheme: "ABAB" });
    expect(b.prompts.find((p) => p.kind === "rhyme")!.text).toContain("previous section rhymed ABAB");
  });

  it("lets a map's lyric hints override the role default and set density", () => {
    const b = buildBrief({ ...psychVerse, lyric: { job: "Introduce the narrator by what they avoid.", density: "sparse" } });
    expect(b.prompts[0].text).toBe("Introduce the narrator by what they avoid.");
    expect(b.prompts.find((p) => p.kind === "density")!.text).toContain("Sparse section");
  });

  it("is deterministic per id + reroll, and a reroll changes the constraint", () => {
    const again = buildBrief(psychVerse).prompts.map((p) => p.text);
    expect(buildBrief(psychVerse).prompts.map((p) => p.text)).toEqual(again);
    const seen = new Set<string>();
    for (let r = 0; r < 8; r++) {
      seen.add(buildBrief({ ...psychVerse, reroll: r }).prompts.find((p) => p.kind === "constraint")!.text);
    }
    expect(seen.size > 1).toBe(true);
  });
});
