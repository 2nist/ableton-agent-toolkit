import { sectionSpans, type SectionSpan } from "../arrangement";
import { getAbletonClock } from "./abletonClock";
import { createAbletonSyncClock, type AbletonSyncClock } from "./abletonSyncClock";
import { beatsPerBar } from "../../types/blueprint";
import type { BlueprintSong } from "../../types/blueprint";

/** A song-wide playback position, emitted on every tick while playing and
 *  once more (isPlaying: false) when play stops or reaches the end. */
export interface TransportTick {
  beat: number;
  isPlaying: boolean;
  /** Index into the `SectionSpan[]` this transport snapshotted when playback
   *  started, or -1 when stopped/before the first span. Kept for consumers
   *  that have no song to re-derive spans from (the popout over
   *  BroadcastChannel); anything with the live song should resolve through
   *  `spanIndexForTick`, because editing the arrangement mid-playback makes
   *  this index alias a different section. */
  sectionIndex: number;
  /** Identity of the span sounding at this tick — stable across edits, so
   *  it is what every in-app consumer resolves against. Null when the tick
   *  is outside every span. */
  sectionId?: string | null;
  /** Which repeat pass of `sectionId`, or -1 outside every span. */
  occurrenceIndex?: number;
}

/** Playback position/loop for `SongTransport.play()` — lets a caller start
 *  at a specific beat (seek, e.g. to a section) and/or loop within a region
 *  (e.g. loop just the section being recorded). All optional: omitting
 *  everything is exactly the historical play-from-the-top-once. */
export interface PlayOptions {
  /** Beat to start playback at. Default 0 (song start). */
  startBeat?: number;
  /** When both `loopStart`/`loopEnd` are set and `loopEnd` is inside the
   *  song, playback wraps from `loopEnd` back to `loopStart` forever
   *  instead of stopping at the end of the song. */
  loopStart?: number;
  loopEnd?: number;
  /** Loop even when the region reaches the song end (a section that spans
   *  the whole song) — used by the section-loop button, where "loop this
   *  part until I turn it off" means exactly that, forever. */
  forceLoop?: boolean;
}

/** Shared by any cross-window consumer (currently just the lyric/chord
 *  popout) that needs to subscribe without going through `getSongTransport()`
 *  itself — a popout window is a separate page load with its own JS realm,
 *  so it can't hold a reference to this module's singleton. */
export const TRANSPORT_CHANNEL_NAME = "trackdraft-transport";

/** Which span (if any) contains `beat` — linear scan is fine here; a song's
 *  span count is small (tens, not thousands) and this only runs on a 100ms
 *  tick, not per frame. */
function sectionIndexAt(spans: SectionSpan[], beat: number): number {
  return spans.findIndex((s) => beat >= s.startBeat && beat < s.startBeat + s.durationBeats);
}

/** A subscriber that throws must not take the playhead down with it, and
 *  must not be silently swallowed either (a dead playhead needs a lead). */
function reportTickListenerError(error: unknown): void {
  console.error("[songTransport] a tick listener threw; other subscribers continued", error);
}
/** Walks a song's full arrangement (`sectionSpans`) and advances a
 *  song-relative beat position at display refresh rate — a silent
 *  playhead for reviewing arrangement/timing while editing. TrackDraft
 *  itself no longer makes sound (see `syncToAbleton` below and the
 *  project's MIDI-only direction): actual audio always comes from
 *  Ableton once a song's chords/drums are committed there, so this
 *  clock's only job is *position*, not *sound*.
 *
 *  Ticks are broadcast on a `BroadcastChannel` so a same-origin popout
 *  window (a separate JS realm — no shared React/Zustand state) can
 *  follow along without a server round-trip. */
class SongTransport {
  private channel: BroadcastChannel | null = null;
  private schedulerId: ReturnType<typeof requestAnimationFrame> | null = null;
  private startedAtMs = 0;
  private spans: SectionSpan[] = [];
  private isPlaying = false;
  /** Seconds per beat of the loaded song (for pause's beat math). */
  private secPerBeat = 0.5;
  /** Song length in beats of the current playback pass (end-of-song stop). */
  private totalBeats = 0;
  /** Loop region of the current playback pass (no loop when 0/0). */
  private loopStart = 0;
  private loopEnd = 0;
  private looping = false;
  /** Beat to resume from after pause — null when stopped (play from top). */
  private pausedBeat: number | null = null;
  /** A one-shot callback queued to run at the next bar boundary (live edits
   *  apply on the grid, not mid-note). Cleared on pause/stop/play. */
  private nextBarCb: (() => void) | null = null;
  private nextBarAt = -1;
  private tickListeners = new Set<(tick: TransportTick) => void>();
  /** Guard + queue for `emit` — see its doc. */
  private emitting = false;
  /** Throttle state for the cross-window post — see `post`. */
  private lastPostAt = 0;
  private lastPostedPlaying = false;
  private emitQueue: TransportTick[] = [];
  private abletonUnsub: (() => void) | null = null;
  /** The clock following Live in this mode — owned here (not by the MIDI
   *  scheduler) so `stop()` can dispose it; the scheduler gets its own. */
  private abletonClock: AbletonSyncClock | null = null;
  /** Latest song-relative beat reported under an external (Ableton) clock.
   *  `startedAtMs` means nothing in that mode — the app's own wall clock
   *  isn't the one running — so positions have to be remembered as they
   *  arrive (see `currentBeat`). */
  private syncedBeat: number | null = null;
  /** Which clock is driving — set by StudioView from the persisted store
   *  before calling play()/syncToAbleton(). */
  clockSource: "internal" | "ableton" = "internal";

  private getChannel(): BroadcastChannel {
    if (!this.channel) this.channel = new BroadcastChannel(TRANSPORT_CHANNEL_NAME);
    return this.channel;
  }

  /** Subscribe to ticks from within the same tab (e.g. the Studio playhead
   *  or a Play/Stop button's state) — lower-latency than round-tripping
   *  through the BroadcastChannel, which every tick also still posts to
   *  for any popout window listening. Returns an unsubscribe function. */
  onTick(listener: (tick: TransportTick) => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /** Start a silent playhead scrub through `song` — no audio, see the class
   *  doc. Any playback already in progress (this song or another) is
   *  stopped first. Returns false without doing anything when
   *  `clockSource` is "ableton" — Ableton sync must use `syncToAbleton()`,
   *  and callers need to know their request was refused rather than
   *  assume they are playing. An explicit `opts.startBeat` seeks; without
   *  one, a paused beat is resumed (see `pause()`). */
  play(song: BlueprintSong, opts: PlayOptions = {}): boolean {
    if (this.clockSource === "ableton") return false;
    // Capture the resume position BEFORE stop() (which clears it): an
    // explicit startBeat wins, otherwise a paused beat resumes.
    const resumeBeat = opts.startBeat !== undefined ? Math.max(0, opts.startBeat) : (this.pausedBeat ?? 0);
    this.stop();
    this.spans = sectionSpans(song);
    if (this.spans.length === 0) return false;

    this.secPerBeat = 60 / song.bpm;
    const lastSpan = this.spans[this.spans.length - 1];
    this.totalBeats = lastSpan.startBeat + lastSpan.durationBeats;
    if (this.totalBeats <= 0) return false;

    const startBeat = resumeBeat;
    this.loopStart = opts.loopStart ?? startBeat;
    this.loopEnd = opts.loopEnd ?? this.totalBeats;
    const hasRegion = this.loopEnd > this.loopStart;
    this.looping = hasRegion && (opts.forceLoop === true || this.loopEnd < this.totalBeats);

    // Seek: anchor the wall clock so beat `startBeat` is "now".
    this.startedAtMs = performance.now() - startBeat * this.secPerBeat * 1000;
    this.isPlaying = true;

    // Playhead position ticks at display refresh rate (60fps) so the
    // visual cursor moves smoothly, not at a choppy 10Hz. The
    // BroadcastChannel still fires at ~60fps too — the popout window
    // handles that rate fine.
    const tickLoop = () => {
      if (!this.isPlaying) return;
      const beat = this.currentBeat();
      // Fire a bar-queued callback (e.g. a staged live edit) at its boundary
      // before the end-of-song check, so it still runs right at the finish.
      if (this.nextBarCb !== null && beat >= this.nextBarAt) {
        const cb = this.nextBarCb;
        this.nextBarCb = null;
        cb();
      }
      if (beat >= this.totalBeats) {
        this.stop();
        return;
      }
      this.emit(this.tickAt(beat, true));
      this.schedulerId = requestAnimationFrame(tickLoop);
    };

    this.schedulerId = requestAnimationFrame(tickLoop);
    return true;
  }

  /** Build a tick for `beat`, carrying the span's IDENTITY as well as its
   *  index so consumers never have to trust a stale position. */
  private tickAt(beat: number, isPlaying: boolean): TransportTick {
    const index = sectionIndexAt(this.spans, beat);
    const span = index >= 0 ? this.spans[index] : null;
    return {
      beat,
      isPlaying,
      sectionIndex: index,
      sectionId: span?.sectionId ?? null,
      occurrenceIndex: span?.occurrenceIndex ?? -1,
    };
  }

  /**
   * Re-derive the span map and song length from `song` WITHOUT moving the
   * playhead — call this after any edit that adds, removes, reorders or
   * resizes a section while playback is running.
   *
   * Without it the transport keeps reporting `sectionIndex` values from the
   * arrangement as it was when playback started, and every consumer that
   * re-derives spans from the live song aliases a different section (see
   * `spanIndexForTick`). A tempo change re-anchors the wall clock at the
   * current beat so the playhead stays continuous instead of jumping.
   */
  updateSong(song: BlueprintSong): void {
    const spans = sectionSpans(song);
    if (spans.length === 0) return; // a song mid-edit with no sections yet
    const lastSpan = spans[spans.length - 1];
    const totalBeats = lastSpan.startBeat + lastSpan.durationBeats;
    if (totalBeats <= 0) return;

    if (this.isPlaying) {
      const beat = this.currentBeat();
      this.startedAtMs = performance.now() - beat * (60 / song.bpm) * 1000;
    }
    this.spans = spans;
    this.secPerBeat = 60 / song.bpm;
    this.totalBeats = totalBeats;
  }

  /** The playhead beat right now — the same folded value the tick loop
   *  emits (a looped playback folds back into its loop region). Under an
   *  external clock this reports the beat Ableton last reported (plus its
   *  interpolation), since the app's own wall clock isn't the one driving. */
  private currentBeat(): number {
    if (this.clockSource === "ableton") return this.syncedBeat ?? 0;
    let beat = (performance.now() - this.startedAtMs) / 1000 / this.secPerBeat;
    if (this.looping && beat >= this.loopEnd) {
      const span = this.loopEnd - this.loopStart;
      beat = this.loopStart + ((beat - this.loopStart) % span);
    }
    return beat;
  }

  /** Freeze the playhead at its current beat — `play()` without an explicit
   *  `startBeat` will resume from here. No-op when not playing, or when
   *  following Ableton's clock (we can't pause the external transport). */
  pause(): void {
    if (!this.isPlaying || this.clockSource === "ableton") return;
    const beat = this.currentBeat();
    this.pausedBeat = beat;
    this.nextBarCb = null;
    if (this.schedulerId !== null) {
      cancelAnimationFrame(this.schedulerId);
      this.schedulerId = null;
    }
    this.isPlaying = false;
    this.emit(this.tickAt(beat, false));
  }

  /** Whether playback is paused — `play()` will resume from the held beat
   *  rather than the top. */
  isPaused(): boolean {
    return this.pausedBeat !== null;
  }

  /** The playhead beat right now — folded for loops. Only meaningful while
   *  playing (used by the live MIDI scheduler to re-plan from the current
   *  position after an edit); returns the paused beat when paused, else 0. */
  getBeat(): number {
    if (this.isPlaying) return this.currentBeat();
    return this.pausedBeat ?? 0;
  }

  /** The beat of the next bar boundary after the current playhead — where
   *  a live edit should land so the change hits the grid instead of mid-
   *  note. Uses the current section's beats-per-bar; never returns a beat
   *  past the song end (or the loop region's end when looping). */
  getNextBarBeat(): number {
    const beat = this.currentBeat();
    const span = this.spans[sectionIndexAt(this.spans, beat)];
    let next = this.totalBeats;
    if (span) {
      const bpb = Math.max(1, beatsPerBar(span.section));
      next = span.startBeat + (Math.floor((beat - span.startBeat) / bpb) + 1) * bpb;
    }
    if (this.looping) next = Math.min(next, this.loopEnd - 0.001);
    next = Math.min(next, this.totalBeats - 0.001);
    return Math.max(beat + 0.001, next);
  }

  /** Queue `cb` to run at the start of the next bar after the current
   *  playhead — the "apply on the grid" point for live edits. A second
   *  call replaces the first (coalescing edits within a bar). Cleared by
   *  pause()/stop()/play(). */
  onNextBar(cb: () => void): void {
    this.nextBarCb = cb;
    this.nextBarAt = this.getNextBarBeat();
  }

  /** Drop a queued `onNextBar` callback without touching playback — for
   *  when the edit it was staged for no longer applies. `play()`/`stop()`
   *  already clear the slot; this makes the cancellation explicit for
   *  callers that cancel a stage while the transport keeps running. */
  cancelNextBar(): void {
    this.nextBarCb = null;
    this.nextBarAt = -1;
  }

  /** The beat playback will resume from, or null when not paused. */
  getPausedBeat(): number | null {
    return this.pausedBeat;
  }

  /** Follow Ableton's transport instead of playing audio here — no chords
   *  are triggered (Ableton is already sounding them); this only turns
   *  Ableton's raw beat position into song-relative ticks on the same
   *  `{ beat, isPlaying, sectionIndex }` shape `play()` emits, so every
   *  consumer (playhead, popout) works identically either way. The offset
   *  comes from `song.beatOffset ?? 0` so it survives page refreshes. Call
   *  `calibrate()` to anchor it.
   *
   *  Runs on the same `AbletonSyncClock` the live MIDI scheduler uses, so the
   *  playhead and the streamed notes cannot disagree about where the beat is
   *  — one interpolation, at Live's measured rate, instead of two (this used
   *  to re-derive its own from the song's bpm, which is a different tempo
   *  whenever Live isn't set to the song's).
   *
   *  `osc-bridge` only pushes a message per *whole* beat, so the position is
   *  interpolated between them: emitted exactly on each real message (the
   *  position is never just a guess), plus every animation frame in between
   *  so the playhead moves continuously rather than stepping once per beat. */
  syncToAbleton(song: BlueprintSong): void {
    this.stop();
    // Own the mode rather than trusting the caller to have set it: every
    // position this class reports while following Live comes from Live's
    // messages, so it must read the clock source that way (`currentBeat`).
    this.clockSource = "ableton";
    this.spans = sectionSpans(song);
    if (this.spans.length === 0) return;

    const clock = createAbletonSyncClock(song);
    this.abletonClock = clock;
    this.isPlaying = true;

    const followPosition = () => {
      if (!this.isPlaying) return;
      const beat = clock.position();
      if (beat === null) {
        // Live's transport is stopped: report it once so the UI drops out of
        // "playing", but hold the last beat rather than rewinding to the top.
        const held = this.syncedBeat ?? 0;
        this.emit(this.tickAt(held, false));
        return;
      }
      this.syncedBeat = beat;
      // A staged live edit still lands on the bar under this clock: the
      // boundary is crossed between the bridge's whole-beat messages, and
      // this interpolated position is what sees it.
      if (this.nextBarCb !== null && beat >= this.nextBarAt) {
        const cb = this.nextBarCb;
        this.nextBarCb = null;
        cb();
      }
      this.emit(this.tickAt(beat, true));
    };

    // Bridge messages land exactly on the beat — emit on those as well as on
    // frames, so beat-aligned consumers see the beat itself, not the frame
    // that happens to follow it.
    this.abletonUnsub = clock.onUpdate(followPosition);

    const tickLoop = () => {
      if (!this.isPlaying) return;
      if (clock.position() !== null) followPosition();
      this.schedulerId = requestAnimationFrame(tickLoop);
    };
    this.schedulerId = requestAnimationFrame(tickLoop);
  }

  /** Anchor "song beat 0" to Ableton's current transport position. Returns
   *  the new offset (Ableton beat) so StudioView can persist it to the
   *  song. A no-op returning null if nothing's been received from the
   *  bridge yet — there's nothing meaningful to anchor to. */
  calibrate(): number | null {
    const beat = getAbletonClock().getState().abletonBeat;
    return beat;
  }

  /** Stop playback (self-clock or Ableton-synced) — safe to call whether
   *  or not playback is currently running (unmount/cleanup calls this
   *  unconditionally). Resets the playhead to the top: any paused position
   *  is cleared, so the next `play()` starts from the beginning.
   *  Deliberately does *not* disconnect `abletonClock` — that connection
   *  is meant to persist across stop/resync so reconnecting doesn't need a
   *  fresh handshake every time playback toggles. */
  stop(): void {
    this.pausedBeat = null;
    this.nextBarCb = null;
    this.syncedBeat = null;
    if (this.schedulerId !== null) {
      cancelAnimationFrame(this.schedulerId);
      this.schedulerId = null;
    }
    if (this.abletonUnsub) {
      this.abletonUnsub();
      this.abletonUnsub = null;
    }
    this.abletonClock?.dispose();
    this.abletonClock = null;

    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    if (wasPlaying) {
      this.emit({ beat: 0, isPlaying: false, sectionIndex: -1, sectionId: null, occurrenceIndex: -1 });
    }
  }

  /**
   * Fan a tick out to every subscriber.
   *
   * Delivery is queued rather than recursive: a listener that calls
   * `stop()`/`pause()` (the rehearsal desk and the spine both do) re-enters
   * `emit`, and without the queue the remaining listeners would receive the
   * stop tick BEFORE the play tick they were about to get — an out-of-order
   * state that is very hard to diagnose from the UI. Each listener is also
   * isolated, so one broken subscriber cannot freeze every other playhead.
   */
  private emit(tick: TransportTick): void {
    this.emitQueue.push(tick);
    if (this.emitting) return;
    this.emitting = true;
    try {
      while (this.emitQueue.length > 0) {
        const next = this.emitQueue.shift()!;
        for (const listener of Array.from(this.tickListeners)) {
          try {
            listener(next);
          } catch (error) {
            reportTickListenerError(error);
          }
        }
        this.post(next);
      }
    } finally {
      this.emitting = false;
    }
  }

  /**
   * Forward one tick to the other windows.
   *
   * Every subscriber in THIS page reads `onTick` (or the quantised playhead
   * store) directly; the channel exists for the lyric/chord popout, which is a
   * separate window that re-renders on every message it receives. Ten
   * structured clones a second is more than that window can show, and sixty
   * was pure cost — but a change of play STATE always goes, so a popout can
   * never miss a stop or a start and sit there looking like it is playing.
   */
  private post(tick: TransportTick): void {
    const now = performance.now();
    const stateChange = tick.isPlaying !== this.lastPostedPlaying;
    if (!stateChange && now - this.lastPostAt < 100) return;
    this.lastPostAt = now;
    this.lastPostedPlaying = tick.isPlaying;
    this.getChannel().postMessage(tick);
  }
}

let sharedTransport: SongTransport | null = null;

/** One transport per page — Studio Play always means "play this song,"
 *  interrupting whatever was already playing rather than layering on
 *  top of it. */
export function getSongTransport(): SongTransport {
  if (!sharedTransport) sharedTransport = new SongTransport();
  return sharedTransport;
}
