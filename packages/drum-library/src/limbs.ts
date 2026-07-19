import type { Limb } from "./types.js";

/**
 * E-GMD was recorded on Roland TD-11 kits, so the note numbers are General
 * MIDI percussion plus the TD-11's extended hi-hat articulations (22 closed
 * edge, 26 open edge) — both of which do appear in the data, so they can't
 * be dropped as non-GM noise.
 *
 * Grouping is by *limb* rather than by instrument because limbs are the unit
 * of recombination: the foot pattern from one drummer under the cymbal hand
 * of another. The pedal hi-hat (44) is grouped with the feet for that reason
 * even though it sounds like a hat — it's played by the left foot, and
 * lifting it along with the cymbal hand would produce something no drummer
 * could play.
 */
const FEET = new Set([35, 36, 44]);
const SNARE = new Set([37, 38, 39, 40]);
const TOMS = new Set([41, 43, 45, 47, 48, 50]);
const CYMBALS = new Set([22, 26, 42, 46, 49, 51, 52, 53, 55, 57, 59]);

/**
 * Cymbal voices that ring open — open hi-hats and crashes. Rides (51/53/59)
 * are deliberately excluded: they sustain, but a ride pattern reads as
 * controlled rather than bright, which is the distinction `brightness` is
 * trying to capture.
 */
const BRIGHT_CYMBALS = new Set([26, 46, 49, 52, 55, 57]);

/**
 * Which limb plays a given note number, or null for voices outside the kit
 * grouping (tambourine, cowbell and similar auxiliary percussion). Callers
 * skip nulls rather than forcing them into a limb, so an unexpected voice
 * can never silently corrupt a limb's feel measurements.
 */
export function limbOf(pitch: number): Limb | null {
  if (FEET.has(pitch)) return "feet";
  if (SNARE.has(pitch)) return "snare";
  if (TOMS.has(pitch)) return "toms";
  if (CYMBALS.has(pitch)) return "cymbals";
  return null;
}

export function isBrightCymbal(pitch: number): boolean {
  return BRIGHT_CYMBALS.has(pitch);
}

/** The limbs worth indexing, in the order a kit is usually described. */
export const LIMBS: readonly Limb[] = ["feet", "snare", "cymbals", "toms"];
