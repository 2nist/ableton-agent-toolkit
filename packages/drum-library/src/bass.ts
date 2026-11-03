/** Bass generation shared by every exporter — TrackDraft's .mid/live-out
 *  `planBassStem` and the Ableton extension's `planBassLine` — so the bass
 *  voice agrees note-for-note everywhere (the same DAW-agnostic approach
 *  as `planSectionDrumNotes`). Purely numeric: callers feed pre-computed
 *  pitch classes, so this module (like the rest of @drum/library) never
 *  imports the blueprint schema. */

export type BassMotion = "root" | "root_fifth" | "walking";
export type BassRhythm = "locked" | "half" | "eighth";

/** Shape knobs for a section's generated bass voice. Every field is
 *  optional; absent fields fall back to the historical defaults (one
 *  sustained root per chord, octave 3, velocity 100). Structurally
 *  identical to song-blueprint's `BassProfile`, declared here separately
 *  for the same schema-decoupling reason `MeterOutline` is. */
export interface BassProfile {
  /** MIDI octave number (octave*12 + pitch class): 3 = standard bass
   *  register (MIDI 36 = C2), 4 = an octave up. */
  octave?: number;
  /** How the bass moves between/within chord changes. */
  motion?: BassMotion;
  /** Subdivision of each chord's span. */
  rhythm?: BassRhythm;
  /** Note velocity 1-127. */
  velocity?: number;
}

export const DEFAULT_BASS_OCTAVE = 3;
export const DEFAULT_BASS_VELOCITY = 100;

export const DEFAULT_BASS_PROFILE: Required<BassProfile> = {
  octave: DEFAULT_BASS_OCTAVE,
  motion: "root",
  rhythm: "locked",
  velocity: DEFAULT_BASS_VELOCITY,
};

/** One resolved chord change the bass should voice — the caller computes
 *  these from its own occurrence resolution (per-chord beats or a
 *  Euclidean outline), so bass locks to exactly the same grid as the
 *  chords. `startTime` is carried through unchanged, so callers decide
 *  whether it's section-relative or song-absolute. */
export interface BassOccurrence {
  /** Pitch class of the chord root (0-11). */
  rootPc: number;
  /** Start beat of the chord. */
  startTime: number;
  /** Span of the chord in beats. */
  duration: number;
}

export interface BassNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity: number;
}

/** How many notes a chord's span is split into for each rhythm choice. */
const RHYTHM_SPLIT: Record<BassRhythm, number> = { locked: 1, half: 2, eighth: 4 };

/** A leading tone one semitone below a target pitch class — the classic
 *  walk-up approach into the next chord's root. */
const approachPc = (targetPc: number) => (targetPc - 1 + 12) % 12;

/** Build the bass voice for one section from its resolved chord
 *  occurrences and an optional `BassProfile`. The default profile
 *  reproduces the historical behavior exactly (one sustained root per
 *  chord, octave 3, velocity 100), so a section with no `bassProfile`
 *  exports identically to before. */
export function planSectionBass(occurrences: BassOccurrence[], profile: BassProfile = {}): BassNote[] {
  const p: Required<BassProfile> = { ...DEFAULT_BASS_PROFILE, ...profile };
  const split = RHYTHM_SPLIT[p.rhythm];
  const notes: BassNote[] = [];
  occurrences.forEach((occ, i) => {
    const next = occurrences[i + 1];
    for (let s = 0; s < split; s++) {
      const startTime = occ.startTime + (occ.duration / split) * s;
      const duration = occ.duration / split;
      let pitch = p.octave * 12 + occ.rootPc;
      if (p.motion === "root_fifth") {
        // Alternate root and fifth across the subdivision — fifth = +7.
        if (s % 2 === 1) pitch = p.octave * 12 + ((occ.rootPc + 7) % 12);
      } else if (p.motion === "walking" && split > 1) {
        // Roots that walk up into the next chord: the last subdivision of
        // each chord plays a leading tone one semitone below the next
        // root. Same-root changes (or the final chord) just hold.
        if (next && next.rootPc !== occ.rootPc && s === split - 1) {
          pitch = p.octave * 12 + approachPc(next.rootPc);
        }
      }
      notes.push({ pitch, startTime, duration, velocity: p.velocity });
    }
  });
  return notes;
}

/** The shape an authored bass note has on its way in — the schema's
 *  `MelodyNote` (pitch / startTime / duration / optional velocity), kept
 *  structural so this package does not have to depend on the song schema. */
export interface AuthoredBassNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity?: number;
}

/**
 * The section's bass line: the authored notes when there are any, the
 * generated line otherwise.
 *
 * This is the seam every bass planner must go through (the app's `.mid` and
 * live out, and the Ableton bridge's `planBassLine`). An authored line that
 * only one of them honoured would put a different bass in Live than in the
 * export — the exact drift the shared schema exists to prevent.
 *
 * Authored notes are returned as written (a pickup can start early, a note can
 * outlast its chord), except that velocity falls back to the profile's, so a
 * note written by a gesture that does not care about dynamics still sounds.
 *
 * **The bass takes no clock of its own.** Its line is derived from the chord
 * stream, and `resolveChordOccurrences` conducts that stream for the section
 * (`conductSection`), so a half-time section arrives here as a half-time
 * progression with its authored notes already mapped. A clock parameter on this
 * function would map a second time — the parameter's absence is the invariant.
 */
export function planSectionBassFor(
  occurrences: BassOccurrence[],
  profile: BassProfile = {},
  authored?: readonly AuthoredBassNote[] | null,
): BassNote[] {
  const velocity = profile.velocity ?? DEFAULT_BASS_PROFILE.velocity;
  return !authored || authored.length === 0
    ? planSectionBass(occurrences, profile)
    : authored.map((note) => ({
        pitch: note.pitch,
        startTime: note.startTime,
        duration: note.duration,
        velocity: note.velocity ?? velocity,
      }));
}

// ---------------------------------------------------------------------------
// Bend → bass profile (the Bass layer of the Mix/Bend station)
// ---------------------------------------------------------------------------

import type { StyleProfile } from "./style.js";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Map the Bend bass axes onto a partial `BassProfile`. Only axes the
 *  bend actually sets are included (an absent axis leaves the field to
 *  the explicit profile / defaults), so an untouched slider can never
 *  shadow an authored value. */
export function bassProfileFromBend(
  style: Pick<StyleProfile, "bassRegister" | "bassMotion" | "bassRhythm" | "bassVelocity">,
): Partial<BassProfile> {
  const out: Partial<BassProfile> = {};
  const zone = (v: number): 0 | 1 | 2 => (v < 1 / 3 ? 0 : v < 2 / 3 ? 1 : 2);

  if (style.bassRegister != null) out.octave = [2, 3, 4][zone(clamp01(style.bassRegister))];
  if (style.bassMotion != null)
    out.motion = (["root", "root_fifth", "walking"] as const)[zone(clamp01(style.bassMotion))];
  if (style.bassRhythm != null)
    out.rhythm = (["locked", "half", "eighth"] as const)[zone(clamp01(style.bassRhythm))];
  if (style.bassVelocity != null) out.velocity = Math.round(70 + clamp01(style.bassVelocity) * 57);
  return out;
}

/** The EFFECTIVE bass profile for a section: defaults ← the section's
 *  explicit `bassProfile` ← the Bend bass axes (macros tint on top — the
 *  same direction the drum transforms use). Shared by the app's
 *  `planBassStem` and the Ableton bridge's `planBassLine`, so both stay
 *  note-for-note. */
export function resolveBassProfile(
  explicit: BassProfile | undefined | null,
  style: StyleProfile | undefined,
): Required<BassProfile> {
  return {
    ...DEFAULT_BASS_PROFILE,
    ...(explicit ?? {}),
    ...(style ? bassProfileFromBend(style) : {}),
  };
}
