import { describe, expect, it } from "vitest";
import { PRESET_DATA, PRESET_META, FILL_DATA } from "../src/presetData.js";
import { fillPool } from "../src/handoffs.js";
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
        expect(["egmd", "synth", "zappa", "curated"], pattern).toContain(variant.source.origin);
      }
    }
  });

  it("machine idioms are synth-only", () => {
    for (const pattern of ["four_on_floor", "trap", "breakbeat", "dnb"] as const) {
      expect(PRESET_DATA[pattern]!.variants.every((v) => v.source.origin === "synth"), pattern).toBe(true);
    }
  });

  it("every pattern leads with authored material carrying corpus feel", () => {
    // The authored banks come FIRST, so the pattern's own character — and the
    // default variant — is written material. Mined takes may follow, but only
    // the ones that pass `selectableMined`'s gate: same meter, whole 1-2 bars,
    // density inside the authored band, no toms. `drumMusicality` holds that
    // gate for the whole pool.
    for (const pattern of ["kick_only", "standard", "half_time", "driving", "bridge_sparse", "intense", "78", "54", "68"] as const) {
      const variants = PRESET_DATA[pattern]!.variants;
      const curated = variants.filter((v) => v.source.origin === "curated");
      expect(curated.length, pattern).toBeGreaterThanOrEqual(3);
      // every authored variant precedes every corpus take
      const lastAuthored = variants.map((v) => v.source.origin).lastIndexOf("curated");
      const firstMined = variants.findIndex((v) => v.source.origin === "egmd" || v.source.origin === "zappa");
      if (firstMined !== -1) expect(firstMined, `${pattern} leads with authored material`).toBeGreaterThan(lastAuthored);
    }
  });

  it("and the corpus takes it offers are the ones that pass the gate", () => {
    // More options, not more noise: the appended takes are still whole-bar
    // grooves in the pattern's own density band.
    const withCorpus = (["standard", "driving", "intense", "half_time"] as const).filter((p) =>
      PRESET_DATA[p]!.variants.some((v) => v.source.origin === "egmd" || v.source.origin === "zappa"),
    );
    expect(withCorpus.length, "at least one pattern should offer corpus takes").toBeGreaterThan(0);
    for (const pattern of withCorpus) {
      const variant = PRESET_DATA[pattern]!.variants.find((v) => v.source.origin === "egmd" || v.source.origin === "zappa")!;
      const bars = variant.lengthBeats / variant.beatsPerBar;
      expect(bars).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(bars).toBeLessThanOrEqual(2 + 1e-6);
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
      expect(variant.notes.length).toBeGreaterThan(0);
    }
  });

  it("variant 0 — the auto default — is that pattern's own authored groove", () => {
    // It used to be a shared "clean downbeat" (snare on 1 & 3) prepended to
    // every acoustic bank, which meant a third of all auto picks ignored the
    // pattern name AND had no backbeat. Now each bank's own first variant is
    // the default.
    for (const pattern of ["standard", "half_time", "driving", "intense", "bridge_sparse", "kick_only"] as const) {
      const variant = PRESET_DATA[pattern]!.variants[0]!;
      expect(variant.source.origin, `${pattern} variant 0`).toBe("curated");
      expect(variant.source.generator, pattern).toContain(`${pattern}#0`);
    }
  });

  it("the default backbeat sits on 2 and 4, not on the downbeats", () => {
    const snare = ABLETON_SAFE_NOTES.snare;
    for (const pattern of ["standard", "driving", "intense"] as const) {
      const beats = PRESET_DATA[pattern]!.variants[0]!.notes
        // Ghost notes are snares too; the BACKBEAT is the loud ones.
        .filter((n) => n[1] === snare && n[2] > 45)
        .map((n) => n[0]);
      expect(beats, `${pattern} snare`).toHaveLength(2);
      // Within a few ms of beats 2 and 4 (the feel layer microtimes them).
      expect(Math.abs(beats[0]! - 1), pattern).toBeLessThan(0.05);
      expect(Math.abs(beats[1]! - 3), pattern).toBeLessThan(0.05);
    }
  });

  it("the half-time default puts its single backbeat on beat 3", () => {
    const snare = ABLETON_SAFE_NOTES.snare;
    const beats = PRESET_DATA.half_time!.variants[0]!.notes
      .filter((n) => n[1] === snare && n[2] > 45)
      .map((n) => n[0]);
    expect(beats).toHaveLength(1);
    expect(Math.abs(beats[0]! - 2)).toBeLessThan(0.05);
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

  it("ships fills for every meter the corpus/synth presets produce (baseline fill-completeness)", () => {
    // The pre-Zappa guarantee: any groove drawn from the corpus bake or the
    // synth idioms has a fill pool in its own meter. (Mined Zappa meters
    // only get fills where the scan actually found fill material —
    // `fillPool` degrades gracefully to "no fill" otherwise, and the
    // transition gestures still apply.)
    const meters = new Set(
      Object.values(PRESET_DATA).flatMap((preset) =>
        preset.variants.filter((v) => v.source.origin !== "zappa").map((v) => String(v.beatsPerBar)),
      ),
    );
    for (const meter of meters) {
      const available = (FILL_DATA.synth[meter]?.length ?? 0) + (FILL_DATA.acoustic[meter]?.length ?? 0);
      expect(available, `fills for ${meter} beats/bar`).toBeGreaterThan(0);
    }
  });

  it("zappa fills are pooled by meter and reach grooves in that meter", () => {
    const zappaFillMeters = Object.entries(FILL_DATA.acoustic)
      .filter(([, fills]) => fills.some((f) => f.source.origin === "zappa"))
      .map(([meter]) => meter);
    expect(zappaFillMeters.length).toBeGreaterThan(0);
    for (const meter of zappaFillMeters) {
      const probe = {
        lengthBeats: Number(meter),
        beatsPerBar: Number(meter),
        notes: [[0, 36, 100]] as Array<[number, number, number]>,
        source: { origin: "zappa" as const },
      };
      expect(fillPool(probe, FILL_DATA).length, `pool for ${meter}`).toBeGreaterThan(0);
    }
  });
});
