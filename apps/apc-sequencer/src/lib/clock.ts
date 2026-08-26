/**
 * Free-run step clock with drift-corrected timing.
 *
 * Schedules each step against a fixed grid (start time + step index * duration)
 * so accumulated timer drift is corrected instead of snowballing. The hub
 * turns each `onStep` into note-on/off scheduling (with Web MIDI timestamps)
 * and LED re-renders. `syncToBeat` re-anchors the phase to a Live beat for a
 * loose follow-Live mode (full phase-lock needs osc-bridge songTime, Phase 4).
 */

export interface StepClockCallbacks {
  /** Fired when the playhead lands on a new step (0-31). */
  onStep: (step: number) => void;
}

export const STEPS = 32;

export function stepsPerBeat(resolution: "16" | "8"): number {
  return resolution === "16" ? 4 : 2;
}

export class StepClock {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private bpm = 120;
  private resolution: "16" | "8" = "16";
  private gridStart = 0;
  private gridStep = 0;
  private _step = 0;

  constructor(private callbacks: StepClockCallbacks) {}

  get step(): number {
    return this._step;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  stepDurationMs(): number {
    return 60000 / this.bpm / stepsPerBeat(this.resolution);
  }

  start(bpm: number, resolution: "16" | "8", fromStep = 0): void {
    this.stop();
    this.bpm = bpm;
    this.resolution = resolution;
    this._step = ((fromStep % STEPS) + STEPS) % STEPS;
    this.gridStart = performance.now();
    this.gridStep = 0;
    this.callbacks.onStep(this._step);
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Re-anchor the playhead to a fractional Live beat (16th = beat * 4). */
  syncToBeat(beat: number, resolution: "16" | "8"): void {
    this.resolution = resolution;
    const fstep = Math.max(0, beat) * stepsPerBeat(resolution);
    this._step = Math.floor(fstep) % STEPS;
    this.gridStart = performance.now();
    this.gridStep = 0;
    this.callbacks.onStep(this._step);
  }

  private scheduleNext(): void {
    const dur = this.stepDurationMs();
    const target = this.gridStart + this.gridStep * dur;
    const delay = Math.max(0, target - performance.now());
    this.timer = setTimeout(() => {
      this.callbacks.onStep(this._step);
      this._step = (this._step + 1) % STEPS;
      this.gridStep++;
      this.scheduleNext();
    }, delay);
  }
}
