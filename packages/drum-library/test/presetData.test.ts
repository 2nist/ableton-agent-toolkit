import { describe, expect, it } from "vitest";
import { PRESET_DATA, PRESET_META, FILL_DATA } from "../src/presetData.js";

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

  it("acoustic staples remain corpus-sourced", () => {
    for (const pattern of ["standard", "half_time", "driving", "intense"] as const) {
      expect(PRESET_DATA[pattern]!.variants.every((v) => v.source.origin === "egmd"), pattern).toBe(true);
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
