/**
 * Tension, as something you can see on the chord box.
 *
 * The Harmony floor used to carry a tension strip along its foot — a 46px band
 * plotting one point per chord. Measured on a real song it was a flat 0.50
 * line for 86% of the chords (75 of 87), because 0.50 *is* what a plain
 * diatonic chord reads as. The information was entirely in the deviations, and
 * those were a few pixels of movement across the whole plate.
 *
 * So tension is drawn where it belongs instead: a chord that adds dissonance
 * glows warmer than its neighbours. 0.50 and below is left completely alone —
 * marking "nothing special" is how you end up with a wash of colour that says
 * nothing.
 */

/** A plain diatonic chord. Everything at or below this is drawn unmarked. */
export const TENSION_NEUTRAL = 0.5;

/** The point at which a chord is fully "hot" — tritone, bII, altered
 *  dominants. `functionalTension` tops out around here for real harmony. */
export const TENSION_FULL = 0.85;

/** 0 at neutral, 1 at fully dissonant, linear between. Clamped, so a caller
 *  can multiply it into an opacity without re-checking the range. */
export function tensionHeat(tension: number | undefined): number {
  if (tension === undefined || !Number.isFinite(tension)) return 0;
  const span = TENSION_FULL - TENSION_NEUTRAL;
  return Math.max(0, Math.min(1, (tension - TENSION_NEUTRAL) / span));
}
