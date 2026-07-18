import { chordToMidiNotes, pitchClass, type ChordQuality } from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";
import type { BlueprintSong } from "./blueprint.js";

export interface ChordClipPlan {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

/**
 * Octave 5 in @music-theory/core's numbering (octave*12+pc) is MIDI 60 —
 * the "middle C" octave as Ableton itself displays it. Matches
 * chord-assistant's own default for the same reason.
 */
export const DEFAULT_OCTAVE = 5;
const DEFAULT_VELOCITY = 96;

/**
 * One clip per section, each holding sustained block chords (no
 * arpeggiation/voice-leading — the simplest useful v1 voicing, matching
 * chord-assistant's own precedent). A clip's duration is bars *
 * timeSignatureNumerator, same math as planCuePoints, so clips land at
 * the same offsets as the CuePoints "Apply Song Blueprint" creates.
 *
 * A section's `chords` list is one pass through its progression, not the
 * whole section — a 16-bar verse built from a 4-bar/4-chord progression
 * lists only those 4 chords, the same way the original REAPER pipeline
 * paired a section's `bars` with its `beatsPerChord`. The progression
 * loops to fill the section's full duration; the final repeat is
 * truncated (not skipped) if it doesn't divide evenly.
 */
export function planChordClips(song: BlueprintSong, octave: number = DEFAULT_OCTAVE): ChordClipPlan[] {
  const plan: ChordClipPlan[] = [];
  let sectionStart = 0;

  for (const section of song.sections) {
    const durationBeats = section.bars * section.timeSignatureNumerator;
    const chords = section.chords ?? [];
    const notes: NoteDescription[] = [];
    const cycleBeats = chords.reduce((sum, chord) => sum + chord.beats, 0);

    if (cycleBeats > 0) {
      let cursor = 0;
      while (cursor < durationBeats) {
        for (const chord of chords) {
          if (cursor >= durationBeats) break;
          const duration = Math.min(chord.beats, durationBeats - cursor);
          const rootPc = pitchClass(chord.root);
          for (const pitch of chordToMidiNotes(rootPc, chord.quality as ChordQuality, octave)) {
            notes.push({ pitch, startTime: cursor, duration, velocity: DEFAULT_VELOCITY });
          }
          cursor += chord.beats;
        }
      }
    }

    plan.push({ name: section.name, startBeat: sectionStart, durationBeats, notes });
    sectionStart += durationBeats;
  }

  return plan;
}
