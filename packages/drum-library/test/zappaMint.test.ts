import { describe, expect, it } from "vitest";
import {
  BAKED_PRESETS,
  FILL_DATA,
  PRESET_DATA,
  PRESET_META,
  compatibleVariantIndices,
  fillPool,
  pickVariantIndex,
  pickVariantIndexFor,
  type PackedVariant,
} from "../src/index.js";
import { selectSectionGroove } from "../src/grooveSelect.js";

type VariantLike = Pick<PackedVariant, "lengthBeats" | "beatsPerBar">;
const v = (lengthBeats: number, beatsPerBar = 4): VariantLike => ({ lengthBeats, beatsPerBar });

describe("pickVariantIndexFor — meter-aware variant pick", () => {
  it("is bit-identical to pickVariantIndex when every variant is compatible (the 4/4 case)", () => {
    for (const count of [2, 3, 5, 8, 24]) {
      const list = Array.from({ length: count }, (_, i) => v(i % 3 === 0 ? 16 : i % 2 === 0 ? 8 : 4));
      for (let seed = 0; seed < 500; seed++) {
        expect(pickVariantIndexFor(seed, list, 16, 4), `count ${count} seed ${seed}`).toBe(
          pickVariantIndex(seed, count),
        );
      }
    }
  });

  it("routes a 7/8 section to 7/8 grooves and never to 4/4 ones", () => {
    const list = [v(4), v(4), v(16), v(3.5, 3.5), v(7, 3.5), v(4), v(3.5, 3.5)];
    // Four bars of 7/8 → 14 quarter beats; compatible = indices 3, 4, 6.
    for (let seed = 0; seed < 300; seed++) {
      expect([3, 4, 6]).toContain(pickVariantIndexFor(seed, list, 14, 3.5));
    }
  });

  it("excludes variants whose meter doesn't match, even when their length divides", () => {
    const list = [v(5.25, 5.25), v(3.5, 3.5), v(7, 4)];
    // A 21/16 section (2 bars = 10.5 beats): only the 5.25 groove is in
    // 21/16; the 3.5 groove's length divides but its meter doesn't match.
    for (let seed = 0; seed < 50; seed++) {
      expect(pickVariantIndexFor(seed, list, 10.5, 5.25)).toBe(0);
    }
  });

  it("falls back to the legacy pick when nothing is compatible", () => {
    const list = [v(4), v(4), v(4)];
    for (let seed = 0; seed < 200; seed++) {
      expect(pickVariantIndexFor(seed, list, 3, 3)).toBe(pickVariantIndex(seed, 3));
    }
  });

  it("keeps the ~35% clean-default share inside the compatible pool", () => {
    const list = [v(4), v(4), v(8), v(4), v(16)];
    let clean = 0;
    for (let seed = 0; seed < 1000; seed++) {
      if (pickVariantIndexFor(seed, list, 16, 4) === 0) clean++;
    }
    expect(clean).toBeGreaterThan(250);
    expect(clean).toBeLessThan(450);
  });
});

describe("minted Zappa material (data-driven)", () => {
  // The mint is FEEL now: curated patterns replace the mined note content in
  // `PRESET_DATA`, so anything auditing the mined material reads the bake.
  const zappa: Array<{ pattern: string; index: number; variant: PackedVariant }> = [];
  for (const [pattern, preset] of Object.entries(BAKED_PRESETS)) {
    if (!preset) continue;
    preset.variants.forEach((variant, index) => {
      if (variant.source.origin === "zappa") zappa.push({ pattern, index, variant });
    });
  }

  it("the bake carries the mined material", () => {
    expect(PRESET_META.mined?.zappa?.grooves ?? 0).toBeGreaterThan(30);
    expect(zappa.length).toBeGreaterThan(30);
  });

  it("every mined odd meter resolves to a groove in that meter", () => {
    const meters = new Set(zappa.map(({ variant }) => variant.beatsPerBar));
    for (const meter of meters) {
      if (Math.abs(meter - 4) < 0.01) continue;
      // Same derivation the schema's `meterForLength` uses.
      const denominator = [4, 8, 16, 2].find((d) => Math.abs((meter * d) / 4 - Math.round((meter * d) / 4)) < 1e-9) ?? 4;
      const numerator = Math.round((meter * denominator) / 4);
      const variant = selectSectionGroove({
        section: {
          id: `s${meter}`,
          role: "verse",
          velocity: "mf",
          name: "V",
          timeSignatureNumerator: numerator,
          timeSignatureDenPower: Math.log2(denominator),
        },
        song: { genre: "rock" },
        durationBeats: meter * 4,
        beatsPerBar: meter,
      });
      expect(variant, `${numerator}/${denominator}`).toBeTruthy();
      expect(Math.abs(variant!.beatsPerBar - meter), `${numerator}/${denominator}`).toBeLessThan(1e-6);
    }
  });

  it("a 7/8 section always resolves to a 7/8 groove, seeded or authored", () => {
    const section = { id: "v", role: "verse", velocity: "mf", name: "V", timeSignatureNumerator: 7, timeSignatureDenPower: 3 };
    const request = { song: { genre: "rock" }, durationBeats: 28, beatsPerBar: 3.5 };
    for (let occurrenceIndex = 0; occurrenceIndex < 40; occurrenceIndex++) {
      const variant = selectSectionGroove({ section: { ...section, id: `v${occurrenceIndex}` }, occurrenceIndex, ...request });
      expect(variant, `occurrence ${occurrenceIndex}`).toBeTruthy();
      expect(Math.abs(variant!.beatsPerBar - 3.5), `occurrence ${occurrenceIndex}`).toBeLessThan(1e-6);
    }
    // An explicitly chosen pattern in the WRONG meter must not drift either.
    const forced = selectSectionGroove({ section: { ...section, drumPattern: "standard" }, occurrenceIndex: 0, ...request });
    expect(Math.abs(forced!.beatsPerBar - 3.5)).toBeLessThan(1e-6);
    const forcedOther = selectSectionGroove({
      section: { id: "x", role: "verse", velocity: "mf", name: "V", timeSignatureNumerator: 4, timeSignatureDenPower: 2, drumPattern: "78" },
      occurrenceIndex: 0,
      song: { genre: "rock" },
      durationBeats: 32,
      beatsPerBar: 4,
    });
    expect(Math.abs(forcedOther!.beatsPerBar - 4)).toBeLessThan(1e-6);
  });

  it("zappa fills are pooled by their meter and reach their own grooves", () => {
    const acousticKeys = new Set(Object.keys(FILL_DATA.acoustic));
    const sampled = zappa.filter(({ variant }) => acousticKeys.has(String(variant.beatsPerBar)));
    expect(sampled.length).toBeGreaterThan(0);
    for (const { variant } of sampled.slice(0, 50)) {
      const pool = fillPool(variant, FILL_DATA);
      expect(pool.length, `${variant.beatsPerBar} beats/bar`).toBeGreaterThan(0);
      expect(pool.every((fill) => Math.abs(fill.beatsPerBar - variant.beatsPerBar) < 0.01)).toBe(true);
    }
  });
});
