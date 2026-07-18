import { pitchClass } from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";
import { sectionSpans, type BlueprintSong } from "./blueprint.js";
import { loopChordsToFill } from "./chordCycle.js";

export interface BassLinePlan {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

/**
 * Octave 3 in @music-theory/core's numbering (octave*12+pc) is MIDI 36
 * (C2 in Ableton's own display) — a standard bass register, an octave
 * and a half below chordClips' default.
 */
export const DEFAULT_OCTAVE = 3;
const DEFAULT_VELOCITY = 100;

/**
 * One clip per section: a single sustained root note per chord, full
 * duration, back-to-back with no gaps (legato) — no octave jumps,
 * walking lines, or rhythmic variation, the simplest useful v1. Uses the
 * same loopChordsToFill cycle as planChordClips so the bass root always
 * lands on the same beat as its matching chord.
 */
export function planBassLine(song: BlueprintSong, octave: number = DEFAULT_OCTAVE): BassLinePlan[] {
  return sectionSpans(song).map(({ section, startBeat, durationBeats }) => {
    const notes: NoteDescription[] = loopChordsToFill(section.chords ?? [], durationBeats).map((occurrence) => ({
      pitch: octave * 12 + pitchClass(occurrence.chord.root),
      startTime: occurrence.startTime,
      duration: occurrence.duration,
      velocity: DEFAULT_VELOCITY,
    }));
    return { name: section.name, startBeat, durationBeats, notes };
  });
}
