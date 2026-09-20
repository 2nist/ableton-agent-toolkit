/**
 * Adapter tests — real section/slot shapes in, `BriefInput` out.
 */
import { describe, expect, it } from "vitest";
import {
  briefInputFromSection, briefInputFromSlot, schemeOfLyrics, swingFromBendFeel,
  type SectionLike,
} from "./briefInput";
import { buildBrief } from "./lyricBrief";
import { fromRecord } from "./phonetics";

// A tiny ARPAbet fixture, same style as phonetics.test.ts.
const pron = fromRecord({
  night: "N AY1 T", light: "L AY1 T", away: "AH0 W EY1", stay: "S T EY1",
  we: "W IY1", walk: "W AO1 K", down: "D AW1 N", the: "DH AH0", and: "AH0 N D",
});

const verse: SectionLike = {
  id: "sec-verse",
  role: "verse",
  bars: 16,
  chords: [
    { romanNumeral: "I" }, { romanNumeral: "bVII" }, { romanNumeral: "IV" }, { romanNumeral: "I" },
  ],
  beatsPerChord: 4,
  velocity: "mf",
  timeSignatureNumerator: 4,
  timeSignatureDenPower: 2,
  transitionNote: "FEEL: Hypnotic, submerged in a warm haze. TRICK: Bury the vocal.",
  bend: { feel: 0.5 },
};

describe("briefInputFromSection", () => {
  it("maps the section's own fields 1:1", () => {
    const input = briefInputFromSection(verse);
    expect(input.id).toBe("sec-verse");
    expect(input.role).toBe("verse");
    expect(input.bars).toBe(16);
    expect(input.beatsPerBar).toBe(4);
    expect(input.beatsPerChord).toBe(4);
    expect(input.progression).toEqual(["I", "bVII", "IV", "I"]);
    expect(input.purpose).toContain("FEEL:");
    expect(input.energy).toBe(6); // "mf" → 6/10
    expect(input.reroll).toBeUndefined();
  });

  it("converts odd meters with beatsPerBarFor and lifts the FEEL sentence", () => {
    const math7 = { ...verse, timeSignatureNumerator: 7, timeSignatureDenPower: 3 };
    const b = buildBrief(briefInputFromSection(math7));
    expect(briefInputFromSection(math7).beatsPerBar).toBe(3.5);
    expect(b.feel).toBe("Hypnotic, submerged in a warm haze");
  });

  it("derives melody phrases from the section's captured melody", () => {
    const withMelody: SectionLike = {
      ...verse,
      melody: {
        notes: [
          { pitch: 60, startTime: 0, duration: 1 },
          { pitch: 64, startTime: 1, duration: 2 },
          { pitch: 65, startTime: 6, duration: 1 },
        ],
      },
    };
    const b = buildBrief(briefInputFromSection(withMelody));
    const melody = b.prompts.filter((p) => p.kind === "melody");
    expect(melody[0].text).toContain("2 phrases of 2, 1 notes");
    expect(melody[1].text).toContain("Phrase 1 ends on a held note (2 beats)");
    // no melody → no melody prompts
    expect(buildBrief(briefInputFromSection(verse)).prompts.some((p) => p.kind === "melody")).toBe(false);
  });

  it("maps the previous section's velocity to prevEnergy", () => {
    const input = briefInputFromSection(verse, { previous: { ...verse, id: "prev", velocity: "p" } });
    expect(input.prevEnergy).toBe(4); // "p" → 4/10
    const b = buildBrief(input);
    expect(b.prompts.find((p) => p.kind === "energy")!.text).toContain("steps up here (4 to 6");
  });

  it("reads the previous section's rhyme scheme when a pronouncer is injected", () => {
    const previous: SectionLike = {
      ...verse,
      id: "prev",
      lyrics: "we walk down the night\nwe walk away\nwe walk to the light\nwe walk and stay",
    };
    expect(briefInputFromSection(verse, { previous, pronouncer: pron }).priorScheme).toBe("ABAB");
    // no pronouncer → the brief falls back to a suggestion instead of a fact
    expect(briefInputFromSection(verse, { previous }).priorScheme).toBeUndefined();
    expect(
      buildBrief(briefInputFromSection(verse, { previous })).prompts.find((p) => p.kind === "rhyme")!.text,
    ).not.toContain("previous section");
  });

  it("passes reroll through: same counter → same prompts, new counter → new pick", () => {
    const texts = [0, 1, 2].map((reroll) =>
      buildBrief(briefInputFromSection(verse, { reroll })).prompts.find((p) => p.kind === "rhyme")!.text,
    );
    expect(new Set(texts).size).toBe(3);
    expect(buildBrief(briefInputFromSection(verse, { reroll: 1 }))).toEqual(buildBrief(briefInputFromSection(verse, { reroll: 1 })));
  });
});

describe("swingFromBendFeel", () => {
  it("keeps the neutral Bend feel neutral and only trips the hint when swung", () => {
    expect(swingFromBendFeel(undefined)).toBeUndefined();
    expect(swingFromBendFeel(0.5)).toBe(0); // neutral → straight reading
    expect(swingFromBendFeel(0.9)).toBe(80);
    expect(swingFromBendFeel(0)).toBe(-100);
    const neutral = buildBrief(briefInputFromSection(verse));
    const swung = buildBrief(briefInputFromSection({ ...verse, bend: { feel: 0.9 } }));
    expect(neutral.prompts.some((p) => p.kind === "density")).toBe(false);
    expect(swung.prompts.find((p) => p.kind === "density")!.text).toContain("Swung feel");
  });
});

describe("schemeOfLyrics", () => {
  it("returns undefined for empty text and for guessed end words", () => {
    expect(schemeOfLyrics("", pron)).toBeUndefined();
    expect(schemeOfLyrics("  \n ", pron)).toBeUndefined();
    expect(schemeOfLyrics("we walk down the night\nglimmering", pron)).toBeUndefined();
  });
});

describe("briefInputFromSlot", () => {
  const slot = {
    role: "breakdown" as const,
    label: "Breakdown",
    purpose: "FEEL: Full freakout. TRICK: Backwards guitar swell.",
    bars: 16,
    velocity: "f",
    beatsPerChord: 8,
    progression: ["I", "bVII"],
    swing: 12,
    optional: true,
  };

  it("seeds a fresh id from the map and applies section defaults", () => {
    const input = briefInputFromSlot(slot, "neo-psychedelia");
    expect(input.id).toBe("neo-psychedelia:Breakdown");
    expect(input.energy).toBe(7); // "f"
    expect(input.optional).toBe(true);
    expect(input.swing).toBe(12);
    // an optional breakdown is instrumental by design…
    expect(buildBrief(input).vocal).toBe(false);
    // …until a map says otherwise
    expect(buildBrief({ ...input, lyric: { vocal: "lead" } }).vocal).toBe(true);
  });

  it("falls back to the blank-section defaults (8 bars, straight 4/4)", () => {
    const input = briefInputFromSlot({ role: "intro", label: "Intro", purpose: "Set the world." }, "map-1");
    expect(input.bars).toBe(8);
    expect(input.beatsPerBar).toBe(4);
    expect(input.energy).toBeUndefined();
    expect(input.progression).toBeUndefined();
  });
});
