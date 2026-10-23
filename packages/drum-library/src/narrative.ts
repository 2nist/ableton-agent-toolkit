/**
 * Narrative — the relative narrative-to-musical translation layer.
 *
 * A second abstract layer that sits ABOVE the Bend axes (`StyleProfile`) and
 * tints them at render time. Where `bend` carries *absolute* style values a
 * user dials in (or a subgenre map's `STYLE_RECIPES` seeds), `narrative`
 * carries *relative* deltas (a lyrical arc's tension rising, energy dropping)
 * that get composed ON TOP of the resolved style — so the same abstract arc
 * reads as bossa over a bossa recipe and trap over a trap recipe.
 *
 * Decoupling rule (mirrors `StyleProfile`/`MeterOutline`/`TransitionModel`):
 * `NarrativeProfile` is declared here structurally, NOT imported from
 * `@music-theory/song-blueprint` — this package stays schema-free and
 * DAW-agnostic ("numeric, no schema imports"). The schema package keeps its
 * own structurally-identical copy; the app and bridge pass their own
 * section/song objects straight in via `NarrativeSource`.
 *
 * Determinism + parity: `resolveEffectiveStyle` is built on the shared
 * `resolveStyleProfile`, and a song/section with no `narrative` resolves to
 * all-neutral = the engine's current output, byte-for-byte.
 */

import { resolveStyleProfile } from "./style.js";
import type { BendSource, StyleProfile } from "./style.js";
import { buildEuclideanOutline, twoThreeCellCounts } from "./meter.js";
import type { MeterOutline } from "./meter.js";
import type { TransitionModel } from "./transitions.js";
import type { ChordResolutionSource } from "./chordCycle.js";

/**
 * Relative narrative parameters. All 0..1 where 0.5 = neutral, EXCEPT
 * `transition_delta` (signed, -1..+1, 0 = neutral) and `structural_warp`
 * (0..1, neutral at 0 — an additive deformation, not a centered tint).
 * Structurally identical to song-blueprint's `NarrativeProfile`.
 */
export interface NarrativeProfile {
  /** 0 = resolved/calm … 1 = dissonant/suspenseful. */
  tension_profile: number;
  /** 0 = sparse/still … 1 = driving/busy. */
  rhythmic_energy: number;
  /** -1 = energy drains out of the boundary … +1 = builds into the next section. */
  transition_delta: number;
  /** 0 = no deformation … 1 = warped (asymmetric meter / Euclidean harmony). */
  structural_warp: number;
}

/** The shape the resolver reads — a structural subset of the blueprint's
 *  `BlueprintSection`/`BlueprintSong`, so this package stays decoupled from
 *  the schema. It extends `BendSource` because `resolveEffectiveStyle` feeds
 *  these same objects to `resolveStyleProfile`: the effective style is the
 *  Bend base with the narrative arc painted on top, so one source has to
 *  satisfy both readers. */
export interface NarrativeSource extends BendSource {
  narrative?: NarrativeProfile | null;
}

/** All-neutral narrative — resolves to the engine's current behavior. */
export const DEFAULT_NARRATIVE_PROFILE: NarrativeProfile = {
  tension_profile: 0.5,
  rhythmic_energy: 0.5,
  transition_delta: 0,
  structural_warp: 0,
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Resolve a section's EFFECTIVE narrative profile:
 *  `{ ...DEFAULT_NARRATIVE_PROFILE, ...song.narrative, ...section.narrative }`
 *  — the song master first, the section's override on top. Mirrors
 *  `resolveStyleProfile`. Absent everywhere → all-neutral (no tint). */
export function resolveNarrativeProfile(
  section: NarrativeSource | undefined,
  song: NarrativeSource | undefined,
): NarrativeProfile {
  return { ...DEFAULT_NARRATIVE_PROFILE, ...song?.narrative, ...section?.narrative };
}

/** Does the resolved arc actually tint anything? Call sites use this exactly
 *  where they use `hasBend` — to decide whether the arc may re-seed a
 *  deterministic choice (the drum variant pick).
 *
 *  A narrative that resolves to all-neutral counts as ABSENT: the layer's
 *  contract is that a neutral arc is byte-identical to no arc at all, and
 *  re-seeding on the mere presence of the object would break that (the
 *  variant pick would change without any axis being moved). */
export function hasNarrative(
  section: NarrativeSource | undefined,
  song: NarrativeSource | undefined,
): boolean {
  if (!section?.narrative && !song?.narrative) return false;
  const n = resolveNarrativeProfile(section, song);
  return (
    n.tension_profile !== DEFAULT_NARRATIVE_PROFILE.tension_profile ||
    n.rhythmic_energy !== DEFAULT_NARRATIVE_PROFILE.rhythmic_energy ||
    n.transition_delta !== DEFAULT_NARRATIVE_PROFILE.transition_delta ||
    n.structural_warp !== DEFAULT_NARRATIVE_PROFILE.structural_warp
  );
}

/** How strongly each narrative axis pushes its style axes. Sub-unity gains
 *  keep a full narrative swing from slamming an axis to its extreme. */
const RHYTHMIC_ENERGY_GAIN = 0.8;
const MELODY_DENSITY_GAIN = 0.6;
const TENSION_GAIN = 1.0;
const MELODY_CONTOUR_GAIN = 0.4;

/**
 * Signed style deltas in [-0.5, +0.5] — added onto a 0..1 base then clamped.
 * Returned as REAL deltas (not absolute values), so `applyNarrativeDelta`
 * just adds them; a neutral narrative (0.5 / 0.5) yields all-zero deltas.
 */
export interface NarrativeStyleDelta {
  energy: number;
  density: number;
  articulation: number;
  bassVelocity: number;
  melodyDensity: number;
  harmony: number;
  tension: number;
  melodyContour: number;
}

/**
 * Translate an abstract narrative arc into a delta over a `StyleProfile`.
 * This is the single translation table — narrative params never touch chords,
 * notes, or patterns directly; they only bend the existing style axes, which
 * the drum/chord/bass compilers already interpret. No parallel theory is
 * duplicated.
 */
export function narrativeToStyleDelta(n: NarrativeProfile): NarrativeStyleDelta {
  const e = n.rhythmic_energy - 0.5; // [-0.5, +0.5]
  const t = n.tension_profile - 0.5; // [-0.5, +0.5]
  return {
    energy: e * RHYTHMIC_ENERGY_GAIN,
    density: e * RHYTHMIC_ENERGY_GAIN,
    articulation: e * RHYTHMIC_ENERGY_GAIN,
    bassVelocity: e * RHYTHMIC_ENERGY_GAIN,
    melodyDensity: e * MELODY_DENSITY_GAIN,
    harmony: t * TENSION_GAIN,
    tension: t * TENSION_GAIN,
    melodyContour: t * MELODY_CONTOUR_GAIN,
  };
}

/** Add narrative deltas onto a resolved style profile (clamped 0..1).
 *  Optional axes (`tension`, `articulation`, `bassVelocity`, `melody*`) are
 *  only set when the base authored them — a neutral narrative must be a
 *  true no-op for sections/songs that never opted in, so existing output
 *  is byte-identical. Required axes (`energy`, `density`, `harmony`) always
 *  exist on `StyleProfile` and are always safe to add to. */
export function applyNarrativeDelta(base: StyleProfile, delta: NarrativeStyleDelta): StyleProfile {
  return {
    ...base,
    energy: clamp01(base.energy + delta.energy),
    density: clamp01(base.density + delta.density),
    harmony: clamp01(base.harmony + delta.harmony),
    ...(base.tension !== undefined ? { tension: clamp01(base.tension + delta.tension) } : {}),
    ...(base.articulation !== undefined ? { articulation: clamp01(base.articulation + delta.articulation) } : {}),
    ...(base.bassVelocity !== undefined ? { bassVelocity: clamp01(base.bassVelocity + delta.bassVelocity) } : {}),
    ...(base.melodyDensity !== undefined ? { melodyDensity: clamp01(base.melodyDensity + delta.melodyDensity) } : {}),
    ...(base.melodyContour !== undefined ? { melodyContour: clamp01(base.melodyContour + delta.melodyContour) } : {}),
  };
}

/**
 * The effective style profile with narrative applied: the concrete subgenre
 * vocabulary (the resolved `StyleProfile` — from Bend sliders / a style
 * recipe) is the base; the abstract narrative arc tints it on top. This is
 * the drop-in replacement for `resolveStyleProfile` at the chord/drum/bass
 * compiler call sites. No narrative → identical to `resolveStyleProfile`.
 */
export function resolveEffectiveStyle(
  section: NarrativeSource | undefined,
  song: NarrativeSource | undefined,
): StyleProfile {
  const base = resolveStyleProfile(section, song);
  const narrative = resolveNarrativeProfile(section, song);
  return applyNarrativeDelta(base, narrativeToStyleDelta(narrative));
}

/** |transition_delta| above this magnitude drives a named transition model. */
export const NARRATIVE_TRANSITION_BUILD_THRESHOLD = 0.35;
export const NARRATIVE_TRANSITION_DRAIN_THRESHOLD = -0.35;

/**
 * Narrative boundary intent → a transition model. Positive delta builds into
 * the next section (`buildUp`); negative drains out (`breakDown`). Near-zero
 * returns null (the role-based auto-planner / authored choice decides). An
 * authored `drumTransitionModel` always wins at the call site (checked first).
 */
export function narrativeTransitionModel(transitionDelta: number): TransitionModel | null {
  if (transitionDelta > NARRATIVE_TRANSITION_BUILD_THRESHOLD) return "buildUp";
  if (transitionDelta < NARRATIVE_TRANSITION_DRAIN_THRESHOLD) return "breakDown";
  return null;
}

/** Distinct bar lengths a section spends time in, in beats — from its meter
 *  map when it has one, else its single declared meter. */
function mixedMeterLengths(section: {
  timeSignatureNumerator?: number;
  timeSignatureDenPower?: number;
  meterMap?: readonly { numerator: number; denominator: number }[] | null;
}): Set<number> {
  const map = section.meterMap;
  if (map && map.length > 0) {
    return new Set(map.map((m) => (m.numerator * 4) / m.denominator));
  }
  const numerator = section.timeSignatureNumerator ?? 4;
  const denominator = 2 ** (section.timeSignatureDenPower ?? 2);
  return new Set([(numerator * 4) / denominator]);
}

/** structural_warp above this value re-grids the harmony onto a 2s/3s
 *  Euclidean outline instead of flat beatsPerChord. */
export const NARRATIVE_STRUCTURAL_WARP_THRESHOLD = 0.5;

/**
 * structural_warp → a Euclidean harmony outline for the section's own meter:
 * higher warp → denser cell decomposition, and the rotation cycles with warp
 * so a warped section's grid isn't always the same necklace. Returns null
 * below the threshold (flat harmony, unchanged) or for a 1-beat meter (no
 * valid 2s/3s decomposition). This is the concrete "asymmetric meter /
 * metric modulation" vocabulary the warp maps onto — reusing the exact
 * `buildEuclideanOutline` machinery `harmonyRhythm: "euclid"` already uses.
 */
export function narrativeHarmonyOutline(
  structuralWarp: number,
  numerator: number,
  denominator: number,
): MeterOutline | null {
  if (structuralWarp <= NARRATIVE_STRUCTURAL_WARP_THRESHOLD) return null;
  const counts = twoThreeCellCounts(numerator);
  if (counts.length === 0) return null;
  const span = 1 - NARRATIVE_STRUCTURAL_WARP_THRESHOLD;
  const idx = Math.min(
    counts.length - 1,
    Math.floor(((structuralWarp - NARRATIVE_STRUCTURAL_WARP_THRESHOLD) / span) * counts.length),
  );
  const cellCount = counts[idx];
  const rotation = Math.floor(structuralWarp * cellCount) % cellCount;
  return buildEuclideanOutline(numerator, denominator, cellCount, rotation);
}

/**
 * Returns `section` with a `harmonyMeterOutline` injected when the narrative's
 * `structural_warp` calls for one. An already-authored outline always wins
 * (returned untouched); below the warp threshold the section is returned
 * unchanged. Feed the result to `resolveChordOccurrences` in place of the raw
 * section — the Euclidean grid is then honored exactly like an authored one.
 */
export function narrativeHarmonySection<C extends { beats: number }>(
  section: ChordResolutionSource<C> & {
    timeSignatureNumerator?: number;
    timeSignatureDenPower?: number;
    meterMap?: readonly { numerator: number; denominator: number }[] | null;
  },
  narrative: NarrativeProfile,
): ChordResolutionSource<C> {
  if (section.harmonyMeterOutline || section.drumMeterOutline) return section; // authored wins
  // A single `harmonyMeterOutline` is one repeating cycle, so it can only
  // describe a section whose bars are all the same length. Warping a
  // mixed-meter section would apply the headline bar's 2s/3s across the
  // others and land chord changes mid-bar, so the warp stands down and the
  // authored meter wins. (Per-bar outlines would need a per-bar resolver.)
  if (mixedMeterLengths(section).size > 1) return section;
  const outline = narrativeHarmonyOutline(
    narrative.structural_warp,
    section.timeSignatureNumerator ?? 4,
    2 ** (section.timeSignatureDenPower ?? 2),
  );
  return outline ? { ...section, harmonyMeterOutline: outline } : section;
}

