/** Rehearsal click planning — pure maths, so the timing is testable without a
 *  MIDI port. The desk schedules a bar at a time ahead of the playhead; this
 *  module decides what to send and when. */

export interface ClickNote {
  /** MIDI note. Side stick for the click, rim shot on the downbeat. */
  pitch: number;
  velocity: number;
  /** Milliseconds from the scheduling anchor. */
  atMs: number;
  durationMs: number;
}

export interface ClickPlanInput {
  /** Song-relative beat the plan starts on (may be mid-bar). */
  fromBeat: number;
  /** How many beats to plan from there. */
  beats: number;
  bpm: number;
  beatsPerBar: number;
  /** Every nth bar gets the accent — 1 unless the tune is in 2.
   *  A bar counter keeps the accent on the real downbeat across a loop. */
  barOffset?: number;
}

const CLICK_PITCH = 37;
const ACCENT_PITCH = 76;
const CLICK_VELOCITY = 74;
const ACCENT_VELOCITY = 112;
const CLICK_MS = 30;

const EPSILON = 1e-6;

/**
 * One note per beat, accented on the first beat of the bar. `fromBeat` is
 * honoured exactly rather than floored, so a plan that starts 2.5 beats in
 * still lands its clicks on the beat grid.
 */
export function planClicks(input: ClickPlanInput): ClickNote[] {
  const beatsPerBar = Math.max(1, input.beatsPerBar);
  const beatMs = 60000 / Math.max(1, input.bpm);
  const barOffset = input.barOffset ?? 0;
  const notes: ClickNote[] = [];

  const first = Math.ceil(input.fromBeat - EPSILON);
  for (let index = 0; index < Math.max(0, Math.ceil(input.beats)); index++) {
    const beat = first + index;
    if (beat >= input.fromBeat + input.beats - EPSILON) break;
    const inBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const bar = Math.floor(beat / beatsPerBar) + barOffset;
    const downbeat = Math.abs(inBar) < EPSILON && bar >= 0;
    notes.push({
      pitch: downbeat ? ACCENT_PITCH : CLICK_PITCH,
      velocity: downbeat ? ACCENT_VELOCITY : CLICK_VELOCITY,
      atMs: (beat - input.fromBeat) * beatMs,
      durationMs: CLICK_MS,
    });
  }
  return notes;
}
