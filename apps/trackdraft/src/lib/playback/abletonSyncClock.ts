/**
 * A `SchedulerClock` slaved to Ableton's transport.
 *
 * Why this exists: the app's own clock starts at "the moment Play was
 * clicked", which has no relationship to where Live's transport is. Notes
 * streamed into Live from it therefore land *between* Live's downbeats, and
 * then slide against Live's grid as the two clocks run at even slightly
 * different rates. Slaving to Live fixes both halves of that:
 *
 *  - the stream begins from Live's current position (so it joins the song
 *    where Live actually is, rather than superimposing a second timeline),
 *  - every beat message from osc-bridge re-anchors it, so error is bounded
 *    by one message's delivery latency instead of accumulating forever.
 *
 * The wire protocol only carries *whole* beats (`/live/song/get/beat` pushes
 * an integer once per beat — see `packages/osc-bridge/README.md`), so between
 * messages the position is interpolated and the next message re-anchors. That
 * interpolation runs at Live's *measured* rate, not the song's bpm: Live is
 * the master, and its tempo is routinely not the song's (a set at 143 while
 * the song is written at 104). Interpolating at the song's bpm there would
 * crawl at 73% of a beat and then snap forward a quarter beat on every
 * message — the playhead and the click visibly stuttering against Live.
 *
 * `beatOffset` is applied the same way `SongTransport.syncToAbleton` applies
 * it, so the streamed notes and the app's playhead agree on where "song beat
 * 0" sits in Live's timeline.
 */

import { getAbletonClock, type AbletonClockState } from "./abletonClock";
import type { SchedulerClock } from "./liveMidiOut";

/** How many measured beat intervals the tempo estimate keeps. The median of
 *  these is the rate, so one delayed or bunched message — the bridge's 5s
 *  resubscribe makes AbletonOSC fire its listener again moments after a real
 *  beat, a ~90ms "interval" — can't swing it. A real tempo change is still
 *  picked up within two beats. */
const TEMPO_SAMPLES = 5;
/** Two agreeing intervals are enough to lock the rate; below that the song's
 *  bpm guess stands. */
const AGREEMENT_RATIO = 1.1;
/** A per-beat interval outside this range isn't tempo at all. */
const PLAUSIBLE_MIN_MS = 100; // 600bpm
const PLAUSIBLE_MAX_MS = 2000; // 30bpm

/** Median of a small sample — the tempo estimate itself. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export class AbletonSyncClock implements SchedulerClock {
  private readonly clock = getAbletonClock();
  private unsub: (() => void) | null = null;
  /** Song beat + wall-clock pair the interpolation runs from. */
  private anchor: { songBeat: number; atMs: number } | null = null;
  /** Position frozen when the transport stopped, so a resume *mid-beat*
   *  continues from where Live actually paused instead of snapping to the
   *  last whole beat the wire reported. */
  private heldSongBeat: number | null = null;
  private playing = false;
  private lastBeatValue: number | null = null;
  /** Arrival time of the last new beat; null when there is no previous beat
   *  to measure an interval against (first message, or across a pause). */
  private lastBeatAtMs: number | null = null;
  /** Per-beat intervals measured from Live's messages; median is the rate.
   *  Seeded from the song's bpm, which is only a guess until Live answers. */
  private beatMsSamples: number[] = [];
  /** Ms per beat — the median of the measured intervals, so one jittery
   *  message can't swing it. */
  private msPerBeat: number;
  private listeners = new Set<() => void>();

  constructor(private readonly song: { bpm: number; beatOffset?: number }) {
    this.msPerBeat = 60000 / song.bpm;
  }

  /** Start following Live — safe to call repeatedly (one subscription). */
  connect(): void {
    if (this.unsub) return;
    this.clock.connect();
    this.unsub = this.clock.onChange((state) => this.ingest(state));
  }

  /** Whether Live's transport is currently running. */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** Fires when a message actually moved the clock — a new beat, or the
   *  transport starting/stopping. Lets a consumer emit exactly on Live's own
   *  beat instead of only on its next animation frame. */
  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  position(): number | null {
    if (!this.playing || !this.anchor) return null;
    return this.anchor.songBeat + (performance.now() - this.anchor.atMs) / this.msPerBeat;
  }

  timeAt(beat: number): number | null {
    if (!this.playing || !this.anchor) return null;
    return this.anchor.atMs + (beat - this.anchor.songBeat) * this.msPerBeat;
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.listeners.clear();
    this.anchor = null;
    this.playing = false;
    this.heldSongBeat = null;
    this.lastBeatValue = null;
    this.lastBeatAtMs = null;
    this.beatMsSamples = [];
  }

  /** Fold one bridge message into the clock. Note that `onChange` fires for
   *  *every* state change — including telemetry, which carries no new beat —
   *  so only a beat we haven't seen before may move the anchor. Re-anchoring
   *  on the bridge's cached value would shift the schedule by up to a beat
   *  every time an unrelated field updated. */
  private ingest(state: AbletonClockState): void {
    const now = performance.now();
    const beat = state.abletonBeat;

    if (!state.isPlaying || beat === null) {
      const wasPlaying = this.playing;
      if (this.playing && this.anchor) this.heldSongBeat = this.position();
      this.playing = false;
      this.anchor = null;
      // The next message won't be one beat after the last one (the gap spans
      // the pause) — don't let it pollute the measured tempo.
      this.lastBeatAtMs = null;
      if (wasPlaying) this.notify();
      return;
    }

    const wasPlaying = this.playing;
    this.playing = true;

    const isNewBeat = beat !== this.lastBeatValue;
    if (isNewBeat) this.measureTempo(beat, now);

    const beatOffset = this.song.beatOffset ?? 0;
    if (isNewBeat) {
      // A beat boundary just crossed — hard re-anchor. This is the line that
      // stops drift: whatever the interpolation accumulated is discarded
      // every beat rather than carried into the next one.
      this.anchor = { songBeat: Math.max(0, beat - beatOffset), atMs: now };
    } else if (this.anchor === null) {
      // Nothing fresh to anchor to: either resuming mid-beat (continue from
      // the frozen position) or the first thing we've heard (use the last
      // beat the bridge knows — the next real message corrects us).
      const songBeat = !wasPlaying && this.heldSongBeat !== null ? this.heldSongBeat : Math.max(0, beat - beatOffset);
      this.anchor = { songBeat, atMs: now };
    }
    this.heldSongBeat = null;

    if (isNewBeat || !wasPlaying) this.notify();
  }

  /** Measure the interval this beat arrived after the previous one and fold
   *  it into the rate. Uses the *beat count* between messages, not just the
   *  elapsed time, so a skipped message reads as one long beat rather than
   *  poisoning the estimate. */
  private measureTempo(beat: number, now: number): void {
    const previousBeat = this.lastBeatValue;
    const sinceMs = this.lastBeatAtMs;
    this.lastBeatValue = beat;
    this.lastBeatAtMs = now;
    if (previousBeat === null || sinceMs === null) return;

    const beats = beat - previousBeat;
    // Backwards (a rewind, or Live's loop wrapping) says nothing about tempo.
    if (beats < 1) return;
    const perBeat = (now - sinceMs) / beats;
    if (perBeat < PLAUSIBLE_MIN_MS || perBeat > PLAUSIBLE_MAX_MS) return;

    this.beatMsSamples.push(perBeat);
    if (this.beatMsSamples.length > TEMPO_SAMPLES) this.beatMsSamples.shift();

    // The median needs three readings before it can outvote an outlier; two
    // are enough when they agree, which is the normal case and locks the rate
    // a beat sooner.
    const samples = this.beatMsSamples;
    const agreed = samples.length >= 3 || (samples.length === 2 && Math.max(...samples) < Math.min(...samples) * AGREEMENT_RATIO);
    if (agreed) this.msPerBeat = median(samples);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Build a clock slaved to Live for `song` and subscribe it — the entry
 *  point `transportControl` uses when the clock source is `ableton`. */
export function createAbletonSyncClock(song: { bpm: number; beatOffset?: number }): AbletonSyncClock {
  const clock = new AbletonSyncClock(song);
  clock.connect();
  return clock;
}
