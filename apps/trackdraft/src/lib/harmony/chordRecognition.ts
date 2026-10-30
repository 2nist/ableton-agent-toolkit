/**
 * Played notes → chord name.
 *
 * The MIDI chord pad needs to answer "what chord is under the player's
 * fingers right now?" from the pitch classes only (velocity and octave are
 * the performer's business). This is the same idea as
 * `lib/parsers/midiChordDetect.ts`, but tuned for live input rather than
 * corpus import:
 *
 * - the LOWEST sounding note is evidence for the root, so C/E reads as a C
 *   major first inversion instead of a rootless E minor;
 * - the song's key is a soft tie-breaker, so C–E–G in F stays "C" rather
 *   than flipping to "Am7" the moment a G is added;
 * - a quality preference order decides true ties, simplest chord first
 *   (a plain triad never loses to a seventh built from the same notes).
 *
 * Everything here is pure — no MIDI, no React — so the scoring is testable
 * without a keyboard plugged in.
 */

import {
  CHORD_INTERVALS,
  SCALE_INTERVALS,
  chordName,
  midiToPitchClass,
  noteName,
  pitchClass,
} from "@music-theory/core";
import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";

/** The chord qualities worth naming from a played set. Extended qualities are
 *  deliberately kept to ones whose pitch classes stay unambiguous; a "13"
 *  and a "6" are the same four pitch classes, so the simpler spelling wins by
 *  order rather than by a coin toss. */
const CANDIDATE_QUALITIES: ChordQuality[] = [
  "maj",
  "min",
  "5",
  "sus4",
  "sus2",
  "dim",
  "aug",
  "7",
  "maj7",
  "min7",
  "m7b5",
  "dim7",
  "mMaj7",
  "6",
  "min6",
  "add9",
  "7sus4",
  "7b5",
  "7#5",
  "maj7#5",
  "9",
  "maj9",
  "min9",
  "7b9",
  "7#9",
  "7#11",
];

export interface RecognizedChord {
  rootPc: number;
  quality: ChordQuality;
  /** 0–1; 1 means every played note is a chord tone and the chord is complete. */
  score: number;
  /** Played pitch classes outside the chord. */
  extras: number[];
  /** Chord tones the player left out (a 5th, usually). */
  missing: number[];
}

export interface RecognizeOptions {
  /** Pitch class of the lowest sounding note — the strongest hint about the root. */
  bassPc?: number;
  /** Key context for the tie-breaker. */
  keyName?: NoteName;
  scale?: ScaleType;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Unique pitch classes of a chord shape, so 9ths/13ths compare like triads. */
function templateFor(rootPc: number, quality: ChordQuality): Set<number> {
  return new Set(CHORD_INTERVALS[quality].map((interval) => (rootPc + interval) % 12));
}

function inScale(pc: number, keyName: NoteName, scale: ScaleType): boolean {
  const offset = ((pc - pitchClass(keyName)) % 12 + 12) % 12;
  return (SCALE_INTERVALS[scale] ?? []).includes(offset);
}

/**
 * Name the chord a player is holding.
 *
 * Returns null for nothing played and for a single pitch — one note is not
 * a chord, and guessing "C major" from a lone C would put a chord in the
 * progression every time someone rests a finger on the keyboard.
 */
export function recognizeChord(
  pitchClasses: readonly number[],
  options: RecognizeOptions = {},
): RecognizedChord | null {
  const played = Array.from(new Set(pitchClasses.map((pc) => ((pc % 12) + 12) % 12)));
  if (played.length < 2) return null;

  let best: RecognizedChord | null = null;

  for (const quality of CANDIDATE_QUALITIES) {
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      const template = templateFor(rootPc, quality);
      const missing = Array.from(template).filter((pc) => !played.includes(pc));
      const extras = played.filter((pc) => !template.has(pc));
      const matched = template.size - missing.length;

      // The score is "how much of the chord did they play" minus the cost of
      // notes that do not belong. Missing tones are cheap (a pianist omits
      // the 5th constantly); stray notes are expensive.
      let score = matched / Math.max(1, template.size);
      score -= extras.length * 0.35;
      score -= missing.length * 0.15;

      if (options.bassPc !== undefined && options.bassPc === rootPc) score += 0.08;
      if (options.keyName && options.scale) {
        if (inScale(rootPc, options.keyName, options.scale)) score += 0.04;
      }
      score = clamp(score, 0.01, 1);

      const candidate: RecognizedChord = { rootPc, quality, score, extras, missing };

      if (!best) {
        best = candidate;
        continue;
      }
      // Only a clearly better score displaces the incumbent, so the quality
      // preference order above survives near-ties.
      if (candidate.score > best.score + 0.06) {
        best = candidate;
        continue;
      }
      if (Math.abs(candidate.score - best.score) <= 0.06) {
        const candidateIsBass = options.bassPc !== undefined && candidate.rootPc === options.bassPc;
        const bestIsBass = options.bassPc !== undefined && best.rootPc === options.bassPc;
        if (candidateIsBass && !bestIsBass) best = candidate;
      }
    }
  }

  return best;
}

/** Same, from MIDI note numbers (what a keyboard actually sends). */
export function recognizeChordFromNotes(
  pitches: readonly number[],
  options: RecognizeOptions = {},
): RecognizedChord | null {
  if (pitches.length === 0) return null;
  const bassPc = midiToPitchClass(Math.min(...pitches));
  return recognizeChord(pitches.map(midiToPitchClass), { ...options, bassPc });
}

/** The chord symbol as the rest of the harmony UI spells it. */
export function recognizedChordName(chord: RecognizedChord, keyName: NoteName): string {
  return chordName(chord.rootPc, chord.quality, keyName);
}

/** The root as a note name in the song's key (sharps/flats follow the key). */
export function recognizedRootName(chord: RecognizedChord, keyName: NoteName): NoteName {
  return noteName(chord.rootPc, keyName);
}
