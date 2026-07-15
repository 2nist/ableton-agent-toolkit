/**
 * Pure transformation from a @music-theory/core preset progression into
 * NoteDescription[] ready for MidiClip.notes — no SDK dependency, so this
 * is unit-testable without @platform/test-harness at all.
 */

import { chordToMidiNotes, getPreset, pitchClass, resolveProgression, type NoteName } from "@music-theory/core";
import type { NoteDescription } from "@ableton-extensions/sdk";

export interface BuiltProgression {
  notes: NoteDescription[];
  /** Total length of the progression in beats — use as the created clip's duration. */
  totalBeats: number;
  /** Display name of the preset, for naming the created clip. */
  name: string;
}

/**
 * Octave 5 in @music-theory/core's numbering (octave*12+pc) is MIDI 60 — the
 * "middle C" octave as Ableton itself displays it. See @music-theory/core's
 * README for why this isn't the library's default and must be passed
 * explicitly.
 */
export const DEFAULT_OCTAVE = 5;
export const DEFAULT_PRESET = "pop_progression";
export const DEFAULT_KEY: NoteName = "C";
/** Every note is a sustained block chord for the chord's full duration — the simplest useful v1 voicing. Arpeggiation/inversion is a natural Phase 6+ extension. */
const DEFAULT_VELOCITY = 96;

export function buildProgression(
  presetKey: string = DEFAULT_PRESET,
  key: NoteName = DEFAULT_KEY,
  octave: number = DEFAULT_OCTAVE,
): BuiltProgression {
  const chords = resolveProgression(presetKey, key);

  const notes: NoteDescription[] = [];
  let cursor = 0;
  for (const chord of chords) {
    const rootPc = pitchClass(chord.root);
    for (const pitch of chordToMidiNotes(rootPc, chord.quality, octave)) {
      notes.push({ pitch, startTime: cursor, duration: chord.beats, velocity: DEFAULT_VELOCITY });
    }
    cursor += chord.beats;
  }

  return {
    notes,
    totalBeats: cursor,
    name: getPreset(presetKey)?.name ?? presetKey,
  };
}
