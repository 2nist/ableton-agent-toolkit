/** Pitch class value (0-11, C=0) */
export type PitchClass = number;

/** Note name with optional accidental */
export type NoteName = string;

/** Scale degree as roman numeral string (e.g. "I", "ii", "iii", "IV", "♭III") */
export type Degree = string;

/** Chord quality/triad type.
 *
 *  The first ten are the historical vocabulary (and the APC64 hardware's
 *  1-based `CHORD_TYPES` index order). Everything from `"5"` on is the
 *  extended vocabulary: real interval sets, so a chord authored as `maj9`
 *  or `7#9` actually *sounds* as one through `getChordIntervals` — it is
 *  not decoration. Note the five- and six-note qualities (`9`/`maj9`/`min9`,
 *  `11`/`min11`, `13`/`maj13`/`min13`). */
export type ChordQuality =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "7"
  | "maj7"
  | "min7"
  | "m7b5"
  | "sus2"
  | "sus4"
  // — extended vocabulary —
  | "5"
  | "6"
  | "min6"
  | "69"
  | "add9"
  | "dim7"
  | "mMaj7"
  | "maj7#5"
  | "7sus4"
  | "7b5"
  | "7#5"
  | "9"
  | "maj9"
  | "min9"
  | "9sus4"
  | "7b9"
  | "7#9"
  | "7#11"
  | "7b13"
  | "11"
  | "min11"
  | "13"
  | "maj13"
  | "min13";

/** Harmonic function: Tonic, Pre-Dominant, Dominant, Borrowed */
export type HarmonicFunction = "T" | "PD" | "D" | "B";

/** Scale/mode identifier */
export type ScaleType =
  | "ionian"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "aeolian"
  | "locrian";

/** Scale degree mapping entry */
export interface DegreeMapEntry {
  /** Pitch class offset from root */
  pc: PitchClass;
  /** Triad quality built on this degree */
  triad: ChordQuality;
  /** Seventh chord quality */
  seventh: ChordQuality;
  /** Harmonic function label */
  func: HarmonicFunction;
  /** Whether this chord is borrowed from parallel mode */
  isBorrowed?: boolean;
}

/** A complete mode definition */
export interface ModeData {
  /** Display name */
  name: string;
  /** Scale degrees (roman numerals) in order */
  degrees: Degree[];
  /** Map from degree string to pitch/quality/func */
  map: Record<Degree, DegreeMapEntry>;
}

/** A chord substitution option */
export interface Substitution {
  /** Target degree (1-7, relative to scale) */
  degree: number;
  /** Theoretical explanation of the substitution */
  explanation: string;
}

/** A substitution group for a specific base degree in a mode */
export interface SubstitutionGroup {
  /** Base scale degree (1-7) */
  base: number;
  /** Available substitution options */
  subs: Substitution[];
}

/** A chord definition with intervals */
export interface ChordType {
  /** Identifier name */
  name: string;
  /** Intervals in semitones from root */
  intervals: number[];
  /** Display suffix (e.g. "", "m", "7", "maj7") */
  display: string;
}

/** A full chord in a progression */
export interface Chord {
  /** Root note name (e.g. "C", "F#") */
  root: NoteName;
  /** Scale degree of the chord */
  degree: Degree;
  /** Chord quality */
  quality: ChordQuality;
  /** Duration in beats */
  beats: number;
  /** Key root */
  key: NoteName;
  /** Mode/scale type */
  mode: ScaleType;
  /** Whether this is a substitution */
  isSubstitution: boolean;
  /** Substitution source degree (if substituted) */
  substitutedFrom?: Degree;
  /** Substitution explanation (if substituted) */
  substitutionReason?: string;
}

/** A preset chord progression */
export interface PresetProgression {
  /** Display name */
  name: string;
  /** Sequence of degrees */
  degrees: Degree[];
  /** Default mode */
  mode: ScaleType;
}

/** Diatonic chord in a scale */
export interface DiatonicChord {
  /** Root pitch class */
  root: PitchClass;
  /** Chord type index (1=maj, 2=min, 3=7, 4=maj7, 5=m7, 6=sus2, 7=sus4, 8=dim, 9=aug) */
  typeIdx: number;
  /** Scale degree number (1-7) */
  degree: number;
}