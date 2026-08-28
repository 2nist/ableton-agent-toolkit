/**
 * ClickTrack — a metronome click synced to the song transport, the timing
 * aid for recording a melody. Pure Web Audio (a short pitched oscillator
 * burst per beat, brighter on the downbeat of every 4 beats), so it needs
 * no MIDI port and works on any secure-context browser — even on a device
 * that can't hear the MIDI backing at all.
 *
 * The click fires on the first transport tick that crosses each integer
 * beat. That's a few ms late (one animation frame), but a metronome only
 * needs to be steady, not zero-latency — every click is late by the same
 * amount, so the rhythm reads correctly. When the transport loops a
 * section, the folded beat keeps ticking, so the click stays locked to
 * the loop.
 */

import { getSongTransport } from "../playback/songTransport";

/** Accent (bar start) interval, in beats — assumes 4/4 for now. */
const ACCENT_EVERY = 4;

/** Click pitch (Hz): the accented downbeat is a brighter A, the regular
 *  beats a softer D. */
const ACCENT_FREQ = 1760;
const BEAT_FREQ = 1174.7;

export class ClickTrack {
  private ctx: AudioContext | null = null;
  private unsub: (() => void) | null = null;
  private lastBeatInt = -1;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  /** Start clicking on every beat while the transport plays. Safe to call
   *  repeatedly — a second call while running is a no-op. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastBeatInt = -1;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const ctx = this.ctx;
    this.unsub = getSongTransport().onTick((tick) => {
      if (!tick.isPlaying) return;
      const b = Math.floor(tick.beat);
      if (b === this.lastBeatInt) return;
      this.lastBeatInt = b;
      if (this.running) click(ctx, ctx.currentTime + 0.002, b % ACCENT_EVERY === 0);
    });
  }

  /** Stop clicking (keeps the AudioContext around for a later restart). */
  stop(): void {
    this.running = false;
    this.unsub?.();
    this.unsub = null;
    this.lastBeatInt = -1;
  }

  /** Stop and release the AudioContext. */
  dispose(): void {
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

/** Play one click at `when` (AudioContext time): a short pitched burst
 *  with a fast decay, louder and higher for the accented downbeat. */
function click(ctx: AudioContext, when: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = accent ? ACCENT_FREQ : BEAT_FREQ;
  gain.gain.setValueAtTime(accent ? 0.4 : 0.24, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.06);
}
