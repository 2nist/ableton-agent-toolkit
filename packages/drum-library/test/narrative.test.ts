import { describe, expect, it } from "vitest";
import {
  DEFAULT_NARRATIVE_PROFILE,
  hasNarrative,
  NARRATIVE_STRUCTURAL_WARP_THRESHOLD,
  NARRATIVE_TRANSITION_BUILD_THRESHOLD,
  NARRATIVE_TRANSITION_DRAIN_THRESHOLD,
  applyNarrativeDelta,
  narrativeHarmonyOutline,
  narrativeHarmonySection,
  narrativeToStyleDelta,
  narrativeTransitionModel,
  resolveEffectiveStyle,
  resolveNarrativeProfile,
  type NarrativeProfile,
} from "../src/narrative.js";
import { DEFAULT_STYLE_PROFILE, resolveStyleProfile } from "../src/style.js";

const neutral = (): NarrativeProfile => ({ ...DEFAULT_NARRATIVE_PROFILE });
const arc = (overrides: Partial<NarrativeProfile> = {}): NarrativeProfile => ({ ...neutral(), ...overrides });

describe("resolveNarrativeProfile — song master + section override", () => {
  it("is all-neutral when nobody opted in", () => {
    expect(resolveNarrativeProfile({}, {})).toEqual(DEFAULT_NARRATIVE_PROFILE);
    expect(resolveNarrativeProfile(undefined, undefined)).toEqual(DEFAULT_NARRATIVE_PROFILE);
  });

  it("lets the section's narrative win wholesale over the song master", () => {
    // NOTE: a narrative is a COMPLETE profile (unlike `bend`, which is a
    // Partial), so a section override replaces every axis — an override that
    // wants to keep the master's tension has to restate it. This test records
    // that semantics so changing it to a per-axis merge is a deliberate act.
    const section = { narrative: arc({ structural_warp: 0.9 }) };
    const song = { narrative: arc({ tension_profile: 0.8, structural_warp: 0.1 }) };
    const resolved = resolveNarrativeProfile(section, song);
    expect(resolved.structural_warp).toBe(0.9); // section wins
    expect(resolved.tension_profile).toBe(0.5); // replaced by the section's neutral
  });

  it("carries the master's axes through when the section has none", () => {
    const song = { narrative: arc({ tension_profile: 0.8, structural_warp: 0.1 }) };
    expect(resolveNarrativeProfile({}, song)).toMatchObject({ tension_profile: 0.8, structural_warp: 0.1 });
  });

  it("treats an explicit null as absent", () => {
    expect(resolveNarrativeProfile({ narrative: null }, { narrative: null })).toEqual(DEFAULT_NARRATIVE_PROFILE);
  });
});

describe("hasNarrative — only a non-neutral arc counts", () => {
  it("is false when nobody carries one", () => {
    expect(hasNarrative({}, {})).toBe(false);
    expect(hasNarrative(undefined, undefined)).toBe(false);
  });

  it("is false for an explicit all-neutral arc (the no-op contract)", () => {
    expect(hasNarrative({ narrative: neutral() }, {})).toBe(false);
    expect(hasNarrative({}, { narrative: neutral() })).toBe(false);
  });

  it("is true as soon as any axis leaves neutral", () => {
    expect(hasNarrative({ narrative: arc({ structural_warp: 0.9 }) }, {})).toBe(true);
    expect(hasNarrative({}, { narrative: arc({ rhythmic_energy: 0.6 }) })).toBe(true);
    expect(hasNarrative({ narrative: arc({ transition_delta: -0.5 }) }, {})).toBe(true);
  });
});

describe("narrativeToStyleDelta", () => {
  it("a neutral narrative produces exactly zero deltas", () => {
    expect(Object.values(narrativeToStyleDelta(neutral()))).toEqual(new Array(8).fill(0));
  });

  it("centres energy on 0.5 and flips sign across it", () => {
    expect(narrativeToStyleDelta(arc({ rhythmic_energy: 0.5 })).energy).toBe(0);
    expect(narrativeToStyleDelta(arc({ rhythmic_energy: 1 })).energy).toBeGreaterThan(0);
    expect(narrativeToStyleDelta(arc({ rhythmic_energy: 0 })).energy).toBeLessThan(0);
  });

  it("bends harmony with tension, not with energy", () => {
    expect(narrativeToStyleDelta(arc({ tension_profile: 1 })).harmony).toBeGreaterThan(0);
    expect(narrativeToStyleDelta(arc({ tension_profile: 1 })).energy).toBe(0);
  });

  it("keeps every delta inside ±0.5", () => {
    for (const delta of Object.values(narrativeToStyleDelta(arc({ tension_profile: 1, rhythmic_energy: 0 })))) {
      expect(Math.abs(delta)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("applyNarrativeDelta / resolveEffectiveStyle", () => {
  it("does not invent optional axes it was not given", () => {
    // `DEFAULT_STYLE_PROFILE` carries the melody axes but not
    // tension/articulation/bassVelocity — those three must stay absent so a
    // song that never opted into Bend keeps its exact historical output.
    const base = { ...DEFAULT_STYLE_PROFILE };
    const out = applyNarrativeDelta(base, narrativeToStyleDelta(arc({ tension_profile: 1 })));
    expect(out.tension).toBeUndefined();
    expect(out.articulation).toBeUndefined();
    expect(out.bassVelocity).toBeUndefined();
    expect(out.melodyDensity).toBeDefined();
    expect(out.melodyContour).toBeDefined();
  });

  it("clamps to 0..1 rather than running past the axis' range", () => {
    const base = { ...DEFAULT_STYLE_PROFILE, tension: 0.95, energy: 0.02 };
    const out = applyNarrativeDelta(base, narrativeToStyleDelta(arc({ tension_profile: 1, rhythmic_energy: 0 })));
    expect(out.tension).toBeLessThanOrEqual(1);
    expect(out.energy).toBeGreaterThanOrEqual(0);
  });

  it("is byte-identical to resolveStyleProfile when no narrative exists", () => {
    expect(resolveEffectiveStyle({}, {})).toEqual(resolveStyleProfile({}, {}));
    const section = { bend: { energy: 0.71, feel: 0.22 } };
    const song = { bend: { energy: 0.4 } };
    expect(resolveEffectiveStyle(section, song)).toEqual(resolveStyleProfile(section, song));
  });

  it("composes the tint on top of the bend base", () => {
    const bent = { bend: { energy: 0.5 } };
    const withArc = { ...bent, narrative: arc({ rhythmic_energy: 1 }) };
    expect(resolveEffectiveStyle(withArc, {}).energy).toBeGreaterThan(resolveEffectiveStyle(bent, {}).energy);
  });
});

describe("narrativeTransitionModel", () => {
  it("builds above the threshold and drains below it", () => {
    expect(narrativeTransitionModel(NARRATIVE_TRANSITION_BUILD_THRESHOLD + 0.01)).toBe("buildUp");
    expect(narrativeTransitionModel(NARRATIVE_TRANSITION_DRAIN_THRESHOLD - 0.01)).toBe("breakDown");
  });

  it("leaves the dead zone to the authored model / role planner", () => {
    expect(narrativeTransitionModel(0)).toBeNull();
    expect(narrativeTransitionModel(NARRATIVE_TRANSITION_BUILD_THRESHOLD)).toBeNull();
    expect(narrativeTransitionModel(NARRATIVE_TRANSITION_DRAIN_THRESHOLD)).toBeNull();
  });
});

describe("narrativeHarmonyOutline", () => {
  it("is null at or below the warp threshold", () => {
    expect(narrativeHarmonyOutline(NARRATIVE_STRUCTURAL_WARP_THRESHOLD, 4, 4)).toBeNull();
    expect(narrativeHarmonyOutline(0, 4, 4)).toBeNull();
  });

  it("decomposes the meter into 2s and 3s above it, deterministically", () => {
    const a = narrativeHarmonyOutline(0.8, 5, 4);
    const b = narrativeHarmonyOutline(0.8, 5, 4);
    expect(a).not.toBeNull();
    expect(a).toEqual(b); // same input, same grid — no dice
    expect(a!.cells.every((c) => c === 2 || c === 3)).toBe(true);
    expect(a!.cells.reduce((sum, c) => sum + c, 0)).toBe(5);
  });

  it("gives each warp step its own grid rather than one static necklace", () => {
    const grids = [0.55, 0.7, 0.9, 1].map((w) => JSON.stringify(narrativeHarmonyOutline(w, 8, 4)));
    expect(new Set(grids).size).toBeGreaterThan(1);
  });

  it("returns null for a meter with no 2s/3s decomposition", () => {
    expect(narrativeHarmonyOutline(1, 1, 8)).toBeNull();
  });
});

describe("narrativeHarmonySection", () => {
  const section = { chords: [{ beats: 4 }], timeSignatureNumerator: 4, timeSignatureDenPower: 2 };

  it("leaves the section untouched below the threshold", () => {
    expect(narrativeHarmonySection(section, arc())).toBe(section);
  });

  it("injects an outline above the threshold", () => {
    const warped = narrativeHarmonySection(section, arc({ structural_warp: 1 }));
    expect(warped).not.toBe(section);
    expect(warped.harmonyMeterOutline).toBeTruthy();
  });

  it("stands down on a mixed-meter section rather than mis-griding it", () => {
    // One `harmonyMeterOutline` is a single repeating cycle; applying the
    // headline bar's 2s/3s to a 4/4-then-7/8 section would land changes
    // mid-bar. The authored meter wins and the warp is a no-op.
    const mixed = {
      ...section,
      timeSignatureNumerator: 4,
      meterMap: [
        { bar: 1, numerator: 4, denominator: 4 },
        { bar: 5, numerator: 7, denominator: 8 },
      ],
    };
    expect(narrativeHarmonySection(mixed, arc({ structural_warp: 1 }))).toBe(mixed);
  });

  it("still warps a section whose meter map never changes length", () => {
    const steady = {
      ...section,
      meterMap: [
        { bar: 1, numerator: 4, denominator: 4 },
        { bar: 5, numerator: 4, denominator: 4 },
      ],
    };
    expect(narrativeHarmonySection(steady, arc({ structural_warp: 1 }))).not.toBe(steady);
  });

  it("never overrides an authored outline", () => {
    const authored = {
      ...section,
      harmonyMeterOutline: { cellBeats: 0.5, cells: [3, 3, 2] as (2 | 3)[], label: "authored" },
    };
    expect(narrativeHarmonySection(authored, arc({ structural_warp: 1 }))).toBe(authored);
  });
});
