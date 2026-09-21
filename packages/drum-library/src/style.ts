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

/** The macro axes a user bends — the six the groove engine reads (drums +
 *  harmony voicing) plus the per-layer axes for the Mix/Bend station (Bass
 *  register/motion/rhythm/velocity, Harmony tension/articulation, Melody
 *  contour). All 0..1 except `tempo` (absolute bpm). 0.5 is the neutral
 *  point for every 0..1 axis — the mapper and transforms leave notes
 *  untouched there, so a profile at all-0.5 == the engine's current
 *  behavior. Per-layer axes are OPTIONAL: absent means \"not set\" (an
 *  authored per-section value is never shadowed by an untouched slider). */
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
  /** 0 = consonant (aug/dim/m7b5 restored to plain triads) … 1 = dissonant
   *  (maj→aug, min→dim, 7→m7b5…). Applied AFTER `styleHarmonize`; the
   *  0.25..0.75 band is a no-op. */
  tension?: number;
  /** 0..0.5 = block/legato (today's default — neutral at exactly 0.5) … 1 =
   *  staccato arpeggiation. Above 0.5 the chord strums (widening), above
   *  ~0.75 it arpeggiates. */
  articulation?: number;
  /** 0 = conjunct (leaps smoothed toward steps) … 1 = disjunct (reserved
   *  until a melody generator exists). 0.5 = untouched captured line. */
  melodyContour?: number;
  /** 0 = low (octave 2) · 0.5 = standard (3) · 1 = up (4). */
  bassRegister?: number;
  /** 0 = root · 0.5 = root/fifth · 1 = walking. */
  bassMotion?: number;
  /** 0 = locked (one note per chord) · 0.5 = half · 1 = eighth. */
  bassRhythm?: number;
  /** 0 = soft (≈70) · 0.5 = standard (≈100) · 1 = hard (127). */
  bassVelocity?: number;
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

/** The effective peak velocity for a section, given its authored velocity
 *  target and the Bend energy axis. Neutral energy → the base target
 *  unchanged; extremes scale ~0.55x..1.2x, clamped to 1..127. Shared by
 *  both export paths so app == bridge. */
export function styleVelocityTarget(baseTarget: number, profile: StyleProfile): number {
  return Math.max(1, Math.min(127, Math.round(baseTarget * velocityScaleFor(profile.energy))));
}

/** How the default per-chord spacing tightens (moving) or lengthens
 *  (holding) as `density` bends. 1.0 at neutral; ~1.1 sparse (hold),
 *  ~0.9 dense (move). Passed to `resolveChordOccurrences` only where the
 *  section has no Euclidean outline — an authored grid is never re-timed. */
export function styleSpacing(density: number): number {
  const d = clamp01(density);
  if (d <= 0.5) return lerp(1.1, 1.0, d / 0.5);
  return lerp(1.0, 0.9, (d - 0.5) / 0.5);
}

/** Triad → 7th, for the high-harmony (lush) direction — within the
 *  quality vocabulary the voicing engine (`chordToMidiNotes`) supports. */
const HARMONY_EXTEND: Record<string, string> = { maj: "maj7", min: "min7" };
/** 7th → triad, for the low-harmony (simple) direction. */
const HARMONY_REDUCE: Record<string, string> = { maj7: "maj", min7: "min" };

/** The effective voicing quality for a chord under the Bend harmony axis.
 *  Below 0.5 reduces 7ths toward triads; above 0.5 extends triads toward
 *  7ths — within the vocabulary `chordToMidiNotes` supports. An authored
 *  `extendedSuffix` ALWAYS wins (never overridden). Neutral (0.5) returns
 *  the quality unchanged. Shared by both export paths so app == bridge. */
export function styleHarmonize(
  chord: { quality: string; extendedSuffix?: string | null },
  harmony: number,
): string {
  if (chord.extendedSuffix) return chord.quality;
  const h = clamp01(harmony);
  if (h > 0.5) return HARMONY_EXTEND[chord.quality] ?? chord.quality;
  if (h < 0.5) return HARMONY_REDUCE[chord.quality] ?? chord.quality;
  return chord.quality;
}

/** Dissonant siblings used by the Tension axis (high side). */
const TENSION_DISSONANT: Record<string, string> = {
  maj: "aug",
  min: "dim",
  maj7: "7",
  min7: "m7b5",
  "7": "m7b5",
  sus2: "sus4",
  sus4: "sus2",
};
/** The consonant restores used by the Tension axis (low side). */
const TENSION_CONSONANT: Record<string, string> = {
  aug: "maj",
  dim: "min",
  m7b5: "min7",
};

/** The effective quality under the Bend Tension axis — applied AFTER
 *  `styleHarmonize` (Color). Three deterministic zones within the quality
 *  vocabulary: below 0.25 restores consonant triads, above 0.75 leans to
 *  the dissonant sibling, and the wide middle band is a no-op (so neutral
 *  tension reproduces today's output exactly). */
export function styleTension(quality: string, tension: number): string {
  const t = clamp01(tension);
  if (t < 0.25) return TENSION_CONSONANT[quality] ?? quality;
  if (t > 0.75) return TENSION_DISSONANT[quality] ?? quality;
  return quality;
}

/** The full Color+Tension quality resolution for an authored chord: an
 *  authored `extendedSuffix` always wins untouched; otherwise harmonize
 *  (Color) then tension. Shared by both export paths so app == bridge. */
export function styleQualityFor(
  chord: { quality: string; extendedSuffix?: string | null },
  harmony: number,
  tension: number,
): string {
  if (chord.extendedSuffix) return chord.quality;
  return styleTension(styleHarmonize(chord, harmony), tension);
}

/** A structural twin of @music-theory/core's `ChordPerformanceEffect`
 *  (this package stays dependency-free). */
export interface BendArticulationEffect {
  style: "strum" | "arp";
  params?: Record<string, number>;
}

/** The Bend Articulation axis → a chord performance effect. At or below
 *  0.5 stays a block chord (undefined = the engine's current behavior —
 *  0.5 is the neutral point), above 0.5 spreads as a strum (wider + fading
 *  as it bends), above 0.75 arpeggiates (finer subdivision as it bends).
 *  An authored `chord.performance` wins at the call sites. */
export function styleArticulation(articulation: number): BendArticulationEffect | undefined {
  const a = clamp01(articulation);
  if (a <= 0.5) return undefined;
  if (a <= 0.75) {
    const k = (a - 0.5) / 0.25;
    return {
      style: "strum",
      params: { strumMs: Math.round(60 + 180 * k), velocityDecay: Math.round(15 * k) / 100 },
    };
  }
  const k = (a - 0.75) / 0.25;
  return {
    style: "arp",
    params: {
      subdivision: Math.round(2 + 6 * k),
      octaves: 1,
      direction: 0,
      rateOffset: Math.round(5 * k) / 100,
    },
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
// Resolution — song master + per-section override (shared so app == bridge)
// ---------------------------------------------------------------------------

/** The shape the resolver reads — a structural subset of the blueprint's
 *  `BlueprintSection`/`BlueprintSong` (it only needs `bend`), so this
 *  package stays decoupled from the schema. */
export interface BendSource {
  bend?: Partial<StyleProfile> | null;
}

/** Resolve a section's EFFECTIVE style profile:
 *  `{ ...DEFAULT_STYLE_PROFILE, ...song.bend, ...section.bend }` — the
 *  song master first, the section's partial override on top. This is the
 *  SINGLE resolution used by both the web app and the Ableton bridge, so a
 *  bend can never resolve differently on the two sides (parity). Absent
 *  everywhere (or an undefined section/song) → `DEFAULT_STYLE_PROFILE`
 *  (a no-op). */
export function resolveStyleProfile(section: BendSource | undefined, song: BendSource | undefined): StyleProfile {
  return { ...DEFAULT_STYLE_PROFILE, ...song?.bend, ...section?.bend };
}

/** Whether a section has an ACTIVE bend (a song master, or its own
 *  override). The variant-seed path only switches to `styleSeed` when this
 *  is true, so existing songs with no bend keep their exact current output. */
export function hasBend(section: BendSource | undefined, song: BendSource | undefined): boolean {
  return Boolean(song?.bend || section?.bend);
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
