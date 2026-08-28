import { chordOnsetsForOutline, type MeterOutline } from "@drum/library";
import type { BlueprintChord, BlueprintSection } from "./blueprint.js";

export interface ChordOccurrence {
  chord: BlueprintChord;
  startTime: number;
  duration: number;
}

/**
 * A section's `chords` list is one pass through its progression, not the
 * whole section (a 16-bar verse built from a 4-bar/4-chord progression
 * lists only those 4 chords). This loops the list to fill `durationBeats`,
 * truncating the final repeat if it doesn't divide evenly. Shared by every
 * chord-driven generator (chord clips, bass line) so they can't drift out
 * of sync with each other on the same section.
 */
export function loopChordsToFill(chords: BlueprintChord[], durationBeats: number): ChordOccurrence[] {
  const cycleBeats = chords.reduce((sum, chord) => sum + chord.beats, 0);
  if (cycleBeats <= 0) return [];

  const occurrences: ChordOccurrence[] = [];
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
export function loopChordsOnOutline(chords: BlueprintChord[], outline: MeterOutline, durationBeats: number): ChordOccurrence[] {
  const onsets = chordOnsetsForOutline(outline, durationBeats);
  if (onsets.length === 0 || chords.length === 0) return [];
  const occurrences: ChordOccurrence[] = [];
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
export function resolveChordOccurrences(section: BlueprintSection, durationBeats: number): ChordOccurrence[] {
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
function applySyncopation(occurrences: ChordOccurrence[], offset: number | undefined): ChordOccurrence[] {
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
