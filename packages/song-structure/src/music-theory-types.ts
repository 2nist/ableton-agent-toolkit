/** Re-exports of types needed from @music-theory/core without cross-package dependency */

export type ScaleType =
  | "ionian" | "dorian" | "phrygian" | "lydian"
  | "mixolydian" | "aeolian" | "locrian";

export type NoteName = string;
export type ChordQuality =
  | "maj" | "min" | "dim" | "aug" | "7" | "maj7" | "min7" | "m7b5" | "sus2" | "sus4"
  | "5" | "6" | "min6" | "69" | "add9" | "dim7" | "mMaj7" | "maj7#5"
  | "7sus4" | "7b5" | "7#5"
  | "9" | "maj9" | "min9" | "9sus4" | "7b9" | "7#9" | "7#11" | "7b13"
  | "11" | "min11" | "13" | "maj13" | "min13";