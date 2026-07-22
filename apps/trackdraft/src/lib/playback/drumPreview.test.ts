import { describe, it, expect } from "vitest";
import { resolveDrumHits } from "./drumPreview";
import type { BlueprintSection } from "../../types/blueprint";

// "standard" is a real, always-present baked pattern (unlike "none", which
// has no preset at all) — used here for its stable *shape* (loops, has
// notes), not asserted against exact baked content, which legitimately
// changes when the corpus is re-baked (same reasoning drumClips.test.ts
// uses fixture presets for its exact-value assertions).
const PATTERN = "standard";

function makeSection(overrides: Partial<BlueprintSection> = {}): BlueprintSection {
  return {
    id: "sec-1",
    name: "Verse",
    role: "verse",
    bars: 2,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

describe("resolveDrumHits", () => {
  it("returns null for a pattern with no preset (e.g. 'none')", () => {
    expect(resolveDrumHits("none", undefined, makeSection(), 0.5)).toBeNull();
  });

  it("converts beat positions to real seconds via secPerBeat, not raw beats", () => {
    const section = makeSection({ bars: 1 }); // 4 beats @ 4/4
    const secPerBeat = 0.5; // 120bpm
    const hits = resolveDrumHits(PATTERN, 0, section, secPerBeat)!;
    expect(hits.length).toBeGreaterThan(0);
    // Every hit falls within the section's own duration in *seconds*
    // (4 beats * 0.5s/beat = 2s) — if beats were passed through unconverted
    // (the bug), hits would land at raw beat-sized offsets instead, which
    // for a 4-beat loop happen to only mostly overlap this bound by
    // coincidence, so the real check is the proportionality one below.
    for (const hit of hits) expect(hit.offsetSec).toBeGreaterThanOrEqual(0);

    const doubledTempoHits = resolveDrumHits(PATTERN, 0, section, secPerBeat * 2)!;
    // Same beat positions, double secPerBeat (half tempo) → every offset
    // should scale by exactly 2x, proving conversion is linear in
    // secPerBeat rather than a fixed/ignored value.
    hits.forEach((hit, i) => {
      expect(doubledTempoHits[i].offsetSec).toBeCloseTo(hit.offsetSec * 2, 5);
    });
  });

  it("tiles to fill a section longer than one loop, instead of stopping after one pass", () => {
    const shortSection = makeSection({ bars: 1 }); // 4 beats
    const longSection = makeSection({ bars: 8 }); // 32 beats — several loops of a 4-beat pattern
    const secPerBeat = 0.5;

    const shortHits = resolveDrumHits(PATTERN, 0, shortSection, secPerBeat)!;
    const longHits = resolveDrumHits(PATTERN, 0, longSection, secPerBeat)!;

    // A longer section tiles the same loop repeatedly, so it should have
    // meaningfully more hits and cover meaningfully more time — not just
    // the one loop's worth regardless of section length (the original bug
    // this locks in against: playDrumHits played one loop and went silent
    // for the rest of a longer section).
    expect(longHits.length).toBeGreaterThan(shortHits.length);
    const lastShort = Math.max(...shortHits.map((h) => h.offsetSec));
    const lastLong = Math.max(...longHits.map((h) => h.offsetSec));
    expect(lastLong).toBeGreaterThan(lastShort);
    // Roughly proportional to the 8x longer section (loose bound — tiling
    // adds per-tile micro-variation, not exact repetition).
    expect(lastLong).toBeGreaterThan(lastShort * 4);
  });

  it("clamps an out-of-range variantIndex instead of throwing", () => {
    const section = makeSection();
    expect(() => resolveDrumHits(PATTERN, 999, section, 0.5)).not.toThrow();
    expect(resolveDrumHits(PATTERN, 999, section, 0.5)).not.toBeNull();
  });
});
