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
 * messages the position is interpolated and the next message re-anchors. The
 * two clocks run on the same machine, so that interpolation only has to be
 * right for the fraction of a beat it covers.
 *
 * `beatOffset` is applied the same way `SongTransport.syncToAbleton` applies
 * it, so the streamed notes and the app's playhead agree on where "song beat
 * 0" sits in Live's timeline.
 */

import { getAbletonClock, type AbletonClockState } from "./abletonClock";
import type { SchedulerClock } from "./liveMidiOut";

/** The interpolation rate is measured from Live's own messages so it can
 *  follow a tempo that isn't the song's bpm — but only within this fraction
 *  of it, and only ever one smoothing step at a time, so a single late or
 *  skipped message can't swing it. The next beat re-anchors regardless, so
 *  this only shapes how good the *within-beat* placement is. */
const TEMPO_TOLERANCE = 0.25;
/** Weight of each new measured interval (the rest rides the running rate). */
const TEMPO_SMOOTHING = 0.2;
/** A measured interval outside this multiple of the song's tempo isn't a
 *  tempo reading at all — it's a gap (pause, seek, skipped message). */
const INTERVAL_MIN_FACTOR = 0.4;
const INTERVAL_MAX_FACTOR = 2.5;

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
  private lastBeatAtMs = 0;
  /** Smoothed ms-per-beat measured from Live's messages. Seeded from the
   *  song's own tempo, which is what Live is normally set to anyway. */
  private msPerBeat: number;

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
    this.anchor = null;
    this.playing = false;
    this.heldSongBeat = null;
    this.lastBeatValue = null;
    this.lastBeatAtMs = 0;
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
      if (this.playing && this.anchor) this.heldSongBeat = this.position();
      this.playing = false;
      this.anchor = null;
      // The next message won't be one beat after the last one (the gap spans
      // the pause) — don't let it pollute the measured tempo.
      this.lastBeatAtMs = 0;
      return;
    }

    const wasPlaying = this.playing;
    this.playing = true;

    const isNewBeat = beat !== this.lastBeatValue;
    if (isNewBeat && this.lastBeatAtMs > 0) {
      const dt = now - this.lastBeatAtMs;
      const expected = 60000 / this.song.bpm;
      if (dt > expected * INTERVAL_MIN_FACTOR && dt < expected * INTERVAL_MAX_FACTOR) {
        const measured = this.msPerBeat * (1 - TEMPO_SMOOTHING) + dt * TEMPO_SMOOTHING;
        const min = expected * (1 - TEMPO_TOLERANCE);
        const max = expected * (1 + TEMPO_TOLERANCE);
        this.msPerBeat = Math.max(min, Math.min(max, measured));
      }
    }
    this.lastBeatValue = beat;
    if (isNewBeat) this.lastBeatAtMs = now;

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
  }
}

/** Build a clock slaved to Live for `song` and subscribe it — the entry
 *  point `transportControl` uses when the clock source is `ableton`. */
export function createAbletonSyncClock(song: { bpm: number; beatOffset?: number }): AbletonSyncClock {
  const clock = new AbletonSyncClock(song);
  clock.connect();
  return clock;
}
