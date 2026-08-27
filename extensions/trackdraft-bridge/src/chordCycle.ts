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
 * explicit `harmonyMeterOutline`, else the drums' outline when
 * `harmonyFollowsDrums` is set (the drums literally drive the harmony
 * rhythm), else per-chord `beats` exactly as before. Shared by every
 * chord-driven generator so chords, bass and color can't drift.
 */
export function resolveChordOccurrences(section: BlueprintSection, durationBeats: number): ChordOccurrence[] {
  const outline =
    section.harmonyMeterOutline ?? (section.harmonyFollowsDrums ? (section.drumMeterOutline ?? null) : null);
  const chords = section.chords ?? [];
  return outline ? loopChordsOnOutline(chords, outline, durationBeats) : loopChordsToFill(chords, durationBeats);
}
