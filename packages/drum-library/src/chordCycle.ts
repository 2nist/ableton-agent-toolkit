/**
 * Chord cycle — how a section's (short) chord list is expanded to fill the
 * section's full duration, honoring Euclidean harmony when the section
 * carries a `harmonyMeterOutline` (or follows the drums' outline) and the
 * global "jazz push" syncopation offset.
 *
 * This is the SINGLE shared home for the chord-cycle math, so the web
 * app's .mid export / live out and the Ableton bridge's clips literally
 * call the same functions and can't drift (previously each kept its own
 * verbatim copy of `loopChordsToFill`/`loopChordsOnOutline`/
 * `resolveChordOccurrences`/`applySyncopation`).
 *
 * Chords are typed structurally (`C extends { beats: number }`) so this
 * package stays decoupled from the blueprint schema — callers pass their
 * own `Chord`/`BlueprintChord` and get it back unchanged inside each
 * `ChordOccurrence`.
 */

import { chordOnsetsForOutline, type MeterOutline } from "./meter.js";
import { conductChords } from "./conduct.js";
import { normaliseTimeDomain } from "./timeDomain.js";

/** The chord fields the cycle math reads. Structural (not the blueprint
 *  type) so this package stays decoupled from the schema. */
export interface CycledChord {
  beats: number;
  /** Silence after this chord, inside the cycle. Absent = 0. */
  restAfter?: number;
  /** Silence before this chord — only meaningful on the cycle's first
   *  chord. Absent = 0. */
  restBefore?: number;
}

const gap = (beats: number | undefined): number =>
  typeof beats === "number" && Number.isFinite(beats) && beats > 0 ? beats : 0;

/** Silence before a chord, in beats. */
export const chordGapBefore = (chord: CycledChord): number => gap(chord.restBefore);

/** Silence after a chord, in beats. */
export const chordGapAfter = (chord: CycledChord): number => gap(chord.restAfter);

/** One full pass through a progression, rests included — the length the
 *  loop repeats on. */
export const chordCycleBeats = (chords: readonly CycledChord[]): number =>
  chords.reduce(
    (sum, chord) => sum + chordGapBefore(chord) + Math.max(0, chord.beats) + chordGapAfter(chord),
    0,
  );

/** One resolved chord placement in a section — `startTime`/`duration` in
 *  beats from the section start. `C` is the caller's chord type. */
export interface ChordOccurrence<C = { beats: number }> {
  chord: C;
  startTime: number;
  duration: number;
}

/** The section fields the resolver reads — a structural subset of the
 *  blueprint schema's `BlueprintSection`, so both the app and the bridge
 *  pass their own section object straight in. */
export interface ChordResolutionSource<C extends CycledChord> {
  harmonyMeterOutline?: MeterOutline | null;
  harmonyFollowsDrums?: boolean;
  drumMeterOutline?: MeterOutline | null;
  syncopationOffset?: number;
  chords?: C[] | null;
  /** The section's own clock, if it has one. Read structurally so this module
   *  keeps its distance from the schema. */
  timeDomain?: Parameters<typeof normaliseTimeDomain>[0];
}

/**
 * A section's `chords` list is one pass through its progression, not the
 * whole section (a 16-bar verse built from a 4-bar/4-chord progression
 * lists only those 4 chords). This loops the list to fill `durationBeats`,
 * truncating the final repeat if it doesn't divide evenly. Shared by every
 * chord-driven generator (chords, bass, color) so they can't drift out of
 * sync with each other on the same section.
 */
export function loopChordsToFill<C extends CycledChord>(chords: C[], durationBeats: number, spacing = 1): ChordOccurrence<C>[] {
  const cycleBeats = chordCycleBeats(chords);
  if (cycleBeats <= 0) return [];

  const occurrences: ChordOccurrence<C>[] = [];
  let cursor = 0;
  while (cursor < durationBeats) {
    for (const chord of chords) {
      if (cursor >= durationBeats) break;
      // A rest is silence: advance the cursor and place no occurrence, so
      // nothing sounds, nothing exports, and the next chord simply lands later.
      cursor += chordGapBefore(chord);
      if (cursor >= durationBeats) break;
      // `spacing` is the Bend density nudge and re-times chords only — an
      // authored rest is a placement, not a duration, so it never stretches.
      const span = chord.beats * spacing;
      const duration = Math.min(span, durationBeats - cursor);
      occurrences.push({ chord, startTime: cursor, duration });
      cursor += span + chordGapAfter(chord);
    }
  }
  return occurrences;
}

/**
 * Euclidean harmony — the chord progression advances on the onsets of a
 * `MeterOutline` (each 2s/3s cell's start) instead of per-chord `beats`,
 * wrapping the `chords` list across `durationBeats` exactly like
 * `loopChordsToFill`. This is the harmony counterpart of the drum outline:
 * harmony and drums sharing the same outline lock into the same syncopated
 * grid; a different one runs polymeter against it.
 */
export function loopChordsOnOutline<C extends { beats: number }>(chords: C[], outline: MeterOutline, durationBeats: number): ChordOccurrence<C>[] {
  const onsets = chordOnsetsForOutline(outline, durationBeats);
  if (onsets.length === 0 || chords.length === 0) return [];
  const occurrences: ChordOccurrence<C>[] = [];
  for (let i = 0; i < onsets.length; i++) {
    const startTime = onsets[i];
    const end = onsets[i + 1] ?? durationBeats;
    const duration = Math.max(0, Math.round((end - startTime) * 10000) / 10000);
    occurrences.push({ chord: chords[i % chords.length], startTime, duration });
  }
  return occurrences;
}

/**
 * Resolve a section's chord occurrences honoring Euclidean harmony: an
 * explicit `harmonyMeterOutline`, else the drums' outline — following the
 * drums is the DEFAULT when a section has a `drumMeterOutline`; set
 * `harmonyFollowsDrums: false` to stay on per-chord `beats` instead.
 * Shared by every chord-driven generator so chords, bass and color can't
 * drift.
 */
export function resolveChordOccurrences<C extends CycledChord>(
  section: ChordResolutionSource<C>,
  durationBeats: number,
  spacing = 1,
): ChordOccurrence<C>[] {
  const outline =
    section.harmonyMeterOutline ??
    (section.harmonyFollowsDrums === false ? null : (section.drumMeterOutline ?? null));
  // The section's own clock, applied HERE rather than at each of the thirty-odd
  // readers of this function: a chord change is structural, so half time makes
  // each chord twice as long and `loopChordsToFill` then repeats the
  // progression to fill the section. Chords, bass, colour and numerals all
  // resolve through this one call, so they cannot disagree about where the
  // harmony is (§P3.5 — the bass used to move while the chords stood still).
  const domain = normaliseTimeDomain(section.timeDomain);
  const rawChords = section.chords ?? [];
  const chords = domain ? conductChords(rawChords, domain) : rawChords;
  // An authored Euclidean grid conducts by its CELL length, not by chord
  // `beats` (which the outline ignores): a clock retimes the grid itself, so a
  // warp keeps its syncopation at a different speed instead of standing still
  // — which is what "the outline wins" used to mean, silently.
  const grid =
    outline && domain ? { ...outline, cellBeats: outline.cellBeats / domain.rate } : outline;
  // `spacing` (the Bend density nudge) only re-times the PLAIN per-chord
  // case — an authored Euclidean outline (harmony or drums) is a grid and
  // is never stretched. Default 1 = exactly the historical behavior.
  const occurrences = grid
    ? loopChordsOnOutline(chords, grid, durationBeats)
    : loopChordsToFill(chords, durationBeats, spacing);
  return applySyncopation(occurrences, section.syncopationOffset);
}

/** Shift every chord change EARLY by `offset` — the global "jazz push"
 *  (e.g. 0.5 = an 8th-note anticipation). Durations follow the shifted
 *  starts; the section's first chord is clamped to its start so no note
 *  precedes a clip, and the last chord still runs to the section end. */
export function applySyncopation<C>(occurrences: ChordOccurrence<C>[], offset: number | undefined): ChordOccurrence<C>[] {
  if (!offset || offset <= 0) return occurrences;
  const starts = occurrences.map((o) => Math.max(0, Math.round((o.startTime - offset) * 10000) / 10000));
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return occurrences.map((o, i) => {
    const naturalEnd = round(o.startTime + o.duration);
    // Chords normally tile, so a push stretches each one up to the next
    // onset instead of leaving a gap. A rest is exactly that gap, authored —
    // so it must not be swallowed by the previous chord.
    const restsAfter = i < occurrences.length - 1 && occurrences[i + 1].startTime - naturalEnd > 1e-6;
    const end = i < occurrences.length - 1 && !restsAfter ? starts[i + 1] : naturalEnd;
    return { ...o, startTime: starts[i], duration: Math.max(0, round(end - starts[i])) };
  });
}
