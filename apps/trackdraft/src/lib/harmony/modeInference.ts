/**
 * modeInference — "are you borrowing this chord, or switching modes?"
 *
 * Pure, testable detection behind the Harmony tab's teaching card. When a
 * section's chords contain tones outside its key/scale, this works out
 * whether a single alternate mode explains them — and only speaks up when
 * exactly one confident candidate does. It never auto-applies anything: it
 * returns a suggestion the UI can offer ("Set section to <mode>") alongside
 * "keep borrowed", matching the Mix/Bend panel's suggest-don't-impose ghost.
 *
 * Design rules (from the UX spec):
 *  - Suggest, never impose. Nothing here mutates the song.
 *  - Only fire on a SINGLE confident candidate. Ambiguous common interchange
 *    stays silent.
 *  - Derived, not event-fired: the caller recomputes from the live chord set
 *    so the suggestion evaporates if the chord is deleted or resolved.
 */

import { pitchClass, noteName, type NoteName, type ScaleType } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";

/** Parallel-mode pitch sets (7-note), indexed by the song's tonic. These are
 *  the modes we offer as "switch" candidates. */
const MODE_INTERVALS: Record<ScaleType, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

const SCALE_NAMES: Record<ScaleType, string> = {
  ionian: "Ionian (Major)",
  dorian: "Dorian",
  phrygian: "Phrygian",
  lydian: "Lydian",
  mixolydian: "Mixolydian",
  aeolian: "Aeolian (Minor)",
  locrian: "Locrian",
};

export interface ModeSuggestion {
  /** The mode that explains the foreign tones (same tonic). */
  scale: ScaleType;
  /** Display name, e.g. "Aeolian (Minor)". */
  label: string;
  /** The foreign pitch classes (relative to tonic) that this mode explains. */
  foreignPitchClasses: number[];
  /** Display names of the specific chords that are out of key. */
  chordNames: string[];
  /** Stable identity for acknowledgment ("keep borrowed") — one per (scale +
   *  explained-set) so the card never re-asks for the same candidate. */
  candidateId: string;
}

/** Pitch classes of a chord (root + triad intervals), 0-11. */
function chordPitchClasses(chord: Chord): number[] {
  const root = pitchClass(chord.root);
  // Triad-quality intervals; enough to decide diatonic membership.
  const q = chord.quality;
  const intervals =
    q === "min" || q === "min7" || q === "m7b5" || q === "dim"
      ? [0, 3, 7]
      : q === "aug"
        ? [0, 4, 8]
        : q === "sus2"
          ? [0, 2, 7]
          : q === "sus4"
            ? [0, 5, 7]
            : [0, 4, 7]; // maj / 7 / maj7 and default
  const pcs = intervals.map((i) => (root + i) % 12);
  if (q === "7" || q === "min7" || q === "maj7" || q === "m7b5") {
    const seventh = q === "maj7" ? 11 : q === "m7b5" ? 10 : 10;
    pcs.push((root + seventh) % 12);
  }
  return pcs;
}

/**
 * Detect a single confident mode candidate for a section's foreign chords.
 * Returns null when everything is diatonic, when there are no foreign chords,
 * or when no single mode explains them (ambiguous / genuinely chromatic).
 */
export function detectModeSuggestion(
  chords: Chord[],
  key: NoteName,
  scale: ScaleType,
): ModeSuggestion | null {
  const tonic = pitchClass(key);
  const scalePcs = new Set((MODE_INTERVALS[scale] ?? MODE_INTERVALS.ionian).map((i) => (tonic + i) % 12));

  // Collect foreign chords (any triad/seventh tone outside the current scale).
  const foreignChords: { chord: Chord; pcs: number[] }[] = [];
  for (const chord of chords) {
    const pcs = chordPitchClasses(chord);
    if (pcs.some((pc) => !scalePcs.has(pc))) foreignChords.push({ chord, pcs });
  }
  if (foreignChords.length === 0) return null;

  const foreignPcs = new Set<number>();
  for (const f of foreignChords) for (const pc of f.pcs) foreignPcs.add(pc);

  // Rank each parallel mode by how many of the foreign pitch classes it covers.
  // A mode is a *candidate* only if it covers ALL of them (fully explains the
  // foreign tones) — partial explanations are how you get false positives.
  const candidates: ScaleType[] = (Object.keys(MODE_INTERVALS) as ScaleType[]).filter((mode) => {
    if (mode === scale) return false; // not a switch, it's where we already are
    const modePcs = new Set(MODE_INTERVALS[mode].map((i) => (tonic + i) % 12));
    for (const pc of foreignPcs) if (!modePcs.has(pc)) return false;
    return true;
  });

  // Confidence gate: only a single candidate gets a suggestion.
  if (candidates.length !== 1) return null;

  const mode = candidates[0];
  const chordNames = foreignChords.map((f) =>
    noteName(pitchClass(f.chord.root), key) + (f.chord.quality === "maj" ? "" : ""),
  );
  return {
    scale: mode,
    label: SCALE_NAMES[mode],
    foreignPitchClasses: [...foreignPcs].sort((a, b) => a - b),
    chordNames,
    candidateId: `${key}|${scale}->${mode}|${[...foreignPcs].sort((a, b) => a - b).join(",")}`,
  };
}

/** Is this chord diatonic to the given key/scale? Used to paint the subtle
 *  "borrowed" residue marker in the progression track. */
export function isChordDiatonic(chord: Chord, key: NoteName, scale: ScaleType): boolean {
  const tonic = pitchClass(key);
  const scalePcs = new Set((MODE_INTERVALS[scale] ?? MODE_INTERVALS.ionian).map((i) => (tonic + i) % 12));
  return chordPitchClasses(chord).every((pc) => scalePcs.has(pc));
}
