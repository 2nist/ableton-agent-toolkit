import type { BlueprintChord } from "./blueprint.js";

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
