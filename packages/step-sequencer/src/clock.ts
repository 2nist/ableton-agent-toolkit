/**
 * Step clock — converts time into a step/phase position, either free-running
 * (driven by dt since the last tick) or following Live's fractional song time.
 *
 * Pure: given a state and an input, returns the next state. The browser app
 * drives it either from a high-resolution timer (`advanceBySeconds`) or from
 * AbletonOSC's song-time listener (`followLive`).
 */
import { stepsPerBeat, type StepResolution } from "./pattern.js";

export interface ClockState {
  isPlaying: boolean;
  bpm: number;
  resolution: StepResolution;
  /** Continuous fractional step position (free-run counter or Live-derived). */
  fractionalStep: number;
  /** 0..patternLength-1 — the current step within the pattern. */
  step: number;
  /** 0..1 — progress within the current step. */
  phase: number;
}

/** Seconds for one step at the given bpm/resolution. */
export function stepDurationSeconds(bpm: number, resolution: StepResolution): number {
  const beatsPerMinute = Math.max(1, bpm);
  const secondsPerBeat = 60 / beatsPerMinute;
  return secondsPerBeat / stepsPerBeat(resolution);
}

export function createClock(
  bpm = 120,
  resolution: StepResolution = "16",
): ClockState {
  return { isPlaying: false, bpm, resolution, fractionalStep: 0, step: 0, phase: 0 };
}

/**
 * Advance the clock by elapsed seconds (free-run). If playing, steps move
 * forward at `bpm`/resolution; if stopped, position holds.
 */
export function advanceBySeconds(
  state: ClockState,
  dtSeconds: number,
  length: number,
): ClockState {
  if (!state.isPlaying || dtSeconds <= 0) return state;
  const dur = stepDurationSeconds(state.bpm, state.resolution);
  const fractionalStep = state.fractionalStep + dtSeconds / dur;
  return fromFractionalStep(fractionalStep, length, state);
}

/**
 * Phase-lock to Ableton's fractional song time (from `/live/song/get/song_time`
 * or the listener). `fractionalBeat` is global song beats; step 0 of the
 * pattern aligns to beat 0. The absolute beat is authoritative — a Live
 * restart (jump to 0) re-syncs position automatically.
 */
export function followLive(
  state: ClockState,
  fractionalBeat: number,
  length: number,
): ClockState {
  const fractionalStep = Math.max(0, fractionalBeat) * stepsPerBeat(state.resolution);
  return fromFractionalStep(fractionalStep, length, state);
}

/** Convert a raw fractional step into a stepped state, wrapping to the pattern length. */
function fromFractionalStep(
  fractionalStep: number,
  length: number,
  current: ClockState,
): ClockState {
  const len = Math.max(1, length);
  const wrapped = fractionalStep % len;
  const step = Math.floor(wrapped);
  const phase = wrapped - step;
  return {
    ...current,
    fractionalStep,
    step,
    phase,
  };
}

/** Convenience: derive step/phase directly from a fractional beat. */
export function stepFromFractionalBeat(
  fractionalBeat: number,
  resolution: StepResolution,
  length: number,
): { step: number; phase: number; fractionalStep: number } {
  const fractionalStep = Math.max(0, fractionalBeat) * stepsPerBeat(resolution);
  const len = Math.max(1, length);
  const wrapped = fractionalStep % len;
  return {
    fractionalStep,
    step: Math.floor(wrapped),
    phase: wrapped - Math.floor(wrapped),
  };
}
