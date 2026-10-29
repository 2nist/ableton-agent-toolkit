import { describe, expect, it } from "vitest";
import { ABLETON_SAFE_NOTES } from "../src/ableton.js";
import {
  grooveOf,
  inferPatternForSection,
  outlineVariantFor,
  presetVariantAt,
  seededVariantIndexFor,
  selectSectionGroove,
  selectSectionGrooveAtMeter,
  exportSectionVariant,
  sectionDrumInput,
  humanizeOutlineVariant,
  type GrooveSection,
  type GrooveSong,
} from "../src/grooveSelect.js";
import { PRESET_DATA } from "../src/presetData.js";
import type { PackedPreset } from "../src/presetData.js";
import type { DrumPattern } from "../src/presets.js";
import type { CellVoice } from "../src/meter.js";
import { DEFAULT_STYLE_PROFILE } from "../src/style.js";

const section = (overrides: Partial<GrooveSection> = {}): GrooveSection => ({
  id: "section-a",
  role: "chorus",
  velocity: "mf",
  name: "Chorus",
  timeSignatureNumerator: 4,
  timeSignatureDenPower: 2,
  ...overrides,
});

const request = (overrides: Partial<Parameters<typeof selectSectionGroove>[0]> = {}) => ({
  section: section(),
  durationBeats: 32,
  beatsPerBar: 4,
  ...overrides,
});

/** Small fixture presets — the real bake legitimately changes shape, so these
 *  tests assert the RULES, not baked content. */
const PRESETS: Partial<Record<DrumPattern, PackedPreset>> = {
  standard: {
    variants: [
      { lengthBeats: 4, beatsPerBar: 4, notes: [[0, 36, 100], [2, 38, 90]], source: { origin: "synth" } },
      { lengthBeats: 4, beatsPerBar: 4, notes: [[1, 36, 100]], source: { origin: "synth" } },
      { lengthBeats: 4, beatsPerBar: 4, notes: [[3, 36, 100]], source: { origin: "synth" } },
    ],
  },
  // Two ways a variant can be present but unplayable.
  trap: {
    variants: [
      { lengthBeats: 4, beatsPerBar: 4, notes: [], source: { origin: "synth" } },
      { lengthBeats: 0, beatsPerBar: 4, notes: [[0, 36, 100]], source: { origin: "synth" } },
    ],
  },
};

describe("grooveOf — the five fields read as one value", () => {
  it("no field set → auto", () => {
    expect(grooveOf(section())).toEqual({ kind: "auto" });
  });

  it("`none` → muted, not a preset named none", () => {
    expect(grooveOf(section({ drumPattern: "none" }))).toEqual({ kind: "muted" });
  });

  it("an authored pattern carries its variant", () => {
    expect(grooveOf(section({ drumPattern: "driving", drumVariantIndex: 3 }))).toEqual({
      kind: "preset",
      pattern: "driving",
      variant: 3,
    });
  });

  it("an outline wins over an authored pattern", () => {
    const outlined = section({
      drumPattern: "driving",
      drumMeterOutline: { cellBeats: 0.5, cells: [2, 2, 3], label: "1 2 1 2 1 2 3" },
    });
    expect(grooveOf(outlined).kind).toBe("outline");
  });
});

describe("inferPatternForSection", () => {
  it("odd meter wins over genre", () => {
    const sevenEight = section({ timeSignatureNumerator: 7, timeSignatureDenPower: 3 });
    expect(inferPatternForSection(sevenEight, { genre: "rock" })).toBe("78");
  });

  it("the song's genre lean beats the bare heuristic", () => {
    const song: GrooveSong = { genre: "rock" };
    expect(inferPatternForSection(section(), song)).toBe("intense");
    expect(inferPatternForSection(section())).toBe("driving");
  });

  it("refrain resolves to the chorus family (no separate vocabulary)", () => {
    const refrain = inferPatternForSection(section({ role: "refrain" }), { genre: "rock" });
    const chorus = inferPatternForSection(section({ role: "chorus" }), { genre: "rock" });
    expect(refrain).toBe(chorus);
  });
});

describe("presetVariantAt", () => {
  it("clamps an out-of-range index instead of returning undefined", () => {
    expect(presetVariantAt("standard", 99, PRESETS)).toBe(PRESETS.standard!.variants[2]);
  });

  it("an absent index is variant 0", () => {
    expect(presetVariantAt("standard", undefined, PRESETS)).toBe(PRESETS.standard!.variants[0]);
  });

  it("returns null for an unplayable variant", () => {
    expect(presetVariantAt("trap", 0, PRESETS)).toBeNull(); // no notes
    expect(presetVariantAt("trap", 1, PRESETS)).toBeNull(); // zero length
  });

  it("returns null for a pattern with no baked content", () => {
    expect(presetVariantAt("driving", 0, PRESETS)).toBeNull();
  });
});

describe("selectSectionGroove — priority", () => {
  it("muted is silent", () => {
    expect(selectSectionGroove(request({ section: section({ drumPattern: "none" }) }))).toBeNull();
  });

  it("an authored pattern wins over the heuristic", () => {
    const chosen = selectSectionGroove(
      request({ section: section({ drumPattern: "standard", drumVariantIndex: 1 }), presetData: PRESETS }),
    );
    expect(chosen).toBe(PRESETS.standard!.variants[1]);
  });

  it("auto falls through to the heuristic", () => {
    // "intense" is a real baked pattern, so an auto rock chorus resolves.
    const chosen = selectSectionGroove(request({ section: section({ role: "chorus" }), song: { genre: "rock" } }));
    expect(chosen).not.toBeNull();
    expect(chosen!.notes.length).toBeGreaterThan(0);
  });

  it("an outline returns its own notes, UN-humanised", () => {
    const outline = { cellBeats: 0.5, cells: [2, 3] as (2 | 3)[], label: "1 2 1 2 3" };
    const chosen = selectSectionGroove(request({ section: section({ drumMeterOutline: outline }) }))!;
    expect(chosen.notes).toEqual(outlineVariantFor(outline).notes);
    expect(chosen.lengthBeats).toBe(2.5);
    expect(chosen.source.generator).toBe("outline-default-voices");
  });

  it("an outline with no assigned voices still plays drums, not a click", () => {
    // It used to resolve to `outlineToClickPattern`: hats and nothing else. You
    // apply a Euclidean groove, the grid fills with hi-hats, and the kick and
    // snare you can see in the editor never appear.
    const outline = { cellBeats: 0.5, cells: [2, 2, 2, 2] as (2 | 3)[], label: "2 2 2 2" };
    const chosen = selectSectionGroove(request({ section: section({ drumMeterOutline: outline }) }))!;
    expect(new Set(chosen.notes.map(([, pitch]) => pitch)).size).toBeGreaterThan(1);
    // one kick on the downbeat, one snare at the bar's halfway point
    expect(chosen.notes[0]![1]).toBe(ABLETON_SAFE_NOTES.kick);
    expect(chosen.notes.some(([, pitch]) => pitch === ABLETON_SAFE_NOTES.snare)).toBe(true);
    expect(chosen.notes.every(([, , v]) => v > 0)).toBe(true);
  });

  it("an outline's cellVoices produce a real groove, not a click", () => {
    const outline = { cellBeats: 0.5, cells: [2, 2] as (2 | 3)[], label: "1 2 1 2", cellVoices: ["kick", "snare"] as CellVoice[] };
    const chosen = selectSectionGroove(request({ section: section({ drumMeterOutline: outline }) }))!;
    expect(chosen.source.generator).toBe("outline-groove");
    expect(new Set(chosen.notes.map(([, pitch]) => pitch)).size).toBeGreaterThan(1);
  });
});

describe("humanizeOutlineVariant", () => {
  it("keeps every onset and the note count (it is timing, not content)", () => {
    const outline = { cellBeats: 0.5, cells: [2, 2, 3] as (2 | 3)[], label: "1 2 1 2 1 2 3" };
    const raw = outlineVariantFor(outline);
    const human = humanizeOutlineVariant(outline, raw);
    expect(human.notes).toHaveLength(raw.notes.length);
    expect(human.lengthBeats).toBe(raw.lengthBeats);
  });

  it("falls back to the untouched notes when there is no reference performance", () => {
    const outline = { cellBeats: 0.5, cells: [2, 2] as (2 | 3)[], label: "1 2 1 2" };
    const raw = outlineVariantFor(outline);
    expect(humanizeOutlineVariant(outline, raw, {}).notes).toEqual(raw.notes);
  });
});

describe("seededVariantIndexFor", () => {
  it("an explicit index wins over the deterministic pick", () => {
    const picks = new Set(
      Array.from({ length: 6 }, (_, i) =>
        seededVariantIndexFor({ ...request({ section: section({ drumPattern: "standard" }) }), pattern: "standard", occurrenceIndex: i }),
      ),
    );
    expect(picks.size).toBeGreaterThan(1); // the seed actually varies
    expect(
      seededVariantIndexFor({
        ...request({ section: section({ drumPattern: "standard", drumVariantIndex: 2 }) }),
        pattern: "standard",
      }),
    ).toBe(2);
  });

  it("is deterministic for the same section + occurrence", () => {
    const args = { ...request(), pattern: "standard" as const };
    expect(seededVariantIndexFor(args)).toBe(seededVariantIndexFor(args));
  });

  it("undefined for a pattern with no baked content", () => {
    expect(seededVariantIndexFor({ ...request(), pattern: "standard", presetData: {} })).toBeUndefined();
  });

  it("draws a different groove once a bend is dialled in (controls, not dice)", () => {
    const neutral = seededVariantIndexFor({ ...request(), pattern: "standard" });
    const bent = seededVariantIndexFor({
      ...request({ section: section({ drumPattern: "standard", bend: { energy: 0.9 } }) }),
      pattern: "standard",
    });
    const again = seededVariantIndexFor({
      ...request({ section: section({ drumPattern: "standard", bend: { energy: 0.9 } }) }),
      pattern: "standard",
    });
    expect(again).toBe(bent); // same slider position → same groove
    expect(typeof bent).toBe("number");
    expect(typeof neutral).toBe("number");
  });

  it("gives a repeated section a different variant on the second pass", () => {
    const first = seededVariantIndexFor({ ...request(), pattern: "standard", occurrenceIndex: 0 });
    const second = seededVariantIndexFor({ ...request(), pattern: "standard", occurrenceIndex: 1 });
    expect(first).not.toBe(second);
  });
});

describe("the real baked library", () => {
  it("every pattern the heuristic can name actually resolves", () => {
    const patterns = ["standard", "driving", "half_time", "bridge_sparse", "intense", "kick_only", "dnb", "78", "68", "54"] as const;
    for (const pattern of patterns) {
      expect(PRESET_DATA[pattern]?.variants.length ?? 0, pattern).toBeGreaterThan(0);
      const picked = seededVariantIndexFor({ ...request(), pattern });
      expect(typeof picked, pattern).toBe("number");
    }
  });
});

describe("selectSectionGrooveAtMeter", () => {
  it("re-detects the meter so a 7/8 run draws a 7/8 groove, not a chopped 4/4 one", () => {
    const sevenEight = selectSectionGrooveAtMeter(request(), { numerator: 7, denominator: 8 });
    expect(sevenEight).not.toBeNull();
    // A 7/8 bar is 3.5 quarter-note beats, not 7.
    expect(sevenEight!.beatsPerBar).toBeCloseTo(3.5, 9);
  });

  it("leaves a 4/4 request resolving to a 4/4 groove", () => {
    const fourFour = selectSectionGrooveAtMeter(request(), { numerator: 4, denominator: 4 });
    expect(fourFour!.beatsPerBar).toBe(4);
  });
});

describe("sectionDrumInput — the section fields, mapped once", () => {
  const outline = { cellBeats: 0.5, cells: [2, 3] as (2 | 3)[], label: "1 2 1 2 3" };

  it("carries the section's drum fields through unchanged", () => {
    const variant = outlineVariantFor(outline);
    const input = sectionDrumInput({
      section: {
        id: "s1",
        role: "chorus",
        drumMeterOutline: outline,
        drumLaneMute: ["rim"],
        drumVariationBars: 2,
        drumVariationStartBeat: 8,
        drumTransitionBars: 1,
      },
      occurrenceIndex: 2,
      durationBeats: 20,
      beatsPerBar: 2.5,
      variant,
      velocityTarget: 96,
      transitionModel: "buildUp",
    });
    expect(input).toMatchObject({
      sectionId: "s1",
      occurrenceIndex: 2,
      role: "chorus",
      beatsPerBar: 2.5,
      variant,
      outline,
      mute: ["rim"],
      variationBars: 2,
      variationStartBeat: 8,
      transitionModel: "buildUp",
      transitionBars: 1,
      // An outline's own subdivision is the grid transitions sit on.
      gridBeats: 0.5,
      durationBeats: 20,
      velocityTarget: 96,
    });
    expect(input.barBeats).toBeUndefined();
  });

  it("uses a 16th grid and a null role for a plain preset section", () => {
    const input = sectionDrumInput({
      section: { id: "s2" },
      occurrenceIndex: 0,
      durationBeats: 16,
      beatsPerBar: 4,
      variant: null,
      velocityTarget: 96,
      transitionModel: null,
    });
    expect(input.gridBeats).toBe(0.25);
    expect(input.role).toBeNull();
    expect(input.outline).toBeNull();
  });

  it("carries a meter change only when there is one", () => {
    const input = sectionDrumInput({
      section: { id: "s3" },
      occurrenceIndex: 0,
      durationBeats: 16,
      beatsPerBar: 4,
      variant: null,
      velocityTarget: 96,
      transitionModel: null,
      barBeats: [4, 3.5],
      meterVariants: { "3.5": outlineVariantFor({ cellBeats: 0.5, cells: [2, 2, 3], label: "1 2 1 2 1 2 3" }) },
    });
    expect(input.barBeats).toEqual([4, 3.5]);
    expect(Object.keys(input.meterVariants!)).toEqual(["3.5"]);
  });
});

describe("exportSectionVariant", () => {
  const neutral = DEFAULT_STYLE_PROFILE;

  it("is null for a muted section", () => {
    expect(exportSectionVariant(request({ section: section({ drumPattern: "none" }) }), neutral)).toBeNull();
  });

  it("humanises an outline (the preview path does not)", () => {
    const outline = { cellBeats: 0.5, cells: [2, 2, 3] as (2 | 3)[], label: "1 2 1 2 1 2 3" };
    const req = request({ section: section({ drumMeterOutline: outline }) });
    const selected = selectSectionGroove(req)!;
    const exported = exportSectionVariant(req, neutral)!;
    // Humanisation draws real microtiming AND dynamics from a baked
    // performance, so the notes are the same onsets played differently — not
    // the same grid.
    expect(exported.notes).toHaveLength(selected.notes.length);
    expect(exported.notes).not.toEqual(selected.notes);
  });
});
