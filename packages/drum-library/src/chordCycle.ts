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
export interface ChordResolutionSource<C extends { beats: number }> {
  harmonyMeterOutline?: MeterOutline | null;
  harmonyFollowsDrums?: boolean;
  drumMeterOutline?: MeterOutline | null;
  syncopationOffset?: number;
  chords?: C[] | null;
}

/**
 * A section's `chords` list is one pass through its progression, not the
 * whole section (a 16-bar verse built from a 4-bar/4-chord progression
 * lists only those 4 chords). This loops the list to fill `durationBeats`,
 * truncating the final repeat if it doesn't divide evenly. Shared by every
 * chord-driven generator (chords, bass, color) so they can't drift out of
 * sync with each other on the same section.
 */
export function loopChordsToFill<C extends { beats: number }>(chords: C[], durationBeats: number): ChordOccurrence<C>[] {
  const cycleBeats = chords.reduce((sum, chord) => sum + chord.beats, 0);
  if (cycleBeats <= 0) return [];

  const occurrences: ChordOccurrence<C>[] = [];
  let cursor = 0;
  while (cursor < durationBeats) {
    for (const chord of chords) {
      if (cursor >= durationBeats) break;
      const duration = Math.min(chord.beats, durationBeats - cursor);
      occurrences.push({ chord, startTime: cursor, duration });
      cursor += chord.beats;
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
export function resolveChordOccurrences<C extends { beats: number }>(
  section: ChordResolutionSource<C>,
  durationBeats: number,
): ChordOccurrence<C>[] {
  const outline =
    section.harmonyMeterOutline ??
    (section.harmonyFollowsDrums === false ? null : (section.drumMeterOutline ?? null));
  const chords = section.chords ?? [];
  const occurrences = outline
    ? loopChordsOnOutline(chords, outline, durationBeats)
    : loopChordsToFill(chords, durationBeats);
  return applySyncopation(occurrences, section.syncopationOffset);
}

/** Shift every chord change EARLY by `offset` — the global "jazz push"
 *  (e.g. 0.5 = an 8th-note anticipation). Durations follow the shifted
 *  starts; the section's first chord is clamped to its start so no note
 *  precedes a clip, and the last chord still runs to the section end. */
export function applySyncopation<C>(occurrences: ChordOccurrence<C>[], offset: number | undefined): ChordOccurrence<C>[] {
  if (!offset || offset <= 0) return occurrences;
  const starts = occurrences.map((o) => Math.max(0, Math.round((o.startTime - offset) * 10000) / 10000));
  return occurrences.map((o, i) => {
    const end =
      i < occurrences.length - 1
        ? starts[i + 1]
        : Math.round((o.startTime + o.duration) * 10000) / 10000; // last still reaches the section end
    return { ...o, startTime: starts[i], duration: Math.max(0, Math.round((end - starts[i]) * 10000) / 10000) };
  });
}
