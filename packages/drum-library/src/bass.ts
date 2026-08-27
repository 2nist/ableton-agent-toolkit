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
