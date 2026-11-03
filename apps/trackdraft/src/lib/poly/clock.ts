/**
 * The global clock: tempo, key, scale, meter.
 *
 * The canvas has no clock of its own — every lane reads the song's. Until now
 * the canvas could not even show you what it was playing in: the key and tempo
 * were printed, faintly, in the shell's title chip (and only above `md`), and
 * the only editors lived in the workbench's settings strip. A workspace you
 * cannot set the tempo in is not a workspace.
 *
 * These helpers are the arithmetic behind the one control the canvas owns, kept
 * out of the component so "a drag of 3 px is a BPM, and it stops at the ends" is
 * a test rather than a comment.
 */

/** The same range the workbench's number field accepts. */
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 999;

/** Pixels per BPM while scrubbing. Slow enough that a 400px drag covers the
 *  useful range (60 → 190) without a triple-digit flick. */
export const PX_PER_BPM = 3;

/** The tempo a horizontal drag means: whole BPM, clamped, never negative. */
export function tempoFromDrag(startBpm: number, dxPx: number): number {
  const raw = startBpm + dxPx / PX_PER_BPM;
  return Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(raw)));
}

/** `4/4`, `7/8` — the song's own meter, in the form musicians say it. */
export function meterLabel(song: {
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
}): string {
  const numerator = Math.max(1, Math.round(song.timeSignatureNumerator));
  const denominator = Math.max(1, Math.round(song.timeSignatureDenominator));
  return `${numerator}/${denominator}`;
}
