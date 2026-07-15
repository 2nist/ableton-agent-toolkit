/** Re-exports of types needed from @music-theory/core without cross-package dependency */

export type ScaleType =
  | "ionian" | "dorian" | "phrygian" | "lydian"
  | "mixolydian" | "aeolian" | "locrian";

export type NoteName = string;
export type ChordQuality =
  | "maj" | "min" | "dim" | "aug" | "7" | "maj7" | "min7" | "m7b5" | "sus2" | "sus4";