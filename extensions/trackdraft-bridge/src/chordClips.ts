import { chordToMidiNotes, pitchClass, type ChordQuality } from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";
import { sectionSpans, type BlueprintSong } from "./blueprint.js";
import { loopChordsToFill } from "./chordCycle.js";

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
 * the same offsets as the CuePoints "Apply Song Blueprint" creates. See
 * loopChordsToFill for how a section's one-pass chord list becomes a
 * full-length progression.
 */
export function planChordClips(song: BlueprintSong, octave: number = DEFAULT_OCTAVE): ChordClipPlan[] {
  return sectionSpans(song).map(({ section, startBeat, durationBeats }) => {
    const notes: NoteDescription[] = [];
    for (const occurrence of loopChordsToFill(section.chords ?? [], durationBeats)) {
      const rootPc = pitchClass(occurrence.chord.root);
      for (const pitch of chordToMidiNotes(rootPc, occurrence.chord.quality as ChordQuality, octave)) {
        notes.push({ pitch, startTime: occurrence.startTime, duration: occurrence.duration, velocity: DEFAULT_VELOCITY });
      }
    }
    return { name: section.name, startBeat, durationBeats, notes };
  });
}
