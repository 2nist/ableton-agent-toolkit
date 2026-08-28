import { describe, expect, it } from "vitest";
import { PRESET_DATA, PRESET_META, FILL_DATA } from "../src/presetData.js";
import { ABLETON_SAFE_NOTES } from "../src/ableton.js";

/**
 * These assert the *shape and merge policy* of the shipped preset library,
 * not exact corpus content — content legitimately changes when the pipeline
 * re-runs. Shape regressions here are what would break trackdraft-bridge.
 */
describe("PRESET_DATA (merged library)", () => {
  it("resolves every engine pattern except 'none'", () => {
    for (const pattern of [
      "kick_only", "standard", "half_time", "driving", "bridge_sparse", "intense",
      "dnb", "78", "68", "54", "four_on_floor", "trap", "breakbeat",
    ] as const) {
      expect(PRESET_DATA[pattern]?.variants.length, pattern).toBeGreaterThan(0);
    }
    expect(PRESET_DATA.none).toBeUndefined();
  });

  it("every variant declares length, bar length, notes and provenance", () => {
    for (const [pattern, preset] of Object.entries(PRESET_DATA)) {
      for (const variant of preset.variants) {
        expect(variant.lengthBeats, pattern).toBeGreaterThan(0);
        expect(variant.beatsPerBar, pattern).toBeGreaterThan(0);
        expect(variant.notes.length, pattern).toBeGreaterThan(0);
        expect(["egmd", "synth"], pattern).toContain(variant.source.origin);
      }
    }
  });

  it("machine idioms are synth-only; odd meters mix corpus and synth", () => {
    for (const pattern of ["four_on_floor", "trap", "breakbeat", "dnb"] as const) {
      expect(PRESET_DATA[pattern]!.variants.every((v) => v.source.origin === "synth"), pattern).toBe(true);
    }
    // 78 is synth-only because the corpus has none — but it must exist now.
    expect(PRESET_DATA["78"]!.variants.every((v) => v.source.origin === "synth")).toBe(true);
    // 54/68 must have at least the synthesized supplement.
    expect(PRESET_DATA["54"]!.variants.some((v) => v.source.origin === "synth")).toBe(true);
    expect(PRESET_DATA["68"]!.variants.some((v) => v.source.origin === "synth")).toBe(true);
  });

  it("acoustic staples remain corpus-sourced (with the clean downbeat default in front)", () => {
    for (const pattern of ["standard", "half_time", "driving", "intense", "bridge_sparse"] as const) {
      const variants = PRESET_DATA[pattern]!.variants;
      // Variant 0 is the synthesized clean downbeat groove (snare on the
      // downbeats) — the auto default; every variant behind it stays a
      // corpus take.
      expect(variants[0]!.source.origin, `${pattern} variant 0`).toBe("synth");
      expect(variants.slice(1).every((v) => v.source.origin === "egmd"), pattern).toBe(true);
    }
  });

  it("the clean downbeat default puts the snare exactly on the downbeats (1 & 3 in 4/4), no flams", () => {
    const snare = ABLETON_SAFE_NOTES.snare;
    const { notes } = PRESET_DATA.standard!.variants[0]!;
    const snareHits = notes.filter((n) => n[1] === snare).map((n) => n[0]);
    // Exactly two snare hits in the 4-beat loop, on beats 1 and 3.
    expect(snareHits).toEqual([0, 2]);
  });

  it("kick_only contains only kick hits, no leaked pedal-hat/cymbal notes", () => {
    // The "feet" limb it draws from legitimately includes the pedal hi-hat
    // (a real foot-played articulation), which folds onto the same pitch as
    // an ordinary closed hat (see ableton.ts) — without pitchFilter, a
    // "kick only" section could bake a take that's mostly or entirely
    // pedal-hat chatter with no kick in it at all.
    for (const variant of PRESET_DATA.kick_only!.variants) {
      const pitches = new Set(variant.notes.map((n) => n[1]));
      expect([...pitches], "kick_only variant pitches").toEqual([36]);
    }
  });

  it("carries bake provenance", () => {
    expect(PRESET_META.corpus).toBe("e-gmd-v1.0.0");
    expect(PRESET_META.generatedAt).toBeTruthy();
  });

  it("ships synthesized fills for every meter the presets produce", () => {
    const meters = new Set(
      Object.values(PRESET_DATA).flatMap((preset) => preset.variants.map((v) => String(v.beatsPerBar))),
    );
    for (const meter of meters) {
      const available = (FILL_DATA.synth[meter]?.length ?? 0) + (FILL_DATA.acoustic[meter]?.length ?? 0);
      expect(available, `fills for ${meter} beats/bar`).toBeGreaterThan(0);
    }
  });
});
