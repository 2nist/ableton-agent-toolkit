import type { ScaleType } from "@music-theory/core";

/**
 * The seven modes, in the order every picker shows them.
 *
 * This literal was copied into four files (the workbench's settings strip, the
 * harmony key selector, the retired floating toolbar, and the library filter
 * bar). `ScaleType` is the contract; this is its ordered list — the one place
 * a new mode would have to be added.
 */
export const SCALES: readonly ScaleType[] = [
  "ionian",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "aeolian",
  "locrian",
];
