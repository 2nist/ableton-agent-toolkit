import { chordCycleBeats, chordGapAfter, chordGapBefore } from "@drum/library";
import type { Chord } from "../../types/blueprint";

/**
 * One pass of a section's chord progression, expanded with beat positions
 * to fill the section's full duration — the same loop `midiExport`'s
 * `loopChordsToFill` applies, so a playhead-following UI showing "the chord
 * sounding right now" agrees with what will export. The authored
 * progression loops verbatim; the final slot's duration clamps to the
 * section's end (no chord bleeds past a section boundary).
 *
 * Shared by the karaoke popout and the Song text view's playhead follow —
 * one implementation, so the two "current chord" readouts can't drift.
 */
export interface ChordSlot {
  chord: Chord;
  startBeat: number;
  durationBeats: number;
}

export function chordSlotsForSection(chords: readonly Chord[], durationBeats: number): ChordSlot[] {
  if (chords.length === 0 || durationBeats <= 0) return [];
  const cycleBeats = chordCycleBeats(chords);
  if (cycleBeats <= 0) return []; // degenerate data — refuse rather than loop forever

  const slots: ChordSlot[] = [];
  let cursor = 0;
  while (cursor < durationBeats) {
    for (const chord of chords) {
      if (cursor >= durationBeats) break;
      // A rest is a hole in the timeline: no slot is emitted for it, so both
      // the playhead-follow readouts and the chart show silence, not the
      // previous chord lingering.
      cursor += chordGapBefore(chord);
      if (cursor >= durationBeats) break;
      const chordBeats = Math.min(chord.beats, durationBeats - cursor);
      if (chordBeats > 0) slots.push({ chord, startBeat: cursor, durationBeats: chordBeats });
      cursor += chord.beats + chordGapAfter(chord);
    }
  }
  return slots;
}

/** The slot sounding at `beat` (section-relative): start inclusive, end
 *  exclusive. Null before the first slot / when there are no slots. */
export function chordSlotAt(slots: readonly ChordSlot[], beat: number): ChordSlot | null {
  for (const slot of slots) {
    if (beat >= slot.startBeat && beat < slot.startBeat + slot.durationBeats) return slot;
  }
  return null;
}
