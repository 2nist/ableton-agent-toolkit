/**
 * Style — the "Bend" macro style layer.
 *
 * A small set of human-named axes (Energy, Density, Backbeat, Feel, Kit,
 * Harmony, Tempo) that TINT the otherwise-uncommitted decisions of the
 * groove engine. This is deliberately a *tint at the top of the chain*,
 * not a second authoring surface: authored choices (drumPattern,
 * drumMeterOutline, chords, transitionModel...) always win, and the
 * DEFAULT profile is the neutral point that reproduces today's output
 * byte-for-byte (so a song with no bend sounds exactly as it always did).
 *
 * Determinism is the whole point — "controls, not dice". The variant seed
 * becomes a pure function of the profile (`styleSeed`), so the same slider
 * positions always resolve to the same groove, and nudging a slider
 * deterministically evolves it.
 *
 * Everything here is DAW-agnostic (numeric, no schema imports), so both
 * the web app's export/live-out and the Ableton bridge call the same
 * functions — parity holds automatically (the golden parity test locks
 * it).
 */

import { occurrenceSeed } from "./handoffs.js";
import type { PackedNote, PackedVariant } from "./presetData.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The seven macro axes a user bends. All 0..1 except `tempo` (absolute
 *  bpm). 0.5 is the neutral point for every 0..1 axis — the mapper and
 *  transforms leave notes untouched there, so a profile at all-0.5 == the
 *  engine's current behavior. */
export interface StyleProfile {
  /** 0 = delicate (ppp-ish) … 1 = driving (fff-ish). */
  energy: number;
  /** 0 = sparse … 1 = busy/dense. */
  density: number;
  /** 0 = soft, no strong backbeat … 1 = locked 2&4 backbeat. */
  backbeat: number;
  /** 0 = straight/tight grid … 1 = swung/human feel. */
  feel: number;
  /** 0 = acoustic kit … 1 = electronic machine. */
  kit: number;
  /** 0 = triads/simple voicings … 1 = extended/lush (7/9/11). */
  harmony: number;
  /** Tempo in bpm (absolute — not normalized). */
  tempo: number;
}

/** The neutral profile — identical to having no bend at all. */
export const DEFAULT_STYLE_PROFILE: StyleProfile = {
  energy: 0.5,
  density: 0.5,
  backbeat: 0.5,
  feel: 0.5,
  kit: 0.5,
  harmony: 0.5,
  tempo: 120,
};

/** The engine-side values `styleProfileToEngineTargets` produces — the
 *  concrete knobs the pipeline consumes. `velocityScale` is relative
 *  (0.5 energy ⇒ 1.0 ⇒ the section's own velocity target is used); the
 *  tint axes pass through centered at 0.5 (no change). */
export interface StyleTargets {
  /** Peak-velocity scale applied to the section's own velocity target.
   *  1.0 at neutral energy; ~0.55 at minimum, ~1.2 at maximum. */
  velocityScale: number;
  /** 0..1 — fed to `styleBackbeat`; 0.5 = untouched. */
  backbeat: number;
  /** 0..1 — fed to `styleFeel`; 0.5 = untouched. */
  feel: number;
  /** -1 (strongly acoustic) … +1 (strongly electronic) — a bias for the
   *  heuristic's style fork. 0 at neutral kit. */
  kitBias: number;
  /** 0..1 density tier (for the sparse↔busy heuristic bias + fill rate). */
  density: number;
  /** 0..1 harmony extension intensity (for voicing-time harmonization). */
  harmony: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Energy → peak-velocity scale, piecewise-linear through the neutral
 *  point: energy 0 ⇒ ~0.55, 0.5 ⇒ 1.0, 1 ⇒ ~1.2. */
export function velocityScaleFor(energy: number): number {
  const e = clamp01(energy);
  if (e <= 0.5) return lerp(0.55, 1.0, e / 0.5);
  return lerp(1.0, 1.2, (e - 0.5) / 0.5);
}

/** Map a style profile to the concrete engine targets (see
 *  `StyleTargets`). Pure; callers decide how to apply each knob. */
export function styleProfileToEngineTargets(profile: StyleProfile): StyleTargets {
  return {
    velocityScale: velocityScaleFor(profile.energy),
    backbeat: clamp01(profile.backbeat),
    feel: clamp01(profile.feel),
    kitBias: (clamp01(profile.kit) - 0.5) * 2,
    density: clamp01(profile.density),
    harmony: clamp01(profile.harmony),
  };
}

// ---------------------------------------------------------------------------
// Deterministic seed
// ---------------------------------------------------------------------------

/** The deterministic variant-seed for a (profile, section, occurrence)
 *  triple. Quantized to 2 decimals so a floating-point drift can't change
 *  the seed; `tempo` is deliberately excluded (changing tempo should not
 *  re-roll which groove plays). Feed the result through `hashSeed` exactly
 *  like the engine's other seeds. */
export function styleSeed(profile: StyleProfile, sectionId: string, occurrenceIndex = 0): string {
  const q = (v: number): number => Math.round(clamp01(v) * 100);
  return (
    `bend:${q(profile.energy)},${q(profile.density)},${q(profile.backbeat)},` +
    `${q(profile.feel)},${q(profile.kit)},${q(profile.harmony)}:${occurrenceSeed(sectionId, occurrenceIndex)}`
  );
}

// ---------------------------------------------------------------------------
// Note transforms (feel + backbeat) — operate on a resolved variant's notes
// ---------------------------------------------------------------------------

const SNARE_PITCH = 38;
/** 0-indexed quarter-note beats that form the "2 & 4" backbeat in 4/4.
 *  Applied to any meter; positions beyond the bar are ignored. */
const BACKBEAT_OFFSETS = [1, 3];
/** Beats around a backbeat position considered "already occupied". */
const BACKBEAT_WINDOW = 0.25;

/** Straighten notes toward the 16th-note grid — the tightening half of
 *  the Feel axis. `strength` 0..1; 0 leaves notes untouched. */
function straightenNotes(notes: PackedNote[], strength: number): PackedNote[] {
  const GRID = 0.25;
  return notes
    .map(([beat, pitch, vel]) => {
      const slot = Math.round(beat / GRID) * GRID;
      return [Math.max(0, beat + (slot - beat) * strength), pitch, vel] as PackedNote;
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Swing the offbeat 8ths toward triplet feel — the loosening half of the
 *  Feel axis. Offbeat 8ths (the "and", near beat-fraction 0.5) shift toward
 *  2/3 of the beat by `strength` (0..1); downbeats and 16th positions are
 *  left alone. */
function swingNotes(notes: PackedNote[], strength: number): PackedNote[] {
  return notes
    .map(([beat, pitch, vel]) => {
      const inBeat = beat - Math.floor(beat);
      if (Math.abs(inBeat - 0.5) <= 0.12) {
        const target = 0.5 + (2 / 3 - 0.5) * strength;
        return [Math.floor(beat) + target, pitch, vel] as PackedNote;
      }
      return [beat, pitch, vel] as PackedNote;
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Apply the Feel axis to a resolved variant's notes. 0.5 = untouched;
 *  below 0.5 tightens toward the grid, above 0.5 swings offbeat 8ths
 *  toward triplet feel. Deterministic, pitch/velocity preserving. */
export function styleFeel(notes: PackedNote[], beatsPerBar: number, feel: number): PackedNote[] {
  const amount = clamp01(feel) - 0.5;
  if (Math.abs(amount) < 1e-6) return notes.map((n) => [...n] as PackedNote);
  if (amount < 0) return straightenNotes(notes, Math.min(1, -amount * 2));
  return swingNotes(notes, Math.min(1, amount * 2));
}

/** Apply the Backbeat axis to a resolved variant's notes. 0.5 = untouched;
 *  above 0.5 strengthens the 2&4 snare (boosting existing hits, inserting
 *  an accent where one is missing); below 0.5 softens it (scaling the 2&4
 *  snare velocity down — the bossa "no strong backbeat" feel). */
export function styleBackbeat(notes: PackedNote[], beatsPerBar: number, backbeat: number): PackedNote[] {
  const amount = clamp01(backbeat) - 0.5;
  if (Math.abs(amount) < 1e-6) return notes.map((n) => [...n] as PackedNote);

  const positions = BACKBEAT_OFFSETS.filter((b) => b < beatsPerBar);
  const inBar = (beat: number): number => ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const onBackbeat = (beat: number): boolean => positions.some((b) => Math.abs(inBar(beat) - b) <= BACKBEAT_WINDOW);

  const snareVels = notes.filter((n) => n[1] === SNARE_PITCH).map((n) => n[2]);
  const baseVel = snareVels.length > 0 ? Math.round(snareVels.reduce((a, b) => a + b, 0) / snareVels.length) : 80;

  const out: PackedNote[] = [];
  for (const [beat, pitch, vel] of notes) {
    if (pitch === SNARE_PITCH && onBackbeat(beat)) {
      if (amount > 0) {
        // Strengthen — push the accent hotter.
        out.push([beat, pitch, Math.max(1, Math.min(127, Math.round(lerp(vel, Math.min(127, vel + 18), amount))))]);
      } else {
        // Soften — scale the 2&4 snare down (light bossa touch).
        out.push([beat, pitch, Math.max(24, Math.min(127, Math.round(vel * (1 + amount * 0.7))))]);
      }
    } else {
      out.push([beat, pitch, vel]);
    }
  }

  // Insert a snare accent on any backbeat position that has none — the
  // presence check is per-position, so adding beat 1 never suppresses the
  // still-empty beat 3.
  if (amount > 0) {
    for (const b of positions) {
      if (!out.some((note) => note[1] === SNARE_PITCH && Math.abs(inBar(note[0]) - b) <= BACKBEAT_WINDOW)) {
        out.push([b, SNARE_PITCH, Math.max(1, Math.min(127, Math.round(lerp(baseVel, 127, amount))))]);
      }
    }
  }

  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Apply the note-level style transforms (Feel + Backbeat) to a resolved
 *  variant, returning a new variant with the same shape. Neutral axes are
 *  no-ops, so an all-neutral profile returns equivalent notes. */
export function applyStyleToVariant(variant: PackedVariant, profile: StyleProfile): PackedVariant {
  const backbeaten = styleBackbeat(variant.notes, variant.beatsPerBar, profile.backbeat);
  const notes = styleFeel(backbeaten, variant.beatsPerBar, profile.feel);
  return { ...variant, notes };
}

// ---------------------------------------------------------------------------
// Genre recipes — labeled starting points that SET the seven sliders.
// These are conveniences, not blends: applying one is just writing a
// StyleProfile, and the user bends from there.
// ---------------------------------------------------------------------------

/** Named style starting points. Each value is a full `StyleProfile` — a
 *  recipe sets the sliders; the sliders are the real control. */
export const STYLE_RECIPES: Record<string, StyleProfile> = {
  bossa: { energy: 0.25, density: 0.3, backbeat: 0.25, feel: 0.75, kit: 0.1, harmony: 0.85, tempo: 105 },
  rock: { energy: 0.8, density: 0.8, backbeat: 0.9, feel: 0.15, kit: 0.45, harmony: 0.3, tempo: 135 },
  trap: { energy: 0.7, density: 0.85, backbeat: 0.65, feel: 0.3, kit: 0.95, harmony: 0.4, tempo: 140 },
  house: { energy: 0.65, density: 0.7, backbeat: 0.5, feel: 0.2, kit: 0.95, harmony: 0.5, tempo: 126 },
  ballad: { energy: 0.2, density: 0.25, backbeat: 0.3, feel: 0.7, kit: 0.15, harmony: 0.8, tempo: 72 },
  "math-rock": { energy: 0.6, density: 0.75, backbeat: 0.55, feel: 0.35, kit: 0.4, harmony: 0.5, tempo: 150 },
  "neo-soul": { energy: 0.4, density: 0.5, backbeat: 0.4, feel: 0.8, kit: 0.3, harmony: 0.75, tempo: 82 },
  pop: { energy: 0.6, density: 0.7, backbeat: 0.7, feel: 0.35, kit: 0.55, harmony: 0.55, tempo: 118 },
};
