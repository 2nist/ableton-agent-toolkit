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

/** Accent interval when the caller doesn't say — a plain 4/4. Every caller
 *  here knows its section's meter and passes it (`start(beatsPerBar)`), so
 *  this default only covers a caller that has no song in scope. */
const DEFAULT_BEATS_PER_BAR = 4;

/** Click pitch (Hz): the accented downbeat is a brighter A, the regular
 *  beats a softer D. */
const ACCENT_FREQ = 1760;
const BEAT_FREQ = 1174.7;

export class ClickTrack {
  private ctx: AudioContext | null = null;
  private unsub: (() => void) | null = null;
  private lastBeatInt = -1;
  private running = false;
  /** Where the click started, so accents land on the SECTION's downbeat
   *  rather than on song beat 0 — a 3-bar intro would otherwise put every
   *  accent a beat off for the rest of the tune. */
  private originBeat = 0;
  /** The section's meter. 7/8 bars are 3.5 beats long, so this is read as a
   *  fractional bar length, not an integer count of beats. */
  private beatsPerBar = DEFAULT_BEATS_PER_BAR;

  get isRunning(): boolean {
    return this.running;
  }

  /** Start clicking on every beat while the transport plays. Safe to call
   *  repeatedly — a second call while running is a no-op. `beatsPerBar` is
   *  the meter to accent on; omit it only when there is no section to ask. */
  start(beatsPerBar: number = DEFAULT_BEATS_PER_BAR): void {
    if (this.running) return;
    this.running = true;
    this.lastBeatInt = -1;
    this.beatsPerBar = beatsPerBar > 0 ? beatsPerBar : DEFAULT_BEATS_PER_BAR;
    this.originBeat = getSongTransport().getBeat();
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const ctx = this.ctx;
    this.unsub = getSongTransport().onTick((tick) => {
      if (!tick.isPlaying) return;
      const b = Math.floor(tick.beat);
      if (b === this.lastBeatInt) return;
      this.lastBeatInt = b;
      if (!this.running) return;
      // Distance from the section's own downbeat, folded into the bar. Works
      // for a fractional bar length (7/8 = 3.5) because the click still lands
      // on the nearest whole beat to each bar line.
      const since = b - this.originBeat;
      const inBar = since - Math.floor(since / this.beatsPerBar) * this.beatsPerBar;
      click(ctx, ctx.currentTime + 0.002, inBar < 1e-6);
    });
  }

  /** Stop clicking (keeps the AudioContext around for a later restart). */
  stop(): void {
    this.running = false;
    this.unsub?.();
    this.unsub = null;
    this.lastBeatInt = -1;
  }

  /** Play one click `offsetSeconds` from now — the count-in before a
   *  recording starts, so the first bar lands in time rather than waiting
   *  for the transport's first tick. Accent marks the downbeat. */
  clickAt(offsetSeconds = 0, accent = false): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    click(this.ctx, this.ctx.currentTime + Math.max(0, offsetSeconds), accent);
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
