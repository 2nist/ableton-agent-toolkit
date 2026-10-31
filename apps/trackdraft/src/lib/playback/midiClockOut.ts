/**
 * MIDI clock out — the DAW-agnostic sync rung.
 *
 * Every DAW that can follow anything follows MIDI clock: 24 ticks per
 * quarter note plus start/stop/continue and a Song Position Pointer. It needs
 * no vendor SDK, no library, no licence and no bridge — just the MIDI port
 * the app already opens for live out. That is why it comes before anything
 * proprietary: one implementation, every DAW.
 *
 * Timing discipline is the same as the note scheduler's, for the same reason:
 * a `setInterval` that fires late must not make the clock *drift*, so ticks
 * are queued ahead of time with explicit timestamps
 * (`MIDIOutput.send(data, timestamp)`) and the interval only tops the queue
 * up. The tick grid is derived from absolute beat numbers (`tick / 24`), not
 * from accumulated intervals, so a late wake-up can never leave the clock
 * short of ticks.
 *
 * The clock follows a `SchedulerClock` — the same one the notes are timed
 * from — so the DAW's grid and the streamed notes can't describe two
 * different timelines.
 */

import type { SchedulerClock } from "./liveMidiOut";
import { secondsPerBeat } from "../time/clock";

/** MIDI clock resolution, fixed by the specification. */
export const MIDI_CLOCK_PPQ = 24;

export const MIDI_CLOCK_TICK = 0xf8;
export const MIDI_CLOCK_START = 0xfa;
export const MIDI_CLOCK_CONTINUE = 0xfb;
export const MIDI_CLOCK_STOP = 0xfc;
export const MIDI_SONG_POSITION = 0xf2;

/** Lookahead for the tick queue. Deliberately the same idea as the note
 *  scheduler's: a backgrounded tab throttles timers, and the queue is what
 *  keeps the clock even when the timer is late. */
const CLOCK_LOOKAHEAD_MS = 250;
const CLOCK_INTERVAL_MS = 25;

/** A backwards position jump smaller than this many ticks is clock jitter,
 *  not a seek — mirrors the note scheduler's `SEEK_TOLERANCE_BEATS`. */
const TICK_JITTER_TOLERANCE = MIDI_CLOCK_PPQ / 2;

/** Song Position Pointer counts *sixteenth* notes, i.e. six clock ticks. */
export function songPositionMessage(beat: number): number[] {
  const sixteenths = Math.max(0, Math.min(16383, Math.round(beat * 4)));
  return [MIDI_SONG_POSITION, sixteenths & 0x7f, (sixteenths >> 7) & 0x7f];
}

/** First tick queued for a window that starts at `fromTick` — exposed so the
 *  arithmetic can be tested without a port. */
export function firstTickAfter(fromTick: number): number {
  return Math.floor(fromTick) + 1;
}

/** A free-running beat clock at `bpm`, anchored at `now` (a
 *  `performance.now()` timestamp). Used when the clock has no note stream to
 *  borrow one from — clock-only sync, where the DAW follows the app's
 *  transport but nothing is streamed to it. */
export function createWallClock(bpm: number, startBeat = 0, now = performance.now()): SchedulerClock {
  const secPerBeat = secondsPerBeat(Math.max(1, bpm));
  return {
    position: () => startBeat + (performance.now() - now) / 1000 / secPerBeat,
    timeAt: (beat) => now + (beat - startBeat) * secPerBeat * 1000,
  };
}

export interface MidiClockOutOptions {
  /** The port the clock leaves on. */
  output: MIDIOutput;
  /** The timeline to follow — pass the scheduler's clock so ticks and notes
   *  share one anchor. */
  clock: SchedulerClock;
  /** Song bpm, used only to size the lookahead window. */
  bpm: number;
  /** Flattened `beatOffset` for the app's own grid (see `lib/time`), in
   *  beats. Receivers start counting at 0 when they see Start, so a launch
   *  offset means the first clock the DAW hears is not beat 0 of the song —
   *  without this, the DAW's bar 1 lands `beatOffset` beats away from ours. */
  startBeat?: number;
  /** Calibrated output latency, shared with the note stream so the DAW's
   *  transport and the parts don't drift apart by the calibration amount. */
  latencyMs?: number;
}

export class MidiClockSender {
  private output: MIDIOutput | null = null;
  private clock: SchedulerClock | null = null;
  private secPerBeat = 0.5;
  private latencyMs = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  /** Next tick index not yet queued; null = rebase on the next wake-up. */
  private nextTick: number | null = null;
  /** Set while the clock reports no position, so stop is sent once. */
  private held = false;

  get isRunning(): boolean {
    return this.timerId !== null;
  }

  /** The clock currently being followed, or null when idle. */
  get followedClock(): SchedulerClock | null {
    return this.clock;
  }

  /** Follow `clock` from `startBeat` without telling the receiver to
   *  restart — used when the note stream re-bases itself at a bar boundary
   *  and the ticks must move with it. No-op when the sender isn't running. */
  reanchor(clock: SchedulerClock, startBeat: number): void {
    if (this.timerId === null) return;
    this.clock = clock;
    this.nextTick = Math.ceil(Math.max(0, startBeat) * MIDI_CLOCK_PPQ);
  }

  /**
   * Begin sending. `resume` sends Continue + Song Position Pointer instead of
   * Start, so a DAW picking up mid-song starts in the right place rather than
   * at its bar 1.
   */
  start(opts: MidiClockOutOptions): void {
    this.stop(false);
    const { output, clock, bpm } = opts;
    this.output = output;
    this.clock = clock;
    this.secPerBeat = secondsPerBeat(Math.max(1, bpm));
    this.latencyMs = Math.max(-500, Math.min(500, Math.round(opts.latencyMs ?? 0)));
    this.held = false;

    const startBeat = Math.max(0, opts.startBeat ?? 0);
    const now = performance.now();
    // Continue resumes at the pointer; without the pointer a receiver assumes
    // wherever it last stopped. Start counts from zero.
    const opening: number[][] =
      startBeat > 0
        ? [songPositionMessage(startBeat), [MIDI_CLOCK_CONTINUE]]
        : [[MIDI_SONG_POSITION, 0, 0], [MIDI_CLOCK_START]];
    // A port that has gone away must not fail the transport action that
    // started playback — the song plays; only the clock is missing.
    for (const message of opening) {
      if (!this.sendSafely(message, now)) return;
    }

    this.nextTick = null;
    this.timerId = setInterval(() => this.tick(), CLOCK_INTERVAL_MS);
    this.tick();
  }

  /** Stop sending, and tell the receiver to stop with us (unless the caller
   *  is restarting). */
  stop(sendStop = true): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (sendStop && this.output) {
      try {
        this.output.send([MIDI_CLOCK_STOP]);
      } catch {
        // A port unplugged mid-play must not throw out of a transport action.
      }
    }
    this.output = null;
    this.clock = null;
    this.nextTick = null;
    this.held = false;
  }

  private tick(): void {
    const { output, clock } = this;
    if (!output || !clock) return;
    const pos = clock.position();
    if (pos === null) {
      // The timeline has no position (the master is stopped). Tell the
      // receiver once and wait rather than inventing a position.
      if (!this.held) {
        this.sendSafely([MIDI_CLOCK_STOP]);
        this.held = true;
        this.nextTick = null;
      }
      return;
    }

    const posTick = pos * MIDI_CLOCK_PPQ;
    const lookaheadTicks = (CLOCK_LOOKAHEAD_MS / 1000 / this.secPerBeat) * MIDI_CLOCK_PPQ;
    const windowEnd = posTick + lookaheadTicks;

    if (this.held) {
      // Leaving a hold: the receiver was told to stop, so it needs a position
      // and a Continue before the ticks mean anything.
      this.held = false;
      this.sendSafely(songPositionMessage(pos), performance.now() + this.latencyMs);
      this.sendSafely([MIDI_CLOCK_CONTINUE], performance.now() + this.latencyMs);
      this.nextTick = null;
    }

    if (this.nextTick === null) {
      // Opening a window: start from *now*, never from the top of the song —
      // a fresh schedule must not dump every tick it missed.
      this.nextTick = Math.ceil(posTick);
    } else if (Math.abs(posTick - this.nextTick) > TICK_JITTER_TOLERANCE + lookaheadTicks) {
      // A real jump (a seek either way, or a loop wrap): the ticks already
      // queued describe the old position and can't be unsent, so
      // resynchronise the receiver rather than let it count from there.
      this.sendSafely(songPositionMessage(pos), performance.now() + this.latencyMs);
      this.nextTick = Math.ceil(posTick);
    }

    for (let tick = this.nextTick; tick <= windowEnd; tick++) {
      const at = clock.timeAt(tick / MIDI_CLOCK_PPQ);
      if (at === null) break;
      if (!this.sendSafely([MIDI_CLOCK_TICK], at + this.latencyMs)) return;
    }
    // Ticks are integers, so the next one to queue is the first past the
    // window — `ceil` would repeat a tick when the window ends exactly on one.
    this.nextTick = Math.floor(windowEnd) + 1;
  }

  /** Send one clock message, or tear the sender down when the port is gone. */
  private sendSafely(data: number[], at?: number): boolean {
    if (!this.output) return false;
    try {
      if (at === undefined) this.output.send(data);
      else this.output.send(data, at);
      return true;
    } catch {
      // A port unplugged mid-play throws on send; stop rather than spin.
      this.stop(false);
      return false;
    }
  }
}

/** Process-wide sender — one port, one timeline, so two transports can't
 *  drive the same port with two clocks. */
let sender: MidiClockSender | null = null;

export function getMidiClockSender(): MidiClockSender {
  sender ??= new MidiClockSender();
  return sender;
}
