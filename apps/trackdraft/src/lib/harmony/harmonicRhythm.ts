/**
 * Harmonic rhythm — how long each chord in a progression lasts. A section's
 * `chords` list is ONE pass through its progression (a 16-bar verse built
 * from four chords lists only those four); the generator loops that list to
 * fill the section. So the pair of numbers that actually decide the feel are
 *
 * - each chord's `beats` (its share of the cycle), and
 * - the cycle length, which is just their sum.
 *
 * The pure functions here back the harmonic-rhythm strip: drag the boundary
 * between two chords and they trade beats (the cycle stays the same length,
 * so the progression keeps repeating at the same rate); use an even preset
 * and every chord gets the same share (which *does* change the cycle length,
 * and therefore how many times the progression repeats).
 */

import type { Chord } from "../../types/blueprint";

/** Shortest chord the strip will produce, in beats. */
export const MIN_CHORD_BEATS = 0.5;
/** Snap grid for a dragged boundary, in beats (a half-beat is on-grid in
 *  every meter the app supports, and fine enough to feel free). */
export const RHYTHM_GRID = 0.5;

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/** Beats in one pass through the progression — the length the list loops at. */
export function cycleBeats(chords: Pick<Chord, "beats">[]): number {
  return round(chords.reduce((sum, chord) => sum + Math.max(0, chord.beats), 0));
}

/** The cycle's length in bars (fractional for an odd cycle). */
export function cycleBars(chords: Pick<Chord, "beats">[], beatsPerBar: number): number {
  if (beatsPerBar <= 0) return 0;
  return round(cycleBeats(chords) / beatsPerBar);
}

/**
 * How many passes of the progression fit in a section — the "↻ repeats ×N"
 * readout. Fractional when the cycle doesn't divide the section evenly (the
 * resolver truncates the final pass rather than spilling past the end).
 */
export function cycleRepeats(
  chords: Pick<Chord, "beats">[],
  sectionBeats: number,
): number {
  const cycle = cycleBeats(chords);
  if (cycle <= 0 || sectionBeats <= 0) return 0;
  return round(sectionBeats / cycle);
}

/** True when the progression repeats a whole number of times. */
export function repeatsEvenly(chords: Pick<Chord, "beats">[], sectionBeats: number): boolean {
  const repeats = cycleRepeats(chords, sectionBeats);
  return repeats > 0 && Math.abs(repeats - Math.round(repeats)) < 1e-6;
}

/** Beats per chord when the progression is spread evenly — the value the
 *  section's `beatsPerChord` default is kept in sync with. */
export function dominantBeatsPerChord(chords: Pick<Chord, "beats">[]): number {
  if (chords.length === 0) return 4;
  const counts = new Map<number, number>();
  for (const chord of chords) counts.set(chord.beats, (counts.get(chord.beats) ?? 0) + 1);
  let best = chords[0].beats;
  let bestCount = 0;
  for (const [beats, count] of counts) {
    if (count > bestCount) {
      best = beats;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Move the boundary between `chords[index]` and `chords[index + 1]` by
 * `deltaBeats`, snapped to the grid. The two chords trade beats, so the cycle
 * length (and therefore the repeat rate) is preserved; neither can go below
 * one grid cell. The last chord has no boundary after it — the cycle's end is
 * set by the sum, not by a single chord — so a trailing index is a no-op.
 */
export function redistributeBeats(
  chords: Chord[],
  index: number,
  deltaBeats: number,
  grid: number = RHYTHM_GRID,
): Chord[] {
  const current = chords[index];
  const next = chords[index + 1];
  if (!current || !next) return chords;
  const step = grid > 0 ? grid : MIN_CHORD_BEATS;
  const boundary = chords
    .slice(0, index + 1)
    .reduce((sum, chord) => sum + chord.beats, 0);
  const lowest = boundary - current.beats + step;
  const highest = boundary + next.beats - step;
  const target = Math.min(
    Math.max(Math.round((boundary + deltaBeats) / step) * step, lowest),
    highest,
  );
  const nextBeats = round(target - (boundary - current.beats));
  return chords.map((chord, i) => {
    if (i === index) return { ...chord, beats: nextBeats };
    if (i === index + 1) return { ...chord, beats: round(current.beats + next.beats - nextBeats) };
    return chord;
  });
}

/** Give every chord the same length — the "1 bar / ½ bar / 2 bars" presets.
 *  This changes the cycle length, so the progression repeats more or less
 *  often across the section. */
export function evenHarmonicRhythm(chords: Chord[], beatsPerChord: number): Chord[] {
  const beats = Math.max(MIN_CHORD_BEATS, Math.round(beatsPerChord * 1_000) / 1_000);
  if (chords.every((chord) => chord.beats === beats)) return chords;
  return chords.map((chord) => ({ ...chord, beats }));
}

/**
 * Resize the LAST chord, which lengthens or shortens the whole cycle (there
 * is no next chord to trade with). This is the one edit that changes the
 * repeat rate, so the UI shows the new cycle beside it. Never shorter than
 * one grid cell.
 */
export function resizeCycleEnd(
  chords: Chord[],
  deltaBeats: number,
  grid: number = RHYTHM_GRID,
): Chord[] {
  if (chords.length === 0) return chords;
  const step = grid > 0 ? grid : MIN_CHORD_BEATS;
  const last = chords[chords.length - 1];
  const beats = Math.max(step, Math.round((last.beats + deltaBeats) / step) * step);
  const rounded = round(beats);
  if (rounded === last.beats) return chords;
  return chords.map((chord, index) =>
    index === chords.length - 1 ? { ...chord, beats: rounded } : chord,
  );
}

export interface RhythmPreset {
  label: string;
  /** Beats per chord this preset sets. */
  beats: number;
}

/** Even-rhythm presets for a meter: one chord per two bars, per bar, per
 *  half bar. */
export function rhythmPresets(beatsPerBar: number): RhythmPreset[] {
  const perBar = beatsPerBar > 0 ? beatsPerBar : 4;
  return [
    { label: "2 bars", beats: perBar * 2 },
    { label: "1 bar", beats: perBar },
    { label: "½ bar", beats: perBar / 2 },
  ];
}
