/**
 * Played notes → chord name.
 *
 * The MIDI chord pad needs to answer "what chord is under the player's
 * fingers right now?" from the pitch classes only (velocity and octave are
 * the performer's business). The corpus importer asks the same question about
 * a beat window in an imported MIDI file, so both routes call THIS function:
 * one vocabulary, one scorer, one tie-break. They used to keep separate
 * candidate lists (10 qualities versus 26), which meant a quality missing from
 * one list could never be named there at all — a maj7 in a corpus file came
 * back as a plain major triad.
 *
 * - the LOWEST sounding note is evidence for the root, so C/E reads as a C
 *   major first inversion instead of a rootless E minor;
 * - the song's key is a soft tie-breaker, so C–E–G in F stays "C" rather
 *   than flipping to "Am7" the moment a G is added;
 * - a quality preference order decides true ties, simplest chord first
 *   (a plain triad never loses to a seventh built from the same notes);
 * - a tone the quality can do without (a 7th chord's fifth) costs far less to
 *   omit than one that defines it, which is what keeps maj7 from sliding to a
 *   wrong denser chord when the fifth is not played;
 * - the previous chord is a weak prior, so a frame that reads two ways does
 *   not flicker between names while the harmony is not actually changing;
 * - a caller-supplied vocabulary (the qualities the current key offers) is
 *   tried first, and only a reading that fully explains the notes is accepted
 *   from it — so the key sharpens an in-key reading without censoring a
 *   borrowed chord the notes plainly state.
 *
 * Everything here is pure — no MIDI, no React — so the scoring is testable
 * without a keyboard plugged in.
 */

import {
  CHORD_INTERVALS,
  CHORD_OPTIONAL_TONES,
  SCALE_INTERVALS,
  chordName,
  midiToPitchClass,
  noteName,
  pitchClass,
} from "@music-theory/core";
import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";

/** The order a tie is resolved in: simplest, least ambiguous first.
 *
 *  Everything absent from this list is appended after it by ascending tone
 *  count, so the vocabulary cannot silently drift from CHORD_INTERVALS again:
 *  every quality that can sound is nameable, while the genuinely ambiguous
 *  ones (a "13" and a "6" share pitch classes) only win when no earlier chord
 *  explains the notes. */
const PREFERRED_ORDER: ChordQuality[] = [
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

/** Every quality that can be named, in tie-break order. */
export const CANDIDATE_QUALITIES: readonly ChordQuality[] = (() => {
  const known = new Set<ChordQuality>(PREFERRED_ORDER);
  const rest = (Object.keys(CHORD_INTERVALS) as ChordQuality[])
    .filter((quality) => !known.has(quality))
    .sort((a, b) => {
      const bySize = CHORD_INTERVALS[a].length - CHORD_INTERVALS[b].length;
      return bySize !== 0 ? bySize : a.localeCompare(b);
    });
  return [...PREFERRED_ORDER, ...rest];
})();

export interface RecognizedChord {
  rootPc: number;
  quality: ChordQuality;
  /** 0–1; 1 means every played note is a chord tone and the chord is complete. */
  score: number;
  /** Played pitch classes outside the chord. */
  extras: number[];
  /** Chord tones the player left out (a 5th, usually). */
  missing: number[];
  /** Chord tone sitting in the bass, as an index into the quality's interval
   *  row (0 = root position). Present only when the caller supplied a bass
   *  that is one of this chord's tones. */
  inversion?: number;
}

export interface RecognizeOptions {
  /** Pitch class of the lowest sounding note — the strongest hint about the root. */
  bassPc?: number;
  /** Key context for the tie-breaker. */
  keyName?: NoteName;
  scale?: ScaleType;
  /** The chord sounding before this frame, used as a stability prior. */
  previous?: Pick<RecognizedChord, "rootPc" | "quality">;
  /** Qualities the current context permits, e.g. `diatonicChordQualities`.
   *  Tried first; only a reading with no unexplained note is taken from it,
   *  so a borrowed chord the notes state plainly still wins the full search. */
  permitted?: readonly ChordQuality[];
}

interface Candidate {
  quality: ChordQuality;
  intervals: readonly number[];
  /** Unique pitch classes of the shape, so 9ths/13ths compare like triads. */
  pcs: readonly number[];
  /** Indices into the interval row that may be omitted without changing the name. */
  optional: ReadonlySet<number>;
}

/** Templates are fixed per quality; build them once instead of per frame. */
const TEMPLATES: readonly Candidate[] = CANDIDATE_QUALITIES.map((quality) => {
  const intervals = CHORD_INTERVALS[quality];
  return {
    quality,
    intervals,
    pcs: Array.from(new Set(intervals.map((interval) => ((interval % 12) + 12) % 12))),
    optional: new Set(CHORD_OPTIONAL_TONES[quality] ?? []),
  };
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inScale(pc: number, keyName: NoteName, scale: ScaleType): boolean {
  const offset = ((pc - pitchClass(keyName)) % 12 + 12) % 12;
  return (SCALE_INTERVALS[scale] ?? []).includes(offset);
}

/**
 * Cost of the tones this shape did not play.
 *
 * Walks the interval row rather than the pitch-class set so an `optional`
 * index still refers to the tone the vocabulary marked, and charges an
 * optional tone 0.04 against 0.15 for one that carries the quality.
 */
function omissionPenalty(
  rootPc: number,
  template: Candidate,
  absent: ReadonlySet<number>,
): number {
  let penalty = 0;
  const seen = new Set<number>();
  template.intervals.forEach((interval, index) => {
    const pc = (rootPc + interval) % 12;
    if (seen.has(pc)) return;
    seen.add(pc);
    if (!absent.has(pc)) return;
    penalty += template.optional.has(index) ? 0.04 : 0.15;
  });
  return penalty;
}

/** Pitch classes of this shape that may be left out without changing its name. */
function optionalPitchClasses(rootPc: number, quality: ChordQuality): Set<number> {
  const intervals = CHORD_INTERVALS[quality];
  return new Set(
    (CHORD_OPTIONAL_TONES[quality] ?? []).map((index) => (rootPc + intervals[index]) % 12),
  );
}

/**
 * Whether a reading accounts for everything the player actually sounded:
 * no stray notes, and every absent tone one the quality can do without.
 * That is the bar a permitted-vocabulary reading has to clear.
 */
function explainsCleanly(chord: RecognizedChord): boolean {
  if (chord.extras.length > 0) return false;
  const optional = optionalPitchClasses(chord.rootPc, chord.quality);
  return chord.missing.every((pc) => optional.has(pc));
}

/** Highest-scoring reading among `templates`, or null when none applies. */
function bestReading(
  templates: readonly Candidate[],
  played: readonly number[],
  playedSet: ReadonlySet<number>,
  options: RecognizeOptions,
): RecognizedChord | null {
  let best: RecognizedChord | null = null;

  for (const template of templates) {
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      const templatePcs = template.pcs.map((pc) => (rootPc + pc) % 12);
      const templateSet = new Set(templatePcs);
      const extras = played.filter((pc) => !templateSet.has(pc));
      const missing = templatePcs.filter((pc) => !playedSet.has(pc));

      // "How much of the chord did they play" minus the cost of notes that do
      // not belong. Stray notes are expensive; missing ones are charged by
      // `omissionPenalty`, which knows which tones the quality can do without.
      let score = (templatePcs.length - missing.length) / Math.max(1, templatePcs.length);
      score -= extras.length * 0.35;
      score -= omissionPenalty(rootPc, template, new Set(missing));

      const bassIsRoot = options.bassPc !== undefined && options.bassPc === rootPc;
      if (bassIsRoot) score += 0.08;
      if (options.keyName && options.scale && inScale(rootPc, options.keyName, options.scale)) {
        score += 0.04;
      }
      if (options.previous) {
        if (options.previous.rootPc === rootPc && options.previous.quality === template.quality) {
          score += 0.08;
        } else if (options.previous.rootPc === rootPc) {
          score += 0.03;
        }
      }
      score = clamp(score, 0.01, 1);

      const candidate: RecognizedChord = {
        rootPc,
        quality: template.quality,
        score,
        extras,
        missing,
      };
      if (options.bassPc !== undefined && templateSet.has(options.bassPc)) {
        const offset = ((options.bassPc - rootPc) % 12 + 12) % 12;
        const index = template.intervals.findIndex(
          (interval) => ((interval % 12) + 12) % 12 === offset,
        );
        if (index >= 0) candidate.inversion = index;
      }

      if (!best) {
        best = candidate;
        continue;
      }
      // Only a clearly better score displaces the incumbent, so the quality
      // preference order above survives near-ties. Inside that band, prefer
      // the reading that leaves no played note unexplained: a stray note means
      // "this chord does not contain what you played", while a missing
      // optional tone does not.
      if (candidate.score > best.score + 0.06) {
        best = candidate;
        continue;
      }
      if (candidate.score < best.score - 0.06) continue;
      if (candidate.extras.length !== best.extras.length) {
        if (candidate.extras.length < best.extras.length) best = candidate;
        continue;
      }
      const bestIsBass = options.bassPc !== undefined && best.rootPc === options.bassPc;
      if (bassIsRoot !== bestIsBass) {
        if (bassIsRoot) best = candidate;
      }
    }
  }

  return best;
}

/**
 * Name the chord a player is holding.
 *
 * Returns null for nothing played and for a single pitch — one note is not
 * a chord, and guessing "C major" from a lone C would put a chord in the
 * progression every time someone rests a finger on the keyboard.
 *
 * When `permitted` is supplied the search runs twice: once over the permitted
 * qualities only, and — if that reading leaves a played note unexplained —
 * once over the whole vocabulary. The key therefore breaks ties and rejects
 * half-finished shapes without ever hiding a chord the notes state outright.
 */
export function recognizeChord(
  pitchClasses: readonly number[],
  options: RecognizeOptions = {},
): RecognizedChord | null {
  const played = Array.from(new Set(pitchClasses.map((pc) => ((pc % 12) + 12) % 12)));
  if (played.length < 2) return null;
  const playedSet = new Set(played);

  if (options.permitted && options.permitted.length > 0) {
    const permitted = new Set(options.permitted);
    const restricted = TEMPLATES.filter((template) => permitted.has(template.quality));
    if (restricted.length > 0) {
      const inKey = bestReading(restricted, played, playedSet, options);
      if (inKey && explainsCleanly(inKey)) return inKey;
    }
  }

  return bestReading(TEMPLATES, played, playedSet, options);
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
