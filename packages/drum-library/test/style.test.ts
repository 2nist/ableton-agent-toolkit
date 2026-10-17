import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE_PROFILE,
  STYLE_RECIPES,
  applyStyleToVariant,
  hasBend,
  resolveStyleProfile,
  styleBackbeat,
  styleFeel,
  styleHarmonize,
  styleProfileToEngineTargets,
  styleSeed,
  styleSpacing,
  styleVelocityTarget,
  velocityScaleFor,
  type StyleProfile,
} from "../src/style.js";
import type { PackedVariant } from "../src/presetData.js";

const SNARE = 38;
const KICK = 36;
const n = (beat: number, pitch: number, velocity: number) => [beat, pitch, velocity] as [number, number, number];

describe("velocityScaleFor — energy → velocity scale", () => {
  it("is 1.0 at neutral energy (0.5) and monotonic across the range", () => {
    expect(velocityScaleFor(0.5)).toBe(1.0);
    expect(velocityScaleFor(0)).toBeCloseTo(0.55, 5);
    expect(velocityScaleFor(1)).toBeCloseTo(1.2, 5);
    expect(velocityScaleFor(0.25)).toBeLessThan(1);
    expect(velocityScaleFor(0.75)).toBeGreaterThan(1);
  });

  it("clamps out-of-range input", () => {
    expect(velocityScaleFor(-1)).toBeCloseTo(0.55, 5);
    expect(velocityScaleFor(2)).toBeCloseTo(1.2, 5);
  });
});

describe("styleVelocityTarget — energy → scaled peak velocity", () => {
  it("neutral energy → the base target unchanged", () => {
    expect(styleVelocityTarget(96, DEFAULT_STYLE_PROFILE)).toBe(96);
  });

  it("high energy scales up, low scales down, both clamped to 1..127", () => {
    const loud = { ...DEFAULT_STYLE_PROFILE, energy: 1 };
    const quiet = { ...DEFAULT_STYLE_PROFILE, energy: 0 };
    expect(styleVelocityTarget(96, loud)).toBeGreaterThan(96);
    expect(styleVelocityTarget(96, quiet)).toBeLessThan(96);
    expect(styleVelocityTarget(120, loud)).toBeLessThanOrEqual(127);
    expect(styleVelocityTarget(30, quiet)).toBeGreaterThanOrEqual(1);
  });
});

describe("styleHarmonize — chord extension tint", () => {
  it("neutral harmony → quality unchanged", () => {
    expect(styleHarmonize({ quality: "maj" }, 0.5)).toBe("maj");
    expect(styleHarmonize({ quality: "maj7" }, 0.5)).toBe("maj7");
  });

  it("high harmony extends triads toward 7ths", () => {
    expect(styleHarmonize({ quality: "maj" }, 1)).toBe("maj7");
    expect(styleHarmonize({ quality: "min" }, 1)).toBe("min7");
    expect(styleHarmonize({ quality: "7" }, 1)).toBe("7"); // already dominant
  });

  it("low harmony reduces 7ths toward triads", () => {
    expect(styleHarmonize({ quality: "maj7" }, 0)).toBe("maj");
    expect(styleHarmonize({ quality: "min7" }, 0)).toBe("min");
  });

  it("an authored extendedSuffix always wins", () => {
    expect(styleHarmonize({ quality: "maj", extendedSuffix: "maj9" }, 1)).toBe("maj");
    expect(styleHarmonize({ quality: "min", extendedSuffix: "m11" }, 0)).toBe("min");
  });
});

describe("styleSpacing — harmony rhythm nudge", () => {
  it("neutral density → 1.0 (no re-timing)", () => {
    expect(styleSpacing(0.5)).toBe(1.0);
  });

  it("sparse (low) holds longer (>1), dense (high) tightens (<1)", () => {
    expect(styleSpacing(0)).toBeCloseTo(1.1, 5);
    expect(styleSpacing(1)).toBeCloseTo(0.9, 5);
    expect(styleSpacing(0.25)).toBeGreaterThan(1);
    expect(styleSpacing(0.75)).toBeLessThan(1);
  });
});

describe("styleProfileToEngineTargets", () => {
  it("neutral profile → velocityScale 1, centered tint axes, kitBias 0", () => {
    const t = styleProfileToEngineTargets(DEFAULT_STYLE_PROFILE);
    expect(t.velocityScale).toBe(1);
    expect(t.backbeat).toBe(0.5);
    expect(t.feel).toBe(0.5);
    expect(t.kitBias).toBe(0);
    expect(t.density).toBe(0.5);
    expect(t.harmony).toBe(0.5);
  });

  it("kit extremes map to -1 (acoustic) and +1 (electronic)", () => {
    expect(styleProfileToEngineTargets({ ...DEFAULT_STYLE_PROFILE, kit: 0 }).kitBias).toBe(-1);
    expect(styleProfileToEngineTargets({ ...DEFAULT_STYLE_PROFILE, kit: 1 }).kitBias).toBe(1);
  });
});

describe("styleSeed — deterministic, tempo-independent, occurrence-aware", () => {
  it("same profile + section → same seed", () => {
    expect(styleSeed(DEFAULT_STYLE_PROFILE, "verse-1", 0)).toBe(styleSeed(DEFAULT_STYLE_PROFILE, "verse-1", 0));
  });

  it("different profiles → different seeds; tempo is excluded", () => {
    const louder = { ...DEFAULT_STYLE_PROFILE, energy: 0.9 };
    expect(styleSeed(louder, "v", 0)).not.toBe(styleSeed(DEFAULT_STYLE_PROFILE, "v", 0));
    // Tempo must NOT change the groove seed (it's an orthogonal axis).
    const faster = { ...DEFAULT_STYLE_PROFILE, tempo: 190 };
    expect(styleSeed(faster, "v", 0)).toBe(styleSeed(DEFAULT_STYLE_PROFILE, "v", 0));
  });

  it("repeated occurrences seed differently (via occurrenceSeed)", () => {
    expect(styleSeed(DEFAULT_STYLE_PROFILE, "chorus", 0)).not.toBe(styleSeed(DEFAULT_STYLE_PROFILE, "chorus", 1));
  });
});

describe("resolveStyleProfile / hasBend — song master + per-section override", () => {
  const song = { bend: { energy: 0.9, feel: 0.2, tempo: 132 } };
  const section = {};

  it("no bend anywhere → neutral profile and hasBend false", () => {
    expect(hasBend({}, {})).toBe(false);
    expect(resolveStyleProfile({}, {})).toEqual(DEFAULT_STYLE_PROFILE);
  });

  it("song master applies to a section with no override", () => {
    expect(hasBend(section, song)).toBe(true);
    const resolved = resolveStyleProfile(section, song);
    expect(resolved.energy).toBe(0.9);
    expect(resolved.feel).toBe(0.2);
    expect(resolved.tempo).toBe(132);
    expect(resolved.backbeat).toBe(0.5); // unset axes fall through to neutral
  });

  it("a section override wins over the master, axis by axis (Partial)", () => {
    const overridden = { bend: { feel: 0.9 } }; // only feel differs from the master
    const resolved = resolveStyleProfile(overridden, song);
    expect(resolved.feel).toBe(0.9); // override wins
    expect(resolved.energy).toBe(0.9); // still from master
    expect(resolved.tempo).toBe(132); // still from master
    expect(resolved.density).toBe(0.5); // neutral elsewhere
  });

  it("a section-only bend counts as active", () => {
    expect(hasBend({ bend: { energy: 0.8 } }, {})).toBe(true);
  });

  it("melody-, bass- and tempo-only bends do not reseed the drums", () => {
    expect(hasBend({}, { bend: { melodyDensity: 0.9 } })).toBe(false);
    expect(hasBend({}, { bend: { melodyContour: 0.1 } })).toBe(false);
    expect(hasBend({}, { bend: { bassMotion: 1 } })).toBe(false);
    expect(hasBend({}, { bend: { tempo: 150 } })).toBe(false);
    expect(hasBend({ bend: { harmony: 0.9 } }, {})).toBe(false);
  });

  it("an explicit neutral drum axis does not count as a bend", () => {
    expect(hasBend({}, { bend: { energy: 0.5, feel: 0.5 } })).toBe(false);
    expect(hasBend({}, { bend: { energy: 0.5000001 } })).toBe(false);
    expect(hasBend({}, { bend: { energy: 0.51 } })).toBe(true);
  });
});

describe("styleFeel — swing/tighten", () => {
  it("0.5 leaves notes untouched", () => {
    const notes = [n(0, KICK, 100), n(1, SNARE, 90), n(2, KICK, 100)];
    expect(styleFeel(notes, 4, 0.5)).toEqual(notes);
  });

  it("above 0.5 swings offbeat 8ths toward triplet (2/3 of the beat)", () => {
    const notes = [n(0.5, SNARE, 100)]; // the "and" of beat 1
    const swung = styleFeel(notes, 4, 1.0);
    expect(swung[0][0]).toBeCloseTo(0.6667, 3);
    // Progressive: more feel → later offbeat.
    expect(styleFeel(notes, 4, 0.9)[0][0]).toBeLessThan(styleFeel(notes, 4, 1.0)[0][0]);
  });

  it("below 0.5 tightens to the 16th grid", () => {
    const notes = [n(0.1, SNARE, 100)]; // 0.1 is off-grid
    const tightened = styleFeel(notes, 4, 0.0);
    expect(tightened[0][0]).toBe(0); // snapped to the nearest 16th slot (0)
  });
});

describe("styleBackbeat — strengthen/soften 2&4", () => {
  it("0.5 leaves notes untouched", () => {
    const notes = [n(0, KICK, 100), n(1, SNARE, 90), n(3, SNARE, 90)];
    expect(styleBackbeat(notes, 4, 0.5)).toEqual(notes);
  });

  it("above 0.5 inserts a snare accent on 2&4 when none exists", () => {
    const notes = [n(0, KICK, 100), n(2, KICK, 100)]; // no snare at all
    const out = styleBackbeat(notes, 4, 1.0);
    const snares = out.filter((x) => x[1] === SNARE);
    expect(snares.map((x) => x[0])).toEqual([1, 3]);
    expect(snares[0][2]).toBeGreaterThan(80); // an accent, not a whisper
  });

  it("above 0.5 boosts an existing 2&4 snare rather than duplicating it", () => {
    const notes = [n(1, SNARE, 90), n(3, SNARE, 90)];
    const out = styleBackbeat(notes, 4, 1.0);
    const snares = out.filter((x) => x[1] === SNARE);
    expect(snares).toHaveLength(2); // no dupes
    expect(snares[0][2]).toBeGreaterThan(90);
  });

  it("below 0.5 softens the 2&4 snare (the light bossa touch)", () => {
    const notes = [n(1, SNARE, 90), n(3, SNARE, 90)];
    const out = styleBackbeat(notes, 4, 0.0);
    const snares = out.filter((x) => x[1] === SNARE);
    expect(snares[0][2]).toBeLessThan(90);
    expect(snares[0][2]).toBeGreaterThanOrEqual(24);
  });
});

describe("applyStyleToVariant", () => {
  const variant: PackedVariant = {
    lengthBeats: 4,
    beatsPerBar: 4,
    notes: [n(0, KICK, 100), n(1, SNARE, 90), n(3, SNARE, 90)],
    source: { origin: "egmd" },
  };

  it("neutral profile keeps the same notes (byte-compatible)", () => {
    expect(applyStyleToVariant(variant, DEFAULT_STYLE_PROFILE).notes).toEqual(variant.notes);
  });

  it("a bent profile transforms notes but preserves the variant's shape", () => {
    const bent: StyleProfile = { ...DEFAULT_STYLE_PROFILE, backbeat: 0.9, feel: 0.8 };
    const out = applyStyleToVariant(variant, bent);
    expect(out.lengthBeats).toBe(variant.lengthBeats);
    expect(out.beatsPerBar).toBe(variant.beatsPerBar);
    expect(out.source).toEqual(variant.source);
    expect(out.notes).not.toEqual(variant.notes);
  });

  it("is deterministic", () => {
    const bent: StyleProfile = { ...DEFAULT_STYLE_PROFILE, backbeat: 0.9, feel: 0.8 };
    expect(applyStyleToVariant(variant, bent).notes).toEqual(applyStyleToVariant(variant, bent).notes);
  });
});

describe("STYLE_RECIPES", () => {
  it("every recipe is a valid profile (0..1 axes, sane tempo)", () => {
    const keys = Object.keys(STYLE_RECIPES);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      const r = STYLE_RECIPES[key];
      for (const axis of ["energy", "density", "backbeat", "feel", "kit", "harmony"] as const) {
        expect(r[axis], `${key}.${axis}`).toBeGreaterThanOrEqual(0);
        expect(r[axis], `${key}.${axis}`).toBeLessThanOrEqual(1);
      }
      expect(r.tempo).toBeGreaterThan(0);
      expect(r.tempo).toBeLessThan(300);
    }
  });

  it("bossa and rock differ along exactly the axes that make them different", () => {
    const bossa = STYLE_RECIPES.bossa;
    const rock = STYLE_RECIPES.rock;
    expect(bossa.energy).toBeLessThan(rock.energy); // rock louder
    expect(bossa.backbeat).toBeLessThan(rock.backbeat); // rock locks 2&4
    expect(bossa.feel).toBeGreaterThan(rock.feel); // bossa swings more
    expect(bossa.harmony).toBeGreaterThan(rock.harmony); // bossa more extended
  });
});
