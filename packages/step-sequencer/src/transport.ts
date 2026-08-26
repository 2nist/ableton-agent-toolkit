/**
 * Transport outputs: turning a pattern into (a) the realtime set of voices to
 * trigger on a given step, and (b) a full MIDI clip's note list for "commit
 * pattern → clip" on the Drum Rack track.
 *
 * `voiceNotes` maps voice index → the Drum Rack's receiving MIDI note (from the
 * probe — see extensions/trackdraft-bridge/src/drumRackProbe.ts, or the
 * @drum/library ABLETON_SAFE_NOTES fallback).
 */
import {
  effectiveVelocity,
  stepsPerBeat,
  type StepPattern,
} from "./pattern.js";

export const DRUM_HIT_DURATION_BEATS = 0.25;

/** A note ready to send / write. */
export interface SequencerNote {
  pitch: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

/** Voices that fire on a single step (for realtime note-on/off). */
export interface StepTrigger {
  pitch: number;
  velocity: number;
}

/** Resolve a voice index to its rack note, with a 36+voice fallback. */
export function voiceNote(voiceNotes: number[], voice: number): number {
  return voiceNotes[voice] ?? 36 + voice;
}

/** The voices that trigger on `step` of `pattern` (empty when no hits). */
export function stepTriggers(
  pattern: StepPattern,
  step: number,
  voiceNotes: number[],
): StepTrigger[] {
  const triggers: StepTrigger[] = [];
  if (step < 0 || step >= pattern.length) return triggers;
  for (let voice = 0; voice < pattern.voices; voice++) {
    const hit = pattern.steps[voice]![step];
    if (hit) triggers.push({ pitch: voiceNote(voiceNotes, voice), velocity: effectiveVelocity(hit) });
  }
  return triggers;
}

/**
 * Build the full note list for a clip from a pattern. One note per hit, in
 * beats relative to the pattern start. `loopBeats` (default: the pattern's
 * full length at its resolution) sets the clip's loop length.
 */
export function patternToClipNotes(
  pattern: StepPattern,
  voiceNotes: number[],
): SequencerNote[] {
  const notes: SequencerNote[] = [];
  const spb = stepsPerBeat(pattern.resolution);
  for (let step = 0; step < pattern.length; step++) {
    const startBeat = step / spb;
    for (let voice = 0; voice < pattern.voices; voice++) {
      const hit = pattern.steps[voice]![step];
      if (hit) {
        notes.push({
          pitch: voiceNote(voiceNotes, voice),
          startBeat,
          durationBeats: DRUM_HIT_DURATION_BEATS,
          velocity: effectiveVelocity(hit),
        });
      }
    }
  }
  return notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
}

/** The pattern's full length in beats (for clip loop length). */
export function patternLengthBeats(pattern: StepPattern): number {
  return pattern.length / stepsPerBeat(pattern.resolution);
}

/**
 * Swing timing helper: how much a step's start time should shift, in beats.
 * A simple straight/swing model: off-beat steps (odd steps) are delayed toward
 * the following beat by `swing`% of half a step. Returns 0 when swing is 0.
 */
export function swingOffsetBeats(step: number, swing: number, resolution: StepPattern["resolution"]): number {
  if (swing <= 0 || step % 2 === 0) return 0;
  const spb = stepsPerBeat(resolution);
  const halfStepBeats = 0.5 / spb;
  return halfStepBeats * (Math.min(100, Math.max(0, swing)) / 100);
}
