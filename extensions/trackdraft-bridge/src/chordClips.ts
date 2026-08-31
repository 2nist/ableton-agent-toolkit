import { chordToMidiNotes, pitchClass, type ChordQuality, applyPerformanceEffect } from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";
import { sectionSpans, type BlueprintSong } from "./blueprint.js";
import { resolveChordOccurrences } from "@drum/library";

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
 * One clip per section, each holding sustained block chords.  When a
 * chord carries a `performance` effect (strum/pulse/arp), the
 * effect is applied via @music-theory/core's shared applyPerformanceEffect.
 */
export function planChordClips(song: BlueprintSong, octave: number = DEFAULT_OCTAVE): ChordClipPlan[] {
  return sectionSpans(song).map(({ section, startBeat, durationBeats }) => {
    const notes: NoteDescription[] = [];
    for (const occurrence of resolveChordOccurrences(section, durationBeats)) {
      const rootPc = pitchClass(occurrence.chord.root);
      let chordNotes: NoteDescription[] = [];
      for (const pitch of chordToMidiNotes(rootPc, occurrence.chord.quality as ChordQuality, octave)) {
        chordNotes.push({ pitch, startTime: occurrence.startTime, duration: occurrence.duration, velocity: DEFAULT_VELOCITY });
      }

      chordNotes = applyPerformanceEffect(chordNotes, occurrence.chord.performance);

      notes.push(...chordNotes);
    }
    return { name: section.name, startBeat, durationBeats, notes };
  });
}
